import {
  RenderPipeline, WebGPUBackend, WebGPURenderer,
  type Camera, type Node, type PassNode, type Scene,
} from 'three/webgpu';
import { pass } from 'three/tsl';

export interface WebGpuOutputGraph {
  readonly outputNode: Node;
  setResolutionScale(scale: number): void;
  dispose(): void;
}

type BuildOutput = (scenePass: PassNode) => Node | WebGpuOutputGraph;

interface WebGpuSurfaceOptions {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  scene: Scene;
  camera: Camera;
  buildOutput?: BuildOutput;
  powerPreference?: GPUPowerPreference;
  deviceDescriptor?: GPUDeviceDescriptor;
}

/** Owns the scene pass, final pipeline, and any graph returned by buildOutput. */
export function createWebGpuPipeline(
  renderer: WebGPURenderer, scene: Scene, camera: Camera,
  buildOutput: BuildOutput = scenePass => scenePass.getTextureNode(),
) {
  const scenePass = pass(scene, camera);
  let pipeline: RenderPipeline;
  let graph: WebGpuOutputGraph | undefined;
  try {
    const output = buildOutput(scenePass);
    const outputNode = 'outputNode' in output ? (graph = output).outputNode : output;
    pipeline = new RenderPipeline(renderer, outputNode);
  } catch (error) {
    try { graph?.dispose(); } finally { scenePass.dispose(); }
    throw error;
  }

  let disposed = false;
  function assertActive() {
    if (disposed) throw Error('WebGPU render pipeline is disposed');
  }

  return {
    get outputNode() {
      return pipeline.outputNode;
    },
    setResolutionScale(scale: number) {
      assertActive();
      if (!Number.isFinite(scale) || scale <= 0) throw RangeError('Resolution scale must be positive and finite');
      scenePass.setResolutionScale(scale);
      graph?.setResolutionScale(scale);
    },
    render() {
      assertActive();
      pipeline.render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        pipeline.dispose();
      } finally {
        try { graph?.dispose(); } finally { scenePass.dispose(); }
      }
    },
  };
}

/** Creates a native WebGPU surface for an unconfigured, caller-owned canvas. */
export async function createWebGpuSurface(
  { canvas, scene, camera, buildOutput, powerPreference = 'high-performance', deviceDescriptor }: WebGpuSurfaceOptions,
  gpu: Pick<GPU, 'requestAdapter'> | undefined = globalThis.navigator?.gpu,
) {
  if (!gpu) throw Error('WebGPU is unavailable in this environment');
  const adapter = await gpu.requestAdapter({ powerPreference });
  if (!adapter) throw Error('No suitable WebGPU adapter was found');
  const device = await adapter.requestDevice(deviceDescriptor);

  let loss: GPUDeviceLostInfo | null = null;
  void device.lost.then(info => { loss = info; });
  let context: GPUCanvasContext | undefined;
  let renderer: WebGPURenderer | undefined;
  let pipeline: ReturnType<typeof createWebGpuPipeline>;

  async function releaseRenderer() {
    try {
      if (renderer?.hasInitialized()) await renderer.dispose();
    } finally {
      try {
        context?.unconfigure();
      } finally {
        device.destroy();
      }
    }
  }

  try {
    const canvasContext = canvas.getContext('webgpu');
    if (!canvasContext || !('unconfigure' in canvasContext)) {
      throw Error('Could not get a WebGPU context from the canvas');
    }
    context = canvasContext;
    renderer = new WebGPURenderer({ canvas, context, device, alpha: false });
    await renderer.init();
    if (!(renderer.backend instanceof WebGPUBackend)) throw Error('Three.js did not initialize a native WebGPU backend');
    if (loss) throw Error('The WebGPU device was lost during initialization', { cause: loss });
    pipeline = createWebGpuPipeline(renderer, scene, camera, buildOutput);
  } catch (error) {
    try {
      await releaseRenderer();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'WebGPU initialization and cleanup both failed');
    }
    throw error;
  }

  const activeRenderer = renderer;
  let disposePromise: Promise<void> | undefined;
  function assertActive() {
    if (disposePromise) throw Error('WebGPU render surface is disposed');
    if (loss) throw Error('The WebGPU device was lost', { cause: loss });
  }

  async function release() {
    try {
      pipeline.dispose();
    } finally {
      await releaseRenderer();
    }
  }

  return {
    backend: 'webgpu' as const,
    resize(width: number, height: number, pixelRatio: number) {
      assertActive();
      if (![width, height, pixelRatio].every(value => Number.isFinite(value) && value > 0)) {
        throw RangeError('Width, height, and pixel ratio must be positive and finite');
      }
      const limit = device.limits.maxTextureDimension2D;
      const dimensions = [Math.floor(width * pixelRatio), Math.floor(height * pixelRatio)];
      if (dimensions.some(dimension => dimension < 1 || dimension > limit)) {
        throw RangeError('Drawing buffer dimensions exceed the WebGPU device limits');
      }
      activeRenderer.setDrawingBufferSize(width, height, pixelRatio);
    },
    setResolutionScale(scale: number) {
      assertActive();
      pipeline.setResolutionScale(scale);
    },
    render() {
      assertActive();
      pipeline.render();
    },
    dispose() {
      disposePromise ??= Promise.resolve().then(release);
      return disposePromise;
    },
  };
}
