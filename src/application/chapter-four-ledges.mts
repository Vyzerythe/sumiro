import type { PointXZ } from '../physics/geometry.mts';
import type { TraversalLedgeDefinition } from '../player/climbing-controller.mts';
import type { LeapDefinition } from '../player/leap.mts';

export interface ChapterFourTraversal {
  readonly ledges: readonly TraversalLedgeDefinition[];
  readonly leapLinks: readonly LeapDefinition[];
}

const rectangle = (x0: number, z0: number, x1: number, z1: number): PointXZ[] =>
  [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** Authored paths from ch4_temple-XtSLeUue.js. The published mesh clearance pass uses these points as input. */
export function createChapterFourTraversal(): ChapterFourTraversal {
  return {
    ledges: [
      { id: 'gable_low', climbable: false, points: [[48, 47.2, -339, 1, 0], [48, 47.2, -331, 1, 0], [48, 47.2, -323, 1, 0]] },
      { id: 'gable_top', climbable: true, points: [[48, 49.8, -335, 1, 0], [48, 49.8, -331, 1, 0], [48, 49.8, -327, 1, 0]] },
      { id: 'r3_eave', climbable: true, points: [[1, 55, -347, 0, 1], [12, 55, -347, 0, 1], [23, 55, -347, 0, 1]] },
      { id: 'et_low', climbable: false, points: [[44, 62.3, -445.5, -1, 0], [44, 62.3, -438.5, -1, 0]] },
      { id: 'et_top', climbable: true, points: [[44, 64.8, -443.5, -1, 0], [44, 64.8, -440.5, -1, 0]] },
    ],
    leapLinks: [
      {
        id: 'gate_out', from: { poly: rectangle(12, -74, 16, -64), yMin: 12 }, to: { land: [1.5, -69], spread: 3 },
        minSpeed: 4.2, maxAngle: 45, time: 0.9, clip: 'leap_generic', prompt: 'Space  leap',
      },
      {
        id: 'gate_back', from: { poly: rectangle(1, -74, 4, -64), yMin: 12 }, to: { land: [14.5, -69], spread: 3 },
        minSpeed: 4.2, maxAngle: 45, time: 0.9, clip: 'leap_generic',
      },
      {
        id: 'r3_up', from: { poly: rectangle(3, -340, 18, -336.5), yMin: 51 }, to: { ledge: 'r3_eave', sFrom: 2, sTo: 20 },
        minSpeed: 4.2, maxAngle: 50, time: 0.85, nominal: 7.8, clip: 'wall_leap', prompt: 'At a run, Space  leap',
      },
      {
        id: 'r3_down', from: { poly: rectangle(1, -350.5, 23, -347), yMin: 54 }, to: { land: [10, -337], spread: 4 },
        minSpeed: 4.2, maxAngle: 60, time: 0.95, clip: 'leap_generic',
      },
      { id: 'r3_drop', fromLedge: 'r3_eave', to: { land: [10, -337], spread: 4 }, time: 0.9, clip: 'leap_generic' },
    ],
  };
}
