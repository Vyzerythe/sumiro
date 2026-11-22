import { raycastVisibleSurface, type SightRaycaster } from '../physics/sight.mts';
import type { CollisionPosition, CollisionWorld } from '../physics/world.mts';

export interface FollowRailPose extends CollisionPosition {
  yaw: number;
  pitch: number;
}

export interface FollowCameraRail {
  /** Sample the authored camera at seconds on its 24 fps timeline. Angles are in degrees. */
  poseAt(seconds: number, out: FollowRailPose): void;
  /** Sample the authored reference feet on the same timeline and world axes. */
  feetAt(seconds: number, out: CollisionPosition): void;
}

export interface FollowCameraArea {
  polygon: readonly (readonly [x: number, z: number])[];
  yaw: number;
  lift?: number;
  pitch?: number;
}

export interface FollowCameraOptions {
  rail: FollowCameraRail;
  sight?: SightRaycaster;
  world?: Pick<CollisionWorld, 'groundAt' | 'raycast' | 'rayFades'>;
  /** In authored priority order, active on the way-up track. */
  wayUpAreas?: readonly FollowCameraArea[];
}

interface FollowMovement {
  grounded: boolean;
  groundY?: number | null;
  kind?: string | null;
}

export interface FollowCameraFrame {
  feet: Readonly<CollisionPosition>;
  deltaSeconds: number;
  movement?: FollowMovement;
  speed?: number;
  /** Change this counter when relocating the player discontinuously. */
  teleport?: number;
  /** Authored frame target for a scripted move beyond the walking tracks. */
  frameTarget?: number;
}

export interface FollowCameraPose extends FollowRailPose {
  railFrame: number;
  zone: 'way_up' | 'plateau';
  obstructed: boolean;
  fadeTarget: string | null;
}

const RAIL_FPS = 24;
const RADIANS = Math.PI / 180;
const ORIGIN_HEIGHT = 1.25;
const ARM_CLEARANCE = 0.4;
const SURFACE_CLEARANCE = 0.55;
const LOCAL_SEARCH_FRAMES = 14;
const SHORTENING_KIND = 8;
const FADING_KIND = 16;
const DIAGONAL = Math.SQRT1_2;
const SURFACE_DIRECTIONS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [DIAGONAL, 0, DIAGONAL], [-DIAGONAL, 0, DIAGONAL],
  [DIAGONAL, 0, -DIAGONAL], [-DIAGONAL, 0, -DIAGONAL],
] as const;

interface Spring {
  value: number;
  velocity: number;
}

const spring = (): Spring => ({ value: 0, velocity: 0 });
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function settle(state: Spring, goal: number, rate: number, delta: number, snap: boolean) {
  if (snap) {
    state.value = goal;
    state.velocity = 0;
    return goal;
  }
  const decay = Math.exp(-rate * delta);
  const displacement = state.value - goal;
  const impulse = (state.velocity + rate * displacement) * delta;
  state.velocity = (state.velocity - rate * impulse) * decay;
  state.value = goal + (displacement + impulse) * decay;
  return state.value;
}

function softDeadZone(value: number, width: number) {
  const magnitude = Math.abs(value);
  return magnitude <= width
    ? value * magnitude * magnitude / (3 * width * width)
    : Math.sign(value) * (magnitude - 2 * width / 3);
}

interface RailPoint {
  frame: number;
  x: number;
  z: number;
}

function sampleTrack(rail: FollowCameraRail, first: number, last: number) {
  const points: RailPoint[] = [];
  const sample = { x: 0, y: 0, z: 0 };
  for (let frame = first; frame <= last; frame++) {
    rail.feetAt(frame / RAIL_FPS, sample);
    points.push({ frame, x: sample.x, z: sample.z });
  }
  return points;
}

function projectTrack(points: readonly RailPoint[], feet: Readonly<CollisionPosition>, hint: number, radius: number) {
  let nearestFrame = hint;
  let nearestDistance = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    if (to.frame < hint - radius || from.frame > hint + radius) continue;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const segmentLength = dx * dx + dz * dz;
    const offsetX = feet.x - from.x;
    const offsetZ = feet.z - from.z;
    const along = segmentLength > 1e-9 ? clamp((offsetX * dx + offsetZ * dz) / segmentLength, 0, 1) : 0;
    const distance = (offsetX - dx * along) ** 2 + (offsetZ - dz * along) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestFrame = from.frame + along;
    }
  }
  return nearestFrame;
}

function inArea(area: FollowCameraArea, x: number, z: number) {
  const points = area.polygon;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, az] = points[i]!;
    const [bx, bz] = points[j]!;
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

function retainsArea(area: FollowCameraArea, feet: Readonly<CollisionPosition>) {
  if (inArea(area, feet.x, feet.z)) return true;
  for (let direction = 0; direction < 8; direction++) {
    const angle = direction * Math.PI / 4;
    if (inArea(area, feet.x + 0.6 * Math.cos(angle), feet.z + 0.6 * Math.sin(angle))) return true;
  }
  return false;
}

/**
 * Chapter One gameplay rail following from camera_rig-DQPkG66d.js.
 * Handles the two walking tracks, with authored rail data kept at the caller.
 * Camera output uses world positions and the rail's Euler angles in degrees.
 */
export function createFollowCamera({ rail, sight, world, wayUpAreas = [] }: FollowCameraOptions) {
  const tracks = {
    way_up: sampleTrack(rail, 0, 199),
    plateau: sampleTrack(rail, 258, 303),
  };
  const authoredPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const railFeet = { x: 0, y: 0, z: 0 };
  const width = spring();
  const lateral = spring();
  const longitudinal = spring();
  const vertical = spring();
  const yaw = spring();
  const lift = spring();
  const pitch = spring();
  const arm = spring();
  const floor = spring();
  const pushX = spring();
  const pushY = spring();
  const pushZ = spring();
  let primed = false;
  let lastTeleport = 0;
  let lastX = 0;
  let lastZ = 0;
  let measuredSpeed = 0;
  let frame = 0;
  let frameVelocity = 0;
  let targetFrame = 0;
  let hint = 0;
  let zone: FollowCameraPose['zone'] = 'way_up';
  let area: FollowCameraArea | undefined;

  function update({ feet, deltaSeconds: delta, movement, speed, teleport = 0, frameTarget }: FollowCameraFrame): FollowCameraPose {
    if (!Number.isFinite(delta) || delta < 0 || ![feet.x, feet.y, feet.z].every(Number.isFinite)) {
      throw new RangeError('Camera updates require finite position and nonnegative elapsed time');
    }
    const snap = !primed || teleport !== lastTeleport;
    const grounded = movement?.grounded ?? true;
    const groundY = grounded ? feet.y : movement?.groundY ?? feet.y;
    const desiredZone = groundY < 7.2 || feet.z > -47.5 ? 'way_up' : 'plateau';
    if (snap || grounded && desiredZone !== zone) {
      zone = desiredZone;
      hint = projectTrack(tracks[zone], feet, 0, Infinity);
      area = undefined;
    }
    hint = projectTrack(tracks[zone], feet, hint, LOCAL_SEARCH_FRAMES);
    const target = frameTarget ?? hint;
    if (!Number.isFinite(target) || target < 0) throw RangeError('Rail frame target must be nonnegative and finite');

    if (snap) {
      frame = targetFrame = target;
      frameVelocity = measuredSpeed = 0;
    } else if (delta > 0) {
      const error = target - frame;
      const maximumRate = Math.abs(error) > 6 ? 66 : 40;
      const targetVelocity = clamp((target - targetFrame) / delta + error * 6, -maximumRate, maximumRate);
      const approach = -Math.expm1(-12 * delta);
      // Integrate velocity across the step so a longer update cannot overapply the final velocity.
      frame += targetVelocity * delta + (frameVelocity - targetVelocity) * approach / 12;
      frameVelocity += (targetVelocity - frameVelocity) * approach;
      targetFrame = target;
      measuredSpeed += (Math.hypot(feet.x - lastX, feet.z - lastZ) / delta - measuredSpeed) *
        -Math.expm1(-delta / 0.1);
    }
    primed = true;
    lastTeleport = teleport;
    lastX = feet.x;
    lastZ = feet.z;

    const seconds = Math.max(frame, 0) / RAIL_FPS;
    rail.poseAt(seconds, authoredPose);
    rail.feetAt(seconds, railFeet);
    if (zone === 'way_up' && (!area || !retainsArea(area, feet))) {
      area = wayUpAreas.find(candidate => inArea(candidate, feet.x, feet.z));
    }
    const targetYaw = zone === 'plateau' ? clamp((feet.x - 10.5) * 4.5, 0, 42) : area?.yaw ?? 0;
    const yawOffset = settle(yaw, targetYaw, 2.2, delta, snap);
    const liftOffset = settle(lift, area?.lift ?? 0, 2.2, delta, snap);
    const pitchOffset = settle(pitch, area?.pitch ?? 0, 2.2, delta, snap);

    const railX = authoredPose.x - railFeet.x;
    const railZ = authoredPose.z - railFeet.z;
    const authoredDistance = Math.hypot(railX, railZ);
    const fixedFraming = seconds >= 195 / RAIL_FPS && seconds <= 267 / RAIL_FPS ||
      seconds >= 12.5 && seconds < 15;
    const speedWeight = clamp((speed ?? measuredSpeed) / 3.5, 0, 1);
    const desiredDistance = fixedFraming ? authoredDistance : 5.1 + (authoredDistance - 5.1) * speedWeight;
    const distance = authoredDistance + settle(width, desiredDistance - authoredDistance, 7, delta, snap);
    const armScale = authoredDistance > 1e-9 ? distance / authoredDistance : 0;

    const angle = authoredPose.yaw * RADIANS;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const dx = feet.x - railFeet.x;
    const dz = feet.z - railFeet.z;
    const side = dx * cosine - dz * sine;
    const adjustedSide = Math.sign(side) * (0.75 * Math.min(Math.abs(side), 1) + Math.max(Math.abs(side) - 1, 0));
    const sideOffset = settle(lateral, softDeadZone(adjustedSide, 0.12), 6, delta, snap);
    const leadOffset = settle(longitudinal, softDeadZone(-dx * sine - dz * cosine, 0.12), 6, delta, snap);
    const followY = !grounded && !movement?.kind && feet.y > groundY ? groundY + (feet.y - groundY) * 0.3 : feet.y;
    const heightOffset = settle(vertical, softDeadZone(followY - railFeet.y, 0.3), 15, delta, snap);
    const turn = yawOffset * RADIANS;
    const turnCos = Math.cos(turn);
    const turnSin = Math.sin(turn);
    const position = {
      x: railFeet.x + (railX * turnCos + railZ * turnSin) * armScale + sideOffset * cosine - leadOffset * sine,
      y: authoredPose.y + heightOffset - (authoredDistance - distance) * 0.115 + liftOffset,
      z: railFeet.z + (-railX * turnSin + railZ * turnCos) * armScale - sideOffset * sine - leadOffset * cosine,
    };

    const obstruction = clearArm(position, feet, delta, snap);
    const groundMargin = !grounded && !movement?.kind && feet.y < groundY - 0.5 ? 1.4 : 0.4;
    const ground = world?.groundAt(position.x, position.z, position.y + 8, position.y - groundMargin);
    const floorLift = ground ? ground.y + groundMargin - position.y : 0;
    const floorOffset = settle(floor, floorLift, 3, delta, snap || floorLift > floor.value);
    position.y += Math.max(floorOffset, 0);
    nudgeFromSurfaces(position, delta, snap);

    return {
      ...position, yaw: authoredPose.yaw + yawOffset, pitch: authoredPose.pitch + pitchOffset,
      railFrame: Math.max(frame, 0), zone, ...obstruction,
    };
  }

  function clearArm(position: CollisionPosition, feet: Readonly<CollisionPosition>, delta: number, snap: boolean) {
    const originY = feet.y + ORIGIN_HEIGHT;
    const armLength = Math.hypot(position.x - feet.x, position.y - originY, position.z - feet.z);
    if (armLength <= 1e-9) {
      settle(arm, 0, 2.5, delta, snap);
      return { obstructed: false, fadeTarget: null };
    }
    const dx = (position.x - feet.x) / armLength;
    const dy = (position.y - originY) / armLength;
    const dz = (position.z - feet.z) / armLength;
    const limit = armLength + ARM_CLEARANCE;
    const worldHit = world?.raycast(feet.x, originY, feet.z, dx, dy, dz, limit, SHORTENING_KIND) ?? Infinity;
    const obstructionFade = worldHit < Infinity ? world?.rayFades ?? null : null;
    const sightHit = sight ? raycastVisibleSurface(sight, feet.x, originY, feet.z, dx, dy, dz, limit) : Infinity;
    const hit = Math.min(worldHit, sightHit);
    const shortening = clamp(armLength - (hit - ARM_CLEARANCE), 0, armLength);
    // Immediately retract to a new clearance limit, then ease outward when it opens.
    const retraction = clamp(settle(arm, shortening, 2.5, delta, snap || shortening > arm.value), 0, armLength);
    position.x -= dx * retraction;
    position.y -= dy * retraction;
    position.z -= dz * retraction;
    const fadingHit = world?.raycast(feet.x, originY, feet.z, dx, dy, dz, armLength - retraction, FADING_KIND) ?? Infinity;
    const fadeTarget = (fadingHit < Infinity ? world?.rayFades : null) ?? obstructionFade;
    return { obstructed: shortening > 0, fadeTarget };
  }

  function nudgeFromSurfaces(position: CollisionPosition, delta: number, snap: boolean) {
    if (!sight) return;
    let x = 0, y = 0, z = 0;
    for (const [dx, dy, dz] of SURFACE_DIRECTIONS) {
      const hit = sight.raycast(position.x, position.y, position.z, dx, dy, dz, SURFACE_CLEARANCE);
      if (hit === Infinity || sight.back) continue;
      const distance = SURFACE_CLEARANCE - hit;
      x -= dx * distance;
      y -= dy * distance;
      z -= dz * distance;
    }
    position.x += settle(pushX, x, 10, delta, snap);
    position.y += settle(pushY, y, 10, delta, snap);
    position.z += settle(pushZ, z, 10, delta, snap);
  }

  return { update, reset() { primed = false; } };
}
