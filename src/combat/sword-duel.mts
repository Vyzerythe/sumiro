/** The first Chapter Two duel from ch2_pass-9Opjv4P2.js and combat-Dp_zXhrv.js. */
import { pointInPolygon, type PointXZ } from '../physics/geometry.mts';
import type { StrokePool } from '../domain/run-vitals.mts';
import type { CollisionPosition, CollisionWorld } from '../physics/world.mts';

const FPS = 24;
const HIT_STOP_SCALE = 0.04;
const COMBO_BUFFER = 0.28;
const PARRY_BUFFER = 0.1;
const PARRY_START = 0.05;
const PARRY_END = 0.27;
const RIPOSTE_TIME = 1.05;

const rectangle = (x0: number, z0: number, x1: number, z1: number): readonly PointXZ[] =>
  [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

export const swordWraithEncounter = {
  id: 'sword_wraith', flag: 'ch2_sword_wraith', hint: 'Left mouse  strike.',
  start: rectangle(4.6, -21.5, 23.4, -36.9), leash: rectangle(4.6, -15.6, 23.4, -36.9),
  spawn: { x: 14, z: -33.5, heading: Math.PI }, rise: 0.9, health: 6,
  tempo: { windup: 1.2, cooldown: 1.3 },
} as const;

interface Cut {
  readonly clip: string;
  readonly live: readonly [number, number];
  readonly chain: number | null;
  readonly lunge: number;
  readonly dmg: number;
  readonly heavy: boolean;
  readonly hitAt: number;
}

export const swordCuts = {
  1: { clip: 'attack_1', live: [5, 8], chain: 10, lunge: 0.55, dmg: 1, heavy: false, hitAt: 6 },
  2: { clip: 'attack_2', live: [4, 7], chain: 9, lunge: 0.45, dmg: 1, heavy: false, hitAt: 5 },
  3: { clip: 'attack_3', live: [9, 12], chain: null, lunge: 0.85, dmg: 2, heavy: true, hitAt: 10 },
  riposte: { clip: 'parry_riposte', live: [3, 6], chain: null, lunge: 0.7, dmg: 3, heavy: true, hitAt: 4 },
} as const satisfies Record<1 | 2 | 3 | 'riposte', Cut>;

interface WraithBeat {
  readonly from: number;
  readonly to: number;
  readonly time: number;
  readonly clip?: string;
  readonly track?: number;
  readonly cue?: string;
  readonly fade?: number;
  readonly step?: number;
  readonly slash?: boolean;
  readonly hit?: Readonly<{ key: number; reach: number; arc: number; dmg: number; parryable: boolean }>;
  readonly recover?: boolean;
}

interface WraithPattern { readonly id: string; readonly beats: readonly WraithBeat[] }

export const swordWraithPatterns = {
  overhead: { id: 'overhead', beats: [
    { clip: 'attack_3', from: 6, to: 8, time: 0.6, track: 1, cue: 'wraithBeat', fade: 0.3 },
    { from: 8, to: 9, time: 0.5, track: 0.5 },
    { from: 9, to: 12, time: 0.15, step: 1.15, slash: true, cue: 'wraithCut', hit: { key: 10.5, reach: 2.25, arc: 60, dmg: 1, parryable: true } },
    { from: 12, to: 19, time: 1.3, recover: true },
  ] },
  sweep: { id: 'sweep', beats: [
    { clip: 'attack_1', from: 0, to: 3.5, time: 0.55, track: 1, cue: 'wraithBeat', fade: 0.16 },
    { from: 3.5, to: 5, time: 0.45, track: 0.5 },
    { from: 5, to: 8, time: 0.14, step: 0.9, slash: true, cue: 'wraithCut', hit: { key: 6.5, reach: 2.25, arc: 75, dmg: 1, parryable: true } },
    { from: 8, to: 15, time: 1.15, recover: true },
  ] },
} as const satisfies Record<'overhead' | 'sweep', WraithPattern>;

export interface SwordDuelPlayer extends Readonly<CollisionPosition> {
  readonly heading: number;
  readonly grounded: boolean;
  readonly state: string;
  readonly stateT: number;
  readonly stickMag?: number;
  readonly stickX?: number;
  readonly stickZ?: number;
}

export interface SwordDuelInput {
  attack?: boolean;
  parry?: boolean;
  playing?: boolean;
  swordAvailable?: boolean;
  handsBusy?: boolean;
}

type Combo = keyof typeof swordCuts;
type PlayerAction = 'IDLE' | 'DRAW' | 'ATTACK' | 'PARRY' | 'HIT' | 'DEATH';
type EnemyAction = 'IDLE' | 'RISING' | 'CHASE' | 'MOVE' | 'STAGGER' | 'DEAD';
type EncounterPhase = 'idle' | 'fighting' | 'clear' | 'defeated';

export type SwordDuelEvent =
  | { type: 'cue'; name: string }
  | { type: 'shake'; strength: number }
  | { type: 'encounter-start'; id: 'sword_wraith'; hint: string }
  | { type: 'encounter-clear'; id: 'sword_wraith'; flag: 'ch2_sword_wraith' }
  | { type: 'player-hurt'; amount: number; strokes: number }
  | { type: 'wraith-hit'; amount: number; hp: number; combo: Combo }
  | { type: 'attack-frame'; combo: Combo; x: number; y: number; z: number; heading: number; damage: number };

export interface SwordDuelEffects {
  health?: StrokePool;
  random?(): number;
  manualActivation?: boolean;
  onEvent?(event: SwordDuelEvent): void;
  /** Apply an attack or recoil displacement through the owning player controller. */
  movePlayer?(dx: number, dz: number, heading: number): SwordDuelPlayer | undefined;
}

type DuelWorld = Pick<CollisionWorld, 'groundAt' | 'sweepCapsule'>;
type HorizontalPosition = Pick<CollisionPosition, 'x' | 'z'>;

function wrap(angle: number) {
  let shortest = (angle + Math.PI) % (Math.PI * 2);
  if (shortest < 0) shortest += Math.PI * 2;
  return shortest - Math.PI;
}

const distance = (a: HorizontalPosition, b: HorizontalPosition) => Math.hypot(a.x - b.x, a.z - b.z);
const facing = (from: HorizontalPosition, to: HorizontalPosition) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const smooth = (value: number) => value * value * (3 - 2 * value);

function angleTo(player: HorizontalPosition & { heading: number }, target: HorizontalPosition, close: number) {
  const dx = target.x - player.x;
  const dz = target.z - player.z;
  const length = Math.hypot(dx, dz);
  return length < close ? 0 : Math.acos(clamp((dx * -Math.sin(player.heading) + dz * -Math.cos(player.heading)) / length, -1, 1));
}

/** The published parry window and its strict facing threshold. */
export function canParrySwordBlow(
  player: HorizontalPosition & { heading: number; action: PlayerAction; elapsed: number }, attacker: HorizontalPosition,
): boolean {
  return player.action === 'PARRY' && player.elapsed >= PARRY_START && player.elapsed <= PARRY_END && angleTo(player, attacker, 0.05) < 1.75;
}

const CLIP_SECONDS = {
  draw: 14 / FPS, attack_1: 16 / FPS, attack_2: 16 / FPS, attack_3: 22 / FPS,
  parry: 12 / FPS, parry_riposte: 16 / FPS, hit: 10 / FPS, death: 40 / FPS,
} as const;
type PlayerClip = keyof typeof CLIP_SECONDS;

const groundGait = new Set(['IDLE', 'WALK', 'RUN', 'SPRINT']);
const E = swordWraithEncounter;

/** Drive the one-player, one-wraith court encounter from fixed simulation steps. */
export function createSwordDuel(world: DuelWorld, { random = Math.random, onEvent, movePlayer, manualActivation = false, health }: SwordDuelEffects = {}) {
  const emit = (event: SwordDuelEvent) => onEvent?.(event);
  const cue = (name: string) => emit({ type: 'cue', name });
  let standaloneStrokes = 5;
  const player = { action: 'IDLE' as PlayerAction, clip: null as PlayerClip | null, frame: 0, elapsed: 0, heading: 0,
    get strokes() { return health?.strokes ?? standaloneStrokes; }, swordOut: false, combo: null as Combo | null, riposte: 0 };
  const enemy = { ...E.spawn, x: E.spawn.x as number, z: E.spawn.z as number, y: 0, hp: E.health as number, maxHp: E.health, action: 'IDLE' as EnemyAction,
    elapsed: 0, visible: false, vx: 0, vz: 0, clip: 'idle_sword', frame: 0, opening: false, hitIn: null as number | null,
    pattern: null as string | null, dissolve: 0, yOffset: 0 };
  const enemyCapsule = { radius: 0.32, height: 1.7, guards: true };
  let phase: EncounterPhase = 'idle';
  let attackBuffer = 0, parryBuffer = 0, stop = 0, invulnerable = 0;
  let clipSpeed = 1, knockX = 0, knockZ = 0;
  let queuedDraw: 'attack' | 'parry' | null = null;
  let swung = false, swingCue = false, trackingEnemy = false;
  let cooldown = 0, orbit = 1, orbitTime = 0, stagger = 0;
  let move: { pattern: WraithPattern; beat: number; elapsed: number; hit: boolean } | null = null;

  function playerAction(action: PlayerAction, clip: PlayerClip | null, speed = 1) {
    Object.assign(player, { action, clip, frame: 0, elapsed: 0 });
    clipSpeed = speed;
    if (action !== 'ATTACK') player.combo = null;
  }

  function enemyAction(action: EnemyAction, clip: string) {
    Object.assign(enemy, { action, clip, frame: 0, elapsed: 0, opening: action === 'STAGGER' });
  }

  function startEncounter(pose: SwordDuelPlayer) {
    phase = 'fighting';
    const y = world.groundAt(E.spawn.x, E.spawn.z, pose.y + 1.5)?.y ?? pose.y;
    Object.assign(enemy, { ...E.spawn, y, hp: E.health, visible: true, dissolve: 1, yOffset: -1.5 });
    cooldown = (0.8 + random() * 1.2) * E.tempo.cooldown;
    orbit = random() < 0.5 ? 1 : -1;
    orbitTime = 2 + random() * 2;
    enemyAction('RISING', 'idle_sword');
    cue('gate');
    cue('inkRise');
    emit({ type: 'encounter-start', id: E.id, hint: E.hint });
  }

  function turnEnemy(heading: number, rate: number, delta: number) {
    enemy.heading = wrap(enemy.heading + clamp(wrap(heading - enemy.heading), -rate * delta, rate * delta));
  }

  function moveEnemy(delta: number) {
    if (!(enemy.vx || enemy.vz)) return;
    const next = world.sweepCapsule(enemy, enemy.vx * delta, enemy.vz * delta, enemyCapsule);
    const support = world.groundAt(next.x, next.z, enemy.y + 0.55, enemy.y - 0.7);
    if (support && pointInPolygon(next.x, next.z, E.leash)) {
      enemy.x = next.x;
      enemy.z = next.z;
      enemy.y = support.y;
    } else enemy.vx = enemy.vz = 0;
  }

  function walkEnemy(x: number, z: number, speed: number, heading: number, delta: number) {
    const dx = x - enemy.x, dz = z - enemy.z;
    const length = Math.hypot(dx, dz) || 1;
    const desired = Math.min(speed, length * 3);
    const grip = 1 - Math.exp(-8 * delta);
    enemy.vx += (dx / length * desired - enemy.vx) * grip;
    enemy.vz += (dz / length * desired - enemy.vz) * grip;
    turnEnemy(heading, 5.5, delta);
    moveEnemy(delta);
  }

  function staggerEnemy(seconds: number, source?: HorizontalPosition, knock = 0) {
    move = null;
    enemy.pattern = enemy.hitIn = null;
    stagger = seconds;
    enemy.vx = enemy.vz = 0;
    if (source) {
      const length = distance(enemy, source) || 1;
      enemy.vx = (enemy.x - source.x) / length * knock;
      enemy.vz = (enemy.z - source.z) / length * knock;
    }
    enemyAction('STAGGER', 'hit');
  }

  function woundEnemy(pose: SwordDuelPlayer, combo: Combo, cut: Cut) {
    const { x, y, z } = pose;
    emit({ type: 'attack-frame', combo, x, y: y + 1.1, z, heading: player.heading, damage: cut.dmg });
    if (enemy.action === 'RISING' || enemy.action === 'DEAD' || !enemy.visible || distance(pose, enemy) > 2.35 + 0.35 ||
      Math.abs(enemy.y + 1.1 - (pose.y + 1)) > 2 || angleTo({ x, z, heading: player.heading }, enemy, 0.05) > 1.45) return;
    enemy.hp = Math.max(0, enemy.hp - cut.dmg);
    stop = Math.max(stop, cut.heavy ? 0.12 : 0.07);
    emit({ type: 'shake', strength: cut.heavy ? 0.42 : 0.26 });
    cue(cut.heavy ? 'swordHitHeavy' : 'swordHit');
    emit({ type: 'wraith-hit', amount: cut.dmg, hp: enemy.hp, combo });
    if (enemy.hp <= 0.001) {
      move = null;
      enemy.pattern = enemy.hitIn = null;
      enemyAction('DEAD', 'death');
      phase = 'clear';
      cue('inkDissolve');
      cue('gate');
      emit({ type: 'encounter-clear', id: E.id, flag: E.flag });
    } else if (!move || enemy.opening || cut.heavy) {
      staggerEnemy(cut.heavy ? 0.75 : 0.42, pose, combo === 3 || combo === 'riposte' ? 3.2 : 1.6);
    }
  }

  function woundPlayer(pose: SwordDuelPlayer, beat: WraithBeat) {
    const hit = beat.hit!;
    if (invulnerable > 0 || distance(pose, enemy) >= hit.reach + 0.3 || Math.abs(pose.y - enemy.y) >= 2.4 ||
      Math.abs(wrap(facing(enemy, pose) - enemy.heading)) >= hit.arc * Math.PI / 180) return;
    if (hit.parryable && canParrySwordBlow({ ...pose, heading: player.heading, action: player.action, elapsed: player.elapsed }, enemy)) {
      player.riposte = RIPOSTE_TIME;
      stop = Math.max(stop, 0.14);
      cue('parry');
      emit({ type: 'shake', strength: 0.35 });
      staggerEnemy(1.5);
      return;
    }
    if (pose.state === 'DEATH' || pose.state === 'DEAD' || player.action === 'DEATH') return;
    invulnerable = 0.75;
    if (health) health.hurt(hit.dmg);
    else standaloneStrokes = Math.max(0, standaloneStrokes - hit.dmg);
    stop = Math.max(stop, 0.07);
    emit({ type: 'player-hurt', amount: hit.dmg, strokes: player.strokes });
    emit({ type: 'shake', strength: 0.55 });
    if (player.strokes === 0) {
      playerAction('DEATH', 'death');
      phase = 'defeated';
    } else if (pose.grounded) {
      const length = distance(pose, enemy) || 1;
      knockX = (pose.x - enemy.x) / length * 2.6;
      knockZ = (pose.z - enemy.z) / length * 2.6;
      playerAction('HIT', 'hit', 1.15);
    }
  }

  function setBeat(current: NonNullable<typeof move>) {
    const beat = current.pattern.beats[current.beat]!;
    current.elapsed = 0;
    current.hit = false;
    enemy.frame = beat.from;
    enemy.opening = beat.recover === true;
    if (beat.clip) enemy.clip = beat.clip;
    if (beat.cue) cue(beat.cue);
    updateHitTime(current);
  }

  function updateHitTime(current: NonNullable<typeof move>) {
    let time = 0;
    enemy.hitIn = null;
    for (let index = current.beat; index < current.pattern.beats.length; index++) {
      const beat = current.pattern.beats[index]!;
      const elapsed = index === current.beat ? current.elapsed : 0;
      if (beat.hit && !(index === current.beat && current.hit)) {
        const at = (beat.hit.key - beat.from) / (beat.to - beat.from) * beat.time;
        if (at >= elapsed) { enemy.hitIn = time + at - elapsed; return; }
      }
      time += beat.time - elapsed;
    }
  }

  function startMove() {
    const selected = random() < 0.6 ? swordWraithPatterns.overhead : swordWraithPatterns.sweep;
    const firstHit = selected.beats.findIndex(beat => 'hit' in beat);
    const current = { pattern: { id: selected.id, beats: selected.beats.map((beat, index) => index < firstHit
      ? { ...beat, time: beat.time * (E.tempo.windup * 0.6) } : beat) }, beat: 0, elapsed: 0, hit: false };
    move = current;
    enemy.vx = enemy.vz = 0;
    enemyAction('MOVE', 'idle_sword');
    enemy.pattern = selected.id;
    setBeat(current);
  }

  function stepEnemy(delta: number, pose: SwordDuelPlayer) {
    enemy.elapsed += delta;
    if (enemy.action === 'RISING') {
      const fraction = clamp(enemy.elapsed / E.rise, 0, 1);
      enemy.yOffset = -1.5 * (1 - smooth(clamp(fraction / 0.8, 0, 1)));
      enemy.dissolve = 1 - smooth(clamp((fraction - 0.15) / 0.7, 0, 1));
      if (enemy.elapsed >= E.rise) enemyAction('CHASE', 'idle_sword');
    } else if (enemy.action === 'DEAD') {
      enemy.frame = Math.min(enemy.elapsed * FPS * 1.15, 40);
      enemy.dissolve = smooth(clamp((enemy.elapsed - 0.7) / (1.75 - 0.7), 0, 1));
      if (enemy.elapsed > 2.1) enemy.visible = false;
    } else if (enemy.action === 'STAGGER') {
      enemy.frame = Math.min(enemy.elapsed * FPS * (stagger > 1 ? 0.6 : 0.9), 10);
      enemy.vx *= Math.exp(-5 * delta);
      enemy.vz *= Math.exp(-5 * delta);
      moveEnemy(delta);
      if (enemy.elapsed > stagger) { cooldown = Math.max(cooldown, 0.7); enemyAction('CHASE', 'idle_sword'); }
    } else if (move) {
      const current = move;
      const beat = current.pattern.beats[current.beat]!;
      current.elapsed += delta;
      if (beat.track) turnEnemy(facing(enemy, pose), beat.track * 8, delta);
      if (beat.step) {
        const remaining = Math.max(distance(enemy, pose) - 1.05, 0);
        const speed = Math.min(beat.step / beat.time, remaining / delta);
        enemy.vx = -Math.sin(enemy.heading) * speed;
        enemy.vz = -Math.cos(enemy.heading) * speed;
        moveEnemy(delta);
      } else enemy.vx = enemy.vz = 0;
      enemy.frame = beat.from + (beat.to - beat.from) * Math.min(current.elapsed / beat.time, 1);
      if (beat.hit && !current.hit && enemy.frame >= beat.hit.key) { current.hit = true; woundPlayer(pose, beat); }
      if (move !== current) return;
      if (current.elapsed >= beat.time) {
        current.beat++;
        if (current.beat < current.pattern.beats.length) setBeat(current);
        else {
          move = null;
          enemy.pattern = enemy.hitIn = null;
          cooldown = (1.3 + random() * 1.1) * E.tempo.cooldown;
          enemyAction('CHASE', 'idle_sword');
        }
      } else updateHitTime(current);
    } else if (enemy.action === 'CHASE') {
      cooldown -= delta;
      const range = distance(enemy, pose);
      const heading = facing(enemy, pose);
      if (cooldown <= 0 && range < 3) {
        enemy.vx *= Math.exp(-10 * delta);
        enemy.vz *= Math.exp(-10 * delta);
        moveEnemy(delta);
        turnEnemy(heading, 5, delta);
        startMove();
      } else if (cooldown <= 0) {
        const standOff = 2.2 / Math.max(range, 0.01);
        walkEnemy(pose.x - (pose.x - enemy.x) * standOff, pose.z - (pose.z - enemy.z) * standOff, 2.2, heading, delta);
      } else {
        orbitTime -= delta;
        if (orbitTime <= 0) { orbitTime = 2.5 + random() * 2; orbit = -orbit; }
        const angle = Math.atan2(enemy.z - pose.z, enemy.x - pose.x) + orbit * 0.9 / 4.2;
        const radius = range > 4.7 ? range - 1 : 4.2;
        walkEnemy(pose.x + Math.cos(angle) * radius, pose.z + Math.sin(angle) * radius, 2.2 * 0.7, heading, delta);
      }
      if (enemy.action === 'CHASE') {
        enemy.clip = Math.hypot(enemy.vx, enemy.vz) > 0.15 ? 'walk' : 'idle_sword';
        enemy.frame = enemy.elapsed * FPS;
      }
    }
  }

  function aim(pose: SwordDuelPlayer, range: number, cone: number, stickFirst: boolean) {
    const stickHeading = (pose.stickMag ?? 0) > 0.1 ? Math.atan2(-(pose.stickX ?? 0), -(pose.stickZ ?? 0)) : pose.heading;
    const heading = stickFirst ? stickHeading : pose.heading;
    const separation = distance(pose, enemy);
    const target = enemy.visible && enemy.action !== 'RISING' && enemy.action !== 'DEAD' &&
      separation >= 0.01 && separation <= range && angleTo({ ...pose, heading }, enemy, 0.01) <= cone;
    player.heading = target ? facing(pose, enemy) : stickHeading;
    return target;
  }

  function attack(pose: SwordDuelPlayer, combo: Combo) {
    trackingEnemy = aim(pose, 3.4, 2.2, true);
    player.swordOut = true;
    player.combo = combo;
    attackBuffer = 0;
    swung = swingCue = false;
    playerAction('ATTACK', swordCuts[combo].clip);
  }

  function parry(pose: SwordDuelPlayer) {
    aim(pose, 4, 2.6, false);
    attackBuffer = parryBuffer = 0;
    player.swordOut = true;
    playerAction('PARRY', 'parry');
  }

  function draw(action: typeof queuedDraw) {
    queuedDraw = action;
    playerAction('DRAW', 'draw', action ? 2.4 : 1.3);
    cue('swordDraw');
  }

  function stepPlayer(delta: number, pose: SwordDuelPlayer, input: SwordDuelInput): SwordDuelPlayer {
    player.riposte = Math.max(0, player.riposte - delta);
    invulnerable = Math.max(0, invulnerable - delta);
    attackBuffer = input.attack ? COMBO_BUFFER : Math.max(0, attackBuffer - delta);
    parryBuffer = input.parry ? PARRY_BUFFER : Math.max(0, parryBuffer - delta);
    const grounded = pose.grounded && (groundGait.has(pose.state) || pose.state === 'LAND' && pose.stateT > 0.08);
    if (player.action === 'IDLE') player.heading = pose.heading;
    if (phase === 'fighting' && input.swordAvailable !== false && !input.handsBusy) {
      const ready = grounded && player.action === 'IDLE';
      if (parryBuffer > 0 && (ready || player.action === 'ATTACK' || player.action === 'HIT' && player.elapsed > 0.2)) {
        if (player.swordOut) parry(pose); else draw('parry');
      } else if (attackBuffer > 0 && (ready || player.action === 'PARRY' && player.riposte > 0)) {
        if (!player.swordOut) draw('attack');
        else if (player.riposte > 0) { player.riposte = 0; attack(pose, 'riposte'); }
        else attack(pose, 1);
      } else if (ready && !player.swordOut && enemy.action !== 'RISING' && distance(pose, enemy) < 8) {
        if (pose.state === 'IDLE') draw(null);
        else { player.swordOut = true; cue('swordDraw'); }
      }
    }
    player.elapsed += delta;
    player.frame = player.elapsed * FPS * clipSpeed;
    if (player.action === 'DRAW') {
      if (player.frame >= 5) player.swordOut = true;
      if (queuedDraw && player.frame >= 9) {
        const queued = queuedDraw;
        queuedDraw = null;
        if (queued === 'attack') attack(pose, 1); else parry(pose);
      }
    } else if (player.action === 'ATTACK' && player.combo !== null) {
      const combo = player.combo;
      const cut: Cut = swordCuts[combo];
      const frame = player.frame;
      if (frame < 3 && trackingEnemy) player.heading = facing(pose, enemy);
      if (frame < cut.live[1] && !(trackingEnemy && enemy.action !== 'DEAD' && distance(pose, enemy) < 1.15) && movePlayer) {
        const step = cut.lunge / ((cut.live[1] - 1) / FPS) * delta;
        pose = movePlayer(-Math.sin(player.heading) * step, -Math.cos(player.heading) * step, player.heading) ?? pose;
      }
      if (!swingCue && frame >= cut.live[0]) { swingCue = true; cue(cut.heavy ? 'swordSwingHeavy' : 'swordSwing'); }
      if (!swung && frame >= cut.hitAt) { swung = true; woundEnemy(pose, combo, cut); }
      if (attackBuffer > 0 && cut.chain !== null && frame >= cut.chain) {
        attack(pose, combo === 1 ? 2 : 3);
        return pose;
      }
      if (frame > cut.live[1] + 5 && (pose.stickMag ?? 0) > 0.1) playerAction('IDLE', null);
    } else if (player.action === 'HIT') {
      knockX *= Math.exp(-6 * delta);
      knockZ *= Math.exp(-6 * delta);
      pose = movePlayer?.(knockX * delta, knockZ * delta, player.heading) ?? pose;
      if (player.elapsed > 0.26 && (pose.stickMag ?? 0) > 0.1) playerAction('IDLE', null);
    }
    if (player.clip && player.action !== 'DEATH' && player.elapsed * clipSpeed >= CLIP_SECONDS[player.clip]) playerAction('IDLE', null);
    return pose;
  }

  function step(delta: number, pose: SwordDuelPlayer, input: SwordDuelInput = {}) {
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Duel step must be finite and nonnegative');
    if (delta === 0 || input.playing === false) return;
    if (!manualActivation && phase === 'idle' && pose.grounded && pointInPolygon(pose.x, pose.z, E.start)) startEncounter(pose);
    if (phase === 'idle') return;
    const combatDelta = stop > 0 ? delta * HIT_STOP_SCALE : delta;
    stop = Math.max(0, stop - delta);
    const next = stepPlayer(combatDelta, pose, input);
    if (phase !== 'defeated') stepEnemy(combatDelta, next);
  }

  function reset({ cleared = false, strokes = 5 }: { cleared?: boolean; strokes?: number } = {}) {
    phase = cleared ? 'clear' : 'idle';
    playerAction('IDLE', null);
    standaloneStrokes = strokes;
    Object.assign(player, { swordOut: false, riposte: 0 });
    enemyAction('IDLE', 'idle_sword');
    Object.assign(enemy, { ...E.spawn, y: 0, hp: cleared ? 0 : E.health, visible: false, vx: 0, vz: 0,
      pattern: null, hitIn: null, dissolve: 0, yOffset: 0 });
    move = queuedDraw = null;
    attackBuffer = parryBuffer = stop = invulnerable = knockX = knockZ = 0;
  }

  return {
    get phase() { return phase; }, player: player as Readonly<typeof player>, enemy: enemy as Readonly<typeof enemy>, step, reset,
    start(pose: SwordDuelPlayer) { if (phase === 'idle') startEncounter(pose); },
  };
}
