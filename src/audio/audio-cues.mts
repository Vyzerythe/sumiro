/** Cue recipes from Ee, De, ke and the native audio/index.json chapter tracks. */
import type { AssetManager } from '../assets/asset-manager.mts';
import type { AudioMixer } from './audio-mixer.mts';
import { gameplayCueTrims, isGameplayCue, scheduleGameplayCue,
  type CueFilter, type CueOffset, type CueSynth, type GameplayCue, type GameplayCueOptions,
} from './gameplay-cue-recipes.mts';

type EffectCue = 'shrine' | 'scroll' | 'gate';
export type AudioCue = 'chapter' | 'credits' | EffectCue | 'story' | GameplayCue;

export interface AudioCuesOptions {
  mixer: Pick<AudioMixer, 'context' | 'buses'>;
  assets: Pick<AssetManager, 'loadJSON' | 'loadArrayBuffer'>;
  seed?: number;
  reportError?(cue: AudioCue, error: unknown): void;
}

interface Playback {
  context: AudioContext;
  effects: GainNode;
  music: GainNode;
}

interface Voice {
  stop(): void;
}

interface ChapterRequest {
  id: string;
  controller: AbortController;
  task?: Promise<boolean>;
  prepared?: { context: AudioContext; track: Record<string, unknown>; buffer: AudioBuffer };
}

interface Tone {
  frequency: number;
  endFrequency?: number;
  sweep?: number;
  db: number;
  decay: number;
  attack?: number;
  duration?: number;
}

const gainFromDb = (db: number) => 10 ** (db / 20);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function trackGain(track: Record<string, unknown>) {
  const directGain = finite(track.gainDb, NaN);
  if (Number.isFinite(directGain)) return gainFromDb(directGain);
  const lufs = finite(track.lufs, NaN);
  const compensation = (Number.isFinite(lufs) ? -26 - lufs : -8) + finite(track.speakerDb, 0);
  const capped = Math.min(compensation, -1 - finite(track.truePeak, -Infinity));
  return gainFromDb(Math.max(-24, Math.min(12, capped)) + finite(track.trimDb, 0));
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 1831565813) | 0;
    let bits = Math.imul(state ^ state >>> 15, 1 | state);
    bits = bits + Math.imul(bits ^ bits >>> 7, 61 | bits) ^ bits;
    return ((bits ^ bits >>> 14) >>> 0) / 4294967296;
  };
}

/** Plays owned voices on an existing mixer without opening or resuming its context. */
export function createAudioCues({ mixer, assets, seed = 1, reportError }: AudioCuesOptions) {
  const lifetime = new AbortController();
  const voices = new Set<Voice>();
  const scopedVoices = new Map<AbortSignal, { voices: Set<Voice>; abort(): void }>();
  const random = seededRandom(seed);
  const trims = new Map<GameplayCue, GainNode>();
  let noise: { context: AudioContext; buffer: AudioBuffer } | undefined;
  let index: Promise<unknown> | undefined;
  let pending: ChapterRequest | undefined;
  let chapter: { id: string; voice: Voice } | undefined;

  function report(cue: AudioCue, error: unknown) {
    try { reportError?.(cue, error); } catch { /* Reporting does not own a voice. */ }
  }

  function playback(): Playback | undefined {
    const { context, buses } = mixer;
    if (lifetime.signal.aborted || context?.state !== 'running' || !buses) return;
    return { context, effects: buses.effects, music: buses.music };
  }

  function bindVoice(signal: AbortSignal, voice: Voice) {
    let group = scopedVoices.get(signal);
    if (!group) {
      const voices = new Set<Voice>();
      group = { voices, abort() { for (const voice of voices) voice.stop(); } };
      scopedVoices.set(signal, group);
      signal.addEventListener('abort', group.abort, { once: true });
    }
    group.voices.add(voice);
    const scope = group;
    return () => {
      scope.voices.delete(voice);
      if (scope.voices.size) return;
      signal.removeEventListener('abort', scope.abort);
      scopedVoices.delete(signal);
    };
  }

  function startVoice(
    cue: AudioCue, source: AudioScheduledSourceNode, nodes: readonly AudioNode[],
    destination: AudioNode, start: () => void, end?: number, signal?: AbortSignal,
  ): Voice {
    const allocated = [source, ...nodes];
    const voice = { stop: () => release(true) };
    let unlink: (() => void) | undefined;
    function release(stop: boolean) {
      if (!voices.delete(voice)) return;
      unlink?.();
      source.onended = null;
      if (stop) {
        try { source.stop(); } catch { /* A failed start or closed context may have ended it. */ }
      }
      for (const node of allocated) {
        try { node.disconnect(); } catch (error) { report(cue, error); }
      }
      if (chapter?.voice === voice) chapter = undefined;
    }
    voices.add(voice);
    source.onended = () => release(false);
    try {
      signal?.throwIfAborted();
      if (signal) unlink = bindVoice(signal, voice);
      let previous: AudioNode = source;
      for (const node of nodes) {
        previous.connect(node);
        previous = node;
      }
      previous.connect(destination);
      start();
      if (end !== undefined) source.stop(end);
      return voice;
    } catch (error) {
      release(true);
      throw error;
    }
  }

  function envelope(context: AudioContext, when: number, db: number, attack: number) {
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(gainFromDb(db), when + attack);
    return gain;
  }

  function tone(cue: AudioCue, { context, effects }: Playback, when: number, parameters: Tone, signal?: AbortSignal) {
    const { frequency, endFrequency, sweep = 0.03, db, decay, attack = .001, duration = attack + decay * 7 } = parameters;
    const source = context.createOscillator();
    source.type = 'sine';
    source.frequency.setValueAtTime(frequency, when);
    if (endFrequency !== undefined) source.frequency.exponentialRampToValueAtTime(endFrequency, when + sweep);
    const gain = envelope(context, when, db, attack);
    gain.gain.setTargetAtTime(0, when + attack, decay);
    startVoice(cue, source, [gain], effects, () => source.start(when), when + duration, signal);
  }

  function noiseBuffer(context: AudioContext) {
    if (noise?.context !== context) {
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let index = 0; index < samples.length; index++) samples[index] = random() * 2 - 1;
      noise = { context, buffer };
    }
    return noise.buffer;
  }

  function noiseVoice(
    cue: AudioCue, { context, effects }: Playback, when: number, duration: number,
    filters: readonly CueFilter[], gain: GainNode, flutterHz = 0, signal?: AbortSignal,
  ) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer(context);
    source.loop = duration > 1.5;
    const nodes: AudioNode[] = filters.map(spec => {
      const filter = context.createBiquadFilter();
      filter.type = spec.type;
      filter.frequency.value = spec.frequency;
      filter.Q.value = spec.q ?? 0.7;
      filter.gain.value = spec.gain ?? 0;
      return filter;
    });
    if (flutterHz > 0) {
      const flutter = context.createGain();
      const curve = new Float32Array(Math.max(2, Math.ceil(duration * flutterHz * 2)));
      for (let index = 0; index < curve.length; index++) {
        curve[index] = index % 2 ? 0.35 + random() * 0.25 : 0.8 + random() * 0.2;
      }
      flutter.gain.setValueCurveAtTime(curve, Math.max(when, context.currentTime + 0.012), duration);
      nodes.push(flutter);
    }
    nodes.push(gain);
    const offset = random() * (source.loop ? source.buffer.duration : source.buffer.duration - duration);
    startVoice(cue, source, nodes, effects, () => source.start(when, offset), when + duration, signal);
  }

  function burst(cue: AudioCue, output: Playback, when: number, db: number, decay: number, filters: readonly CueFilter[],
    attack = .001, duration = attack + decay * 7, signal?: AbortSignal) {
    const gain = envelope(output.context, when, db, attack);
    gain.gain.setTargetAtTime(0, when + attack, decay);
    noiseVoice(cue, output, when, duration, filters, gain, 0, signal);
  }

  function rustle(
    cue: AudioCue, output: Playback, when: number, filters: readonly CueFilter[],
    { db, attack, hold, decay, flutter }: { db: number; attack: number; hold: number; decay: number; flutter: number },
    signal?: AbortSignal,
  ) {
    const gain = envelope(output.context, when, db, attack);
    gain.gain.setValueAtTime(gainFromDb(db), when + attack + hold);
    gain.gain.linearRampToValueAtTime(0, when + attack + hold + decay);
    noiseVoice(cue, output, when, attack + hold + decay + 0.05, filters, gain, flutter, signal);
  }

  function playEffect(cue: EffectCue, output: Playback) {
    const now = output.context.currentTime;
    switch (cue) {
      case 'shrine':
        for (const [frequency, db] of [[392, -28], [393.4, -32], [784.5, -38], [1176, -46]] as const) {
          tone(cue, output, now, { frequency, db, decay: 0.9, attack: 0.006, duration: 3.2 });
        }
        burst(cue, output, now, -28, 0.01, [{ type: 'bandpass', frequency: 2200, q: 1 }], .001, 0.03);
        break;
      case 'scroll':
        rustle(cue, output, now, [{ type: 'highpass', frequency: 2600 }],
          { db: -26, attack: 0.06, hold: 0.1, decay: 0.3, flutter: 34 });
        tone(cue, output, now + 0.12, { frequency: 1046, db: -34, decay: 0.5, attack: 0.008, duration: 1.8 });
        tone(cue, output, now + 0.3, { frequency: 1568, db: -38, decay: 0.5, attack: 0.008, duration: 1.8 });
        break;
      case 'gate':
        tone(cue, output, now, { frequency: 62, endFrequency: 49, sweep: 1.6, db: -20, decay: 0.9, attack: 0.15, duration: 3 });
        rustle(cue, output, now, [{ type: 'bandpass', frequency: 320, q: 1.2 }],
          { db: -22, attack: 0.4, hold: 0.5, decay: 1.1, flutter: 7 });
        burst(cue, output, now + 1.1, -18, 0.03, [{ type: 'bandpass', frequency: 500, q: 0.7 }]);
        break;
    }
  }

  function playGameplay(name: string, options: GameplayCueOptions = {}): boolean {
    const output = playback();
    if (!output || options.signal?.aborted || !isGameplayCue(name)) return false;
    const { context } = output;
    const now = context.currentTime;
    const { signal } = options;
    // Preserve the addition order of repeated intervals in the original.
    const atTime = (offset: CueOffset) => typeof offset === 'number' ? now + offset : offset.reduce((time, gap) => time + gap, now);
    try {
      // The shipped kit generates the complete noise bed before consuming
      // randomness for any swings, flutter envelopes or buffer offsets.
      noiseBuffer(context);
      const trim = gameplayCueTrims[name];
      if (trim !== undefined) {
        let gain = trims.get(name);
        if (!gain) {
          gain = context.createGain();
          gain.gain.value = gainFromDb(trim);
          gain.connect(output.effects);
          trims.set(name, gain);
        }
        output.effects = gain;
      }
      const synth: CueSynth = {
        random,
        tone: (at, frequency, db, decay, parameters) =>
          tone(name, output, atTime(at), { frequency, db, decay, ...parameters }, signal),
        burst: (at, db, decay, filters, parameters) =>
          burst(name, output, atTime(at), db, decay, filters, parameters?.attack, parameters?.duration, signal),
        rustle: (at, db, [attack, hold, decay], filters, flutter = 0) =>
          rustle(name, output, now + at, filters, { db, attack, hold, decay, flutter }, signal),
        sweepNoise(at, { from, peak, to, seconds, db, q }) {
          const when = now + at;
          const source = context.createBufferSource();
          source.buffer = noiseBuffer(context);
          const filter = context.createBiquadFilter();
          filter.type = 'bandpass';
          filter.Q.value = q;
          filter.frequency.setValueAtTime(from, when);
          filter.frequency.exponentialRampToValueAtTime(peak, when + seconds * .45);
          filter.frequency.exponentialRampToValueAtTime(to, when + seconds);
          const gain = envelope(context, when, db, seconds * .4);
          gain.gain.linearRampToValueAtTime(0, when + seconds);
          const duration = seconds + .02;
          const offset = random() * (source.buffer.duration - duration);
          startVoice(name, source, [filter, gain], output.effects, () => source.start(when, offset), when + duration, signal);
        },
      };
      scheduleGameplayCue(name, synth, options);
      return true;
    } catch (error) {
      report(name, error);
      return false;
    }
  }

  function playRecording(path: string, bus: 'voice' | 'effects', signal: AbortSignal, db = 0) {
    const output = playback();
    const destination = mixer.buses?.[bus];
    let duration: number | undefined;
    if (output && destination && !signal.aborted) {
      const { context } = output;
      const active = AbortSignal.any([signal, lifetime.signal]);
      void assets.loadArrayBuffer(path, { signal: active }).then(bytes => context.decodeAudioData(bytes)).then(buffer => {
        if (active.aborted || context.state !== 'running') return;
        duration = buffer.duration;
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = gainFromDb(db);
        startVoice('story', source, [gain], destination, () => source.start(), undefined, active);
      }).catch(error => { if (!active.aborted) report('story', error); });
    }
    return { duration: () => duration };
  }

  async function prepareChapter(request: ChapterRequest, context: AudioContext) {
    const signal = request.controller.signal;
    index ??= assets.loadJSON('audio/index.json', { signal: lifetime.signal }).catch(error => { index = undefined; throw error; });
    const manifest = record(await index);
    signal.throwIfAborted();
    const track = record(record(manifest?.music)?.[request.id]);
    const url = track?.url;
    if (!track || typeof url !== 'string' || !/^assets\/audio\/music\/[\w.-]+\.ogg$/.test(url)) {
      throw Error(`Chapter track ${request.id} is missing from audio/index.json`);
    }
    const bytes = await assets.loadArrayBuffer(url.slice('assets/'.length), { signal });
    signal.throwIfAborted();
    const buffer = await context.decodeAudioData(bytes);
    signal.throwIfAborted();
    return { context, track, buffer };
  }

  function startChapter(request: ChapterRequest, { context, music }: Playback, track: Record<string, unknown>, buffer: AudioBuffer) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    const end = Math.min(buffer.duration, finite(track.loopEnd, buffer.duration));
    const start = finite(track.loopStart, 0);
    source.loopEnd = end > 0 ? end : buffer.duration;
    source.loopStart = start >= 0 && start < source.loopEnd - 0.05 ? start : 0;
    source.loop = track.loop !== false && source.loopEnd - source.loopStart > 0.5;
    const gain = context.createGain();
    const when = context.currentTime + 0.025;
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(trackGain(track), when, 1);
    const voice = startVoice('chapter', source, [gain], music, () => source.start(when, 0));
    chapter?.voice.stop();
    chapter = { id: request.id, voice };
  }

  function update(): Promise<boolean> {
    const request = pending;
    const output = playback();
    if (!request || !output) return Promise.resolve(false);
    if (request.task) return request.task;
    const { signal } = request.controller;
    let abort!: () => void;
    const cancellation = new Promise<false>(resolve => {
      abort = () => resolve(false);
      signal.addEventListener('abort', abort, { once: true });
    });
    const task = async () => {
      if (request.prepared?.context !== output.context) request.prepared = await prepareChapter(request, output.context);
      signal.throwIfAborted();
      const ready = playback();
      if (ready?.context !== request.prepared.context) return false;
      startChapter(request, ready, request.prepared.track, request.prepared.buffer);
      pending = undefined;
      return true;
    };
    request.task = Promise.race([task(), cancellation]).catch(error => {
      if (!signal.aborted) {
        pending = undefined;
        report('chapter', error);
      }
      return false;
    }).finally(() => {
      signal.removeEventListener('abort', abort);
      delete request.task;
    });
    return request.task;
  }

  return {
    async play(cue: 'chapter' | 'credits' | EffectCue, chapterId = 'ch1_climb'): Promise<boolean> {
      if (lifetime.signal.aborted) return false;
      if (cue === 'chapter' || cue === 'credits') {
        const id = cue === 'credits' ? cue : /^ch[1-6](?=_|$)/.exec(chapterId)?.[0];
        if (!id) return false;
        if (pending?.id !== id) {
          pending?.controller.abort();
          pending = undefined;
          if (chapter?.id === id) return true;
          pending = { id, controller: new AbortController() };
        }
        return update();
      }
      const output = playback();
      if (!output) return false;
      try { playEffect(cue, output); return true; } catch (error) { report(cue, error); return false; }
    },
    playRecording, playGameplay,
    /** Schedules the latest chapter request when the existing mixer is running. */
    update,
    dispose() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      pending?.controller.abort();
      pending = undefined;
      for (const voice of voices) voice.stop();
      for (const trim of trims.values()) {
        try { trim.disconnect(); } catch (error) { report('story', error); }
      }
      trims.clear();
      index = noise = undefined;
    },
  };
}
