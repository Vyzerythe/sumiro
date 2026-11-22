import type { InputManager } from '../input/input-manager.mts';
import type { MovingTriangleBody } from '../physics/moving-body.mts';
import type { CollisionPosition, CollisionSurface, CollisionWorld } from '../physics/world.mts';
import { completeLedgeClimb, shimmyAlongLedge, updateLedgeHang } from './ledge-controller.mjs';
import { alignToLedge, beginLedgeGrab, detectLedgeGrab } from './ledge-grab.mjs';
import { createLedgePath } from './ledge-path.mjs';
import { abortLeap, advanceLeap, beginLeap, findLeapLink, resolveLeapTarget } from './leap.mjs';
import { selectTravelDirection } from './locomotion.mts';
import { movementConfig } from './movement-config.mjs';

export interface TraversalLedgeDefinition {
  id: string;
  points: readonly (readonly [number, number, number, number, number])[];
  climbable: boolean | readonly (readonly [number, number])[];
  body?: MovingTriangleBody | null;
}

export interface TraversalLedge extends TraversalLedgeDefinition {
  length: number;
  s: number[];
  at(distance: number, sample?: LedgeSample): LedgeSample;
  nearest(x: number, z: number, minimum?: number, maximum?: number): number;
}

interface LedgeSample extends CollisionPosition {
  ox: number;
  oz: number;
  s: number;
}

export interface TraversalLeapDefinition {
  id: string;
  from?: { poly: readonly (readonly [number, number])[]; yMin?: number; yMax?: number };
  fromLedge?: string;
  to: { ledge: string; sFrom: number; sTo: number } | { land: readonly [number, number]; spread: number };
  minSpeed?: number;
  maxAngle?: number;
  time: number;
  clip: string;
  camera?: { toF: number } | { toLanding: boolean };
}

interface LeapTarget extends CollisionPosition { ledge: TraversalLedge | null; s?: number }
type LeapLink = Pick<TraversalLeapDefinition, 'time' | 'clip' | 'camera'> & { exactTime?: number };

export interface ClimbingState extends CollisionPosition {
  state: string;
  stateT: number;
  heading: number;
  rootY: number;
  lastGroundY: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  noGrab: number;
  coyote: number;
  jumpBuf: number;
  carrier: MovingTriangleBody | null;
  surface: CollisionSurface;
  ledge: TraversalLedge | null;
  ledgeS: number;
  shimmyHold: { key: number; dir: number } | null;
  hangForward: number;
  hangBack: number;
  hangBackFresh: boolean;
  stickMag: number;
  stickX: number;
  stickZ: number;
  recentSpeed: number;
  holdActive: boolean;
  holdYaw: number;
  holdAngle: number;
  yaw: number;
  stickAngle: number;
  leap: { t: LeapTarget; time: number; link: LeapLink } | null;
  gestureClip: string | null;
  gestureSpeed: number;
}

interface ClimbingEffects {
  changeState(name: string): void;
  fall(verticalSpeed?: number): void;
  duration(clip: string): number;
  land(dropHeight: number): void;
}

const OUTWARD_OFFSET = 0.26;
const HANG_HEIGHT = 2.1;
const CLIMB_FORWARD = 0.6;
const GRAB_WAIT = 0.12;

/** Climbing state machine using the recovered ledge acquisition and hang routines. */
export function createClimbingController(
  state: ClimbingState, world: CollisionWorld, definitions: readonly TraversalLedgeDefinition[],
  leapLinks: readonly TraversalLeapDefinition[], { changeState, fall, duration, land }: ClimbingEffects,
) {
  const ledges: TraversalLedge[] = definitions.map(definition => createLedgePath(definition));
  const byId = new Map(ledges.map(ledge => [ledge.id, ledge]));
  for (const { to, id } of leapLinks) if ('ledge' in to && !byId.has(to.ledge)) throw Error(`Unresolved ledge in ${id}`);
  const sample = { x: 0, y: 0, z: 0, ox: 0, oz: 0, s: 0 };
  const presentation = { kind: null, p: 0, holdYaw: 0, ledge: null };
  const direction = { x: 0, z: 0 };
  const capsule = { radius: 0.2, height: 1.5, guards: false, solid: true };
  const collision = world.sweepCapsule(state, 0, 0, capsule);
  let clipStartedAt = 0;

  function play(clip: string, options?: { speed?: number }) {
    state.gestureClip = clip;
    state.gestureSpeed = options?.speed ?? 1;
    clipStartedAt = state.stateT;
  }

  function enterGrab(ledge: TraversalLedge, distance: number) {
    beginLedgeGrab(state, ledge, distance, sample, presentation, OUTWARD_OFFSET, HANG_HEIGHT, play, changeState);
    clipStartedAt = 0;
  }

  const effects = {
    play, duration, land, changeState, world, capsule, collision, scratch: sample,
    ledgeOffset: OUTWARD_OFFSET, hangingHeight: HANG_HEIGHT, collisionUntil: 0.88,
    finished: () => !state.gestureClip || state.stateT - clipStartedAt >= duration(state.gestureClip) / state.gestureSpeed,
    top: () => ({ name: state.gestureClip }),
    grab: enterGrab,
    deflect(contact: typeof collision) {
      const into = Math.min(0, state.vx * contact.nx + state.vz * contact.nz);
      state.vx -= into * contact.nx;
      state.vz -= into * contact.nz;
    },
    abort() { abortLeap(state, presentation, movementConfig, effects); },
    lockHeading() {
      state.holdActive = state.stickMag > 0.1;
      state.holdYaw = state.yaw;
      state.holdAngle = state.stickAngle;
    },
  };

  function launch(link: LeapLink, target: LeapTarget) {
    beginLeap(state, presentation, link, target, movementConfig, {
      ...effects, footstep: () => {},
    });
    state.ledge = null;
    state.jumpBuf = 0;
    clipStartedAt = 0;
  }

  function sideLeap(horizontal: number, vertical: number, railYaw = 0) {
    if (!state.ledge) return false;
    const start = state.ledge.at(state.ledgeS);
    const angle = railYaw * Math.PI / 180;
    let best = 0.3;
    let target: LeapTarget | undefined;
    for (const ledge of ledges) {
      if (ledge === state.ledge || ledge.body?.enabled === false) continue;
      const s = ledge.nearest(start.x, start.z);
      ledge.at(s, sample);
      const dx = sample.x - start.x, dy = sample.y - start.y, dz = sample.z - start.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance <= 0 || distance > 2.9) continue;
      const preferred = (horizontal * (dx * Math.cos(angle) - dz * Math.sin(angle)) + vertical * dy) / distance;
      if (preferred <= best) continue;
      best = preferred;
      target = { ledge, s, x: sample.x + sample.ox * OUTWARD_OFFSET,
        y: sample.y - HANG_HEIGHT, z: sample.z + sample.oz * OUTWARD_OFFSET };
    }
    if (!target) return false;
    launch({ time: 0.42, exactTime: 0.42, clip: 'leap_generic' }, target);
    return true;
  }

  function align() { alignToLedge(state, sample, presentation, OUTWARD_OFFSET, HANG_HEIGHT); }

  function drop(push = false) {
    const ledge = state.ledge;
    if (!ledge) return;
    ledge.at(state.ledgeS, sample);
    state.x += sample.ox * 0.15;
    state.z += sample.oz * 0.15;
    state.vx = sample.ox * (push ? 3 : 0.4);
    state.vz = sample.oz * (push ? 3 : 0.4);
    state.ledge = null;
    fall(push ? 4 : 0);
    state.noGrab = 0.6;
    state.coyote = 0;
  }

  function climb(railYaw?: number) {
    const allowed = state.ledge?.climbable;
    if (allowed === true || (allowed && allowed.some(([from, to]) => state.ledgeS >= from && state.ledgeS <= to))) {
      changeState('CLIMB');
      play('climb_up');
    } else {
      sideLeap(0, 1, railYaw);
    }
  }

  return {
    tryGroundLeap() {
      selectTravelDirection(state, direction);
      const resolve = (link: TraversalLeapDefinition) => resolveLeapTarget(state, link, byId, world, direction, sample);
      const leap = findLeapLink(state, { leapLinks }, byId, world, direction, sample, resolve);
      if (!leap) return false;
      launch(leap.link, leap.t);
      return true;
    },
    grabNearby() {
      return detectLedgeGrab(state, ledges, sample, OUTWARD_OFFSET, HANG_HEIGHT, 1,
        enterGrab);
    },
    update(delta: number, input: Pick<InputManager, 'forward' | 'strafe'>, railYaw?: number) {
      if (state.leap) {
        advanceLeap(state, presentation, delta, movementConfig, effects);
        return true;
      }
      if (!state.ledge) return false;
      if (state.state === 'CLIMB') {
        if (state.stateT < duration('climb_up')) return true;
        const completed = { key: () => 30, finished: () => true, gait: { idleT: 0 }, playGait() { state.gestureClip = null; } };
        completeLedgeClimb(state, presentation, completed, world,
          { forwardOffset: CLIMB_FORWARD, heightGain: HANG_HEIGHT, surface: (surface: CollisionSurface) => surface }, changeState);
      } else {
        updateLedgeHang(state, input, delta, GRAB_WAIT, {
          changeState, align, climbOrLeap: () => climb(railYaw), drop: () => drop(), leapBack() {
            const link = leapLinks.find(link => link.fromLedge === state.ledge?.id);
            if (!link) return drop(true);
            selectTravelDirection(state, direction);
            launch(link, resolveLeapTarget(state, link, byId, world, direction, sample));
          },
          shimmy: (elapsed: number, strafe: number) => shimmyAlongLedge(state, strafe, elapsed, railYaw,
            movementConfig.shimmyRate, align, changeState),
          leapSide: (horizontal: number, vertical: number) => sideLeap(horizontal, vertical, railYaw),
        });
      }
      return true;
    },
  };
}
