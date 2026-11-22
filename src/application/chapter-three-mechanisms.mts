/** Chapter Three mechanism metadata and fixed-step rules from the published chapter and level loaders. */
import type { Object3D } from 'three';
import { extrudeWallPolyline, pointInPolygon, type PointXZ } from '../physics/geometry.mts';
import type { MovingTriangleBatch, MovingTriangleBody } from '../physics/moving-body.mts';
import type { CollisionPosition, CollisionWorld } from '../physics/world.mts';

type Point3 = readonly [x: number, y: number, z: number];
type PlatformSize = readonly [width: number, depth: number];
type Range = readonly [min: number, max: number];
type WindPhase = 'calm' | 'warn' | 'blow';
type CrumblePhase = 'whole' | 'shaking' | 'falling' | 'gone' | 'rising';

interface BridgeDefinition {
  readonly kind: 'bridge';
  readonly id: string;
  readonly node: string;
  readonly from: Point3;
  readonly to: Point3;
  readonly width: number;
  readonly sag: number;
  readonly amp: number;
  readonly period: number;
  readonly rails: boolean;
  readonly gaps: readonly Range[];
}

interface PlacedPlatform extends Readonly<CollisionPosition> {
  readonly id: string;
  readonly node: string;
  readonly size: PlatformSize;
  readonly thick?: number;
}

interface TipDefinition extends PlacedPlatform {
  readonly kind: 'tip';
  readonly maxTilt: number;
  readonly rate: number;
  readonly slipFrom: number;
  readonly slip: number;
  readonly surface: 'wood';
}

interface CrumbleDefinition extends PlacedPlatform {
  readonly kind: 'crumble';
  readonly delay: number;
  readonly back: number;
  readonly surface?: 'wood';
}

interface WindDefinition {
  readonly kind: 'wind';
  readonly id: string;
  readonly box: readonly [minX: number, minZ: number, maxX: number, maxZ: number];
  readonly dir: PointXZ;
  readonly force: number;
  readonly airK: number;
  readonly calm: number;
  readonly warn: number;
  readonly blow: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly drawY0: number;
  readonly drawY1: number;
  readonly streaks: number;
}

type MovingDefinition = BridgeDefinition | TipDefinition | CrumbleDefinition;
type Definition = MovingDefinition | WindDefinition;

const DEFINITIONS: readonly Definition[] = [
  { kind: 'wind', id: 'gust1', box: [-60, -204, -20, -180], dir: [1, 0], force: 3, airK: 2.5, calm: 3.4,
    warn: 1.2, blow: 3, yMin: 20, yMax: 36, drawY0: 25.2, drawY1: 30, streaks: 14 },
  { kind: 'wind', id: 'gust2', box: [-116, -204, -66, -192], dir: [0, 1], force: 2.8, airK: 2.8, calm: 3.8,
    warn: 1.2, blow: 2.6, yMin: 20, yMax: 36, drawY0: 25.2, drawY1: 29.5, streaks: 14 },
  { kind: 'bridge', id: 'br5', node: 'br5_mesh', rails: true, from: [-91, 25, -202.3], to: [-115, 25, -202.3],
    width: 1.7, sag: 0.6, amp: 4, period: 3.2, gaps: [[7.6, 9.7], [15.4, 17.5]] },
  { kind: 'crumble', id: 'st6_0', node: 'st6_0_mesh', x: -130.2, y: 25, z: -199, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'st6_1', node: 'st6_1_mesh', x: -134.8, y: 25, z: -198.5, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'st6_2', node: 'st6_2_mesh', x: -139.4, y: 25, z: -199.4, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'st6_3', node: 'st6_3_mesh', x: -144, y: 25, z: -198.6, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'st6_4', node: 'st6_4_mesh', x: -148.6, y: 25, z: -199.2, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'wind', id: 'gust3', box: [-280, -214, -212, -192], dir: [0, 1], force: 3, airK: 2.8, calm: 4.2,
    warn: 1.2, blow: 2.4, yMin: 20, yMax: 40, drawY0: 28.2, drawY1: 33, streaks: 14 },
  { kind: 'crumble', id: 'sa_0', node: 'sa_0_mesh', x: -214.2, y: 28, z: -203.6, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'sa_1', node: 'sa_1_mesh', x: -218.8, y: 28, z: -204.4, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'sa_2', node: 'sa_2_mesh', x: -223.4, y: 28, z: -203.6, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'sa_3', node: 'sa_3_mesh', x: -228, y: 28, z: -204.4, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'sb_0', node: 'sb_0_mesh', x: -239.2, y: 28.4, z: -204.6, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'sb_1', node: 'sb_1_mesh', x: -243.8, y: 28.8, z: -205.4, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'sb_2', node: 'sb_2_mesh', x: -248.4, y: 29.2, z: -204.6, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'sb_3', node: 'sb_3_mesh', x: -253, y: 29.6, z: -205.4, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'sc_0', node: 'sc_0_mesh', x: -264, y: 30, z: -204.9, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'sc_1', node: 'sc_1_mesh', x: -268.6, y: 30, z: -204.1, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'sc_2', node: 'sc_2_mesh', x: -273.2, y: 30, z: -204.9, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'crumble', id: 'sc_3', node: 'sc_3_mesh', x: -277.8, y: 30, z: -204.1, size: [3.6, 2.8], delay: 1,
    back: 3.5 },
  { kind: 'wind', id: 'gust4', box: [-307.59999999999997, -214, -285.4, -190], dir: [-1, 0], force: 3.6, airK: 3,
    calm: 3.2, warn: 1.2, blow: 4, yMin: 20, yMax: 40, drawY0: 30.2, drawY1: 34, streaks: 14 },
  { kind: 'wind', id: 'gust5', box: [-382.59999999999997, -214, -318.59999999999997, -190], dir: [0, 1], force: 3,
    airK: 2.8, calm: 5.8, warn: 1.2, blow: 2.2, yMin: 20, yMax: 40, drawY0: 30.2, drawY1: 34.5, streaks: 14 },
  { kind: 'bridge', id: 'br10a', node: 'br10a_mesh', rails: true, from: [-320.59999999999997, 30, -204],
    to: [-342.59999999999997, 30, -204], width: 1.7, sag: 0.7, amp: 4.5, period: 3.1,
    gaps: [[8, 10.1], [15, 17.1]] },
  { kind: 'crumble', id: 'tp_0', node: 'tp_0_mesh', x: -345.2, y: 30, z: -204.1, size: [3.2, 1.9], thick: 0.22,
    delay: 0.7, back: 3, surface: 'wood' },
  { kind: 'crumble', id: 'tp_1', node: 'tp_1_mesh', x: -350.49999999999994, y: 30, z: -203.9, size: [3.2, 1.9],
    thick: 0.22, delay: 0.7, back: 3, surface: 'wood' },
  { kind: 'crumble', id: 'tp_2', node: 'tp_2_mesh', x: -355.29999999999995, y: 30, z: -204.1, size: [3.2, 1.9],
    thick: 0.22, delay: 0.7, back: 3, surface: 'wood' },
  { kind: 'bridge', id: 'br10b', node: 'br10b_mesh', rails: true, from: [-358.59999999999997, 30, -204],
    to: [-380.59999999999997, 30, -204], width: 1.7, sag: 0.7, amp: 4.5, period: 3.5,
    gaps: [[6.4, 8.5], [14, 16.2]] },
  { kind: 'bridge', id: 'br10s', node: 'br10s_mesh', rails: true, from: [-313.59999999999997, 30, -196],
    to: [-313.59999999999997, 30, -174.6], width: 1.6, sag: 0.8, amp: 5, period: 2.9,
    gaps: [[6, 8.1], [12.4, 14.8]] },
  { kind: 'wind', id: 'gust7', box: [-453.59999999999997, -292, -437.79999999999995, -243], dir: [1, 0], force: 3,
    airK: 2.8, calm: 5.4, warn: 1.2, blow: 2.2, yMin: 30, yMax: 50, drawY0: 41.400000000000006,
    drawY1: 45.800000000000004, streaks: 14 },
  { kind: 'tip', id: 'tip0', node: 'tip0_mesh', x: -444.59999999999997, y: 41.2, z: -245.6, size: [3.6, 3.4],
    thick: 0.3, maxTilt: 11, rate: 12, slipFrom: 6, slip: 1.4, surface: 'wood' },
  { kind: 'tip', id: 'tip1', node: 'tip1_mesh', x: -444.09999999999997, y: 41.2, z: -250.8, size: [3.6, 3.4],
    thick: 0.3, maxTilt: 11, rate: 12, slipFrom: 6, slip: 1.4, surface: 'wood' },
  { kind: 'tip', id: 'tip2', node: 'tip2_mesh', x: -445.09999999999997, y: 41.2, z: -256, size: [3.6, 3.4],
    thick: 0.3, maxTilt: 11, rate: 12, slipFrom: 6, slip: 1.4, surface: 'wood' },
  { kind: 'bridge', id: 'br12', node: 'br12_mesh', rails: true, from: [-444.59999999999997, 41.2, -265.7],
    to: [-444.59999999999997, 41.2, -289.6], width: 1.7, sag: 0.7, amp: 4.5, period: 3.3,
    gaps: [[8.7, 10.9], [15.3, 17.5]] },
  { kind: 'wind', id: 'gust6', box: [-427.59999999999997, -214, -408.59999999999997, -204], dir: [0, 1], force: 3,
    airK: 2.8, calm: 3.4, warn: 1.2, blow: 2.4, yMin: 30, yMax: 42, drawY0: 34.2, drawY1: 38.5, streaks: 14 },
];

export interface ChapterThreeDrift {
  x: number;
  z: number;
  air: number;
}

export interface ChapterThreeMechanismPlayer extends Readonly<CollisionPosition> {
  readonly carrier?: MovingTriangleBody | null;
  readonly drift?: ChapterThreeDrift;
}

export type ChapterThreeMechanismEvent =
  | { type: 'cue'; name: 'bridgeOn' | 'bridgeCreak' | 'tipKnock' | 'crumble' | 'crumbleFall' }
  | { type: 'cue'; name: 'gust'; metres: number }
  | { type: 'cue'; name: 'gustBlow'; metres: number; seconds: number }
  | { type: 'shake'; strength: number };

interface Pose extends CollisionPosition {
  yaw: number;
  pitch: number;
  roll: number;
  visible: boolean;
}

interface MovingMechanism<Site extends MovingDefinition> {
  readonly kind: Site['kind'];
  readonly id: string;
  readonly definition: Site;
  readonly body: MovingTriangleBody;
  readonly pose: Readonly<Pose>;
}

export interface ChapterThreeWind {
  readonly kind: 'wind';
  readonly id: string;
  readonly definition: WindDefinition;
  readonly phase: WindPhase;
  readonly pushing: boolean;
  readonly shown: number;
  readonly flow: number;
}

export type ChapterThreeMechanism =
  | MovingMechanism<BridgeDefinition>
  | MovingMechanism<TipDefinition>
  | (MovingMechanism<CrumbleDefinition> & { readonly phase: CrumblePhase })
  | ChapterThreeWind;

type ActivePlayer = ChapterThreeMechanismPlayer | null | undefined;
type Emit = (event: ChapterThreeMechanismEvent) => void;
type World = Pick<CollisionWorld, 'addBody' | 'body'>;

interface RuntimeMechanism {
  readonly state: ChapterThreeMechanism;
  step(delta: number, player: ActivePlayer, drift: ChapterThreeDrift): void;
  reset(): void;
}

const degrees = Math.PI / 180;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const approach = (value: number, target: number, step: number) => value < target
  ? Math.min(value + step, target) : Math.max(value - step, target);
const smooth = (x: number) => x * x * (3 - 2 * x);

function platformBatches([width, depth]: PlatformSize, thickness: number, surface: 'wood' | 'rock', walls: boolean) {
  const x = width / 2;
  const z = depth / 2;
  const batches: MovingTriangleBatch[] = [
    { positions: [-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, -z, x, 0, z, -x, 0, z], kind: 1, surface },
  ];
  if (walls) {
    const rim: PointXZ[] = [[-x, -z], [x, -z], [x, z], [-x, z], [-x, -z]];
    batches.push({ positions: extrudeWallPolyline(rim, () => -thickness, () => -0.02), kind: 2 });
  }
  return batches;
}

function move(body: MovingTriangleBody, pose: Pose, x: number, y: number, z: number,
  yaw: number, pitch: number, roll: number, delta: number) {
  body.setPose(x, y, z, yaw, pitch, roll, delta);
  pose.x = x; pose.y = y; pose.z = z;
  pose.yaw = yaw; pose.pitch = pitch; pose.roll = roll;
}

function createBridge(world: World, definition: BridgeDefinition, emit: Emit): RuntimeMechanism {
  const [x, y, z] = definition.from;
  const [endX, endY, endZ] = definition.to;
  const length = Math.hypot(endX - x, endZ - z);
  const yaw = Math.atan2(endX - x, endZ - z);
  const segments = Math.max(4, Math.round(length / 1.1));
  const floor: number[] = [];
  const rails: number[] = [];
  const height = (s: number) => (endY - y) * s / length - definition.sag * 4 * (s / length) * (1 - s / length);
  const halfWidth = definition.width / 2;
  for (let segment = 0; segment < segments; segment++) {
    const from = segment / segments * length;
    const to = (segment + 1) / segments * length;
    const center = (from + to) / 2;
    if (definition.gaps.some(([start, end]) => center > start && center < end)) continue;
    const y0 = height(from);
    const y1 = height(to);
    floor.push(-halfWidth, y0, from, halfWidth, y0, from, halfWidth, y1, to,
      -halfWidth, y0, from, halfWidth, y1, to, -halfWidth, y1, to);
    if (definition.rails) for (const side of [-1, 1]) {
      const railX = side * (halfWidth + 0.2);
      rails.push(railX, y0 - 0.1, from, railX, y1 - 0.1, to, railX, y1 + 0.95, to,
        railX, y0 - 0.1, from, railX, y1 + 0.95, to, railX, y0 + 0.95, from);
    }
  }

  const batches: MovingTriangleBatch[] = [{ positions: floor, kind: 1, surface: 'rope' }];
  if (rails.length) batches.push({ positions: rails, kind: 2 });
  const body = world.addBody(definition.id, batches);
  const pose: Pose = { x, y, z, yaw, pitch: 0, roll: 0, visible: true };
  const state: MovingMechanism<BridgeDefinition> = { kind: 'bridge', id: definition.id, definition, body, pose };
  const amplitude = definition.amp * degrees;
  const period = definition.period;
  let riding = false;
  let time = 0;
  let load = 0;

  return {
    state,
    step(delta, player, drift) {
      time += delta;
      const onBridge = player?.carrier === body;
      if (onBridge && !riding) emit({ type: 'cue', name: 'bridgeOn' });
      riding = onBridge;
      const previous = Math.cos((time - delta) / period * Math.PI * 2);
      const current = Math.cos(time / period * Math.PI * 2);
      if (onBridge && previous * current < 0) emit({ type: 'cue', name: 'bridgeCreak' });
      load = approach(load, Number(onBridge), delta * 1.6);
      const roll = amplitude * (0.45 + 0.55 * load) * Math.sin(time / period * Math.PI * 2);
      const offset = -0.12 * load * (0.6 + 0.4 * Math.sin(time / period * Math.PI * 4));
      move(body, pose, x, y + offset, z, yaw, 0, roll, delta);
      if (onBridge) {
        const slip = Math.sin(roll) * 0.6 * 8;
        drift.x += Math.cos(yaw) * slip;
        drift.z += -Math.sin(yaw) * slip;
      }
    },
    reset() {
      time = 0;
      load = 0;
      move(body, pose, x, y, z, yaw, 0, 0, 0);
    },
  };
}

function createTip(world: World, definition: TipDefinition, emit: Emit): RuntimeMechanism {
  const { x, y, z, size } = definition;
  const body = world.addBody(definition.id, platformBatches(size, definition.thick ?? 0.35, definition.surface, false));
  const pose: Pose = { x, y, z, yaw: 0, pitch: 0, roll: 0, visible: true };
  const state: MovingMechanism<TipDefinition> = { kind: 'tip', id: definition.id, definition, body, pose };
  const maxTilt = definition.maxTilt * degrees;
  const rate = definition.rate * degrees;
  const slipFrom = definition.slipFrom * degrees;
  let riding = false;
  return {
    state,
    step(delta, player, drift) {
      const onPlatform = player?.carrier === body;
      if (onPlatform && !riding) emit({ type: 'cue', name: 'tipKnock' });
      riding = onPlatform;
      let pitchTarget = 0;
      let rollTarget = 0;
      if (onPlatform) {
        const local = body.toLocal(player.x, player.y, player.z);
        rollTarget = clamp(-local.x / (size[0] / 2), -1, 1) * maxTilt;
        pitchTarget = clamp(local.z / (size[1] / 2), -1, 1) * maxTilt;
      }
      const pitch = approach(pose.pitch, pitchTarget, rate * delta);
      const roll = approach(pose.roll, rollTarget, rate * delta);
      move(body, pose, x, y, z, 0, pitch, roll, delta);
      if (onPlatform) {
        const slideX = Math.abs(roll) > slipFrom ? -Math.sign(roll) * definition.slip : 0;
        const slideZ = Math.abs(pitch) > slipFrom ? Math.sign(pitch) * definition.slip : 0;
        drift.x += slideX;
        drift.z += slideZ;
      }
    },
    reset() { move(body, pose, x, y, z, 0, 0, 0, 0); },
  };
}

function createCrumble(world: World, definition: CrumbleDefinition, emit: Emit): RuntimeMechanism {
  const { x, y, z } = definition;
  const body = world.addBody(definition.id, platformBatches(definition.size, definition.thick ?? 0.7,
    definition.surface ?? 'rock', true));
  const pose: Pose = { x, y, z, yaw: 0, pitch: 0, roll: 0, visible: true };
  const state: MovingMechanism<CrumbleDefinition> & { phase: CrumblePhase } = {
    kind: 'crumble', id: definition.id, definition, body, pose, phase: 'whole',
  };
  let time = 0;
  let velocity = 0;
  let drop = 0;

  return {
    state,
    step(delta, player) {
      time += delta;
      let shakeX = 0;
      let shakeZ = 0;
      switch (state.phase) {
        case 'whole':
          if (player?.carrier === body) {
            state.phase = 'shaking';
            time = 0;
            emit({ type: 'cue', name: 'crumble' });
          }
          break;
        case 'shaking': {
          const amplitude = 0.012 + 0.05 * (time / definition.delay);
          shakeX = Math.sin(time * 71) * amplitude;
          shakeZ = Math.sin(time * 93) * amplitude;
          if (time >= definition.delay) {
            state.phase = 'falling';
            time = velocity = drop = 0;
            body.enabled = false;
            emit({ type: 'cue', name: 'crumbleFall' });
            emit({ type: 'shake', strength: 0.12 });
          }
          break;
        }
        case 'falling':
          velocity += 20 * delta;
          drop += velocity * delta;
          if (time >= 1.3) {
            state.phase = 'gone';
            time = 0;
            pose.visible = false;
          }
          break;
        case 'gone': {
          const occupied = player && player.x > body.minX - 0.5 && player.x < body.maxX + 0.5 &&
            player.z > body.minZ - 0.5 && player.z < body.maxZ + 0.5 && Math.abs(player.y - y) < 2.5;
          if (time >= definition.back && !occupied) {
            state.phase = 'rising';
            time = 0;
            drop = 1.2;
            pose.visible = true;
          }
          break;
        }
        case 'rising':
          drop = 1.2 * (1 - smooth(Math.min(time / 0.5, 1)));
          if (time >= 0.5) {
            state.phase = 'whole';
            drop = 0;
            body.enabled = true;
          }
          break;
      }
      body.setPose(x, y, z, 0, 0, 0, delta);
      pose.x = x + shakeX; pose.y = y - drop; pose.z = z + shakeZ;
    },
    reset() {
      state.phase = 'whole';
      time = drop = 0;
      body.enabled = true;
      pose.visible = true;
      move(body, pose, x, y, z, 0, 0, 0, 0);
    },
  };
}

function createWind(definition: WindDefinition, emit: Emit): RuntimeMechanism {
  const { calm, warn, blow, force, airK, yMin, yMax } = definition;
  const [x0, z0, x1, z1] = definition.box;
  const [dx, dz] = definition.dir;
  const length = Math.hypot(dx, dz) || 1;
  const cycle = calm + warn + blow;
  const box: PointXZ[] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const state: { kind: 'wind'; id: string; definition: WindDefinition; phase: WindPhase;
    pushing: boolean; shown: number; flow: number } = {
    kind: 'wind', id: definition.id, definition, phase: 'calm', pushing: false, shown: 0, flow: 0,
  };
  let time = 0;

  return {
    state,
    step(delta, player, drift) {
      time += delta;
      const position = (time % cycle + cycle) % cycle;
      const phase = position < calm ? 'calm' : position < calm + warn ? 'warn' : 'blow';
      if (phase !== state.phase) {
        state.phase = phase;
        const metres = player
          ? Math.hypot(Math.max(x0 - player.x, 0, player.x - x1), Math.max(z0 - player.z, 0, player.z - z1))
          : Infinity;
        if (phase === 'warn') emit({ type: 'cue', name: 'gust', metres });
        if (phase === 'blow') emit({ type: 'cue', name: 'gustBlow', seconds: cycle - calm - warn, metres });
      }
      state.shown = approach(state.shown, phase === 'blow' ? 0.62 : phase === 'warn' ? 0.34 : 0, delta * 0.9);
      state.flow += delta * (phase === 'calm' ? 3 : phase === 'warn' ? 7 : 12);
      state.pushing = !!player && phase === 'blow' && player.y >= yMin && player.y <= yMax &&
        pointInPolygon(player.x, player.z, box);
      if (state.pushing) {
        drift.x += dx / length * force;
        drift.z += dz / length * force;
        drift.air = airK;
      }
    },
    reset() { time = 0; state.phase = 'calm'; state.shown = 0; },
  };
}

/** Own the Chapter Three bodies and feed the player's drift before traversal. */
export function createChapterThreeMechanisms(world: World, { onEvent }: { onEvent?: Emit } = {}) {
  for (const definition of DEFINITIONS) {
    if (definition.kind !== 'wind' && world.body(definition.id)) {
      throw Error(`Chapter Three body ${definition.id} was already installed`);
    }
  }
  const emit: Emit = event => onEvent?.(event);
  const active = DEFINITIONS.map(definition => {
    switch (definition.kind) {
      case 'bridge': return createBridge(world, definition, emit);
      case 'tip': return createTip(world, definition, emit);
      case 'crumble': return createCrumble(world, definition, emit);
      case 'wind': return createWind(definition, emit);
    }
  });
  const list: readonly ChapterThreeMechanism[] = active.map(mechanism => mechanism.state);
  const byId = new Map(list.map(mechanism => [mechanism.id, mechanism]));
  const drift: ChapterThreeDrift = { x: 0, z: 0, air: 1 };
  let disposed = false;

  function reset() {
    if (!disposed) for (const mechanism of active) mechanism.reset();
  }
  reset();

  return {
    list,
    get(id: string) { return byId.get(id); },
    reset,
    step(delta: number, player?: ChapterThreeMechanismPlayer | null): Readonly<ChapterThreeDrift> {
      if (!Number.isFinite(delta) || delta < 0) throw RangeError('Mechanism step must be finite and nonnegative');
      if (disposed || delta === 0) return drift;
      drift.x = drift.z = 0;
      drift.air = 1;
      for (const mechanism of active) mechanism.step(delta, player, drift);
      if (player?.drift) Object.assign(player.drift, drift);
      return drift;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mechanism of list) if (mechanism.kind !== 'wind') {
        const { body } = mechanism;
        body.enabled = false;
        body.setPose(body.x, body.y, body.z, body.yaw, body.pitch, body.roll, 0);
      }
      drift.x = drift.z = 0;
      drift.air = 1;
    },
  };
}

/** Bind the shipped moving nodes. Wind particles consume wind state separately. */
export function bindChapterThreeMechanismPresentation(
  root: Pick<Object3D, 'getObjectByName'>, mechanisms: Pick<ReturnType<typeof createChapterThreeMechanisms>, 'list'>,
): () => void {
  const bindings = mechanisms.list.flatMap(mechanism => {
    if (mechanism.kind === 'wind') return [];
    const name = mechanism.definition.node;
    const node = root.getObjectByName(name) ?? root.getObjectByName(name + '_wood');
    return node ? [{ node, pose: mechanism.pose }] : [];
  });
  function sync() {
    for (const { node, pose } of bindings) {
      node.position.set(pose.x, pose.y, pose.z);
      node.rotation.order = 'YXZ';
      node.rotation.set(pose.pitch, pose.yaw, pose.roll);
      node.visible = pose.visible;
    }
  }
  sync();
  return sync;
}
