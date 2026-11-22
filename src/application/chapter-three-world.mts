import { ShapeUtils, Vector2 } from 'three';
import { extrudeWallPolyline } from '../physics/geometry.mts';
import type { PointXZ } from '../physics/geometry.mts';
import { createCollisionWorld } from '../physics/world.mts';
import type { CollisionWorld } from '../physics/world.mts';

export const chapterThreeSpawn = Object.freeze({ x: 32, z: -60, heading: 0 });
export const chapterThreeSceneAssets = Object.freeze({ world: 'levels/ch3_pines/world.glb' });

export interface ChapterThreeWorld {
  readonly id: 'ch3_pines';
  readonly spawn: typeof chapterThreeSpawn;
  readonly killY: -18;
  readonly killDrop: 15;
  readonly world: CollisionWorld;
}

type Point = readonly [x: number, y: number, z: number];
type Stretch = readonly [startX: number, startZ: number, endX: number, endZ: number];
type WallPath = readonly [PointXZ, PointXZ];
type Disc = readonly [x: number, z: number, radius: number, bottom: number, top: number];

interface Platform {
  readonly polygon: readonly PointXZ[];
  readonly y: number;
  readonly surface: 'rock' | 'wood';
  readonly depth: number;
  readonly open: Stretch[];
  readonly notches: Stretch[];
}

interface Trunk {
  readonly points: readonly Point[];
  readonly width: number;
  readonly surface?: 'stair';
}

const rectangle = (x0: number, z0: number, x1: number, z1: number): PointXZ[] =>
  [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

function bevel(x0: number, z0: number, x1: number, z1: number, size: number, square: readonly number[] = []): PointXZ[] {
  const corners = [[x0, z0, 1, 1], [x1, z0, -1, 1], [x1, z1, -1, -1], [x0, z1, 1, -1]] as const;
  const polygon: PointXZ[] = [];
  for (const [index, [x, z, edgeX, edgeZ]] of corners.entries()) {
    if (square.includes(index)) {
      polygon.push([x, z]);
      continue;
    }
    const sideX: PointXZ = [x + edgeX * size, z];
    const sideZ: PointXZ = [x, z + edgeZ * size];
    if (index % 2 === 0) polygon.push(sideZ, sideX);
    else polygon.push(sideX, sideZ);
  }
  return polygon;
}

function rock(polygon: readonly PointXZ[], y: number, ...open: Stretch[]): Platform {
  return { polygon, y, surface: 'rock', depth: 40, open, notches: [] };
}

function deck(x0: number, z0: number, x1: number, z1: number, y: number, open: Stretch[] = [], depth = 0.45): Platform {
  return { polygon: rectangle(x0, z0, x1, z1), y, surface: 'wood', depth, open, notches: [] };
}

function stack(x: number, z: number, radius: number, y: number): Platform {
  const polygon: PointXZ[] = Array.from({ length: 12 }, (_, index) => {
    const angle = 0.13 + index / 12 * Math.PI * 2;
    return [x + Math.cos(angle) * radius, z + Math.sin(angle) * radius];
  });
  return rock(polygon, y);
}

// Authored inputs from ch3_pines-BCHma7IG.js. Keep the route order for
// the original ground-hit tie order and first nearest bridge endpoint.
const TRUNKS: readonly Trunk[] = [
  { points: [[37,26,-158],[36.4,26.5,-162],[33,27.7,-168],[29,28.6,-173.5],[26.8,29,-176.6]], width: 1.25 },
  { points: [[18.8,29,-182.2],[13,28.4,-183.6],[7.4,27.4,-185.2]], width: 1.35 },
  { points: [[4.9,27.2,-186],[0,26.3,-187.5],[-6,25,-189.4]], width: 1.5 },
  { points: [[33.1,27.1,-165.9],[26,26.2,-163.4],[20.4,25.7,-160.8]], width: 1.2 },
  { points: [[-394.59999999999997,30,-212.4],[-409.59999999999997,34,-212.4]], width: 3.2, surface: 'stair' },
];

const BRIDGE_ENDS: readonly PointXZ[] = [
  [-91,-202.3], [-115,-202.3], [-320.59999999999997,-204], [-342.59999999999997,-204],
  [-358.59999999999997,-204], [-380.59999999999997,-204], [-313.59999999999997,-196],
  [-313.59999999999997,-174.6], [-444.59999999999997,-265.7], [-444.59999999999997,-289.6],
];

const CLIFFS: readonly (readonly [path: readonly PointXZ[], top: number])[] = [
  [[[37.2,-48],[37.2,-60],[36.6,-66],[34,-66],[34,-136.4]], 34],
  [[[34,-136.4],[40,-136.4],[40,-176],[34,-204]], 38],
  [[[34,-204],[-192,-204]], 38],
  [[[-192,-204],[-195.6,-214],[-397,-214]], 44],
  [[[-397,-214],[-437.59999999999997,-214]], 52],
  [[[-437.59999999999997,-214],[-437.59999999999997,-312]], 52],
];

const DISCS: readonly Disc[] = [
  [27.93,-56.26,0.39,19.6,23], [22.19,-184.49,0.44,28.6,32], [-52.1,-188.97,0.34,24.6,28],
  [-90.75,-203.43,0.07,24.6,26.45], [-115.25,-203.43,0.07,24.6,26.45], [-124.5,-195.56,0.36,24.6,28],
  [-153.4,-183.29,0.34,24.6,28], [-207.71,-195.36,0.39,27.6,31], [-290.11,-198.56,0.39,29.6,33],
  [-320.35,-205.13,0.07,29.6,31.45], [-320.35,-202.87,0.07,29.6,31.45], [-309.69,-211.96,0.32,29.6,33],
  [-312.52,-196.25,0.07,29.6,31.45], [-380.85,-205.13,0.07,29.6,31.45], [-380.85,-202.87,0.07,29.6,31.45],
  [-384.71,-198.77,0.36,29.6,33], [-449.69,-228.05,0.4,40.8,44.2], [-445.73,-265.45,0.07,40.8,42.65],
  [-445.73,-289.85,0.07,40.8,42.65], [-443.47,-289.85,0.07,40.8,42.65], [-451.7,-300.65,0.48,40.8,44.2],
  [-442.13,-299,0.17,40.8,46.41], [-90.75,-203.43,0.24,24.6,26.45], [-115.25,-203.43,0.24,24.6,26.45],
  [-445.73,-289.85,0.24,40.8,42.65], [-442.1,-299,0.32,40.8,46.4], [-447.1,-299,0.32,40.8,46.4],
  [-233.55,-201.7,0.2,27.6,30.4], [-442,-263.35,0.42,40.8,43.6],
];

function openingNear(platform: Platform, x: number, z: number, radius: number) {
  const { polygon } = platform;
  let centerX = x;
  let centerZ = z;
  let distance = Infinity;
  for (const [index, [x0, z0]] of polygon.entries()) {
    const [x1, z1] = polygon[(index + 1) % polygon.length]!;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const fraction = Math.min(Math.max(((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz), 0), 1);
    const sideX = x0 + dx * fraction;
    const sideZ = z0 + dz * fraction;
    const gap = Math.hypot(sideX - x, sideZ - z);
    if (gap < distance) {
      distance = gap;
      centerX = sideX;
      centerZ = sideZ;
    }
  }

  const stretches: Stretch[] = [];
  for (const [index, [x0, z0]] of polygon.entries()) {
    const [x1, z1] = polygon[(index + 1) % polygon.length]!;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const length = Math.hypot(dx, dz);
    const tx = dx / length;
    const tz = dz / length;
    const along = (centerX - x0) * tx + (centerZ - z0) * tz;
    const across = Math.abs((centerX - x0) * tz - (centerZ - z0) * tx);
    if (across >= radius) continue;
    const reach = Math.sqrt(radius * radius - across * across);
    const from = Math.max(along - reach, 0);
    const to = Math.min(along + reach, length);
    if (to > from) stretches.push([x0 + tx * from, z0 + tz * from, x0 + tx * to, z0 + tz * to]);
  }
  return { distance, stretches };
}

function createPlatforms(): Platform[] {
  const landingJoin = [31,-66,34,-66] as const;
  const raisedDeckJoin = [31,-116,34,-116] as const;
  const westDeckJoin = [-58,-204,-58,-200.6] as const;
  const westFlight = -394.59999999999997;
  const upperFlight = -409.59999999999997;
  const flightJoin = [upperFlight,-214,upperFlight,-210.8] as const;
  const shelf = rock(rectangle(34,-158,40,-136.4), 26);
  const trunkStack = stack(24, -181, 5.4, 29);
  const lowPine = stack(17.6, -159.4, 3.1, 25.7);
  const platforms = [
    rock([[26,-66],[36.5,-66],[37,-60],[36,-54],[28,-53],[25,-59]], 20, landingJoin),
    deck(31,-82,34,-66,20,[landingJoin]),
    deck(31,-96,34,-84.4,20),
    deck(31,-108,34,-98.4,20),
    deck(31,-116,34,-108,21.1,[raisedDeckJoin],1.5),
    deck(31,-122,34,-116,20,[raisedDeckJoin]),
    shelf,
    trunkStack,
    rock(bevel(-22,-204,-6,-186,2,[0,1]), 25, [-6,-190.3,-6,-188.5]),
    lowPine,
    rock(bevel(-32.2,-202,-24.4,-188,1.6), 25),
    rock(bevel(-43.6,-200,-34.6,-190,1.6), 25),
    rock(bevel(-58,-204,-46,-186,3,[0,1]), 25, westDeckJoin),
    deck(-69,-204,-58,-200.6,25,[westDeckJoin]),
    deck(-79,-203.2,-71.4,-201.4,25),
    deck(-91,-204,-81.4,-200.6,25),
    rock(bevel(-127,-204,-115,-193,2,[0,1]), 25),
    stack(-155.2,-199,4.4,25),
    stack(-155.2,-185.2,3.2,25),
    stack(-169.4,-199,3.4,25),
    stack(-183.4,-199,3.8,25),
    rock(bevel(-211,-214,-195.6,-192,3,[0,1]), 28),
    stack(-233.2,-204,2.9,28),
    stack(-258,-205,2.9,30),
    rock(bevel(-293.4,-214,-280.4,-196,2,[0,1]), 30),
    rock(bevel(-320.59999999999997,-214,-306.59999999999997,-196,2,[0,1]), 30),
    rock(bevel(westFlight,-214,-380.59999999999997,-196,2,[0,1]), 30, [westFlight,-214,westFlight,-210.8]),
    stack(-313.59999999999997,-172,3.2,30),
    deck(-415.59999999999997,-214,upperFlight,-210.8,34,[flightJoin]),
    deck(-425.59999999999997,-214,-417.99999999999994,-210.8,34),
    rock(bevel(-451.59999999999997,-242,-437.59999999999997,-214,3,[1,2,3]), 41.2),
    stack(-444.59999999999997,-262.4,3.5,41.2),
    rock(bevel(-453.59999999999997,-306,-435.59999999999997,-289.6,3), 41.2),
  ];
  shelf.open.push(...openingNear(shelf,37,-158,0.72).stretches);
  trunkStack.open.push(...openingNear(trunkStack,26.8,-176.6,0.78).stretches,
    ...openingNear(trunkStack,18.8,-182.2,1).stretches);
  lowPine.open.push(...openingNear(lowPine,20.4,-160.8,0.68).stretches);

  for (const [x, z] of BRIDGE_ENDS) {
    let nearest = 0.7;
    let target: Platform | undefined;
    let notches: Stretch[] = [];
    for (const platform of platforms) {
      const opening = openingNear(platform, x, z, 1.25);
      if (opening.distance >= nearest) continue;
      nearest = opening.distance;
      target = platform;
      notches = opening.stretches;
    }
    target?.notches.push(...notches);
  }
  return platforms;
}

function remainingEdges(polygon: readonly PointXZ[], openings: readonly Stretch[]): WallPath[] {
  const paths: WallPath[] = [];
  for (const [index, [x0, z0]] of polygon.entries()) {
    const [x1, z1] = polygon[(index + 1) % polygon.length]!;
    const length = Math.hypot(x1 - x0, z1 - z0);
    const tx = (x1 - x0) / length;
    const tz = (z1 - z0) / length;
    const exclusions: [from: number, to: number][] = [];
    for (const [startX, startZ, endX, endZ] of openings) {
      const acrossStart = Math.abs((startX - x0) * tz - (startZ - z0) * tx);
      const acrossEnd = Math.abs((endX - x0) * tz - (endZ - z0) * tx);
      if (acrossStart > 0.01 || acrossEnd > 0.01) continue;
      const start = (startX - x0) * tx + (startZ - z0) * tz;
      const end = (endX - x0) * tx + (endZ - z0) * tz;
      exclusions.push([Math.max(Math.min(start, end), 0), Math.min(Math.max(start, end), length)]);
    }
    exclusions.sort(([a], [b]) => a - b);
    let previous = 0;
    for (const [from, to] of exclusions) {
      if (from > previous + 0.01) {
        paths.push([[x0 + tx * previous, z0 + tz * previous], [x0 + tx * from, z0 + tz * from]]);
      }
      previous = Math.max(previous, to);
    }
    if (previous < length - 0.01) paths.push([[x0 + tx * previous, z0 + tz * previous], [x1, z1]]);
  }
  return paths;
}

function trunkSides({ points, width }: Trunk) {
  const halfWidth = width / 2;
  const left: Point[] = [];
  const right: Point[] = [];
  for (const [index, [x, y, z]] of points.entries()) {
    const [priorX, , priorZ] = points[Math.max(index - 1, 0)]!;
    const [nextX, , nextZ] = points[Math.min(index + 1, points.length - 1)]!;
    const length = Math.hypot(nextX - priorX, nextZ - priorZ) || 1;
    const offsetX = (nextZ - priorZ) / length;
    const offsetZ = -(nextX - priorX) / length;
    left.push([x - offsetX * halfWidth, y, z - offsetZ * halfWidth]);
    right.push([x + offsetX * halfWidth, y, z + offsetZ * halfWidth]);
  }
  return { left, right };
}

function trimTrunkGuard(points: readonly Point[]): PointXZ[] {
  const path: PointXZ[] = points.map(([x, , z]) => [x, z]);
  const trim = ([x0, z0]: PointXZ, [x1, z1]: PointXZ): PointXZ => {
    const length = Math.hypot(x1 - x0, z1 - z0) || 1;
    const fraction = Math.min(0.6 / length, 0.4);
    return [x0 + (x1 - x0) * fraction, z0 + (z1 - z0) * fraction];
  };
  const last = path.length - 1;
  const firstPoint = trim(path[0]!, path[1]!);
  const lastPoint = trim(path[last]!, path[last - 1]!);
  path[0] = firstPoint;
  path[last] = lastPoint;
  return path;
}

function addVertical(world: CollisionWorld, path: readonly PointXZ[], bottom: number, top: number,
  kind: 2 | 4 | 16, fades: string | null = null) {
  world.addTriangles(extrudeWallPolyline(path, () => bottom, () => top), { kind, fades });
}

/** Install the static collision from the published Chapter Three load phase. */
export function createChapterThreeWorld(): ChapterThreeWorld {
  const world = createCollisionWorld();
  const platforms = createPlatforms();
  const trunks = TRUNKS.map(trunk => ({ ...trunk, ...trunkSides(trunk) }));
  for (const { polygon, y, surface } of platforms) {
    const positions: number[] = [];
    for (const face of ShapeUtils.triangulateShape(polygon.map(([x, z]) => new Vector2(x, z)), [])) {
      for (const index of face) {
        const [x, z] = polygon[index]!;
        positions.push(x, y, z);
      }
    }
    world.addTriangles(positions, { kind: 1, surface });
  }
  for (const { left, right, surface = 'wood' } of trunks) {
    const positions: number[] = [];
    for (let index = 0; index + 1 < left.length; index++) {
      const [a, b, c, d] = [left[index]!, right[index]!, right[index + 1]!, left[index + 1]!];
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    world.addTriangles(positions, { kind: 1, surface });
  }
  for (const { polygon, y, depth, open, notches } of platforms) {
    for (const path of remainingEdges(polygon, [...open, ...notches])) addVertical(world, path, y - 1, y + 4, 4);
    for (const path of remainingEdges(polygon, notches)) addVertical(world, path, y - depth, y - 0.02, 2);
    for (const [x0, z0, x1, z1] of notches) addVertical(world, [[x0, z0], [x1, z1]], y - depth, y - 0.75, 2);
  }
  for (const { points, left, right } of trunks) {
    const heights = points.map(([, y]) => y);
    const bottom = Math.min(...heights) - 1;
    const top = Math.max(...heights) + 4;
    addVertical(world, trimTrunkGuard(left), bottom, top, 4);
    addVertical(world, trimTrunkGuard(right), bottom, top, 4);
  }
  for (const [path, top] of CLIFFS) addVertical(world, path, -40, top, 2);
  addVertical(world, [[-212.6,-196.2],[-206.8,-196.2],[-206.8,-190.1],[-212.6,-190.1],[-212.6,-196.2]],
    30.8, 36.7, 16, 'a07_pine');
  addVertical(world, [[-211.1,-195.9],[-207.1,-195.9],[-207.1,-191.7],[-211.1,-191.7],[-211.1,-195.9]],
    28, 36, 16, 'a07_pine');
  for (const disc of DISCS) world.addDisc(...disc);
  return { id: 'ch3_pines', spawn: chapterThreeSpawn, killY: -18, killDrop: 15, world };
}
