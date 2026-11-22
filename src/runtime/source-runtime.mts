import { PerspectiveCamera, type Camera, type Object3D, type Scene } from 'three/webgpu';
import { createAssetManager, type AssetManager, type AssetManagerOptions } from '../assets/asset-manager.mts';
import { createAudioMixer, type AudioMixer, type AudioMixerContext, type AudioMixerOptions, type AudioVolumes } from '../audio/audio-mixer.mts';
import { createInputManager, type InputManager, type InputManagerOptions } from '../input/input-manager.mts';
import { createWebGpuSurface } from '../rendering/webgpu-renderer.mts';
import { FixedStepClock, SimulationTimeReader } from './fixed-step-clock.mts';
import { startLiveLoop } from './live-loop.mts';
import { RuntimeRegistry } from './registry.mts';
import { createSystemHost, type RuntimeSystem } from './system-host.mts';

interface Viewport {
  width: number;
  height: number;
  pixelRatio: number;
}

interface RuntimeValues extends Record<string, unknown> {
  'game.options': Partial<AudioVolumes>;
  'game.paused': boolean;
  'audio.duck': boolean;
}

export interface SourceRuntimeContext<AudioContextType extends AudioMixerContext = AudioContext> {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly assets: AssetManager;
  readonly audio: AudioMixer<AudioContextType> | null;
  readonly input: InputManager;
  readonly registry: RuntimeRegistry<RuntimeValues>;
  readonly time: FixedStepClock;
  readonly clock: SimulationTimeReader;
  readonly view: Readonly<Viewport & { drawWidth: number; drawHeight: number; pxScale: number }>;
  paused: boolean;
}

type SourceSystem<Context> = RuntimeSystem<Object3D, Context>;
type SourceSystemLoader<Context> = () => Promise<SourceSystem<Context> | { default: SourceSystem<Context> }>;
type Surface = Awaited<ReturnType<typeof createWebGpuSurface>>;

interface SourceRuntimeOptions<AudioContextType extends AudioMixerContext> {
  graphics: Parameters<typeof createWebGpuSurface>[0];
  assets: AssetManagerOptions;
  audio?: AudioMixerOptions<AudioContextType>;
  input?: InputManagerOptions;
  systems: Record<string, SourceSystemLoader<SourceRuntimeContext<AudioContextType>>>;
  viewport: Viewport;
  only?: readonly string[];
  simulationHz?: number;
  videoFps?: number;
  referenceHeight?: number;
  initializeTimeoutMs?: number;
  canSubmitFrame?: () => boolean;
  gpu?: Parameters<typeof createWebGpuSurface>[1];
  frames?: Parameters<typeof startLiveLoop>[1];
}

/** Owns subsystem lifetime, asset loading, and native rendering for one source session. */
export async function createSourceRuntime<AudioContextType extends AudioMixerContext = AudioContext>({
  graphics, assets: assetOptions, audio: audioOptions, input: inputOptions, systems, viewport, only,
  simulationHz = 60, videoFps = 24, referenceHeight = 704, initializeTimeoutMs = 120_000,
  canSubmitFrame = () => true, gpu, frames,
}: SourceRuntimeOptions<AudioContextType>) {
  if (!Number.isFinite(referenceHeight) || referenceHeight <= 0) throw RangeError('Reference height must be positive');
  const time = new FixedStepClock(simulationHz, videoFps);
  const assets = createAssetManager(assetOptions);
  const input = createInputManager(inputOptions);
  const audio = audioOptions ? createAudioMixer(audioOptions) : null;
  const registry = new RuntimeRegistry<RuntimeValues>();
  const detachAudio = audio ? [registry.on('game.options', audio.setVolumes), registry.on('audio.duck', audio.setDucked)] : [];
  const view = { ...viewport, drawWidth: 0, drawHeight: 0, pxScale: 1 };
  const context: SourceRuntimeContext<AudioContextType> = {
    scene: graphics.scene, camera: graphics.camera, assets, audio, input,
    registry, time, clock: new SimulationTimeReader(time),
    view, paused: false,
  };

  let host: ReturnType<typeof createSystemHost<Object3D, typeof context>> | undefined;
  let surface: Surface | undefined;
  let loop: ReturnType<typeof startLiveLoop> | undefined;
  let disposal: Promise<void> | undefined;

  function stop() {
    loop?.stop();
    loop = undefined;
  }

  async function release() {
    const failures: unknown[] = [];
    for (const cleanup of [
      () => host?.dispose(),
      () => { for (const detach of detachAudio) detach(); },
      () => audio?.dispose(),
      () => input.dispose(),
      () => assets.dispose(),
      () => surface?.dispose(),
    ]) {
      try { await cleanup(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Source runtime cleanup failed');
  }

  function dispose() {
    disposal ??= Promise.resolve().then(release);
    stop();
    return disposal;
  }

  function applyViewport(target: Surface, width: number, height: number, pixelRatio: number) {
    target.resize(width, height, pixelRatio);
    const drawWidth = Math.floor(width * pixelRatio);
    const drawHeight = Math.floor(height * pixelRatio);
    Object.assign(view, { width, height, pixelRatio, drawWidth, drawHeight, pxScale: drawHeight / referenceHeight });
    if (context.camera instanceof PerspectiveCamera) {
      context.camera.aspect = width / height;
      context.camera.updateProjectionMatrix();
    }
  }

  function updateSystems(target: NonNullable<typeof host>, elapsed: number, paused: boolean) {
    try {
      input.beginStep(time.t, elapsed);
      target.update(elapsed, paused);
    } finally {
      input.endStep();
    }
  }

  try {
    host = createSystemHost<Object3D, typeof context>(context, {
      defaultBudgetMs: 1.5,
      initializeTimeoutMs,
    });
    surface = await createWebGpuSurface(graphics, gpu);
    applyViewport(surface, viewport.width, viewport.height, viewport.pixelRatio);
    await host.load(systems, only);
    await assets.whenIdle();
    updateSystems(host, 0, context.paused);
    time.dt = time.fixedDt;
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Runtime startup and cleanup both failed');
    }
    throw error;
  }

  const activeHost = host;
  const activeSurface = surface;
  function assertActive() {
    if (disposal) throw Error('Source runtime is disposed');
  }

  function step() {
    assertActive();
    const paused = context.paused;
    if (!paused) time.advance();
    updateSystems(activeHost, time.fixedDt, paused);
  }

  function render(alpha = 1) {
    assertActive();
    time.alpha = context.paused ? 1 : alpha;
    activeHost.beforeRender();
    activeSurface.render();
  }

  return {
    backend: activeSurface.backend,
    context,
    start() {
      assertActive();
      loop ??= startLiveLoop({
        fixedDt: time.fixedDt, maxFrameDt: 0.1, maxStepsPerFrame: 5,
        isPaused: () => context.paused, canSubmitFrame, step, render,
      }, frames);
    },
    stop,
    step,
    render,
    resize(width: number, height: number, pixelRatio: number) {
      assertActive();
      applyViewport(activeSurface, width, height, pixelRatio);
      loop?.invalidate();
    },
    setResolutionScale(scale: number) {
      assertActive();
      activeSurface.setResolutionScale(scale);
      loop?.invalidate();
    },
    setChapter(chapter: string) {
      assertActive();
      activeHost.setChapter(chapter);
      loop?.invalidate();
    },
    report: activeHost.report,
    dispose,
  };
}
