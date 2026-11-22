import { extrudeWallPolyline } from '../physics/geometry.mts';
import type { PointXZ } from '../physics/geometry.mts';
import { sampleGroundEdgeHeight } from '../physics/ground-asset.mts';
import type { GroundAsset } from '../physics/ground-asset.mts';
import type { CollisionWorld } from '../physics/world.mts';
import { chapterOneGroundRegions } from './chapter-one-terrain.mts';

interface ChapterOneEdge {
  readonly id: string;
  readonly kind: 'wall' | 'guard' | 'sight';
  readonly pts: readonly PointXZ[];
  readonly from?: number;
  readonly to?: number;
  readonly height?: number;
  readonly camera?: boolean;
  readonly group?: string;
  readonly fades?: string;
  readonly round?: boolean;
}

type ObstacleWorld = Pick<CollisionWorld, 'addTriangles' | 'groundAt'>;

export const chapterOneGateBarrier = 'gate_barrier';

// The authored climb polygon concatenates left path, bridge and stairs, the pad,
// then right stairs, bridge and path in reverse. Adjacent pad edges share endpoints.
const climb = chapterOneGroundRegions[0].poly;
const pathLeft = climb.slice(0, 22);
const bridgeLeft = climb.slice(22, 31);
const stairsLeft = climb.slice(31, 44);
const padWest = climb.slice(44, 55);
const padEast = climb.slice(54, 59);
const padSouth = climb.slice(58, 60).reverse();
const stairsRight = climb.slice(60, 73).reverse();
const bridgeRight = climb.slice(73, 82).reverse();
const pathRight = climb.slice(82).reverse();

// Gate-local transform from the published Chapter One layout module.
const gateYaw = Math.PI / 180 * -45.4;
const gateCosine = Math.cos(gateYaw);
const gateSine = Math.sin(gateYaw);

function gatePoint(x: number, z: number): PointXZ {
  return [14.23 + x * gateCosine + z * gateSine, -61.255 - x * gateSine + z * gateCosine];
}

function gateWall(from: number, to: number): PointXZ[] {
  return [gatePoint(from, 0.4), gatePoint(to, 0.4)];
}

function gatePlinth(x: number): PointXZ[] {
  const corners: PointXZ[] = [[-0.72, -0.72], [0.72, -0.72], [0.72, 0.72], [-0.72, 0.72], [-0.72, -0.72]];
  return corners.map(([dx, z]) => gatePoint(x + dx, z));
}

function circle(x: number, z: number, radius: number, sides: number): PointXZ[] {
  return Array.from({ length: sides + 1 }, (_, index) => [
    x + Math.cos(index / sides * Math.PI * 2) * radius,
    z + Math.sin(index / sides * Math.PI * 2) * radius,
  ]);
}

function gateColumn(x: number): PointXZ[] {
  return circle(...gatePoint(x, 0), 0.34, 8);
}

export const chapterOneEdges: readonly ChapterOneEdge[] = [
  { id: 'start', kind: 'wall', pts: [climb[0], climb[103]], height: 5 },
  { id: 'path_left', kind: 'guard', pts: pathLeft },
  { id: 'path_right', kind: 'wall', pts: pathRight, height: 12, camera: true },
  { id: 'bridge_left', kind: 'wall', pts: [climb[21], ...bridgeLeft, climb[31]], height: 4 },
  { id: 'bridge_right', kind: 'wall', pts: [climb[82], ...bridgeRight, climb[72]], height: 4 },
  { id: 'stairs_left', kind: 'guard', pts: stairsLeft },
  { id: 'stairs_right', kind: 'wall', pts: stairsRight, height: 12 },
  { id: 'pad_west', kind: 'guard', pts: [climb[43], ...padWest] },
  { id: 'pad_south', kind: 'wall', pts: [climb[60], ...padSouth], height: 5 },
  { id: 'pad_east', kind: 'wall', pts: padEast, from: 4.22, to: 5.5 },
  { id: 'pad_corner', kind: 'wall', pts: padEast.slice(-2), height: 5 },
  { id: 'shelf_north', kind: 'guard', pts: [[5.06, -44.3], [5.2, -45.85], [10.3, -45.85]] },
  { id: 'shelf_east', kind: 'wall', pts: [[10.3, -45.85], [10.3, -43.1]], height: 5 },
  { id: 'boulder', kind: 'wall', pts: [[10.3, -43.1], [8.9, -43.3], [8, -42.3], [7.5, -41.1]],
    from: 3.5, to: 6.9, camera: true, fades: 'field' },
  { id: 'shelf_south', kind: 'wall', pts: [[7.5, -41.1], [4.2, -41.04]], height: 5 },
  { id: 'rim', kind: 'guard', pts: chapterOneGroundRegions[2].poly },
  { id: 'gate_west', kind: 'wall', pts: gateWall(-8.5, -3.04), height: 6 },
  { id: 'gate', kind: 'wall', group: chapterOneGateBarrier, pts: gateWall(-3.04, 3.04), height: 6 },
  { id: 'gate_east', kind: 'wall', pts: gateWall(3.04, 9.5), height: 6 },
  { id: 'plinth_west', kind: 'wall', pts: gatePlinth(-3.04), height: 6.5 },
  { id: 'plinth_east', kind: 'wall', pts: gatePlinth(3.04), height: 6.5 },
  { id: 'column_west', kind: 'sight', pts: gateColumn(-3.04), height: 9, fades: 'gate_columns' },
  { id: 'column_east', kind: 'sight', pts: gateColumn(3.04), height: 9, fades: 'gate_columns' },
  { id: 'hero_pine', kind: 'wall', pts: circle(9.35, -63.8, 1.25, 8), height: 5 },
  { id: 'pine_gate', kind: 'wall', pts: [[10.45, -63.3], [11.3, -63.3]], height: 5 },
  { id: 'curb_a', kind: 'wall', pts: circle(-1.47, -39.56, 0.6, 8), height: 1.2, round: true },
  { id: 'curb_b', kind: 'wall', pts: circle(-0.69, -40.71, 0.42, 8), height: 1, round: true },
];

export const chapterOneStones = [
  { id: 'shelf_a', x: 6.58, z: -44.26, top: 5.32, r: 0.46 },
  { id: 'shelf_b', x: 7.22, z: -43.59, top: 5.58, r: 0.48 },
  { id: 'shelf_c', x: 8.49, z: -42.95, top: 5.25, r: 0.34 },
] as const;

const courseBlocks = [
  { x: 8.05, z: -42.05, width: 1.25, depth: 1.25, top: 6.95, height: 3 },
  { x: 9.85, z: -41, width: 2.6, depth: 2.3, top: 9.72, height: 1.7 },
] as const;

function installStone(world: ObstacleWorld, { x, z, top, r }: typeof chapterOneStones[number]): void {
  const rim = circle(x, z, r, 10);
  const bases = rim.map(([rimX, rimZ]) =>
    Math.min(top - 2.5, (world.groundAt(rimX, rimZ, top - 0.05, top - 8)?.y ?? Infinity) - 0.25));
  const cap: number[] = [];
  const skirt: number[] = [];
  for (let index = 0; index + 1 < rim.length; index++) {
    const [x0, z0] = rim[index]!;
    const [x1, z1] = rim[index + 1]!;
    const base0 = bases[index]!;
    const base1 = bases[index + 1]!;
    cap.push(x, top, z, x0, top, z0, x1, top, z1);
    skirt.push(x0, base0, z0, x1, base1, z1, x1, top, z1, x0, base0, z0, x1, top, z1, x0, top, z0);
  }
  world.addTriangles(cap, { kind: 1, surface: 'rock' });
  world.addTriangles(skirt, { kind: 2 });
}

/** Install the authored static obstacles after the ground terrain. */
export function installChapterOneObstacles(world: ObstacleWorld, ground: GroundAsset): void {
  const sampleHeight = (x: number, z: number) => sampleGroundEdgeHeight(ground, x, z);
  for (const { kind, pts, from, to, height = 4, camera, group = null, fades = null, round = false } of chapterOneEdges) {
    const bottom = from === undefined ? (x: number, z: number) => sampleHeight(x, z) - 1 : () => from;
    const top = to === undefined ? (x: number, z: number) => sampleHeight(x, z) + height : () => to;
    const mask = kind === 'sight' ? 16 : (kind === 'guard' ? 4 : 2) | (camera ? 8 : 0);
    world.addTriangles(extrudeWallPolyline(pts, bottom, top), { kind: mask, group, fades, round });
  }

  for (const stone of chapterOneStones) installStone(world, stone);

  for (const { x, z, width, depth, top, height } of courseBlocks) {
    const x0 = x - width / 2, x1 = x + width / 2;
    const z0 = z - depth / 2, z1 = z + depth / 2;
    world.addTriangles([x0, top, z0, x1, top, z1, x1, top, z0, x0, top, z0, x0, top, z1, x1, top, z1],
      { kind: 1, surface: 'rock' });
    const outline: PointXZ[] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
    world.addTriangles(extrudeWallPolyline(outline, () => top - height, () => top - 0.02), { kind: 2 });
  }
}
