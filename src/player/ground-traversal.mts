import type { InputManager } from '../input/input-manager.mts';
import type { CapsuleHit, CollisionWorld } from '../physics/world.mts';
import { updateInputSteering, type SteeringState } from './input-steering.mts';
import { classifyGroundGait } from './locomotion.mts';
import { stepGroundContact, type GroundContactState, type GroundContactEffects } from './motion-physics.mts';
import { movementConfig as tuning } from './movement-config.mjs';

interface TraversalState extends GroundContactState, SteeringState {
  heading: number;
  speed: number;
  stateT: number;
}

type WalkingInput = Pick<InputManager, 'forward' | 'strafe' | 'jump' | 'walk' | 'sprint'>;
type View = Parameters<typeof updateInputSteering<string>>[2];

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Standing and grounded movement. A loss of support returns control to the caller. */
export function createGroundTraversal(world: CollisionWorld, spawn: Readonly<{ x: number; z: number; heading: number }>) {
  const ground = world.groundAt(spawn.x, spawn.z);
  if (!ground) throw Error('Traversal spawn has no ground support');
  const state: TraversalState = {
    ...spawn, y: ground.y, lastGroundY: ground.y, surface: ground.surface, carrier: ground.body,
    vx: 0, vz: 0, speed: 0, drift: { x: 0, z: 0 }, grounded: true,
    state: 'IDLE', stateT: 0, zone: null, yaw: spawn.heading, holdActive: false, holdYaw: 0, holdAngle: 0,
    stickX: 0, stickZ: 0, stickMag: 0, stickAngle: 0, jumpBuf: 0,
  };
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
    hasSupport: (x, z) => Boolean(visit(x, z)),
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

  return {
    state: state as Readonly<TraversalState>,
    step(delta: number, input: WalkingInput, view: View) {
      if (!Number.isFinite(delta) || delta < 0) throw RangeError('Traversal step must be nonnegative and finite');
      if (delta === 0 || !state.grounded) return state.grounded;
      state.stateT += delta;
      state.jumpBuf = Math.max(0, state.jumpBuf - delta);
      updateInputSteering(state, input, view, null, delta, tuning.buffer, 1.6);
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
      state.grounded = stepGroundContact(state, delta, tuning, effects);
      if (state.grounded) classifyGroundGait(state);
      return state.grounded;
    },
  };
}
