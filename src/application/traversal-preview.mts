import { Color, Group, HemisphereLight, PerspectiveCamera, Scene, type Object3D } from 'three/webgpu';
import { firstChapterId } from '../domain/chapters.mts';
import { createRunProgress } from '../domain/run-progress.mts';
import { loadAnimatedPlayer, type AnimatedPlayer } from '../player/animated-player.mts';
import { createTraversalController } from '../player/traversal-controller.mts';
import { bindInkMeshMaterials } from '../rendering/ink-mesh-materials.mts';
import { createInkRenderGraph } from '../rendering/ink-render-graph.mts';
import { createChapterManager, type ChapterManager } from '../runtime/chapter-manager.mts';
import { createSourceRuntime, type SourceRuntimeContext } from '../runtime/source-runtime.mts';
import { createChapterOneCamera } from './chapter-one-camera.mts';
import { resolveChapterOneSpawn } from './chapter-one-checkpoints.mts';
import { createChapterOneInteractions, type ChapterOneInteractionEvent } from './chapter-one-interactions.mts';
import { chapterOneLedges, chapterOneLeapLinks } from './chapter-one-ledges.mts';
import { chapterOneGateBarrier } from './chapter-one-obstacles.mts';
import { loadChapterOneTraversalScene } from './chapter-one-scene.mts';
import { createChapterTwoCamera } from './chapter-two-camera.mts';
import { loadChapterTwoScene } from './chapter-two-scene.mts';
import { createChapterTwoWorld } from './chapter-two-world.mts';

type RuntimeOptions = Parameters<typeof createSourceRuntime<AudioContext>>[0];
interface TraversalPreviewOptions extends Pick<RuntimeOptions, 'assets' | 'gpu' | 'input' | 'viewport'> {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  progress?: ReturnType<typeof createRunProgress>;
}

interface TraversalChapter {
  player: ReturnType<typeof createTraversalController>;
  view: ReturnType<typeof createChapterOneCamera> | ReturnType<typeof createChapterTwoCamera>;
  story?: ReturnType<typeof createChapterOneInteractions>;
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
  scene.background = new Color(0xc9c6bf);
  scene.add(new HemisphereLight(0xfff1dc, 0x777571, 2.5));
  const camera = new PerspectiveCamera(52, options.viewport.width / options.viewport.height, 0.1, 100);
  let chapters: TraversalChapters | undefined;
  let active: TraversalChapters['current'] = null;
  let visual: AnimatedPlayer | undefined;
  let steering: { railYaw: number; zone: string } | null = null;
  let teleport = 0;
  let switching: Promise<boolean> | undefined;
  let lifetimeSignal: AbortSignal | undefined;

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
      if (!current.data.story) context.registry.set('chapter.interaction', { type: 'prompt', target: null });
      context.registry.set('chapter.current', current.id);
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

  const runtime = await createSourceRuntime({
    ...options,
    graphics: { canvas, scene, camera, buildOutput: pass => createInkRenderGraph(pass, camera) },
    systems: {
      './ground-traversal.mts': async () => ({
        async init(context, lifetime) {
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
                    if (event.type === 'chapter-exit') void advanceChapter().catch(error => {
                      if (!lifetime.signal.aborted) context.registry.set('chapter.interaction', {
                        type: 'hint', text: error instanceof Error ? error.message : 'Could not load the next chapter.', ms: 4500,
                      } satisfies ChapterOneInteractionEvent);
                    });
                  },
                });
                return { root, data: { player, story, view: createChapterOneCamera(world, actor.duration('climb_up')), killDrop: 5.5 } };
              }
              if (id === 'ch2_pass') {
                const { world, spawn, killDrop, killY } = createChapterTwoWorld();
                const root = await loadChapterTwoScene(context.assets, resources);
                const player = createTraversalController(world, spawn, { ledges: [], leapLinks: [], duration: actor.duration, canInkStep });
                return { root, data: { player, view: createChapterTwoCamera(world), killDrop, killY } };
              }
              throw Error(`Native traversal is unavailable for ${id}`);
            },
          });
          const manager = chapters;
          lifetime.defer(() => manager.dispose());
          await manager.switchTo(initialChapter, { signal: lifetime.signal });
        },
        update(delta, context) {
          const current = synchronize(context);
          if (!current || !visual) return;
          const { player, story, killDrop, killY = -Infinity } = current.data;
          player.step(delta, context.input, steering);
          if (player.state.lastGroundY - player.state.y > killDrop || player.state.y < killY) {
            player.reset();
            teleport++;
            visual.reset(player.state);
          }
          visual.update(player.state, delta);
          progress.tick(delta);
          story?.update(delta, player.state, { interact: context.input.interact });
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
