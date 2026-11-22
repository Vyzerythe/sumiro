import type { CollisionWorld } from '../physics/world.mts';
import type { createTraversalController } from '../player/traversal-controller.mts';
import { createFollowCamera } from '../rendering/follow-camera.mts';
import { chapterOneCameraAreas, chapterOneRail } from './chapter-one-rail.mts';

type PlayerState = ReturnType<typeof createTraversalController>['state'];

export function createChapterOneCamera(world: CollisionWorld, climbDuration: number) {
  const rig = createFollowCamera({ rail: chapterOneRail, world, wayUpAreas: chapterOneCameraAreas });
  let railFrame = 0;
  let leapStartFrame = 0;
  let lastTraversalState = 'IDLE';
  return (feet: PlayerState, deltaSeconds: number, teleport: number) => {
    const { grounded, state, speed, lastGroundY, leap, ledge, stateT } = feet;
    let frameTarget: number | undefined;
    const target = leap?.link.camera?.toF;
    if (state === 'LEAP' && leap && target !== undefined) {
      if (lastTraversalState !== 'LEAP') leapStartFrame = railFrame;
      const fraction = Math.min(stateT / leap.time, 1);
      frameTarget = leapStartFrame + (target - leapStartFrame) * fraction;
    } else if (ledge?.id === 'rim_front' || ledge?.id === 'crack') {
      const climb = state === 'CLIMB' ? Math.min(stateT / climbDuration, 1) : 0;
      frameTarget = 228 + 30 * climb;
    }
    const pose = rig.update({ feet, deltaSeconds, speed, teleport, movement: { grounded, groundY: lastGroundY },
      ...(frameTarget === undefined ? {} : { frameTarget }) });
    lastTraversalState = state;
    railFrame = pose.railFrame;
    return pose;
  };
}
