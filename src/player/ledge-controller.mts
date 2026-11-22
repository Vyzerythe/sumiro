/**
 * Reconstructed ledge-hang control from Sumiro's shipped player chunk.
 *
 * This module owns the SHIMMY / HANG / GRAB input transitions and the
 * successful CLIMB completion step. Other gameplay concerns (leap targets,
 * animation timing, platform transport, mantle) remain injected at the
 * boundary. This preserves the shipped order and thresholds.
 */
import type { CollisionPosition, CollisionSurface } from '../physics/world.mts';
import type { LedgeCarrier, SampledLedge } from './ledge-grab.mts';
import type { LedgeSample } from './ledge-path.mts';

interface ShimmyHold { key: number; dir: number }

export interface LedgeShimmyState {
  ledge: (SampledLedge & { length: number }) | null;
  ledgeS: number;
  shimmyHold: ShimmyHold | null;
  state: string;
}

export interface LedgeHangState {
  ledge: { body?: LedgeCarrier | null } | null;
  shimmyHold: ShimmyHold | null;
  state: string;
  stateT: number;
  y: number;
  lastGroundY: number;
  hangBackFresh: boolean;
  hangForward: number;
  hangBack: number;
  jumpBuf: number;
}

export interface LedgeHangActions {
  drop(): void;
  align(): void;
  changeState(state: 'HANG'): void;
  leapBack(): void;
  leapSide(direction: number, vertical: number): boolean;
  climbOrLeap(): void;
  shimmy(elapsed: number, input: number): void;
}

export interface LedgeClimbState<Body, Surface extends CollisionSurface> extends CollisionPosition {
  heading: number;
  rootY: number;
  ledge: SampledLedge | null;
  grounded: boolean;
  surface: Surface;
  carrier: Body | null;
  lastGroundY: number;
  fromY: number;
}

interface ClimbAnimation {
  key(): number;
  finished(): boolean;
  gait: { idleT: number };
  playGait(value: number): void;
}

interface ClimbWorld<Body> {
  groundAt(x: number, z: number, maxY: number, minY: number): { y: number; surface: CollisionSurface; body: Body | null } | null;
}

interface ClimbOptions<Surface extends CollisionSurface> {
  forwardOffset: number;
  heightGain: number;
  surface(value: CollisionSurface): Surface;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** Shift an attached player along the ledge's local arc-length coordinates. */
export function shimmyAlongLedge(
  state: LedgeShimmyState, directionInput: number, elapsed: number, railYaw: number | null | undefined,
  shimmyRate: number, align: () => void, changeState: (state: 'SHIMMY') => void,
): void {
  const behind: Partial<LedgeSample> = {};
  const ahead: Partial<LedgeSample> = {};
  state.ledge!.at(state.ledgeS - .05, behind);
  state.ledge!.at(state.ledgeS + .05, ahead);

  const tangentX = ahead.x! - behind.x!;
  const tangentZ = ahead.z! - behind.z!;
  const cameraAngle = (railYaw ?? 0) * (Math.PI / 180);
  const projected = tangentX * Math.cos(cameraAngle) - tangentZ * Math.sin(cameraAngle);
  const inputSign = Math.sign(directionInput);

  if (state.shimmyHold?.key !== inputSign) {
    state.shimmyHold = {
      key: inputSign,
      dir: inputSign * (projected >= 0 ? 1 : -1),
    };
  }
  const direction = state.shimmyHold.dir;
  const travel = .48 * shimmyRate;
  const next = clamp(
    state.ledgeS + Math.sign(direction) * travel * elapsed,
    0,
    state.ledge!.length,
  );

  if (state.state !== 'SHIMMY') changeState('SHIMMY');
  if (next !== state.ledgeS) {
    state.ledgeS = next;
    align();
  }
}

/**
 * Dispatch the original hanging-state input priority:
 * carrier loss > initial grab wait > buffered jump > forward climb >
 * backward drop > shimmy > hanging idle.
 */
export function updateLedgeHang(state: LedgeHangState, input: { forward: number; strafe: number },
  elapsed: number, animationWait: number, actions: LedgeHangActions): void {
  const forward = input.forward;
  const strafe = input.strafe;

  if (state.ledge!.body) {
    if (!state.ledge!.body.enabled) {
      actions.drop();
      return;
    }
    actions.align();
  }

  state.lastGroundY = state.y;
  if (forward >= -.3) state.hangBackFresh = true;
  if (state.state === 'GRAB') {
    if (state.stateT > animationWait) actions.changeState('HANG');
    return;
  }

  if (state.jumpBuf > 0) {
    state.jumpBuf = 0;
    if (forward < -.3) {
      actions.leapBack();
      return;
    }
    if (Math.abs(strafe) > .5 &&
      actions.leapSide(Math.sign(strafe), 0)) return;
    actions.climbOrLeap();
    return;
  }

  const releaseForward = state.hangForward > 0 && forward <= .3;
  const releaseBack = state.hangBack > 0 && forward >= -.3;
  state.hangForward = forward > .3 ? state.hangForward + elapsed : 0;
  state.hangBack = forward < -.3 && state.hangBackFresh
    ? state.hangBack + elapsed : 0;

  if (state.hangForward > .1 || releaseForward) {
    actions.climbOrLeap();
  } else if (state.hangBack > .18 || releaseBack) {
    actions.drop();
  } else if (Math.abs(strafe) > .3) {
    actions.shimmy(elapsed, strafe);
  } else {
    state.shimmyHold = null;
    if (state.state === 'SHIMMY') actions.changeState('HANG');
  }
}

/** Preserve completion offsets and carrier/ground decisions after CLIMB. */
export function completeLedgeClimb<Body, Surface extends CollisionSurface>(
  state: LedgeClimbState<Body, Surface>, view: { kind: string | null; p: number }, animation: ClimbAnimation,
  world: ClimbWorld<Body>, options: ClimbOptions<Surface>, changeState: (state: 'IDLE') => void,
): void {
  view.p = Math.min(animation.key() / 30, 1);
  if (!animation.finished()) return;
  const forwardX = -Math.sin(state.heading);
  const forwardZ = -Math.cos(state.heading);
  state.x += forwardX * options.forwardOffset;
  state.z += forwardZ * options.forwardOffset;
  state.y += options.heightGain;
  state.rootY = state.y;
  view.kind = null;
  state.ledge = null;
  state.grounded = true;
  animation.gait.idleT = 0;
  animation.playGait(0);
  const ground = world.groundAt(state.x,state.z,state.y+.4,state.y-.6);
  if (ground) {
    state.y = ground.y;
    state.surface = options.surface(ground.surface);
  }
  state.carrier = ground ? ground.body : null;
  state.lastGroundY = state.y;
  state.fromY = state.y;
  changeState('IDLE');
}
