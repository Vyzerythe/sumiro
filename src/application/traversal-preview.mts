import { Color, Group, HemisphereLight, PerspectiveCamera, Scene, type Object3D } from 'three/webgpu';
import { createAudioCues } from '../audio/audio-cues.mts';
import type { AudioVolumes } from '../audio/audio-mixer.mts';
import { firstChapterId } from '../domain/chapters.mts';
import { createRunProgress } from '../domain/run-progress.mts';
import { loadAnimatedPlayer, type AnimatedPlayer } from '../player/animated-player.mts';
import { createTraversalController } from '../player/traversal-controller.mts';
import { bindInkMeshMaterials } from '../rendering/ink-mesh-materials.mts';
import { createInkRenderGraph } from '../rendering/ink-render-graph.mts';
import { INK_PAPER_BASE } from '../rendering/ink-surface-sky.mts';
import { createChapterManager, type ChapterManager } from '../runtime/chapter-manager.mts';
import { createSourceRuntime, type SourceRuntimeContext } from '../runtime/source-runtime.mts';
import { createChapterOneCamera } from './chapter-one-camera.mts';
import { resolveChapterOneSpawn } from './chapter-one-checkpoints.mts';
import { createChapterOneInteractions, type ChapterOneInteractionEvent } from './chapter-one-interactions.mts';
import { chapterOneLedges, chapterOneLeapLinks } from './chapter-one-ledges.mts';
import { chapterOneGateBarrier } from './chapter-one-obstacles.mts';
import { loadChapterOneTraversalScene } from './chapter-one-scene.mts';
import { chapterThreeSceneAssets, createChapterThreeWorld } from './chapter-three-world.mts';
import { createChapterTwoMechanisms } from './chapter-two-mechanisms.mts';
import { bindChapterTwoPresentation } from './chapter-two-presentation.mts';
import { loadChapterTwoScene } from './chapter-two-scene.mts';
import { createChapterTwoWorld } from './chapter-two-world.mts';
import { loadInkSceneAsset } from './ink-scene-asset.mts';
import { createStaticTraversalCamera } from './static-traversal-camera.mts';

type RuntimeOptions = Parameters<typeof createSourceRuntime<AudioContext>>[0];
interface TraversalPreviewOptions extends Pick<RuntimeOptions, 'assets' | 'audio' | 'gpu' | 'input' | 'viewport'> {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  progress?: ReturnType<typeof createRunProgress>;
}

interface TraversalChapter {
  player: ReturnType<typeof createTraversalController>;
  view: ReturnType<typeof createChapterOneCamera> | ReturnType<typeof createStaticTraversalCamera>;
  story?: ReturnType<typeof createChapterOneInteractions>;
  mechanisms?: { driver: ReturnType<typeof createChapterTwoMechanisms>; present(): void };
  killDrop: number;
  killY?: number;
}

type TraversalChapters = ChapterManager<Object3D, TraversalChapter>;

/** Native traversal with independently prepared chapter roots and persistent player presentation. */
export async function createTraversalPreview({ canvas, progress = createRunProgress({ getItem: () => null }),
  ...options }: TraversalPreviewOptions) {
  const resumeState = progress.hasSave ? progress.current : undefined;
  const initialChapter = resumeState?.chapter ?? firstChapterId;
  const scene = new Scene();
  scene.background = new Color().setRGB(...INK_PAPER_BASE);
  scene.add(new HemisphereLight(0xfff1dc, 0x777571, 2.5));
  const camera = new PerspectiveCamera(52, options.viewport.width / options.viewport.height, 0.1, 100);
  let chapters: TraversalChapters | undefined;
  let active: TraversalChapters['current'] = null;
  let visual: AnimatedPlayer | undefined;
  let audioCues: ReturnType<typeof createAudioCues> | undefined;
  let steering: { railYaw: number; zone: string } | null = null;
  let teleport = 0;
  let switching: Promise<boolean> | undefined;
  let lifetimeSignal: AbortSignal | undefined;
  let chapterTwoExitSeconds = 0;

  function applyView({ player, view }: TraversalChapter, delta: number, context: SourceRuntimeContext) {
    const { x, y, z, grounded, state } = player.state;
    const pose = view(player.state, delta, teleport);
    steering = { railYaw: pose.yaw, zone: pose.zone };
    camera.position.set(pose.x, pose.y, pose.z);
    camera.rotation.set(pose.pitch * Math.PI / 180, pose.yaw * Math.PI / 180, 0);
    context.registry.set('player.position', { x, y, z, grounded, state });
    context.registry.set('camera.railFrame', pose.railFrame);
  }

  function synchronize(context: SourceRuntimeContext) {
    const current = chapters?.current;
    if (!current || !visual || switching) return null;
    if (active !== current) {
      active = current;
      teleport++;
      visual.reset(current.data.player.state);
      current.data.story?.enter(progress.current);
      current.data.mechanisms?.driver.enter(progress.current);
      current.data.mechanisms?.present();
      chapterTwoExitSeconds = 0;
      if (!current.data.story) context.registry.set('chapter.interaction', { type: 'prompt', target: null });
      context.registry.set('chapter.current', current.id);
      void audioCues?.play('chapter', current.id);
      applyView(current.data, 0, context);
    }
    return current;
  }

  function advanceChapter() {
    if (switching) return switching;
    if (!chapters) return Promise.reject(Error('Traversal chapter host is unavailable'));
    const manager = chapters;
    const signal = lifetimeSignal;
    switching = progress.completeChapter(id => manager.switchTo(id, signal ? { signal } : {}))
      .finally(() => { switching = undefined; });
    return switching;
  }

  function requestNextChapter(context: SourceRuntimeContext) {
    void advanceChapter().catch(error => {
      if (!lifetimeSignal?.aborted) context.registry.set('chapter.interaction', {
        type: 'hint', text: error instanceof Error ? error.message : 'Could not load the next chapter.', ms: 4500,
      } satisfies ChapterOneInteractionEvent);
    });
  }

  const runtime = await createSourceRuntime({
    ...options,
    graphics: { canvas, scene, camera, buildOutput: pass => createInkRenderGraph(pass, camera, { paper: { strength: 0.75 } }) },
    systems: {
      './ground-traversal.mts': async () => ({
        async init(context, lifetime) {
          if (context.audio) {
            const cues = createAudioCues({ mixer: context.audio, assets: context.assets,
              reportError: (cue, error) => console.warn(`[audio cue:${cue}]`, error),
            });
            audioCues = cues;
            lifetime.defer(() => cues.dispose());
            const volumes: Partial<AudioVolumes> = {};
            for (const key of ['master', 'music', 'ambience', 'effects', 'voice'] as const) {
              const value = progress.current.options[key];
              if (typeof value === 'number') volumes[key] = value;
            }
            context.registry.set('game.options', volumes);
          }
          const actor = await loadAnimatedPlayer(context.assets, { signal: lifetime.signal });
          lifetime.defer(() => actor.dispose());
          lifetime.signal.throwIfAborted();
          lifetime.defer(bindInkMeshMaterials(actor.root, { preset: 'cloth' }));
          lifetime.ownRoot(actor.root);
          visual = actor;
          lifetimeSignal = lifetime.signal;
          const stage = lifetime.ownRoot(new Group());
          const canInkStep = () => progress.current.abilities.inkStep === true;
          chapters = createChapterManager<Object3D, TraversalChapter>({
            scene: stage,
            async load(id, resources) {
              if (id === firstChapterId) {
                const { world, root } = await loadChapterOneTraversalScene(context.assets, resources);
                const spawn = resolveChapterOneSpawn(resumeState?.chapter === id ? resumeState : undefined);
                const player = createTraversalController(world, spawn, {
                  ledges: chapterOneLedges, leapLinks: chapterOneLeapLinks, duration: actor.duration, canInkStep,
                });
                const story = createChapterOneInteractions({
                  groundHeightAt: (x, z) => world.groundAt(x, z)?.y ?? null,
                  checkpoint: shrine => { progress.checkpoint(shrine); },
                  collectScroll: scroll => { progress.collectScroll(scroll); },
                  learnInkStep: () => { progress.learnInkStep(); },
                  setGateBarrier: enabled => world.setGroup(chapterOneGateBarrier, enabled),
                  onEvent(event) {
                    context.registry.set('chapter.interaction', event);
                    if (event.type === 'shrine-rested') void audioCues?.play('shrine');
                    else if (event.type === 'scroll-captured') void audioCues?.play('scroll');
                    else if (event.type === 'gate' && event.phase === 'dropping') void audioCues?.play('gate');
                    if (event.type === 'chapter-exit') requestNextChapter(context);
                  },
                });
                return { root, data: { player, story, view: createChapterOneCamera(world, actor.duration('climb_up')), killDrop: 5.5 } };
              }
              if (id === 'ch2_pass') {
                const { world, spawn, killDrop, killY } = createChapterTwoWorld();
                const root = await loadChapterTwoScene(context.assets, resources);
                const driver = createChapterTwoMechanisms(world, {
                  hasFlag: flag => Boolean(progress.current.flags[flag]), setFlag: flag => { progress.setFlag(flag); },
                  onEvent(event) {
                    if (event.type === 'hint') context.registry.set('chapter.interaction', event);
                    else context.registry.set('chapter.mechanism', event);
                  },
                });
                resources.defer(() => driver.dispose());
                const present = bindChapterTwoPresentation(root, driver);
                const player = createTraversalController(world, spawn, { ledges: [], leapLinks: [], duration: actor.duration, canInkStep });
                return { root, data: { player, view: createStaticTraversalCamera(world, id), killDrop, killY, mechanisms: { driver, present } } };
              }
              if (id === 'ch3_pines') {
                const { world, spawn, killDrop, killY } = createChapterThreeWorld();
                const root = await loadInkSceneAsset(context.assets, chapterThreeSceneAssets.world, resources);
                root.name = id;
                const player = createTraversalController(world, spawn, { ledges: [], leapLinks: [], duration: actor.duration, canInkStep });
                return { root, data: { player, view: createStaticTraversalCamera(world, id), killDrop, killY } };
              }
              throw Error(`Native traversal is unavailable for ${id}`);
            },
          });
          const manager = chapters;
          lifetime.defer(() => manager.dispose());
          await manager.switchTo(initialChapter, { signal: lifetime.signal });
        },
        update(delta, context) {
          void audioCues?.update();
          const current = synchronize(context);
          if (!current || !visual) return;
          const { player, story, mechanisms, killDrop, killY = -Infinity } = current.data;
          if (mechanisms) {
            const { driver, present } = mechanisms;
            if (context.input.attack && player.state.grounded) {
              const bell = driver.bells.find(bell => Math.abs(bell.y - player.state.y) < 2.1 &&
                Math.hypot(bell.x - player.state.x, bell.z - player.state.z) <= bell.radius + 0.6);
              if (bell) driver.ringBell(bell.id);
            }
            driver.step(delta, player.state);
            present();
          }
          player.step(delta, context.input, steering);
          if (player.state.lastGroundY - player.state.y > killDrop || player.state.y < killY) {
            player.reset();
            teleport++;
            visual.reset(player.state);
          }
          visual.update(player.state, delta);
          progress.tick(delta);
          story?.update(delta, player.state, { interact: context.input.interact });
          if (current.id === 'ch2_pass') {
            const { x, z, grounded } = player.state;
            const atExit = grounded && x >= 45.5 && x <= 50 && z >= -380 && z <= -374;
            chapterTwoExitSeconds = atExit ? chapterTwoExitSeconds + delta : 0;
            if (chapterTwoExitSeconds > 1.6) {
              chapterTwoExitSeconds = 0;
              requestNextChapter(context);
            }
          }
          applyView(current.data, delta, context);
        },
        beforeRender: synchronize,
      }),
    },
  });
  const failure = runtime.report().find(system => system.failed);
  if (failure) {
    await runtime.dispose();
    throw Error(`Traversal preview could not start (${failure.failed})`, { cause: failure.error });
  }
  return {
    ...runtime,
    advanceChapter,
    onInteraction(listener: (event: ChapterOneInteractionEvent) => void) {
      return runtime.context.registry.on('chapter.interaction', event => listener(event as ChapterOneInteractionEvent));
    },
  };
}
