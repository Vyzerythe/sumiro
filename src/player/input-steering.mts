/**
 * Player input-to-world steering reconstructed from the shipped Sumiro player
 * module, player-1_KrBWnI.js.
 *
 * This is a compatibility implementation, not an upstream source checkout.
 * Preserve angle wrap, zone locking, scripted steering and jump buffering.
 */

import type { InputManager } from '../input/input-manager.mts';

export interface SteeringState<Zone = string> {
  state: string;
  zone: Zone | null;
  holdActive: boolean;
  yaw: number;
  holdYaw: number;
  holdAngle: number;
  grounded: boolean;
  stickX: number;
  stickZ: number;
  stickMag: number;
  stickAngle: number;
  jumpBuf: number;
}

interface CameraSteering<Zone> {
  railYaw?: number;
  zone?: Zone | null;
}

interface ScriptedSteering {
  x: number;
  z: number;
  mag?: number;
}

function wrapAngle(angle: number) {
  let result = (angle + Math.PI) % (Math.PI * 2);
  if (result < 0) result += Math.PI * 2;
  return result - Math.PI;
}
function clamp(value: number, low: number, high: number) {
  return Math.min(Math.max(value, low), high);
}

/**
 * Mutates the live player state, as the original closure does.
 *
 * Uses the camera rail heading, unless a scripted movement supplies direction.
 */
export function updateInputSteering<Zone,>(
  state: SteeringState<Zone>, input: Pick<InputManager, 'forward' | 'strafe' | 'jump'>,
  rail: CameraSteering<Zone> | null, script: ScriptedSteering | null,
  delta: number, jumpBuffer: number, holdYawRate: number,
) {
  const cameraYaw = (rail?.railYaw ?? 0) * (Math.PI / 180);
  const zone = rail?.zone ?? null;

  if (script) {
    state.zone = zone;
    state.holdActive = false;
    state.yaw = cameraYaw;
    const length = Math.hypot(script.x, script.z);
    const magnitude = length > 1e-4 ? clamp(script.mag ?? 1, 0, 1) : 0;
    state.stickX = magnitude ? script.x / length * magnitude : 0;
    state.stickZ = magnitude ? script.z / length * magnitude : 0;
    state.stickMag = magnitude;
    state.stickAngle = 0;
    return;
  }

  const forward = input.forward;
  const strafe = input.strafe;
  const magnitude = Math.min(Math.hypot(forward, strafe), 1);
  const inputAngle = Math.atan2(strafe, forward);

  if (zone !== state.zone) {
    state.zone = zone;
    if (!state.holdActive && magnitude > .1) {
      state.holdActive = true;
      state.holdYaw = state.yaw;
      state.holdAngle = inputAngle;
    }
  }

  const leaping = state.state === "LEAP";
  if (state.holdActive && !leaping &&
    (magnitude <= .1 || Math.abs(wrapAngle(inputAngle - state.holdAngle)) > .4)) {
    state.holdActive = false;
  }

  if (state.holdActive && state.grounded) {
    const correction = wrapAngle(cameraYaw - state.holdYaw);
    state.holdYaw = wrapAngle(state.holdYaw +
      clamp(correction, -1.6 * delta, holdYawRate * delta));
    if (Math.abs(correction) < holdYawRate * delta) state.holdActive = false;
  }

  if (!state.holdActive && !leaping) state.yaw = cameraYaw;

  const worldYaw = state.holdActive ? state.holdYaw : cameraYaw;
  const sine = Math.sin(worldYaw);
  const cosine = Math.cos(worldYaw);
  const scale = magnitude > .001 ? magnitude / Math.hypot(forward, strafe) : 0;

  state.stickX = (-sine * forward + cosine * strafe) * scale;
  state.stickZ = (-cosine * forward - sine * strafe) * scale;
  state.stickMag = magnitude;
  state.stickAngle = inputAngle;
  if (input.jump) state.jumpBuf = jumpBuffer;
}
