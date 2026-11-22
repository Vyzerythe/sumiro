import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { createAudioCues } from '../src/audio/audio-cues.mts';
import { S as tone, d as burst, m as gainFromDb, x as rustle, y as noise, _ as kit } from '../sumiro/bundle/music-AzT4oE4y.js';

const bundle = new URL('../sumiro/bundle/audio-ByKsc24o.js', import.meta.url);
const source = ts.createSourceFile(bundle.pathname, await readFile(bundle, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = new Map(source.statements.flatMap(statement => ts.isVariableStatement(statement)
  ? [...statement.declarationList.declarations] : [statement]).map(node => [node.name?.getText(source),node]));
function exact(name) {
  const node = declarations.get(name);
  assert.ok(node, name);
  return node.getText(source);
}

const names = [
  'swordDraw', 'swordSwing', 'swordSwingHeavy', 'swordHit', 'swordHitHeavy', 'parry',
  'wraithBeat', 'wraithCut', 'roninCut', 'roninSlam', 'roninSheath', 'roninPhase', 'inkDissolve', 'inkRise',
  'bowDraw', 'arrowLoose', 'combatWarn', 'drink', 'bell', 'bladeOnBell', 'crumble', 'crumbleFall', 'door',
  'tipKnock', 'stoneStop', 'inkStep',
];
const recipes = ['A', 'Oe', 'Ie', 'Le', 'Re', 'ze', 'Be', 'Ve', 'He', 'Ue', 'We', 'Ge', 'Ke',
  'qe', 'Je', 'Ye', 'Xe', 'Ze', 'Qe', '$e', 'R', 'Ct', 'je', 'vt', 'Me', '_t', 'gt', 'be'];
const reference = Function('e','a','d','v','y',`
  const ${['O','P','G','en','xt','Jt'].map(exact).join(',')};
  ${recipes.map(exact).join('\n')}
  ${['J','B'].map(key => 'const '+key+'={'+declarations.get(key).initializer.properties.filter(
    node => names.includes(node.name.getText(source)) && node.initializer.getText(source) !== 'Ae',
  ).map(node => node.getText(source)).join(',')+'};').join('\n')}
  ${exact('ln')}
  return ln;
`)(tone, burst, gainFromDb, rustle, noise);

class Param {
  events = [];
  constructor(value = 0) { this.value = value; }
  setValueAtTime(...args) { this.events.push(['set', ...args]); }
  linearRampToValueAtTime(...args) { this.events.push(['linear', ...args]); }
  exponentialRampToValueAtTime(...args) { this.events.push(['exp', ...args]); }
  setTargetAtTime(...args) { this.events.push(['target', ...args]); }
  setValueCurveAtTime(curve, ...args) { this.events.push(['curve', [...curve], ...args]); }
}

function testAudio() {
  const all = [], sources = [];
  function node(kind, fields = {}) {
    const result = {
      kind, loop: false, starts: [], stops: [], onended: null, output: null, disconnected: 0,
      connect(target) { this.output = target; return target; },
      disconnect() { this.disconnected++; this.output = null; },
      start(...args) { this.starts.push(args); },
      stop(...args) { this.stops.push(args); },
      ...fields,
    };
    all.push(result);
    if (kind === 'oscillator' || kind === 'noise') sources.push(result);
    return result;
  }
  const context = {
    state: 'running', sampleRate: 200, currentTime: 0,
    createGain: () => node('gain', { gain: new Param(1) }),
    createOscillator: () => node('oscillator', { frequency: new Param() }),
    createBufferSource: () => node('noise'),
    createBiquadFilter: () => node('filter', { gain: new Param(), frequency: new Param(), Q: new Param() }),
    createBuffer(_channels, length, sampleRate) {
      const samples = new Float32Array(length);
      return { duration: length / sampleRate, getChannelData: () => samples };
    },
  };
  const effects = context.createGain();
  return { context, effects, sources, all };
}

function snapshot(sources, bus) {
  function nodeSnapshot(node) {
    const parameters = {};
    for (const name of ['gain', 'frequency', 'Q']) {
      const parameter = node[name];
      if (parameter) parameters[name] = { value: parameter.value, events: parameter.events };
    }
    return { kind: node.kind, type: node.type, parameters };
  }
  return sources.map(source => {
    const chain = [];
    for (let target = source.output; target !== bus; target = target.output) {
      assert.ok(target, 'Every source must reach its context effects bus');
      chain.push(nodeSnapshot(target));
    }
    return { ...nodeSnapshot(source), loop: source.loop, starts: source.starts, stops: source.stops,
      samples: source.buffer?.getChannelData(0), chain };
  });
}

test('every gameplay recipe matches the shipped live dispatch and Web Audio scheduling', t => {
  const native = testAudio();
  const shipped = testAudio();
  const shippedKit = kit(shipped.context, 1);
  const min = { ac: shipped.context, kit: shippedKit, ambience: { fightPhase() {} } };
  const director = new reference(min, {});
  const cues = createAudioCues({ mixer: { context: native.context, buses: { effects: native.effects } }, assets: {} });
  t.after(() => cues.dispose());
  assert.equal(cues.playGameplay('constructor'), false);
  for (const [index, cue] of names.entries()) {
    native.context.currentTime = shipped.context.currentTime = 9 + index * .39;
    const current = native.sources.length, original = shipped.sources.length;
    const detail = cue === 'bell' ? { pitch: 1.189, gain: 2, tail: .85 } : {};
    director.cue(cue, detail);
    assert.equal(cues.playGameplay(cue, detail), true, cue);
    assert.ok(shipped.sources.length > original, cue);
    assert.deepEqual(snapshot(native.sources.slice(current), native.effects), snapshot(shipped.sources.slice(original), shippedKit.out), cue);
  }
});

test('gameplay voices ignore pre-unlock edges and stop timed tails on chapter or service teardown', () => {
  const { context, effects, sources, all } = testAudio();
  const cues = createAudioCues({ mixer: { context, buses: { effects } }, assets: {} });
  const chapter = new AbortController();
  context.state = 'suspended';
  assert.equal(cues.playGameplay('swordDraw', { signal: chapter.signal }), false);
  assert.equal(sources.length, 0);
  context.state = 'running';
  assert.equal(cues.playGameplay('drink', { signal: chapter.signal }), true);
  assert.equal(cues.playGameplay('bell', { signal: chapter.signal }), true);
  const fromFirstChapter = sources.slice();
  assert.equal(fromFirstChapter.length, 17);
  const finished = fromFirstChapter[0];
  finished.onended();
  assert.equal(finished.disconnected, 1);
  assert.equal(finished.stops.length, 1);
  chapter.abort();
  assert.ok(fromFirstChapter.slice(1).every(source => source.disconnected === 1 && source.stops.length === 2 && source.onended === null));
  assert.equal(cues.playGameplay('swordSwing', { signal: chapter.signal }), false);
  assert.equal(cues.playGameplay('swordSwing'), true);
  const owned = all.filter(node => node !== effects);
  cues.dispose();
  cues.dispose();
  assert.ok(owned.every(node => node.disconnected === 1));
  assert.equal(effects.disconnected, 0);
  assert.equal(cues.playGameplay('parry'), false);
});
