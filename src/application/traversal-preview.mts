import { Color, Group, HemisphereLight, PerspectiveCamera, Scene, type Object3D } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createAudioCues } from '../audio/audio-cues.mts';
import { disposeGLTF } from '../assets/asset-manager.mts';
import type { AudioVolumes } from '../audio/audio-mixer.mts';
import { firstChapterId } from '../domain/chapters.mts';
import { createCompanion } from '../domain/companion.mts';
import { createRunProgress } from '../domain/run-progress.mts';
import { createRunVitals } from '../domain/run-vitals.mts';
import type { CollisionWorld } from '../physics/world.mts';
import { loadAnimatedPlayer, type AnimatedPlayer } from '../player/animated-player.mts';
import { createTraversalController } from '../player/traversal-controller.mts';
import { bindInkMeshMaterials } from '../rendering/ink-mesh-materials.mts';
import { mountChapterOneBackdrop, type ChapterOneBackdrop } from '../rendering/chapter-one-backdrop.mts';
import { createInkRenderGraph } from '../rendering/ink-render-graph.mts';
import { INK_PAPER_BASE } from '../rendering/ink-surface-sky.mts';
import { createChapterManager, type ChapterManager } from '../runtime/chapter-manager.mts';
import { createSourceRuntime, type SourceRuntimeContext } from '../runtime/source-runtime.mts';
import { createChapterOneCamera } from './chapter-one-camera.mts';
import { createCheckpointInteraction, resolveChapterSpawn, type GroundedSpawn } from './chapter-checkpoints.mts';
import { loadChapterCollectibles } from './chapter-collectibles.mts';
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
import { createLaterChapterCamera } from './later-chapter-camera.mts';
import { createStoryPresentation } from './story-presentation.mts';
import { createStoryBeats } from './story-beats.mts';

type RuntimeOptions = Parameters<typeof createSourceRuntime<AudioContext>>[0];
interface TraversalPreviewOptions extends Pick<RuntimeOptions, 'assets' | 'audio' | 'gpu' | 'input' | 'viewport'> {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  progress?: ReturnType<typeof createRunProgress>;
  random?: () => number;
}

interface TraversalChapter {
  player: ReturnType<typeof createTraversalController>;
  companion: ReturnType<typeof createCompanion>;
  collectibles: Awaited<ReturnType<typeof loadChapterCollectibles>>;
  world: CollisionWorld;
  origin: GroundedSpawn;
  view: ReturnType<typeof createChapterOneCamera> | ReturnType<typeof createLaterChapterCamera>;
  story?: ReturnType<typeof createChapterOneInteractions>;
  cutscene?: ReturnType<typeof createStoryPresentation>;
  updateEnvironment?: Awaited<ReturnType<typeof loadChapterOneTraversalScene>>['updateEnvironment'];
  updateLandmarks?: Awaited<ReturnType<typeof loadChapterOneTraversalScene>>['updateLandmarks'];
  backdrop?: ChapterOneBackdrop;
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

const drinkStances = new Set(['IDLE', 'WALK', 'RUN', 'SPRINT', 'LAND', 'TEETER']);

/** Native traversal with independently prepared chapter roots and persistent player presentation. */
export async function createTraversalPreview({ canvas, progress = createRunProgress({ getItem: () => null }), random,
  ...options }: TraversalPreviewOptions) {
  const resumeState = progress.hasSave ? { chapter: progress.current.chapter, shrine: progress.current.shrine } : undefined;
  const initialChapter = resumeState?.chapter ?? firstChapterId;
  const scene = new Scene();
  scene.background = new Color().setRGB(...INK_PAPER_BASE);
  scene.add(new HemisphereLight(0xfff1dc, 0x777571, 2.5));
  const camera = new PerspectiveCamera(52, options.viewport.width / options.viewport.height, 0.1, 100);
  const background = {
    scene: new Scene(),
    camera: new PerspectiveCamera(camera.fov, camera.aspect, camera.near, 2400),
    enabled: uniform(false),
  };
  background.scene.background = scene.background.clone();
  const vitals = createRunVitals();
  const sea = { enabled: uniform(false), level: uniform(0), seconds: uniform(0), stir: uniform(0), reflection: true };
  let seaReflection: ReturnType<typeof createInkRenderGraph>['seaReflection'];
  let chapters: TraversalChapters | undefined;
  let active: TraversalChapters['current'] = null;
  let visual: AnimatedPlayer | undefined;
  let catVisual: Awaited<ReturnType<typeof loadCompanionPresentation>> | undefined;
  let audioCues: ReturnType<typeof createAudioCues> | undefined;
  let beats: ReturnType<typeof createStoryBeats> | undefined;
  let steering: { railYaw: number; zone: string } | null = null;
  let teleport = 0;
  let switching: Promise<boolean> | undefined;
  let ended = false;
  let interactionPrompt: string | null = null;
  let lifetimeSignal: AbortSignal | undefined;

  function publishVitals(context: SourceRuntimeContext, refill = false) {
    const { scrolls, options } = progress.current;
    if (refill) vitals.refill(scrolls.length, options.assist === true);
    else vitals.updateCapacity(scrolls.length, options.assist === true);
    const prior = context.registry.get('game.vitals');
    const current = vitals.snapshot();
    if (!prior || prior.strokes !== current.strokes || prior.maxStrokes !== current.maxStrokes || prior.drinks !== current.drinks) {
      context.registry.set('game.vitals', current);
    }
    if (prior && prior.strokes > 2 && current.strokes > 0 && current.strokes <= 2 && current.drinks > 0 &&
        !progress.current.seen.drink) {
      progress.markSeen('drink');
      context.registry.set('chapter.interaction', { type: 'hint', text: 'R  drink from the gourd', ms: 3800 });
    }
  }

  function companionPlayer(player: TraversalChapter['player']) {
    const { x, y, z, heading, state, grounded, vx, vz, carrier } = player.state;
    return { x, y, z, heading, state, grounded, speed: Math.hypot(vx, vz), onCarrier: carrier !== null };
  }

  function applyView({ player, view, lateMechanisms, updateEnvironment, cutscene }: TraversalChapter, delta: number, context: SourceRuntimeContext) {
    const water = lateMechanisms?.sea;
    sea.enabled.value = water !== undefined;
    if (water) {
      sea.level.value = water.level;
      sea.seconds.value = water.seconds;
      sea.stir.value = water.stir;
      seaReflection?.update(water.level, water.seconds);
    }
    const { x, y, z, grounded, state } = player.state;
    const pose = view(player.state, delta, teleport);
    steering = { railYaw: 'railYaw' in pose ? pose.railYaw : pose.yaw, zone: pose.zone };
    camera.position.set(pose.x, pose.y, pose.z);
    camera.rotation.set(pose.pitch * Math.PI / 180, pose.yaw * Math.PI / 180, 0, 'YXZ');
    cutscene?.presentCamera(delta);
    if (pose.railFrame !== null) updateEnvironment?.({ railFrame: pose.railFrame, cameraY: camera.position.y });
    context.registry.set('player.position', { x, y, z, grounded, state });
    context.registry.set('camera.railFrame', pose.railFrame);
    context.registry.set('camera.steeringYaw', steering.railYaw);
    context.registry.set('camera.zone', pose.zone);
  }

  function synchronize(context: SourceRuntimeContext) {
    const current = chapters?.current;
    if (!current || !visual || switching) return null;
    if (active !== current) {
      active = current;
      teleport++;
      camera.far = current.id === 'ch5_sea' ? 800 : 100;
      camera.updateProjectionMatrix();
      publishVitals(context, true);
      visual.reset(current.data.player.state);
      current.data.companion.reset(companionPlayer(current.data.player));
      catVisual?.update(current.data.companion.state, 0, Boolean(progress.current.flags.inkStep));
      current.data.story?.enter(progress.current);
      beats?.enter(current.id);
      if (current.data.story) current.data.updateLandmarks?.(0, current.data.story.gatePhase);
      current.data.collectibles.sync(progress.current);
      current.data.mechanisms?.driver.enter(progress.current);
      current.data.mechanisms?.present();
      current.data.lateMechanisms?.reset();
      current.data.duel?.reset();
      current.data.combat?.reset();
      current.data.duel?.present(0);
      if (!current.data.story) context.registry.set('chapter.interaction', { type: 'prompt', target: null });
      interactionPrompt = null;
      context.registry.set('chapter.prompt', null);
      context.registry.set('chapter.current', current.id);
      void audioCues?.play('chapter', current.id);
      applyView(current.data, 0, context);
    }
    return current;
  }

  function respawn(data: TraversalChapter, context: SourceRuntimeContext, refill: boolean) {
    data.duel?.reset();
    data.combat?.reset();
    data.lateMechanisms?.reset();
    data.player.reset(resolveChapterSpawn(progress.current.chapter, data.origin, progress.current, data.world));
    data.companion.reset(companionPlayer(data.player));
    data.story?.enter(progress.current);
    if (data.story) data.updateLandmarks?.(0, data.story.gatePhase);
    data.collectibles.sync(progress.current);
    teleport++;
    visual?.reset(data.player.state);
    publishVitals(context, refill);
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
      if (progress.current.chapter !== 'ch6_summit' || !progress.current.flags.finished || !active?.data.cutscene?.complete) return;
      ended = true;
      context.paused = true;
      context.input.reset();
      context.registry.set('game.completed', true);
      void audioCues?.play('credits');
    }).catch(error => {
      exit?.retry();
      if (!lifetimeSignal?.aborted) context.registry.set('chapter.interaction', {
        type: 'hint', text: error instanceof Error ? error.message : 'Could not load the next chapter.', ms: 4500,
      } satisfies ChapterOneInteractionEvent);
    });
  }

  const runtime = await createSourceRuntime({
    ...options,
    graphics: { canvas, scene, camera, buildOutput(pass) {
      const graph = createInkRenderGraph(pass, camera, { paper: { strength: 0.75 }, sea, background });
      seaReflection = graph.seaReflection;
      return graph;
    } },
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
          const cat = catVisual;
          const narrative = createStoryBeats({
            hasFlag: flag => Boolean(progress.current.flags[flag]),
            hasSeen: key => progress.current.seen[key] === true,
            markSeen: progress.markSeen,
            voice: (line, signal) => audioCues?.playRecording(`audio/voice/${line.voice}.ogg`, 'voice', signal),
            sound: (name, signal) => {
              audioCues?.playRecording('audio/sfx/catMeow_1.ogg', 'effects', signal, name === 'catMeow' ? 4 : 6);
            },
            subtitle(line) { context.registry.set('story.subtitle', line?.text ?? null); },
            hint(text, ms) { context.registry.set('chapter.interaction', { type: 'hint', text, ms }); },
            startLanternRest(shrine) { active?.data.cutscene?.rest(shrine); },
          });
          beats = narrative;
          lifetime.defer(() => narrative.dispose());
          lifetimeSignal = lifetime.signal;
          const stage = lifetime.ownRoot(new Group());
          const canInkStep = () => progress.current.abilities.inkStep === true;
          chapters = createChapterManager<Object3D, TraversalChapter>({
            scene: stage,
            activate(candidate, _previous, activation) {
              if (candidate.id !== 'ch5_sea' || !seaReflection) return;
              const unbind = seaReflection.bind(candidate.root);
              activation.defer(unbind);
              activation.rollback(unbind);
            },
            async load(id, resources) {
              function companion(world: CollisionWorld) {
                return createCompanion(world, id !== firstChapterId || Boolean(progress.current.flags.cat_found), event => {
                  if (event.type === 'found') progress.setFlag('cat_found');
                  else context.registry.set('chapter.interaction', {
                    type: 'hint', text: 'The cat can’t cross that. Go back and carry it.', ms: 5200,
                  } satisfies ChapterOneInteractionEvent);
                });
              }
              function scenePresentation(id: 'opening_cat' | 'reunion' | null, root: Object3D, world: CollisionWorld,
                player: TraversalChapter['player'], companion: TraversalChapter['companion']) {
                return createStoryPresentation({ id, root, lifetime: resources, world, player, companion, actor, cat, camera,
                  audio: audioCues,
                  onActive(scene) { context.registry.set('story.scene', scene); },
                  onSubtitle(line) { context.registry.set('story.subtitle', line); },
                });
              }
              if (id === firstChapterId) {
                const [chapter, backdrop] = await Promise.all([
                  loadChapterOneTraversalScene(context.assets, resources),
                  mountChapterOneBackdrop(background.scene, {
                    loadJSON: file => context.assets.loadJSON(file, { signal: resources.signal }),
                    async loadGLTF(file) {
                      const model = await context.assets.loadGLTF(file, { displaySpace: false, signal: resources.signal });
                      resources.defer(() => disposeGLTF(model));
                      resources.signal.throwIfAborted();
                      return model;
                    },
                    async loadTexture(file) {
                      const texture = await context.assets.loadTexture(file, { signal: resources.signal });
                      resources.defer(() => texture.dispose());
                      resources.signal.throwIfAborted();
                      return texture;
                    },
                  }).then(backdrop => {
                    resources.defer(() => backdrop.dispose());
                    resources.signal.throwIfAborted();
                    return backdrop;
                  }),
                ]);
                const { world, root, updateEnvironment, updateLandmarks } = chapter;
                const collectibles = await loadChapterCollectibles(id, context.assets, world, resources);
                root.add(collectibles.root);
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
                    if (event.type === 'shrine-rested' || event.type === 'scroll-captured') collectibles.sync(progress.current);
                    if (event.type === 'shrine-rested') publishVitals(context, true);
                    else if (event.type === 'scroll-captured') publishVitals(context);
                    context.registry.set('chapter.interaction', event);
                    if (event.type === 'shrine-rested') void audioCues?.play('shrine');
                    else if (event.type === 'scroll-captured') void audioCues?.play('scroll');
                    else if (event.type === 'gate' && event.phase === 'dropping') void audioCues?.play('gate');
                    if (event.type === 'chapter-exit') requestNextChapter(context);
                  },
                });
                const partner = companion(world);
                const cutscene = scenePresentation('opening_cat', root, world, player, partner);
                return { root, data: { world, origin: chapterOneSpawn, player, story, updateEnvironment, updateLandmarks,
                  backdrop, cutscene, collectibles, companion: partner,
                  view: createChapterOneCamera(world, actor.duration('climb_up')), killDrop: 5.5 } };
              }
              const definition = getStaticChapter(id);
              const { world, spawn: origin, killDrop = Infinity, killY } = definition.createWorld();
              const [root, collectibles] = await Promise.all([
                definition.loadGeometry(context.assets, resources),
                loadChapterCollectibles(id, context.assets, world, resources),
              ]);
              root.add(collectibles.root);
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
                progress, health: vitals, duration: actor.duration, ...(random ? { random } : {}),
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
                    narrative.onEncounter('clear', event.id);
                  } else if (event.type === 'encounter-start') {
                    narrative.onEncounter('started', event.id);
                    context.registry.set('chapter.interaction', {
                      type: 'hint', text: 'J or left mouse to strike · K or right mouse to parry', ms: 5000,
                    } satisfies ChapterOneInteractionEvent);
                  } else if (event.type === 'cue' && event.name === 'gate') void audioCues?.play('gate');
                }, random, vitals);
                root.add(duel.root);
              }
              const partner = companion(world);
              const cutscene = id === 'ch6_summit' || id === 'ch3_pines'
                ? scenePresentation(id === 'ch6_summit' ? 'reunion' : null, root, world, player, partner) : undefined;
              return { root, data: { world, origin, player, companion: partner, collectibles,
                view: createLaterChapterCamera(world, id, {
                  root,
                  fighting: encounter => encounter === 'sword_wraith'
                    ? duel?.driver.phase === 'fighting' : combat?.state(encounter) === 'fighting',
                  look: () => ({
                    x: context.input.lookX, y: context.input.lookY,
                    ...(typeof progress.current.options.sensitivity === 'number' ? { sensitivity: progress.current.options.sensitivity } : {}),
                    invertY: progress.current.options.invertY === true,
                  }),
                }), killDrop, killY,
                checkpoints: createCheckpointInteraction(id, world, progress),
                ...(mechanisms ? { mechanisms } : {}), ...(duel ? { duel } : {}), ...(exit ? { exit } : {}),
                ...(iceHolds ? { iceHolds } : {}), ...(lateMechanisms ? { lateMechanisms } : {}),
                ...(combat ? { combat } : {}), ...(cutscene ? { cutscene } : {}) } };
            },
          });
          const manager = chapters;
          lifetime.defer(() => manager.dispose());
          await manager.switchTo(initialChapter, { signal: lifetime.signal });
        },
        update(delta, context) {
          void audioCues?.update();
          if (ended) return;
          const current = synchronize(context);
          const cutscene = current?.data.cutscene;
          if (cutscene?.active && (context.input.pause || context.input.menu.confirm || context.input.menu.back)) {
            cutscene.skip();
            context.input.reset();
            if (current) applyView(current.data, 0, context);
            return;
          }
          if (context.input.pause) {
            pauseTraversal(context, !context.paused);
            return;
          }
          if (context.paused) return;
          if (!current || !visual) return;
          const { player, companion, collectibles, story, mechanisms, duel, checkpoints, exit, iceHolds, lateMechanisms, combat,
            killDrop, killY = -Infinity } = current.data;
          cutscene?.trigger(delta, Boolean(progress.current.flags.ch6_duel));
          cutscene?.step(delta);
          if (cutscene?.active) {
            beats?.step(delta, { playing: true, sceneActive: true });
            if (story) current.data.updateLandmarks?.(delta, story.gatePhase);
            applyView(current.data, delta, context);
            return;
          }
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
          if (context.input.drink && !vitals.drinking && (!combatAction || combatAction === 'IDLE') &&
            !exit?.finishing && player.state.grounded && drinkStances.has(player.state.state)) {
            if (vitals.snapshot().drinks === 0) {
              context.registry.set('chapter.interaction', { type: 'hint', text: 'The gourd is dry. A lantern will refill it.', ms: 2600 });
            } else vitals.beginDrink(visual.duration('drink'));
          }
          if (!fell && !vitals.drinking && (!combatAction || combatAction === 'IDLE') && !exit?.finishing) {
            player.step(delta, context.input, steering);
          }
          const swordInput = {
            attack: context.input.attack, parry: context.input.parry, handsBusy: vitals.drinking !== null,
            swordAvailable: progress.current.abilities.sword === true,
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
          const dropped = fell || player.state.lastGroundY - player.state.y > killDrop || player.state.y < killY;
          if (dropped || defeated) {
            if (!defeated) vitals.hurt(1);
            respawn(current.data, context, vitals.strokes === 0);
            if (dropped && !defeated) context.registry.set('chapter.interaction', {
              type: 'hint', text: 'A fall costs one stroke. A lit lantern gives them back.', ms: 4200,
            });
          }
          vitals.step(delta);
          publishVitals(context);
          const action = courtActive || duel?.driver.player.clip ? duel?.driver.player : combat?.player;
          const drink = vitals.drinking;
          visual.update(action?.clip ? { ...player.state, heading: action.heading } : player.state, delta,
            action?.clip ? { clip: action.clip, frame: action.frame } : drink ? { clip: 'drink', frame: drink.elapsed * 24 } : undefined);
          const fighting = courtActive || combat?.fighting() === true;
          companion.update(delta, companionPlayer(player), context.input.cat && !fighting && !drink);
          catVisual?.update(companion.state, delta, Boolean(progress.current.flags.inkStep));
          const { phase, found } = companion.state;
          context.registry.set('companion.state', { phase, found });
          progress.tick(delta);
          story?.update(delta, player.state, { interact: context.input.interact && !drink });
          if (story) current.data.updateLandmarks?.(delta, story.gatePhase);
          if (checkpoints) {
            const shrine = checkpoints.nearest(player.state);
            const scroll = collectibles.nearestScroll(player.state);
            const distance = (target: { x: number; z: number }) => Math.hypot(target.x - player.state.x, target.z - player.state.z);
            const scrollFirst = scroll !== null && (shrine === null || distance(scroll) < distance(shrine));
            const prompt = scrollFirst ? scroll.prompt : shrine ? 'E  rest at the lantern' : null;
            if (interactionPrompt !== prompt) {
              interactionPrompt = prompt;
              context.registry.set('chapter.prompt', prompt);
            }
            if (context.input.interact && !drink && scrollFirst) {
              const collected = collectibles.collectScroll(player.state, progress);
              if (collected) {
                void audioCues?.play('scroll');
                publishVitals(context);
                context.registry.set('chapter.interaction', collected satisfies ChapterOneInteractionEvent);
              }
            } else if (context.input.interact && !drink && shrine && fighting) {
              context.registry.set('chapter.interaction', { type: 'hint', text: 'Not while they’re here.', ms: 2400 });
            } else if (checkpoints.update(player.state, context.input.interact && !drink, fighting)) {
              collectibles.sync(progress.current);
              publishVitals(context, true);
              void audioCues?.play('shrine');
              beats?.onShrine(player.state);
              context.registry.set('chapter.interaction', { type: 'hint', text: 'The lantern is lit.', ms: 3800 });
            }
          }
          if ((current.id !== 'ch6_summit' || cutscene?.complete) && exit?.update(delta, player.state, progress.current.flags)) {
            requestNextChapter(context, exit);
          }
          beats?.step(delta, { playing: true, sceneActive: cutscene?.active === true,
            subtitleActive: Boolean(context.registry.get('story.subtitle')), fighting, player: player.state,
            cat: { carried: phase === 'CARRIED', found, fighting, position: companion.state },
          });
          applyView(current.data, delta, context);
        },
        beforeRender(context) {
          const backdrop = (synchronize(context) ?? active)?.data.backdrop;
          background.enabled.value = backdrop !== undefined;
          if (!backdrop) return;
          const distant = background.camera;
          if (distant.aspect !== camera.aspect || distant.fov !== camera.fov) {
            distant.aspect = camera.aspect;
            distant.fov = camera.fov;
            distant.updateProjectionMatrix();
          }
          distant.position.copy(camera.position);
          distant.quaternion.copy(camera.quaternion);
          distant.updateMatrixWorld();
          backdrop.update(distant, context.time.t);
        },
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
    setPaused(paused: boolean) { if (!ended) pauseTraversal(runtime.context, paused); },
    restartFromCheckpoint() {
      const current = chapters?.current;
      if (!current || ended || switching || current.data.cutscene?.active) return;
      respawn(current.data, runtime.context, true);
      pauseTraversal(runtime.context, false);
      applyView(current.data, 0, runtime.context);
    },
    onInteraction(listener: (event: ChapterOneInteractionEvent) => void) {
      return runtime.context.registry.on('chapter.interaction', event => listener(event as ChapterOneInteractionEvent));
    },
  };
}
