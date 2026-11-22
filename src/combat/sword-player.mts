import type { CollisionPosition } from '../physics/world.mts';
import type { StrokePool } from '../domain/run-vitals.mts';
import { canParrySwordBlow, swordCuts, type SwordDuelInput, type SwordDuelPlayer } from './sword-duel.mts';

type Action = 'IDLE' | 'DRAW' | 'ATTACK' | 'PARRY' | 'HIT' | 'DEATH';
type Combo = keyof typeof swordCuts;
type Cut = (typeof swordCuts)[Combo];
type Target = Readonly<CollisionPosition & { id: string; targetable: boolean }>;
type Horizontal = Pick<CollisionPosition, 'x' | 'z'>;

interface SwordPlayerEffects {
  health?: StrokePool;
  targets(): readonly Target[];
  duration(clip: string): number;
  move(dx: number, dz: number, heading: number): SwordDuelPlayer;
  strike(target: Target, cut: Cut, combo: Combo, origin: SwordDuelPlayer): boolean;
  cue(name: string): void;
}

const GROUND_STANCES = new Set(['IDLE', 'WALK', 'RUN', 'SPRINT']);
const range = (a: Horizontal, b: Horizontal) => Math.hypot(a.x - b.x, a.z - b.z);
const face = (a: Horizontal, b: Horizontal) => Math.atan2(a.x - b.x, a.z - b.z);
const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** One player action clock and health pool shared by every active encounter actor. */
export function createSwordPlayer(effects: SwordPlayerEffects) {
  let standaloneStrokes = 5;
  const state = { action: 'IDLE' as Action, clip: null as string | null, frame: 0, elapsed: 0,
    heading: 0, combo: null as Combo | null, get strokes() { return effects.health?.strokes ?? standaloneStrokes; }, swordOut: false };
  let queued: 'attack' | 'parry' | undefined;
  let target: Target | undefined;
  let speed = 1;
  let attackBuffer = 0, parryBuffer = 0, riposte = 0, invulnerable = 0;
  let swept = false, sounded = false;

  function select(action: Action, clip: string | null, rate = 1) {
    Object.assign(state, { action, clip, elapsed: 0, frame: 0 });
    speed = rate;
    if (action !== 'ATTACK') state.combo = null;
  }

  function nearest(pose: SwordDuelPlayer, heading: number, distance: number, cone: number) {
    let best: Target | undefined;
    let closest = distance;
    for (const actor of effects.targets()) {
      if (!actor.targetable) continue;
      const separation = range(pose, actor);
      if (separation > closest || angle(heading, face(pose, actor)) > cone) continue;
      closest = separation;
      best = actor;
    }
    return best;
  }

  function beginAttack(pose: SwordDuelPlayer, combo: Combo) {
    const stick = (pose.stickMag ?? 0) > 0.1 ? Math.atan2(-(pose.stickX ?? 0), -(pose.stickZ ?? 0)) : pose.heading;
    target = nearest(pose, stick, 3.4, 2.2);
    state.heading = target ? face(pose, target) : stick;
    state.swordOut = true;
    state.combo = combo;
    attackBuffer = 0;
    swept = sounded = false;
    select('ATTACK', swordCuts[combo].clip);
  }

  function beginParry(pose: SwordDuelPlayer) {
    const preferred = nearest(pose, pose.heading, 4, 2.6);
    state.heading = preferred ? face(pose, preferred) : pose.heading;
    state.swordOut = true;
    attackBuffer = parryBuffer = 0;
    select('PARRY', 'parry');
  }

  function draw(next: 'attack' | 'parry') {
    queued = next;
    select('DRAW', 'draw', 2.4);
    effects.cue('swordDraw');
  }

  function step(delta: number, original: SwordDuelPlayer, input: SwordDuelInput, active: boolean) {
    if (!Number.isFinite(delta) || delta < 0) throw RangeError('Sword step must be finite and nonnegative');
    if (delta === 0 || state.action === 'DEATH') {
      if (state.action === 'DEATH') { state.elapsed += delta; state.frame = state.elapsed * 24; }
      return;
    }
    let pose = original;
    riposte = Math.max(0, riposte - delta);
    invulnerable = Math.max(0, invulnerable - delta);
    attackBuffer = input.attack ? 0.28 : Math.max(0, attackBuffer - delta);
    parryBuffer = input.parry ? 0.1 : Math.max(0, parryBuffer - delta);
    if (state.action === 'IDLE') state.heading = pose.heading;
    const ready = state.action === 'IDLE' && pose.grounded && (GROUND_STANCES.has(pose.state) || pose.state === 'LAND' && pose.stateT > 0.08);
    if (active && input.swordAvailable !== false && !input.handsBusy) {
      if (parryBuffer > 0 && (ready || state.action === 'ATTACK' || state.action === 'HIT' && state.elapsed > 0.2)) {
        if (state.swordOut) beginParry(pose); else draw('parry');
      } else if (attackBuffer > 0 && (ready || state.action === 'PARRY' && riposte > 0)) {
        if (!state.swordOut) draw('attack');
        else if (riposte > 0) { riposte = 0; beginAttack(pose, 'riposte'); }
        else beginAttack(pose, 1);
      }
    }
    state.elapsed += delta;
    state.frame = state.elapsed * 24 * speed;
    if (state.action === 'DRAW') {
      if (state.frame >= 5) state.swordOut = true;
      if (queued && state.frame >= 9) {
        const next = queued;
        queued = undefined;
        if (next === 'attack') beginAttack(pose, 1); else beginParry(pose);
      }
    } else if (state.action === 'ATTACK' && state.combo !== null) {
      const combo = state.combo;
      const cut = swordCuts[combo];
      const tracked = target && effects.targets().find(candidate => candidate.id === target?.id && candidate.targetable);
      if (state.frame < 3 && tracked) state.heading = face(pose, tracked);
      if (state.frame < cut.live[1] && (!tracked || range(pose, tracked) >= 1.15)) {
        const travel = cut.lunge / ((cut.live[1] - 1) / 24) * delta;
        pose = effects.move(-Math.sin(state.heading) * travel, -Math.cos(state.heading) * travel, state.heading);
      }
      if (!sounded && state.frame >= cut.live[0]) { sounded = true; effects.cue(cut.heavy ? 'swordSwingHeavy' : 'swordSwing'); }
      if (!swept && state.frame >= cut.hitAt) {
        swept = true;
        let struck = false;
        for (const candidate of effects.targets()) {
          if (!candidate.targetable || Math.abs(candidate.y - pose.y) >= 2 || range(pose, candidate) > 2.7 ||
            angle(state.heading, face(pose, candidate)) > 1.45) continue;
          struck = effects.strike(candidate, cut, combo, pose) || struck;
        }
        if (struck) effects.cue(cut.heavy ? 'swordHitHeavy' : 'swordHit');
      }
      if (attackBuffer > 0 && cut.chain !== null && state.frame >= cut.chain) { beginAttack(pose, combo === 1 ? 2 : 3); return; }
      if (state.frame > cut.live[1] + 5 && (pose.stickMag ?? 0) > 0.1) select('IDLE', null);
    }
    if (state.clip && state.elapsed * speed >= effects.duration(state.clip)) select('IDLE', null);
  }

  return {
    state: state as Readonly<typeof state>, step,
    receive(pose: SwordDuelPlayer, origin: Horizontal, damage: number, parryable: boolean): 'parried' | 'hit' | undefined {
      if (state.action === 'DEATH' || invulnerable > 0) return;
      if (parryable && canParrySwordBlow({ ...pose, heading: state.heading, action: state.action, elapsed: state.elapsed }, origin)) {
        riposte = 1.05;
        effects.cue('parry');
        return 'parried';
      }
      const strokes = effects.health ? effects.health.hurt(damage) : (standaloneStrokes = Math.max(0, standaloneStrokes - damage));
      invulnerable = 0.75;
      select(strokes === 0 ? 'DEATH' : 'HIT', strokes === 0 ? 'death' : 'hit', 1.15);
      return 'hit';
    },
    reset(strokes = 5) {
      standaloneStrokes = strokes;
      state.swordOut = false;
      queued = target = undefined;
      attackBuffer = parryBuffer = riposte = invulnerable = 0;
      select('IDLE', null);
    },
  };
}
