import { ShapeUtils, Vector2 } from 'three';
import { extrudeWallPolyline } from '../physics/geometry.mts';
import type { PointXZ } from '../physics/geometry.mts';
import { createCollisionWorld } from '../physics/world.mts';
import type { CollisionWorld } from '../physics/world.mts';

export const chapterTwoSpawn = Object.freeze({ x: 14, z: -15.5, heading: 0 });
export const chapterTwoSceneAssets = Object.freeze({
  pass: 'levels/ch2_pass/pass.glb',
  court: 'levels/ch2_pass/court.glb',
});

export interface ChapterTwoWorld {
  readonly id: 'ch2_pass';
  readonly spawn: typeof chapterTwoSpawn;
  readonly killY: -30;
  readonly killDrop: 13;
  readonly world: CollisionWorld;
}

interface RockOptions {
  open?: readonly number[];
  plain?: readonly number[];
  depth?: number;
  tilt?: PointXZ;
  surface?: 'rock' | 'stair' | 'stone';
  wobble?: number;
}

type RockPolygon = readonly [PointXZ, PointXZ, PointXZ, ...PointXZ[]];
type RockDefinition = readonly [id: string, polygon: RockPolygon, height: number, options?: RockOptions];

// Static collision inputs of C(...) in ch2_pass-9Opjv4P2.js. Order supplies
// the boundary wobble seed and decides tie order in ground queries.
const ROCKS: readonly RockDefinition[] = [
  ['gate_road', [[7,-61],[21,-61],[23,-71],[22,-80],[6,-80],[5,-71]], 6, { open: [3] }],
  ['low1', [[6,-80],[22,-80],[23,-83],[22,-86],[6,-86],[5,-83]], 7.1, { open: [0,3] }],
  ['low2', [[6,-86],[22,-86],[23,-89],[22,-92],[15,-92],[15,-100],[3,-100],[3,-92],[6,-92]], 8.3,
    { open: [0,3,4,5] }],
  ['first_shelf', [[17,-92],[28,-92],[28,-100],[15,-100],[15,-96],[17,-96]], 5.6, { open: [2,3,4,5] }],
  ['shelf_step', [[15,-92],[17,-92],[17,-96],[15,-96]], 6.949999999999999, { open: [0,1,2,3], depth: 6 }],
  ['first_cliff', [[3,-100],[21,-100],[21,-110],[3,-110]], 22, { open: [0,1], plain: [0,1] }],
  ['r3', [[21,-100],[28,-100],[31,-103],[42,-104],[43,-107.5],[41,-110.5],[21,-110.5]], 11.6,
    { open: [6], plain: [0,5,6] }],
  ['c3', [[30,-113],[46,-113],[46,-124],[30,-124]], 26, { open: [0,1,2,3] }],
  ['r4', [[30,-124],[46,-124],[46,-134],[44,-136],[30,-136],[28,-130]], 13.9, { open: [0,3], plain: [1] }],
  ['c4', [[24,-136],[53.5,-136],[53.5,-146],[24,-146]], 34, { open: [0,1] }],
  ['r5', [[53.5,-136],[64,-136],[66,-141],[64,-146],[62,-146],[56,-146],[53.5,-146]], 21.6,
    { open: [4,6], plain: [0,5] }],
  ['stair1', [[56,-146],[62,-146],[62,-153],[56,-153]], 21.6,
    { open: [0,2], tilt: [0,-3 / 7], surface: 'stair', wobble: 0 }],
  ['land1', [[55,-153],[63,-153],[63,-157],[55,-157]], 24.6, { open: [0], plain: [2], wobble: 0.15 }],
  ['stair_shelf', [[53,-157],[65,-157],[65,-159.8],[53,-159.8]], 22.200000000000003,
    { open: [0,2], depth: 26 }],
  ['land2', [[55,-159.8],[63,-159.8],[63,-164],[61,-164],[57,-164],[55,-164]], 24.6,
    { open: [3], plain: [0], wobble: 0.15 }],
  ['stair2', [[57,-164],[61,-164],[61,-171],[57,-171]], 24.6,
    { open: [0,2], tilt: [0,-3 / 7], surface: 'stair', wobble: 0 }],
  ['land3', [[54,-171],[63,-171],[63,-175],[54,-175]], 27.6, { open: [0], plain: [2], wobble: 0.15 }],
  ['land4', [[54,-178.4],[60,-178.4],[60,-182],[54,-182]], 27.6, { open: [2], plain: [0], wobble: 0.15 }],
  ['stair3', [[54,-182],[60,-182],[60,-190],[54,-190]], 27.6,
    { open: [0,2], tilt: [0.05,-0.375], surface: 'stair', wobble: 0 }],
  ['land5', [[52,-190],[62,-190],[62,-194],[52,-194]], 30.650000000000002,
    { open: [0], plain: [2], wobble: 0.15 }],
  ['r6', [[46,-201.5],[66,-201.5],[68,-207],[66,-216],[62,-216],[62,-209],[56,-209],[56,-216],[51,-216],[46,-216]],
    33.5, { open: [3,4,5,6,7,8], plain: [0] }],
  ['r6_cap', [[56,-216],[62,-216],[66,-216],[66,-221],[56,-221]], 33.5, { open: [0,1,4] }],
  ['well', [[56,-209],[62,-209],[62,-216],[56,-216]], 30.6, { open: [0,1,2,3], depth: 5, wobble: 0 }],
  ['cleft_floor', [[46,-216],[51,-216],[51,-228],[46,-228]], 31, { open: [0,1,2,3], depth: 10, wobble: 0 }],
  ['cleft_e', [[51,-216],[56,-216],[56,-229],[51,-229]], 50, { open: [0,1,2,3] }],
  ['cleft_end', [[46,-228],[51,-228],[51,-229],[46,-229]], 50, { open: [0,1,2,3], wobble: 0 }],
  ['west_top', [[22,-212],[38,-213],[46,-216],[46,-228],[36,-229],[22,-226]], 39.9, { plain: [2,5] }],
  ['ink_shelf', [[22,-210],[22,-228],[-9,-228],[-9,-210]], 37, { open: [0], wobble: 0.3 }],
  ['ink_a', [[19,-217],[19,-223],[15,-223],[15,-217]], 39.9, { plain: [0,2], depth: 3, wobble: 0.25 }],
  ['ink_b', [[10,-217],[10,-223],[4,-223],[4,-217]], 39.9, { plain: [0,2], depth: 3, wobble: 0.25 }],
  ['ink_c', [[-2.5,-217],[-2.5,-223],[-8.5,-223],[-8.5,-217]], 39.9, { plain: [0,2], depth: 3, wobble: 0.25 }],
  ['ink_d', [[-14,-217],[-14,-223],[-20,-223],[-20,-217]], 39.9, { plain: [0,2], wobble: 0.25 }],
  ['ink_e', [[-27,-217],[-27,-223],[-33,-223],[-33,-217]], 39.9, { plain: [0,2], wobble: 0.25 }],
  ['ink_far', [[-40.5,-213],[-40.5,-227],[-42,-230],[-54,-230],[-56,-220],[-52,-210],[-42,-208]], 39.9,
    { plain: [0,2] }],
  ['crumb_shelf', [[-54,-230],[-42,-230],[-38,-249],[-54,-249]], 37.4, { open: [0,2] }],
  ['g_mid', [[-54,-249],[-38,-249],[-38,-259],[-54,-259]], 39.9, { plain: [0] }],
  ['g_far', [[-10,-248],[6,-246],[8,-251],[8,-258],[6,-262],[-10,-260]], 41.4, { plain: [2,5] }],
  ['h_pillar', [[16,-250],[24,-250],[24,-262],[16,-262]], 60, { open: [0,1,3], wobble: 0.25 }],
  ['h_opp', [[22,-237],[36,-237],[36,-245],[22,-245]], 60, { open: [0,1,2,3], wobble: 0.3 }],
  ['h_top', [[24,-250],[40,-250],[42,-256],[40,-264],[39.5,-264],[34.5,-264],[24,-264],[24,-262]], 49.6,
    { open: [4,5,7], plain: [0] }],
  ['snow_crag', [[25,-264],[33,-264],[34,-271],[25,-271]], 57.6, { open: [0] }],
  ['i_s1', [[34.5,-264],[39.5,-264],[39.5,-271],[34.5,-271]], 49.6,
    { open: [0], tilt: [0,-3 / 7], surface: 'stair', wobble: 0 }],
  ['i_l1', [[32,-281.5],[43,-281.5],[44,-285],[43,-288],[32,-288]], 54.1, { plain: [0,3], wobble: 0.15 }],
  ['i_l2', [[29,-294.5],[40,-294.5],[40,-300],[29,-300]], 54.1, { open: [2], plain: [0], wobble: 0.15 }],
  ['i_l3', [[29,-300],[38,-300],[38,-305],[29,-305]], 55.4, { open: [0,2], wobble: 0.15 }],
  ['i_wall', [[25,-305],[42,-305],[42,-316],[25,-316]], 72, { open: [0,1] }],
  ['i_top', [[42,-305],[54,-305],[56,-310],[54,-318],[42,-318]], 58.7, { open: [4], plain: [0,3] }],
  ['k_wall', [[38,-325.5],[52,-325.5],[52,-338],[38,-338]], 76, { open: [0,1,2,3] }],
  ['k_top', [[52,-337],[60,-337],[62,-341],[60,-345],[50,-345],[46,-345],[40,-345],[38,-342],[38,-338],[52,-338]],
    64.9, { open: [4,8,9], plain: [0] }],
  ['spur', [[44,-361],[52,-361],[51,-369],[49.5,-376],[47,-379.5],[45,-373]], 64.9, { plain: [0], wobble: 0.3 }],
  ['spur_knob', [[52,-361],[60,-362],[62,-368],[56,-373],[51,-369]], 64.9, { open: [0,3], wobble: 0.25 }],
  ['court', [[5,-13],[23,-13],[24,-25],[23,-38],[16,-38],[12,-38],[5,-38],[4,-25]], 6,
    { open: [4], plain: [3,5], surface: 'stone' }],
  ['court_dock', [[12,-38],[16,-38],[17.5,-40],[17.5,-49],[8.5,-49],[8.5,-40]], 6,
    { open: [0], plain: [3], surface: 'stone', wobble: 0.15 }],
];

// Baked body-room collision discs. Its face rows apply to render meshes only.
const DISCS: readonly (readonly [x: number, z: number, radius: number, minY: number, maxY: number])[] = [
  [7.6,-61.01,1.06,5.6,6.52], [20.78,-62.24,1.02,5.6,6.5], [22.25,-82.97,0.55,6.7,10.1],
  [27.96,-128.47,1.78,13.5,14.45], [65.04,-140.97,0.51,21.2,24.6], [53.97,-158.18,1.05,21.8,22.92],
  [54.48,-159.11,1.09,21.8,22.92], [56.25,-158.14,1.48,21.8,23.08], [57.62,-158.69,1.46,21.8,23.08],
  [60.72,-158.62,1.62,21.8,23.21], [62.2,-157.8,1.66,21.8,23.21], [52.82,-187.43,2.08,28.91,31.61],
  [60.48,-187.55,2.21,28.98,31.99], [52.64,-193.41,1.31,30.25,31.39], [53.92,-192.98,1.36,30.25,31.39],
  [62.26,-190.6,1.54,30.25,31.49], [63.5,-191.47,1.53,30.25,31.49], [-54.54,-220,0.47,39.5,42.9],
  [-46.42,-208.14,1.08,39.5,40.6], [-45.75,-209.03,1.01,39.5,40.6], [-41.77,-234.61,1.03,37,38.04],
  [-40.65,-234.94,1.13,37,38.04], [41.7,-258.02,0.67,49.2,50.13], [41.1,-288.2,0.65,53.7,54.61],
  [43.44,-287.16,0.46,53.7,54.66], [27.74,-297.61,1.45,53.7,54.93], [28.99,-298.27,1.47,53.7,54.93],
  [60.93,-343.71,0.79,64.5,65.46], [51.99,-363.35,0.38,64.5,65.41], [59.89,-367.07,1.92,64.5,67.9],
  [61.45,-365.47,0.8,64.5,65.7],
];

function roughenRock(corners: RockPolygon, straightEdges: readonly number[], amplitude: number, seed: number) {
  if (!amplitude) return { polygon: corners, cornerIndices: corners.map((_, index) => index) };
  let signedArea = 0;
  for (const [index, [x, z]] of corners.entries()) {
    const [nextX, nextZ] = corners[(index + 1) % corners.length]!;
    signedArea += x * nextZ - nextX * z;
  }
  const side = signedArea > 0 ? 1 : -1;
  const polygon: PointXZ[] = [];
  const cornerIndices: number[] = [];
  for (const [edge, start] of corners.entries()) {
    const [x, z] = start;
    const [nextX, nextZ] = corners[(edge + 1) % corners.length]!;
    cornerIndices.push(polygon.length);
    polygon.push(start);
    if (straightEdges.includes(edge)) continue;
    const length = Math.hypot(nextX - x, nextZ - z);
    const intermediateCount = Math.max(0, Math.round(length / 2.6) - 1);
    const outwardX = (nextZ - z) / length * side;
    const outwardZ = -(nextX - x) / length * side;
    for (let point = 1; point <= intermediateCount; point++) {
      const fraction = point / (intermediateCount + 1);
      const random = Math.sin((seed + edge * 3.1 + point) * 12.9898) * 43758.5453;
      const offset = (random - Math.floor(random) - 0.5) * 2 * amplitude;
      const taper = Math.min(1, Math.min(fraction, 1 - fraction) * 3);
      polygon.push([x + (nextX - x) * fraction + outwardX * offset * taper,
        z + (nextZ - z) * fraction + outwardZ * offset * taper]);
    }
  }
  return { polygon, cornerIndices };
}

function prepareRock([, corners, y, options = {}]: RockDefinition, index: number) {
  const { open = [], plain = [], depth = 34, tilt, surface = 'rock', wobble = 0.35 } = options;
  const { polygon, cornerIndices } = roughenRock(corners, [...plain, ...open], wobble, index + 1);
  const [originX, originZ] = corners[0];
  const heightAt = tilt ? (x: number, z: number) => y + ((x - originX) * tilt[0] + (z - originZ) * tilt[1]) : () => y;
  return { polygon, cornerIndices, open, heightAt, bottom: y - depth, surface };
}

type Rock = ReturnType<typeof prepareRock>;

function installRock(world: CollisionWorld, { polygon, heightAt, bottom, surface }: Rock) {
  const top: number[] = [];
  for (const face of ShapeUtils.triangulateShape(polygon.map(([x, z]) => new Vector2(x, z)), [])) {
    for (const index of face) {
      const [x, z] = polygon[index]!;
      top.push(x, heightAt(x, z), z);
    }
  }
  world.addTriangles(top, { kind: 1, surface });
  world.addTriangles(extrudeWallPolyline([...polygon, polygon[0]!], () => bottom, (x, z) => heightAt(x, z) - 0.02),
    { kind: 2 });
}

function installGuardRims(world: CollisionWorld, { polygon, cornerIndices, open, heightAt }: Rock) {
  const heights = polygon.map(([x, z]) => heightAt(x, z));
  const from = Math.min(...heights) - 0.5;
  const to = Math.max(...heights) + 1.7;
  for (const [edge, start] of cornerIndices.entries()) {
    if (open.includes(edge)) continue;
    const next = cornerIndices[(edge + 1) % cornerIndices.length]!;
    const path = next < start ? [...polygon.slice(start), polygon[next]!] : polygon.slice(start, next + 1);
    world.addTriangles(extrudeWallPolyline(path, () => from, () => to), { kind: 4 });
  }
}

function installCourtEdges(world: CollisionWorld) {
  const wall = (points: readonly PointXZ[], to: number, round = false) =>
    world.addTriangles(extrudeWallPolyline(points, () => 5, () => to), { kind: 2, round });
  const rect = (x0: number, z0: number, x1: number, z1: number): PointXZ[] =>
    [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
  function post(x: number, z: number, radius: number, top: number, sides = 8) {
    const outline: PointXZ[] = Array.from({ length: sides + 1 }, (_, index) => [
      x + Math.cos(index / sides * Math.PI * 2) * radius,
      z + Math.sin(index / sides * Math.PI * 2) * radius,
    ]);
    wall(outline, top, true);
  }
  wall(rect(4.4, -37.2, 11.5, -38.05), 9.2);
  wall(rect(16.5, -37.2, 23.6, -38.05), 9.2);
  post(12, -37.6, 0.5, 10);
  post(16, -37.6, 0.5, 10);
  post(14, -27, 0.85, 8.4);
  post(21.8, -35.6, 0.55, 8.4);
  post(22, -32.6, 1, 8.4);
  post(18.45, -36.95, 0.22, 10, 6);
  post(15.85, -48.15, 0.22, 10, 6);
  post(9.15, -61.9, 0.22, 10, 6);
  wall(rect(6.2, -35, 8.8, -37.2), 8.6);
  post(23.4, -16.6, 0.45, 9);
  post(4.3, -30.5, 0.45, 9);
}

/** Build the static collision installed by the published chapter's load phase. */
export function createChapterTwoWorld(): ChapterTwoWorld {
  const world = createCollisionWorld();
  const rocks = ROCKS.map(prepareRock);
  for (const rock of rocks) installRock(world, rock);
  for (const rock of rocks) installGuardRims(world, rock);
  world.addTriangles(extrudeWallPolyline([[15, -96], [15, -100]], () => 7.800000000000001, () => 10), { kind: 4 });
  for (const z of [-157, -159.8]) for (const [x0, x1] of [[53, 55], [63, 65]] as const) {
    world.addTriangles(extrudeWallPolyline([[x0, z], [x1, z]], () => 21.700000000000003, () => 23.900000000000002),
      { kind: 4 });
  }
  installCourtEdges(world);
  for (const disc of DISCS) world.addDisc(...disc);
  return { id: 'ch2_pass', spawn: chapterTwoSpawn, killY: -30, killDrop: 13, world };
}
