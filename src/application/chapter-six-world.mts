import { ShapeUtils, Vector2 } from 'three';
import { extrudeWallPolyline, pointInPolygon, type PointXZ } from '../physics/geometry.mts';
import { createCollisionWorld, type CollisionWorld } from '../physics/world.mts';

export const chapterSixSpawn = Object.freeze({ x: 29, z: -50, heading: 0 });
export const chapterSixSceneAssets = Object.freeze({
  terrain: 'levels/ch6_summit/terrain.glb',
  props: 'levels/ch6_summit/props.glb',
  far: 'levels/ch6_summit/far.glb',
});
export const chapterSixSight = Object.freeze({
  asset: chapterSixSceneAssets.terrain,
  meshNames: /^(rock|snow|stone|ice)_/,
  twoSided: true,
});

export interface ChapterSixWorld {
  readonly id: 'ch6_summit';
  readonly spawn: typeof chapterSixSpawn;
  readonly killY: -14;
  readonly killDrop: 17;
  readonly world: CollisionWorld;
}

type GroundKind = 'snow' | 'stone' | 'stair';
type PointXYZ = readonly [x: number, y: number, z: number];
type Path = readonly [PointXZ, PointXZ, ...PointXZ[]];
type Wall = readonly [path: Path, bottom: number, top: number];
type Disc = readonly [x: number, z: number, radius: number, bottom: number, top: number];

interface Surface {
  polygon: readonly PointXZ[];
  height: number;
  surface: GroundKind;
  tilt?: PointXZ;
}

interface Stone {
  x: number;
  z: number;
  top: number;
  radius: number;
  cap?: { height: number; radius: number; drop: number };
  rim?: readonly (readonly [x: number, z: number, heightOffset?: number])[];
}

// Static inputs authored in ch6_summit-BczK7QHX.js, Git blob
// 7ac649c89487c9efe8709882157624b1fc1eafc8. Keep load order for coincident hits.
const ICE_LANDING = 17.2;
const ICE_SHELF = 20.599999999999998;
const UPPER_ICE = 23.999999999999996;
const SPINE_START = 28;
const CAIRN_HEIGHT = 37;
const FALL_HEIGHT = 51;
const LIFT_BASE = 52.6;
const LIFT_TOP = 70;
const SUMMIT = 86.4;
const ARENA_X = -243;
const ARENA_Z = -350;

function rectangle(x0: number, z0: number, x1: number, z1: number): Path {
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

function outline(x: number, z: number, radius: number, sides: number, phase: number, closed: boolean): PointXZ[] {
  return Array.from({ length: sides + (closed ? 1 : 0) }, (_, index) => {
    const angle = phase + index / sides * Math.PI * 2;
    return [x + Math.cos(angle) * radius, z + Math.sin(angle) * radius];
  });
}

function platform(polygon: readonly PointXZ[], height: number, surface: GroundKind = 'snow'): Surface {
  return { polygon, height, surface };
}

function ramp(from: PointXYZ, to: PointXYZ, width: number, surface: GroundKind = 'snow'): Surface {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const distance = Math.hypot(dx, dz);
  const alongX = dx / distance;
  const alongZ = dz / distance;
  const sideX = alongZ * (width / 2);
  const sideZ = -alongX * (width / 2);
  const polygon = [
    [from[0] + sideX, from[2] + sideZ], [to[0] + sideX, to[2] + sideZ],
    [to[0] - sideX, to[2] - sideZ], [from[0] - sideX, from[2] - sideZ],
  ] as const;
  const slope = (to[1] - from[1]) / distance;
  const tilt = [alongX * slope, alongZ * slope] as const;
  const height = from[1] + (polygon[0][0] - from[0]) * tilt[0] + (polygon[0][1] - from[2]) * tilt[1];
  return { polygon, height, surface, tilt };
}

const SURFACES = [
  platform([[20,-66],[38,-66],[40,-56],[36,-46],[24,-45],[18,-54]], 10),
  ramp([30,10,-66], [30,16,-92], 13),
  platform(rectangle(24,-104,36.5,-92), ICE_LANDING),
  platform(rectangle(24,-120,36.5,-106.6), ICE_LANDING),
  platform(rectangle(22,-136,38,-120), ICE_LANDING),
  platform(rectangle(22,-146,31.5,-136), ICE_SHELF),
  platform(rectangle(22,-160,38,-146), UPPER_ICE),
  platform(rectangle(24,-192,38,-180.4), UPPER_ICE),
  platform(rectangle(24,-212,38,-200), SPINE_START),
  ramp([31,SPINE_START,-212], [31,31,-228], 3.6),
  ramp([31,31,-230.8], [31,34,-246], 3.6),
  ramp([31,34,-248.8], [31,CAIRN_HEIGHT,-264], 3.6),
  platform(rectangle(15,-243,22.5,-233), 29.5),
  platform(rectangle(24,-276,38,-264), CAIRN_HEIGHT),
  platform(rectangle(28,-280,34,-276), CAIRN_HEIGHT),
  platform(rectangle(20,-300,42,-280), CAIRN_HEIGHT),
  platform(rectangle(28,-304,34,-300), CAIRN_HEIGHT),
  platform(rectangle(22,-316,40,-304), CAIRN_HEIGHT),
  platform(rectangle(20,-332,42,-316), FALL_HEIGHT),
  platform(rectangle(-34,-332,-18,-314), FALL_HEIGHT),
  platform(rectangle(-33,-331,-26,-325), 52.2),
  platform(rectangle(-80,-331,-62.2,-315), LIFT_BASE),
  platform(rectangle(-94,-331,-80,-315), LIFT_BASE),
  platform(rectangle(-104,-358,-80,-335), LIFT_TOP),
  platform(rectangle(-108,-352,-104,-344), LIFT_TOP),
  platform(rectangle(-152,-366,-108,-338), LIFT_TOP),
  platform(rectangle(-156,-354,-152,-346), LIFT_TOP),
  ramp([-156,LIFT_TOP,-350], [-172,76.4,-350], 4.2, 'stair'),
  ramp([-173.8,76.4,-350], [-189,82,-350], 4.2, 'stair'),
  ramp([-194.4,82.2,-350], [-206,SUMMIT,-350], 4.2, 'stair'),
  platform(rectangle(-222,-360,-206,-340), SUMMIT),
  platform(rectangle(-226,-354,-222,-346), SUMMIT, 'stone'),
  platform(outline(ARENA_X, ARENA_Z, 17.5, 32, 0.13, false), SUMMIT, 'stone'),
  platform(rectangle(-264,-354,-260,-346), SUMMIT),
  platform([[-264,-355],[-290,-352.6],[-297,-350],[-290,-347.4],[-264,-345]], SUMMIT),
] as const;

const CLIFFS: readonly Wall[] = [
  [[[40.4,-44],[40.4,-60],[38.4,-66],[36.7,-70],[36.7,-120]],0,34],
  [[[38.2,-120],[38.2,-160]],8,44],
  [[[38.2,-160],[38.2,-212]],8,50],
  [[[41,-212],[41,-276]],14,56],
  [[[42.2,-276],[42.2,-304],[40.2,-304],[40.2,-316]],20,62],
  [[[42.2,-316],[42.2,-344],[20,-344]],30,72],
  [[[20,-344],[-34,-344]],30,76],
  [[[-34,-344],[-64,-344],[-79.8,-335]],34,78],
  [[[-80,-335],[-80,-372],[-108,-372],[-152,-372]],44,96],
  [[[-152,-372],[-222,-372]],54,112],
];

const FACES: readonly Wall[] = [
  [[[22,-136],[31.5,-136]],16.2,20.58],
  [[[31.5,-136],[38,-136]],16.2,26.999999999999996],
  [[[22,-146],[38,-146]],ICE_LANDING,23.979999999999997],
  [[[24,-200],[38,-200]],8,27.98],
  [[[20,-316],[42,-316]],36,50.98],
  [[[-104,-335],[-80,-335]],51.6,69.98],
];

const DOORS: readonly (readonly [group: string, path: Path, height: number, rise: number])[] = [
  ['cairn_in',[[28,-278],[34,-278]],CAIRN_HEIGHT,5],
  ['cairn_out',[[28,-302],[34,-302]],CAIRN_HEIGHT,5],
  ['gaunt_in',[[-106,-352],[-106,-344]],LIFT_TOP,5],
  ['gaunt_out',[[-154,-354],[-154,-346]],LIFT_TOP,5],
  ['duel_in',[[-224.6,-354],[-224.6,-346]],SUMMIT,6],
  ['duel_out',[[-261.6,-354],[-261.6,-346]],SUMMIT,6],
];

const PILLARS = [
  [2.25,15.6,6.4,1.1], [1.3,16.2,1.6,1], [0.55,16,3,1], [-1.2,15.8,3.6,1],
  [4.4,16.2,1.5,1], [3.55,15.8,2.7,1],
] as const;

const STONES: readonly Stone[] = [
  { x: 26.5, z: -75, top: 13.3, radius: 1.3, cap: { height: 12.92, radius: 0.52, drop: 0.24 },
    rim: [[1.2,-0.69,0.05],[1.26,0.49],[0.66,1.2],[-0.71,1.26,-0.3],[-1.32,-0.4,-0.15],[-0.53,-1.4,0.12]] },
  { x: 33.8, z: -84, top: 16, radius: 1.6, cap: { height: 15.62, radius: 0.48, drop: 0.4 },
    rim: [[-0.89,1.49],[-1.7,0.02],[-0.24,-1.85,0.25],[0.93,-1.34,0.1],[1.66,0.58,-0.35],[0.53,1.61,-0.3]] },
  { x: 25, z: -287, top: 38.8, radius: 1.1 },
  { x: 37, z: -294, top: 39, radius: 1.2 },
  { x: -122, z: -346, top: 71.8, radius: 1.4 },
  { x: -132, z: -358, top: 72, radius: 1.6 },
  { x: -142, z: -345, top: 71.6, radius: 1.2 },
  { x: 25, z: -86, top: 17.4, radius: 1.5 },
  { x: 24.4, z: -124.5, top: 19.2, radius: 1.4, cap: { height: 18.619999999999997, radius: 0.42, drop: 0.82 } },
  { x: 24.8, z: -151, top: 25.699999999999996, radius: 1.3, cap: { height: 25.199999999999996, radius: 0.39, drop: 0.6 } },
  { x: 22.8, z: -282.5, top: 38.5, radius: 1 },
  { x: 39.6, z: -283.5, top: 39.3, radius: 1.2 },
  { x: -21, z: -316.6, top: 52.7, radius: 1.2 },
  { x: -100, z: -355, top: 72.2, radius: 1.7 },
  { x: -113, z: -362, top: 73.4, radius: 1.7 },
  { x: -149, z: -363, top: 73.8, radius: 1.8 },
  { x: -135, z: -340, top: 72.4, radius: 1.3 },
  { x: -210, z: -357, top: 88.4, radius: 1.5 },
  { x: -219, z: -358, top: 87.7, radius: 1 },
];

const DISCS: readonly Disc[] = [
  [22.98,-91.02,1.27,15.25,18.36], [24.9,-85.94,1.32,14.1,17.41], [24.32,-124.43,1.24,16.8,18.96],
  [34,-278,0.54,36.6,42.75], [28,-302,0.54,36.6,42.75], [33.99,-302,0.55,36.6,42.75],
  [-71.65,-313.59,1.96,52.2,61.6], [-99.98,-355.19,1.46,69.6,72.06], [-106.01,-352.01,0.55,69.6,75.75],
  [-149.12,-363.17,1.64,69.6,73.28], [-224.6,-346,0.54,86,93.15], [-224.59,-354,0.55,86,93.15],
  [-261.6,-346,0.54,86,93.15], [-261.6,-354,0.54,86,93.15],
];

function heightAt({ polygon, height, tilt }: Surface, x: number, z: number) {
  const [originX, originZ] = polygon[0]!;
  return height + (tilt ? (x - originX) * tilt[0] + (z - originZ) * tilt[1] : 0);
}

function installGround(world: CollisionWorld) {
  for (const surface of SURFACES) {
    const { polygon } = surface;
    const positions: number[] = [];
    for (const face of ShapeUtils.triangulateShape(polygon.map(([x, z]) => new Vector2(x, z)), [])) {
      for (const index of face) {
        const [x, z] = polygon[index]!;
        positions.push(x, heightAt(surface, x, z), z);
      }
    }
    world.addTriangles(positions, { kind: 1, surface: surface.surface });
  }
}

function installGuardRims(world: CollisionWorld) {
  const ground = (x: number, z: number) => world.groundAt(x, z)?.y ?? 0;
  for (const surface of SURFACES) {
    const { polygon } = surface;
    const centerX = polygon.reduce((sum, [x]) => sum + x, 0) / polygon.length;
    const centerZ = polygon.reduce((sum, [, z]) => sum + z, 0) / polygon.length;
    for (const [edge, [x, z]] of polygon.entries()) {
      const [nextX, nextZ] = polygon[(edge + 1) % polygon.length]!;
      const length = Math.hypot(nextX - x, nextZ - z);
      const steps = Math.max(1, Math.ceil(length / 0.25));
      const alongX = (nextX - x) / length;
      const alongZ = (nextZ - z) / length;
      let outsideX = alongZ, outsideZ = -alongX;
      if ((x - centerX) * outsideX + (z - centerZ) * outsideZ < 0) {
        outsideX = -outsideX;
        outsideZ = -outsideZ;
      }
      let start: number | null = null;
      const finish = (end: number) => {
        if (start !== null && end - start > 0.02) {
          const path: Path = [
            [x + alongX * start, z + alongZ * start],
            [x + alongX * end, z + alongZ * end],
          ];
          world.addTriangles(extrudeWallPolyline(path, (x, z) => ground(x, z) - 1, (x, z) => ground(x, z) + 4), { kind: 4 });
        }
        start = null;
      };
      for (let step = 0; step < steps; step++) {
        const middle = (step + 0.5) / steps * length;
        const edgeX = x + alongX * middle;
        const edgeZ = z + alongZ * middle;
        const probeX = edgeX + outsideX * 0.3;
        const probeZ = edgeZ + outsideZ * 0.3;
        const edgeHeight = heightAt(surface, edgeX, edgeZ);
        const covered = SURFACES.some(other => other !== surface && pointInPolygon(probeX, probeZ, other.polygon) &&
          heightAt(other, probeX, probeZ) > edgeHeight - 3);
        if (covered) finish(step / steps * length);
        else if (start === null) start = step / steps * length;
      }
      finish(length);
    }
  }
}

function installWalls(world: CollisionWorld) {
  for (const [path, bottom, top] of CLIFFS) {
    world.addTriangles(extrudeWallPolyline(path, () => bottom, () => top), { kind: 2 | 8 });
  }
  for (const [path, bottom, top] of FACES) {
    world.addTriangles(extrudeWallPolyline(path, () => bottom, () => top), { kind: 2 });
  }
  for (const [group, path, height, rise] of DOORS) {
    world.addTriangles(extrudeWallPolyline(path, () => height - 1, () => height + rise), { kind: 2, group });
  }
  for (const [angle, distance, height, radius] of PILLARS) {
    const x = ARENA_X + Math.cos(angle) * distance;
    const z = ARENA_Z + Math.sin(angle) * distance;
    const path = outline(x, z, radius, 10, 0, true);
    world.addTriangles(extrudeWallPolyline(path, () => SUMMIT - 1, () => SUMMIT + height), { kind: 2, round: true });
  }
}

function installStone(world: CollisionWorld, { x, z, top, radius, cap, rim }: Stone) {
  const profile = rim ? [...rim, rim[0]!] : undefined;
  const ring = (ringRadius: number) => profile
    ? profile.map(([dx, dz]): PointXZ => [x + dx * ringRadius / radius, z + dz * ringRadius / radius])
    : outline(x, z, ringRadius, 10, 0, true);
  const outer = ring(radius);
  const topHeight = cap?.height ?? top;
  const shoulder = topHeight - (cap?.drop ?? 0);
  const rimHeights = profile ? profile.map(([, , offset = 0]) => shoulder + offset) : outer.map(() => shoulder);
  const bottom = outer.map(([x, z]) =>
    Math.min(shoulder - 2.5, (world.groundAt(x, z, shoulder - 0.05, shoulder - 8)?.y ?? Infinity) - 0.25));
  const positions: number[] = [];
  const sides: number[] = [];
  const center: PointXYZ = [x, topHeight, z];
  const inner = cap ? ring(cap.radius) : outer;
  for (let i = 0; i + 1 < outer.length; i++) {
    const [aX, aZ] = outer[i]!;
    const [bX, bZ] = outer[i + 1]!;
    const aRim: PointXYZ = [aX, rimHeights[i]!, aZ];
    const bRim: PointXYZ = [bX, rimHeights[i + 1]!, bZ];
    const capA: PointXYZ = [inner[i]![0], topHeight, inner[i]![1]];
    const capB: PointXYZ = [inner[i + 1]![0], topHeight, inner[i + 1]![1]];
    // Each authored sector writes its cap triangle before its sloping shoulders.
    positions.push(...center, ...capA, ...capB);
    if (cap) {
      if (aRim[1] > bRim[1]) positions.push(...capA, ...aRim, ...capB, ...capB, ...aRim, ...bRim);
      else positions.push(...capA, ...aRim, ...bRim, ...capA, ...bRim, ...capB);
    }
    const aBase: PointXYZ = [aX, bottom[i]!, aZ];
    const bBase: PointXYZ = [bX, bottom[i + 1]!, bZ];
    sides.push(...aBase, ...bBase, ...bRim, ...aBase, ...bRim, ...aRim);
  }
  world.addTriangles(positions, { kind: 1, surface: 'rock' });
  world.addTriangles(sides, { kind: 2 });
}

/** Build the published initial static collision, before chapter mechanics start. */
export function createChapterSixWorld(): ChapterSixWorld {
  const world = createCollisionWorld();
  installGround(world);
  installGuardRims(world);
  installWalls(world);
  for (const stone of STONES) installStone(world, stone);
  for (const disc of DISCS) world.addDisc(...disc);
  return { id: 'ch6_summit', spawn: chapterSixSpawn, killY: -14, killDrop: 17, world };
}
