/** Authored Summit mechanisms from ch6_summit-BczK7QHX.js and level-O-RtwNJJ.js. */
import type { Object3D } from 'three';
import { extrudeWallPolyline, pointInPolygon, type PointXZ } from '../physics/geometry.mts';
import type { MovingTriangleBatch, MovingTriangleBody } from '../physics/moving-body.mts';
import type { CollisionPosition, CollisionWorld } from '../physics/world.mts';

type Point = readonly [x: number, y: number, z: number];
type Size = readonly [width: number, depth: number];
type Phase = 'calm' | 'warn' | 'blow';
type CrumblePhase = 'whole' | 'shaking' | 'falling' | 'gone' | 'rising';
const encounterFlags = { cairn: 'ch6_cairn', gauntlet: 'ch6_gauntlet', duel: 'ch6_duel' } as const;
type Encounter = keyof typeof encounterFlags;
type Flag = (typeof encounterFlags)[Encounter];
type EncounterState = 'idle' | 'fighting' | 'clear';

interface Site { readonly id: string }
interface Placed extends Site, Readonly<CollisionPosition> { readonly node: string }
interface SnowPlatform extends Placed { readonly size: Size; readonly thick: number; readonly surface: 'snow' }
interface Crumble extends SnowPlatform { readonly kind: 'crumble'; readonly delay: number; readonly back: number }
interface Tip extends SnowPlatform {
  readonly kind: 'tip'; readonly maxTilt: number; readonly rate: number; readonly slipFrom: number; readonly slip: number;
}
interface Bridge extends Site {
  readonly kind: 'bridge'; readonly from: Point; readonly to: Point; readonly width: number; readonly sag: number;
  readonly amp: number; readonly period: number; readonly weight: number; readonly slip: number;
  readonly gaps: readonly (readonly [number, number])[];
}
interface Wind extends Site {
  readonly kind: 'wind'; readonly box: readonly [number, number, number, number]; readonly dir: PointXZ;
  readonly yMin: number; readonly yMax: number; readonly force: number; readonly airK: number;
  readonly calm: number; readonly warn: number; readonly blow: number;
  readonly drawY0: number; readonly drawY1: number; readonly streaks?: number;
}
interface Veil extends Site {
  readonly kind: 'veil'; readonly pts: readonly PointXZ[]; readonly from: number; readonly to: number; readonly visual: false;
}
interface Lift extends Site {
  readonly kind: 'lift'; readonly low: number; readonly high: number; readonly rest: number;
  readonly hoistFor: number; readonly speed: number; readonly surface: 'wood';
  readonly cars: readonly [Car, Car]; readonly nodes: readonly [string, string];
}
interface Car { readonly x: number; readonly z: number; readonly size: Size }
interface Bell extends Placed { readonly kind: 'bell'; readonly r: number; readonly links: readonly string[] }
type Definition = Crumble | Tip | Bridge | Wind | Veil | Lift | Bell;

// The five empty body_* carriers belong to chapter-six-ice-holds.mts.
const DEFINITIONS: readonly Definition[] = [
  { kind: 'wind', id: 'w1', box: [24, -120, 36.5, -95], yMin: 12, yMax: 26, dir: [-1, 0], force: 2, airK: 1.6,
    calm: 2.6, warn: 1.2, blow: 2.2, drawY0: 17.4, drawY1: 20.599999999999998 },
  { kind: 'crumble', id: 'corn_0', x: 30, y: 23.999999999999996, z: -163.6, node: 'corn_0', size: [3.4, 3.2],
    thick: 0.7, delay: 0.7, back: 4, surface: 'snow' },
  { kind: 'crumble', id: 'corn_1', x: 31.2, y: 23.999999999999996, z: -168.2, node: 'corn_1', size: [3.4, 3.2],
    thick: 0.7, delay: 0.7, back: 4, surface: 'snow' },
  { kind: 'crumble', id: 'corn_2', x: 30, y: 23.999999999999996, z: -172.8, node: 'corn_2', size: [3.4, 3.2],
    thick: 0.7, delay: 0.7, back: 4, surface: 'snow' },
  { kind: 'crumble', id: 'corn_3', x: 31.2, y: 23.999999999999996, z: -177.4, node: 'corn_3', size: [3.4, 3.2],
    thick: 0.7, delay: 0.7, back: 4, surface: 'snow' },
  { kind: 'wind', id: 'w2', box: [24, -180, 38, -160], yMin: 18, yMax: 36, dir: [-1, 0], force: 2.4, airK: 2.2,
    calm: 3.8, warn: 1.2, blow: 2.2, drawY0: 24.199999999999996, drawY1: 27.399999999999995 },
  { kind: 'wind', id: 'w3', box: [24, -264, 38, -212], yMin: 24, yMax: 46, dir: [-1, 0.1], force: 2.4, airK: 2.2,
    calm: 3.6, warn: 1.2, blow: 2.2, drawY0: 30, drawY1: 39, streaks: 40 },
  { kind: 'bridge', id: 'rope1', from: [20, 51, -323], to: [-18, 51, -323], width: 2.3, sag: 0.5, amp: 3,
    period: 3.4, weight: 0.2, slip: 0.3, gaps: [[12.3, 14.2], [25.3, 27.2]] },
  { kind: 'wind', id: 'w4', box: [-18, -330, 20, -316], yMin: 45, yMax: 60, dir: [0, 1], force: 2.2, airK: 1.5,
    calm: 4.4, warn: 1.2, blow: 2, drawY0: 51, drawY1: 55, streaks: 34 },
  { kind: 'tip', id: 'floe1', x: -38, y: 51.4, z: -323, size: [4.7, 4.7], thick: 0.8, maxTilt: 13, rate: 9,
    slipFrom: 8, slip: 1.8, surface: 'snow', node: 'floe1' },
  { kind: 'tip', id: 'floe2', x: -44.6, y: 51.7, z: -323, size: [4.7, 4.7], thick: 0.8, maxTilt: 13, rate: 9,
    slipFrom: 8, slip: 1.8, surface: 'snow', node: 'floe2' },
  { kind: 'tip', id: 'floe3', x: -51.2, y: 52, z: -323, size: [4.7, 4.7], thick: 0.8, maxTilt: 13, rate: 9,
    slipFrom: 8, slip: 1.8, surface: 'snow', node: 'floe3' },
  { kind: 'tip', id: 'floe4', x: -57.8, y: 52.3, z: -323, size: [4.7, 4.7], thick: 0.8, maxTilt: 13, rate: 9,
    slipFrom: 8, slip: 1.8, surface: 'snow', node: 'floe4' },
  { kind: 'veil', id: 'veil1', pts: [[-72, -331], [-72, -315]], from: 51.6, to: 57.6, visual: false },
  { kind: 'lift', id: 'lift', low: 52.6, high: 70, rest: 1, hoistFor: 12, speed: 2.8,
    cars: [{ x: -84.5, z: -333, size: [3.6, 3.6] }, { x: -90.5, z: -333, size: [3.6, 3.6] }], surface: 'wood',
    nodes: ['lift_a', 'lift_b'] },
  { kind: 'bell', id: 'lift_bell', x: -87.5, y: 54.1, z: -332.6, r: 0.9, links: ['lift'], node: 'lift_bell' },
  { kind: 'wind', id: 'w5', box: [-206, -356, -172, -344], yMin: 70, yMax: 96, dir: [1, 0], force: 1.5, airK: 1.8,
    calm: 4.2, warn: 1.2, blow: 1.8, drawY0: 78, drawY1: 90, streaks: 30 },
];

const GATES: readonly { group: string; enc: Encounter; role: 'in' | 'out'; pts: readonly PointXZ[]; y: number; h: number }[] = [
  { group: 'cairn_in', enc: 'cairn', role: 'in', pts: [[28, -278], [34, -278]], y: 37, h: 5 },
  { group: 'cairn_out', enc: 'cairn', role: 'out', pts: [[28, -302], [34, -302]], y: 37, h: 5 },
  { group: 'gaunt_in', enc: 'gauntlet', role: 'in', pts: [[-106, -352], [-106, -344]], y: 70, h: 5 },
  { group: 'gaunt_out', enc: 'gauntlet', role: 'out', pts: [[-154, -354], [-154, -346]], y: 70, h: 5 },
  { group: 'duel_in', enc: 'duel', role: 'in', pts: [[-224.6, -354], [-224.6, -346]], y: 86.4, h: 6 },
  { group: 'duel_out', enc: 'duel', role: 'out', pts: [[-261.6, -354], [-261.6, -346]], y: 86.4, h: 6 },
];

export interface ChapterSixDrift { x: number; z: number; air: number }
export interface ChapterSixMechanismPlayer extends Readonly<CollisionPosition> {
  readonly carrier?: MovingTriangleBody | null;
  readonly state?: string;
  readonly drift?: ChapterSixDrift;
}
export type ChapterSixMechanismEvent =
  | { type: 'cue'; name: 'bridgeOn' | 'bridgeCreak' | 'tipKnock' | 'crumble' | 'crumbleFall' | 'liftStart' | 'liftStop' | 'bell' }
  | { type: 'cue'; name: 'gust'; metres: number }
  | { type: 'cue'; name: 'gustBlow'; metres: number; seconds: number }
  | { type: 'shake'; strength: number };
export interface ChapterSixMechanismEffects {
  hasFlag?(flag: Flag): boolean;
  encounterState?(encounter: Encounter): EncounterState | undefined;
  onEvent?(event: ChapterSixMechanismEvent): void;
}
type Actor = ChapterSixMechanismPlayer | null | undefined;
type World = Pick<CollisionWorld, 'addBody' | 'body' | 'addTriangles' | 'setGroup'>;
type Emit = (event: ChapterSixMechanismEvent) => void;

interface Pose extends CollisionPosition { yaw: number; pitch: number; roll: number; visible: boolean }
interface State<D extends Definition> { readonly kind: D['kind']; readonly id: string; readonly definition: D }
interface Mover<D extends Bridge | Crumble | Tip> extends State<D> { readonly body: MovingTriangleBody; readonly pose: Readonly<Pose> }
type BridgeState = Mover<Bridge>;
type TipState = Mover<Tip>;
type CrumbleState = Mover<Crumble> & { readonly phase: CrumblePhase };
type WindState = State<Wind> & {
  readonly phase: Phase; readonly pushing: boolean; readonly shown: number; readonly flow: number;
};
type VeilState = State<Veil> & { readonly group: string; readonly passable: boolean };
type LiftState = State<Lift> & {
  readonly bodies: readonly [MovingTriangleBody, MovingTriangleBody]; readonly balance: number; readonly hoistLeft: number;
};
type BellState = State<Bell> & { readonly roll: number; readonly rings: number; readonly placed: boolean };
export type ChapterSixMechanism = BridgeState | TipState | CrumbleState | WindState | VeilState | LiftState | BellState;

interface Runtime<S extends ChapterSixMechanism = ChapterSixMechanism> {
  readonly state: S;
  step(delta: number, player: Actor, drift: ChapterSixDrift): void;
  reset(): void;
}
interface LiftRuntime extends Runtime<LiftState> { trigger(): void }
interface BellRuntime extends Runtime<BellState> { ring(byHit: boolean): boolean }
interface VeilRuntime extends Runtime<VeilState> { inkStep(): void }

const radians = Math.PI / 180;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const approach = (value: number, target: number, step: number) => value < target
  ? Math.min(value + step, target) : Math.max(value - step, target);
const smooth = (value: number) => value * value * (3 - 2 * value);

function platformBatches([width, depth]: Size, thickness: number, surface: 'wood' | 'snow', walls = true) {
  const x = width / 2;
  const z = depth / 2;
  const batches: MovingTriangleBatch[] = [
    { positions: [-x,0,-z, x,0,-z, x,0,z, -x,0,-z, x,0,z, -x,0,z], kind: 1, surface },
  ];
  if (walls) {
    const rim: PointXZ[] = [[-x,-z],[x,-z],[x,z],[-x,z],[-x,-z]];
    batches.push({ positions: extrudeWallPolyline(rim, () => -thickness, () => -0.02), kind: 2 });
  }
  return batches;
}

function makePose(x: number, y: number, z: number, yaw = 0): Pose {
  return { x, y, z, yaw, pitch: 0, roll: 0, visible: true };
}

function place(body: MovingTriangleBody, pose: Pose, y: number, pitch: number, roll: number, delta: number) {
  body.setPose(pose.x, y, pose.z, pose.yaw, pitch, roll, delta);
  pose.y = y;
  pose.pitch = pitch;
  pose.roll = roll;
}

function createBridge(world: World, definition: Bridge, emit: Emit): Runtime<BridgeState> {
  const [x, y, z] = definition.from;
  const [toX, toY, toZ] = definition.to;
  const length = Math.hypot(toX - x, toZ - z);
  const yaw = Math.atan2(toX - x, toZ - z);
  const segments = Math.max(4, Math.round(length / 1.1));
  const half = definition.width / 2;
  const altitude = (s: number) => (toY - y) * s / length - definition.sag * 4 * (s / length) * (1 - s / length);
  const positions: number[] = [];
  for (let index = 0; index < segments; index++) {
    const from = index / segments * length;
    const to = (index + 1) / segments * length;
    const mid = (from + to) / 2;
    if (definition.gaps.some(([a, b]) => mid > a && mid < b)) continue;
    const y0 = altitude(from), y1 = altitude(to);
    positions.push(-half,y0,from, half,y0,from, half,y1,to, -half,y0,from, half,y1,to, -half,y1,to);
  }
  const body = world.addBody(definition.id, [{ positions, kind: 1, surface: 'rope' }]);
  const pose = makePose(x, y, z, yaw);
  let riding = false;
  let time = 0;
  let load = 0;
  return {
    state: { kind: 'bridge', id: definition.id, definition, body, pose },
    step(delta, player, drift) {
      time += delta;
      const nextRiding = player?.carrier === body;
      if (nextRiding && !riding) emit({ type: 'cue', name: 'bridgeOn' });
      riding = nextRiding;
      const angle = time / definition.period * Math.PI * 2;
      if (riding && Math.cos((time - delta) / definition.period * Math.PI * 2) * Math.cos(angle) < 0) {
        emit({ type: 'cue', name: 'bridgeCreak' });
      }
      load = approach(load, Number(riding), delta * 1.6);
      const roll = (definition.amp * radians) * (0.45 + 0.55 * load) * Math.sin(angle);
      const offset = -definition.weight * load * (0.6 + 0.4 * Math.sin(time / definition.period * Math.PI * 4));
      place(body, pose, y + offset, 0, roll, delta);
      if (riding) {
        const slip = Math.sin(roll) * definition.slip * 8;
        drift.x += Math.cos(yaw) * slip;
        drift.z += -Math.sin(yaw) * slip;
      }
    },
    reset() { time = load = 0; place(body, pose, y, 0, 0, 0); },
  };
}

function createTip(world: World, definition: Tip, emit: Emit): Runtime<TipState> {
  const { x, y, z, size, thick, surface, maxTilt, rate, slipFrom, slip } = definition;
  const body = world.addBody(definition.id, platformBatches(size, thick, surface, false));
  const pose = makePose(x, y, z);
  let riding = false;
  return {
    state: { kind: 'tip', id: definition.id, definition, body, pose },
    step(delta, player, drift) {
      const nextRiding = player?.carrier === body;
      if (nextRiding && !riding) emit({ type: 'cue', name: 'tipKnock' });
      riding = nextRiding;
      const local = nextRiding ? body.toLocal(player.x, player.y, player.z) : null;
      const rollGoal = local ? clamp(-local.x / (size[0] / 2), -1, 1) * (maxTilt * radians) : 0;
      const pitchGoal = local ? clamp(local.z / (size[1] / 2), -1, 1) * (maxTilt * radians) : 0;
      const pitch = approach(pose.pitch, pitchGoal, rate * radians * delta);
      const roll = approach(pose.roll, rollGoal, rate * radians * delta);
      place(body, pose, y, pitch, roll, delta);
      if (riding) {
        drift.x += Math.abs(roll) > slipFrom * radians ? -Math.sign(roll) * slip : 0;
        drift.z += Math.abs(pitch) > slipFrom * radians ? Math.sign(pitch) * slip : 0;
      }
    },
    reset() { place(body, pose, y, 0, 0, 0); },
  };
}

function createCrumble(world: World, definition: Crumble, emit: Emit): Runtime<CrumbleState> {
  const { x, y, z, size, thick, surface, delay, back } = definition;
  const body = world.addBody(definition.id, platformBatches(size, thick, surface));
  const pose = makePose(x, y, z);
  const state = { kind: 'crumble' as const, id: definition.id, definition, body, pose, phase: 'whole' as CrumblePhase };
  let time = 0, velocity = 0, drop = 0;
  return {
    state,
    step(delta, player) {
      time += delta;
      let shakeX = 0, shakeZ = 0;
      switch (state.phase) {
        case 'whole':
          if (player?.carrier === body) {
            state.phase = 'shaking'; time = 0;
            emit({ type: 'cue', name: 'crumble' });
          }
          break;
        case 'shaking': {
          const amplitude = 0.012 + 0.05 * (time / delay);
          shakeX = Math.sin(time * 71) * amplitude;
          shakeZ = Math.sin(time * 93) * amplitude;
          if (time >= delay) {
            state.phase = 'falling'; time = velocity = drop = 0; body.enabled = false;
            emit({ type: 'cue', name: 'crumbleFall' });
            emit({ type: 'shake', strength: 0.12 });
          }
          break;
        }
        case 'falling':
          velocity += 20 * delta;
          drop += velocity * delta;
          if (time >= 1.3) { state.phase = 'gone'; time = 0; pose.visible = false; }
          break;
        case 'gone': {
          const occupied = player && player.x > body.minX - 0.5 && player.x < body.maxX + 0.5 &&
            player.z > body.minZ - 0.5 && player.z < body.maxZ + 0.5 && Math.abs(player.y - y) < 2.5;
          if (time >= back && !occupied) { state.phase = 'rising'; time = 0; drop = 1.2; pose.visible = true; }
          break;
        }
        case 'rising':
          drop = 1.2 * (1 - smooth(Math.min(time / 0.5, 1)));
          if (time >= 0.5) { state.phase = 'whole'; drop = 0; body.enabled = true; }
          break;
      }
      body.setPose(x, y, z, 0, 0, 0, delta);
      pose.x = x + shakeX; pose.y = y - drop; pose.z = z + shakeZ;
    },
    reset() {
      state.phase = 'whole'; time = drop = 0; body.enabled = true; pose.visible = true;
      pose.x = x; pose.y = y; pose.z = z;
      body.setPose(x, y, z);
    },
  };
}

function createWind(definition: Wind, emit: Emit): Runtime<WindState> {
  const { calm, warn, blow, force, airK, yMin, yMax } = definition;
  const [x0, z0, x1, z1] = definition.box;
  const [dx, dz] = definition.dir;
  const length = Math.hypot(dx, dz) || 1;
  const bounds: PointXZ[] = [[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
  const duration = calm + warn + blow;
  const state = { kind: 'wind' as const, id: definition.id, definition, phase: 'calm' as Phase,
    pushing: false, shown: 0, flow: 0 };
  let time = 0;
  return {
    state,
    step(delta, player, drift) {
      time += delta;
      const position = (time % duration + duration) % duration;
      const phase = position < calm ? 'calm' : position < calm + warn ? 'warn' : 'blow';
      if (state.phase !== phase) {
        state.phase = phase;
        const metres = player
          ? Math.hypot(Math.max(x0 - player.x, 0, player.x - x1), Math.max(z0 - player.z, 0, player.z - z1))
          : Infinity;
        if (phase === 'warn') emit({ type: 'cue', name: 'gust', metres });
        if (phase === 'blow') emit({ type: 'cue', name: 'gustBlow', metres, seconds: duration - calm - warn });
      }
      state.shown = approach(state.shown, phase === 'blow' ? 0.62 : phase === 'warn' ? 0.34 : 0, delta * 0.9);
      state.flow += delta * (phase === 'calm' ? 3 : phase === 'warn' ? 7 : 12);
      state.pushing = !!player && phase === 'blow' && player.y >= yMin && player.y <= yMax &&
        pointInPolygon(player.x, player.z, bounds);
      if (state.pushing) {
        drift.x += dx / length * force; drift.z += dz / length * force; drift.air = airK;
      }
    },
    reset() { time = 0; state.phase = 'calm'; state.shown = 0; },
  };
}

function createVeil(world: World, definition: Veil): VeilRuntime {
  const group = 'veil_' + definition.id;
  world.addTriangles(extrudeWallPolyline(definition.pts, () => definition.from, () => definition.to), { kind: 2, group });
  const state = { kind: 'veil' as const, id: definition.id, definition, group, passable: false };
  return {
    state,
    step(_delta, player) {
      state.passable = player?.state === 'DASH' || player?.state === 'DODGE';
      world.setGroup(group, !state.passable);
    },
    // The original event opens collision immediately; the next tick recomputes it from the actor state.
    inkStep() { world.setGroup(group, false); },
    reset() { state.passable = false; world.setGroup(group, true); },
  };
}

function createLift(world: World, definition: Lift, emit: Emit): LiftRuntime {
  const thickness = 0.4;
  const bodyA = world.addBody(definition.id + '_a', platformBatches(definition.cars[0].size, thickness, definition.surface));
  const bodyB = world.addBody(definition.id + '_b', platformBatches(definition.cars[1].size, thickness, definition.surface));
  const bodies = [bodyA, bodyB] as const;
  const state = { kind: 'lift' as const, id: definition.id, definition, bodies, balance: definition.rest, hoistLeft: 0 };
  let hoisted = -1;
  let hauling = false;
  const range = definition.high - definition.low;
  const yAt = (index: number, balance: number) => index === 0 ? definition.high - range * balance : definition.low + range * balance;

  function placeCars(delta: number) {
    for (const [index, body] of bodies.entries()) {
      const { x, z } = definition.cars[index]!;
      body.setPose(x, yAt(index, state.balance), z, 0, 0, 0, delta);
    }
  }
  function obstructed(body: MovingTriangleBody, nextY: number, player: ChapterSixMechanismPlayer) {
    const bottom = nextY - thickness - 0.02;
    return player.carrier !== body && nextY < body.y - 1e-5 &&
      player.x > body.minX - 0.3 && player.x < body.maxX + 0.3 &&
      player.z > body.minZ - 0.3 && player.z < body.maxZ + 0.3 && player.y + 1.7 > bottom && player.y < bottom;
  }

  return {
    state,
    trigger() {
      hoisted = Number(state.balance < 0.5);
      state.hoistLeft = definition.hoistFor;
    },
    step(delta, player) {
      const ridingA = player?.carrier === bodyA;
      const ridingB = player?.carrier === bodyB;
      let target = definition.rest;
      let speed = 1.2;
      if (state.hoistLeft > 0) {
        state.hoistLeft -= delta;
        target = hoisted === 0 ? 0 : 1;
        speed = definition.speed;
      } else if (ridingA || ridingB) {
        target = ridingA ? 1 : 0;
        speed = definition.speed;
      }
      const next = approach(state.balance, target, speed / (range || 1) * delta);
      const blocked = !!player && bodies.some((body, index) => obstructed(body, yAt(index, next), player));
      const moving = !blocked && next !== state.balance && (ridingA || ridingB || state.hoistLeft > 0);
      if (moving !== hauling) emit({ type: 'cue', name: moving ? 'liftStart' : 'liftStop' });
      hauling = moving;
      if (!blocked) state.balance = next;
      placeCars(delta);
    },
    reset() {
      if (hauling) emit({ type: 'cue', name: 'liftStop' });
      hauling = false; state.balance = definition.rest; state.hoistLeft = 0; hoisted = -1;
      placeCars(0);
    },
  };
}

function createBell(definition: Bell, lift: LiftRuntime, emit: Emit): BellRuntime {
  const state = { kind: 'bell' as const, id: definition.id, definition, roll: 0, rings: 0, placed: false };
  let time = 0, last = -10, swing = 0;
  return {
    state,
    ring(byHit) {
      if (byHit && time - last < 0.9) return false;
      last = time; state.rings++; swing = 1;
      emit({ type: 'cue', name: 'bell' });
      emit({ type: 'shake', strength: 0.1 });
      lift.trigger();
      return true;
    },
    step(delta) {
      time += delta;
      swing = Math.max(0, swing - delta * 0.45);
      state.roll = Math.sin(time * 7) * 0.32 * swing;
      state.placed = true;
    },
    reset() { swing = state.rings = 0; },
  };
}

/** Install and own the Summit mechanisms, apart from its independently owned ice grips. */
export function createChapterSixMechanisms(world: World, effects: ChapterSixMechanismEffects = {}) {
  const ids = DEFINITIONS.flatMap(definition => {
    switch (definition.kind) {
      case 'lift': return definition.nodes;
      case 'bridge': case 'tip': case 'crumble': return [definition.id];
      default: return [];
    }
  });
  const duplicate = ids.find(id => world.body(id));
  if (duplicate) throw Error(`Chapter Six body ${duplicate} was already installed`);
  const emit: Emit = event => effects.onEvent?.(event);

  let installedLift: LiftRuntime | undefined;
  let installedBell: BellRuntime | undefined;
  let installedVeil: VeilRuntime | undefined;
  const runtime = DEFINITIONS.map((definition): Runtime => {
    switch (definition.kind) {
      case 'bridge': return createBridge(world, definition, emit);
      case 'tip': return createTip(world, definition, emit);
      case 'crumble': return createCrumble(world, definition, emit);
      case 'wind': return createWind(definition, emit);
      case 'veil': return installedVeil = createVeil(world, definition);
      case 'lift': return installedLift = createLift(world, definition, emit);
      case 'bell':
        if (!installedLift) throw Error('Chapter Six lift must precede its bell');
        return installedBell = createBell(definition, installedLift, emit);
    }
  });
  const lift = installedLift, bell = installedBell, veil = installedVeil;
  if (!lift || !bell || !veil) throw Error('Chapter Six requires its lift, bell and veil');

  const list: readonly ChapterSixMechanism[] = runtime.map(item => item.state);
  const byId = new Map(list.map(item => [item.id, item]));
  const bodies = list.flatMap(item => item.kind === 'lift' ? item.bodies : 'body' in item ? [item.body] : []);
  const drift: ChapterSixDrift = { x: 0, z: 0, air: 1 };
  const gates = GATES.map(definition => ({ definition, closed: true, amount: 1 }));
  let disposed = false;

  function syncGates(delta: number) {
    for (const gate of gates) {
      const { enc, role, group } = gate.definition;
      const state = effects.encounterState?.(enc) ?? (effects.hasFlag?.(encounterFlags[enc]) ? 'clear' : 'idle');
      gate.closed = state === 'fighting' || (state === 'idle' && role === 'out');
      world.setGroup(group, gate.closed);
      gate.amount = approach(gate.amount, Number(gate.closed), delta * 1.4);
    }
  }

  function reset() {
    if (disposed) return;
    for (const item of runtime) item.reset();
    syncGates(0);
  }
  reset();

  return {
    list,
    get(id: string) { return byId.get(id); },
    lift: lift.state,
    liftBell: bell.state,
    veil: veil.state,
    gates: gates as readonly Readonly<typeof gates[number]>[],
    reset,
    ringLiftBell({ byHit = true } = {}) { return !disposed && bell.ring(byHit); },
    inkStep() { if (!disposed) veil.inkStep(); },
    step(delta: number, player?: ChapterSixMechanismPlayer | null): Readonly<ChapterSixDrift> {
      if (!Number.isFinite(delta) || delta < 0) throw RangeError('Mechanism step must be finite and nonnegative');
      if (disposed || delta === 0) return drift;
      drift.x = drift.z = 0; drift.air = 1;
      for (const item of runtime) item.step(delta, player, drift);
      if (player?.drift) Object.assign(player.drift, drift);
      syncGates(delta);
      return drift;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const body of bodies) {
        body.enabled = false;
        body.setPose(body.x, body.y, body.z, body.yaw, body.pitch, body.roll);
      }
      world.setGroup(veil.state.group, false);
      for (const { definition } of gates) world.setGroup(definition.group, true);
      drift.x = drift.z = 0; drift.air = 1;
    },
  };
}

/** Bind supplied Summit meshes and lift ropes. Optional node rope1 is for a generated bridge visual. */
export function bindChapterSixMechanismPresentation(
  root: Pick<Object3D, 'getObjectByName'>, mechanisms: Pick<ReturnType<typeof createChapterSixMechanisms>, 'list' | 'lift' | 'liftBell'>,
): () => void {
  const bindings = mechanisms.list.flatMap(item => {
    if (!('pose' in item)) return [];
    const node = root.getObjectByName(item.kind === 'bridge' ? item.id : item.definition.node);
    return node ? [{ node, pose: item.pose }] : [];
  });
  const cars = mechanisms.lift.definition.nodes.map((name, index) => ({
    node: root.getObjectByName(name), rope: root.getObjectByName('rope_' + name), body: mechanisms.lift.bodies[index]!,
  }));
  const bell = root.getObjectByName(mechanisms.liftBell.definition.node);
  function sync() {
    for (const { node, pose } of bindings) {
      node.position.set(pose.x, pose.y, pose.z);
      node.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ');
      node.visible = pose.visible;
    }
    for (const { node, rope, body } of cars) {
      node?.position.set(body.x, body.y, body.z);
      node?.rotation.set(0, 0, 0, 'YXZ');
      if (rope && node) rope.scale.y = Math.max(76 - node.position.y, 0.1);
    }
    // The published manager first positions the authored bell on a live tick.
    if (bell && mechanisms.liftBell.placed) {
      const { x, y, z } = mechanisms.liftBell.definition;
      bell.position.set(x, y, z);
      bell.rotation.set(0, 0, mechanisms.liftBell.roll, 'YXZ');
    }
  }
  sync();
  return sync;
}
