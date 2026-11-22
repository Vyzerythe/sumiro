import { Box3, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Sphere } from 'three/webgpu';
import { disposeGLTF } from '../assets/asset-manager.mts';
import { createInkRenderGraph } from '../rendering/ink-render-graph.mts';
import { createSourceRuntime } from '../runtime/source-runtime.mts';

type RuntimeOptions = Parameters<typeof createSourceRuntime<AudioContext>>[0];

interface ChapterPreviewOptions extends Pick<RuntimeOptions, 'assets' | 'audio' | 'gpu' | 'viewport'> {
  canvas: HTMLCanvasElement | OffscreenCanvas;
}

export async function createChapterPreview({ canvas, ...options }: ChapterPreviewOptions) {
  const scene = new Scene();
  scene.background = new Color(0xc9c6bf);
  const camera = new PerspectiveCamera(42, options.viewport.width / options.viewport.height, 0.1, 1000);
  const sky = new HemisphereLight(0xf2eedc, 0x737385, 2.2);
  const sun = new DirectionalLight(0xfff0d6, 1.4);
  sun.position.set(-1, 2, 1);
  scene.add(sky, sun);
  const bounds = new Sphere();
  let framedAspect = 0;

  function frameChapter() {
    if (framedAspect === camera.aspect) return;
    framedAspect = camera.aspect;
    const radius = Math.max(0.01, bounds.radius);
    const verticalFov = camera.fov * Math.PI / 360;
    const horizontalFov = Math.atan(Math.tan(verticalFov) * camera.aspect);
    const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov));
    camera.position.set(0.8, 0.6, 1).normalize().multiplyScalar(distance).add(bounds.center);
    camera.near = Math.max(0.01, (distance - radius) / 2);
    camera.far = distance + radius * 3;
    camera.lookAt(bounds.center);
    camera.updateProjectionMatrix();
  }

  const runtime = await createSourceRuntime({
    ...options,
    graphics: { canvas, scene, camera, buildOutput: pass => createInkRenderGraph(pass, camera) },
    systems: {
      './chapter-geometry.mts': async () => ({
        async init(context, lifetime) {
          const model = await context.assets.loadGLTF('levels/ch1_climb/pieces.glb', {
            displaySpace: false, signal: lifetime.signal,
          });
          lifetime.defer(() => disposeGLTF(model));
          lifetime.signal.throwIfAborted();
          const box = new Box3().setFromObject(model.scene);
          if (box.isEmpty()) throw Error('Chapter geometry contains no bounded meshes');
          box.getBoundingSphere(bounds);
          lifetime.ownRoot(model.scene);
          frameChapter();
        },
        beforeRender: frameChapter,
      }),
    },
  });

  const failure = runtime.report().find(system => system.failed);
  if (failure) {
    await runtime.dispose();
    throw Error(`Chapter geometry could not start (${failure.failed})`, { cause: failure.error });
  }
  return runtime;
}
