/**
 * Shared gain, duck and unlock contracts from Yt, U, Qt, Ln and Dn.attach in
 * sumiro/bundle/audio-ByKsc24o.js (Git blob e67f92f0aa085c6157c2d710fcf0bdd60bb84623).
 */
import { defaultOptions } from '../domain/save.mts';
import type { RunOptions } from '../domain/save.mts';

const VOLUME_CHANNELS = ['master', 'music', 'ambience', 'effects', 'voice'] as const;
type AudioVolume = (typeof VOLUME_CHANNELS)[number];
export type AudioVolumes = Pick<RunOptions, AudioVolume>;
export type AudioBus = Exclude<AudioVolume, 'master'> | 'proceduralMusic';

const VOLUME_TRIMS: Readonly<AudioVolumes> = {
  master: 1, music: 0.6, ambience: 0.8, effects: 0.85, voice: Math.sqrt(0.07),
};
const OUTPUT_GAIN = 10 ** (-5 / 20);
const DUCK_GAIN = 0.1;
const VOLUME_TIME_CONSTANT = 0.04;
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;
const UNLOCK_LISTENER_OPTIONS = { capture: true, passive: true };

export interface AudioMixerNode {
  connect(destination: AudioMixerNode): unknown;
  disconnect(): void;
}

interface MixerParam {
  value: number;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
}

export interface AudioMixerGainNode extends AudioMixerNode {
  readonly gain: MixerParam;
}

interface MixerFilter extends AudioMixerNode {
  type: BiquadFilterType;
  readonly frequency: Pick<AudioParam, 'value'>;
  readonly Q: Pick<AudioParam, 'value'>;
}

interface MixerCompressor extends AudioMixerNode {
  readonly threshold: Pick<AudioParam, 'value'>;
  readonly ratio: Pick<AudioParam, 'value'>;
  readonly knee: Pick<AudioParam, 'value'>;
  readonly attack: Pick<AudioParam, 'value'>;
  readonly release: Pick<AudioParam, 'value'>;
}

/** The methods and parameters the mixer needs from Web Audio. */
export interface AudioMixerContext {
  readonly state: AudioContextState;
  readonly currentTime: number;
  readonly destination: AudioMixerNode;
  createGain(): AudioMixerGainNode;
  createBiquadFilter(): MixerFilter;
  createDynamicsCompressor(): MixerCompressor;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

export interface AudioMixerOptions<Context extends AudioMixerContext = AudioContext> {
  /** Supply a new context owned by this mixer. Called synchronously on first unlock. */
  createContext(): Context;
  gestureTarget?: EventTarget;
  visibilityTarget?: EventTarget & Pick<Document, 'hidden'>;
  volumes?: Partial<AudioVolumes>;
}

type Buses<Context extends AudioMixerContext> = Readonly<Record<AudioBus, ReturnType<Context['createGain']>>>;

export interface AudioMixer<Context extends AudioMixerContext = AudioContext> {
  readonly context: Context | null;
  readonly buses: Buses<Context> | null;
  /** Returns whether playback is running. A failed resume can be retried. */
  unlock(): Promise<boolean>;
  setVolume(channel: AudioVolume, value: number): void;
  setVolumes(values: Partial<AudioVolumes>): void;
  setMuted(muted: boolean): void;
  setDucked(ducked: boolean): void;
  /** Target linear gain through the bus, master and output trim, before EQ and compression. */
  getEffectiveGain(bus: AudioBus): number;
  dispose(): Promise<void>;
}

interface MixerGraph {
  context: AudioMixerContext;
  nodes: AudioMixerNode[];
  buses: Buses<AudioMixerContext>;
  master: AudioMixerGainNode;
  duck: AudioMixerGainNode;
}

function normalizeVolume(channel: AudioVolume, value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : defaultOptions[channel];
}

function buildGraph(context: AudioMixerContext, nodes: AudioMixerNode[]): MixerGraph {
  const own = <Node extends AudioMixerNode,>(node: Node): Node => {
    nodes.push(node);
    return node;
  };
  const master = own(context.createGain());
  const duck = own(context.createGain());
  const buses = {
    music: own(context.createGain()),
    proceduralMusic: own(context.createGain()),
    ambience: own(context.createGain()),
    effects: own(context.createGain()),
    voice: own(context.createGain()),
  };
  const output = own(context.createGain());
  output.gain.value = OUTPUT_GAIN;
  const filter = own(context.createBiquadFilter());
  filter.type = 'lowpass';
  filter.frequency.value = 15_000;
  filter.Q.value = 0.7;
  const compressor = own(context.createDynamicsCompressor());
  compressor.threshold.value = -18;
  compressor.ratio.value = 2.5;
  compressor.knee.value = 6;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.2;

  buses.proceduralMusic.connect(duck);
  buses.ambience.connect(duck);
  buses.effects.connect(duck);
  buses.music.connect(master);
  buses.voice.connect(master);
  duck.connect(master);
  master.connect(output);
  output.connect(filter);
  filter.connect(compressor);
  compressor.connect(context.destination);
  return { context, nodes, buses, master, duck };
}

async function releaseGraph(context: AudioMixerContext, nodes: AudioMixerNode[]): Promise<void> {
  const errors: unknown[] = [];
  for (const node of nodes.reverse()) {
    try { node.disconnect(); } catch (error) { errors.push(error); }
  }
  nodes.length = 0;
  if (context.state !== 'closed') {
    try { await context.close(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Audio mixer cleanup failed');
}

export function createAudioMixer<Context extends AudioMixerContext>(options: AudioMixerOptions<Context>): AudioMixer<Context>;
export function createAudioMixer({
  createContext, gestureTarget, visibilityTarget, volumes: initialVolumes = {},
}: AudioMixerOptions<AudioMixerContext>): AudioMixer<AudioMixerContext> {
  const volumes: AudioVolumes = { ...defaultOptions };
  let graph: MixerGraph | undefined;
  let rollingBack: Promise<void> | undefined;
  let transition: Promise<boolean> | undefined;
  let cancelTransition: (() => void) | undefined;
  let disposal: Promise<void> | undefined;
  let listeningForGesture = gestureTarget !== undefined;
  let muted = false;
  let ducked = false;
  const targets = new WeakMap<MixerParam, number>();

  setVolumes(initialVolumes);

  function volumeGain(channel: AudioVolume) {
    const level = volumes[channel] * VOLUME_TRIMS[channel];
    return level * level;
  }

  const masterGain = () => muted ? 0 : volumeGain('master');
  const duckGain = () => ducked ? DUCK_GAIN : 1;

  function applyVolumes({ context, buses, master }: MixerGraph, immediate = false) {
    const apply = (node: AudioMixerGainNode, target: number) => {
      if (targets.get(node.gain) === target) return;
      if (immediate) node.gain.value = target;
      else node.gain.setTargetAtTime(target, context.currentTime, VOLUME_TIME_CONSTANT);
      targets.set(node.gain, target);
    };
    apply(master, masterGain());
    apply(buses.music, volumeGain('music'));
    apply(buses.proceduralMusic, volumeGain('music'));
    apply(buses.ambience, volumeGain('ambience'));
    apply(buses.effects, volumeGain('effects'));
    apply(buses.voice, volumeGain('voice'));
  }

  function setVolumes(values: Partial<AudioVolumes>) {
    if (disposal) return;
    for (const channel of VOLUME_CHANNELS) {
      const value = values[channel];
      if (value !== undefined) volumes[channel] = normalizeVolume(channel, value);
    }
    if (graph) applyVolumes(graph);
  }

  function removeGestureListeners() {
    if (!listeningForGesture || !gestureTarget) return;
    listeningForGesture = false;
    for (const type of UNLOCK_EVENTS) gestureTarget.removeEventListener(type, onGesture, UNLOCK_LISTENER_OPTIONS);
  }

  function synchronizeContext(): Promise<boolean> {
    if (!graph || disposal || graph.context.state === 'closed') return Promise.resolve(false);
    if (transition) return transition;
    const { context } = graph;
    const hidden = visibilityTarget?.hidden === true;
    if (context.state === (hidden ? 'suspended' : 'running')) {
      if (!hidden) removeGestureListeners();
      return Promise.resolve(!hidden);
    }

    let settle!: (completed: boolean) => void;
    transition = new Promise<boolean>(resolve => { settle = resolve; }).then(completed => {
      transition = undefined;
      cancelTransition = undefined;
      if (disposal || !graph) return false;
      if (hidden !== (visibilityTarget?.hidden === true)) return synchronizeContext();
      const running = completed && !hidden && context.state === 'running';
      if (running) removeGestureListeners();
      return running;
    });
    cancelTransition = () => settle(false);
    try {
      const operation = hidden ? context.suspend() : context.resume();
      void operation.then(() => settle(true), () => settle(false));
    } catch {
      settle(false);
    }
    return transition;
  }

  function unlock(): Promise<boolean> {
    if (disposal) return Promise.resolve(false);
    if (rollingBack) return rollingBack.then(() => false);
    if (graph) return synchronizeContext();
    let context: AudioMixerContext | undefined;
    const nodes: AudioMixerNode[] = [];
    try {
      context = createContext();
      const acquired = buildGraph(context, nodes);
      applyVolumes(acquired, true);
      acquired.duck.gain.value = duckGain();
      graph = acquired;
    } catch (error) {
      if (!context) return Promise.reject(error);
      rollingBack = releaseGraph(context, nodes).finally(() => { rollingBack = undefined; });
      return rollingBack.then(
        () => { throw error; },
        cleanupError => { throw new AggregateError([error, cleanupError], 'Audio mixer setup and cleanup failed'); },
      );
    }
    return synchronizeContext();
  }

  function onGesture() { void unlock().catch(() => {}); }
  function onVisibility() { void synchronizeContext(); }

  function dispose() {
    if (disposal) return disposal;
    const acquired = graph;
    const startupCleanup = rollingBack;
    graph = undefined;
    disposal = Promise.resolve().then(() => acquired ? releaseGraph(acquired.context, acquired.nodes) : startupCleanup);
    removeGestureListeners();
    visibilityTarget?.removeEventListener('visibilitychange', onVisibility);
    cancelTransition?.();
    return disposal;
  }

  for (const type of UNLOCK_EVENTS) gestureTarget?.addEventListener(type, onGesture, UNLOCK_LISTENER_OPTIONS);
  visibilityTarget?.addEventListener('visibilitychange', onVisibility);

  return {
    get context() { return graph?.context ?? null; },
    get buses() { return graph?.buses ?? null; },
    unlock,
    setVolume(channel, value) { setVolumes({ [channel]: value }); },
    setVolumes,
    setMuted(next) {
      if (disposal || muted === next) return;
      muted = next;
      if (graph) applyVolumes(graph);
    },
    setDucked(next) {
      if (disposal || ducked === next) return;
      ducked = next;
      if (graph) graph.duck.gain.setTargetAtTime(duckGain(), graph.context.currentTime, ducked ? 0.06 : 0.25);
    },
    getEffectiveGain(bus) {
      const channel = bus === 'proceduralMusic' ? 'music' : bus;
      const duck = bus === 'music' || bus === 'voice' ? 1 : duckGain();
      return volumeGain(channel) * duck * masterGain() * OUTPUT_GAIN;
    },
    dispose,
  };
}
