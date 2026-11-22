import type { CollisionPosition, CollisionWorld } from '../physics/world.mts';
import { createMovementTrail, findWalkableSegment, trailCapsule, trailGroundAt } from '../player/movement-trail.mts';

interface CompanionPlayer extends Readonly<CollisionPosition> {
  readonly heading: number;
  readonly speed: number;
  readonly state: string;
  readonly grounded: boolean;
  readonly onCarrier: boolean;
}

type Phase = 'STRAY' | 'CARRIED' | 'FOLLOW' | 'IDLE' | 'SIT' | 'WAIT_GAP';
type CompanionEvent = { type: 'found' } | { type: 'gap' };

const FOLLOW_GAP = 1.6;
const STEP_HEIGHT = 0.42;
const PICK_REACH = 1.9;
const STRAY = { x: 6.14, y: 8.316, z: -58.07, heading: -2.897 };
const REST = new Set(['IDLE', 'WALK', 'RUN']);
const distance = (a: Pick<CollisionPosition, 'x' | 'z'>, b: Pick<CollisionPosition, 'x' | 'z'>) => Math.hypot(a.x - b.x, a.z - b.z);
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Ground following and carry state for the authored cat, independent of its rig. */
export function createCompanion(world: CollisionWorld, found: boolean, emit?: (event: CompanionEvent) => void) {
  const trail = createMovementTrail();
  const state = { ...STRAY, phase: (found ? 'CARRIED' : 'STRAY') as Phase, found, speed: 0 };
  let phaseTime = 0;
  let shortcutTime = 0;
  let cursor = 0;
  let vx = 0, vz = 0;

  function phase(next: Phase) {
    if (state.phase === next) return;
    state.phase = next;
    phaseTime = 0;
    if (next === 'WAIT_GAP') emit?.({ type: 'gap' });
  }

  function align(player: CompanionPlayer) {
    const step = 0.65;
    const dx = Math.sin(player.heading) * step, dz = Math.cos(player.heading) * step;
    const x = player.x + dx, z = player.z + dz;
    const surface = trailGroundAt(world, x, z, player.y + STEP_HEIGHT, player.y - STEP_HEIGHT);
    if (!surface || findWalkableSegment(world, player, { x, y: surface.y, z }) === null) return false;
    Object.assign(state, { x, y: surface.y, z, heading: player.heading, speed: 0 });
    vx = vz = 0;
    trail.restart(state);
    cursor = trail.first();
    phase('IDLE');
    return true;
  }

  function toggleCarry(player: CompanionPlayer) {
    if (!player.grounded || !REST.has(player.state) || player.onCarrier) return;
    if (state.phase === 'CARRIED') { align(player); return; }
    if (distance(state, player) >= PICK_REACH || Math.abs(state.y - player.y) >= 0.6) return;
    phase('CARRIED');
    vx = vz = state.speed = 0;
    if (!state.found) { state.found = true; emit?.({ type: 'found' }); }
  }

  function shortcut() {
    let checked = 0;
    for (let index = trail.end() - 1; index > cursor; index--) {
      const point = trail.at(index)!;
      if (distance(point, state) > 7 || Math.abs(point.y - state.y) > 3) continue;
      if (++checked > 8) return;
      if (findWalkableSegment(world, state, point) !== null) { cursor = index; return; }
    }
  }

  function turn(x: number, z: number, delta: number, rate: number) {
    const dx = x - state.x, dz = z - state.z;
    if (Math.hypot(dx, dz) < 0.001) return;
    state.heading = wrap(state.heading + clamp(wrap(Math.atan2(-dx, -dz) - state.heading), -rate * delta, rate * delta));
  }

  function move(destination: CollisionPosition, speed: number, delta: number) {
    const dx = destination.x - state.x, dz = destination.z - state.z;
    const length = Math.hypot(dx, dz);
    const desired = length > 0.001 ? Math.min(speed, length / Math.max(delta, 0.001)) / length : 0;
    const grip = 1 - Math.exp(-8.4 * delta);
    vx += (dx * desired - vx) * grip;
    vz += (dz * desired - vz) * grip;
    state.speed = Math.hypot(vx, vz);
    if (state.speed < 0.001) return;
    const next = world.sweepCapsule(state, vx * delta, vz * delta, trailCapsule);
    const support = trailGroundAt(world, next.x, next.z, state.y + STEP_HEIGHT, state.y - STEP_HEIGHT);
    if (!support || support.ny < 0.55) { vx = vz = state.speed = 0; return; }
    if (state.speed > 0.15) turn(state.x + vx, state.z + vz, delta, 9);
    Object.assign(state, { x: next.x, y: support.y, z: next.z });
  }

  return {
    state: state as Readonly<typeof state>,
    reset(player: CompanionPlayer) {
      trail.clear();
      vx = vz = state.speed = 0;
      if (state.found) {
        Object.assign(state, { x: player.x, y: player.y, z: player.z, heading: player.heading });
        phase('CARRIED');
      } else { Object.assign(state, STRAY); phase('STRAY'); }
    },
    update(delta: number, player: CompanionPlayer, carryPressed: boolean) {
      if (!Number.isFinite(delta) || delta < 0) throw RangeError('Companion step must be finite and nonnegative');
      if (delta === 0) return;
      phaseTime += delta;
      if (carryPressed) toggleCarry(player);
      if (state.phase === 'STRAY') { turn(player.x, player.z, delta, 2.5); return; }
      if (state.phase === 'CARRIED') {
        Object.assign(state, { x: player.x, y: player.y, z: player.z, heading: player.heading, speed: 0 });
        return;
      }
      trail.record(world, player);
      cursor = clamp(cursor, trail.first(), Math.max(trail.first(), trail.end() - 1));
      shortcutTime -= delta;
      if (shortcutTime <= 0) { shortcutTime = 0.25; shortcut(); }
      let target = trail.at(cursor);
      while (target && distance(state, target) < 0.3 && trail.at(cursor + 1)?.broken === false) target = trail.at(++cursor);
      if (!target) return;
      const next = trail.at(cursor + 1);
      const remaining = distance(state, target) + trail.lengthFrom(cursor) + distance(trail.last()!, player);
      const atBreak = distance(state, target) <= 0.35 && (next ? next.broken : trail.since);
      if (remaining > FOLLOW_GAP + 1 && atBreak) {
        phase('WAIT_GAP');
        turn(player.x, player.z, delta, 3);
        return;
      }
      if (remaining > FOLLOW_GAP + 0.15 && (distance(target, state) > 0.35 || next?.broken === false)) {
        phase('FOLLOW');
        move(target, clamp(2.4 * (remaining - FOLLOW_GAP), 0.72, 8.4), delta);
      } else {
        phase(state.phase === 'SIT' || (state.phase === 'IDLE' && phaseTime > 4) ? 'SIT' : 'IDLE');
        const idle = Math.exp(-12 * delta);
        vx *= idle; vz *= idle; state.speed = Math.hypot(vx, vz);
        turn(player.x, player.z, delta, 2.5);
      }
    },
  };
}
