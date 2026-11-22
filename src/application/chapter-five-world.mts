/** Static load of ch5_sea-CpHUIhkX.js (Git blob c19b4d712c88a079de4f6de12bf4c6efdc8fbe13). */
import { ShapeUtils, Vector2 } from 'three';
import { extrudeWallPolyline, type PointXZ } from '../physics/geometry.mts';
import { createCollisionWorld, type CollisionWorld } from '../physics/world.mts';

export const chapterFiveSpawn = Object.freeze({ x: 30, z: -64, heading: 0 });
export const chapterFiveSceneAssets = Object.freeze({ world: 'levels/ch5_sea/sea.glb' });

export interface ChapterFiveWorld {
  readonly id: 'ch5_sea';
  readonly spawn: typeof chapterFiveSpawn;
  readonly killY: -4;
  readonly killDrop?: undefined;
  readonly world: CollisionWorld;
}

interface Platform {
  id: string;
  polygon: readonly PointXZ[];
  y: number;
  surface: 'rock' | 'stone';
}

interface Stair {
  id: string;
  polygon: readonly [PointXZ, PointXZ, PointXZ, PointXZ];
  y: number;
  endY: number;
  tilt: PointXZ;
  surface: 'stair';
}

type Surface = Platform | Stair;
type GuardOpening = readonly [x: number, z: number, radius: number];
type Disc = readonly [x: number, z: number, radius: number, bottom: number, top: number];

const DRY_ROCK = 3.6;
const rectangle = (x0: number, z0: number, x1: number, z1: number): PointXZ[] =>
  [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

function superellipse(x: number, z: number, radiusX: number, radiusZ: number, power: number, sides: number): PointXZ[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = index / sides * Math.PI * 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return [x + radiusX * Math.sign(cosine) * Math.abs(cosine) ** (2 / power),
      z + radiusZ * Math.sign(sine) * Math.abs(sine) ** (2 / power)];
  });
}

function rock(id: string, x: number, z: number, radiusX: number, radiusZ: number, y = DRY_ROCK): Platform {
  return { id, polygon: superellipse(x, z, radiusX, radiusZ, 3.2, 32), y, surface: 'rock' };
}

function steppingStone(id: string, x: number, z: number, radius: number, y: number): Platform {
  return { id, polygon: superellipse(x, z, radius, radius, 2, 12), y, surface: 'rock' };
}

function flat(id: string, polygon: readonly PointXZ[], y: number): Platform {
  return { id, polygon, y, surface: 'stone' };
}

function createSurfaces() {
  const openings: GuardOpening[] = [];
  function stair(id: string, from: PointXZ, to: PointXZ, width: number, y: number, endY: number): Stair {
    const deltaX = to[0] - from[0];
    const deltaZ = to[1] - from[1];
    const length = Math.hypot(deltaX, deltaZ);
    const dx = deltaX / length;
    const dz = deltaZ / length;
    const halfWidth = width / 2;
    const offsetX = -dz * halfWidth;
    const offsetZ = dx * halfWidth;
    const slope = (endY - y) / length;
    openings.push([from[0], from[1], halfWidth + 0.3], [to[0], to[1], halfWidth + 0.3]);
    return { id, y, endY, tilt: [dx * slope, dz * slope], surface: 'stair', polygon: [
      [from[0] - offsetX, from[1] - offsetZ], [to[0] - offsetX, to[1] - offsetZ],
      [to[0] + offsetX, to[1] + offsetZ], [from[0] + offsetX, from[1] + offsetZ],
    ] };
  }

  const surfaces: Surface[] = [
    rock('shore', 30, -72, 17, 13),
    stair('st_shore', [30,-85], [30,-92], 8, DRY_ROCK, 1),
    flat('flat1', [[24,-92],[36,-92],[40,-102],[40,-112],[28,-112],[24,-102]], 1),
    stair('st_flat1', [34,-112], [34,-119], 8, 1, DRY_ROCK),
    rock('r1', 34, -129, 12, 10),
    steppingStone('s1', 32.6, -142.6, 2.2, 2.5), steppingStone('s2', 33.8, -148, 2.2, 2.8),
    steppingStone('s3', 33, -153.2, 2.2, 3.1), rock('stack', 33.6, -160, 3.6, 3.6),
    steppingStone('s4', 35.6, -166, 2.2, 2.3), steppingStone('s5', 34.6, -170.6, 2.2, 1.7),
    steppingStone('s6', 35.8, -175.2, 2.2, 1.3), steppingStone('s7', 34.6, -179.8, 2.2, 1.7),
    steppingStone('s8', 35.4, -184.4, 2.2, 2.6), rock('r2', 34, -197, 14, 10),
    rock('scroll_rock', 13, -160, 5, 5), stair('st_scroll', [13,-165], [13,-171], 6, DRY_ROCK, 0.45),
    flat('corridor', [[10,-171],[16,-171],[16,-183],[14,-187],[8,-187],[8,-182],[10,-178]], 0.45),
    rock('r3', 34, -229, 15, 12, 6.2), stair('st_r3', [34,-241], [34,-251], 8, 6.2, DRY_ROCK),
    rock('dock4', 34, -256, 7, 5), rock('m4', 34, -304, 10, 10), rock('hidden', -12, -304, 6, 6),
    steppingStone('p1', 58.5, -304, 2.8, DRY_ROCK), steppingStone('p2', 58.5, -324, 2.8, DRY_ROCK),
    rock('i5', 86, -324, 11, 9), stair('st_i5', [86,-333], [86,-340], 10, DRY_ROCK, 1.1),
    flat('flat6', rectangle(81,-372,91,-340), 1.1), stair('st_flat6', [86,-372], [86,-379], 10, 1.1, DRY_ROCK),
    rock('i6', 86, -389, 12, 10),
    steppingStone('a1', 101.5, -389, 2.2, 2.6), steppingStone('a2', 106.6, -388.4, 2.2, 2.2),
    rock('r7a', 114, -389, 3.5, 3), steppingStone('a3', 120.5, -390, 2.2, 2.2),
    steppingStone('a4', 125.6, -389.4, 2.2, 1.6), steppingStone('a5', 130.7, -390, 2.2, 2.2),
    rock('r7b', 139, -391, 4.5, 4.5), rock('archers', 125, -403, 22, 4, 5.4),
    stair('st_archers', [139,-395.5], [139,-399.6], 5, DRY_ROCK, 5.4),
    stair('st_cw_in', [125,-407], [125,-412.5], 5, 5.4, 2.4),
    flat('causeway', [[123,-412.5],[127,-412.5],[127,-424],[132,-424],[132,-430],[127,-430],
      [127,-458],[123,-458],[123,-448],[118,-448],[118,-442],[123,-442]], 2.4),
    stair('st_cw_out', [125,-458], [125,-464], 5, 2.4, DRY_ROCK), rock('i9', 125, -472, 10, 8),
    flat('court_bridge', rectangle(122.5,-486.2,127.5,-479.8), DRY_ROCK),
  ];
  openings.push([125,-480,3], [125,-486,3], [125,-512,3]);
  const court = rock('court', 125, -499, 13, 13);
  surfaces.push(court, rock('i10', 125, -530, 8, 9, 5.6), stair('st_i10', [133,-530], [139,-530], 6, 5.6, DRY_ROCK),
    rock('dock10', 143.5, -530, 4.5, 5), rock('gw', 191.5, -530, 8.5, 7),
    stair('st_gate_in', [191.5,-537], [191.5,-548], 8, DRY_ROCK, 0.35),
    flat('gate_way', rectangle(186.5,-566,196.5,-548), 0.35),
    stair('st_gate_out', [191.5,-566], [191.5,-577], 8, 0.35, DRY_ROCK),
    rock('end', 191.5, -590, 11, 13));
  return { surfaces, openings, court };
}

const DISCS: readonly Disc[] = [
  [114.83,-509.81,0.72,3.2,5.64], [121.2,-486.4,0.65,3.2,9.2], [128.8,-486.4,0.65,3.2,9.2],
  [112.4,-507.4,0.43,3.2,5.85], [113.98,-507.4,0.69,3.2,5.85], [114.77,-507.4,0.55,3.2,5.85],
  [115.56,-507.4,0.55,3.2,5.85], [116.35,-507.4,0.69,3.2,5.85], [117.14,-507.4,0.55,3.2,5.85],
  [117.93,-507.4,0.55,3.2,5.85], [118.72,-507.4,0.69,3.2,5.85], [120.3,-507.4,0.43,3.2,5.85],
  [129.7,-507.4,0.43,3.2,5.85], [131.28,-507.4,0.69,3.2,5.85], [132.07,-507.4,0.55,3.2,5.85],
  [132.86,-507.4,0.55,3.2,5.85], [133.65,-507.4,0.69,3.2,5.85], [134.44,-507.4,0.55,3.2,5.85],
  [135.23,-507.4,0.55,3.2,5.85], [136.02,-507.4,0.69,3.2,5.85], [137.6,-507.4,0.43,3.2,5.85],
  [121.2,-507.4,0.65,3.2,9.2], [128.8,-507.4,0.65,3.2,9.2],
];

/** Split a rim where the original sampled points enter stair or gate openings. */
function splitRim(polygon: readonly PointXZ[], openings: readonly GuardOpening[]): PointXZ[][] {
  const paths: PointXZ[][] = [];
  let path: PointXZ[] = [];
  for (const [edge, [x0, z0]] of polygon.entries()) {
    const [x1, z1] = polygon[(edge + 1) % polygon.length]!;
    const segments = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.6));
    for (let index = 0; index <= segments; index++) {
      const x = x0 + (x1 - x0) * index / segments;
      const z = z0 + (z1 - z0) * index / segments;
      if (openings.some(([ox, oz, radius]) => Math.hypot(x - ox, z - oz) < radius)) {
        if (path.length > 1) paths.push(path);
        path = [];
      } else if (index > 0 || path.length === 0) path.push([x, z]);
    }
  }
  if (path.length > 1) paths.push(path);
  return paths;
}

function installTop(world: CollisionWorld, { polygon, y, ...surface }: Surface) {
  const [originX, originZ] = polygon[0]!;
  const positions: number[] = [];
  for (const face of ShapeUtils.triangulateShape(polygon.map(([x, z]) => new Vector2(x, z)), [])) {
    for (const index of face) {
      const [x, z] = polygon[index]!;
      const height = y + ('tilt' in surface ? (x - originX) * surface.tilt[0] + (z - originZ) * surface.tilt[1] : 0);
      positions.push(x, height, z);
    }
  }
  world.addTriangles(positions, { kind: 1, surface: surface.surface });
}

function addWall(world: CollisionWorld, path: readonly PointXZ[], bottom: number, top: number,
  kind: 2 | 4, round = false, group: string | null = null) {
  world.addTriangles(extrudeWallPolyline(path, () => bottom, () => top), { kind, round, group });
}

function installGuards(world: CollisionWorld, surfaces: readonly Surface[], openings: readonly GuardOpening[]) {
  for (const { polygon, y, ...surface } of surfaces) {
    if ('endY' in surface) {
      const bottom = Math.min(y, surface.endY) - 1;
      const top = Math.max(y, surface.endY) + 4;
      addWall(world, [polygon[0]!, polygon[1]!], bottom, top, 4);
      addWall(world, [polygon[3]!, polygon[2]!], bottom, top, 4);
    } else {
      for (const path of splitRim(polygon, openings)) addWall(world, path, y - 1, y + 4, 4);
    }
  }
}

/** Install the supplied chapter's static load in the original collision insertion order. */
export function createChapterFiveWorld(): ChapterFiveWorld {
  const world = createCollisionWorld();
  const { surfaces, openings, court } = createSurfaces();
  for (const surface of surfaces) installTop(world, surface);
  installGuards(world, surfaces, openings);
  addWall(world, [[110,-392.2],[118,-392.2]], 1, 8, 2);
  addWall(world, [[120.6,-405.8],[120.8,-406],[121,-405.8],[120.8,-405.6],[120.6,-405.8]], 4.4, 8.8, 2, true);
  addWall(world, [[123,-405.8],[123.2,-406],[123.4,-405.8],[123.2,-405.6],[123,-405.8]], 4.4, 8.8, 2, true);
  for (const path of splitRim(court.polygon, openings)) addWall(world, path, 2.6, 5.800000000000001, 2);
  addWall(world, [[121.5,-486.4],[128.5,-486.4]], 2.6, 7.6, 2, false, 'court_in');
  addWall(world, [[121.5,-507.4],[128.5,-507.4]], 2.6, 7.6, 2, false, 'court_out');
  addWall(world, [[112,-507],[120.65,-507],[120.65,-506.85],[121.75,-506.85],
    [121.75,-507.95],[120.65,-507.95],[120.65,-507.8],[112,-507.8]], 2.6, 5.85, 2);
  addWall(world, [[138,-507],[129.35,-507],[129.35,-506.85],[128.25,-506.85],
    [128.25,-507.95],[129.35,-507.95],[129.35,-507.8],[138,-507.8]], 2.6, 5.85, 2);
  for (const disc of DISCS) world.addDisc(...disc);
  return { id: 'ch5_sea', spawn: chapterFiveSpawn, killY: -4, world };
}
