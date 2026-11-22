import type { InputManager } from '../input/input-manager.mts';
import type { CapsuleHit, CollisionWorld } from '../physics/world.mts';
import { createClimbingController, type ClimbingState, type TraversalLedgeDefinition, type TraversalLeapDefinition } from './climbing-controller.mts';
import { updateInputSteering, type SteeringState } from './input-steering.mts';
import { beginFall, beginJump, classifyGroundGait, type JumpState } from './locomotion.mts';
import { beginLowMantle, probeLowMantle, probeWallMantle, updateLowMantle, type LowMantleState, type MantleDestination } from './mantle.mts';
import {
  finishLanding, stepAirborne, stepGroundContact, type AirborneState,
  type GroundContactState, type GroundContactEffects, type LandingState,
} from './motion-physics.mts';
import { movementConfig as tuning } from './movement-config.mts';

type TraversalState = GroundContactState & SteeringState & AirborneState & LandingState & JumpState & ClimbingState & LowMantleState & {
  jumpClip: 'jump_up' | 'jump_fwd';
};

type TraversalInput = Pick<InputManager, 'forward' | 'strafe' | 'jump' | 'jumpHeld' | 'walk' | 'sprint' | 'inkStep'>;
type View = Parameters<typeof updateInputSteering<string>>[2];

interface ClimbingOptions {
  ledges: readonly TraversalLedgeDefinition[];
  leapLinks: readonly TraversalLeapDefinition[];
  duration(clip: string): number;
  canInkStep?(): boolean;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Fixed-step locomotion, takeoff and landing against one collision world. */
export function createTraversalController(
  world: CollisionWorld, spawn: Readonly<{ x: number; z: number; heading: number }>, options?: ClimbingOptions,
) {
  const ground = world.groundAt(spawn.x, spawn.z);
  if (!ground) throw Error('Traversal spawn has no ground support');
  const state: TraversalState = {
    ...spawn, y: ground.y, lastGroundY: ground.y, surface: ground.surface, carrier: ground.body,
    vx: 0, vy: 0, vz: 0, speed: 0, drift: { x: 0, z: 0, air: 0 }, grounded: true,
    state: 'IDLE', stateT: 0, zone: null, yaw: spawn.heading, holdActive: false, holdYaw: 0, holdAngle: 0,
    stickX: 0, stickZ: 0, stickMag: 0, stickAngle: 0, jumpBuf: 0,
    coyote: 0, fromY: ground.y, guardsInAir: false, noGrab: 0, jumpCut: false,
    fade: 0, dissolve: 0, rootY: ground.y, airDashed: false, landHeavy: false,
    braking: false, recentSpeed: 0, jumpClip: 'jump_up',
    ledge: null, ledgeS: 0, shimmyHold: null, hangForward: 0, hangBack: 0, hangBackFresh: false,
    leap: null, mantle: null, gestureClip: null, gestureSpeed: 1,
  };
  const initial = { ...state };
  let inkCooldown = 0;
  let burst: { x: number; z: number; air: boolean } | null = null;
  const bodyCapsule = { radius: tuning.radius, height: tuning.height, guards: true, solid: true };
  const visit = (x: number, z: number) => world.groundAt(x, z, state.y + tuning.stepUp, state.y - tuning.stepDown);
  const around = (x: number, z: number, dx: number, dz: number, reach: number, top: number, bottom: number) => Boolean(
    world.groundAt(x + dx * reach, z + dz * reach, state.y + top, state.y + bottom) ??
    world.groundAt(x, z, state.y + top, state.y + bottom),
  );
  const effects: GroundContactEffects = {
    world, bodyCapsule, probeOffset: 0.35,
    collision: world.sweepCapsule(state, 0, 0, bodyCapsule),
    surfaceName: surface => surface,
    hasSupport(x, z) {
      if (visit(x, z)) return true;
      if (!state.carrier?.enabled) return false;
      for (let sample = 0; sample < 8; sample++) {
        const angle = sample * Math.PI / 4;
        if (visit(x + Math.cos(angle) * 0.15, z + Math.sin(angle) * 0.15)) return true;
      }
      return false;
    },
    hasSafeDrop: (x, z, dx, dz) => around(x, z, dx, dz, 0.6, -tuning.stepDown, -tuning.safeDrop),
    hasHigherGround: (x, z, dx, dz) => around(x, z, dx, dz, 0.3, 4, tuning.stepUp),
    estimateNormal(x, z, fallbackX, fallbackZ, contact) {
      let normalX = 0;
      let normalZ = 0;
      for (let sample = 0; sample < 16; sample++) {
        const angle = sample * Math.PI / 8;
        const dx = Math.cos(angle);
        const dz = Math.sin(angle);
        if (visit(x + dx * 0.5, z + dz * 0.5)) {
          normalX += dx;
          normalZ += dz;
        }
      }
      const magnitude = Math.hypot(normalX, normalZ);
      contact.nx = magnitude > 0.001 ? normalX / magnitude : fallbackX;
      contact.nz = magnitude > 0.001 ? normalZ / magnitude : fallbackZ;
    },
    deflect(contact: CapsuleHit) {
      const into = Math.min(0, state.vx * contact.nx + state.vz * contact.nz);
      state.vx -= into * contact.nx;
      state.vz -= into * contact.nz;
    },
  };

  function changeState(name: string) {
    state.state = name;
    state.stateT = 0;
  }

  const takeoff = {
    setState: changeState,
    play(clip: string) {
      if (clip === 'jump_up' || clip === 'jump_fwd') state.jumpClip = clip;
    },
    detach() {
      const { carrier } = state;
      if (!carrier) return;
      state.carrier = null;
      state.vx += carrier.vx;
      state.vz += carrier.vz;
      state.vy += Math.max(carrier.vy, 0);
    },
  };

  function jump() {
    state.jumpBuf = 0;
    beginJump(state, tuning, takeoff);
  }

  function fall(verticalSpeed = 0) { beginFall(state, tuning, takeoff, verticalSpeed); }

  function land(dropHeight: number) {
    state.gestureClip = null;
    finishLanding(state, dropHeight, tuning, { world, changeState, consumeBufferedJump: jump });
  }

  const climbing = options && createClimbingController(state, world, options.ledges, options.leapLinks, {
    duration: options.duration, changeState, fall, land,
  });

  function enterMantle(destination: MantleDestination) {
    state.jumpBuf = 0;
    beginLowMantle(state, destination, 0.38, (clip, { speed }) => {
      state.gestureClip = clip;
      state.gestureSpeed = speed;
    }, changeState);
  }

  const mantleAnimation = {
    key: () => state.stateT * state.gestureSpeed * 24,
    finished: () => state.stateT * state.gestureSpeed >= (options?.duration('mantle_low') ?? 20 / 24),
    gait: { idleT: 0 },
    playGait() { state.gestureClip = null; },
  };

  const airborne = {
    ...effects, guardedCapsule: bodyCapsule, normalCapsule: { ...bodyCapsule, guards: false },
    jumpHeld: false, groundTolerance: 0.35, changeState,
    land,
    ...(climbing ? { grabLedge: climbing.grabNearby } : {}),
    tryWallMantle: () => probeWallMantle(state, effects.collision, world, enterMantle),
    probeMantle: () => probeLowMantle(state, world),
    beginMantle: enterMantle,
  };

  function beginInkStep() {
    const x = state.stickMag > 0.1 ? state.stickX : -Math.sin(state.heading);
    const z = state.stickMag > 0.1 ? state.stickZ : -Math.cos(state.heading);
    const length = Math.hypot(x, z) || 1;
    const air = !state.grounded;
    burst = { x: x / length, z: z / length, air };
    state.heading = Math.atan2(-x, -z);
    state.gestureClip = air ? 'ink_step' : 'dodge';
    state.gestureSpeed = 1;
    state.guardsInAir = false;
    if (air) state.airDashed = true;
    inkCooldown = tuning.inkRecharge;
    changeState(air ? 'DASH' : 'DODGE');
  }

  function stepInk(delta: number, action: NonNullable<typeof burst>) {
    const frame = state.stateT * 24;
    if (action.air) {
      const active = frame < 7;
      const speed = active ? tuning.dashSpeed : tuning.dashCarry;
      state.vx = action.x * speed;
      state.vz = action.z * speed;
      state.speed = speed;
      state.vy = active ? 0 : state.vy - tuning.gravity * delta;
      const previousHeight = state.y;
      state.y += state.vy * delta;
      const contact = world.sweepCapsule(state, state.vx * delta, state.vz * delta, airborne.normalCapsule, effects.collision);
      state.x = contact.x;
      state.z = contact.z;
      if (state.noGrab > 0) state.noGrab -= delta;
      else if (climbing?.grabNearby()) { burst = null; return; }
      const ground = state.vy <= 0 ? world.groundAt(state.x, state.z, Math.max(previousHeight + 0.1, state.y + 0.35), state.y - 0.02) : null;
      if (ground) {
        state.y = ground.y;
        state.surface = ground.surface;
        state.lastGroundY = ground.y;
        burst = null;
        land(state.fromY - state.y);
      } else if (frame > 8) {
        burst = null;
        changeState('FALL');
      }
      return;
    }
    const phase = clamp((frame - 1) / 7, 0, 1);
    const speed = frame < 8 ? tuning.dodgeSpeed * (1 - 0.35 * phase * phase * (3 - 2 * phase))
      : Math.max(tuning.dodgeSpeed * 0.65 - (frame - 8) * 4, 0);
    state.vx = action.x * speed;
    state.vz = action.z * speed;
    state.speed = speed;
    if (!stepGroundContact(state, delta, tuning, effects)) {
      burst = null;
      fall();
      return;
    }
    const { hit, nx, nz } = effects.collision;
    if (hit) {
      const into = Math.min(0, action.x * nx + action.z * nz);
      action.x -= nx * into;
      action.z -= nz * into;
    }
    if (state.stateT >= (options?.duration('dodge') ?? 0.5) || (frame > 9 && state.stickMag > 0.1)) {
      burst = null;
      state.speed = Math.hypot(state.vx, state.vz);
      classifyGroundGait(state);
    }
  }

  return {
    state: state as Readonly<TraversalState>,
    moveCombat(dx: number, dz: number, heading: number) {
      if (!state.grounded || ![dx, dz, heading].every(Number.isFinite)) return state;
      const contact = world.sweepCapsule(state, dx, dz, bodyCapsule, effects.collision);
      const floor = visit(contact.x, contact.z);
      if (floor) {
        state.x = contact.x;
        state.z = contact.z;
        state.y = floor.y;
        state.rootY = floor.y;
        state.lastGroundY = floor.y;
        state.surface = floor.surface;
        state.carrier = floor.body;
      }
      state.heading = heading;
      return state;
    },
    reset() { Object.assign(state, initial); inkCooldown = 0; burst = null; },
    step(delta: number, input: TraversalInput, view: View) {
      if (!Number.isFinite(delta) || delta < 0) throw RangeError('Traversal step must be nonnegative and finite');
      if (delta === 0) return state.grounded;
      if ((state.grounded || state.mantle) && state.carrier?.enabled) {
        const { x, y, z } = state;
        state.carrier.carry(state);
        state.rootY += state.y - y;
        state.heading = wrapAngle(state.heading + state.carrier.dyaw);
        if (state.mantle) {
          state.mantle.x0 += state.x - x;
          state.mantle.ax += state.x - x;
          state.mantle.y0 += state.y - y;
          state.mantle.z0 += state.z - z;
          state.mantle.az += state.z - z;
        }
      }
      state.stateT += delta;
      inkCooldown = Math.max(0, inkCooldown - delta);
      state.jumpBuf = Math.max(0, state.jumpBuf - delta);
      updateInputSteering(state, input, view, null, delta, tuning.buffer, 1.6);
      if (state.mantle) {
        updateLowMantle(state, mantleAnimation, world, 0.7, 2.1, effects.surfaceName, changeState, fall);
        return state.grounded;
      }
      if (climbing?.update(delta, input, view?.railYaw)) return state.grounded;
      if (input.inkStep && !burst && inkCooldown === 0 && (state.grounded || !state.airDashed) && options?.canInkStep?.()) beginInkStep();
      if (burst) { stepInk(delta, burst); return state.grounded; }
      if (state.jumpBuf > 0 && (state.grounded || state.coyote > 0)) {
        const mantle = state.grounded ? probeLowMantle(state, world, state.stickMag > 0.1 ? 1 : 0.75) : null;
        if (mantle) { enterMantle(mantle); return false; }
        if (state.grounded && climbing?.tryGroundLeap()) return false;
        jump();
      }
      if (!state.grounded) {
        state.coyote = Math.max(0, state.coyote - delta);
        airborne.jumpHeld = input.jumpHeld;
        stepAirborne(state, delta, tuning, airborne);
        return state.grounded;
      }
      const magnitude = state.stickMag;
      let target = 0;
      let facing = state.heading;
      if (magnitude > 0.1) {
        target = input.walk || magnitude < 0.35 ? tuning.walk : magnitude < 0.75 ? tuning.jog : input.sprint ? tuning.sprint : tuning.run;
        facing = Math.atan2(-state.stickX, -state.stickZ);
        const turn = wrapAngle(facing - state.heading);
        const turnRate = tuning.turnSlow + (tuning.turnFast - tuning.turnSlow) * clamp(state.speed / tuning.run, 0, 1);
        state.heading = wrapAngle(state.heading + clamp(turn, -turnRate * delta, turnRate * delta));
      }
      const acceleration = target < state.speed ? tuning.decel : state.speed < tuning.jog ? tuning.accelStart
        : state.speed < tuning.run ? tuning.accel : tuning.accelSprint;
      state.speed += clamp(target - state.speed, -acceleration * delta, acceleration * delta);
      const direction = state.speed < 2.5 ? facing : state.heading;
      const grip = 1 - Math.exp(-tuning.grip * delta);
      state.vx += (-Math.sin(direction) * state.speed - state.vx) * grip;
      state.vz += (-Math.cos(direction) * state.speed - state.vz) * grip;
      if (stepGroundContact(state, delta, tuning, effects)) classifyGroundGait(state);
      else fall();
      state.recentSpeed = Math.max(Math.hypot(state.vx, state.vz), state.recentSpeed - tuning.decel * delta);
      return state.grounded;
    },
  };
}
