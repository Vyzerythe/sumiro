/** Authored world-space ledges and leaps from ch5_sea-CpHUIhkX.js. */
import type { PointXZ } from '../physics/geometry.mts';
import type { TraversalLedgeDefinition } from '../player/climbing-controller.mts';
import type { LedgePoint } from '../player/ledge-path.mts';
import type { LeapDefinition } from '../player/leap.mts';

export interface ChapterFiveTraversal {
  readonly ledges: readonly TraversalLedgeDefinition[];
  readonly leapLinks: readonly LeapDefinition[];
}

type Outline = readonly [centerX: number, centerZ: number, radiusX: number, radiusZ: number, height: number,
  kind: 'rock' | 'stone'];

const OUTLINES = {
  r2: [34, -197, 14, 10, 3.6, 'rock'],
  scroll_rock: [13, -160, 5, 5, 3.6, 'rock'],
  r3: [34, -229, 15, 12, 6.2, 'rock'],
  dock4: [34, -256, 7, 5, 3.6, 'rock'],
  m4: [34, -304, 10, 10, 3.6, 'rock'],
  hidden: [-12, -304, 6, 6, 3.6, 'rock'],
  s1: [32.6, -142.6, 2.2, 2.2, 2.5, 'stone'],
  s2: [33.8, -148, 2.2, 2.2, 2.8, 'stone'],
  s3: [33, -153.2, 2.2, 2.2, 3.1, 'stone'],
  s4: [35.6, -166, 2.2, 2.2, 2.3, 'stone'],
  s8: [35.4, -184.4, 2.2, 2.2, 2.6, 'stone'],
  a1: [101.5, -389, 2.2, 2.2, 2.6, 'stone'],
  a2: [106.6, -388.4, 2.2, 2.2, 2.2, 'stone'],
  a3: [120.5, -390, 2.2, 2.2, 2.2, 'stone'],
  a5: [130.7, -390, 2.2, 2.2, 2.2, 'stone'],
  stack: [33.6, -160, 3.6, 3.6, 3.6, 'rock'],
  p1: [58.5, -304, 2.8, 2.8, 3.6, 'stone'],
  p2: [58.5, -324, 2.8, 2.8, 3.6, 'stone'],
  i5: [86, -324, 11, 9, 3.6, 'rock'],
  r7b: [139, -391, 4.5, 4.5, 3.6, 'rock'],
  dock10: [143.5, -530, 4.5, 5, 3.6, 'rock'],
  gw: [191.5, -530, 8.5, 7, 3.6, 'rock'],
  i10: [125, -530, 8, 9, 5.6, 'rock'],
} as const satisfies Readonly<Record<string, Outline>>;

type Arc = readonly [id: string, outline: keyof typeof OUTLINES, first: number, samples: number];

// Measured contour index spans after the source's authored region and adjacent
// rock-clearance filters. A span may wrap through index zero or close the ring.
const ARCS: readonly Arc[] = [
  ['l_r2_s', 'r2', 4, 4], ['l_r2_s_1', 'r2', 9, 4],
  ['l_scroll_s', 'scroll_rock', 15, 5], ['l_scroll_s_1', 'scroll_rock', 29, 5],
  ['l_r3_s', 'r3', 3, 11], ['l_dock4_n', 'dock4', 18, 13],
  ['l_m4_s', 'm4', 4, 9], ['l_m4_w', 'm4', 13, 7], ['l_m4_e', 'm4', 29, 7],
  ['l_hidden_e', 'hidden', 27, 11],
  ['l_s1', 's1', 11, 4], ['l_s1_1', 's1', 4, 5],
  ['l_s2', 's2', 11, 4], ['l_s2_1', 's2', 5, 3],
  ['l_s3', 's3', 11, 3], ['l_s3_1', 's3', 5, 3],
  ['l_s4', 's4', 11, 3], ['l_s8', 's8', 0, 2],
  ['l_a1', 'a1', 2, 3], ['l_a1_1', 'a1', 8, 3], ['l_a2', 'a2', 8, 9],
  ['l_a3', 'a3', 2, 3], ['l_a3_1', 'a3', 8, 3],
  ['l_a5', 'a5', 1, 4], ['l_a5_1', 'a5', 8, 4],
  ['l_stack', 'stack', 30, 9], ['l_stack_1', 'stack', 11, 13],
  ['l_p1', 'p1', 0, 13], ['l_p2', 'p2', 0, 13],
  ['l_i5_w', 'i5', 12, 9], ['l_r7b', 'r7b', 0, 20], ['l_r7b_1', 'r7b', 29, 3],
  ['l_dock10_e', 'dock10', 27, 11], ['l_gw_w', 'gw', 11, 11], ['l_i10_s', 'i10', 3, 11],
];

function createLedge([id, outline, first, samples]: Arc): TraversalLedgeDefinition {
  const [centerX, centerZ, radiusX, radiusZ, y, kind] = OUTLINES[outline];
  const sides = kind === 'rock' ? 32 : 12;
  const power = kind === 'rock' ? 3.2 : 2;
  const polygon = Array.from({ length: sides }, (_, index): PointXZ => {
    const angle = index / sides * Math.PI * 2;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    return [centerX + radiusX * Math.sign(cosine) * Math.abs(cosine) ** (2 / power),
      centerZ + radiusZ * Math.sign(sine) * Math.abs(sine) ** (2 / power)];
  });
  const rim = polygon.map(([x, z], index): LedgePoint => {
    const [priorX, priorZ] = polygon[(index + sides - 1) % sides]!;
    const [nextX, nextZ] = polygon[(index + 1) % sides]!;
    let ox = nextZ - priorZ;
    let oz = -(nextX - priorX);
    const length = Math.hypot(ox, oz) || 1;
    ox /= length;
    oz /= length;
    if (ox * (x - centerX) + oz * (z - centerZ) < 0) { ox = -ox; oz = -oz; }
    return [x, y, z, ox, oz];
  });
  const points = Array.from({ length: samples }, (_, offset) => rim[(first + offset) % sides]!);
  return { id, climbable: true, points };
}

const rectangle = (x0: number, z0: number, x1: number, z1: number): PointXZ[] =>
  [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** Chapter Five's kit init clears visual body room without moving these paths. */
export function createChapterFiveTraversal(): ChapterFiveTraversal {
  const leapLinks: LeapDefinition[] = [
    { id: 'to_scroll', from: { poly: rectangle(30, -163, 32, -157), yMin: 2.6 },
      to: { land: [17.2, -159.5], spread: 2.4 }, minSpeed: 4.2, maxAngle: 50, time: 0.9,
      clip: 'leap_generic', prompt: 'Space  leap' },
    { id: 'from_scroll', from: { poly: rectangle(16, -164, 18.2, -156), yMin: 2.6 },
      to: { land: [33, -160], spread: 1.4 }, minSpeed: 4.2, maxAngle: 50, time: 0.9, clip: 'leap_generic' },
    { id: 'court_over', from: { poly: rectangle(118, -512.3, 132, -508.5), yMin: 2.6, yMax: 4.6 },
      to: { ledge: 'l_i10_s', sFrom: 2, sTo: 13 }, minSpeed: 4.2, maxAngle: 50, time: 0.85, nominal: 8,
      clip: 'wall_leap', prompt: 'Space  leap to the far rock', camera: { zone: 'gap' } },
    { id: 'court_back', from: { poly: rectangle(118, -523, 132, -520.6), yMin: 4.6 },
      to: { land: [125, -509.5], spread: 3.5 }, minSpeed: 4.2, maxAngle: 55, time: 0.95,
      clip: 'leap_generic', camera: { zone: 'court' } },
    { id: 'court_wall_back', fromLedge: 'l_i10_s', to: { land: [125, -509.5], spread: 3.5 },
      time: 0.9, clip: 'leap_generic', camera: { zone: 'court' } },
  ];
  return { ledges: ARCS.map(createLedge), leapLinks };
}
