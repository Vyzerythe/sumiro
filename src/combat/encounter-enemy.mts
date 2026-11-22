import type { EncounterSpawn } from './encounters.mts';

interface Position { x: number; y: number; z: number }
interface EnemyTarget extends Position { aimHeight?: number }
type EnemyKind = EncounterSpawn['kind'];
type EnemyState = 'RISE' | 'IDLE' | 'CHASE' | 'MOVE' | 'DRAW' | 'LOOSED' | 'STAGGER' | 'SIDESTEP' | 'BREATH_STEP' | 'BREATH' | 'DEAD';
type AttackResult = 'hit' | 'miss' | 'dodged' | 'parried';
type Clip = 'stand_idle' | 'idle_sword' | 'walk' | 'run_sword' | 'attack_1' | 'attack_2' | 'attack_3' |
  'jump_windup' | 'hit' | 'death' | 'dodge' | 'drink';

export interface EnemyView extends Position {
  readonly id: string;
  readonly kind: EnemyKind;
  heading: number;
  yOffset: number;
  dissolve: number;
  hp: number;
  readonly maxHp: number;
  alive: boolean;
  awake: boolean;
  state: EnemyState;
  phase: 1 | 2 | 3;
  immune: boolean;
  opening: boolean;
  clip: Clip;
  frame: number | null;
  fade: number;
  clipSpeed: number;
  draw: number;
  move: string | null;
  flying: boolean;
}

interface Hit { key: number; reach: number; arc: number; dmg: number; parryable: boolean }
interface Wave { at: number; speed: number; length: number; width: number; dmg: number }
interface Beat {
  clip?: Clip;
  from: number;
  to: number;
  time: number;
  track?: number;
  fade?: number;
  cue?: string;
  step?: number;
  recover?: true;
  hit?: Hit;
  wave?: Wave;
  leap?: { height: number; far: number };
}
interface Move { id: string; beats: readonly Beat[] }

const cut = (key: number, reach: number, arc: number, parryable = true): Hit => ({ key, reach, arc, dmg: 1, parryable });
const roninCut = (key: number, reach: number) => ({ cue: 'roninCut', hit: cut(key, reach, 70) });
const overhead: Move = { id: 'overhead', beats: [
  { clip: 'attack_3', from: 6, to: 8, time: .6, track: 1, cue: 'wraithBeat', fade: .3 },
  { from: 8, to: 9, time: .5, track: .5 },
  { from: 9, to: 12, time: .15, step: 1.15, cue: 'wraithCut', hit: cut(10.5, 2.25, 60) },
  { from: 12, to: 19, time: 1.3, recover: true },
] };
const sweep: Move = { id: 'sweep', beats: [
  { clip: 'attack_1', from: 0, to: 3.5, time: .55, track: 1, cue: 'wraithBeat', fade: .16 },
  { from: 3.5, to: 5, time: .45, track: .5 },
  { from: 5, to: 8, time: .14, step: .9, cue: 'wraithCut', hit: cut(6.5, 2.25, 75) },
  { from: 8, to: 15, time: 1.15, recover: true },
] };
const iai: Move = { id: 'iai', beats: [
  { clip: 'jump_windup', from: 0, to: 3, time: .75, track: 1, cue: 'roninSheath', fade: .16 },
  { clip: 'attack_1', from: 2, to: 5, time: .14, track: .2, fade: .08 },
  { from: 5, to: 8, time: .15, step: 3.1, ...roninCut(7, 2.3) },
  { from: 8, to: 16, time: 1.05, recover: true },
] };
const two: Move = { id: 'two', beats: [
  { clip: 'attack_1', from: 0, to: 5, time: .6, track: 1, fade: .14, cue: 'wraithBeat' },
  { from: 5, to: 8, time: .13, step: .8, ...roninCut(6.5, 2.2) },
  { clip: 'attack_2', from: 0, to: 4, time: .46, track: .9, fade: .08 },
  { from: 4, to: 7, time: .13, step: .7, ...roninCut(5.5, 2.2) },
  { from: 7, to: 16, time: 1, recover: true },
] };
const fall: Move = { id: 'fall', beats: [
  { clip: 'attack_3', from: 6, to: 9, time: .85, track: 1, fade: .28, cue: 'wraithBeat' },
  { from: 9, to: 12, time: .14, step: 1, cue: 'roninCut', hit: cut(10.5, 2.3, 60) },
  { from: 12, to: 22, time: 1, recover: true },
] };
const three: Move = { id: 'three', beats: [
  { clip: 'attack_1', from: 0, to: 5, time: .46, track: 1, fade: .12, cue: 'wraithBeat' },
  { from: 5, to: 8, time: .12, step: .8, ...roninCut(6.5, 2.2) },
  { clip: 'attack_2', from: 0, to: 4, time: .36, track: .9, fade: .07 },
  { from: 4, to: 7, time: .12, step: .7, ...roninCut(5.5, 2.2) },
  { clip: 'attack_3', from: 0, to: 9, time: .55, track: .8, fade: .07 },
  { from: 9, to: 12, time: .13, step: 1, cue: 'roninCut', hit: cut(10.5, 2.3, 60) },
  { from: 12, to: 22, time: 1, recover: true },
] };
const leapfall: Move = { id: 'leapfall', beats: [
  { clip: 'jump_windup', from: 0, to: 5, time: .55, track: 1, fade: .14, cue: 'roninSheath' },
  { clip: 'attack_3', from: 6, to: 9, time: .72, leap: { height: 3.2, far: 11 }, fade: .12 },
  { from: 9, to: 12, time: .12, cue: 'roninSlam', hit: cut(10.5, 2.7, 360, false) },
  { from: 12, to: 22, time: 1.05, recover: true },
] };
const wave: Move = { id: 'wave', beats: [
  { clip: 'attack_3', from: 6, to: 9, time: .8, track: 1, fade: .28, cue: 'roninSheath' },
  { from: 9, to: 12, time: .13, cue: 'roninSlam', wave: { at: 10.5, speed: 13, length: 17, width: 1.5, dmg: 1 } },
  { from: 12, to: 22, time: .85, recover: true },
] };
const hold: Move = { id: 'hold', beats: [
  { clip: 'attack_3', from: 6, to: 8, time: .55, track: 1, fade: .26, cue: 'wraithBeat' },
  { from: 8, to: 9, time: .75, track: .6 },
  { from: 9, to: 12, time: .13, step: 1.1, cue: 'roninCut', hit: cut(10.5, 2.3, 60) },
  { clip: 'attack_1', from: 2, to: 5, time: .42, track: .9, fade: .08 },
  { from: 5, to: 8, time: .12, step: 1, ...roninCut(6.5, 2.25) },
  { from: 8, to: 16, time: .9, recover: true },
] };

const phaseMoves = {
  1: [{ move: fall, far: 2.9 }, { move: two, far: 2.9 }, { move: iai, far: 6.5, near: 3.2 }],
  2: [{ move: two, far: 2.9 }, { move: three, far: 2.9 }, { move: iai, far: 6.5, near: 3.2 },
    { move: leapfall, far: 11, near: 3.5 }],
  3: [{ move: three, far: 2.9 }, { move: hold, far: 2.9 }, { move: leapfall, far: 11, near: 3.5 },
    { move: wave, far: 16, near: 4.5 }, { move: iai, far: 6.5, near: 3.2 }],
};

const archetypes = { wraith: { hp: 6, walk: 2.2 }, archer: { hp: 3, walk: 2.6 }, ronin: { hp: 52, walk: 2.6 } };
const capsule = { radius: .32, height: 1.7, guards: true };
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const smooth = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrap = (angle: number) => ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

export type EnemyAttack =
  | { type: 'melee'; origin: Position; heading: number; reach: number; arc: number; dmg: number; parryable: boolean }
  | { type: 'arrow'; origin: Position; target: Position; speed: number; dmg: number; parryable: true }
  | { type: 'wave'; origin: Position; heading: number; speed: number; width: number; length: number; dmg: number; parryable: false };
export type EnemyEvent =
  | { type: 'phase'; id: string; phase: 2 | 3; position: Position }
  | { type: 'defeated' | 'dissolved'; id: string; kind: EnemyKind }
  | { type: 'cue'; name: string };
export interface EnemyDamage { dmg: number; combo?: number; riposte?: boolean; x?: number; z?: number }
export interface EnemyWorld {
  groundAt(x: number, z: number, maxY?: number, minY?: number): { y: number } | null;
  sweepCapsule(start: Readonly<Position>, dx: number, dz: number, options: typeof capsule): { x: number; z: number };
  raycast(x: number, y: number, z: number, dx: number, dy: number, dz: number, length: number): number;
}
export interface EnemyOptions {
  world?: EnemyWorld;
  random?: () => number;
  tempo?: { windup: number; cooldown: number };
  mayAttack?: (state: Readonly<EnemyView>) => boolean;
  onAttack?: (attack: EnemyAttack, state: Readonly<EnemyView>) => AttackResult | void;
  onEvent?: (event: EnemyEvent) => void;
  arrowOrigin?: (state: Readonly<EnemyView>) => Position;
  drinkFinished?: () => boolean;
}

export function createEncounterEnemy(spawn: EncounterSpawn, options: EnemyOptions = {}) {
  const { world, random = Math.random } = options;
  const { kind, id, riseTime } = spawn;
  const stats = archetypes[kind];
  const idle = kind === 'archer' ? 'stand_idle' : 'idle_sword';
  const state: EnemyView = {
    id, kind, x: spawn.x, z: spawn.z, y: world?.groundAt(spawn.x, spawn.z, spawn.y === undefined ? Infinity : spawn.y + 1.5)?.y ?? spawn.y ?? 0,
    heading: spawn.heading, hp: stats.hp, maxHp: stats.hp, yOffset: -1.5, dissolve: 1, alive: true,
    state: 'RISE', awake: false, phase: 1, immune: true, opening: false,
    clip: idle, frame: null, fade: 0, clipSpeed: 1, draw: 0, move: null, flying: false,
  };
  const origin = () => ({ x: state.x, y: state.y, z: state.z });
  const cue = (name: string) => options.onEvent?.({ type: 'cue', name });
  const tempo = (key: 'windup' | 'cooldown') => {
    if (kind === 'ronin') return 1;
    const value = options.tempo?.[key];
    return clamp((value && value > 0 && Number.isFinite(value) ? value : 1) * (key === 'windup' ? .6 : 1), .5, 2);
  };
  let age = 0, vx = 0, vz = 0;
  let cooldown = (.8 + random() * 1.2) * tempo('cooldown');
  let orbit = random() < .5 ? 1 : -1;
  let orbitTime = 2 + random() * 2;
  let staggerTime = 0, drawTime = 0, recentHits = 0, hitWindow = 0;
  let madeRoom = false, dissolved = false, disposed = false;
  let target: Position | undefined;
  let aim: Position = { x: state.x, y: state.y + 1.15, z: state.z };
  let retreat = { x: 0, z: 1 };
  let lastMove: Move | undefined;
  let active: { move: Move; index: number; spent: number; hit: boolean; scale: number } | undefined;
  let leap: { from: Position; to: Position; height: number } | undefined;

  function transition(next: EnemyState) {
    state.state = next;
    age = 0;
    state.opening = next === 'STAGGER';
  }

  function pose(clip: Clip, fade: number, frame: number | null = null, speed = 1) {
    state.clip = clip;
    state.fade = fade;
    state.frame = frame;
    state.clipSpeed = speed;
  }

  function distance(to: Position) {
    const dx = to.x - state.x, dz = to.z - state.z;
    return { dx, dz, length: Math.hypot(dx, dz), heading: Math.atan2(-dx, -dz) };
  }

  function turn(heading: number, rate: number, dt: number) {
    state.heading = wrap(state.heading + clamp(wrap(heading - state.heading), -dt * rate, dt * rate));
  }

  function inLeash(x: number, z: number) {
    const { leash } = spawn;
    if ('circle' in leash) return Math.hypot(x - leash.circle[0], z - leash.circle[1]) < leash.circle[2];
    let inside = false;
    let previous = leash.poly.at(-1);
    for (const [px, pz] of leash.poly) {
      if (previous && (pz > z) !== (previous[1] > z) && x < (previous[0] - px) * (z - pz) / (previous[1] - pz) + px) {
        inside = !inside;
      }
      previous = [px, pz];
    }
    return inside;
  }

  function moveOnGround(dt: number) {
    if (!vx && !vz) return;
    const dx = vx * dt, dz = vz * dt;
    const next = world?.sweepCapsule(state, dx, dz, capsule) ?? { x: state.x + dx, z: state.z + dz };
    const height = world?.groundAt(next.x, next.z, state.y + .55, state.y - .7)?.y;
    if (!inLeash(next.x, next.z) || world && height === undefined) {
      vx = vz = 0;
      return;
    }
    state.x = next.x; state.z = next.z; state.y = height ?? state.y;
  }

  function holdPosition(dt: number, damping = 10) {
    vx *= Math.exp(-damping * dt);
    vz *= Math.exp(-damping * dt);
    if (damping === 10 && Math.hypot(vx, vz) < .05) vx = vz = 0;
    moveOnGround(dt);
  }

  function runToward(x: number, z: number, speed: number, dt: number, heading: number) {
    const dx = x - state.x, dz = z - state.z;
    const length = Math.hypot(dx, dz) || 1;
    const velocity = Math.min(speed, length * 3);
    const blend = 1 - Math.exp(-8 * dt);
    vx += (dx / length * velocity - vx) * blend;
    vz += (dz / length * velocity - vz) * blend;
    turn(heading, 5.5, dt);
    moveOnGround(dt);
  }

  function gait() {
    const speed = Math.hypot(vx, vz);
    const clip = speed < .25 ? idle : kind !== 'archer' && speed >= 3.5 ? 'run_sword' : 'walk';
    if (state.clip !== clip || state.frame !== null) pose(clip, .2);
  }

  function stopAttack() {
    active = undefined;
    leap = undefined;
    state.move = null;
    state.flying = false;
    state.draw = 0;
  }

  function stagger(seconds: number) {
    stopAttack();
    staggerTime = seconds;
    pose('hit', .08, null, seconds > 1 ? .6 : .9);
    transition('STAGGER');
  }

  function beatTime(beat: Beat, index: number, move: Move, scale: number) {
    return index < move.beats.findIndex(beat => beat.hit || beat.wave) && !beat.recover ? beat.time * scale : beat.time;
  }

  function startBeat(player: Position) {
    if (!active) return;
    const beat = active.move.beats[active.index]!;
    active.spent = 0;
    active.hit = false;
    state.opening = !!beat.recover;
    state.frame = beat.from;
    if (beat.clip) pose(beat.clip, beat.fade ?? .1, beat.from);
    if (beat.cue) cue(beat.cue);
    if (!beat.leap) return;
    const motion = distance(player);
    const travel = Math.min(motion.length, beat.leap.far);
    const x = state.x + (motion.length > .01 ? motion.dx / motion.length * travel : 0);
    const z = state.z + (motion.length > .01 ? motion.dz / motion.length * travel : 0);
    const floor = world ? world.groundAt(x, z, state.y + 1.5, state.y - 1.5)?.y : state.y;
    const from = origin();
    leap = { from, to: floor !== undefined && inLeash(x, z) ? { x, y: floor, z } : from, height: beat.leap.height };
  }

  function begin(move: Move, player: Position) {
    active = { move, index: 0, spent: 0, hit: false, scale: tempo('windup') };
    lastMove = move;
    state.move = move.id;
    vx = vz = 0;
    transition('MOVE');
    startBeat(player);
  }

  function melee(hit: Hit, player: Position) {
    const motion = distance(player);
    if (motion.length >= hit.reach + .3 || Math.abs(player.y - state.y) >= 2.4 ||
        hit.arc < 360 && Math.abs(wrap(motion.heading - state.heading)) >= hit.arc * Math.PI / 180) return;
    const result = options.onAttack?.({ type: 'melee', origin: origin(), heading: state.heading, reach: hit.reach,
      arc: hit.arc, dmg: hit.dmg, parryable: hit.parryable }, state);
    if (result === 'parried' && hit.parryable && state.alive) {
      stagger(kind === 'ronin' ? .95 : 1.5);
      vx = vz = 0;
    }
  }

  function stepMove(dt: number, player: Position) {
    const attack = active;
    if (!attack) return;
    const beat = attack.move.beats[attack.index]!;
    const duration = beatTime(beat, attack.index, attack.move, attack.scale);
    attack.spent += dt;
    const motion = distance(player);
    if (beat.track) turn(motion.heading, 8 * beat.track, dt);
    if (beat.step) {
      const speed = Math.max(0, Math.min(beat.step / duration, (motion.length - 1.05) / dt));
      vx = -Math.sin(state.heading) * speed; vz = -Math.cos(state.heading) * speed;
      moveOnGround(dt);
    } else vx = vz = 0;
    const progress = Math.min(attack.spent / duration, 1);
    if (leap) {
      state.x = leap.from.x + (leap.to.x - leap.from.x) * progress;
      state.z = leap.from.z + (leap.to.z - leap.from.z) * progress;
      state.y = leap.from.y + leap.height * 4 * progress * (1 - progress);
    }
    state.flying = leap !== undefined;
    state.frame = beat.from + (beat.to - beat.from) * progress;
    const key = beat.hit?.key ?? beat.wave?.at;
    if (!attack.hit && key !== undefined && state.frame >= key) {
      attack.hit = true;
      if (beat.hit) melee(beat.hit, player);
      if (beat.wave) {
        const { speed, width, length, dmg } = beat.wave;
        options.onAttack?.({ type: 'wave', origin: origin(), heading: state.heading, speed, width, length, dmg, parryable: false }, state);
      }
    }
    if (active !== attack || attack.spent < duration) return;
    if (leap) {
      Object.assign(state, leap.to);
      leap = undefined;
      state.flying = false;
    }
    attack.index++;
    if (attack.index < attack.move.beats.length) {
      startBeat(player);
    } else {
      stopAttack();
      cooldown = kind === 'ronin' ? .5 + random() * .5 : (1.3 + random() * 1.1) * tempo('cooldown');
      transition('CHASE');
      gait();
    }
  }

  function aimAt(player: EnemyTarget, dt: number) {
    turn(distance(player).heading, 6, dt);
    aim = { x: player.x, y: player.y + (player.aimHeight ?? 1.15), z: player.z };
  }

  function visible(player: EnemyTarget) {
    if (!world) return true;
    const dx = player.x - state.x, dy = player.y + (player.aimHeight ?? 1.1) - (state.y + 1.4), dz = player.z - state.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    return world.raycast(state.x, state.y + 1.4, state.z, dx / length, dy / length, dz / length, length) >= length;
  }

  function chase(dt: number, player: EnemyTarget) {
    const { dx, dz, length, heading } = distance(player);
    cooldown -= dt;
    const ready = cooldown <= 0;
    if (kind === 'archer') {
      const sight = visible(player);
      if (length < 7 && length > .01) runToward(state.x - dx / length * 2, state.z - dz / length * 2, stats.walk, dt, heading);
      else if (length > 15) runToward(player.x, player.z, stats.walk, dt, heading);
      else {
        holdPosition(dt);
        turn(heading, 5, dt);
      }
      if (ready && length > 4 && length <= 15 && sight && (options.mayAttack?.(state) ?? true)) {
        drawTime = 1.15 * tempo('windup');
        state.draw = drawTime;
        aimAt(player, dt);
        cue('bowDraw');
        transition('DRAW');
      }
    } else if (kind === 'wraith') {
      if (ready && length < 3) {
        holdPosition(dt);
        turn(heading, 5, dt);
        if (options.mayAttack?.(state) ?? true) begin(random() < .6 ? overhead : sweep, player);
      } else if (ready) {
        const ratio = 2.2 / Math.max(length, .01);
        runToward(player.x - dx * ratio, player.z - dz * ratio, stats.walk, dt, heading);
      } else {
        orbitTime -= dt;
        if (orbitTime <= 0) { orbitTime = 2.5 + random() * 2; orbit = -orbit; }
        const angle = Math.atan2(-dz, -dx) + orbit * .9 / 4.2;
        const range = length > 4.7 ? length - 1 : 4.2;
        runToward(player.x + Math.cos(angle) * range, player.z + Math.sin(angle) * range, stats.walk * .7, dt, heading);
      }
    } else {
      if (state.phase >= 2 && ready && length < 3.4 && !madeRoom && random() < .45) {
        madeRoom = true;
        retreatStep(player);
        return;
      }
      if (ready) {
        madeRoom = false;
        const eligible = phaseMoves[state.phase].filter(rule => length <= rule.far && length >= ('near' in rule ? rule.near ?? 0 : 0));
        const alternatives = eligible.filter(rule => rule.move !== lastMove);
        const choices = alternatives.length ? alternatives : eligible;
        if (choices.length) {
          holdPosition(dt);
          turn(heading, 6, dt);
          if (options.mayAttack?.(state) ?? true) begin(choices[Math.floor(random() * choices.length)]!.move, player);
          return;
        }
      }
      if (recentHits >= 3 && hitWindow > 0) {
        recentHits = 0;
        retreatStep(player);
        return;
      }
      if (length > 2.6) runToward(player.x, player.z, length > 7 ? 4.2 : stats.walk, dt, heading);
      else holdPosition(dt);
      turn(heading, 5, dt);
    }
    if (state.state === 'CHASE' || state.state === 'DRAW') gait();
  }

  function retreatStep(player: Position, phaseBreak = false) {
    const { dx, dz, length } = distance(player);
    const norm = Math.max(length, .1);
    retreat = { x: -dx / norm, z: length > .01 ? -dz / norm : 1 };
    if (phaseBreak && !inLeash(state.x + retreat.x * 5, state.z + retreat.z * 5)) retreat = { x: -retreat.x, z: -retreat.z };
    pose('dodge', .05);
    if (!phaseBreak) cue('inkStep');
    transition(phaseBreak ? 'BREATH_STEP' : 'SIDESTEP');
  }

  function step(dt: number, player: EnemyTarget | undefined, playing = true) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    target = player;
    age += dt;
    hitWindow -= dt;
    if (state.state === 'RISE') {
      const progress = Math.min(age / riseTime, 1);
      state.dissolve = 1 - smooth(.15, .85, progress);
      state.yOffset = -1.5 * (1 - smooth(0, .8, progress));
      if (progress >= 1) {
        state.immune = false;
        state.awake = true;
        state.yOffset = 0;
        transition('CHASE');
      }
      return;
    }
    if (!state.alive) {
      state.dissolve = smooth(.7, 1.75, age);
      if (!dissolved && age > 2.1) { dissolved = true; options.onEvent?.({ type: 'dissolved', id, kind }); }
      return;
    }
    if (!playing || !player) {
      if (state.state === 'CHASE' || state.state === 'DRAW' || state.state === 'LOOSED') {
        stopAttack();
        state.awake = false;
        transition('IDLE');
        pose(idle, .2);
      }
      return;
    }
    switch (state.state) {
      case 'IDLE':
        if (distance(player).length < spawn.aggro && inLeash(player.x, player.z) && visible(player)) {
          state.awake = true;
          transition('CHASE');
        }
        break;
      case 'CHASE': chase(dt, player); break;
      case 'MOVE': stepMove(dt, player); break;
      case 'DRAW':
        holdPosition(dt);
        state.draw = Math.max(drawTime - age, 0);
        if (state.draw > .22) aimAt(player, dt);
        if (age >= drawTime) {
          const release = options.arrowOrigin?.(state) ?? { ...origin(), y: state.y + 1.4 };
          options.onAttack?.({ type: 'arrow', origin: release, target: aim, speed: 15, dmg: 1, parryable: true }, state);
          if (state.state === 'DRAW') {
            cue('arrowLoose');
            cooldown = (1.5 + random() * 1.2) * tempo('cooldown');
            transition('LOOSED');
          }
        }
        break;
      case 'LOOSED':
        holdPosition(dt);
        if (age > .45) transition('CHASE');
        break;
      case 'STAGGER':
        holdPosition(dt, 5);
        if (age > staggerTime) {
          if (kind === 'wraith') cooldown = Math.max(cooldown, .7);
          if (kind === 'ronin') cooldown = .3;
          transition('CHASE');
          gait();
        }
        break;
      case 'BREATH_STEP':
      case 'SIDESTEP': {
        const phaseBreak = state.state === 'BREATH_STEP';
        const speed = (phaseBreak ? 11 : 10) * (1 - smooth(.3, .55, age));
        vx = retreat.x * speed; vz = retreat.z * speed;
        moveOnGround(dt);
        if (age <= .55) break;
        vx = vz = 0;
        if (phaseBreak) {
          pose('drink', .14);
          cue('drink');
          transition('BREATH');
        } else {
          cooldown = .1;
          transition('CHASE');
          gait();
        }
        break;
      }
      case 'BREATH':
        turn(distance(player).heading, 3, dt);
        if (options.drinkFinished?.() || age > 1.9) {
          state.immune = false;
          cooldown = .4;
          transition('CHASE');
          gait();
        }
        break;
    }
  }

  function damage(hit: EnemyDamage): 'hit' | 'dead' | 'immune' | null {
    if (disposed || !state.alive || state.state === 'RISE' || !Number.isFinite(hit.dmg) || hit.dmg <= 0) return null;
    if (state.immune) return 'immune';
    const floor = kind === 'ronin' && state.phase < 3 ? (3 - state.phase) / 3 * state.maxHp : 0;
    state.hp = Math.max(state.hp - hit.dmg, floor);
    state.awake = true;
    if (state.hp <= .001) {
      state.hp = 0; state.alive = false; state.awake = false;
      stopAttack();
      pose('death', .1, null, kind === 'ronin' ? .8 : 1.15);
      transition('DEAD');
      cue('inkDissolve');
      options.onEvent?.({ type: 'defeated', id, kind });
      return 'dead';
    }
    recentHits = hitWindow > 0 ? recentHits + 1 : 1;
    hitWindow = 1.6;
    if (kind === 'ronin') {
      if (state.phase < 3 && state.hp <= floor + .001) {
        stopAttack();
        state.phase = state.phase === 1 ? 2 : 3;
        state.immune = true;
        vx = vz = 0;
        cue('roninPhase');
        options.onEvent?.({ type: 'phase', id, phase: state.phase, position: origin() });
        retreatStep(target ?? { x: hit.x ?? state.x, y: state.y, z: hit.z ?? state.z }, true);
      } else if (hit.riposte) {
        stagger(.8);
      }
    } else if (!active || state.opening || hit.combo === 3 || hit.riposte) {
      stagger(hit.combo === 3 || hit.riposte ? .75 : .42);
      const dx = state.x - (hit.x ?? state.x), dz = state.z - (hit.z ?? state.z);
      const length = Math.hypot(dx, dz) || 1;
      const speed = hit.combo === 3 ? 3.2 : 1.6;
      vx = dx / length * speed; vz = dz / length * speed;
    }
    return 'hit';
  }

  cue('inkRise');
  return {
    state: state as Readonly<EnemyView>,
    step,
    damage,
    dispose() { disposed = true; stopAttack(); },
  };
}
