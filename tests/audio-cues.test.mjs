import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createAudioCues } from '../src/audio/audio-cues.mts';
import { createAudioMixer } from '../src/audio/audio-mixer.mts';
import { S as tone, _ as kit, d as burst, m as decibels, x as rustle } from '../sumiro/bundle/music-AzT4oE4y.js';

const asset = path => new URL(`../sumiro/assets/${path}`, import.meta.url);
const manifest = JSON.parse(await readFile(asset('audio/index.json'), 'utf8'));
const archive = new URL('../sumiro/bundle/audio-ByKsc24o.js', import.meta.url);
const published = ts.createSourceFile(archive.pathname, await readFile(archive, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const definitions = ['Ee', 'De', 'ke'].map(name => {
  const node = published.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);
  return node.getText(published);
});
const original = runInNewContext(`${definitions.join('\n')}; ({shrine: Ee, scroll: De, gate: ke});`, {
  e: tone, d: decibels, a: burst, v: rustle,
});

class FixtureParam {
  events = [];
  constructor(value = 0) { this.value = value; }
  setValueAtTime(...args) { this.events.push(['set', ...args]); }
  linearRampToValueAtTime(...args) { this.events.push(['linear', ...args]); }
  exponentialRampToValueAtTime(...args) { this.events.push(['exponential', ...args]); }
  setTargetAtTime(...args) { this.events.push(['target', ...args]); }
  setValueCurveAtTime(curve, ...args) { this.events.push(['curve', [...curve], ...args]); }
}

class FixtureNode {
  output = null;
  disconnected = 0;
  starts = [];
  stops = [];
  loop = false;
  onended = null;

  constructor(kind, properties) { this.kind = kind; Object.assign(this, properties); }
  connect(next) { this.output = next; return next; }
  disconnect() { this.disconnected++; this.output = null; }
  start(...args) { this.starts.push(args); }
  stop(...args) { this.stops.push(args); }
  end() { this.onended?.(); }
}

class FixtureContext {
  state = 'suspended';
  currentTime = 9;
  sampleRate = 100;
  destination = new FixtureNode('destination');
  nodes = [];
  sources = [];
  closed = 0;
  resumed = 0;
  decoded = [];

  async resume() { this.resumed++; this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.closed++; this.state = 'closed'; }
  async decodeAudioData(bytes) { this.decoded.push(bytes); return { duration: 200 }; }
  node(kind, properties) {
    const node = new FixtureNode(kind, properties);
    this.nodes.push(node);
    if (kind === 'oscillator' || kind === 'buffer') this.sources.push(node);
    return node;
  }
  createGain() { return this.node('gain', { gain: new FixtureParam(1) }); }
  createBiquadFilter() {
    return this.node('filter', { frequency: new FixtureParam(), Q: new FixtureParam(), gain: new FixtureParam() });
  }
  createDynamicsCompressor() {
    return this.node('compressor', Object.fromEntries(['threshold', 'ratio', 'knee', 'attack', 'release'].map(name => [name, new FixtureParam()])));
  }
  createOscillator() { return this.node('oscillator', { frequency: new FixtureParam() }); }
  createBufferSource() { return this.node('buffer'); }
  createBuffer(_channels, length, sampleRate) {
    const samples = new Float32Array(length);
    return { duration: length / sampleRate, getChannelData: () => samples };
  }
}

function chain(source, bus) {
  const nodes = [];
  for (let node = source.output; node !== bus; node = node.output) {
    assert.ok(node, 'source must reach its own bus');
    nodes.push(node);
  }
  return nodes;
}

function snapshot(source, bus) {
  return {
    kind: source.kind, type: source.type, frequency: source.frequency?.events,
    starts: source.starts, stops: source.stops, loop: source.loop,
    samples: source.buffer?.getChannelData(0),
    chain: chain(source, bus).map(node => node.kind === 'filter'
      ? [node.kind, node.type, node.frequency.value, node.Q.value]
      : [node.kind, node.gain.value, node.gain.events]),
  };
}

function mixerFixture(testContext, assets = {}, reportError) {
  const context = new FixtureContext();
  const mixer = createAudioMixer({ createContext: () => context });
  const cues = createAudioCues({ mixer, assets, reportError });
  testContext.after(async () => { cues.dispose(); await mixer.dispose(); });
  return { context, mixer, cues };
}

test('shrine, scroll, and gate schedules match the shipped cue definitions on the effects bus', async testContext => {
  const { context, mixer, cues } = mixerFixture(testContext);
  assert.equal(await cues.play('gate'), false);
  assert.equal(context.resumed, 0);
  await mixer.unlock();
  const reference = new FixtureContext();
  const referenceKit = kit(reference, 1);
  for (const cue of ['shrine', 'scroll', 'gate']) {
    original[cue](referenceKit, reference.currentTime);
    assert.equal(await cues.play(cue), true);
  }
  const bus = mixer.buses.effects;
  assert.equal(context.sources.length, 11);
  assert.deepEqual(context.sources.map(source => snapshot(source, bus)), reference.sources.map(source => snapshot(source, referenceKit.out)));

  const firstSource = context.sources[0];
  const firstOwned = [firstSource, ...chain(firstSource, bus)];
  firstSource.end();
  assert.ok(firstOwned.every(node => node.disconnected === 1));
  const remaining = context.sources.slice(1).flatMap(source => [source, ...chain(source, bus)]);
  cues.dispose();
  cues.dispose();
  assert.ok(remaining.every(node => node.disconnected === 1));
  assert.equal(firstSource.stops.length, 1);
  assert.ok(context.sources.slice(1).every(source => source.stops.length === 2 && source.onended === null));
  assert.equal(bus.disconnected, 0);
  assert.equal(context.closed, 0);
});

test('locked chapter requests keep the latest track and honor supplied Ogg metadata on music', async testContext => {
  const requests = [];
  const { context, mixer, cues } = mixerFixture(testContext, {
    async loadJSON(path) { requests.push(path); return manifest; },
    async loadArrayBuffer(path) {
      requests.push(path);
      const bytes = await readFile(asset(path));
      assert.equal(bytes.toString('ascii', 0, 4), 'OggS');
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  });
  assert.equal(await cues.play('chapter'), false);
  assert.equal(await cues.play('chapter', 'ch2_pass'), false);
  assert.equal(await cues.update(), false);
  assert.deepEqual(requests, []);
  await mixer.unlock();
  const flush = cues.update();
  assert.equal(cues.update(), flush);
  assert.equal(await flush, true);
  assert.deepEqual(requests, ['audio/index.json', 'audio/music/ch2.ogg']);
  const source = context.sources[0];
  assert.equal(source.loop, true);
  assert.equal(source.loopStart, manifest.music.ch2.loopStart);
  assert.equal(source.loopEnd, manifest.music.ch2.loopEnd);
  assert.deepEqual(source.starts, [[context.currentTime + 0.025, 0]]);
  const [gain] = chain(source, mixer.buses.music);
  assert.deepEqual(gain.gain.events, [['target', decibels(-26 - manifest.music.ch2.lufs), 9.025, 1]]);
  assert.equal(await cues.play('chapter', 'ch2_pass'), true);
  assert.equal(context.sources.length, 1);
  assert.equal(await cues.play('chapter', 'ch1_climb'), true);
  assert.equal(context.sources.length, 2);
  assert.equal(source.disconnected, 1);
  cues.dispose();
  assert.equal(context.sources[1].disconnected, 1);
  assert.equal(context.closed, 0);
});

test('superseding or disposing a chapter settles promptly and prevents a stale decode from starting', async testContext => {
  const requests = [];
  const { context, mixer, cues } = mixerFixture(testContext, {
    async loadJSON() { return manifest; },
    async loadArrayBuffer(path, { signal }) { requests.push({ path, signal }); return new ArrayBuffer(4); },
  });
  const firstDecode = Promise.withResolvers();
  const entered = Promise.withResolvers();
  context.decodeAudioData = () => {
    entered.resolve();
    return firstDecode.promise;
  };
  await mixer.unlock();
  const first = cues.play('chapter', 'ch1_climb');
  await entered.promise;
  context.decodeAudioData = async () => ({ duration: 200 });
  const second = cues.play('chapter', 'ch2_pass');
  assert.equal(await first, false);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(await second, true);
  firstDecode.resolve({ duration: 200 });
  await Promise.resolve();
  assert.equal(context.sources.length, 1);
  const hanging = Promise.withResolvers();
  const pending = Promise.withResolvers();
  context.decodeAudioData = () => { pending.resolve(); return hanging.promise; };
  const last = cues.play('chapter', 'ch3_pines');
  await pending.promise;
  cues.dispose();
  assert.equal(await last, false);
  assert.equal(requests[2].signal.aborted, true);
  assert.equal(await cues.play('shrine'), false);
  hanging.resolve({ duration: 200 });
  await Promise.resolve();
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].disconnected, 1);
});

test('story dialogue uses the supplied recording and releases a cancelled scene voice', async testContext => {
  const path = 'audio/voice/ch1_find_cat.ogg';
  const bytes = await readFile(asset(path));
  const requests = [];
  assert.equal(bytes.toString('ascii', 0, 4), 'OggS');
  const { mixer, context, cues } = mixerFixture(testContext, {
    async loadArrayBuffer(request, { signal }) {
      requests.push({ request, signal });
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  });
  await mixer.unlock();
  const scene = new AbortController();
  const voice = cues.playRecording(path, 'voice', scene.signal, -2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[0].request, path);
  assert.equal(voice.duration(), 200);
  assert.equal(context.decoded[0].byteLength, bytes.byteLength);
  const source = context.sources[0];
  const [gain] = chain(source, mixer.buses.voice);
  assert.equal(gain.gain.value, decibels(-2));
  assert.deepEqual(source.starts, [[]]);
  scene.abort();
  assert.equal(requests[0].signal.aborted, true);
  assert.deepEqual(source.stops, [[]]);
  assert.equal(source.disconnected, 1);
  assert.equal(gain.disconnected, 1);
});
