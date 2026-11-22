import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, HemisphereLight, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Scene } from 'three/webgpu';
import { createRunProgress } from '../domain/run-progress.mts';
import { installGroundAsset } from '../physics/ground-asset.mts';
import { createCollisionWorld, type CollisionSurface, type CollisionTriangle } from '../physics/world.mts';
import { loadAnimatedPlayer, type AnimatedPlayer } from '../player/animated-player.mts';
import { createTraversalController } from '../player/traversal-controller.mts';
import { createFollowCamera } from '../rendering/follow-camera.mts';
import { bindInkMeshMaterials } from '../rendering/ink-mesh-materials.mts';
import { createInkRenderGraph } from '../rendering/ink-render-graph.mts';
import { createInkSurfaceOutput } from '../rendering/ink-surface-pass.mts';
import { createSourceRuntime } from '../runtime/source-runtime.mts';
import { resolveChapterOneSpawn } from './chapter-one-checkpoints.mts';
import { createChapterOneInteractions, type ChapterOneInteractionEvent } from './chapter-one-interactions.mts';
import { chapterOneLedges, chapterOneLeapLinks } from './chapter-one-ledges.mts';
import { chapterOneGateBarrier, installChapterOneObstacles } from './chapter-one-obstacles.mts';
import { chapterOneGroundRegions } from './chapter-one-terrain.mts';
import { chapterOneCameraAreas, chapterOneRail } from './chapter-one-rail.mts';

const SURFACE_COLORS: Readonly<Record<string, number>> = {
  stone: 0x858582, wood: 0x937053, stair: 0x6d797d, rock: 0xa9a191, 'ink-rock': 0x56656b,
};

type RuntimeOptions = Parameters<typeof createSourceRuntime<AudioContext>>[0];
interface TraversalPreviewOptions extends Pick<RuntimeOptions, 'assets' | 'gpu' | 'input' | 'viewport'> {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  resume?: NonNullable<Parameters<typeof resolveChapterOneSpawn>[0]>;
  progress?: ReturnType<typeof createRunProgress>;
}

/** Isolated collision preview for the authored Chapter One terrain. */
export async function createTraversalPreview({ canvas, resume, progress = createRunProgress({ getItem: () => null }),
  ...options }: TraversalPreviewOptions) {
  const spawn = resolveChapterOneSpawn(resume ?? (progress.hasSave ? progress.current : undefined));
  const scene = new Scene();
  scene.background = new Color(0xc9c6bf);
  scene.add(new HemisphereLight(0xfff1dc, 0x777571, 2.5));
  const camera = new PerspectiveCamera(52, options.viewport.width / options.viewport.height, 0.1, 100);
  let player: ReturnType<typeof createTraversalController> | undefined;
  let visual: AnimatedPlayer | undefined;
  let story: ReturnType<typeof createChapterOneInteractions> | undefined;
  let cameraRig: ReturnType<typeof createFollowCamera> | undefined;
  let steering: { railYaw: number; zone: string } | null = null;
  let teleport = 0;
  let railFrame = 0;
  let leapStartFrame = 0;
  let lastTraversalState = 'IDLE';

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
          cameraRig = createFollowCamera({ rail: chapterOneRail, world, wayUpAreas: chapterOneCameraAreas });
          const actor = await loadAnimatedPlayer(context.assets, { signal: lifetime.signal });
          lifetime.defer(() => actor.dispose());
          lifetime.signal.throwIfAborted();
          lifetime.defer(bindInkMeshMaterials(actor.root, { preset: 'cloth' }));
          lifetime.ownRoot(actor.root);
          visual = actor;
          player = createTraversalController(world, spawn, {
            ledges: chapterOneLedges, leapLinks: chapterOneLeapLinks, duration: actor.duration,
            canInkStep: () => progress.current.abilities.inkStep === true,
          });
          story = createChapterOneInteractions({
            groundHeightAt: (x, z) => world.groundAt(x, z)?.y ?? null,
            checkpoint: id => { progress.checkpoint(id); },
            collectScroll: id => { progress.collectScroll(id); },
            learnInkStep: () => { progress.learnInkStep(); },
            setGateBarrier: enabled => world.setGroup(chapterOneGateBarrier, enabled),
            onEvent: event => { context.registry.set('chapter.interaction', event); },
          });
          story.enter(progress.current);
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
          if (!player || !cameraRig || !visual || !story) return;
          player.step(delta, context.input, steering);
          if (player.state.lastGroundY - player.state.y > 5.5) {
            player.reset();
            teleport++;
            visual.reset(player.state);
          }
          visual.update(player.state, delta);
          progress.tick(delta);
          story.update(delta, player.state, { interact: context.input.interact });
          const { x, y, z, grounded, state, speed, lastGroundY, leap, ledge, stateT } = player.state;
          let frameTarget: number | undefined;
          if (state === 'LEAP' && leap?.link.camera && 'toF' in leap.link.camera) {
            if (lastTraversalState !== 'LEAP') leapStartFrame = railFrame;
            const progress = Math.min(stateT / leap.time, 1);
            frameTarget = leapStartFrame + (leap.link.camera.toF - leapStartFrame) * progress;
          } else if (ledge?.id === 'rim_front' || ledge?.id === 'crack') {
            const climb = state === 'CLIMB' ? Math.min(stateT / visual.duration('climb_up'), 1) : 0;
            frameTarget = 228 + 30 * climb;
          }
          const pose = cameraRig.update({ feet: player.state, deltaSeconds: delta, speed, teleport,
            movement: { grounded, groundY: lastGroundY }, ...(frameTarget === undefined ? {} : { frameTarget }) });
          lastTraversalState = state;
          railFrame = pose.railFrame;
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
  return {
    ...runtime,
    onInteraction(listener: (event: ChapterOneInteractionEvent) => void) {
      return runtime.context.registry.on('chapter.interaction', event => listener(event as ChapterOneInteractionEvent));
    },
  };
}
