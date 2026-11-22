import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import type { CollisionSurface, CollisionTriangle, CollisionWorld } from '../physics/world.mts';
import { createInkSurfaceOutput } from '../rendering/ink-surface-pass.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';

const ROCK_COLOR = 0xa9a191;
const SURFACE_COLORS: Readonly<Record<string, number>> = {
  stone: 0x858582, wood: 0x937053, stair: 0x6d797d, rock: ROCK_COLOR, 'ink-rock': 0x56656b,
};

/** Former development terrain view, superseded by the authored Chapter One environment. */
export function createCollisionSurfacePreview(world: CollisionWorld, lifetime: ChapterLifetime) {
  const terrain = new Group();
  const batches = new Map<CollisionSurface, CollisionTriangle[]>();
  for (const triangle of world.triangles()) {
    if (triangle.kind !== 1) continue;
    let batch = batches.get(triangle.surface);
    if (!batch) batches.set(triangle.surface, batch = []);
    batch.push(triangle);
  }
  for (const [surface, triangles] of batches) {
    const vertices = new Float32Array(triangles.length * 9);
    triangles.forEach((triangle, index) => vertices.set(triangle, index * 9));
    const geometry = new BufferGeometry();
    lifetime.defer(() => geometry.dispose());
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const material = new MeshBasicNodeMaterial({
      color: SURFACE_COLORS[String(surface)] ?? ROCK_COLOR, side: DoubleSide,
    });
    lifetime.defer(() => material.dispose());
    material.mrtNode = createInkSurfaceOutput({ lineWeight: 0.35 });
    terrain.add(new Mesh(geometry, material));
  }
  return terrain;
}
