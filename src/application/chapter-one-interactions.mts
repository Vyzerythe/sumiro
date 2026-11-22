/** Story interaction rules from the shipped Chapter One, game, kit, and layout bundles. */
import type { createRunProgress } from '../domain/run-progress.mts';
import { scrollCount, scrollTexts } from '../domain/scrolls.mjs';
import { pointInPolygon, type PointXZ } from '../physics/geometry.mts';

export const chapterOneInteractionSites = {
  shrines: [
    { id: 'table', x: 9.2, z: -40.5, heading: 0.4 },
    { id: 'plateau', x: 15.4, z: -55.6, heading: 2.2 },
  ],
  scroll: { id: 'first_mist', x: 10.2, y: 9.72, z: -40.7, heading: 0.6 },
  pool: { id: 'pool', x: 5.87, y: 8.32304, z: -59.16, radius: 1.55 },
} as const;

const gateYaw = Math.PI / 180 * -45.4;
const gateCosine = Math.cos(gateYaw);
const gateSine = Math.sin(gateYaw);
const gateCorners: readonly PointXZ[] = [[-2.4, -4], [2.4, -4], [2.4, 0.15], [-2.4, 0.15]];
const gateExit = gateCorners.map(([x, z]): PointXZ => [
  14.23 + x * gateCosine + z * gateSine,
  -61.255 - x * gateSine + z * gateCosine,
]);
const CAMERA_LEAD = { x: 12.6, z: -59.6, lift: 0.5, pitch: -3 } as const;
const TOUCH_RADIUS = 0.8;
const TOUCH_CONTACT = 0.42;
const LEAD_START = 2.4;
const OPEN_GATE = 3.2;
const TEACH_INK_STEP = 4.6;
const FINISH_CONTACT = 6;
const ROPE_FALL = 1.5;
const BUSY_STATES = new Set(['INTERACT', 'DRINK', 'TOUCH', 'DEATH']);
const ACTION_STATES = new Set(['IDLE', 'WALK', 'RUN', 'SPRINT', 'LAND', 'TEETER']);

type Progress = Pick<ReturnType<typeof createRunProgress>['current'], 'shrine' | 'scrolls' | 'flags'>;
type Shrine = (typeof chapterOneInteractionSites.shrines)[number]['id'];
type Scroll = typeof chapterOneInteractionSites.scroll.id;
type GatePhase = 'barred' | 'dropping' | 'open';
type Action = 'INTERACT' | 'TOUCH';

export type ChapterOneTarget = Readonly<{
  x: number; y: number; z: number; radius: number; prompt: string;
} & ({ kind: 'shrine'; id: Shrine } | { kind: 'scroll'; id: Scroll } | { kind: 'pool'; id: 'pool' })>;

export type ChapterOneInteractionEvent =
  | { type: 'entry'; litShrine: Shrine | null; scrollCaptured: boolean; inkLearned: boolean }
  | { type: 'prompt'; target: ChapterOneTarget | null }
  | { type: 'shrine-rested'; id: Shrine }
  | { type: 'scroll-captured'; id: Scroll; lines: readonly string[]; count: number; total: number }
  | { type: 'pool-contact' }
  | { type: 'gate'; phase: GatePhase }
  | { type: 'camera-lead'; target: typeof CAMERA_LEAD | null }
  | { type: 'hint'; text: string; ms: number }
  | { type: 'chapter-exit' };

export interface ChapterOneInteractionPlayer {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly lastGroundY: number;
  readonly vx: number;
  readonly vz: number;
  readonly grounded: boolean;
  readonly state: string;
}

export interface ChapterOneInteractionEffects {
  groundHeightAt(x: number, z: number): number | null;
  checkpoint(id: Shrine): void;
  collectScroll(id: Scroll): void;
  /** Persist the flag and grant the ability in the owning run. */
  learnInkStep(): void;
  setGateBarrier(enabled: boolean): void;
  tryAction?(action: Action, target: ChapterOneTarget): boolean;
  onEvent?(event: ChapterOneInteractionEvent): void;
}

interface FrameInput {
  interact?: boolean;
  playing?: boolean;
  fighting?: boolean;
}

/** Drives authored interaction state from one story simulation tick at a time. */
export function createChapterOneInteractions(effects: ChapterOneInteractionEffects) {
  const sites = chapterOneInteractionSites;
  const pool: ChapterOneTarget = { ...sites.pool, kind: 'pool', radius: 1.7, prompt: 'E  touch the ink' };
  const scroll: ChapterOneTarget = { ...sites.scroll, kind: 'scroll', radius: 1.5, prompt: 'E  take the scroll' };
  const emit = (event: ChapterOneInteractionEvent) => effects.onEvent?.(event);
  let targets: ChapterOneTarget[] | undefined;
  let near: ChapterOneTarget | null = null;
  let restedAt: Shrine | null = null;
  let scrollCaptured = false;
  let collectedScrolls = 0;
  let inkLearned = false;
  let inPool = false;
  let touchTime: number | null = null;
  let contactTime = 0;
  let taughtInkStep = false;
  let leadingCamera = false;
  let gatePhase: GatePhase = 'barred';
  let gateTime = 0;
  let barrier: boolean | undefined;
  let inGateExit = false;

  function setNear(target: ChapterOneTarget | null) {
    if (near === target) return;
    near = target;
    emit({ type: 'prompt', target });
  }

  function setLead(active: boolean) {
    if (leadingCamera === active) return;
    leadingCamera = active;
    emit({ type: 'camera-lead', target: active ? CAMERA_LEAD : null });
  }

  function setGate(phase: GatePhase) {
    gatePhase = phase;
    gateTime = 0;
    emit({ type: 'gate', phase });
  }

  function syncBarrier() {
    const enabled = gatePhase === 'barred';
    if (barrier === enabled) return;
    effects.setGateBarrier(enabled);
    barrier = enabled;
  }

  function enter(progress?: Progress) {
    const shrines: ChapterOneTarget[] = sites.shrines.map(site => ({
      ...site, kind: 'shrine', y: effects.groundHeightAt(site.x, site.z) ?? 0, radius: 1.9, prompt: 'E  rest at the lantern',
    }));
    targets = [...shrines, scroll, pool];
    setNear(null);
    setLead(false);
    restedAt = null;
    collectedScrolls = progress?.scrolls.length ?? 0;
    scrollCaptured = progress?.scrolls.includes(sites.scroll.id) ?? false;
    inkLearned = Boolean(progress?.flags.inkStep);
    inPool = false;
    touchTime = null;
    contactTime = 0;
    taughtInkStep = false;
    inGateExit = false;
    setGate(inkLearned ? 'open' : 'barred');
    barrier = undefined;
    syncBarrier();
    const litShrine = sites.shrines.find(site => site.id === progress?.shrine)?.id ?? null;
    emit({ type: 'entry', litShrine, scrollCaptured, inkLearned });
  }

  function closest(player: ChapterOneInteractionPlayer): ChapterOneTarget | null {
    if (!targets || !player.grounded || BUSY_STATES.has(player.state)) return null;
    let best: ChapterOneTarget | null = null;
    let nearest = Infinity;
    for (const target of targets) {
      if (target.kind === 'scroll' && scrollCaptured || target.kind === 'pool' && (inkLearned || touchTime !== null)) continue;
      if (Math.abs(target.y - player.y) > 1.6) continue;
      const distance = Math.hypot(target.x - player.x, target.z - player.z);
      if (target.kind === 'shrine' && restedAt === target.id) {
        if (distance < target.radius + 0.6) continue;
        restedAt = null;
      }
      if (distance < target.radius && distance < nearest) {
        best = target;
        nearest = distance;
      }
    }
    return best;
  }

  function accept(player: ChapterOneInteractionPlayer, action: Action, target: ChapterOneTarget): boolean {
    return player.grounded && ACTION_STATES.has(player.state) && (effects.tryAction?.(action, target) ?? true);
  }

  function beginTouch(player: ChapterOneInteractionPlayer) {
    if (accept(player, 'TOUCH', pool)) touchTime = 0;
  }

  function interact(player: ChapterOneInteractionPlayer, target: ChapterOneTarget, fighting: boolean) {
    if (target.kind === 'pool') { beginTouch(player); return; }
    if (target.kind === 'shrine' && fighting) {
      emit({ type: 'hint', text: 'Not while they’re here.', ms: 2400 });
      return;
    }
    if (!accept(player, 'INTERACT', target)) return;
    if (target.kind === 'shrine') {
      restedAt = target.id;
      effects.checkpoint(target.id);
      emit({ type: 'shrine-rested', id: target.id });
    } else {
      scrollCaptured = true;
      collectedScrolls++;
      effects.collectScroll(target.id);
      emit({ type: 'scroll-captured', id: target.id, lines: scrollTexts[target.id], count: collectedScrolls, total: scrollCount });
    }
  }

  function advancePool(player: ChapterOneInteractionPlayer, delta: number, distance: number) {
    if (!inkLearned && touchTime === null && player.grounded && distance < TOUCH_RADIUS) beginTouch(player);
    if (touchTime === null) return;
    touchTime += delta;
    if (!inkLearned && touchTime >= TOUCH_CONTACT) {
      contactTime = touchTime;
      inkLearned = true;
      effects.learnInkStep();
      emit({ type: 'pool-contact' });
    }
    if (!inkLearned) return;
    const sinceContact = touchTime - contactTime;
    setLead(sinceContact >= LEAD_START && sinceContact < FINISH_CONTACT &&
      (sinceContact < LEAD_START * 1.5 || Math.hypot(player.vx, player.vz) < 1));
    if (gatePhase === 'barred' && sinceContact >= OPEN_GATE) setGate('dropping');
    if (!taughtInkStep && sinceContact >= TEACH_INK_STEP) {
      taughtInkStep = true;
      emit({ type: 'hint', text: 'Shift  Ink Step: a dodge on the ground, a dash in the air', ms: 6500 });
    }
    if (sinceContact >= FINISH_CONTACT) touchTime = null;
  }

  function update(delta: number, player: ChapterOneInteractionPlayer, {
    interact: pressed = false, playing = true, fighting = false,
  }: FrameInput = {}) {
    if (!Number.isFinite(delta) || delta < 0) throw RangeError('Interaction step must be finite and nonnegative');
    if (!targets || !playing) { setNear(null); return; }
    const distance = Math.hypot(player.x - pool.x, player.z - pool.z);
    inPool = player.grounded && distance < sites.pool.radius && Math.abs(player.y - player.lastGroundY) < 0.5;
    if (gatePhase === 'dropping') {
      gateTime += delta;
      if (gateTime >= ROPE_FALL) setGate('open');
    }
    syncBarrier();
    advancePool(player, delta, distance);
    const insideExit = barrier === false && pointInPolygon(player.x, player.z, gateExit);
    if (insideExit && !inGateExit) emit({ type: 'chapter-exit' });
    inGateExit = insideExit;
    const target = closest(player);
    setNear(target);
    if (pressed && target) interact(player, target, fighting);
  }

  return {
    get near() { return near; }, get inPool() { return inPool; }, get gatePhase() { return gatePhase; },
    enter, update,
  };
}
