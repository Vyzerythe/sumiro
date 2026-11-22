/** Gameplay rules from the supplied cat, combat, and game modules. */
export type CompanionPhase = 'STRAY' | 'CARRIED' | 'PICKUP' | 'PUTDOWN' | 'JUMP_DOWN' |
  'FOLLOW' | 'IDLE' | 'SIT' | 'WAIT_GAP' | 'TO_HIDE' | 'HIDE' | 'SCRIPTED' | 'FAILED' | 'REUNITED';
export type CompanionFailure = 'cat_hurt' | 'cat_left';
export type CompanionCombatKind = 'wraith' | 'archer' | 'ronin';
type PointXZ = Readonly<{ x: number; z: number }>;
type Point = PointXZ & Readonly<{ y: number }>;

export interface CompanionRiskFrame {
  phase: CompanionPhase;
  found: boolean;
  position: Point;
  player?: Point & { alive: boolean };
  playing: boolean;
  cutscene?: boolean;
  fighting?: boolean;
}

export interface CompanionRiskConfig {
  maxHealth: number;
  failBelow: number;
  hurtGuard: number;
  abandonWarn: number;
  abandonFail: number;
  abandonGrace: number;
  abandonAfterFight: number;
}

export const companionRiskDefaults = {
  maxHealth: 10, failBelow: 3, hurtGuard: .7,
  abandonWarn: 18, abandonFail: 30, abandonGrace: 2.5, abandonAfterFight: 8,
} as const satisfies CompanionRiskConfig;

export const companionFailureText = {
  cat_hurt: 'They took the cat.',
  cat_left: 'You left the cat behind.',
} as const;
export const companionFailureSeconds = 2.6;

export type CompanionRiskEvent =
  | { type: 'cue'; name: 'catHurt' | 'catMeow' }
  | { type: 'flinch'; clip: 'hurt' | 'meow' }
  | { type: 'terminal-pose'; clip: 'hide' | 'sit'; fade: number }
  | { type: 'hint'; text: string; ms: number }
  | { type: 'rehide'; source: PointXZ; interrupt: boolean }
  | { type: 'failed'; reason: CompanionFailure };

const vulnerable = new Set<CompanionPhase>(['FOLLOW', 'IDLE', 'SIT', 'WAIT_GAP', 'TO_HIDE', 'HIDE']);
const distance = (a: PointXZ, b: PointXZ) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** Keep failure/health state separate from companion movement and presentation. */
export function createCompanionRisk({
  options = {}, emit,
}: { options?: Partial<CompanionRiskConfig>; emit?(event: CompanionRiskEvent): void } = {}) {
  const config = { ...companionRiskDefaults, ...options };
  if (Object.values(config).some(value => !Number.isFinite(value) || value < 0) ||
      config.failBelow > config.maxHealth || config.abandonWarn > config.abandonFail) {
    throw RangeError('Invalid companion risk thresholds');
  }
  let health = config.maxHealth;
  let hurtTime = 0;
  let warned = false;
  let farTime = 0;
  let grace = 0;
  let failure: CompanionFailure | null = null;

  function targetable(frame: CompanionRiskFrame): boolean {
    return failure === null && frame.found && vulnerable.has(frame.phase) && frame.playing && !frame.cutscene;
  }

  function flinch(clip: 'hurt' | 'meow') { emit?.({ type: 'flinch', clip }); }
  function cue(name: 'catHurt' | 'catMeow') { emit?.({ type: 'cue', name }); }

  function fail(reason: CompanionFailure) {
    if (failure) return;
    failure = reason;
    if (reason === 'cat_hurt') {
      emit?.({ type: 'terminal-pose', clip: 'hide', fade: .2 });
      flinch('hurt');
      cue('catHurt');
    } else {
      emit?.({ type: 'terminal-pose', clip: 'sit', fade: .3 });
      flinch('meow');
      cue('catMeow');
    }
    emit?.({ type: 'failed', reason });
  }

  function damage(frame: CompanionRiskFrame, amount = 1, source?: PointXZ): boolean {
    if (!targetable(frame) || hurtTime > 0 || !Number.isFinite(amount) || amount <= 0) return false;
    health = Math.max(health - amount, 0);
    hurtTime = config.hurtGuard;
    cue('catHurt');
    flinch('hurt');
    if (health < config.failBelow) fail('cat_hurt');
    else if (source && frame.fighting && (frame.phase === 'HIDE' || frame.phase === 'TO_HIDE')) {
      emit?.({ type: 'rehide', source: { x: source.x, z: source.z }, interrupt: frame.phase === 'HIDE' });
    }
    return true;
  }

  function step(delta: number, frame: CompanionRiskFrame) {
    if (!Number.isFinite(delta) || delta < 0) throw RangeError('Companion update must be finite and nonnegative');
    if (delta === 0) return;
    if (hurtTime > 0) hurtTime -= delta;
    const { player, position } = frame;
    if (!targetable(frame) || !player?.alive || frame.fighting) { farTime = 0; return; }
    const metres = Math.hypot(player.x - position.x, player.y - position.y, player.z - position.z);
    if (metres < config.abandonWarn - 2) {
      warned = false;
      farTime = grace = 0;
      return;
    }
    if (metres > config.abandonWarn && !warned) {
      warned = true;
      cue('catMeow');
      flinch('meow');
      emit?.({ type: 'hint', text: 'The cat is far behind you.', ms: 3600 });
    }
    if (grace > 0) {
      grace = Math.max(grace - delta, 0);
      farTime = 0;
    } else if (metres > config.abandonFail) {
      farTime += delta;
      if (farTime > config.abandonGrace) fail('cat_left');
    } else farTime = 0;
  }

  return {
    get health() { return health; },
    get maxHealth() { return config.maxHealth; },
    get failBelow() { return config.failBelow; },
    get failure() { return failure; },
    targetable, damage, step,
    heal() { health = config.maxHealth; },
    /** Send once after releasing actual companion combat, including its calm delay. */
    releaseFight() { warned = false; farTime = 0; grace = config.abandonAfterFight; },
    reset() { health = config.maxHealth; hurtTime = farTime = grace = 0; warned = false; failure = null; },
  };
}

export function resolveCompanionPressure(chapter?: number, encounter?: number): number {
  const pressure = Number.isFinite(encounter) ? encounter : chapter;
  return pressure !== undefined && Number.isFinite(pressure) ? clamp(pressure, 0, 1) : .5;
}

export function companionHunterCap(pressure: number): number {
  return pressure <= 0 ? 0 : pressure < .4 ? 1 : pressure < .75 ? 2 : 3;
}

export function canHuntCompanion(kind: CompanionCombatKind, pressure: number, targetable: boolean): boolean {
  return targetable && kind !== 'ronin' && pressure > 0;
}

type ThreatTarget = 'player' | 'cat';
export interface WraithTargetState { target: ThreatTarget; targetTime: number; provoked: number }
interface WraithTargetInput {
  enemy: PointXZ;
  player: PointXZ;
  cat?: PointXZ;
  pressure: number;
  hunters: number;
}

/** Timer applied to wraith target selection when struck. */
export const companionProvocationSeconds = 2.5;

export function updateWraithTarget(state: Readonly<WraithTargetState>, input: WraithTargetInput, delta: number): WraithTargetState {
  const next = {
    ...state,
    targetTime: Math.max(state.targetTime - delta, 0),
    provoked: state.provoked > 0 ? state.provoked - delta : state.provoked,
  };
  const change = (target: ThreatTarget) => {
    if (target !== next.target) { next.target = target; next.targetTime = 1.6; }
    return next;
  };
  const { cat, enemy, player, pressure, hunters } = input;
  if (!cat || !canHuntCompanion('wraith', pressure, true)) return change('player');
  const playerDistance = distance(enemy, player);
  const catDistance = distance(enemy, cat);
  const adjustedCatDistance = catDistance + (1 - pressure) * 4.5;
  let playerBetween = false;
  if (catDistance > .1 && playerDistance < catDistance) {
    const dx = cat.x - enemy.x, dz = cat.z - enemy.z;
    const along = clamp(((player.x - enemy.x) * dx + (player.z - enemy.z) * dz) / (catDistance * catDistance), 0, 1);
    playerBetween = Math.hypot(player.x - (enemy.x + dx * along), player.z - (enemy.z + dz * along)) < 1.1;
  }
  if (playerDistance < 2.4 || next.provoked > 0 || playerBetween) return change('player');
  if (next.targetTime > 0) return next;
  if (next.target === 'player' && adjustedCatDistance < playerDistance - 1.2 && hunters < companionHunterCap(pressure)) {
    return change('cat');
  }
  if (next.target === 'cat' && playerDistance < adjustedCatDistance - 1.2) return change('player');
  return next;
}

export function chooseArcherTarget({
  current, enemy, cat, playerVisible, catVisible, pressure, hunters,
}: {
  current: ThreatTarget; enemy: PointXZ; cat?: PointXZ;
  playerVisible: boolean; catVisible: boolean; pressure: number; hunters: number;
}): ThreatTarget {
  return !playerVisible && cat && canHuntCompanion('archer', pressure, true) &&
    (current === 'cat' || hunters < companionHunterCap(pressure)) &&
    distance(enemy, cat) < 20 && catVisible ? 'cat' : 'player';
}

/** Local sweep used to test the authored arrow hitbox after projectile movement. */
export function companionArrowHits(arrow: Readonly<Point & { vx?: number; vy?: number; vz?: number }>, cat: Point, delta = 0) {
  const x = arrow.x - (arrow.vx ?? 0) * delta, y = arrow.y - (arrow.vy ?? 0) * delta, z = arrow.z - (arrow.vz ?? 0) * delta;
  const dx = arrow.x - x, dz = arrow.z - z;
  const length = dx * dx + dz * dz;
  const along = length > 1e-9 ? clamp(((cat.x - x) * dx + (cat.z - z) * dz) / length, 0, 1) : 1;
  const height = y + (arrow.y - y) * along;
  return Math.hypot(cat.x - (x + dx * along), cat.z - (z + dz * along)) < .24 &&
    height > cat.y - .05 && height < cat.y + .38;
}

export function companionMeleeHits(origin: Point, heading: number, reach: number, arc: number, cat: Point) {
  const dx = cat.x - origin.x, dz = cat.z - origin.z;
  if (Math.hypot(dx, dz) >= reach + .24 || Math.abs(cat.y - origin.y) >= 1.6) return false;
  if (arc >= 360) return true;
  let angle = (Math.atan2(-dx, -dz) - heading + Math.PI) % (Math.PI * 2);
  if (angle < 0) angle += Math.PI * 2;
  return Math.abs(angle - Math.PI) < arc * Math.PI / 180;
}
