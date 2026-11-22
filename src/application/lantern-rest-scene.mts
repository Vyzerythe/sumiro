import { lanternRest } from './story-beats.mts';
import type { ScenePoint, StorySceneCommand, StorySceneHandle } from './story-scenes.mts';

type Location = readonly [x: number, z: number];
type Shrine = Readonly<{ x: number; z: number; heading?: number }>;
type Outcome = 'completed' | 'skipped' | 'cancelled' | 'failed';

export type LanternRestCommand = StorySceneCommand
  | { type: 'lantern-hop'; point: ScenePoint }
  | { type: 'lantern-turn'; heading: number }
  | { type: 'lantern-rig'; pose: 'kneel' | 'hands' | 'lift' | 'rise'; seconds: number };

export interface LanternRestEffects {
  begin?(signal: AbortSignal): void;
  apply(command: LanternRestCommand, signal: AbortSignal): StorySceneHandle | void;
  finish(outcome: Outcome): void;
  point(actor: 'player' | 'cat' | 'camera'): ScenePoint;
  heading?(actor: 'player' | 'cat'): number | undefined;
  ground?(x: number, z: number, referenceY: number): number | undefined;
  ready?(): boolean;
  duration?(clip: string): number | undefined;
}

type Job = Generator<void, void, unknown>;
const toward = (x: number, z: number, targetX: number, targetZ: number) => Math.atan2(-(targetX - x), -(targetZ - z));
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const rotate = (x: number, z: number, angle: number): Location =>
  [x * Math.cos(angle) - z * Math.sin(angle), x * Math.sin(angle) + z * Math.cos(angle)];

function restingSpot(shrine: Shrine, [x, ,z]: ScenePoint): Location {
  const dx = x - shrine.x, dz = z - shrine.z;
  const length = Math.hypot(dx,dz) || 1;
  const heading = shrine.heading ?? 0;
  const pathX = .62 * Math.cos(heading) + .22 * Math.sin(heading);
  const pathZ = -.62 * Math.sin(heading) + .22 * Math.cos(heading);
  const side = -dz / length * pathX + dx / length * pathZ > 0 ? -1 : 1;
  const [a,b] = rotate(dx / length,dz / length,.45 * side);
  return [shrine.x + a * .8899999999999999,shrine.z + b * .8899999999999999];
}

function gatheringSpot(shrine: Shrine, spot: Location, camera: ScenePoint): Location {
  const dx = spot[0] - shrine.x, dz = spot[1] - shrine.z;
  const length = Math.hypot(dx,dz) || 1;
  const cx = spot[0] - camera[0], cz = spot[1] - camera[2];
  const distance = Math.hypot(cx,cz) || 1;
  let score = -Infinity, best = spot;
  for (const angle of [0,-.45,.45]) {
    const [side,fore] = rotate(dx / length,dz / length,angle);
    const separation = Math.abs(cx / distance * fore - cz / distance * side);
    if (separation <= score + .05) continue;
    score = separation;
    best = [spot[0] + side * .44,spot[1] + fore * .44];
  }
  return best;
}

function hopSpot([x, ,z]: ScenePoint, spot: Location, heading?: number): Location {
  let dx = spot[0] - x, dz = spot[1] - z;
  const distance = Math.hypot(dx,dz) || 1;
  let travel = Math.min(distance,.85);
  if (heading !== undefined) {
    const angle = wrap(toward(x,z,...spot) - heading);
    if (Math.abs(angle) > .8) {
      const direction = heading + Math.sign(angle) * .8;
      dx = -Math.sin(direction) * distance;
      dz = -Math.cos(direction) * distance;
      travel = Math.min(travel,.85 * .85);
      return [x + dx / distance * travel,z + dz / distance * travel];
    }
  }
  return distance <= 1 ? spot : [x + dx / distance * travel,z + dz / distance * travel];
}

/** Modal lantern scene. Actor and animation completion are polled during simulation. */
export function createLanternRestScene(effects: LanternRestEffects) {
  let active: { signal: AbortController; scene: Job; detach(): void } | undefined;
  let now = 0;
  let disposed = false;
  const send = (command: LanternRestCommand) => {
    if (active && !active.signal.signal.aborted) return effects.apply(command,active.signal.signal);
  };
  const ground = (x: number, z: number, y: number): ScenePoint => [x,effects.ground?.(x,z,y) ?? y,z];
  const jobs: Job[] = [];
  function* wait(seconds: number): Job {
    const until = now + seconds;
    while (now < until - 1e-6) yield;
  }
  function* until(condition: () => boolean, seconds: number): Job {
    const end = now + seconds;
    while (!condition() && now < end) yield;
  }
  function* action(command: LanternRestCommand, maxTime: number): Job {
    const handle = send(command);
    if (handle?.done) yield* until(() => handle.done?.() === true,maxTime);
  }
  const face = (spot: Location) => {
    const [x, ,z] = effects.point('player');
    return action({ type: 'face', actor: 'player', heading: toward(x,z,...spot), rate: 3.2 },400/60);
  };
  const playerWalk = ([x,z]: Location, timeout: number, within: number) =>
    action({ type: 'walk', actor: 'player', x, z, timeout, within },timeout + 1.2);
  function* speak(): Job {
    const line = lanternRest.line;
    const handle = send({ type: 'line', line });
    const start = now;
    const fallback = Math.max(1.8,.8 + line.parts[0].length / 15);
    send({ type: 'subtitle', text: line.parts[0], speaker: line.speaker, voice: line.voice });
    while (now - start < 14) {
      const seconds = handle?.duration?.();
      if (now - start >= (seconds && seconds > 0 ? Math.max(seconds + .3,1.8) : fallback) && (handle?.done?.() ?? true)) break;
      yield;
    }
    send({ type: 'subtitle', text: null });
    yield* wait(.2);
  }

  function* run(shrine: Shrine): Job {
    yield* until(() => effects.ready?.() ?? true,3);
    const player = effects.point('player');
    const spot = restingSpot(shrine,player);
    const [,y] = ground(...spot,player[1]);
    const aim: ScenePoint = [(spot[0] + player[0]) / 2,y + .65,(spot[1] + player[2]) / 2];
    const camera = effects.point('camera');
    const dx = camera[0] - aim[0], dz = camera[2] - aim[2];
    const length = Math.hypot(dx,dz) || 1;
    const [side,fore] = rotate(dx / length,dz / length,-.32);
    const first: ScenePoint = [aim[0] + side * 4.3,y + 1.8,aim[2] + fore * 4.3];
    const guard = (): ScenePoint => {
      const [x,y,z] = effects.point('player');
      return [x,y + 1.1,z];
    };
    send({ type: 'shot', blend: 1, shot: { dur: 12.5, guard, keys: [
      { pos: first, look: aim },
      { pos: [aim[0] + side * 3.95,y + 1.62,aim[2] + fore * 3.95], look: [aim[0],aim[1] - .05,aim[2]] },
    ] } });
    const gather = gatheringSpot(shrine,spot,first);
    const heading = toward(...spot,...gather);
    let lying = false, curled = false;
    jobs.push((function* () {
      const hop = hopSpot(player,spot,effects.heading?.('player'));
      yield* action({ type: 'lantern-hop', point: ground(...hop,y) },4);
      if (Math.hypot(hop[0] - spot[0],hop[1] - spot[1]) > .05) {
        yield* action({ type: 'walk', actor: 'cat', x: spot[0], z: spot[1], speed: .95, then: null, timeout: 12 },12);
      }
      const turnFrom = effects.heading?.('cat') ?? heading;
      yield* action({ type: 'lantern-turn', heading: turnFrom + Math.PI * (Math.sin(heading - turnFrom) >= 0 ? -.8 : .8) },4);
      yield* action({ type: 'lantern-turn', heading },4);
      send({ type: 'play', actor: 'cat', clip: 'curl_in', fade: .25, then: 'curl' });
      send({ type: 'sound', name: 'catPurr' });
      yield* wait(1.2);
      lying = true;
      yield* wait(2.2);
      curled = true;
    })());
    yield* wait(.9);
    yield* face(spot);
    yield* speak();
    yield* until(() => lying,5);
    yield* wait(1.4);
    const feet = effects.point('player');
    const from = Math.atan2(feet[2] - spot[1],feet[0] - spot[0]);
    const to = Math.atan2(gather[1] - spot[1],gather[0] - spot[0]);
    const rotation = wrap(to - from);
    if (Math.abs(rotation) > 1.1) {
      const radius = Math.max(Math.hypot(feet[0] - spot[0],feet[2] - spot[1]),.44 + .2);
      yield* playerWalk([spot[0] + Math.cos(from + rotation / 2) * radius,spot[1] + Math.sin(from + rotation / 2) * radius],3,.25);
    }
    const next = effects.point('player');
    if (Math.hypot(next[0] - gather[0],next[2] - gather[1]) > .08) yield* playerWalk(gather,4,.08);
    yield* face(spot);

    send({ type: 'play', actor: 'player', clip: 'land_heavy', fade: .7, time: .24, speed: 0 });
    send({ type: 'lantern-rig', pose: 'kneel', seconds: .7 });
    yield* until(() => curled,5);
    if (curled) send({ type: 'play', actor: 'cat', clip: 'curl_out', fade: .2, then: 'sit' });
    else send({ type: 'play', actor: 'cat', clip: 'sit', fade: .6, loop: true });
    yield* wait(.55);
    send({ type: 'lantern-rig', pose: 'hands', seconds: .25 });
    yield* wait(1.05 - .25);
    send({ type: 'play', actor: 'cat', clip: 'held', fade: .5, loop: true });
    const close: ScenePoint = [gather[0] * .7 + spot[0] * .3,y + 1,gather[1] * .7 + spot[1] * .3];
    send({ type: 'shot', blend: 1.3, shot: { dur: 3.5, drift: .03, guard, keys: [
      { pos: [close[0] + side * 4.5,y + 1.75,close[2] + fore * 4.5], look: close },
      { pos: [close[0] + side * 4.3,y + 1.72,close[2] + fore * 4.3], look: [close[0],close[1] + .02,close[2]] },
    ] } });
    send({ type: 'lantern-rig', pose: 'lift', seconds: .8 });
    jobs.push((function* () {
      if (!effects.duration?.('land_heavy')) return;
      yield* action({ type: 'play', actor: 'player', clip: 'land_heavy', fade: 0, time: .24, speed: .7 },3);
      const frame = Math.max(0,(effects.duration('interact') ?? 0) - .02);
      send({ type: 'play', actor: 'player', clip: 'interact', fade: .45, time: frame, speed: 0 });
      yield* wait(.45);
      send({ type: 'play', actor: 'player', clip: 'interact', fade: 0, time: frame, speed: 1 });
    })());
    yield* wait(.8);
    yield* until(() => effects.ready?.() ?? true,2.5);
    yield* wait(.15);
    send({ type: 'rig', pose: 'shoulder-transfer', seconds: 1.6 });
    const transfer = now;
    yield* wait(1.6 * .02);
    send({ type: 'play', actor: 'cat', clip: 'ride', fade: .6, loop: true });
    yield* wait(Math.max(transfer + 1.6 - now,0));
    send({ type: 'attach', actor: 'cat', to: 'shoulder' });
    yield* until(() => effects.ready?.() ?? true,2);
  }

  function stop(outcome: Outcome) {
    const current = active;
    if (!current) return false;
    active = undefined;
    current.detach();
    current.signal.abort();
    jobs.length = 0;
    effects.finish(outcome);
    return true;
  }
  return {
    get active() { return Boolean(active); },
    start(shrine: Shrine = lanternRest.shrine, { signal, carried = true }: { signal?: AbortSignal; carried?: boolean } = {}) {
      if (disposed || active || signal?.aborted || !carried) return false;
      now = 0;
      const controller = new AbortController();
      const abort = () => stop('cancelled');
      active = { signal: controller, detach: () => signal?.removeEventListener('abort',abort), scene: run(shrine) };
      signal?.addEventListener('abort',abort,{ once: true });
      try { effects.begin?.(controller.signal); } catch (error) { stop('failed'); throw error; }
      return !controller.signal.aborted;
    },
    step(delta: number) {
      if (!active || !Number.isFinite(delta) || delta <= 0) return;
      const current = active, pending = [...jobs];
      now += delta;
      try {
        if (current.scene.next().done) {
          if (active === current) stop('completed');
          return;
        }
        for (const job of pending) {
          if (active !== current) return;
          if (job.next().done) jobs.splice(jobs.indexOf(job),1);
        }
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
