/** Authored Chapter Four mechanisms, combat barriers, and gate leaves. */
import { extrudeWallPolyline, type PointXZ } from '../physics/geometry.mts';
import type { MovingTriangleBatch, MovingTriangleBody } from '../physics/moving-body.mts';
import type { CollisionPosition, CollisionWorld } from '../physics/world.mts';

type Point = readonly [x: number, y: number, z: number];
type Size = readonly [width: number, depth: number];
type GateFlag = 'ch4_fore_bell' | 'ch4_top_bell' | 'ch4_mv_bell' | 'ch4_gd_w' | 'ch4_gd_e' | 'ch4_great_door' | 'ch4_last_bell';

const encounters = {
  mid_guard: { flag: 'ch4_mid_guard', doors: [] },
  top_guard: { flag: 'ch4_top_guard', doors: [] },
  forecourt: { flag: 'ch4_forecourt', doors: [{ group: 'fore_in', startsOpen: true }] },
  court1: { flag: 'ch4_court1', doors: [{ group: 'c1_in', startsOpen: true }, { group: 'c1_out', startsOpen: false }] },
  court2: { flag: 'ch4_court2', doors: [{ group: 'c2_in', startsOpen: true }, { group: 'c2_out', startsOpen: false }] },
  great: { flag: 'ch4_great', doors: [{ group: 'gc_in', startsOpen: true }] },
  hall: { flag: 'ch4_hall', doors: [{ group: 'hall_in', startsOpen: true }, { group: 'hall_out', startsOpen: false }] },
} as const;

export type ChapterFourEncounter = keyof typeof encounters;
export type ChapterFourEncounterState = 'idle' | 'fighting' | 'clear';
export type ChapterFourFlag = GateFlag | (typeof encounters)[ChapterFourEncounter]['flag'];

interface Door extends CollisionPosition {
  id: string; width: number; height: number; flag?: GateFlag; yaw?: number; lift?: number; time?: number; pulse?: number; look?: 'stone';
}

interface Bell extends CollisionPosition { id: string; r: number; flag?: GateFlag; links?: readonly string[]; once?: true }
interface Platform { id: string; mode: 'switch' | 'ping'; path: readonly [Point, Point]; speed: number; pause: number; size: Size; thick: number }
interface Lift { id: string; low: number; high: number; cars: readonly [PointXZ, PointXZ]; size: Size;
  rest: number; speed: number; backSpeed: number; hoistFor: number }
interface Crumble extends CollisionPosition { id: string; size: Size; thick: number; delay: number; back: number }
interface Gate extends CollisionPosition {
  id: string; w: number; h: number; yaw: number; mech?: string; enc?: ChapterFourEncounter; startsOpen?: true;
  out?: -1; fast?: true; slow?: true; great?: true;
}

const doors: readonly Door[] = [
  { id: 'fore_door', x: 30, y: 25, z: -170, width: 6, height: 3.8, flag: 'ch4_fore_bell' },
  { id: 'top_door', x: 79, y: 40, z: -292, width: 6, height: 3.8, flag: 'ch4_top_bell' },
  { id: 'race_door', x: 24, y: 55, z: -360, width: 6, height: 3.8, yaw: 90, pulse: 6, time: 0.4, look: 'stone' },
  { id: 'mv_door', x: 30, y: 55, z: -394, width: 6, height: 3.8, flag: 'ch4_mv_bell' },
  { id: 'great_door', x: 30, y: 59, z: -452, width: 12, height: 6.4, lift: 6.6, time: 2.2, flag: 'ch4_great_door' },
  { id: 'back_door', x: 30, y: 61, z: -526, width: 8, height: 5, lift: 5.2, time: 1.6, flag: 'ch4_last_bell' },
];

const bells: readonly Bell[] = [
  { id: 'fore_bell', x: 34.6, y: 26.65, z: -168.6, r: 1, flag: 'ch4_fore_bell' },
  { id: 'b1', x: 32.3, y: 29.65, z: -220, r: 1.3, links: ['s1'] },
  { id: 'b1f', x: 32.3, y: 29.65, z: -252, r: 1.3, links: ['s1'] },
  { id: 'b2', x: 38.7, y: 29.65, z: -257.6, r: 1.3, links: ['s2'] },
  { id: 'b3', x: 55, y: 29.65, z: -257.7, r: 1.4, links: ['s3'] },
  { id: 'b_l1', x: 69.95, y: 29.65, z: -270, r: 1.1, links: ['l1'] },
  { id: 'b_l2', x: 95.6, y: 31.65, z: -282.5, r: 1.15, flag: 'ch4_top_bell', links: ['l2'] },
  { id: 'b_race', x: 2.8, y: 56.65, z: -360, r: 1.1, links: ['race_door'] },
  { id: 'b_mv', x: 33, y: 56.65, z: -380, r: 1.2, flag: 'ch4_mv_bell' },
  { id: 'b_w', x: 20.3, y: 60.75, z: -439.9, r: 1.3, links: ['w_stone'] },
  { id: 'b_gw', x: 12, y: 65.65, z: -442, r: 1.2, flag: 'ch4_gd_w', once: true },
  { id: 'b_ge', x: 48, y: 66.45, z: -442, r: 1.2, flag: 'ch4_gd_e', once: true },
  { id: 'b_last', x: 30, y: 62.9, z: -519.4, r: 1.5, flag: 'ch4_last_bell', once: true },
];

const platforms: readonly Platform[] = [
  { id: 's1', mode: 'switch', path: [[30,28,-249.9],[30,28,-222.1]], speed: 7, pause: 0.4, size: [4,4], thick: 0.7 },
  { id: 's2', mode: 'switch', path: [[40.1,28,-260],[52,28,-260]], speed: 6, pause: 0.4, size: [4,4], thick: 0.7 },
  { id: 's3', mode: 'switch', path: [[66,28,-260],[58,28,-260]], speed: 6, pause: 0.4, size: [4,4], thick: 0.7 },
  { id: 'mv', mode: 'ping', path: [[30,55,-368.1],[30,55,-391.9]], speed: 4, pause: 2.2, size: [4,4], thick: 0.7 },
  { id: 'w_stone', mode: 'switch', path: [[18.2,59.04,-442],[18.2,64,-442]], speed: 2.6, pause: 0.3, size: [4,4], thick: 0.5 },
];

const lifts: readonly Lift[] = [
  { id: 'l1', low: 28, high: 40, cars: [[80,-272],[72,-272]], size: [4,3.8], rest: 0, speed: 5, backSpeed: 2.5, hoistFor: 8 },
  { id: 'l2', low: 30, high: 40, cars: [[94,-280],[94,-285]], size: [3.8,3.6], rest: 0, speed: 4, backSpeed: 3, hoistFor: 8 },
];

const crumbles: readonly Crumble[] = [35, 33, 31].map((x, index) => ({
  id: `tile_${index}`, x, y: 50.559999999999995, z: -326, size: [1.8,3.4], thick: 0.3, delay: 0.85, back: 2.5,
}));

const gates: readonly Gate[] = [
  { id: 'g_fore_in', x: 30, y: 25, z: -144, w: 6, h: 1.25, yaw: 0, enc: 'forecourt', startsOpen: true },
  { id: 'g_fore_out', x: 30, y: 25, z: -170, w: 6, h: 3.8, yaw: 0, mech: 'fore_door' },
  { id: 'g_c1_in', x: 30, y: 25, z: -176, w: 6, h: 1.25, yaw: 0, enc: 'court1', startsOpen: true, out: -1 },
  { id: 'g_c1_out', x: 30, y: 25, z: -200, w: 6, h: 3.8, yaw: 0, enc: 'court1' },
  { id: 'g_top', x: 79, y: 40, z: -292, w: 6, h: 3.8, yaw: 0, mech: 'top_door' },
  { id: 'g_c2_in', x: 79, y: 44, z: -318, w: 6, h: 1.25, yaw: 0, enc: 'court2', startsOpen: true, out: -1 },
  { id: 'g_c2_out', x: 62, y: 44, z: -331, w: 6, h: 1.25, yaw: Math.PI / 2, enc: 'court2' },
  { id: 'g_race', x: 24, y: 55, z: -360, w: 6, h: 3.8, yaw: Math.PI / 2, mech: 'race_door', out: -1, fast: true },
  { id: 'g_mv', x: 30, y: 55, z: -394, w: 6, h: 3.8, yaw: 0, mech: 'mv_door' },
  { id: 'g_gc_in', x: 30, y: 59, z: -420, w: 8, h: 1.25, yaw: 0, enc: 'great', startsOpen: true, out: -1 },
  { id: 'g_great', x: 30, y: 59, z: -452, w: 12, h: 6.4, yaw: 0, mech: 'great_door', enc: 'hall', startsOpen: true, great: true, slow: true },
  { id: 'g_hall_out', x: 30, y: 59, z: -508, w: 8, h: 3.8, yaw: 0, enc: 'hall' },
  { id: 'g_back', x: 30, y: 61, z: -526, w: 8, h: 5, yaw: 0, mech: 'back_door', slow: true },
];

export const chapterFourMechanismSites = { doors, bells, platforms, lifts, crumbles, gates, encounters } as const;

export interface ChapterFourMechanismPlayer extends Readonly<CollisionPosition> { readonly carrier?: MovingTriangleBody | null }
export type ChapterFourMechanismEvent = { type: 'cue'; name: string } | { type: 'shake'; strength: number } |
  { type: 'hint'; text: string; ms: number };

export interface ChapterFourMechanismEffects {
  hasFlag?(flag: ChapterFourFlag): boolean;
  setFlag?(flag: GateFlag): void;
  encounterState?(id: ChapterFourEncounter): ChapterFourEncounterState | undefined;
  onEvent?(event: ChapterFourMechanismEvent): void;
}

type CrumblePhase = 'whole' | 'shaking' | 'falling' | 'gone' | 'rising';
const radians = Math.PI / 180;
const smooth = (value: number) => value * value * (3 - 2 * value);
const approach = (value: number, target: number, amount: number) => value < target
  ? Math.min(value + amount, target) : Math.max(value - amount, target);

function platformBatches([width, depth]: Size, thick: number, surface: 'stone' | 'wood' | 'rock'): MovingTriangleBatch[] {
  const x = width / 2, z = depth / 2;
  const rim: PointXZ[] = [[-x,-z],[x,-z],[x,z],[-x,z],[-x,-z]];
  return [{ positions: [-x,0,-z, x,0,-z, x,0,z, -x,0,-z, x,0,z, -x,0,z], kind: 1, surface },
    { positions: extrudeWallPolyline(rim, () => -thick, () => -0.02), kind: 2 }];
}

function descendsOn(body: MovingTriangleBody, nextY: number, thick: number, player?: ChapterFourMechanismPlayer | null) {
  if (!player || player.carrier === body || nextY >= body.y - 1e-5) return false;
  const bottom = nextY - thick - 0.02;
  return player.x > body.minX - 0.3 && player.x < body.maxX + 0.3 &&
    player.z > body.minZ - 0.3 && player.z < body.maxZ + 0.3 && player.y + 1.7 > bottom && player.y < bottom;
}

/** Bind authored bodies and expose the leaf rotations for a separate scene adapter. */
export function createChapterFourMechanisms(world: Pick<CollisionWorld, 'addBody' | 'body' | 'setGroup'>, effects: ChapterFourMechanismEffects = {}) {
  const ids = [...doors, ...platforms, ...crumbles].map(({ id }) => id).concat(lifts.flatMap(({ id }) => [`${id}_a`, `${id}_b`]));
  const duplicate = ids.find(id => world.body(id));
  if (duplicate) throw Error(`Chapter Four body ${duplicate} was already installed`);

  const localFlags = new Set<ChapterFourFlag>();
  const flags = (name: ChapterFourFlag) => effects.hasFlag?.(name) ?? localFlags.has(name);
  function setFlag(name: GateFlag) {
    if (flags(name)) return;
    localFlags.add(name);
    effects.setFlag?.(name);
  }
  const state = (id: ChapterFourEncounter): ChapterFourEncounterState => effects.encounterState?.(id) ??
    (flags(encounters[id].flag) ? 'clear' : 'idle');
  const cue = (name: string) => effects.onEvent?.({ type: 'cue', name });
  const shake = (strength: number) => effects.onEvent?.({ type: 'shake', strength });
  const hint = (text: string, ms: number) => effects.onEvent?.({ type: 'hint', text, ms });
  const encounterIds = Object.keys(encounters) as ChapterFourEncounter[];
  const groupCache = new Map<string, boolean>();
  const doorState = doors.map(site => {
    const path: PointXZ[] = [[-site.width / 2,0],[site.width / 2,0]];
    return { ...site, body: world.addBody(site.id, [{ positions: extrudeWallPolyline(path, () => 0, () => site.height), kind: 2 }]),
      progress: 0, pulseLeft: 0 };
  });
  const platformState = platforms.map(site => ({ ...site, body: world.addBody(site.id, platformBatches(site.size, site.thick, 'stone')),
    called: false, elapsed: 0, distance: 0, span: Math.hypot(...site.path[1].map((value, index) => value - site.path[0][index]!)), moving: false }));
  const liftState = lifts.map(site => ({ ...site, bodies: [world.addBody(`${site.id}_a`, platformBatches(site.size, 0.4, 'wood')),
    world.addBody(`${site.id}_b`, platformBatches(site.size, 0.4, 'wood'))] as const, balance: site.rest, hoistLeft: 0, hoisted: 0, hauling: false }));
  const crumbleState = crumbles.map(site => ({ ...site, body: world.addBody(site.id, platformBatches(site.size, site.thick, 'rock')),
    phase: 'whole' as CrumblePhase, elapsed: 0, velocity: 0, drop: 0, pose: { x: site.x, y: site.y, z: site.z, visible: true } }));
  const bellState = bells.map(site => ({ ...site, nodeName: `n_${site.id}`, elapsed: 0, last: -10, swing: 0, roll: 0, rings: 0 }));
  const gateState = gates.map(site => ({ ...site, progress: 0, leftYaw: 0, rightYaw: 0 }));
  let oneBellHinted = false;
  let resolvedGreatDoor = false;
  let disposed = false;

  function encounterOpen(encounter: ChapterFourEncounter, startsOpen = false) {
    const encounterState = state(encounter);
    return encounterState === 'clear' || (encounterState !== 'fighting' && startsOpen);
  }

  function syncEncounterDoors() {
    for (const id of encounterIds) for (const door of encounters[id].doors) {
      const enabled = !encounterOpen(id, door.startsOpen);
      if (groupCache.get(door.group) === enabled) continue;
      world.setGroup(door.group, enabled);
      groupCache.set(door.group, enabled);
    }
  }

  function moveGates(delta: number, snap = false) {
    for (const gate of gateState) {
      const linked = gate.mech ? doorState.find(door => door.id === gate.mech)!.progress : 1;
      const target = Math.min(linked, gate.enc ? Number(encounterOpen(gate.enc, gate.startsOpen)) : 1);
      gate.progress = snap ? target : approach(gate.progress, target, (gate.fast ? 5 : gate.slow ? 0.8 : 1.6) * delta);
      gate.leftYaw = smooth(gate.progress) * 1.75 * (gate.out ?? 1);
      gate.rightYaw = -gate.leftYaw;
    }
  }

  function ringBell(id: string, { byHit = true } = {}): boolean {
    const bell = bellState.find(bell => bell.id === id);
    if (disposed || !bell) return false;
    const onlyTransport = !bell.flag && (bell.links?.length ?? 0) > 0 && bell.links!.every(link => platforms.some(platform => platform.id === link));
    if (byHit && !onlyTransport && encounterIds.some(id => state(id) === 'fighting')) {
      bell.swing = 1;
      cue('bell');
      return false;
    }
    if ((bell.once && bell.rings > 0) || (byHit && bell.elapsed - bell.last < 0.9)) return false;
    bell.last = bell.elapsed;
    bell.swing = 1;
    bell.rings++;
    cue('bell');
    shake(0.1);
    if (bell.flag) setFlag(bell.flag);
    for (const link of bell.links ?? []) {
      const platform = platformState.find(item => item.id === link);
      if (platform) { platform.called = !platform.called; continue; }
      const lift = liftState.find(item => item.id === link);
      if (lift) { lift.hoisted = Number(lift.balance < 0.5); lift.hoistLeft = lift.hoistFor; continue; }
      const door = doorState.find(item => item.id === link);
      if (door) door.pulseLeft = door.pulse ?? 0;
    }
    return true;
  }

  function stepDoor(door: typeof doorState[number], delta: number, player?: ChapterFourMechanismPlayer | null, snap = false) {
    if (door.pulseLeft > 0) door.pulseLeft -= delta;
    const open = door.pulseLeft > 0 || (door.flag !== undefined && flags(door.flag));
    const local = player && door.body.toLocal(player.x, player.y, player.z);
    const blocked = player && local && Math.abs(local.z) < 0.35 / 2 + 0.3 + 0.1 && Math.abs(local.x) < door.width / 2 + 0.2 &&
      player.y < door.y + door.height && player.y + 1.7 > door.y;
    const previous = door.progress;
    if (snap) door.progress = Number(open);
    else if (open || !blocked) door.progress = approach(door.progress, Number(open), delta / (door.time ?? 0.8));
    if (!snap && previous !== door.progress && (previous === 0 || previous === 1)) cue('door');
    door.body.enabled = door.progress < 0.7;
    const fraction = snap ? door.progress : smooth(door.progress);
    door.body.setPose(door.x, door.y + (door.lift ?? door.height + 0.2) * fraction, door.z, (door.yaw ?? 0) * radians, 0, 0, delta);
  }

  function stepPlatform(platform: typeof platformState[number], delta: number, player?: ChapterFourMechanismPlayer | null) {
    const { speed, pause, span, body, thick, path: [start, end] } = platform;
    let elapsed = platform.elapsed + delta;
    let distance = approach(platform.distance, platform.called ? span : 0, speed * delta);
    if (platform.mode === 'ping') {
      const travel = span / speed;
      const leg = travel + pause;
      const cycle = 2 * leg;
      const time = (elapsed % cycle + cycle) % cycle;
      distance = smooth(time < leg ? (time < travel ? time / travel : 1) :
        (time - leg < travel ? 1 - (time - leg) / travel : 0)) * span;
    }
    const sample = distance / span;
    const position = start.map((value, index) => value + (end[index]! - value) * sample);
    const blocked = descendsOn(body, position[1]!, thick, player);
    if (blocked) { elapsed = platform.elapsed; distance = platform.distance; }
    const [x, y, z] = blocked ? [body.x, body.y, body.z] : position;
    if (platform.mode === 'switch') {
      const moving = Math.hypot(x! - body.x, y! - body.y, z! - body.z) > 1e-4;
      if (moving !== platform.moving) { platform.moving = moving; cue(moving ? 'door' : 'stoneStop'); }
    }
    platform.distance = distance;
    platform.elapsed = elapsed;
    body.setPose(x!, y!, z!, 0, 0, 0, delta);
  }

  function stepLift(lift: typeof liftState[number], delta: number, player?: ChapterFourMechanismPlayer | null) {
    const { bodies, low, high } = lift;
    const range = high - low;
    const riding = player?.carrier === bodies[0] ? 0 : player?.carrier === bodies[1] ? 1 : -1;
    const hoisting = lift.hoistLeft > 0;
    if (hoisting) lift.hoistLeft -= delta;
    const driven = hoisting || riding >= 0;
    const target = hoisting ? lift.hoisted : riding >= 0 ? 1 - riding : lift.rest;
    const next = approach(lift.balance, target, (driven ? lift.speed : lift.backSpeed) / range * delta);
    const height = (index: number, balance: number) => index === 0 ? high - range * balance : low + range * balance;
    const blocked = bodies.some((body, index) => descendsOn(body, height(index, next), 0.4, player));
    const hauling = !blocked && next !== lift.balance && (riding >= 0 || lift.hoistLeft > 0);
    if (hauling !== lift.hauling) { lift.hauling = hauling; cue(hauling ? 'liftStart' : 'liftStop'); }
    if (!blocked) lift.balance = next;
    for (const [index, body] of bodies.entries()) {
      const [x, z] = lift.cars[index]!;
      body.setPose(x, height(index, lift.balance), z, 0, 0, 0, delta);
    }
  }

  function stepCrumble(stone: typeof crumbleState[number], delta: number, player?: ChapterFourMechanismPlayer | null) {
    const { body } = stone;
    stone.elapsed += delta;
    let wobbleX = 0, wobbleZ = 0;
    if (stone.phase === 'whole') {
      if (player?.carrier === body) { stone.phase = 'shaking'; stone.elapsed = 0; cue('crumble'); }
    } else if (stone.phase === 'shaking') {
      const wobble = 0.012 + 0.05 * (stone.elapsed / stone.delay);
      wobbleX = Math.sin(stone.elapsed * 71) * wobble;
      wobbleZ = Math.sin(stone.elapsed * 93) * wobble;
      if (stone.elapsed >= stone.delay) {
        stone.phase = 'falling'; stone.elapsed = stone.velocity = stone.drop = 0;
        body.enabled = false; cue('crumbleFall'); shake(0.12);
      }
    } else if (stone.phase === 'falling') {
      stone.velocity += 20 * delta; stone.drop += stone.velocity * delta;
      if (stone.elapsed >= 1.3) { stone.phase = 'gone'; stone.elapsed = 0; stone.pose.visible = false; }
    } else if (stone.phase === 'gone') {
      const occupied = player && player.x > body.minX - 0.5 && player.x < body.maxX + 0.5 && player.z > body.minZ - 0.5 &&
        player.z < body.maxZ + 0.5 && Math.abs(player.y - stone.y) < 2.5;
      if (stone.elapsed >= stone.back && !occupied) {
        stone.phase = 'rising'; stone.elapsed = 0; stone.drop = 1.2; stone.pose.visible = true;
      }
    } else {
      stone.drop = 1.2 * (1 - smooth(Math.min(stone.elapsed / 0.5, 1)));
      if (stone.elapsed >= 0.5) { stone.phase = 'whole'; stone.drop = 0; body.enabled = true; }
    }
    body.setPose(stone.x, stone.y, stone.z, 0, 0, 0, delta);
    Object.assign(stone.pose, { x: stone.x + wobbleX, y: stone.y - stone.drop, z: stone.z + wobbleZ });
  }

  function updateGreatDoor() {
    if (resolvedGreatDoor) return;
    const west = flags('ch4_gd_w'), east = flags('ch4_gd_e');
    if (west && east) {
      resolvedGreatDoor = true;
      if (!flags('ch4_great_door')) { setFlag('ch4_great_door'); cue('gate'); shake(0.25); }
    } else if ((west || east) && !oneBellHinted) {
      oneBellHinted = true;
      hint('One bell answered. The door waits for the other', 4200);
    }
  }

  function step(delta: number, player?: ChapterFourMechanismPlayer | null, { story = true, playing = true } = {}) {
    if (!Number.isFinite(delta) || delta < 0) throw RangeError('Mechanism step must be finite and nonnegative');
    if (disposed || delta === 0) return;
    syncEncounterDoors();
    for (const door of doorState) stepDoor(door, delta, player);
    for (const platform of platformState) stepPlatform(platform, delta, player);
    for (const lift of liftState) stepLift(lift, delta, player);
    for (const stone of crumbleState) stepCrumble(stone, delta, player);
    for (const bell of bellState) {
      bell.elapsed += delta;
      bell.swing = Math.max(bell.swing - delta * 0.45, 0);
      bell.roll = Math.sin(bell.elapsed * 7) * 0.32 * bell.swing;
    }
    moveGates(delta);
    if (story && playing && player) updateGreatDoor();
  }

  function reset() {
    if (disposed) return;
    for (const door of doorState) { door.pulseLeft = 0; stepDoor(door, 0, null, true); }
    for (const platform of platformState) {
      platform.called = platform.moving = false;
      platform.elapsed = platform.distance = 0;
      platform.body.setPose(...platform.path[0]);
    }
    for (const lift of liftState) {
      if (lift.hauling) cue('liftStop');
      lift.hauling = false;
      lift.balance = lift.rest;
      lift.hoistLeft = 0;
      stepLift(lift, 0);
    }
    for (const stone of crumbleState) {
      stone.phase = 'whole'; stone.elapsed = stone.velocity = stone.drop = 0;
      stone.body.enabled = true; stone.body.setPose(stone.x, stone.y, stone.z);
      Object.assign(stone.pose, { x: stone.x, y: stone.y, z: stone.z, visible: true });
    }
    for (const bell of bellState) {
      bell.roll = bell.swing = 0;
      if (!bell.flag) bell.rings = 0;
    }
    syncEncounterDoors();
    moveGates(0, true);
  }

  function enter(progress?: Readonly<{ flags: Record<string, unknown> }>) {
    if (disposed) return;
    if (progress) {
      localFlags.clear();
      for (const name of [...bells.map(bell => bell.flag), 'ch4_great_door' as const, ...encounterIds.map(id => encounters[id].flag)]) {
        if (name && progress.flags[name]) localFlags.add(name);
      }
    }
    reset();
  }

  reset();
  return {
    doors: doorState as readonly Readonly<typeof doorState[number]>[], gates: gateState as readonly Readonly<typeof gateState[number]>[],
    bells: bellState as readonly Readonly<typeof bellState[number]>[], platforms: platformState as readonly Readonly<typeof platformState[number]>[],
    lifts: liftState as readonly Readonly<typeof liftState[number]>[], crumbles: crumbleState as readonly Readonly<typeof crumbleState[number]>[],
    ringBell, step, enter, reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const body of [...doorState, ...platformState, ...crumbleState].map(item => item.body).concat(liftState.flatMap(lift => lift.bodies))) {
        body.enabled = false;
        body.setPose(body.x, body.y, body.z, body.yaw, body.pitch, body.roll, 0);
      }
      for (const group of groupCache.keys()) world.setGroup(group, true);
    },
  };
}
