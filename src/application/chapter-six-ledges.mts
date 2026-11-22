/** Authored ledges, body anchors, and leaps from ch6_summit-BczK7QHX.js. */
import type { PointXZ } from '../physics/geometry.mts';
import type { CollisionWorld } from '../physics/world.mts';
import type { TraversalLedgeDefinition } from '../player/climbing-controller.mts';
import type { LedgePoint } from '../player/ledge-path.mts';
import type { LeapDefinition } from '../player/leap.mts';

export interface ChapterSixLedge extends TraversalLedgeDefinition {
  readonly attach?: string;
}

export interface ChapterSixTraversal {
  readonly ledges: readonly ChapterSixLedge[];
  readonly leapLinks: readonly LeapDefinition[];
  /** Body IDs omitted only when the caller explicitly requests the static projection. */
  readonly skippedBodyIds: readonly string[];
}

type Hold = Readonly<{
  id: string; x0: number; x1: number; y: number; z: number; climbable?: true; attach?: string;
}>;

const HOLDS: readonly Hold[] = [
  { id: 'ice_a1', x0: 26, x1: 33, y: 20.599999999999998, z: -136, climbable: true, attach: 'body_ice_a1' },
  { id: 'ice_a2', x0: 23, x1: 26, y: 23.999999999999996, z: -146, attach: 'body_ice_a2' },
  { id: 'ice_a3', x0: 28, x1: 31, y: 23.999999999999996, z: -146, attach: 'body_ice_a3' },
  { id: 'rock_a4', x0: 32.2, x1: 36.5, y: 23.999999999999996, z: -146, climbable: true },
  { id: 'a3_lip', x0: 25, x1: 37, y: 28, z: -200, climbable: true },
  { id: 'f1', x0: 28, x1: 33, y: 40.4, z: -316 },
  { id: 'f2', x0: 30, x1: 33.5, y: 43, z: -316, attach: 'body_f2' },
  { id: 'f3', x0: 27, x1: 30.5, y: 45.6, z: -316, attach: 'body_f3' },
  { id: 'f4', x0: 27, x1: 34, y: 48.3, z: -316 },
  { id: 'f5', x0: 26, x1: 36, y: 51, z: -316, climbable: true },
];

function localOrigin(hold: Hold) { return (hold.x0 + hold.x1) / 2; }

/** The original mechanism loader installs empty switch bodies at these origins. */
export const chapterSixLedgeAttachments = HOLDS.flatMap(hold => hold.attach ? [{
  id: hold.id, bodyId: hold.attach, x: localOrigin(hold), y: hold.y, z: hold.z,
}] : []);

function sampleHold(x0: number, x1: number, y: number, z: number): LedgePoint[] {
  const samples = Math.max(2, Math.ceil(Math.abs(x1 - x0) / 3) + 1);
  return Array.from({ length: samples }, (_, index) => [x0 + (x1 - x0) * index / (samples - 1), y, z, 0, 1]);
}

const rectangle = (x0: number, z0: number, x1: number, z1: number): PointXZ[] =>
  [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** Bind authored local-space holds after the caller has installed its moving bodies. */
export function createChapterSixTraversal(
  world: Pick<CollisionWorld, 'body'>, { skipUnresolvedBodies = false }: { skipUnresolvedBodies?: boolean } = {},
): ChapterSixTraversal {
  const ledges: ChapterSixLedge[] = [];
  const skippedBodyIds: string[] = [];
  for (const hold of HOLDS) {
    const { id, x0, x1, y, z, climbable = false, attach } = hold;
    if (!attach) {
      ledges.push({ id, climbable, points: sampleHold(x0, x1, y, z) });
      continue;
    }
    const body = world.body(attach);
    if (!body) {
      if (!skipUnresolvedBodies) throw Error(`Chapter Six ledge ${id} requires body ${attach}`);
      skippedBodyIds.push(attach);
      continue;
    }
    const origin = localOrigin(hold);
    ledges.push({ id, climbable, points: sampleHold(x0 - origin, x1 - origin, 0, 0), attach, body });
  }

  const leapLinks: LeapDefinition[] = [
    { id: 'cornice_up', from: { poly: rectangle(25, -192, 37, -188.6), yMin: 22.999999999999996 },
      to: { ledge: 'a3_lip', sFrom: 0.5, sTo: 11.5 }, minSpeed: 4.2, maxAngle: 50, time: 0.8, nominal: 7.8,
      clip: 'wall_leap', prompt: 'Space  leap to the wall', camera: { zone: 'z_a4' } },
    { id: 'cornice_back', from: { poly: rectangle(25, -203, 37, -200), yMin: 27 },
      to: { land: [31, -190], spread: 5 }, minSpeed: 4.2, maxAngle: 60, time: 0.95, clip: 'leap_generic' },
    { id: 'cornice_wall_back', fromLedge: 'a3_lip', to: { land: [31, -190], spread: 5 },
      time: 0.9, clip: 'leap_generic' },
    { id: 'secret_down', from: { poly: rectangle(29, -242, 30.5, -234), yMin: 30 }, to: { land: [18.6, -238], spread: 2 },
      minSpeed: 3.6, maxAngle: 55, time: 0.95, nominal: 9, clip: 'leap_generic' },
    { id: 'secret_up', from: { poly: rectangle(20, -242, 22.5, -234), yMin: 29 }, to: { land: [31, -238], spread: 2.5 },
      minSpeed: 3.6, maxAngle: 55, time: 1.05, nominal: 9, clip: 'leap_generic' },
  ];
  return { ledges, leapLinks, skippedBodyIds };
}
