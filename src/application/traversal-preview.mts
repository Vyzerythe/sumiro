import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Scene } from 'three/webgpu';
import { installGroundAsset } from '../physics/ground-asset.mts';
import { createCollisionWorld, type CollisionSurface, type CollisionTriangle } from '../physics/world.mts';
import { createGroundTraversal } from '../player/ground-traversal.mts';
import { createInkRenderGraph } from '../rendering/ink-render-graph.mts';
import { createInkSurfaceOutput } from '../rendering/ink-surface-pass.mts';
import { createSourceRuntime } from '../runtime/source-runtime.mts';
import { chapterOneGroundRegions, chapterOneSpawn } from './chapter-one-terrain.mts';

const SURFACE_COLORS: Readonly<Record<string, number>> = {
  stone: 0x858582, wood: 0x937053, stair: 0x6d797d, rock: 0xa9a191, 'ink-rock': 0x56656b,
};

type RuntimeOptions = Parameters<typeof createSourceRuntime<AudioContext>>[0];
interface TraversalPreviewOptions extends Pick<RuntimeOptions, 'assets' | 'gpu' | 'input' | 'viewport'> {
  canvas: HTMLCanvasElement | OffscreenCanvas;
}

/** Isolated grounded collision preview for the authored Chapter One terrain. */
export async function createTraversalPreview({ canvas, ...options }: TraversalPreviewOptions) {
  const scene = new Scene();
  scene.background = new Color(0xc9c6bf);
  const camera = new PerspectiveCamera(52, options.viewport.width / options.viewport.height, 0.1, 100);
  let player: ReturnType<typeof createGroundTraversal> | undefined;

  function positionCamera() {
    if (!player) return;
    const { x, y, z } = player.state;
    camera.position.set(x, y + 1.65, z);
    camera.lookAt(x, y + 0.7, z - 5);
  }

  const runtime = await createSourceRuntime({
    ...options,
    graphics: { canvas, scene, camera, buildOutput: pass => createInkRenderGraph(pass, camera) },
    systems: {
      './ground-traversal.mts': async () => ({
        async init(context, lifetime) {
          const bytes = await context.assets.loadArrayBuffer('levels/ch1_climb/ground.bin', { signal: lifetime.signal });
          const world = createCollisionWorld();
          installGroundAsset(world, bytes, chapterOneGroundRegions);
          player = createGroundTraversal(world, chapterOneSpawn);
          const surfaceVertices = new Map<CollisionSurface, CollisionTriangle[]>();
          for (const triangle of world.triangles()) {
            let batch = surfaceVertices.get(triangle.surface);
            if (!batch) surfaceVertices.set(triangle.surface, batch = []);
            batch.push(triangle);
          }
          const terrain = lifetime.ownRoot(new Group());
          for (const [surface, triangles] of surfaceVertices) {
            const vertices = new Float32Array(triangles.length * 9);
            triangles.forEach((triangle, index) => vertices.set(triangle, index * 9));
            const geometry = new BufferGeometry();
            lifetime.defer(() => geometry.dispose());
            geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
            geometry.computeVertexNormals();
            const material = new MeshBasicNodeMaterial({
              color: SURFACE_COLORS[String(surface)] ?? SURFACE_COLORS.rock!, side: DoubleSide,
            });
            lifetime.defer(() => material.dispose());
            material.mrtNode = createInkSurfaceOutput({ lineWeight: 0.35 });
            terrain.add(new Mesh(geometry, material));
          }
          positionCamera();
        },
        update(delta, context) {
          if (!player) return;
          player.step(delta, context.input, null);
          const { x, y, z, grounded, state } = player.state;
          context.registry.set('player.position', { x, y, z, grounded, state });
          positionCamera();
        },
      }),
    },
  });
  const failure = runtime.report().find(system => system.failed);
  if (failure) {
    await runtime.dispose();
    throw Error(`Traversal preview could not start (${failure.failed})`, { cause: failure.error });
  }
  return runtime;
}
