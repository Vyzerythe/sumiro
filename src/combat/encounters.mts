export type CombatActorKind = 'wraith' | 'archer' | 'ronin';
type Point = readonly [x: number, z: number];
type Volume = ({ poly: readonly Point[] } | { circle: readonly [x: number, z: number, radius: number] }) & {
  yMin?: number;
  yMax?: number;
};

export interface EncounterActor {
  kind: CombatActorKind;
  x: number;
  z: number;
  heading: number;
  id?: string;
  y?: number;
  leash?: Volume;
  flag?: string;
}

export interface EncounterGate {
  group: string;
  startsOpen?: boolean;
  node?: string;
  lift?: number;
}

type CombatTempo = Readonly<{ windup: number; cooldown: number }>;
export interface EncounterDefinition {
  id: string;
  start: Volume;
  waves: readonly (readonly EncounterActor[])[];
  leash?: Volume;
  catHide?: readonly Point[];
  catPressure?: number;
  tempo?: CombatTempo;
  flag?: string;
  hint?: string;
  doors?: readonly EncounterGate[];
}

interface SwarmDefinition {
  id: string;
  line: readonly [readonly [number, number, number], readonly [number, number, number]];
  speed: number;
  radius: number;
  pause: number;
  reform: number;
  count: number;
}

export interface ChapterCombat {
  sword: boolean;
  catPressure: number;
  tempo: CombatTempo;
  encounters: readonly EncounterDefinition[];
  swarms?: readonly SwarmDefinition[];
}

const rectangle = (x1: number, z1: number, x2: number, z2: number): readonly Point[] => [[x1,z1], [x2,z1], [x2,z2], [x1,z2]];
const room = (x1: number, z1: number, x2: number, z2: number) => ({ poly: rectangle(x1, z1, x2, z2) });
const wraith = (x: number, z: number, heading = Math.PI, y?: number): EncounterActor =>
  ({ kind: 'wraith', x, z, heading, ...(y === undefined ? {} : { y }) });
const archer = (x: number, z: number, heading = Math.PI, overrides: Pick<EncounterActor, 'y' | 'leash'> = {}): EncounterActor =>
  ({ kind: 'archer', x, z, heading, ...overrides });

export const chapterCombat: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6, ChapterCombat | undefined>> = {
  1: undefined,
  2: { sword: true, catPressure: 0.3, tempo: { windup: 1.2, cooldown: 1.3 }, encounters: [
    { id: 'sword_wraith', start: room(4.6,-21.5,23.4,-36.9), waves: [[wraith(14,-33.5)]],
      leash: room(4.6,-15.6,23.4,-36.9), flag: 'ch2_sword_wraith', hint: 'Left mouse  strike.',
      catPressure: 0.1, catHide: [[6.4,-18.8],[21.4,-19.2]] },
    { id: 'ridge', start: { ...room(29,-213.6,37.5,-229), yMin: 38.9 },
      waves: [[wraith(28.4,-223.2,-Math.PI/2)], [wraith(27.6,-216.8,-Math.PI/2)]],
      leash: { poly: [[24.2,-212.6],[38.6,-213.6],[39.6,-228.2],[36,-228.6],[24.2,-225.6]] },
      flag: 'ch2_ridge', hint: 'Right mouse  parry, just as the blow lands.', catHide: [[38.2,-226.6],[38.4,-215.6]] },
  ] },
  3: { sword: true, catPressure: 0.5, tempo: { windup: 1.1, cooldown: 1.15 }, encounters: [
    { id: 'pines_first', start: { ...room(-17.5,-203.6,-14.2,-186.4), yMin: 23 },
      waves: [[wraith(-19.4,-199.6,-1.57), wraith(-19.4,-190.2,-1.57)]], leash: room(-20,-204,-6,-186),
      catHide: [[-7.2,-202.9]], flag: 'ch3_pines_first', hint: 'They come for the cat. Stand between them and it' },
    { id: 'pines_far', start: { ...room(-207.5,-204.2,-201,-194), yMin: 26 },
      waves: [[archer(-185.6,-199,1.57,{ y: 25, leash: room(-211,-214,-179,-192) })],
        [wraith(-209.4,-200.6,-1.57), wraith(-209.4,-195.6,-1.57)]],
      leash: room(-211,-214,-195.6,-192), catHide: [[-196.1,-200.2]], flag: 'ch3_pines_far',
      hint: "An archer who can't see you will aim for the cat" },
  ] },
  4: { sword: true, catPressure: 0.7, tempo: { windup: 1, cooldown: 1 }, encounters: [
    { id: 'mid_guard', start: room(22,-258,38,-252), waves: [[wraith(30,-263)]], leash: room(22,-268,38,-252),
      catHide: [[23,-252.9]], flag: 'ch4_mid_guard' },
    { id: 'top_guard', start: room(66,-282,92,-274), waves: [[wraith(73,-287), wraith(85,-287)]],
      leash: room(66,-292,92,-274), catHide: [[67.4,-275.4],[90.6,-275.4]], flag: 'ch4_top_guard' },
    { id: 'forecourt', start: room(20,-166,40,-154), doors: [{ group: 'fore_in', startsOpen: true }],
      waves: [[wraith(34,-160)]], leash: room(16,-170,44,-144),
      catHide: [[17.6,-145.6],[42.4,-145.6]], flag: 'ch4_forecourt' },
    { id: 'court1', start: room(20,-192,40,-181), doors: [{ group: 'c1_in', startsOpen: true }, { group: 'c1_out' }],
      waves: [[wraith(30,-193)], [wraith(22,-192), wraith(38,-192)]], leash: room(16,-200,44,-176),
      catHide: [[17.6,-177.6],[42.4,-177.6]], flag: 'ch4_court1',
      hint: 'They are quicker here. Parry as the blow falls, then strike' },
    { id: 'court2', start: room(68,-336,90,-324), doors: [{ group: 'c2_in', startsOpen: true }, { group: 'c2_out' }],
      waves: [[wraith(72,-339), wraith(86,-339)],
        [archer(79,-342.5), wraith(64.5,-339.5,-2.3), wraith(90.5,-341,2.3)]],
      leash: room(62,-344,96,-318), catHide: [[63.6,-319.6],[94.4,-319.6]], flag: 'ch4_court2' },
    { id: 'great', start: room(16,-440,44,-426), doors: [{ group: 'gc_in', startsOpen: true }],
      waves: [[wraith(22,-447), wraith(38,-447), archer(15.2,-442,-1.57,{ y: 64, leash: room(14.4,-452,52,-420) })],
        [wraith(24,-449.5), wraith(36,-449.5), wraith(30,-446.5), archer(44.8,-442,1.57,{ y: 64.8, leash: room(8,-452,45.6,-420) })]],
      leash: room(8,-452,52,-420), catHide: [[9.6,-421.6],[50.4,-421.6]], flag: 'ch4_great' },
    { id: 'hall', start: room(14,-486,46,-472), doors: [{ group: 'hall_in', startsOpen: true }, { group: 'hall_out' }],
      waves: [[wraith(24,-494), wraith(36,-494)], [archer(30,-505.5), wraith(19,-499,-2.6), wraith(41,-499,2.6)],
        [archer(13,-505.5), wraith(24,-500), wraith(36,-500), wraith(47,-503,2.6)]],
      leash: room(8,-508,52,-452), catHide: [[9.6,-453.6],[50.4,-453.6]], flag: 'ch4_hall' },
  ] },
  5: { sword: true, catPressure: 0.85, tempo: { windup: 0.95, cooldown: 0.9 }, encounters: [
    { id: 'raft_top', start: { ...room(22,-229,46,-219.5), yMin: 5.2 },
      waves: [[wraith(30,-233,2.8,6.2), wraith(39,-231,3.4,6.2)]],
      leash: room(21,-240,47,-218.5), catHide: [[23.5,-220.5],[44.5,-220.5]], flag: 'ch5_raft_top' },
    { id: 'last_rock', start: room(182,-586,201,-578),
      waves: [[wraith(186,-592,2.6), wraith(197,-592,-2.6)],
        [wraith(185,-596,2.6), wraith(198,-596,-2.6), archer(191.5,-600.5,3.14)]],
      leash: room(181,-602,202,-578), catHide: [[184,-580.5],[199,-580.5]], flag: 'ch5_last_rock' },
    { id: 'i5_archers', start: room(66,-332,75,-316), waves: [[archer(79,-326,-1.5,{ y: 3.6 })]],
      leash: { circle: [82,-325,9] }, catHide: [[78.4,-318.8],[82.5,-317.4]], flag: 'ch5_i5_archer' },
    { id: 'across', start: room(135.5,-394.5,143,-387.5),
      waves: [[archer(131,-402.6,3.14,{ y: 5.4 }), archer(145,-402.6,3.14,{ y: 5.4 })]],
      leash: { poly: [[104,-406.5],[146,-406.5],[146,-386],[134,-386],[134,-396.2],[144,-396.2],[144,-399.4],[104,-399.4]] },
      catHide: [[135.8,-388.4],[141.5,-388]], flag: 'ch5_across' },
    { id: 'far_archer', start: room(166,-540,183,-520), waves: [[archer(195,-533,1.57,{ y: 3.6 })]],
      leash: { circle: [193,-531,7] }, catHide: [[187.5,-527]], flag: 'ch5_far_archer' },
    { id: 'court', start: { circle: [125,-499,7] },
      doors: [{ group: 'court_in', node: 'court_door_in', lift: -4.9, startsOpen: true },
        { group: 'court_out', node: 'court_door_out', lift: -4.9 }],
      waves: [[wraith(118,-504,2.4), wraith(132,-504,-2.4)],
        [archer(125,-505.8,3.14), wraith(114.5,-500.5,2.4), wraith(135.5,-500.5,-2.4)],
        [wraith(118.5,-505,2.4), wraith(131.5,-505,-2.4), archer(125,-505.8,3.14)]],
      leash: { circle: [125,-499,13] }, catHide: [[118,-489],[132,-489]], flag: 'ch5_court' },
  ], swarms: [
    { id: 'causeway_crows', line: [[125,3.6,-414],[125,3.6,-456]], speed: 6, radius: 1.3, pause: 1.2, reform: 9, count: 40 },
    { id: 'barge_crows', line: [[172,4.7,-519],[172,4.7,-541]], speed: 4.5, radius: 1.3, pause: 1.4, reform: 10, count: 30 },
  ] },
  6: { sword: true, catPressure: 1, tempo: { windup: 0.9, cooldown: 0.8 }, encounters: [
    { id: 'rope', start: { ...room(-6,-327,6,-319), yMin: 45 }, waves: [[archer(-29.5,-328,-1.57,{ y: 52.2 })]],
      leash: room(-34,-332,-18,-314), catHide: [[-19.2,-330.6],[-19.2,-315.4]], flag: 'ch6_rope' },
    { id: 'cairn', start: { ...room(22,-296,40,-283), yMin: 36 },
      doors: [{ group: 'cairn_in', startsOpen: true }, { group: 'cairn_out' }],
      waves: [[wraith(26,-296,2.6), wraith(36,-296,-2.6)],
        [archer(31,-298.5,3.14), wraith(22,-294,2.4), wraith(39,-294,-2.4)]],
      leash: room(20,-304,42,-277), catHide: [[21,-281],[41,-281]], flag: 'ch6_cairn' },
    { id: 'gauntlet', start: { ...room(-146,-364,-112,-340), yMin: 69 },
      doors: [{ group: 'gaunt_in', startsOpen: true }, { group: 'gaunt_out' }],
      waves: [[wraith(-145,-346,-1.57), wraith(-146,-357,-1.57), archer(-150,-352,-1.57)],
        [archer(-149.5,-342,-1.57), archer(-150.5,-358.5,-1.57), wraith(-141,-351.5,-1.57), wraith(-145,-362,-1.2)],
        [wraith(-147,-348.5,-1.57), wraith(-146,-357,-1.57), wraith(-138.5,-345.5,-2.4), wraith(-141,-362.5,-1.2)]],
      leash: room(-156,-366,-104,-338), catHide: [[-130.4,-356.8]], flag: 'ch6_gauntlet' },
    { id: 'duel', hint: 'He knows your blade. K or Right mouse  parry as it falls, then strike',
      start: { circle: [-236,-350,6] }, doors: [{ group: 'duel_in', startsOpen: true }, { group: 'duel_out' }],
      waves: [[{ kind: 'ronin', id: 'ronin', x: -251, z: -350, heading: -1.57 }]],
      leash: { poly: Array.from({ length: 32 }, (_, index): Point => {
        const angle = 0.13 + index / 32 * Math.PI * 2;
        return [-243 + Math.cos(angle) * 16.7, -350 + Math.sin(angle) * 16.7];
      }) }, catPressure: 0, catHide: [[-231.4,-345.4]], flag: 'ch6_duel' },
  ], swarms: [
    { id: 'spine_crows', line: [[23,33.2,-238.5],[39,33.2,-238.5]], speed: 5, radius: 1.3, pause: 1.6, reform: 10, count: 30 },
    { id: 'stair_crows', line: [[-178.4,79.2,-360],[-178.4,79.2,-340]], speed: 6, radius: 1.3, pause: 1.4, reform: 10, count: 30 },
  ] },
};

export type EncounterState = 'idle' | 'fighting' | 'clear';
export interface EncounterPlayer { x: number; y: number; z: number; grounded: boolean }

export interface EncounterTicket {
  readonly encounter: string;
  readonly wave: number;
  readonly id: string;
}

export interface EncounterSpawn extends EncounterActor {
  id: string;
  encounter: string;
  leash: Volume;
  aggro: 99;
  riseTime: 0.9;
}

export type EncounterEvent =
  | { type: 'started' | 'clear'; id: string }
  | { type: 'wave'; id: string; wave: number }
  | { type: 'defeated'; id: string; ticket: EncounterTicket; actor: EncounterSpawn };

export interface EncounterEffects {
  spawn: (actor: EncounterSpawn, ticket: EncounterTicket) => (() => void) | void;
  hasFlag?: (flag: string) => boolean;
  setFlag?: (flag: string) => void;
  setGate?: (gate: EncounterGate, open: boolean, immediate: boolean) => void;
  onEvent?: (event: EncounterEvent) => void;
  cue?: (name: 'gate') => void;
  hint?: (text: string, ms: number) => void;
  hideCat?: (center: { x: number; z: number }, definition: EncounterDefinition, leash: Volume) => void;
  resolveWave?: (actors: readonly EncounterActor[], definition: EncounterDefinition, leash: Volume) => readonly EncounterActor[];
}

function contains(volume: Volume, player: EncounterPlayer) {
  const { x, y, z } = player;
  if (volume.yMin !== undefined && y < volume.yMin || volume.yMax !== undefined && y > volume.yMax) return false;
  if ('circle' in volume) return Math.hypot(x - volume.circle[0], z - volume.circle[1]) < volume.circle[2];
  let inside = false;
  let previous = volume.poly.at(-1);
  for (const [px, pz] of volume.poly) {
    if (previous && (pz > z) !== (previous[1] > z) && x < (previous[0] - px) * (z - pz) / (previous[1] - pz) + px) {
      inside = !inside;
    }
    previous = [px, pz];
  }
  return inside;
}

function expandedLeash(start: Volume): Volume {
  if ('circle' in start) return { circle: [start.circle[0], start.circle[1], start.circle[2] + 4] };
  const cx = start.poly.reduce((sum, point) => sum + point[0], 0) / start.poly.length;
  const cz = start.poly.reduce((sum, point) => sum + point[1], 0) / start.poly.length;
  return { poly: start.poly.map(([x, z]) => {
    const offset = Math.hypot(x - cx, z - cz) || 1;
    return [x + (x - cx) / offset * 4, z + (z - cz) / offset * 4];
  }) };
}

interface ActiveEncounter {
  def: EncounterDefinition;
  leash: Volume;
  state: EncounterState;
  wave: number;
  spawning: boolean;
  live: Map<EncounterTicket, EncounterSpawn>;
}

/** The actor adapter owns combat and visuals. It reports defeats using the issued ticket object. */
export function createEncounterController(definitions: readonly EncounterDefinition[], effects: EncounterEffects) {
  const encounters = new Map<string, ActiveEncounter>();
  const releases = new Map<EncounterTicket, () => void>();
  let nextId = 1;
  let disposed = false;
  let player: EncounterPlayer | undefined;

  function gates(encounter: ActiveEncounter, immediate = false) {
    for (const gate of encounter.def.doors ?? []) {
      effects.setGate?.(gate, encounter.state === 'clear' || encounter.state === 'idle' && !!gate.startsOpen, immediate);
    }
  }

  function release(ticket: EncounterTicket) {
    const cleanup = releases.get(ticket);
    releases.delete(ticket);
    cleanup?.();
  }

  function clearLive(encounter: ActiveEncounter) {
    const tickets = [...encounter.live.keys()];
    encounter.live.clear();
    tickets.forEach(release);
  }

  function spawnWave(encounter: ActiveEncounter) {
    const wave = encounter.def.waves[encounter.wave] ?? [];
    encounter.spawning = true;
    try {
      const actors = effects.resolveWave?.(wave, encounter.def, encounter.leash) ?? wave;
      for (const actor of actors) {
        if (disposed || encounter.state !== 'fighting') break;
        const id = actor.id ?? `${actor.kind}_${nextId++}`;
        if (actor.flag && effects.hasFlag?.(actor.flag)) continue;
        const y = actor.y ?? player?.y;
        const spawn: EncounterSpawn = { ...actor, id, ...(y === undefined ? {} : { y }),
          encounter: encounter.def.id, leash: actor.leash ?? encounter.leash, aggro: 99, riseTime: 0.9 };
        const ticket: EncounterTicket = { encounter: encounter.def.id, wave: encounter.wave, id };
        encounter.live.set(ticket, spawn);
        const cleanup = effects.spawn(spawn, ticket);
        if (cleanup) {
          if (encounter.live.has(ticket)) releases.set(ticket, cleanup);
          else cleanup();
        }
      }
    } catch (error) {
      if (!disposed) {
        encounter.state = 'idle';
        encounter.wave = 0;
        clearLive(encounter);
        gates(encounter, true);
      }
      throw error;
    } finally {
      encounter.spawning = false;
    }
  }

  function advance(encounter: ActiveEncounter) {
    while (encounter.state === 'fighting' && !encounter.spawning && encounter.live.size === 0) {
      const { def } = encounter;
      encounter.wave++;
      if (encounter.wave < def.waves.length) {
        spawnWave(encounter);
        if (encounter.state === 'fighting') effects.onEvent?.({ type: 'wave', id: def.id, wave: encounter.wave });
      } else {
        encounter.state = 'clear';
        if (def.flag) effects.setFlag?.(def.flag);
        gates(encounter);
        effects.cue?.('gate');
        effects.onEvent?.({ type: 'clear', id: def.id });
      }
    }
  }

  function start(id: string, at?: EncounterPlayer) {
    const encounter = encounters.get(id);
    if (disposed || !encounter || encounter.state !== 'idle') return false;
    if (at) player = at;
    const { def } = encounter;
    encounter.state = 'fighting';
    encounter.wave = 0;
    gates(encounter);
    effects.cue?.('gate');
    if (def.hint) effects.hint?.(def.hint, 5200);
    const first = def.waves[0] ?? [];
    if (first.length) effects.hideCat?.({
      x: first.reduce((sum, actor) => sum + actor.x, 0) / first.length,
      z: first.reduce((sum, actor) => sum + actor.z, 0) / first.length,
    }, def, encounter.leash);
    spawnWave(encounter);
    if (encounter.state === 'fighting') effects.onEvent?.({ type: 'started', id });
    advance(encounter);
    return true;
  }

  function defeat(ticket: EncounterTicket) {
    const encounter = encounters.get(ticket.encounter);
    const actor = encounter?.live.get(ticket);
    if (!encounter || !actor) return false;
    encounter.live.delete(ticket);
    if (actor.flag) effects.setFlag?.(actor.flag);
    effects.onEvent?.({ type: 'defeated', id: encounter.def.id, actor, ticket });
    release(ticket);
    advance(encounter);
    return true;
  }

  function reset() {
    if (disposed) return;
    player = undefined;
    for (const encounter of encounters.values()) {
      encounter.state = 'idle';
      clearLive(encounter);
      encounter.state = encounter.def.flag && effects.hasFlag?.(encounter.def.flag) ? 'clear' : 'idle';
      encounter.wave = 0;
      gates(encounter, true);
    }
  }

  for (const def of definitions) {
    encounters.set(def.id, { def, leash: def.leash ?? expandedLeash(def.start), state: 'idle',
      wave: 0, spawning: false, live: new Map() });
  }
  reset();
  return {
    state: (id: string) => encounters.get(id)?.state,
    fighting: (id?: string) => [...encounters.values()].some(encounter => encounter.state === 'fighting' && (!id || encounter.def.id === id)),
    step(at: EncounterPlayer | undefined, playing = true) {
      if (disposed) return;
      player = at;
      if (!playing || !at?.grounded) return;
      for (const { def } of encounters.values()) if (contains(def.start, at)) start(def.id);
    },
    start,
    defeat,
    reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const encounter of encounters.values()) encounter.live.clear();
      encounters.clear();
      for (const ticket of releases.keys()) release(ticket);
    },
  };
}
