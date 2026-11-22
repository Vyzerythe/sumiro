import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, HemisphereLight, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Scene } from 'three/webgpu';
import { installGroundAsset } from '../physics/ground-asset.mts';
import { createCollisionWorld, type CollisionSurface, type CollisionTriangle } from '../physics/world.mts';
import { loadAnimatedPlayer, type AnimatedPlayer } from '../player/animated-player.mts';
import { createTraversalController } from '../player/traversal-controller.mts';
import { createFollowCamera } from '../rendering/follow-camera.mts';
import { createInkRenderGraph } from '../rendering/ink-render-graph.mts';
import { createInkSurfaceOutput } from '../rendering/ink-surface-pass.mts';
import { createSourceRuntime } from '../runtime/source-runtime.mts';
import { resolveChapterOneSpawn } from './chapter-one-checkpoints.mts';
import { installChapterOneObstacles } from './chapter-one-obstacles.mts';
import { chapterOneGroundRegions } from './chapter-one-terrain.mts';
import { chapterOneCameraAreas, chapterOneRail } from './chapter-one-rail.mts';

const SURFACE_COLORS: Readonly<Record<string, number>> = {
  stone: 0x858582, wood: 0x937053, stair: 0x6d797d, rock: 0xa9a191, 'ink-rock': 0x56656b,
};

type RuntimeOptions = Parameters<typeof createSourceRuntime<AudioContext>>[0];
interface TraversalPreviewOptions extends Pick<RuntimeOptions, 'assets' | 'gpu' | 'input' | 'viewport'> {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  resume?: NonNullable<Parameters<typeof resolveChapterOneSpawn>[0]>;
}

/** Isolated collision preview for the authored Chapter One terrain. */
export async function createTraversalPreview({ canvas, resume, ...options }: TraversalPreviewOptions) {
  const spawn = resolveChapterOneSpawn(resume);
  const scene = new Scene();
  scene.background = new Color(0xc9c6bf);
  scene.add(new HemisphereLight(0xfff1dc, 0x777571, 2.5));
  const camera = new PerspectiveCamera(52, options.viewport.width / options.viewport.height, 0.1, 100);
  let player: ReturnType<typeof createTraversalController> | undefined;
  let visual: AnimatedPlayer | undefined;
  let cameraRig: ReturnType<typeof createFollowCamera> | undefined;
  let steering: { railYaw: number; zone: string } | null = null;
  let teleport = 0;

  const runtime = await createSourceRuntime({
    ...options,
    graphics: { canvas, scene, camera, buildOutput: pass => createInkRenderGraph(pass, camera) },
    systems: {
      './ground-traversal.mts': async () => ({
        async init(context, lifetime) {
          const bytes = await context.assets.loadArrayBuffer('levels/ch1_climb/ground.bin', { signal: lifetime.signal });
          const world = createCollisionWorld();
          const ground = installGroundAsset(world, bytes, chapterOneGroundRegions);
          installChapterOneObstacles(world, ground);
          player = createTraversalController(world, spawn);
          cameraRig = createFollowCamera({ rail: chapterOneRail, world, wayUpAreas: chapterOneCameraAreas });
          const actor = await loadAnimatedPlayer(context.assets, { signal: lifetime.signal });
          lifetime.defer(() => actor.dispose());
          lifetime.signal.throwIfAborted();
          lifetime.ownRoot(actor.root);
          visual = actor;
          const surfaceVertices = new Map<CollisionSurface, CollisionTriangle[]>();
          for (const triangle of world.triangles()) {
            if (triangle.kind !== 1) continue;
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
        },
        update(delta, context) {
          if (!player || !cameraRig || !visual) return;
          player.step(delta, context.input, steering);
          if (player.state.lastGroundY - player.state.y > 5.5) {
            player.reset();
            teleport++;
            visual.reset(player.state);
          }
          visual.update(player.state, delta);
          const { x, y, z, grounded, state, speed, lastGroundY } = player.state;
          const pose = cameraRig.update({ feet: player.state, deltaSeconds: delta, speed, teleport,
            movement: { grounded, groundY: lastGroundY } });
          steering = { railYaw: pose.yaw, zone: pose.zone };
          camera.position.set(pose.x, pose.y, pose.z);
          const degreesToRadians = Math.PI / 180;
          camera.rotation.set(pose.pitch * degreesToRadians, pose.yaw * degreesToRadians, 0);
          context.registry.set('player.position', { x, y, z, grounded, state });
          context.registry.set('camera.railFrame', pose.railFrame);
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
