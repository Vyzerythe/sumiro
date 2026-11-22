/** Encounter and companion dialogue recovered from the published chapter and cutscene modules. */
import type { StorySceneHandle } from './story-scenes.mts';

interface Dialogue { speaker: 'samurai'; voice: string; parts: readonly string[] }
type Position = Readonly<{ x: number; z: number }>;
type BarkCue = 'catMewSoft' | 'catMeow';
type Flag = 'cat_found' | 'inkStep' | 'ch2_sword_wraith';
interface QuietBeat {
  id: string;
  chapter: string;
  after: number;
  flags?: readonly Flag[];
  cue?: BarkCue;
  line: Dialogue;
}

export const quietStoryBeats: readonly QuietBeat[] = [
  { id: 'hunted', chapter: 'ch1_climb', after: 1.5, flags: ['cat_found', 'inkStep'], line: {
    speaker: 'samurai', voice: 'ch1_hunted', parts: [
      "That ink in your fur is theirs. They hunted you, didn't they?",
      'For that white coat. All the way down the mountain.',
    ],
  } },
  { id: 'fur', chapter: 'ch2_pass', after: 1.2, flags: ['ch2_sword_wraith'], line: {
    speaker: 'samurai', voice: 'ch2_fur', parts: ["It's your fur they want. They'll have to come through me."],
  } },
  { id: 'home_far', chapter: 'ch4_temple', after: 4, cue: 'catMewSoft', line: {
    speaker: 'samurai', voice: 'ch4_home', parts: [
      'A mountain cat belongs up high.', "Home is the last peak, isn't it? Then we keep climbing.",
    ],
  } },
  { id: 'closer', chapter: 'ch5_sea', after: 4, line: {
    speaker: 'samurai', voice: 'ch5_closer', parts: ['The nearer we come to your mountain, the harder they come. Hold on.'],
  } },
  { id: 'home_near', chapter: 'ch6_summit', after: 4, cue: 'catMeow', line: {
    speaker: 'samurai', voice: 'ch6_near', parts: ["Snow. This is your home, isn't it?", "Your family can't be far now."],
  } },
];

export const swordReveal = {
  chapter: 'ch2_pass', encounter: 'sword_wraith',
  line: { speaker: 'samurai', voice: 'ch2_stay_behind', parts: ['Stay behind me.'] },
  clearHint: { text: 'The door has a bell beside it. The sword rings it', ms: 5000 },
} as const;

export const lanternRest = {
  id: 'lantern_rest', chapter: 'ch3_pines', seen: 'story_lantern', radius: 3.5,
  shrine: { id: 'pines_1', x: -11, z: -201, heading: 2.2, stand: { x: -11, z: -197.6, heading: 1.57 } },
  line: { speaker: 'samurai', voice: 'ch3_rest', parts: ['Warm, is it? Rest a moment.'] },
} as const;

export interface StoryBeatFrame {
  playing: boolean;
  story?: boolean;
  sceneActive?: boolean;
  subtitleActive?: boolean;
  fighting?: boolean;
  player?: Position;
  cat?: Readonly<{ carried: boolean; found: boolean; fighting?: boolean; position?: Position }>;
}

export interface StoryBeatEffects {
  hasFlag?(flag: Flag): boolean;
  hasSeen?(key: string): boolean;
  markSeen?(key: string): void;
  voice?(line: Dialogue, signal: AbortSignal): StorySceneHandle | void;
  sound?(cue: BarkCue, signal: AbortSignal): void;
  subtitle?(line: { text: string; speaker: Dialogue['speaker']; ms: number; voice: string | null } | null): void;
  hint?(text: string, ms: number): void;
  startLanternRest?(shrine: typeof lanternRest.shrine): void;
}

const gap = .15;
const duration = (text: string) => Math.max(1.8, .8 + text.length / 15);
function subtitleBoundaries(parts: readonly string[], spoken: number | undefined, aside: boolean) {
  const nominal = parts.map(duration);
  const sum = nominal.reduce((a, b) => a + b, 0);
  const boundaries = [0];
  let elapsed = 0;
  for (const [index, time] of nominal.entries()) {
    elapsed += spoken ? Math.max(1.2, spoken * time / sum) : time + (aside && index < nominal.length - 1 ? gap : 0);
    boundaries.push(elapsed);
  }
  if (spoken) boundaries[boundaries.length - 1] = Math.max(elapsed, spoken) + .3;
  return boundaries;
}

function catAvailable({ cat, player }: StoryBeatFrame): boolean {
  if (!cat || cat.carried) return true;
  return Boolean(cat.found && !cat.fighting && cat.position && player &&
    Math.hypot(cat.position.x - player.x, cat.position.z - player.z) <= 4);
}

interface ActiveDialogue {
  controller: AbortController;
  line: Dialogue;
  aside: boolean;
  elapsed: number;
  card: number;
  spoken: number | undefined;
  voice: StorySceneHandle | void;
  started: boolean;
}

export function createStoryBeats(effects: StoryBeatEffects) {
  const visited = new Set<string>();
  let chapter: string | undefined;
  let quiet = 0;
  let swordLineSaid = false;
  let lanternPending = false;
  let disposed = false;
  let active: ActiveDialogue | undefined;

  const seen = (key: string) => visited.has(key) || effects.hasSeen?.(key);
  function mark(key: string) {
    visited.add(key);
    effects.markSeen?.(key);
  }

  function releaseDialogue() {
    const line = active;
    active = undefined;
    line?.controller.abort();
    if (line && line.card >= 0) effects.subtitle?.(null);
  }

  function begin(line: Dialogue, aside: boolean, cue?: BarkCue) {
    releaseDialogue();
    const controller = new AbortController();
    active = { controller, line, aside, elapsed: cue ? -.7 : 0, card: -1,
      spoken: undefined, voice: undefined, started: false };
    if (cue) effects.sound?.(cue, controller.signal);
    if (!aside) advanceDialogue(0);
  }

  function advanceDialogue(delta: number) {
    const playing = active;
    if (!playing) return;
    playing.elapsed += delta;
    if (playing.elapsed < 0) return;
    const { line } = playing;
    if (!playing.started) {
      playing.started = true;
      playing.voice = effects.voice?.(line, playing.controller.signal);
    }
    if (active !== playing) return;
    const observed = playing.voice?.duration?.();
    const spoken = observed !== undefined && observed > 0 && Number.isFinite(observed) ? observed : undefined;
    const boundaries = playing.aside ? subtitleBoundaries(line.parts, spoken, true)
      : [0, spoken ? Math.max(spoken + .3, 1.8) : duration(line.parts[0] ?? '')];
    let card = 0;
    while (card < line.parts.length && playing.elapsed >= boundaries[card + 1]!) card++;
    if (card >= line.parts.length) {
      if (playing.voice?.done?.() === false && playing.elapsed < Math.max(14, boundaries.at(-1)!)) return;
      releaseDialogue();
      return;
    }
    if (card === playing.card && spoken === playing.spoken) return;
    playing.card = card;
    playing.spoken = spoken;
    const remaining = boundaries[card + 1]! - playing.elapsed - (playing.aside && card < line.parts.length - 1 ? gap : 0);
    effects.subtitle?.({ text: line.parts[card]!, speaker: line.speaker, ms: Math.max(.1, remaining) * 1000,
      voice: card === 0 ? line.voice : null });
  }

  function enter(next: string) {
    if (disposed) return;
    releaseDialogue();
    chapter = next;
    quiet = 0;
    swordLineSaid = false;
    lanternPending = false;
  }

  function onEncounter(type: 'started' | 'clear', id: string) {
    if (disposed || chapter !== swordReveal.chapter || id !== swordReveal.encounter) return false;
    if (type === 'clear') {
      effects.hint?.(swordReveal.clearHint.text, swordReveal.clearHint.ms);
      return true;
    }
    if (swordLineSaid) return false;
    swordLineSaid = true;
    begin(swordReveal.line, false);
    return true;
  }

  function onShrine(player: Position | undefined, story = true) {
    if (disposed || chapter !== lanternRest.chapter || !story || !player || seen(lanternRest.seen) ||
        Math.hypot(player.x - lanternRest.shrine.x, player.z - lanternRest.shrine.z) > lanternRest.radius) return false;
    if (!effects.startLanternRest) return false;
    mark(lanternRest.seen);
    lanternPending = true;
    return true;
  }

  function step(delta: number, frame: StoryBeatFrame) {
    if (disposed || !Number.isFinite(delta) || delta <= 0 || !chapter) return;
    const canPlay = frame.playing && !frame.sceneActive;
    if (lanternPending && canPlay && frame.story !== false) {
      lanternPending = false;
      releaseDialogue();
      effects.startLanternRest?.(lanternRest.shrine);
      return;
    }
    if (active) {
      if (!canPlay || frame.story === false && active.aside) releaseDialogue();
      else advanceDialogue(delta);
      return;
    }
    if (frame.story === false) return;
    const target = quietStoryBeats.find(beat => beat.chapter === chapter && !seen(`story_${beat.id}`) &&
      (!beat.flags || beat.flags.every(flag => effects.hasFlag?.(flag))));
    const eligible = target && canPlay && !frame.subtitleActive && !frame.fighting && catAvailable(frame);
    quiet = eligible ? quiet + delta : 0;
    if (!target || quiet < target.after) return;
    quiet = 0;
    mark(`story_${target.id}`);
    begin(target.line, true, target.cue);
  }

  return {
    get activeVoice() { return active?.line.voice ?? null; },
    get quietTime() { return quiet; },
    enter, step, onEncounter, onShrine,
    dispose() {
      disposed = true;
      releaseDialogue();
      lanternPending = false;
    },
  };
}
