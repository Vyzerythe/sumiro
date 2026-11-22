import type { PointXZ } from '../physics/geometry.mts';

export type ChapterOneLedgeId = 'rim_front' | 'crack' | 'table_low' | 'table_lip';
export type ChapterOneLedgePoint = readonly [x: number, y: number, z: number, outwardX: number, outwardZ: number];

export interface ChapterOneLedge {
  readonly id: ChapterOneLedgeId;
  readonly points: readonly ChapterOneLedgePoint[];
  readonly climbable: boolean;
  readonly rimFrom?: number;
  readonly rimStep?: number;
  readonly hopTo?: ChapterOneLedgeId;
  readonly camera?: { readonly stay: true };
  /** The published loader fits this ledge to the loaded course meshes. */
  readonly snap?: true;
}

export type ChapterOneLeapDestination =
  | { readonly ledge: ChapterOneLedgeId; readonly sFrom: number; readonly sTo: number }
  | { readonly land: PointXZ; readonly spread: number };

type LeapSource = {
  readonly from: { readonly poly: readonly PointXZ[]; readonly yMin: number; readonly yMax?: number };
  readonly minSpeed: number;
  readonly maxAngle: number;
  readonly prompt: string;
  readonly fromLedge?: never;
} | {
  readonly fromLedge: ChapterOneLedgeId;
  readonly from?: never;
  readonly minSpeed?: never;
  readonly maxAngle?: never;
  readonly prompt?: never;
};

export type ChapterOneLeapLink = LeapSource & {
  readonly id: 'gap_forward' | 'gap_back' | 'wall_back' | 'shelf_crack';
  readonly to: ChapterOneLeapDestination;
  readonly time: number;
  readonly clip: 'wall_leap' | 'leap_generic';
  readonly camera: { readonly toF: number } | { readonly toLanding: true };
};

// Authored rim keys from ch1_climb-D1obDXnH.js, including the neighbors used to
// smooth the face offset. The sampled ranges use keys 4.5 through 15.5.
const RIM_STEP = 0.5;
const FIRST_RIM_KEY = 9;
type RimKey = readonly [x: number, y: number, z: number, outwardX: number, outwardZ: number, faceOffset: number];
const rimKeys: readonly RimKey[] = [
  [5.441, 8.22, -55.266, -0.87, 0.49, 0.39],
  [5.694, 8.236, -54.838, -0.85, 0.53, 0.11],
  [5.967, 8.252, -54.426, -0.81, 0.58, 0.28],
  [6.265, 8.265, -54.027, -0.79, 0.61, 0.5],
  [6.572, 8.277, -53.634, -0.78, 0.62, 0.52],
  [6.891, 8.283, -53.255, -0.74, 0.67, 0.4],
  [7.234, 8.279, -52.896, -0.71, 0.71, 0.39],
  [7.588, 8.273, -52.543, -0.71, 0.71, 0.42],
  [7.939, 8.269, -52.186, -0.72, 0.7, 0.4],
  [8.286, 8.268, -51.826, -0.72, 0.69, 0.56],
  [8.637, 8.269, -51.473, -0.69, 0.72, 0.47],
  [9.002, 8.273, -51.138, -0.65, 0.76, 0.3],
  [9.388, 8.279, -50.855, -0.49, 0.87, 0.38],
  [9.825, 8.286, -50.678, -0.27, 0.96, 0.23],
  [10.29, 8.293, -50.599, -0.04, 1, 0.22],
  [10.751, 8.294, -50.655, 0.25, 0.97, 0.19],
  [11.219, 8.291, -50.802, 0.33, 0.94, 0.27],
  [11.68, 8.291, -50.982, 0.39, 0.92, 0.16],
  [12.132, 8.296, -51.189, 0.43, 0.9, 0.3],
  [12.58, 8.303, -51.408, 0.45, 0.89, 0.32],
  [13.01, 8.31, -51.648, 0.53, 0.85, 0.28],
  [13.422, 8.318, -51.924, 0.57, 0.82, 0.16],
  [13.829, 8.326, -52.213, 0.58, 0.81, 0.13],
];

const interpolate = (from: number, to: number, fraction: number) => from + (to - from) * fraction;

function sampleRim(distance: number): RimKey {
  const position = distance / RIM_STEP;
  const lower = Math.floor(position);
  const index = lower - FIRST_RIM_KEY;
  const fraction = position - lower;
  const from = rimKeys[index]!;
  const to = rimKeys[index + 1]!;
  const outwardX = interpolate(from[3], to[3], fraction);
  const outwardZ = interpolate(from[4], to[4], fraction);
  const length = Math.hypot(outwardX, outwardZ) || 1;
  let faceOffset = 0;
  for (let key = index - 2; key <= index + 3; key++) {
    faceOffset += Math.min(Math.max(rimKeys[key]![5], 0.05), 0.6);
  }
  return [
    interpolate(from[0], to[0], fraction),
    interpolate(from[1], to[1], fraction),
    interpolate(from[2], to[2], fraction),
    outwardX / length, outwardZ / length, faceOffset / 6,
  ];
}

function crackDrop(distance: number): number {
  if (distance < 8.9) return 2.2;
  return distance < 9.55 ? interpolate(2.2, 1.87, (distance - 8.9) / 0.65) : 1.87;
}

function sampleLedge(rimFrom: number, rimTo: number, crack = false): ChapterOneLedgePoint[] {
  const points: ChapterOneLedgePoint[] = [];
  for (let distance = rimFrom; distance <= rimTo + 1e-6; distance += RIM_STEP) {
    const [x, y, z, outwardX, outwardZ, faceOffset] = sampleRim(distance);
    const outward = crack ? 0.42 : faceOffset;
    points.push([x + outwardX * outward, y - (crack ? crackDrop(distance) : 0), z + outwardZ * outward,
      outwardX, outwardZ]);
  }
  return points;
}

/** Authored ledges in grab-priority order, before Chapter One's course-mesh snap. */
export const chapterOneLedges: readonly ChapterOneLedge[] = [
  { id: 'rim_front', points: sampleLedge(5.5, 14.2), climbable: true, rimFrom: 5.5, rimStep: RIM_STEP },
  { id: 'crack', points: sampleLedge(7.2, 10.8, true), climbable: false, rimFrom: 7.2, rimStep: RIM_STEP,
    hopTo: 'rim_front' },
  { id: 'table_low', points: [[8.9, 8, -42.78, 0, -1], [9.9, 8, -42.78, 0, -1], [10.95, 8, -42.78, 0, -1]],
    climbable: false, camera: { stay: true } },
  { id: 'table_lip', points: [[11.15, 9.72, -42.15, 0, -1], [10.5, 9.72, -42.15, 0, -1]],
    climbable: true, camera: { stay: true }, snap: true },
];

const gapBackRegion: PointXZ[] = [];
for (let distance = 5.5; distance <= 13.5; distance++) {
  const [x, , z, outwardX, outwardZ] = sampleRim(distance);
  gapBackRegion.push([x + outwardX * 0.7, z + outwardZ * 0.7]);
}
gapBackRegion.push([11.6, -54.3], [9.3, -55.6], [7.6, -56.4]);

const shelfLanding = { land: [2.7, -43], spread: 0.7 } as const;

/** Authored leap links in the level's first-match order. */
export const chapterOneLeapLinks: readonly ChapterOneLeapLink[] = [
  {
    id: 'gap_forward',
    from: { poly: [[1, -45.2], [2.4, -46.7], [3.4, -46.5], [5.4, -45.1], [5.3, -43.5], [3.9, -42.7],
      [1.7, -42.95], [0.72, -44]], yMin: 5 },
    to: { ledge: 'rim_front', sFrom: 6.5, sTo: 10.9 },
    minSpeed: 4.2, maxAngle: 50, time: 0.78, clip: 'wall_leap', prompt: 'Space  leap', camera: { toF: 228 },
  },
  {
    id: 'gap_back', from: { poly: gapBackRegion, yMin: 7.5 }, to: shelfLanding,
    minSpeed: 4.2, maxAngle: 85, time: 0.92, clip: 'leap_generic', prompt: 'Space  leap back',
    camera: { toLanding: true },
  },
  {
    id: 'wall_back', fromLedge: 'rim_front', to: shelfLanding,
    time: 0.8, clip: 'leap_generic', camera: { toLanding: true },
  },
  {
    id: 'shelf_crack', from: { poly: [[5.6, -46.3], [10.6, -46.3], [10.4, -43.9], [5.5, -43.9]], yMin: 4.2, yMax: 5 },
    to: { ledge: 'crack', sFrom: 7.4, sTo: 10.6 },
    minSpeed: 4.2, maxAngle: 55, time: 0.72, clip: 'leap_generic', prompt: 'Space  leap', camera: { toF: 228 },
  },
];
