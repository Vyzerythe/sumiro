import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createAudioMixer } from '../src/audio/audio-mixer.mts';
import { defaultOptions } from '../src/domain/save.mts';

const archive = new URL('../sumiro/bundle/audio-ByKsc24o.js', import.meta.url);
const published = ts.createSourceFile(archive.pathname, await readFile(archive, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const trims = published.statements.flatMap(statement => ts.isVariableStatement(statement)
  ? [...statement.declarationList.declarations] : []).find(declaration => declaration.name.getText(published) === 'Yt');
const volume = published.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'U');
assert.ok(trims && volume, 'published mixer calibration declarations changed');
const publishedVolumeGain = runInNewContext(`const ${trims.getText(published)}; ${volume.getText(published)}; U`);

class AudioParamFixture {
  targets = [];

  constructor(value = 0) { this.value = value; }

  setTargetAtTime(value, time, timeConstant) { this.targets.push([value, time, timeConstant]); }
}

class AudioNodeFixture {
  outputs = [];
  disconnectCalls = 0;

  constructor(kind, parameters = {}) {
    this.kind = kind;
    Object.assign(this, parameters);
  }

  connect(destination) {
    this.outputs.push(destination);
    return destination;
  }

  disconnect() {
    this.disconnectCalls++;
    this.outputs.length = 0;
  }
}

class AudioContextFixture {
  destination = new AudioNodeFixture('destination');
  nodes = [];
  calls = [];
  state = 'suspended';
  currentTime = 4.25;
  onResume = async () => { this.state = 'running'; };
  onSuspend = async () => { this.state = 'suspended'; };

  node(kind, parameters) {
    const node = new AudioNodeFixture(kind, parameters);
    this.nodes.push(node);
    return node;
  }

  createGain() { return this.node('gain', { gain: new AudioParamFixture(1) }); }
  createBiquadFilter() {
    return this.node('filter', { frequency: new AudioParamFixture(), Q: new AudioParamFixture() });
  }
  createDynamicsCompressor() {
    return this.node('compressor', Object.fromEntries(
      ['threshold', 'ratio', 'knee', 'attack', 'release'].map(name => [name, new AudioParamFixture()]),
    ));
  }
  resume() { this.calls.push('resume'); return this.onResume(); }
  suspend() { this.calls.push('suspend'); return this.onSuspend(); }
  async close() { this.calls.push('close'); this.state = 'closed'; }
}

class EventTargetFixture extends EventTarget {
  active = new Map();
  hidden = false;

  addEventListener(type, listener, options) {
    const capture = Boolean(typeof options === 'boolean' ? options : options?.capture);
    this.active.set(type, { listener, capture });
    super.addEventListener(type, listener, options);
  }

  removeEventListener(type, listener, options) {
    const capture = Boolean(typeof options === 'boolean' ? options : options?.capture);
    assert.deepEqual(this.active.get(type), { listener, capture });
    this.active.delete(type);
    super.removeEventListener(type, listener, options);
  }

  setHidden(hidden) {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

test('buses use shipped gain calibration, duck routing, and output processing', async context => {
  const transport = new AudioContextFixture();
  const volumes = { master: 0.5, ambience: 0.75 };
  const mixer = createAudioMixer({ createContext: () => transport, volumes });
  context.after(() => mixer.dispose());
  assert.equal(mixer.buses, null);
  assert.equal(await mixer.unlock(), true);
  const buses = mixer.buses;
  const master = buses.music.outputs[0];
  const duck = buses.effects.outputs[0];
  const settings = { ...defaultOptions, ...volumes };
  const trim = 10 ** (-5 / 20);
  for (const [name, bus] of Object.entries(buses)) {
    const channel = name === 'proceduralMusic' ? 'music' : name;
    const busGain = publishedVolumeGain(channel, settings[channel]);
    assert.equal(bus.gain.value, busGain, name);
    assert.equal(mixer.getEffectiveGain(name), busGain * publishedVolumeGain('master', settings.master) * trim, name);
    assert.deepEqual(bus.outputs, [name === 'music' || name === 'voice' ? master : duck]);
  }
  assert.equal(master.gain.value, 0.25);
  assert.deepEqual(duck.outputs, [master]);
  const [output] = master.outputs;
  const [filter] = output.outputs;
  const [compressor] = filter.outputs;
  assert.equal(output.gain.value, trim);
  assert.deepEqual([filter.type, filter.frequency.value, filter.Q.value], ['lowpass', 15_000, 0.7]);
  assert.deepEqual(
    [compressor.threshold.value, compressor.ratio.value, compressor.knee.value, compressor.attack.value, compressor.release.value],
    [-18, 2.5, 6, 0.01, 0.2],
  );
  assert.deepEqual(compressor.outputs, [transport.destination]);

  mixer.setDucked(true);
  mixer.setDucked(true);
  assert.deepEqual(duck.gain.targets, [[0.1, 4.25, 0.06]]);
  assert.equal(mixer.getEffectiveGain('effects'), publishedVolumeGain('effects', 1) * 0.1 * 0.25 * trim);
  assert.equal(mixer.getEffectiveGain('voice'), publishedVolumeGain('voice', 1) * 0.25 * trim);
  assert.equal(mixer.getEffectiveGain('music'), publishedVolumeGain('music', 0.8) * 0.25 * trim);
  mixer.setDucked(false);
  assert.deepEqual(duck.gain.targets.at(-1), [1, 4.25, 0.25]);
});

test('mute preserves settings and duplicate settings changes do not restart automation', async context => {
  const transport = new AudioContextFixture();
  const mixer = createAudioMixer({ createContext: () => transport });
  context.after(() => mixer.dispose());
  mixer.setMuted(true);
  mixer.setDucked(true);
  await mixer.unlock();
  const buses = mixer.buses;
  const master = buses.music.outputs[0];
  assert.equal(master.gain.value, 0);
  assert.equal(buses.effects.outputs[0].gain.value, 0.1);
  assert.equal(mixer.getEffectiveGain('voice'), 0);
  mixer.setVolumes({ master: 0.25, music: 0.5, voice: -2, effects: 4 });
  mixer.setVolume('music', 0.5);
  assert.deepEqual(master.gain.targets, []);
  for (const name of ['music', 'proceduralMusic']) {
    assert.deepEqual(buses[name].gain.targets, [[publishedVolumeGain('music', 0.5), 4.25, 0.04]]);
  }
  assert.deepEqual(buses.voice.gain.targets, [[0, 4.25, 0.04]]);
  assert.deepEqual(buses.effects.gain.targets, []);
  mixer.setMuted(false);
  mixer.setMuted(false);
  assert.deepEqual(master.gain.targets, [[0.0625, 4.25, 0.04]]);
  assert.equal(mixer.getEffectiveGain('voice'), 0);
  assert.ok(mixer.getEffectiveGain('music') > 0);
  mixer.setVolume('music', NaN);
  assert.deepEqual(buses.music.gain.targets.at(-1), [publishedVolumeGain('music', defaultOptions.music), 4.25, 0.04]);
});

test('gesture unlock allocates and resumes once, retries denial, and removes gesture listeners', async context => {
  const gestureTarget = new EventTargetFixture();
  const transport = new AudioContextFixture();
  const firstResume = Promise.withResolvers();
  transport.onResume = () => firstResume.promise;
  let acquisitions = 0;
  const mixer = createAudioMixer({ gestureTarget, createContext() { acquisitions++; return transport; } });
  context.after(() => mixer.dispose());
  assert.equal(acquisitions, 0);
  assert.deepEqual([...gestureTarget.active.keys()], ['pointerdown', 'keydown', 'touchend']);
  gestureTarget.dispatchEvent(new Event('pointerdown'));
  gestureTarget.dispatchEvent(new Event('keydown'));
  const first = mixer.unlock();
  assert.equal(mixer.unlock(), first);
  assert.equal(acquisitions, 1);
  assert.deepEqual(transport.calls, ['resume']);
  firstResume.reject(new Error('User activation denied'));
  assert.equal(await first, false);
  assert.equal(gestureTarget.active.size, 3);
  transport.onResume = async () => { transport.state = 'running'; };
  gestureTarget.dispatchEvent(new Event('touchend'));
  assert.equal(await mixer.unlock(), true);
  assert.equal(await mixer.unlock(), true);
  assert.equal(acquisitions, 1);
  assert.equal(gestureTarget.active.size, 0);
  assert.deepEqual(transport.calls, ['resume', 'resume']);
  transport.state = 'suspended';
  gestureTarget.dispatchEvent(new Event('pointerdown'));
  assert.deepEqual(transport.calls, ['resume', 'resume']);
});

test('visibility uses the latest state without overlapping transport transitions', async context => {
  const transport = new AudioContextFixture();
  const visibilityTarget = new EventTargetFixture();
  let acquisitions = 0;
  const mixer = createAudioMixer({ visibilityTarget, createContext() { acquisitions++; return transport; } });
  context.after(() => mixer.dispose());
  visibilityTarget.setHidden(true);
  visibilityTarget.setHidden(false);
  assert.equal(acquisitions, 0);
  await mixer.unlock();
  const suspension = Promise.withResolvers();
  transport.onSuspend = async () => { await suspension.promise; transport.state = 'suspended'; };
  visibilityTarget.setHidden(true);
  visibilityTarget.setHidden(true);
  visibilityTarget.setHidden(false);
  const rebound = mixer.unlock();
  assert.deepEqual(transport.calls, ['resume', 'suspend']);
  suspension.resolve();
  assert.equal(await rebound, true);
  assert.deepEqual(transport.calls, ['resume', 'suspend', 'resume']);
});

test('disposal settles a pending unlock before a late resume and releases owned nodes exactly once', async () => {
  const transport = new AudioContextFixture();
  const gestureTarget = new EventTargetFixture();
  const visibilityTarget = new EventTargetFixture();
  const resume = Promise.withResolvers();
  transport.onResume = async () => { await resume.promise; transport.state = 'running'; };
  const mixer = createAudioMixer({ createContext: () => transport, gestureTarget, visibilityTarget });
  const unlocking = mixer.unlock();
  const owned = [...transport.nodes];
  const disposal = mixer.dispose();
  assert.equal(mixer.dispose(), disposal);
  assert.equal(await unlocking, false);
  await disposal;
  assert.deepEqual(transport.calls, ['resume', 'close']);
  assert.equal(gestureTarget.active.size + visibilityTarget.active.size, 0);
  assert.ok(owned.length > 0 && owned.every(node => node.disconnectCalls === 1 && node.outputs.length === 0));
  assert.equal(transport.destination.disconnectCalls, 0);
  assert.equal(mixer.context, null);
  assert.equal(mixer.buses, null);
  resume.resolve();
  await Promise.resolve();
  visibilityTarget.setHidden(false);
  gestureTarget.dispatchEvent(new Event('pointerdown'));
  assert.equal(await mixer.unlock(), false);
  assert.deepEqual(transport.calls, ['resume', 'close']);
});

test('a partially acquired graph releases its nodes and context before another activation', async context => {
  const broken = new AudioContextFixture();
  broken.createBiquadFilter = () => { throw new Error('Unable to create filter'); };
  const good = new AudioContextFixture();
  let acquisitions = 0;
  const mixer = createAudioMixer({ createContext: () => acquisitions++ ? good : broken });
  context.after(() => mixer.dispose());
  const failed = assert.rejects(mixer.unlock(), { message: 'Unable to create filter' });
  assert.equal(await mixer.unlock(), false);
  await failed;
  assert.equal(acquisitions, 1);
  assert.deepEqual(broken.calls, ['close']);
  assert.ok(broken.nodes.length > 0 && broken.nodes.every(node => node.disconnectCalls === 1));
  assert.equal(await mixer.unlock(), true);
  assert.equal(acquisitions, 2);
});
