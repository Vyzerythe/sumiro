import type { PointXZ } from '../physics/geometry.mts';
import type { TraversalLedgeDefinition } from '../player/climbing-controller.mts';
import type { LeapDefinition } from '../player/leap.mts';

export interface ChapterThreeTraversal {
  readonly ledges: readonly TraversalLedgeDefinition[];
  readonly leapLinks: readonly LeapDefinition[];
}

/** Authored paths from ch3_pines-BCHma7IG.js. Later shelf and clearance work adjusts the render meshes. */
export function createChapterThreeTraversal(): ChapterThreeTraversal {
  const farWallLaunch: PointXZ[] = Array.from({ length: 12 }, (_, index) => {
    const angle = 0.13 + index / 12 * Math.PI * 2;
    return [-183.4 + Math.cos(angle) * 3.9, -199 + Math.sin(angle) * 3.9];
  });
  return {
    ledges: [
      { id: 'face_a', climbable: false, points: [[34, 23, -120.6, -1, 0], [34, 23, -128, -1, 0]] },
      { id: 'face_b', climbable: false, points: [[34, 24.1, -130, -1, 0], [34, 24.1, -136, -1, 0]] },
      { id: 'face_c', climbable: true, points: [[34, 26, -136.6, -1, 0], [34, 26, -157.6, -1, 0]] },
      { id: 'w1_lip', climbable: true, points: [[-24.4, 25, -200.2, 1, 0], [-24.4, 25, -189.8, 1, 0]] },
      { id: 'r8_face', climbable: true, points: [[-195.6, 28, -205, 1, 0], [-195.6, 28, -195.2, 1, 0]] },
      { id: 'r10_lip', climbable: true, points: [[-306.59999999999997, 30, -213, 1, 0], [-306.59999999999997, 30, -198.2, 1, 0]] },
      { id: 'wall_a', climbable: false, points: [[-424.99999999999994, 37, -214, 0, 1], [-431.99999999999994, 37, -214, 0, 1]] },
      { id: 'wall_b', climbable: false, points: [[-433.59999999999997, 38.6, -214, 0, 1], [-437.2, 38.6, -214, 0, 1]] },
      { id: 'wall_c', climbable: true, points: [[-437.99999999999994, 41.2, -214, 0, 1], [-451.2, 41.2, -214, 0, 1]] },
    ],
    leapLinks: [
      {
        id: 'far_wall', from: { poly: farWallLaunch, yMin: 24 }, to: { ledge: 'r8_face', sFrom: 1, sTo: 9 },
        minSpeed: 4.2, maxAngle: 50, time: 0.85, nominal: 8, clip: 'wall_leap', prompt: 'Space  leap to the wall',
      },
      {
        id: 'far_wall_back', from: { poly: [[-199.2, -206], [-195.6, -206], [-195.6, -192], [-199.2, -192]], yMin: 27 },
        to: { land: [-184.4, -199], spread: 1.6 }, minSpeed: 4.2, maxAngle: 60, time: 0.95, clip: 'leap_generic',
      },
      {
        id: 'far_wall_off', fromLedge: 'r8_face', to: { land: [-184.4, -199], spread: 1.6 }, time: 0.9, clip: 'leap_generic',
      },
    ],
  };
}
