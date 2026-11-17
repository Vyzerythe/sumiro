/**
 * Reconstructed low-mantle probes, entry, and animation-driven completion.
 * Source oracle: the immutable published player-1_KrBWnI.js bundle.
 *
 * Keep legacy query ranges, offset values and strict thresholds to avoid
 * altering the original ledge traversal behavior in this recovery phase.
 */
function smoothstep(start, end, x) {
  const value = Math.min(Math.max((x - start) / (end - start), 0), 1);
  return value * value * (3 - 2 * value);
}

/** Look for a low ledge in the direction of manual movement or player facing. */
export function probeLowMantle(state, world, distance = 1) {
  const usesStick = state.stickMag > .1;
  const dx = usesStick ? state.stickX / state.stickMag : -Math.sin(state.heading);
  const dz = usesStick ? state.stickZ / state.stickMag : -Math.cos(state.heading);
  const hit = world.raycast(state.x, state.y + .35, state.z, dx, 0, dz, distance, 2);
  if (hit >= distance) return null;
  const ground = world.groundAt(
    state.x + dx * (hit + .32),
    state.z + dz * (hit + .32),
    state.y + 1.45, state.y + .45,
  );
  return ground ? {
    x: state.x + dx * hit,
    z: state.z + dz * hit,
    height: ground.y - state.y,
    body: ground.body,
    heading: Math.atan2(-dx, -dz),
  } : null;
}

/** Search along a collision normal for an accessible mantle landing surface. */
export function probeWallMantle(state, collision, world, enterMantle) {
  const dx = -collision.nx;
  const dz = -collision.nz;
  for (let step = .05; step <= .8; step += .1) {
    const x = state.x + dx * step;
    const z = state.z + dz * step;
    const ground = world.groundAt(x, z, state.y + 1.45, state.y + .35);
    if (!ground) continue;
    const top = ground.y;
    const carrier = ground.body;
    if (world.groundAt(x, z, Infinity, state.y + 1.45) ||
        !world.groundAt(x + dx * .4, z + dz * .4, top + .5, top - .5)) {
      return false;
    }
    state.heading = Math.atan2(collision.nx, collision.nz);
    enterMantle({x, z, height: top - state.y, body: carrier});
    return true;
  }
  return false;
}

/** Begin original short mantle animation and reset conflicting motion states. */
export function beginLowMantle(state, destination, forwardOffset, play, changeState) {
  if (destination.heading !== undefined) state.heading = destination.heading;
  const dx = -Math.sin(state.heading);
  const dz = -Math.cos(state.heading);
  state.mantle = {
    h: destination.height,
    x0: state.x,
    z0: state.z,
    y0: state.y,
    ax: destination.x - dx * forwardOffset,
    az: destination.z - dz * forwardOffset,
  };
  state.carrier = destination.body;
  state.vx = state.vz = state.vy = state.speed = 0;
  state.grounded = false;
  state.airDashed = false;
  state.fade = 0;
  state.dissolve = 0;
  play('mantle_low', {fade: .08, speed: 1.1});
  changeState('MANTLE_LOW');
}

/**
 * Track the mantle clip and resolve final ground / carrier on completion.
 * The original caller is responsible for responding to a fall transition.
 */
export function updateLowMantle(
  state, animation, world, forwardOffset, heightGain,
  surfaceName, changeState, beginFall,
) {
  const mantle = state.mantle;
  const frame = animation.key();
  const along = smoothstep(0, 3, frame);
  state.x = mantle.x0 + (mantle.ax - mantle.x0) * along;
  state.z = mantle.z0 + (mantle.az - mantle.z0) * along;
  state.y = mantle.y0 + (mantle.h - 1) * smoothstep(3, 11, frame);
  if (!animation.finished()) return;

  const dx = -Math.sin(state.heading);
  const dz = -Math.cos(state.heading);
  state.x += dx * forwardOffset;
  state.z += dz * forwardOffset;
  state.y = mantle.y0 + mantle.h;
  state.rootY = state.y;
  state.mantle = null;
  animation.gait.idleT = 0;
  animation.playGait(0);
  state.grounded = true;
  state.airDashed = false;

  const ground = world.groundAt(state.x, state.z, state.y + .3, state.y - .6);
  if (ground) {
    state.y = ground.y;
    state.surface = surfaceName(ground.surface);
    state.lastGroundY = ground.y;
    state.carrier = ground.body;
    changeState('IDLE');
  } else {
    beginFall();
  }
}
