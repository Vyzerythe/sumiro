import { PerspectiveCamera, type Camera, type Object3D, type Scene } from 'three/webgpu';
import { createAssetManager, type AssetManager, type AssetManagerOptions } from '../assets/asset-manager.mts';
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

export interface SourceRuntimeContext {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly assets: AssetManager;
  readonly registry: RuntimeRegistry;
  readonly time: FixedStepClock;
  readonly clock: SimulationTimeReader;
  readonly view: Readonly<Viewport & { drawWidth: number; drawHeight: number; pxScale: number }>;
  paused: boolean;
}

type SourceSystem = RuntimeSystem<Object3D, SourceRuntimeContext>;
type SourceSystemLoader = () => Promise<SourceSystem | { default: SourceSystem }>;
type Surface = Awaited<ReturnType<typeof createWebGpuSurface>>;

interface SourceRuntimeOptions {
  graphics: Parameters<typeof createWebGpuSurface>[0];
  assets: AssetManagerOptions;
  systems: Record<string, SourceSystemLoader>;
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
export async function createSourceRuntime({
  graphics, assets: assetOptions, systems, viewport, only,
  simulationHz = 60, videoFps = 24, referenceHeight = 704, initializeTimeoutMs = 120_000,
  canSubmitFrame = () => true, gpu, frames,
}: SourceRuntimeOptions) {
  if (!Number.isFinite(referenceHeight) || referenceHeight <= 0) throw RangeError('Reference height must be positive');
  const time = new FixedStepClock(simulationHz, videoFps);
  const assets = createAssetManager(assetOptions);
  const view = { ...viewport, drawWidth: 0, drawHeight: 0, pxScale: 1 };
  const context: SourceRuntimeContext = {
    scene: graphics.scene, camera: graphics.camera, assets,
    registry: new RuntimeRegistry(), time, clock: new SimulationTimeReader(time),
    view, paused: false,
  };

  let host: ReturnType<typeof createSystemHost<Object3D, SourceRuntimeContext>> | undefined;
  let surface: Surface | undefined;
  let loop: ReturnType<typeof startLiveLoop> | undefined;
  let disposal: Promise<void> | undefined;

  function stop() {
    loop?.stop();
    loop = undefined;
  }

  async function release() {
    try {
      host?.dispose();
    } finally {
      try {
        assets.dispose();
      } finally {
        await surface?.dispose();
      }
    }
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

  try {
    host = createSystemHost<Object3D, SourceRuntimeContext>(context, {
      defaultBudgetMs: 1.5,
      initializeTimeoutMs,
    });
    surface = await createWebGpuSurface(graphics, gpu);
    applyViewport(surface, viewport.width, viewport.height, viewport.pixelRatio);
    await host.load(systems, only);
    await assets.whenIdle();
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
    activeHost.update(time.fixedDt, paused);
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
