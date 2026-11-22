import { Color, Group, HemisphereLight, PerspectiveCamera, Scene, type Object3D } from 'three/webgpu';
import { createAudioCues } from '../audio/audio-cues.mts';
import type { AudioVolumes } from '../audio/audio-mixer.mts';
import { firstChapterId } from '../domain/chapters.mts';
import { createCompanion } from '../domain/companion.mts';
import { createRunProgress } from '../domain/run-progress.mts';
import type { CollisionWorld } from '../physics/world.mts';
import { loadAnimatedPlayer, type AnimatedPlayer } from '../player/animated-player.mts';
import { createTraversalController } from '../player/traversal-controller.mts';
import { bindInkMeshMaterials } from '../rendering/ink-mesh-materials.mts';
import { createInkRenderGraph } from '../rendering/ink-render-graph.mts';
import { INK_PAPER_BASE } from '../rendering/ink-surface-sky.mts';
import { createChapterManager, type ChapterManager } from '../runtime/chapter-manager.mts';
import { createSourceRuntime, type SourceRuntimeContext } from '../runtime/source-runtime.mts';
import { createChapterOneCamera } from './chapter-one-camera.mts';
import { createCheckpointInteraction, resolveChapterSpawn, type GroundedSpawn } from './chapter-checkpoints.mts';
import { createChapterExit } from './chapter-exits.mts';
import { createChapterOneInteractions, type ChapterOneInteractionEvent } from './chapter-one-interactions.mts';
import { chapterOneLedges, chapterOneLeapLinks } from './chapter-one-ledges.mts';
import { chapterOneGateBarrier } from './chapter-one-obstacles.mts';
import { loadChapterOneTraversalScene } from './chapter-one-scene.mts';
import { chapterOneSpawn } from './chapter-one-terrain.mts';
import { createChapterSixIceHolds } from './chapter-six-ice-holds.mts';
import { createChapterTwoMechanisms } from './chapter-two-mechanisms.mts';
import { loadChapterTwoDuel } from './chapter-two-duel.mts';
import { bindChapterTwoPresentation } from './chapter-two-presentation.mts';
import { mountLateChapterMechanisms, type LateChapterMechanisms } from './late-chapter-mechanisms.mts';
import { loadCompanionPresentation } from './companion-presentation.mts';
import { loadEncounterCombat } from './encounter-combat.mts';
import { getStaticChapter } from './static-chapter-catalog.mts';
import { createStaticTraversalCamera } from './static-traversal-camera.mts';

type RuntimeOptions = Parameters<typeof createSourceRuntime<AudioContext>>[0];
interface TraversalPreviewOptions extends Pick<RuntimeOptions, 'assets' | 'audio' | 'gpu' | 'input' | 'viewport'> {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  progress?: ReturnType<typeof createRunProgress>;
  random?: () => number;
}

interface TraversalChapter {
  player: ReturnType<typeof createTraversalController>;
  companion: ReturnType<typeof createCompanion>;
  world: CollisionWorld;
  origin: GroundedSpawn;
  view: ReturnType<typeof createChapterOneCamera> | ReturnType<typeof createStaticTraversalCamera>;
  story?: ReturnType<typeof createChapterOneInteractions>;
  mechanisms?: { driver: ReturnType<typeof createChapterTwoMechanisms>; present(): void };
  duel?: Awaited<ReturnType<typeof loadChapterTwoDuel>>;
  checkpoints?: ReturnType<typeof createCheckpointInteraction>;
  exit?: NonNullable<ReturnType<typeof createChapterExit>>;
  iceHolds?: ReturnType<typeof createChapterSixIceHolds>;
  lateMechanisms?: LateChapterMechanisms;
  combat?: NonNullable<Awaited<ReturnType<typeof loadEncounterCombat>>>;
  killDrop: number;
  killY?: number;
}

type TraversalChapters = ChapterManager<Object3D, TraversalChapter>;

function pauseTraversal(context: SourceRuntimeContext, paused: boolean) {
  if (context.paused === paused) return;
  context.paused = paused;
  context.input.reset();
  context.registry.set('game.paused', paused);
  context.registry.set('audio.duck', paused);
}

/** Native traversal with independently prepared chapter roots and persistent player presentation. */
export async function createTraversalPreview({ canvas, progress = createRunProgress({ getItem: () => null }), random,
  ...options }: TraversalPreviewOptions) {
  const resumeState = progress.hasSave ? { chapter: progress.current.chapter, shrine: progress.current.shrine } : undefined;
  const initialChapter = resumeState?.chapter ?? firstChapterId;
  const scene = new Scene();
  scene.background = new Color().setRGB(...INK_PAPER_BASE);
  scene.add(new HemisphereLight(0xfff1dc, 0x777571, 2.5));
  const camera = new PerspectiveCamera(52, options.viewport.width / options.viewport.height, 0.1, 100);
  let chapters: TraversalChapters | undefined;
  let active: TraversalChapters['current'] = null;
  let visual: AnimatedPlayer | undefined;
  let catVisual: Awaited<ReturnType<typeof loadCompanionPresentation>> | undefined;
  let audioCues: ReturnType<typeof createAudioCues> | undefined;
  let steering: { railYaw: number; zone: string } | null = null;
  let teleport = 0;
  let switching: Promise<boolean> | undefined;
  let lifetimeSignal: AbortSignal | undefined;

  function companionPlayer(player: TraversalChapter['player']) {
    const { x, y, z, heading, state, grounded, vx, vz, carrier } = player.state;
    return { x, y, z, heading, state, grounded, speed: Math.hypot(vx, vz), onCarrier: carrier !== null };
  }

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
      camera.far = current.id === 'ch5_sea' ? 800 : 100;
      camera.updateProjectionMatrix();
      visual.reset(current.data.player.state);
      current.data.companion.reset(companionPlayer(current.data.player));
      catVisual?.update(current.data.companion.state, 0, Boolean(progress.current.flags.inkStep));
      current.data.story?.enter(progress.current);
      current.data.mechanisms?.driver.enter(progress.current);
      current.data.mechanisms?.present();
      current.data.lateMechanisms?.reset();
      current.data.duel?.reset();
      current.data.combat?.reset();
      current.data.duel?.present(0);
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

  function requestNextChapter(context: SourceRuntimeContext, exit?: NonNullable<ReturnType<typeof createChapterExit>>) {
    void advanceChapter().then(() => {
      if (progress.current.flags.finished) context.registry.set('chapter.interaction', {
        type: 'hint', text: 'The run is complete.', ms: 6500,
      } satisfies ChapterOneInteractionEvent);
    }).catch(error => {
      exit?.retry();
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
        whilePaused: true,
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
          catVisual = await loadCompanionPresentation(context.assets, lifetime, actor.root);
          lifetimeSignal = lifetime.signal;
          const stage = lifetime.ownRoot(new Group());
          const canInkStep = () => progress.current.abilities.inkStep === true;
          chapters = createChapterManager<Object3D, TraversalChapter>({
            scene: stage,
            async load(id, resources) {
              function companion(world: CollisionWorld) {
                return createCompanion(world, id !== firstChapterId || Boolean(progress.current.flags.cat_found), event => {
                  if (event.type === 'found') progress.setFlag('cat_found');
                  else context.registry.set('chapter.interaction', {
                    type: 'hint', text: 'The cat can’t cross that. Go back and carry it.', ms: 5200,
                  } satisfies ChapterOneInteractionEvent);
                });
              }
              if (id === firstChapterId) {
                const { world, root } = await loadChapterOneTraversalScene(context.assets, resources);
                const spawn = resolveChapterSpawn(id, chapterOneSpawn, resumeState, world);
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
                return { root, data: { world, origin: chapterOneSpawn, player, story, companion: companion(world),
                  view: createChapterOneCamera(world, actor.duration('climb_up')), killDrop: 5.5 } };
              }
              const definition = getStaticChapter(id);
              const { world, spawn: origin, killDrop = Infinity, killY } = definition.createWorld();
              const root = await definition.loadGeometry(context.assets, resources);
              let combat: TraversalChapter['combat'];
              const lateMechanisms = mountLateChapterMechanisms(id, world, root, resources, progress, {
                encounterState: encounter => combat?.state(encounter),
                breakSwarm: swarm => { combat?.breakSwarm(swarm); },
                onEvent(event) {
                  if (event.type === 'hint') context.registry.set('chapter.interaction', event);
                  else context.registry.set('chapter.mechanism', event);
                  if (event.type === 'cue' && event.name === 'gate') void audioCues?.play('gate');
                },
              });
              let mechanisms: TraversalChapter['mechanisms'];
              let iceHolds: TraversalChapter['iceHolds'];
              if (id === 'ch2_pass') {
                const driver = createChapterTwoMechanisms(world, {
                  hasFlag: flag => Boolean(progress.current.flags[flag]), setFlag: flag => { progress.setFlag(flag); },
                  onEvent(event) {
                    if (event.type === 'hint') context.registry.set('chapter.interaction', event);
                    else context.registry.set('chapter.mechanism', event);
                  },
                });
                resources.defer(() => driver.dispose());
                mechanisms = { driver, present: bindChapterTwoPresentation(root, driver) };
              }
              if (id === 'ch6_summit') {
                const ice = createChapterSixIceHolds(world, { onEvent: event => { context.registry.set('chapter.mechanism', event); } });
                resources.defer(() => ice.dispose());
                ice.bindPresentation(root);
                iceHolds = ice;
              }
              const traversal = definition.createTraversal(world);
              const spawn = resolveChapterSpawn(id, origin, resumeState, world);
              const player = createTraversalController(world, spawn, { ...traversal, duration: actor.duration, canInkStep,
                ...(lateMechanisms?.inkStep ? { onInkStep: lateMechanisms.inkStep } : {}) });
              combat = await loadEncounterCombat({ id, assets: context.assets, lifetime: resources, world, root, player,
                progress, duration: actor.duration, ...(random ? { random } : {}),
                onCue(name) {
                  if (name === 'gate' && id !== 'ch5_sea') void audioCues?.play('gate');
                  context.registry.set('combat.cue', name);
                },
                onHint(text, ms) { context.registry.set('chapter.interaction', { type: 'hint', text, ms }); },
              });
              const exit = createChapterExit(id);
              let duel: TraversalChapter['duel'];
              if (id === 'ch2_pass') {
                duel = await loadChapterTwoDuel(context.assets, resources, world, player, progress, event => {
                  context.registry.set('chapter.combat', event);
                  if (event.type === 'encounter-clear') {
                    context.registry.set('chapter.interaction', {
                      type: 'hint', text: 'The door has a bell beside it. The sword rings it.', ms: 5000,
                    } satisfies ChapterOneInteractionEvent);
                  } else if (event.type === 'encounter-start') {
                    context.registry.set('chapter.interaction', {
                      type: 'hint', text: 'J or left mouse to strike · K or right mouse to parry', ms: 5000,
                    } satisfies ChapterOneInteractionEvent);
                  } else if (event.type === 'cue' && event.name === 'gate') void audioCues?.play('gate');
                }, random);
                root.add(duel.root);
              }
              return { root, data: { world, origin, player, companion: companion(world),
                view: createStaticTraversalCamera(world, id), killDrop, killY,
                checkpoints: createCheckpointInteraction(id, world, progress),
                ...(mechanisms ? { mechanisms } : {}), ...(duel ? { duel } : {}), ...(exit ? { exit } : {}),
                ...(iceHolds ? { iceHolds } : {}), ...(lateMechanisms ? { lateMechanisms } : {}),
                ...(combat ? { combat } : {}) } };
            },
          });
          const manager = chapters;
          lifetime.defer(() => manager.dispose());
          await manager.switchTo(initialChapter, { signal: lifetime.signal });
        },
        update(delta, context) {
          void audioCues?.update();
          if (context.input.pause) {
            pauseTraversal(context, !context.paused);
            return;
          }
          if (context.paused) return;
          const current = synchronize(context);
          if (!current || !visual) return;
          const { player, companion, story, mechanisms, duel, checkpoints, exit, iceHolds, lateMechanisms, combat,
            killDrop, killY = -Infinity } = current.data;
          iceHolds?.step(delta, { state: player.state.state, ledge: player.state.ledge, teleports: teleport });
          if (mechanisms) {
            const { driver, present } = mechanisms;
            if (context.input.attack && player.state.grounded) {
              const bell = driver.bells.find(bell => Math.abs(bell.y - player.state.y) < 2.1 &&
                Math.hypot(bell.x - player.state.x, bell.z - player.state.z) <= bell.radius + 0.6);
              if (bell) driver.ringBell(bell.id, { fighting: duel?.driver.phase === 'fighting' });
            }
            driver.step(delta, player.state);
            present();
          }
          const fell = lateMechanisms?.step({ delta, player, attack: context.input.attack, interact: context.input.interact,
            seconds: context.time.t, cameraZ: camera.position.z });
          const combatAction = duel?.driver.phase === 'fighting' || duel?.driver.player.clip
            ? duel.driver.player.action : combat?.player.action;
          if (!fell && (!combatAction || combatAction === 'IDLE') && !exit?.finishing) player.step(delta, context.input, steering);
          const swordInput = {
            attack: context.input.attack, parry: context.input.parry, swordAvailable: progress.current.abilities.sword === true,
          };
          duel?.step(delta, swordInput);
          const courtActive = duel?.driver.phase === 'fighting' || duel?.driver.phase === 'defeated';
          combat?.step(delta, context.time.t, swordInput, !courtActive);
          if (combat) context.registry.set('combat.encounters', { player: { ...combat.player }, actors: combat.report() });
          duel?.present(delta);
          if (duel) context.registry.set('combat.sword-wraith', {
            phase: duel.driver.phase, enemy: { ...duel.driver.enemy }, player: { ...duel.driver.player },
          });
          const defeated = duel?.driver.phase === 'defeated' && duel.driver.player.elapsed > 2.1 ||
            combat?.player.action === 'DEATH' && combat.player.elapsed > 2.1;
          if (fell || defeated || player.state.lastGroundY - player.state.y > killDrop || player.state.y < killY) {
            player.reset(resolveChapterSpawn(current.id, current.data.origin, progress.current, current.data.world));
            duel?.reset();
            combat?.reset();
            lateMechanisms?.reset();
            companion.reset(companionPlayer(player));
            teleport++;
            visual.reset(player.state);
          }
          const action = courtActive || duel?.driver.player.clip ? duel?.driver.player : combat?.player;
          visual.update(action?.clip ? { ...player.state, heading: action.heading } : player.state, delta,
            action?.clip ? { clip: action.clip, frame: action.frame } : undefined);
          const fighting = courtActive || combat?.fighting() === true;
          companion.update(delta, companionPlayer(player), context.input.cat && !fighting);
          catVisual?.update(companion.state, delta, Boolean(progress.current.flags.inkStep));
          const { phase, found } = companion.state;
          context.registry.set('companion.state', { phase, found });
          progress.tick(delta);
          story?.update(delta, player.state, { interact: context.input.interact });
          if (checkpoints?.update(player.state, context.input.interact, fighting)) {
            void audioCues?.play('shrine');
            context.registry.set('chapter.interaction', { type: 'hint', text: 'The lantern is lit.', ms: 3800 });
          }
          if (exit?.update(delta, player.state, progress.current.flags)) requestNextChapter(context, exit);
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
    setPaused(paused: boolean) { pauseTraversal(runtime.context, paused); },
    onInteraction(listener: (event: ChapterOneInteractionEvent) => void) {
      return runtime.context.registry.on('chapter.interaction', event => listener(event as ChapterOneInteractionEvent));
    },
  };
}
