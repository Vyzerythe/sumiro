import type { Object3D } from 'three';
import { pointInPolygon } from '../physics/geometry.mts';
import { createMeshRaycaster, hasLineOfSight, raycastVisibleSurface, type SightRaycaster } from '../physics/sight.mts';
import type { CollisionPosition, CollisionWorld } from '../physics/world.mts';
import type { createTraversalController } from '../player/traversal-controller.mts';
import {
  laterChapterCameraDefinitions, type CameraFraming, type CameraTrackPoint,
  type CameraZone, type ChapterCameraDefinition,
} from './chapter-camera-zones.mts';

type CameraWorld = Pick<CollisionWorld, 'raycast' | 'rayFades' | 'groundAt'>;
type PlayerState = ReturnType<typeof createTraversalController>['state'];
type TraversalCameraState = Pick<PlayerState, 'x' | 'y' | 'z' | 'heading' | 'state' | 'grounded' | 'lastGroundY' | 'carrier' | 'leap'>;
type Feet = Readonly<CollisionPosition>;

export interface CameraMovement {
  grounded: boolean;
  groundY?: number;
  kind?: 'leap' | 'hang' | 'climb';
  carrier?: string;
  leapZone?: string;
  holdYaw?: number;
}

interface CameraLook {
  x: number;
  y: number;
  sensitivity?: number;
  invertY?: boolean;
}

export interface ChapterCameraOptions {
  fighting?: (id: string) => boolean;
  world?: CameraWorld;
  sight?: SightRaycaster;
}

interface LaterChapterCameraOptions extends Omit<ChapterCameraOptions, 'world'> {
  root?: Object3D;
  look?: () => CameraLook;
}

export interface ChapterCameraPose extends CollisionPosition {
  yaw: number;
  pitch: number;
  railYaw: number;
  zone: string;
  railFrame: null;
  fadeTarget: string | null;
  obstructed: boolean;
}

interface Spring { x: number; v: number }
const spring = (x = 0): Spring => ({ x, v: 0 });
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const radians = Math.PI / 180;
const wrapYaw = (angle: number) => ((angle + 540) % 360 + 360) % 360 - 180;
const eye = 1.25;
const pitchSearch = [0, 8, 16, 24, 32, 40, 50, 60];
const turnPitchSearch = [0, 16, 32];
const yawSearch = [30, 60, 90, 120, 150, 180];
const nearbyDirections = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
  [.71,0,.71],[-.71,0,.71],[.71,0,-.71],[-.71,0,-.71]] as const;

function settle(state: Spring, target: number, rate: number, delta: number) {
  if (!Number.isFinite(target)) return state.x;
  if (!Number.isFinite(state.x) || !Number.isFinite(state.v)) snap(state, target);
  const decay = Math.exp(-rate * delta);
  const displacement = state.x - target;
  const impulse = (state.v + rate * displacement) * delta;
  state.v = (state.v - rate * impulse) * decay;
  state.x = target + (displacement + impulse) * decay;
  return state.x;
}

function snap(state: Spring, value: number) { state.x = value; state.v = 0; }

function arcLengths(points: readonly CameraTrackPoint[]) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  }
  return lengths;
}

/** Selects and blends the authored, non-rail framing before resolving surfaces and sight. */
export function createChapterCameraRig(definition: ChapterCameraDefinition, {
  world, sight, fighting = () => false,
}: ChapterCameraOptions = {}, fallbackId = 'default') {
  const { zones } = definition;
  const fallback = { id: fallbackId, kind: 'fixed', yaw: 0, pitch: -Math.atan2(1.25, 5.3) / radians,
    distance: 5.3, height: 2.55 } satisfies CameraZone;
  const tracks = new Map(zones.flatMap(zone => zone.kind === 'track' ? [[zone, arcLengths(zone.line)] as const] : []));
  const localTrackSearch = 3;
  let zone: CameraZone = fallback;
  let hint = 0;
  let primed = false;
  let token = 0;
  let holdYaw: number | null = null;
  let holdClear = 0;
  const view: CameraFraming = { yaw: 0, pitch: 0, distance: 5, height: 2 };
  const yaw = spring(), pitch = spring(), distance = spring(), height = spring();
  const x = spring(), y = spring(), z = spring();
  const pitchAvoid = spring(), yawAvoid = spring(), arm = spring(), floor = spring();
  const pushX = spring(), pushY = spring(), pushZ = spring();
  const lookYaw = spring(), lookPitch = spring();
  let lookYawTarget = 0, lookPitchTarget = 0;
  let pitchGoal = 0, yawGoal = 0, pitchClear = 0, yawClear = 0, sightWait = 0;
  let armGoal = 0;

  function matches(candidate: CameraZone, feet: Feet, atY = feet.y) {
    return (!candidate.fight || fighting(candidate.fight)) &&
      (!candidate.poly || pointInPolygon(feet.x, feet.z, candidate.poly)) &&
      (candidate.yMin === undefined || atY >= candidate.yMin) &&
      (candidate.yMax === undefined || atY < candidate.yMax);
  }

  const eligible = (candidate: CameraZone) => !candidate.onHold && !candidate.ride;
  const fightZone = (feet: Feet, atY = feet.y) => zones.find(candidate => candidate.fight && matches(candidate, feet, atY));
  const standingZone = (feet: Feet, atY = feet.y) => fightZone(feet, atY) ??
    zones.find(candidate => candidate.kind !== 'leap' && eligible(candidate) && matches(candidate, feet, atY)) ??
    zones.find(candidate => eligible(candidate) && !candidate.fight) ?? fallback;

  function sample(feet: Feet, search = localTrackSearch) {
    if (zone.kind !== 'track') {
      view.yaw = zone.yaw; view.pitch = zone.pitch; view.distance = zone.distance; view.height = zone.height;
      return;
    }
    const points = zone.line;
    const lengths = tracks.get(zone)!;
    if (points.length < 2) {
      const [, , yaw = fallback.yaw, pitch = fallback.pitch, distance = fallback.distance, height = fallback.height] = points[0] ?? [];
      Object.assign(view, { yaw, pitch, distance, height });
      return;
    }
    let nearest = Infinity;
    let target = hint;
    for (let index = 0; index + 1 < points.length; index++) {
      const start = lengths[index]!, end = lengths[index + 1]!;
      if (end < hint - search || start > hint + search) continue;
      const a = points[index]!, b = points[index + 1]!;
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const px = feet.x - a[0], pz = feet.z - a[1];
      const progress = clamp((px * dx + pz * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const error = (px - dx * progress) ** 2 + (pz - dz * progress) ** 2;
      if (error >= nearest) continue;
      nearest = error;
      target = start + (end - start) * progress;
    }
    hint = target;
    let index = 0;
    while (index < lengths.length - 2 && lengths[index + 1]! < hint) index++;
    const progress = (hint - lengths[index]!) / (lengths[index + 1]! - lengths[index]! || 1);
    const a = points[index]!, b = points[index + 1]!;
    view.yaw = a[2] + wrapYaw(b[2] - a[2]) * progress;
    view.pitch = a[3] + (b[3] - a[3]) * progress;
    view.distance = a[4] + (b[4] - a[4]) * progress;
    view.height = a[5] + (b[5] - a[5]) * progress;
  }

  function select(next: CameraZone, feet: Feet) {
    zone = next;
    if (zone.kind !== 'track') return;
    hint = (tracks.get(zone)?.at(-1) ?? 0) / 2;
    sample(feet, Infinity);
  }

  function framingBlocked(feet: Feet, degrees: number) {
    if (!world) return false;
    const angle = degrees * radians;
    const dx = Math.sin(angle) * view.distance, dz = Math.cos(angle) * view.distance, dy = view.height - eye;
    const length = Math.hypot(dx, dy, dz) || 1;
    const hit = sight ? raycastVisibleSurface(sight, feet.x, feet.y + eye, feet.z, dx / length, dy / length, dz / length, length) : Infinity;
    return hit < Infinity ||
      world.raycast(feet.x, feet.y + eye, feet.z, dx / length, dy / length, dz / length, length, 3) < Infinity && !world.rayFades;
  }

  function steerOffWall(feet: Feet, movement: CameraMovement, delta: number) {
    if (movement.kind !== 'hang' || movement.holdYaw === undefined) {
      holdYaw = null;
      return;
    }
    if (framingBlocked(feet, view.yaw)) {
      holdClear = 0;
      const preferred = movement.holdYaw / radians;
      if (!framingBlocked(feet, preferred)) holdYaw = preferred;
    } else if (holdYaw !== null) {
      holdClear += delta;
      if (holdClear > .6) holdYaw = null;
    }
    if (holdYaw !== null) view.yaw = holdYaw;
  }

  function hasBodySight(position: Feet, feet: Feet, hanging: boolean) {
    if (!sight) return true;
    const dx = position.x - feet.x, dz = position.z - feet.z;
    const length = Math.hypot(dx, dz) || 1;
    const px = -dz / length * .32, pz = dx / length * .32;
    const visibleAt = (x: number, y: number, z: number) =>
      hasLineOfSight(sight, position.x, position.y, position.z, x, y, z);
    for (const elevation of [.8, 1.7]) {
      const y = feet.y + elevation;
      if (!visibleAt(feet.x, y, feet.z) || !visibleAt(feet.x + px, y, feet.z + pz) ||
          !visibleAt(feet.x - px, y, feet.z - pz)) return false;
    }
    return !hanging || visibleAt(feet.x, feet.y + 2.15, feet.z);
  }

  function adjustSight(position: CollisionPosition, feet: Feet, hanging: boolean, delta: number, fresh: boolean) {
    if (!sight) return 0;
    const originY = feet.y + eye;
    const dx = position.x - feet.x, dy = position.y - originY, dz = position.z - feet.z;
    const horizontal = Math.hypot(dx, dz), length = Math.hypot(horizontal, dy) || 1;
    const sin = horizontal > 1e-4 ? dx / horizontal : 0, cos = horizontal > 1e-4 ? dz / horizontal : 1;
    const elevation = Math.atan2(dy, horizontal);
    function orbit(vertical: number, rotation: number): CollisionPosition {
      const tilt = elevation + vertical * radians;
      const a = Math.cos(rotation * radians), b = Math.sin(rotation * radians);
      return { x: feet.x + (sin * a + cos * b) * Math.cos(tilt) * length, y: originY + Math.sin(tilt) * length,
        z: feet.z + (cos * a - sin * b) * Math.cos(tilt) * length };
    }
    const search = (angle: number, tilts: readonly number[]) => tilts.some(tilt =>
      elevation / radians + tilt <= 75 && hasBodySight(orbit(tilt, angle), feet, hanging));

    sightWait -= delta;
    if (sightWait <= 0 || fresh) {
      sightWait = .08;
      if (search(0, hanging ? pitchSearch.filter(value => value <= 32) : pitchSearch)) {
        yawClear += .08;
        if (yawGoal === 0 || yawClear >= 1) yawGoal = 0;
      } else {
        yawClear = 0;
        if (yawGoal === 0 || !search(yawGoal, turnPitchSearch)) {
          const side = yawGoal < 0 ? -1 : 1;
          outer: for (const angle of yawSearch) {
            if (!hanging && angle > 90) break;
            for (const sign of [side, -side]) {
              if (!search(angle * sign, turnPitchSearch)) continue;
              yawGoal = angle * sign;
              break outer;
            }
          }
        }
      }

      let chosen = pitchSearch.at(-1)!;
      let clear = false;
      for (const tilt of pitchSearch) {
        if (elevation / radians + tilt > 75) break;
        if (!hasBodySight(orbit(tilt, yawGoal), feet, hanging)) continue;
        chosen = tilt;
        clear = true;
        break;
      }
      if (!clear) {
        let mostVisible = -1;
        for (const tilt of pitchSearch) {
          if (elevation / radians + tilt > 75) break;
          const point = orbit(tilt, yawGoal);
          const visible = Math.min(length, raycastVisibleSurface(sight, feet.x, originY, feet.z,
            (point.x - feet.x) / length, (point.y - originY) / length, (point.z - feet.z) / length, length));
          if (visible <= mostVisible + .25) continue;
          mostVisible = visible;
          chosen = tilt;
        }
      }
      if (chosen >= pitchGoal || fresh) { pitchGoal = chosen; pitchClear = 0; }
      else {
        pitchClear += .08;
        if (pitchClear >= .5) { pitchGoal = chosen; pitchClear = 0; }
      }
    }
    if (fresh) snap(pitchAvoid, pitchGoal);
    const tilt = settle(pitchAvoid, pitchGoal, pitchGoal > pitchAvoid.x ? 7 : 2, delta);
    Object.assign(position, orbit(tilt, settle(yawAvoid, yawGoal, 3.5, delta)));
    return tilt;
  }

  function shorten(position: CollisionPosition, feet: Feet, delta: number, fresh: boolean) {
    if (!world) return { obstructed: false, fadeTarget: null };
    const originY = feet.y + eye;
    const armLength = Math.hypot(position.x - feet.x, position.y - originY, position.z - feet.z) || 1;
    const dx = (position.x - feet.x) / armLength, dy = (position.y - originY) / armLength, dz = (position.z - feet.z) / armLength;
    const limit = armLength + .4;
    const hit = world.raycast(feet.x, originY, feet.z, dx, dy, dz, limit, 8);
    const obstructionFade = hit < Infinity ? world.rayFades : null;
    const sightHit = sight ? raycastVisibleSurface(sight, feet.x, originY, feet.z, dx, dy, dz, limit) : Infinity;
    const wanted = Math.max(armLength - Math.min(Math.min(hit, sightHit) - .4, armLength), 0);
    if (fresh) { snap(arm, wanted); armGoal = wanted; }
    armGoal = wanted > armGoal ? Math.min(armGoal + 9 * delta, wanted) : wanted;
    const maxRetraction = Math.max(armLength - (sightHit < Infinity ? 1.5 : 2.6), 0);
    const retraction = clamp(settle(arm, armGoal, armGoal > arm.x ? 18 : 2.5, delta), 0, maxRetraction);
    position.x -= dx * retraction;
    position.y -= dy * retraction;
    position.z -= dz * retraction;
    const fadeHit = world.raycast(feet.x, originY, feet.z, dx, dy, dz, armLength - retraction, 16);
    return { obstructed: wanted > 0, fadeTarget: (fadeHit < Infinity ? world.rayFades : null) ??
      (wanted > maxRetraction + .05 ? obstructionFade : null) };
  }

  function clearFloor(position: CollisionPosition, feet: Feet, movement: CameraMovement, delta: number, fresh: boolean) {
    if (!world) return;
    const clearance = !movement.grounded && !movement.kind && feet.y < (movement.groundY ?? feet.y) - .5 ? 1.4 : .4;
    const ground = world.groundAt(position.x, position.z, position.y + 8, position.y - clearance);
    const wanted = ground ? ground.y + clearance - position.y : 0;
    if (fresh) snap(floor, wanted);
    position.y += Math.max(settle(floor, wanted, wanted > floor.x ? 12 : 3, delta), 0);
  }

  function nudge(position: CollisionPosition, delta: number, fresh: boolean) {
    if (!sight) return;
    let x = 0, y = 0, z = 0;
    for (const [dx, dy, dz] of nearbyDirections) {
      const hit = sight.raycast(position.x, position.y, position.z, dx, dy, dz, .55);
      if (hit === Infinity || sight.back) continue;
      const push = .55 - hit;
      x -= dx * push; y -= dy * push; z -= dz * push;
    }
    if (fresh) { snap(pushX, x); snap(pushY, y); snap(pushZ, z); }
    position.x += settle(pushX, x, 10, delta);
    position.y += settle(pushY, y, 10, delta);
    position.z += settle(pushZ, z, 10, delta);
  }

  function update(feet: Feet, movement: CameraMovement, delta: number, teleport = 0, look?: CameraLook): ChapterCameraPose {
    if (!Number.isFinite(delta) || delta < 0 || ![feet.x, feet.y, feet.z].every(Number.isFinite)) {
      throw RangeError('Camera updates require finite position and nonnegative elapsed time');
    }
    const fresh = !primed || teleport !== token;
    token = teleport;
    primed = true;
    const groundY = movement.groundY ?? feet.y;
    if (fresh) {
      const baseY = movement.grounded ? feet.y : groundY;
      select(standingZone(feet, baseY), feet);
      sample(feet);
      snap(yaw, view.yaw); snap(pitch, view.pitch); snap(distance, view.distance); snap(height, view.height);
      snap(x, feet.x); snap(y, baseY); snap(z, feet.z);
      yawGoal = 0; snap(yawAvoid, 0);
    }
    let next: CameraZone | undefined;
    if (movement.kind === 'leap' && movement.leapZone) next = zones.find(candidate => candidate.id === movement.leapZone);
    else if (movement.kind === 'hang') next = zones.find(candidate => candidate.onHold && matches(candidate, feet));
    else if (movement.grounded && !movement.kind) {
      next = (movement.carrier ? zones.find(candidate => candidate.ride === movement.carrier) : undefined) ??
        fightZone(feet) ?? (zone.poly && matches(zone, feet) ? zone : standingZone(feet));
    } else if (!movement.kind) next = zones.find(candidate => candidate.air && matches(candidate, feet, groundY));
    if (next && next !== zone) select(next, feet);
    sample(feet);
    steerOffWall(feet, movement, delta);
    const blend = zone.blend ?? 2.6;
    const baseYaw = settle(yaw, yaw.x + wrapYaw(view.yaw - yaw.x), blend, delta);
    const basePitch = settle(pitch, view.pitch, blend, delta);
    const reach = settle(distance, view.distance, blend, delta), elevation = settle(height, view.height, blend, delta);
    const pin = zone.pinX;
    const cameraX = settle(x, pin ? pin[0] + (feet.x - pin[0]) * pin[1] : feet.x, 7, delta);
    const cameraZ = settle(z, feet.z, 7, delta);
    const followY = !movement.grounded && !movement.kind && feet.y > groundY ? groundY + (feet.y - groundY) * .3 : feet.y;
    const cameraY = settle(y, followY, 10, delta);
    const position = { x: cameraX + Math.sin(baseYaw * radians) * reach, y: cameraY + elevation,
      z: cameraZ + Math.cos(baseYaw * radians) * reach };
    const avoidPitch = adjustSight(position, feet, movement.kind === 'hang', delta, fresh);
    const obstruction = shorten(position, feet, delta, fresh);
    clearFloor(position, feet, movement, delta, fresh);
    nudge(position, delta, fresh);
    if (look) {
      const scale = .06 * (look.sensitivity ?? 1);
      lookYawTarget = clamp(lookYawTarget - look.x * scale, -12, 12);
      lookPitchTarget = clamp(lookPitchTarget - look.y * scale * (look.invertY ? -1 : 1), -6, 6);
    }
    const railYaw = baseYaw + yawAvoid.x;
    return { ...position, ...obstruction, pitch: basePitch + settle(lookPitch, lookPitchTarget, 55, delta) - avoidPitch,
      yaw: railYaw + settle(lookYaw, lookYawTarget, 55, delta), railYaw, zone: zone.id, railFrame: null };
  }
  return { update, reset() { primed = false; } };
}

/** Drop-in replacement for the later-chapter traversal view. All angles are degrees. */
export function createLaterChapterCamera(world: CameraWorld, chapter: string, {
  root, sight, fighting, look,
}: LaterChapterCameraOptions = {}) {
  const definitions: Readonly<Partial<Record<string, ChapterCameraDefinition>>> = laterChapterCameraDefinitions;
  const definition = Object.hasOwn(definitions, chapter) ? definitions[chapter] : undefined;
  if (!sight && root && definition) {
    root.updateWorldMatrix(true, true);
    sight = createMeshRaycaster(root, definition.sightMeshes, { twoSided: definition.twoSided ?? false });
  }
  const camera = createChapterCameraRig(definition ?? { zones: [], sightMeshes: '' },
    { world, ...(sight ? { sight } : {}), ...(fighting ? { fighting } : {}) }, chapter);
  return (feet: TraversalCameraState, delta: number, teleport: number) => {
    const movement: CameraMovement = { grounded: feet.grounded, groundY: feet.lastGroundY };
    if (feet.carrier) movement.carrier = feet.carrier.id;
    if (feet.leap) {
      movement.kind = 'leap';
      if (feet.leap.link.camera?.zone) movement.leapZone = feet.leap.link.camera.zone;
    } else if (feet.state === 'HANG' || feet.state === 'SHIMMY' || feet.state === 'GRAB') {
      movement.kind = 'hang';
      movement.holdYaw = feet.heading;
    } else if (feet.state === 'CLIMB') movement.kind = 'climb';
    return camera.update(feet, movement, delta, teleport, look?.());
  };
}
