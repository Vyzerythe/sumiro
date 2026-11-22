import type { PointXZ } from '../physics/geometry.mts';
import type { TraversalLedgeDefinition } from '../player/climbing-controller.mts';
import type { LedgePoint } from '../player/ledge-path.mts';
import type { LeapDefinition } from '../player/leap.mts';

type Path = readonly [PointXZ, PointXZ, ...PointXZ[]];
type ClimbableEndpoints = readonly [first: PointXZ, last: PointXZ];
type LedgeSpec = readonly [id: string, y: number, path: Path, outward: PointXZ,
  climbable?: boolean | ClimbableEndpoints];

export interface ChapterTwoTraversal {
  readonly ledges: readonly TraversalLedgeDefinition[];
  readonly leapLinks: readonly LeapDefinition[];
}

// Original T(...) calls in ch2_pass-9Opjv4P2.js, including the generated
// east/west ledges on the five ink rocks. Order matters for grab priority.
const LEDGES: readonly LedgeSpec[] = [
  ['crack1', 11.6, [[11, -100], [27.6, -100]], [0, 1], [[21.6, -100], [27.6, -100]]],
  ['cornice_a', 13.9, [[36, -113], [46, -113], [46, -115.6]], [0, 1]],
  ['cornice_b', 13.9, [[46, -118.2], [46, -120.6]], [1, 0]],
  ['cornice_c', 13.9, [[46, -123.2], [46, -133.6]], [1, 0], [[46, -124.5], [46, -133.6]]],
  ['hop_a', 17.2, [[33, -136], [42.5, -136]], [0, 1]],
  ['hop_b', 20, [[40.5, -136], [43.5, -136]], [0, 1]],
  ['hop_c', 20, [[46, -136], [49, -136]], [0, 1]],
  ['hop_c2', 20, [[51.4, -136], [53.2, -136]], [0, 1]],
  ['hop_d', 21.6, [[55, -136], [63.6, -136]], [0, 1], true],
  ['land1_n', 24.6, [[55.3, -157], [62.7, -157]], [0, -1], true],
  ['land2_s', 24.6, [[55.3, -159.8], [62.7, -159.8]], [0, 1], true],
  ['land3_n', 27.6, [[54.3, -175], [62.7, -175]], [0, -1], true],
  ['land4_s', 27.6, [[54.3, -178.4], [59.7, -178.4]], [0, 1], true],
  ['r6_s', 33.5, [[47, -201.5], [65, -201.5]], [0, 1], true],
  ['well_s', 33.5, [[56.4, -209], [61.6, -209]], [0, -1], true],
  ['well_n', 33.5, [[56.4, -216], [61.6, -216]], [0, 1], true],
  ['e1', 33.9, [[51, -218], [51, -224]], [-1, 0]],
  ['w1', 35.9, [[46, -219], [46, -225]], [1, 0]],
  ['e2', 37.9, [[51, -221], [51, -227]], [-1, 0]],
  ['w2', 39.9, [[46, -222], [46, -227.5]], [1, 0], true],
  ['r6_n', 33.5, [[46.3, -216], [50.7, -216]], [0, -1], true],
  ['ink_a_e', 39.9, [[19, -217.2], [19, -222.8]], [1, 0], true],
  ['ink_a_w', 39.9, [[15, -217.2], [15, -222.8]], [-1, 0], true],
  ['ink_b_e', 39.9, [[10, -217.2], [10, -222.8]], [1, 0], true],
  ['ink_b_w', 39.9, [[4, -217.2], [4, -222.8]], [-1, 0], true],
  ['ink_c_e', 39.9, [[-2.5, -217.2], [-2.5, -222.8]], [1, 0], true],
  ['ink_c_w', 39.9, [[-8.5, -217.2], [-8.5, -222.8]], [-1, 0], true],
  ['ink_d_e', 39.9, [[-14, -217.2], [-14, -222.8]], [1, 0], true],
  ['ink_d_w', 39.9, [[-20, -217.2], [-20, -222.8]], [-1, 0], true],
  ['ink_e_e', 39.9, [[-27, -217.2], [-27, -222.8]], [1, 0], true],
  ['ink_e_w', 39.9, [[-33, -217.2], [-33, -222.8]], [-1, 0], true],
  ['ink_far_e', 39.9, [[-40.5, -213.5], [-40.5, -226.5]], [1, 0], true],
  ['top_w', 39.9, [[22, -213], [22, -225.5]], [-1, 0], true],
  ['ink_far_n', 39.9, [[-53.6, -230], [-42.4, -230]], [0, -1], true],
  ['g_mid_s', 39.9, [[-53.6, -249], [-38.4, -249]], [0, 1], true],
  ['g_far_w', 41.4, [[-10, -248.6], [-10, -259.4]], [-1, 0], true],
  ['h1a', 43.8, [[16, -259.5], [16, -254]], [-1, 0]],
  ['h1b', 43.8, [[16, -252.3], [16, -250], [23.6, -250]], [-1, 0]],
  ['h2', 45.6, [[23, -245], [29, -245]], [0, -1]],
  ['h3', 47.8, [[24.5, -245], [31, -245]], [0, -1]],
  ['h4', 49.6, [[25, -250], [33, -250]], [0, 1], true],
  ['sn1', 52.8, [[26, -264], [32, -264]], [0, 1]],
  ['sn2', 55.2, [[27, -264], [31, -264]], [0, 1]],
  ['sn3', 57.6, [[26.5, -264], [32, -264]], [0, 1], true],
  ['i_l1_s', 54.1, [[32.3, -281.5], [42.7, -281.5]], [0, 1], true],
  ['i_l2_s', 54.1, [[29.3, -294.5], [39.7, -294.5]], [0, 1], true],
  ['i_crack', 58.7, [[33, -305], [53.6, -305]], [0, 1], [[42.5, -305], [53.6, -305]]],
  ['k1', 60.6, [[40, -325.5], [52, -325.5], [52, -331.5]], [0, 1]],
  ['k2', 63, [[52, -332], [52, -336]], [1, 0]],
  ['k3', 64.9, [[52.4, -337], [59.6, -337]], [0, 1], true],
  ['spur_s', 64.9, [[44.4, -361], [51.6, -361]], [0, 1], true],
];

function direction([x0, z0]: PointXZ, [x1, z1]: PointXZ): PointXZ {
  const length = Math.hypot(x1 - x0, z1 - z0);
  return [(x1 - x0) / length, (z1 - z0) / length];
}

// Range endpoints are authored on the centerline, before the corner samples
// are added to the grab path.
function distanceOnPath(path: Path, [x, z]: PointXZ): number {
  let accumulated = 0;
  let nearest = Infinity;
  let distance = 0;
  for (let index = 0; index + 1 < path.length; index++) {
    const [x0, z0] = path[index]!;
    const [x1, z1] = path[index + 1]!;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const length = Math.hypot(dx, dz);
    const fraction = Math.min(Math.max(((x - x0) * dx + (z - z0) * dz) / (length * length), 0), 1);
    const gap = Math.hypot(x0 + dx * fraction - x, z0 + dz * fraction - z);
    if (gap < nearest) {
      nearest = gap;
      distance = accumulated + length * fraction;
    }
    accumulated += length;
  }
  return distance;
}

function createLedge([id, y, path, outward, climb = false]: LedgeSpec): TraversalLedgeDefinition {
  const [firstX, firstZ] = direction(path[0], path[1]);
  const sign = firstZ * outward[0] - firstX * outward[1] >= 0 ? 1 : -1;
  const perpendicular = ([dx, dz]: PointXZ): PointXZ => [dz * sign, -dx * sign];
  const points: LedgePoint[] = [];
  for (const [index, anchor] of path.entries()) {
    const [x, z] = anchor;
    const incoming = index > 0 ? direction(path[index - 1]!, anchor) : null;
    const outgoing = index + 1 < path.length ? direction(anchor, path[index + 1]!) : null;
    if (incoming && outgoing) {
      const [inX, inZ] = perpendicular(incoming);
      const [outX, outZ] = perpendicular(outgoing);
      points.push(
        [x - incoming[0] * 0.2, y, z - incoming[1] * 0.2, inX, inZ],
        [x, y, z, inX + outX, inZ + outZ],
        [x + outgoing[0] * 0.2, y, z + outgoing[1] * 0.2, outX, outZ],
      );
    } else {
      const [ox, oz] = perpendicular((incoming ?? outgoing)!);
      points.push([x, y, z, ox, oz]);
    }
  }
  const climbable = typeof climb === 'boolean' ? climb : [[distanceOnPath(path, climb[0]), distanceOnPath(path, climb[1])]] as const;
  return { id, climbable, points };
}

/** Fresh authored paths and routes. Chapter Two declares no body attachments. */
export function createChapterTwoTraversal(): ChapterTwoTraversal {
  const leapLinks: LeapDefinition[] = [
    {
      id: 'stair_gap',
      from: { poly: [[52, -190.4], [62, -190.4], [62, -194.2], [52, -194.2]], yMin: 29.650000000000002 },
      to: { ledge: 'r6_s', sFrom: 5, sTo: 15 },
      minSpeed: 4.2, maxAngle: 50, clip: 'wall_leap', time: 0.8, nominal: 7.8, prompt: 'Space  leap for the ledge',
    },
    {
      id: 'stair_back',
      from: { poly: [[50, -203.8], [64, -203.8], [64, -201.4], [50, -201.4]], yMin: 32.5 },
      to: { land: [57, -192], spread: 3.5 },
      minSpeed: 4.2, maxAngle: 60, clip: 'leap_generic', time: 0.95, nominal: 8.5,
    },
    {
      id: 'stair_wall_back',
      fromLedge: 'r6_s',
      to: { land: [57, -192], spread: 3.5 },
      clip: 'leap_generic', time: 0.9, nominal: 8.5,
    },
    {
      id: 'e1_w1',
      fromLedge: 'e1',
      to: { ledge: 'w1', sFrom: 0, sTo: 6 },
      clip: 'wall_leap', time: 0.62, nominal: 4.6,
    },
    {
      id: 'w1_e2',
      fromLedge: 'w1',
      to: { ledge: 'e2', sFrom: 0, sTo: 6 },
      clip: 'wall_leap', time: 0.62, nominal: 4.6,
    },
    {
      id: 'e2_w2',
      fromLedge: 'e2',
      to: { ledge: 'w2', sFrom: 0, sTo: 6 },
      clip: 'wall_leap', time: 0.62, nominal: 4.6,
    },
    {
      id: 'cleft_back',
      from: { poly: [[43.4, -221.5], [46.2, -221.5], [46.2, -228], [43.4, -228]], yMin: 38.9 },
      to: { ledge: 'e2', sFrom: 0, sTo: 6 },
      minSpeed: 3, maxAngle: 70, clip: 'wall_leap', time: 0.62, nominal: 4.6,
      camera: { zone: 'cleft' },
    },
    {
      id: 'tooth_leap',
      from: { poly: [[2.5, -247.5], [8.2, -247.5], [8.2, -261], [2.5, -261]], yMin: 40.4 },
      to: { ledge: 'h1a', sFrom: 0.4, sTo: 5.1 },
      minSpeed: 4.2, maxAngle: 50, clip: 'wall_leap', time: 0.82, nominal: 8, prompt: 'Space  leap for the crack',
      camera: { zone: 'tooth_face' },
    },
    {
      id: 'tooth_wall_back',
      fromLedge: 'h1a',
      to: { land: [4.5, -254.5], spread: 3 },
      clip: 'leap_generic', time: 0.85, nominal: 8,
    },
    {
      id: 'h1b_h2',
      fromLedge: 'h1b',
      to: { ledge: 'h2', sFrom: 0, sTo: 6 },
      clip: 'wall_leap', time: 0.62, nominal: 4.6,
      camera: { zone: 'tooth_gap' },
    },
    {
      id: 'h3_h4',
      fromLedge: 'h3',
      to: { ledge: 'h4', sFrom: 0, sTo: 8 },
      clip: 'wall_leap', time: 0.62, nominal: 4.6,
      camera: { zone: 'tooth_gap' },
    },
    {
      id: 'tooth_back',
      from: { poly: [[25, -252.4], [33, -252.4], [33, -249.9], [25, -249.9]], yMin: 48.6 },
      to: { ledge: 'h3', sFrom: 0, sTo: 6.5 },
      minSpeed: 3, maxAngle: 60, clip: 'wall_leap', time: 0.62, nominal: 4.6,
      camera: { zone: 'tooth_gap' },
    },
    {
      id: 'knife_leap',
      from: { poly: [[42.5, -314], [54, -314], [54, -318.1], [42.5, -318.1]], yMin: 57.7 },
      to: { ledge: 'k1', sFrom: 3, sTo: 11.6 },
      minSpeed: 4.2, maxAngle: 50, clip: 'wall_leap', time: 0.8, nominal: 7.6, prompt: 'Space  leap for the crack',
      camera: { zone: 'k_face' },
    },
    {
      id: 'knife_wall_back',
      fromLedge: 'k1',
      to: { land: [47.5, -315.5], spread: 3 },
      clip: 'leap_generic', time: 0.85, nominal: 7.6,
    },
  ];
  return { ledges: LEDGES.map(createLedge), leapLinks };
}
