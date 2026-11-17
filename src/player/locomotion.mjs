/**
 * The first compact, source-backed portion of interactive player locomotion.
 * Reconstructed from player-1_KrBWnI.js, NOT from the original authoring tree.
 * Preserve the published thresholds, input fallbacks and in-place mutations.
 */

/** Match the four published grounded locomotion bands. */
export function classifyGroundGait(state) {
  const velocity = Math.hypot(state.vx, state.vz);
  const gait = velocity < .15 ? 'IDLE' :
    velocity < 2.8 ? 'WALK' :
    velocity < 7.1 ? 'RUN' : 'SPRINT';
  if (gait !== state.state) {
    state.state = gait;
    state.stateT = 0;
  }
}

/** Return the normalized movement or facing direction in the existing output. */
export function selectTravelDirection(state, out) {
  const speed = Math.hypot(state.vx, state.vz);
  if (state.stickMag > .1) {
    out.x = state.stickX / state.stickMag;
    out.z = state.stickZ / state.stickMag;
  } else {
    out.x = speed > 1 ? state.vx / speed : -Math.sin(state.heading);
    out.z = speed > 1 ? state.vz / speed : -Math.cos(state.heading);
  }
}

/**
 * Initiate the original jump, with its existing injectable animation,
 * carrier-detachment, sound and state transition side effects.
 * No new physics or movement policy is introduced.
 */
export function beginJump(state, config, effects) {
  if ((state.braking || state.state === 'TEETER') &&
    state.stickMag > .1 &&
    state.recentSpeed > Math.hypot(state.vx, state.vz)) {
    state.vx = state.stickX / state.stickMag * state.recentSpeed;
    state.vz = state.stickZ / state.stickMag * state.recentSpeed;
  }
  const moving = Math.hypot(state.vx, state.vz) > 2.5;
  state.vy = Math.sqrt(2 * config.gravity * config.jumpHeight);
  effects.detach();
  state.jumpCut = false;
  state.grounded = false;
  state.guardsInAir = false;
  state.fromY = state.y;
  state.coyote = 0;
  effects.play(moving ? 'jump_fwd' : 'jump_up', {fade:.08});
  effects.footstep('L','takeoff',false);
  effects.setState('JUMP');
}

/** Original airborne fall transition from a grounded or moving state. */
export function beginFall(state, config, effects, verticalSpeed = 0) {
  state.vy = verticalSpeed;
  effects.detach();
  state.grounded = false;
  state.coyote = config.coyote;
  state.fromY = state.y;
  state.guardsInAir = true;
  effects.play('fall', {fade:.2});
  effects.setState('FALL');
}
