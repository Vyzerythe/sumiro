import type { CollisionWorld } from '../physics/world.mts';
import type { createTraversalController } from '../player/traversal-controller.mts';

type PlayerState = ReturnType<typeof createTraversalController>['state'];

/** Former fallback, superseded by the authored later-chapter camera zones. */
export function createStaticTraversalCamera(world: CollisionWorld, zone: string) {
  let aimX = 0, aimY = 0, aimZ = 0;
  let previousTeleport = -1;
  return (feet: PlayerState, delta: number, teleport: number) => {
    const fraction = previousTeleport === teleport ? -Math.expm1(-10 * delta) : 1;
    previousTeleport = teleport;
    aimX += (feet.x - aimX) * fraction;
    aimY += ((feet.grounded ? feet.y : feet.lastGroundY) + 1.3 - aimY) * fraction;
    aimZ += (feet.z - aimZ) * fraction;
    const length = Math.hypot(1.25, 5.3);
    const rayY = 1.25 / length;
    const rayZ = 5.3 / length;
    const blocked = world.raycast(aimX, aimY, aimZ, 0, rayY, rayZ, length + 0.4, 10);
    const arm = Math.max(0.2, Math.min(length, blocked - 0.4));
    return { x: aimX, y: aimY + rayY * arm, z: aimZ + rayZ * arm,
      pitch: -Math.atan2(rayY, rayZ) * 180 / Math.PI, yaw: 0, zone, railFrame: null };
  };
}
