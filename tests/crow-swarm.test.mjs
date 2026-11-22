import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as three from 'three/webgpu';
import { pass } from 'three/tsl';
import ts from 'typescript';
import { chapterCombat } from '../src/combat/encounters.mts';
import { createCrowSwarm } from '../src/combat/crow-swarm.mts';
import { configureInkSurfacePass } from '../src/rendering/ink-surface-pass.mts';

const sources = await Promise.all(['combat-Dp_zXhrv.js', 'ch5_sea-CpHUIhkX.js', 'ch6_summit-BczK7QHX.js']
  .map(name => readFile(new URL('../sumiro/bundle/' + name, import.meta.url), 'utf8')));

function publishedDefs(code) {
  const source = ts.createSourceFile('chapter.mjs', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let found;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'swarms') found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, 'Published swarm data boundary changed');
  return Function('return ' + found.getText(source))();
}

const start = sources[0].indexOf('function bt(');
const end = sources[0].indexOf('var xt=', start);
assert.ok(start >= 0 && end > start, 'Published swarm routine boundary changed');
const makePublished = Function('Math', 'vt', 'u', 'let yt; ' + sources[0].slice(start, end) + ';return bt;');

function oracle(definition, seed) {
  let randomState = BigInt(seed);
  const math = Object.assign(Object.create(Math), { random() {
    randomState = (1664525n * randomState + 1013904223n) % 0x100000000n;
    return Number(randomState) / 0x1_0000_0000;
  } });
  class CaptureMesh {
    constructor() {
      this.visible = true;
      this.transforms = [];
      this.instanceMatrix = {};
    }
    setMatrixAt(index, matrix) { this.transforms[index] = Float32Array.from(matrix.elements); }
  }
  const original = makePublished(math, () => ({ clone: () => ({ setAttribute() {} }) }), () => ({ onBeforeCompile() {} }));
  const cues = [], contacts = [], flags = new Set(), swarms = [];
  let player;
  let mesh;
  const swarm = original({
    THREE: { ...three, InstancedMesh: CaptureMesh },
    group: { add: node => { mesh = node; } },
    player: () => player,
    playerDown: () => !!player.down,
    damagePlayer: (damage, details) => contacts.push({ damage, ...details }),
    cue: name => cues.push(name),
    flag: value => flags.has(value), setFlag: value => flags.add(value),
    emit: item => swarms.push(item), fx: { splash() {} },
  }, definition);
  swarm.reset();
  return { swarm, mesh, contacts, cues, swarms, flags, step(delta, seconds, at) {
    player = at;
    swarm.update(delta, seconds);
  } };
}

const AWAY = { x: -999, y: 0, z: -999 };
const matrix = new three.Matrix4();
function compare(actual, expected) {
  const state = actual.state;
  const ref = expected.swarm.state;
  assert.deepEqual(
    [state.radius, state.x, state.y, state.z, state.heading, state.distance, state.direction, state.waitSeconds,
      state.broken, state.gone, state.brokenSeconds, state.reformProgress, state.hurtWait, state.callWait],
    [ref.radius, ref.x, ref.y, ref.z, ref.heading, ref.d, ref.dir, ref.wait,
      ref.broken, ref.gone, ref.brokenT, ref.k, ref.hurtWait, ref.callT],
  );
  assert.equal(actual.mesh.visible, expected.mesh.visible);
  for (const [index, transform] of expected.mesh.transforms.entries()) {
    actual.mesh.getMatrixAt(index, matrix);
    assert.deepEqual(Float32Array.from(matrix.elements), transform, 'bird transform ' + index);
  }
}

test('shipped Sea and Summit routes retain their centers, end waits and break/reform formation transforms', () => {
  for (const [index, chapter] of [5, 6].entries()) {
    const definitions = chapterCombat[chapter].swarms;
    assert.deepEqual(definitions, publishedDefs(sources[index + 1]));
    for (const definition of definitions) {
      const seed = 0x334733;
      const reference = oracle(definition, seed);
      const events = [];
      const actual = createCrowSwarm(definition, { seed, onState: event => events.push(event) });
      let seconds = 14;
      const tick = delta => {
        seconds += delta;
        actual.step(delta, seconds, AWAY);
        reference.step(delta, seconds, AWAY);
        compare(actual, reference);
      };
      try {
        for (const delta of [0.1, 0.3, 1.4, 3, 9, 1.8, 0.1, 0.1]) tick(delta);
        assert.equal(actual.breakIt(true), reference.swarm.breakIt(true));
        assert.equal(actual.breakIt(), reference.swarm.breakIt());
        tick(0.5);
        tick(definition.reform - 0.5);
        assert.equal(actual.state.broken, true);
        tick(0.01);
        assert.equal(actual.state.reformProgress, 0);
        tick(0.5);
        tick(1);
        assert.equal(actual.state.reformProgress, 1);
        assert.deepEqual(events, [
          { type: 'broken', id: definition.id, quiet: true }, { type: 'reformed', id: definition.id },
        ]);
      } finally {
        actual.dispose();
      }
    }
  }
});

test('contact uses the original cylinder boundaries and cooldown, including the exact expiry frame', () => {
  const definition = chapterCombat[5].swarms[0];
  const seed = 42;
  const reference = oracle(definition, seed);
  const contacts = [], calls = [];
  const actual = createCrowSwarm(definition, { seed, onContact: ({ id, radius, ...event }) => {
    assert.equal(id, definition.id);
    assert.equal(radius, definition.radius);
    contacts.push(event);
  }, onState: event => { if (event.type === 'call') calls.push('crowCalls'); } });
  const fixed = { x: 125, y: 3, z: -414 };
  let seconds = 0;
  const tick = (delta, player) => {
    seconds += delta;
    actual.step(delta, seconds, player);
    reference.step(delta, seconds, player);
    compare(actual, reference);
    assert.deepEqual(contacts, reference.contacts);
    assert.deepEqual(calls, reference.cues);
  };
  try {
    tick(0, { ...fixed, x: 126.60001 });
    assert.equal(contacts.length, 0);
    tick(0, { ...fixed, y: 3.6 + 1.3 });
    assert.equal(contacts.length, 0);
    tick(0, { ...fixed, down: true });
    assert.equal(contacts.length, 0);
    tick(0, { ...fixed, x: 126.59999 });
    assert.equal(contacts.length, 1);
    tick(1.4, fixed);
    assert.equal(contacts.length, 1);
    tick(0, fixed);
    assert.equal(contacts.length, 2);
    tick(0.1, fixed);
  } finally {
    actual.dispose();
  }
});

test('a one-shot swarm remains gone after its saved flag and native wing output compiles', () => {
  const definition = { ...chapterCombat[5].swarms[0], count: 2, reform: null, flag: 'goneCrows' };
  const reference = oracle(definition, 1);
  const flags = new Set();
  const parent = new three.Group();
  const events = [];
  const swarm = createCrowSwarm(definition, { parent, seed: 1, hasFlag: flag => flags.has(flag),
    setFlag: flag => flags.add(flag), onState: event => events.push(event) });
  const renderer = new three.WebGPURenderer({ canvas: { width: 16, height: 16 } });
  renderer.hasFeature = () => false;
  renderer._bindings = { getSharedBindGroup: group => group };
  const scene = new three.Scene();
  const camera = new three.PerspectiveCamera();
  const scenePass = pass(scene, camera);
  configureInkSurfacePass(scenePass);
  renderer.setRenderTarget(scenePass.renderTarget);
  renderer.setMRT(scenePass.getMRT());
  try {
    const builder = new three.WGSLNodeBuilder(swarm.mesh, renderer);
    builder.scene = scene;
    builder.camera = camera;
    builder.build();
    assert.match(builder.vertexShader, /aWing/);
    assert.match(builder.vertexShader, /aPhase/);
    assert.match(builder.vertexShader, /sin\(.*crowFlapSeconds.*19\.0/);
    assert.equal(swarm.breakIt(), reference.swarm.breakIt());
    assert.deepEqual(flags, reference.flags);
    for (const [delta, seconds] of [[2.2, 2.2], [0.001, 2.201]]) {
      swarm.step(delta, seconds, AWAY);
      reference.step(delta, seconds, AWAY);
      compare(swarm, reference);
    }
    assert.deepEqual(events.map(event => event.type), ['broken', 'gone']);
    swarm.reset();
    assert.equal(swarm.mesh.visible, false);
  } finally {
    swarm.dispose();
    scenePass.dispose();
  }
  assert.equal(parent.children.length, 0);
});
