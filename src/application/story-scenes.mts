/** Scene direction recovered from the shipped cutscene and chapter bundles. */
export type StorySceneId = 'opening_cat' | 'reunion';
export type StoryActor = 'player' | 'cat' | 'family0' | 'family1' | 'family2';
export type ScenePoint = readonly [x: number, y: number, z: number];
type SceneMark = ScenePoint | (() => ScenePoint);
type Outcome = 'completed' | 'skipped' | 'cancelled' | 'failed';

export const storySceneSites = {
  opening_cat: {
    chapter: 'ch1_climb', cat_pool: [6.14, 8.316, -58.07, -2.897], cat_stand: [6.25, 8.313, -57.64],
    ink_pool: [5.87, -59.16], trigger: { id: 'cat_scene', yMin: 7.6, initialDwell: 1.2, dwell: .3 },
  },
  reunion: {
    chapter: 'ch6_summit', reunion_family: [-293.4, 86.4, -350], reunion_set_down: [-289.6, 86.4, -350],
    trigger: { id: 'reunion', poly: [[-300,-356],[-283.5,-356],[-283.5,-344],[-300,-344]], flag: 'ch6_duel' },
  },
} as const;

export const storySceneLines = {
  find: { speaker: 'samurai', voice: 'ch1_find_cat', parts: [
    'A rare white-furred mountain cat…', "You won't survive down here. So far from home…",
  ] },
  home: { speaker: 'samurai', voice: 'ch6_home', parts: ['There. Home.'] },
  waited: { speaker: 'samurai', voice: 'ch6_waited', parts: ['They waited for you all this time.'] },
  stay: { speaker: 'samurai', voice: 'ch6_stay', parts: ['Stay with them now. No more running.'] },
} as const;

interface ShotKey { pos: SceneMark; look: SceneMark }
export type SceneShot = ({
  keys: readonly ShotKey[]; clear?: 'rock'; guard?: SceneMark; drift?: number;
} | {
  orbit: ScenePoint; radius: number; height: number; look: number; from: number; to: number;
}) & { dur: number };
interface SceneLine { speaker: string; voice: string; parts: readonly string[] }
export type StorySceneCommand =
  | { type: 'shot'; shot: SceneShot; blend: number }
  | { type: 'sound'; name: 'catMewSoft' | 'catMeow' | 'catNya' | 'catPurr'; at?: ScenePoint }
  | { type: 'line'; line: SceneLine }
  | { type: 'subtitle'; text: string | null; speaker?: string; voice?: string }
  | { type: 'hold'; actor: 'player' }
  | { type: 'walk'; actor: StoryActor; x: number; z: number; timeout: number; within?: number;
      speed?: number; face?: number; lead?: number; then?: string | null }
  | { type: 'face'; actor: 'player'; heading: number; rate: number }
  | { type: 'play'; actor: StoryActor; clip: string; fade: number; loop?: boolean; then?: string;
      time?: number; speed?: number }
  | { type: 'attach'; actor: 'cat'; to: 'shoulder' | null }
  | { type: 'rig'; pose: 'opening-hands' | 'cradle-lift' | 'cradle-raise' | 'shoulder-transfer' |
      'reunion-cradle' | 'reunion-kneel' | 'reunion-lower' | 'reunion-step-down' | 'reunion-rise';
      seconds?: number; point?: ScenePoint; heading?: number };

export interface StorySceneHandle {
  /** Inspect current state in the fixed-step loop. */
  done?(): boolean;
  /** Actual voice duration when known. */
  duration?(): number | undefined;
}

export interface StorySceneFinish {
  id: StorySceneId;
  outcome: Outcome;
  player?: { point: ScenePoint; heading: number };
  cat?: { point: ScenePoint; heading: number };
  family?: readonly { actor: StoryActor; point: ScenePoint; heading: number; clip: string }[];
  attach?: 'shoulder';
  catClip?: 'ride' | 'sit';
  flag?: 'cat_found';
  reunite?: true;
}

export interface StorySceneEffects {
  begin?(id: StorySceneId, signal: AbortSignal): void;
  apply(command: StorySceneCommand, signal: AbortSignal): StorySceneHandle | void;
  /** Release camera/voice/input/rig for every outcome; apply terminal placements only when supplied. */
  finish?(result: StorySceneFinish): void;
  point?(actor: StoryActor, mark?: 'head'): ScenePoint | undefined;
  heading?(actor: StoryActor): number | undefined;
  ground?(x: number, z: number, referenceY: number): number | undefined;
  ready?(): boolean;
  duration?(actor: StoryActor, clip: string): number | undefined;
  catStepDown?(): { takeoff: number; land: number; seconds: number } | undefined;
}

type Job = Generator<void, void, unknown>;
const familyActors = ['family0', 'family1', 'family2'] as const;
const headingTo = (x: number, z: number, toX: number, toZ: number) => Math.atan2(-(toX - x), -(toZ - z));
const right = Math.PI / 2;
const fallbackTime = (text: string) => Math.max(1.8, .8 + text.length / 15);
const cue = (name: Extract<StorySceneCommand, {type: 'sound'}>['name'], at?: ScenePoint): StorySceneCommand =>
  ({ type: 'sound', name, ...(at ? { at } : {}) });

function createTimeline(effects: StorySceneEffects, signal: AbortSignal) {
  let seconds = 0;
  const jobs: Job[] = [];
  const send = (command: StorySceneCommand) => signal.aborted ? undefined : effects.apply(command, signal);
  function* wait(duration: number): Job {
    const deadline = seconds + duration;
    while (seconds < deadline - 1e-6) yield;
  }
  function* until(predicate: () => boolean, duration: number): Job {
    const deadline = seconds + duration;
    while (!predicate() && seconds < deadline) yield;
  }
  function* action(command: StorySceneCommand, timeout: number): Job {
    const handle = send(command);
    if (handle?.done) yield* until(() => !!handle.done?.(), timeout);
  }
  function* all(...parallel: Job[]): Job {
    let pending = parallel;
    while (pending.length) {
      pending = pending.filter(job => !signal.aborted && !job.next().done);
      if (pending.length) yield;
    }
  }
  function later(duration: number, perform: () => void) {
    jobs.push((function* () { yield* wait(duration); perform(); })());
  }
  function line(line: SceneLine) {
    const state = { part: 0, done: false };
    const run = (function* (): Job {
      const handle = send({ type: 'line', line });
      const base = line.parts.map(fallbackTime);
      const total = base.reduce((sum, time) => sum + time, 0);
      const start = seconds;
      const deadline = (count: number) => {
        const spoken = handle?.duration?.();
        if (spoken === undefined || !Number.isFinite(spoken) || spoken <= 0) {
          return base.slice(0, count).reduce((sum, time) => sum + time, 0);
        }
        if (line.parts.length === 1) return Math.max(spoken + .3, 1.8);
        const mark = base.slice(0, count).reduce((sum, time) => sum + Math.max(1.2, spoken * time / total), 0);
        return count === base.length ? Math.max(mark, spoken) + .3 : mark;
      };
      for (const [index, text] of line.parts.entries()) {
        state.part = index;
        send({ type: 'subtitle', text, speaker: line.speaker, ...(index === 0 ? { voice: line.voice } : {}) });
        while (seconds - start < deadline(index + 1)) yield;
      }
      if (handle?.done) yield* until(() => !!handle.done?.(), 6);
      send({ type: 'subtitle', text: null });
      state.part = line.parts.length;
      state.done = true;
    })();
    return { state, run };
  }
  const anchor = (point: ScenePoint): ScenePoint => [point[0], effects.ground?.(point[0], point[2], point[1]) ?? point[1], point[2]];
  const play = (actor: StoryActor, clip: string, fade: number, extra: Pick<Extract<StorySceneCommand, {type: 'play'}>, 'loop' | 'then' | 'time' | 'speed'> = {}) =>
    send({ type: 'play', actor, clip, fade, ...extra });
  const shot = (shot: SceneShot, blend = 1) => send({ type: 'shot', shot, blend });
  const walk = (x: number, z: number, timeout: number, within?: number) =>
    action({ type: 'walk', actor: 'player', x, z, timeout, ...(within === undefined ? {} : { within }) }, timeout + 1.2);
  const face = (heading: number, rate = 3.2) => action({ type: 'face', actor: 'player', heading, rate }, 400 / 60);
  return {
    get time() { return seconds; },
    anchor, send, wait, until, all, action, later, line, play, shot, walk, face,
    spawn(job: Job) { jobs.push(job); },
    step(dt: number, main: Job) {
      seconds += dt;
      const pending = [...jobs];
      const running = !main.next().done;
      if (!running || signal.aborted) return false;
      for (const job of pending) {
        if (signal.aborted) return false;
        if (job.next().done) jobs.splice(jobs.indexOf(job), 1);
      }
      return true;
    },
    stop() { jobs.length = 0; },
  };
}

type Timeline = ReturnType<typeof createTimeline>;
const openingOffset = [2.6, 1.65, .9] as const;
const openingFar = [7.64, -52.59] as const;
const rad = Math.PI / 180;

function* opening(scene: Timeline, effects: StorySceneEffects): Job {
  const [catX, , catZ] = storySceneSites.opening_cat.cat_pool;
  const stand = scene.anchor(storySceneSites.opening_cat.cat_stand);
  const [x, y, z] = stand;
  const catHeading = headingTo(x, z, catX, catZ);
  const exitHeading = headingTo(x, z, ...storySceneSites.opening_cat.ink_pool);
  const catAngle = -catHeading / rad;
  const side = catAngle + 90;
  const center = [(x + catX) / 2, (z + catZ) / 2] as const;
  const position = (angle: number, distance: number, height: number, at: readonly [number, number] = [x, z]): ScenePoint =>
    [at[0] + Math.sin(angle * rad) * distance, y + height, at[1] - Math.cos(angle * rad) * distance];
  const player = effects.point?.('player') ?? stand;
  const far = player[0] > 12;
  const gap = Math.hypot(x - player[0], z - player[2]);
  const look = (blend: number, lift: number) => (): ScenePoint => {
    const head = effects.point?.('player', 'head');
    const cat = effects.point?.('cat', 'head');
    return head && cat ? [
      head[0] + (cat[0] - head[0]) * blend, head[1] + (cat[1] - head[1]) * blend + lift,
      head[2] + (cat[2] - head[2]) * blend,
    ] : [player[0] + (catX - player[0]) * blend, player[1] + 1.3, player[2] + (catZ - player[2]) * blend];
  };
  const following = (): SceneShot => ({ keys: [{ pos: () => {
    const feet = effects.point?.('player') ?? player;
    return [feet[0] + openingOffset[0], feet[1] + openingOffset[1], feet[2] + openingOffset[2]];
  }, look: look(.45,.25) }], dur: 2 + gap / 1.6, drift: 0, clear: 'rock' });
  const hold = { type: 'hold', actor: 'player' } as const;
  scene.send(hold);
  if (far) {
    const [fromX, fromZ] = openingFar;
    scene.shot({ keys: [{ pos: [fromX + openingOffset[0],y + openingOffset[1],fromZ + openingOffset[2]],
      look: [fromX + (catX - fromX) * .45,y + 1.62 + (.2 - 1.62) * .45 + .25,fromZ + (catZ - fromZ) * .45] }],
      dur: 3, clear: 'rock' });
  } else scene.shot(following());
  scene.send(cue('catMewSoft'));
  scene.play('cat', 'sit_meow', .2, { then: 'hide' });
  yield* scene.until(() => effects.ready?.() ?? true, 2);
  yield* scene.face(headingTo(player[0], player[2], catX, catZ), 2.4);
  yield* scene.wait(.5);
  yield* scene.all(scene.walk(x, z, 2 + gap / 1.2, .08), (function* () {
    if (!far) return;
    yield* scene.until(() => {
      const feet = effects.point?.('player') ?? stand;
      return Math.hypot(feet[0] - x, feet[2] - z) < 4.5;
    }, 2 + gap / 1.2);
    scene.shot(following(), 1.2);
  })());
  scene.shot({ keys: [{ pos: position(side - 12,4,1.3, [...center]), look: look(.5,.1) },
    { pos: position(side - 12,3.7,1.2,[...center]), look: look(.5,.1) }], dur: 3, clear: 'rock' }, .9);
  yield* scene.face(catHeading, 2);
  scene.play('cat', 'sit_meow', .3, { then: 'sit' });
  scene.send(cue('catMewSoft'));
  yield* scene.wait(1.25);
  const rise = effects.duration?.('player', 'rise') ?? 0;
  const lowering = rise > 0;
  if (lowering) scene.play('player', 'rise', .25, { time: rise - .001, speed: -.55 });
  scene.shot({ keys: [
    { pos: position(side - 15,2.9,1,[...center]), look: look(.5,.02) },
    { pos: position(side - 15,2.85,.98,[...center]), look: look(.5,.02) },
    { pos: position(side - 17,2.75,1.45,[...center]), look: look(.5,.02) }], dur: 4.4, clear: 'rock' }, 1);
  if (lowering) {
    yield* scene.wait(.32);
    scene.play('player', 'crouch_touch', .42, { time: 0, speed: 0 });
  }
  scene.send({ type: 'rig', pose: 'opening-hands' });
  yield* scene.wait(.62);
  scene.play('cat', 'held', .5, { loop: true });
  scene.send({ type: 'rig', pose: 'cradle-lift', seconds: .8 });
  yield* scene.all((function* () {
    if (!lowering) return;
    yield* scene.action({ type: 'play', actor: 'player', clip: 'rise', fade: .75, time: 0, speed: .25 }, 2.5);
    const interact = effects.duration?.('player', 'interact') ?? 0;
    scene.play('player', 'interact', .45, { time: Math.max(0, interact - .02), speed: 0 });
    yield* scene.wait(.45);
    yield* scene.action({ type: 'play', actor: 'player', clip: 'interact', fade: 0, time: Math.max(0, interact - .02), speed: 1 }, 1);
  })(), scene.wait(.8));
  scene.shot({ keys: [
    { pos: position(side - 8,2.35,1.5,[...center]), look: [center[0],y + 1.42,center[1]] },
    { pos: position(side - 8,2.2,1.48,[...center]), look: [center[0],y + 1.44,center[1]] }], dur: 3, clear: 'rock' }, 1.2);
  scene.later(.45, () => scene.send(cue('catPurr')));
  scene.send({ type: 'rig', pose: 'cradle-raise', seconds: 1.1 });
  yield* scene.all(scene.face(catHeading, 1.1), scene.wait(1.2));
  const angle = catAngle + 60;
  const speech = scene.line(storySceneLines.find);
  scene.spawn(speech.run);
  const speechLook = position(angle,.16,1.5);
  scene.shot({ keys: [{ pos: position(angle + 45,2.3,1.42), look: speechLook },
    { pos: position(angle + 48,1.95,1.45), look: speechLook }], dur: 7.5, clear: 'rock' }, 1.4);
  yield* scene.face(-angle * rad, 1.2);
  yield* scene.until(() => speech.state.part >= 1, 6);
  scene.play('cat', 'held_meow', .3, { then: 'held' });
  scene.send(cue('catMewSoft'));
  yield* scene.until(() => speech.state.part >= 2, 8);
  const exitAngle = -exitHeading / rad;
  scene.shot({ keys: [
    { pos: position(exitAngle + 162,2.74,1.85), look: position(exitAngle,.6,1.35) },
    { pos: position(exitAngle + 165,3.1,2.05), look: position(exitAngle - 8,2.22,1.25) },
    { pos: position(exitAngle + 168,3.37,2.2), look: position(exitAngle - 10,3.55,1.1) }], dur: 6.2, clear: 'rock' }, 1.4);
  yield* scene.face(exitHeading, 1.6);
  scene.send({ type: 'rig', pose: 'shoulder-transfer', seconds: 1.6 });
  yield* scene.wait(1.6 * .02);
  scene.play('cat', 'ride', .6, { loop: true });
  yield* scene.wait(1.6 * .98);
  scene.send({ type: 'attach', actor: 'cat', to: 'shoulder' });
  yield* scene.until(() => speech.state.done, 8);
  yield* scene.wait(.2);
}

function reunionPositions(family: ScenePoint, setDown: ScenePoint) {
  const [x, y, z] = family;
  const cat = { point: [x - .1 + .37,y,z - .3] as ScenePoint, heading: right };
  const familyTwo: ScenePoint = [cat.point[0] + .03,y,cat.point[2] + .24];
  const familyOne: ScenePoint = [x - .24,y,z + .32];
  return {
    cat,
    player: { point: [setDown[0] + .58,setDown[1],setDown[2]] as ScenePoint, heading: right },
    family: [
      { actor: familyActors[0], point: [x - .1,y,z - .3] as ScenePoint, heading: -right, clip: 'sit' },
      { actor: familyActors[1], point: familyOne, heading: headingTo(familyOne[0],familyOne[2],cat.point[0],cat.point[2]), clip: 'sit' },
      { actor: familyActors[2], point: familyTwo, heading: headingTo(familyTwo[0],familyTwo[2],cat.point[0],cat.point[2] - .06), clip: 'curl' },
    ],
  };
}

function spawnFamily(scene: Timeline, effects: StorySceneEffects, home: () => boolean, anchor: ScenePoint, spots: ReturnType<typeof reunionPositions>['family']) {
  const walk = (i: number, speed: number, lead: number, then: string | null) => {
    const site = spots[i]!;
    return scene.action({ type: 'walk', actor: site.actor, x: site.point[0], z: site.point[2], speed,
      face: site.heading, lead, then, timeout: 12 }, 12);
  };
  scene.spawn((function* () {
    yield* scene.wait(.8);
    scene.play('family0', 'idle', .7, { loop: true });
    yield* scene.wait(.9);
    yield* walk(0,.55,.15,'idle');
    yield* scene.until(home,6);
    yield* scene.wait(.15);
    scene.play('family0', 'greet', .2);
    yield* scene.wait(2.2);
    scene.play('family0', 'sit_in', .25, { then: 'sit' });
  })());
  scene.spawn((function* () {
    yield* scene.wait(.4);
    scene.play('family2', 'meow', .1);
    const point = effects.point?.('family2') ?? anchor;
    scene.send(cue('catMewSoft', [point[0],anchor[1] + .15,point[2]]));
    yield* scene.until(home,6);
    yield* scene.wait(.55);
    yield* walk(2,.4,.1,null);
    scene.play('family2', 'greet', .15);
    yield* scene.wait(1.7);
    scene.play('family2', 'curl_in', .25, { then: 'curl' });
  })());
  scene.spawn((function* () {
    yield* scene.until(home,6);
    yield* scene.wait(.9);
    scene.play('family1', 'meow', .12);
    yield* scene.wait(1.1);
    yield* walk(1,.45,.1,'sit');
  })());
}

function* setCatDown(scene: Timeline, effects: StorySceneEffects, point: ScenePoint): Job {
  scene.send({ type: 'attach', actor: 'cat', to: null });
  yield* scene.action({ type: 'rig', pose: 'reunion-cradle' }, 1);
  yield* scene.wait(1.1 * .15);
  scene.play('cat', 'cradle', .6, { loop: true });
  yield* scene.wait(1.1 * .85);
  scene.play('player', 'death', 1.35, { time: .72, speed: 0 });
  scene.send({ type: 'rig', pose: 'reunion-kneel' });
  yield* scene.wait(1.35 * .8);
  const from = effects.point?.('player') ?? point;
  const heading = effects.heading?.('player') ?? right;
  const ground = scene.anchor([from[0] - Math.sin(heading) * .46, from[1], from[2] - Math.cos(heading) * .46]);
  scene.send({ type: 'rig', pose: 'reunion-lower', seconds: .9, point: ground, heading: heading + right });
  yield* scene.wait(.9 * .72);
  const leapStart = scene.time;
  scene.play('cat', 'step_down', .15);
  yield* scene.wait(.9 * .28);
  const timing = effects.catStepDown?.() ?? { takeoff: 8 / 30, land: 15 / 30, seconds: 1 };
  yield* scene.wait(Math.max(timing.takeoff - (scene.time - leapStart), 0));
  scene.send({ type: 'rig', pose: 'reunion-step-down', seconds: Math.max(timing.land - timing.takeoff,.1),
    point: ground, heading: heading + right });
  yield* scene.wait(Math.max(timing.seconds - .05 - (scene.time - leapStart), timing.land - timing.takeoff, .1));
}

function* reunion(scene: Timeline, effects: StorySceneEffects, carried: boolean): Job {
  const family = scene.anchor(storySceneSites.reunion.reunion_family);
  const positions = reunionPositions(family, scene.anchor(storySceneSites.reunion.reunion_set_down));
  const [fx, y, z] = family;
  const [x, , playerZ] = positions.player.point;
  const feet = effects.point?.('player') ?? positions.player.point;
  let home = false;
  const familyMoves = () => spawnFamily(scene,effects,() => home,family,positions.family);
  function* runCat(speed: number): Job {
    const { cat } = positions;
    yield* scene.action({ type: 'walk', actor: 'cat', x: cat.point[0], z: cat.point[2], speed,
      face: cat.heading, lead: .4, then: 'greet', timeout: 12 }, 12);
    home = true;
  }
  function* speak(line: SceneLine, after: number): Job {
    yield* scene.line(line).run;
    yield* scene.wait(after);
  }
  scene.send({ type: 'hold', actor: 'player' });
  scene.shot({ keys: [{ pos: [feet[0] + 3.9,y + 2.5,feet[2] + 2.7], look: [fx + 1.2,y + .85,z] },
    { pos: [x + 3.2,y + 2.15,playerZ + 2.4], look: [fx,y + .6,z] }], dur: 4.4 });
  scene.later(.6, () => scene.play('family1', 'idle', .8, { loop: true }));
  yield* scene.wait(.15);
  scene.later(.9, () => {
    scene.play('family2', 'meow', .1);
    scene.send(cue('catMewSoft', [fx + .12,y + .2,z - .04]));
  });
  if (carried) {
    scene.later(1.7, () => {
      scene.play('cat', 'ride_meow', .15, { then: 'ride' });
      scene.send(cue('catMeow'));
    });
  } else {
    familyMoves();
    scene.spawn(runCat(2.6));
  }
  yield* scene.walk(carried ? x : x - .6, playerZ, 7);
  yield* scene.face(right);
  if (carried) {
    scene.shot({ keys: [{ pos: [x - 3.1,y + 1.35,playerZ + 1.2], look: [x - .15,y + 1.05,playerZ + .05] },
      { pos: [x - 2.85,y + .85,playerZ + .98], look: [x - .3,y + .48,playerZ] }],
      dur: 5.2, guard: [x - .3,y + .6,playerZ] }, 0);
    yield* scene.wait(.15);
    yield* setCatDown(scene,effects,positions.player.point);
    scene.play('cat', 'idle', .25, { loop: true });
    scene.spawn(speak(storySceneLines.home,0));
    yield* scene.wait(.4);
    scene.play('cat', 'meow', .12);
    scene.send(cue('catMewSoft'));
    yield* scene.wait(1.05);
    const look = (): ScenePoint => {
      const cat = effects.point?.('cat');
      return cat ? [cat[0] - 1.9,y + .3,cat[2] + .35] : [x - 2.4,y + .3,z + .35];
    };
    scene.shot({ keys: [{ pos: [x - .45,y + .75,z - 4.4], look },
      { pos: [x - 2.75,y + .72,z - 4.35], look }], dur: 2.5, drift: .04, clear: 'rock' }, 0);
    scene.later(.3, () => scene.send(cue('catMeow')));
    familyMoves();
    yield* runCat(1.2);
  } else {
    scene.shot({ keys: [{ pos: [x + 3,y + 2.1,z + 5.5], look: [x - 2,y + .4,z] },
      { pos: [x + 2.75,y + 2,z + 5.15], look: [x - 2.2,y + .38,z] }], dur: 3.2 }, 1.3);
    yield* scene.until(() => {
      const cat = effects.point?.('cat');
      return !cat || Math.hypot(cat[0]-positions.cat.point[0],cat[2]-positions.cat.point[2]) < .1;
    },4);
    yield* speak(storySceneLines.home,.1);
  }
  scene.send(cue('catNya'));
  scene.later(.75, () => scene.send(cue('catPurr')));
  scene.later(1.9, () => scene.play('cat', 'sit_in', .25, { then: 'sit' }));
  scene.shot({ orbit: [fx + .25,y,z], radius: 2.75, height: .95, look: .28, from: 55, to: 28, dur: 4.6 }, 0);
  scene.spawn(scene.action({ type: 'rig', pose: 'reunion-rise', seconds: 1.25 }, 2.75));
  yield* scene.wait(.45);
  yield* speak(storySceneLines.waited,.25);
  const middle = (fx + x) / 2;
  const first = { pos: [x + 4.2,y + 2.1,z + 3.4], look: [middle + .05,y + .55,z] } satisfies ShotKey;
  const second = { pos: [first.pos[0] - .2,first.pos[1] + .05,first.pos[2] - .25],
    look: [first.look[0],first.look[1] + .04,first.look[2]] } satisfies ShotKey;
  scene.shot({ keys: [first,second], dur: 4 }, 0);
  yield* scene.wait(.3);
  yield* speak(storySceneLines.stay,.2);
  scene.shot({ keys: [second, { pos: [x + 1.6,y + 2.5,playerZ + 5.6], look: [middle + .3,y + 1,z] },
    { pos: [x + 3.5,y + 3.2,playerZ + 6.8], look: [fx - .5,y + 1.9,z - .5] }], dur: 4.2 }, .4);
  yield* scene.wait(3.8);
}

interface PlayOptions { carried?: boolean; signal?: AbortSignal }

export function createStorySceneController(effects: StorySceneEffects) {
  let active: {
    id: StorySceneId; abort: AbortController; timeline: Timeline; main: Job; detach(): void;
  } | undefined;
  let disposed = false;

  function stop(outcome: Outcome) {
    const current = active;
    if (!current) return false;
    active = undefined;
    current.detach();
    current.abort.abort();
    current.timeline.stop();
    const result: StorySceneFinish = { id: current.id, outcome };
    if (outcome === 'completed' || outcome === 'skipped') {
      if (current.id === 'opening_cat') {
        const stand = current.timeline.anchor(storySceneSites.opening_cat.cat_stand);
        if (outcome === 'skipped') result.player = { point: stand, heading: headingTo(stand[0], stand[2], ...storySceneSites.opening_cat.ink_pool) };
        Object.assign(result, { attach: 'shoulder', catClip: 'ride', flag: 'cat_found' });
      } else {
        const family = current.timeline.anchor(storySceneSites.reunion.reunion_family);
        const setDown = current.timeline.anchor(storySceneSites.reunion.reunion_set_down);
        const positions = reunionPositions(family,setDown);
        if (outcome === 'skipped') result.player = positions.player;
        result.cat = { ...positions.cat, point: current.timeline.anchor(positions.cat.point) };
        result.family = positions.family.map(actor => ({ ...actor, point: current.timeline.anchor(actor.point) }));
        result.catClip = 'sit';
        result.reunite = true;
      }
    }
    effects.finish?.(result);
    return true;
  }

  return {
    get active() { return active?.id ?? null; },
    play(id: StorySceneId, { carried = true, signal }: PlayOptions = {}) {
      if (disposed || active || signal?.aborted) return false;
      const abort = new AbortController();
      const timeline = createTimeline(effects,abort.signal);
      const main = id === 'opening_cat' ? opening(timeline,effects) : reunion(timeline,effects,carried);
      const cancel = () => stop('cancelled');
      active = { id, abort, timeline, main, detach: () => signal?.removeEventListener('abort',cancel) };
      signal?.addEventListener('abort',cancel,{ once: true });
      try {
        effects.begin?.(id,abort.signal);
      } catch (error) {
        stop('failed');
        throw error;
      }
      return !abort.signal.aborted;
    },
    step(dt: number) {
      if (!active || !Number.isFinite(dt) || dt <= 0) return;
      const current = active;
      try {
        if (!current.timeline.step(dt,current.main) && active === current) stop('completed');
      } catch (error) {
        if (active === current) stop('failed');
        throw error;
      }
    },
    skip: () => stop('skipped'),
    cancel: () => stop('cancelled'),
    dispose() { disposed = true; stop('cancelled'); },
  };
}
