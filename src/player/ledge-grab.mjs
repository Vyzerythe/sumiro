/**
 * Ledge acquisition and GRAB entry reconstructed from the published
 * player-1_KrBWnI.js bundle. This is recovered behavior, not upstream source.
 *
 * Keep exact threshold comparisons, traversal order and mutation order:
 * changing any can alter grab timing and control on moving platforms.
 */

/** Reposition an already attached player at its sampled ledge location. */
export function alignToLedge(state, sample, view, outwardOffset, hangingOffset) {
  state.ledge.at(state.ledgeS, sample);
  state.x = sample.x + sample.ox * outwardOffset;
  state.y = sample.y - hangingOffset;
  state.z = sample.z + sample.oz * outwardOffset;
  state.heading = Math.atan2(sample.ox, sample.oz);
  view.holdYaw = state.heading;
  state.rootY = state.y;
}

/** Enter the original GRAB state, retaining all existing side-effect hooks. */
export function beginLedgeGrab(
  state, ledge, distance, sample, view, outwardOffset, hangingOffset, play, changeState,
) {
  state.ledge = ledge;
  state.ledgeS = distance;
  state.carrier = ledge.body ?? null;
  state.vx = state.vz = state.vy = state.speed = 0;
  state.grounded = false;
  state.guardsInAir = false;
  state.hangForward = 0;
  state.hangBack = 0;
  state.hangBackFresh = false;
  state.shimmyHold = null;
  state.fade = 0;
  state.dissolve = 0;
  state.airDashed = false;
  alignToLedge(state, sample, view, outwardOffset, hangingOffset);
  view.kind = 'hang';
  view.ledge = ledge;
  view.p = 0;
  play('hang_idle', {fade: .16});
  changeState('GRAB');
  state.lastGroundY = state.y;
}

/**
 * Scan original ledge insertion order, using each path's nearest/at methods.
 * enterGrab is deliberately injected to retain the original player's
 * existing callbacks and shared visual state.
 */
export function detectLedgeGrab(
  state, ledges, sample, outwardOffset, hangingOffset, reachMultiplier, enterGrab,
) {
  for (const ledge of ledges) {
    if (ledge.body && !ledge.body.enabled) continue;
    const distance = ledge.nearest(state.x, state.z);
    ledge.at(distance, sample);
    const grabX = sample.x + sample.ox * outwardOffset;
    const grabZ = sample.z + sample.oz * outwardOffset;
    const vertical = sample.y - hangingOffset - state.y;
    if (vertical < -.4 * reachMultiplier ||
        vertical > .35 * reachMultiplier ||
        Math.hypot(grabX - state.x, grabZ - state.z) > .7 * reachMultiplier) {
      continue;
    }
    const approach = -(state.vx * sample.ox + state.vz * sample.oz);
    const facing = Math.sin(state.heading) * sample.ox +
      Math.cos(state.heading) * sample.oz;
    if (!(approach < -.5 && facing < .2)) {
      enterGrab(ledge, distance);
      return true;
    }
  }
  return false;
}
