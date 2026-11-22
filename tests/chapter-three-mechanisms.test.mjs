import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Group, Object3D } from 'three';
import { bindChapterThreeMechanismPresentation, createChapterThreeMechanisms } from '../src/application/chapter-three-mechanisms.mts';
import { createCollisionWorld } from '../src/physics/world.mts';
import { n as extrude, r as contains, t as createPublishedWorld } from '../sumiro/bundle/collision-DtBQEpmQ.js';

const [chapter, level] = await Promise.all(['ch3_pines-BCHma7IG.js', 'level-O-RtwNJJ.js'].map(file =>
  readFile(new URL(`../sumiro/bundle/${file}`, import.meta.url), 'utf8')));

function span(source, first, next) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `Published mechanism boundary changed at ${first}`);
  return source.slice(start, end);
}

const definitions = Function(span(chapter, 'var ie=', 'function ke(') + ';return q.mechs;')();
// Bridge plank geometry is used only for optional generated visuals. Authored
// nodes and the collision world still execute the published mechanism functions.
class Plank { translate() {} }
const originalFactory = Function('S', 'C', 'm', 'c', 't',
  span(level, 'var T=Math.PI/180', 'function B(e,t)') + ';return z;',
)(extrude, contains, Plank, Object3D, () => {});

function makeRoot(useAssetAliases = false) {
  const root = new Group();
  for (const definition of definitions) if (definition.node) {
    const node = new Group();
    node.name = useAssetAliases && /^(tp_\d+|tip\d+)_mesh$/.test(definition.node) ? definition.node + '_wood' : definition.node;
    root.add(node);
  }
  return root;
}

function fixture() {
  const originalWorld = createPublishedWorld();
  const originalRoot = makeRoot();
  const events = [];
  const originalEvents = [];
  let originalPlayer;
  const stage = { world: originalWorld, group: originalRoot,
    mechs: definitions.map(site => site.kind === 'wind' ? { ...site, visual: false } : site) };
  const original = originalFactory({ registry: {
    get(key) {
      if (key === 'level.current') return stage;
      if (key === 'player.body') return { c: originalPlayer };
      if (key === 'game.state') return 'PLAY';
    },
    set(key, value) {
      if (key === 'audio.cue') originalEvents.push({ type: 'cue', ...value });
      if (key === 'camera_rig.shake') originalEvents.push({ type: 'shake', strength: value });
    },
    on() { return () => {}; },
  } }, stage);
  original.bind();

  const world = createCollisionWorld();
  const root = makeRoot(true);
  const current = createChapterThreeMechanisms(world, { onEvent: event => events.push(event) });
  const sync = bindChapterThreeMechanismPresentation(root, current);
  return { world, originalWorld, current, original, root, originalRoot, events, originalEvents, sync,
    step(delta, position, body) {
      const player = position && { ...position, carrier: body ? world.body(body) : null, drift: {} };
      originalPlayer = position && { ...position, carrier: body ? originalWorld.body(body) : null, drift: {} };
      const drift = current.step(delta, player);
      original.update(delta);
      sync();
      if (player) {
        assert.deepEqual(drift, originalPlayer.drift);
        assert.deepEqual(player.drift, originalPlayer.drift);
      }
      return { ...drift };
    },
  };
}

const triangleState = triangle => [triangle.kind, triangle.surface, [...triangle.local], [...triangle]];
const bodyState = body => [body.x, body.y, body.z, body.yaw, body.pitch, body.roll,
  body.vx, body.vy, body.vz, body.moved, body.enabled, body.minX, body.maxX, body.minY, body.maxY, body.minZ, body.maxZ];
const poseState = node => [node.position.x, node.position.y, node.position.z, node.rotation.y,
  node.rotation.x, node.rotation.z, node.visible, node.rotation.order];

function compareAll({ current, original, root, originalRoot }) {
  for (const state of current.list) {
    const before = original.get(state.id);
    if (state.kind === 'wind') {
      assert.deepEqual([state.phase, state.pushing, state.shown, state.flow],
        [before.state, !!before.pushing, before.shown, before.flow], state.id);
    } else {
      assert.deepEqual(bodyState(state.body), bodyState(before.body), state.id);
      const node = root.getObjectByName(state.definition.node) ?? root.getObjectByName(state.definition.node + '_wood');
      assert.deepEqual(poseState(node), poseState(originalRoot.getObjectByName(state.definition.node)), state.id);
      if (state.kind === 'crumble') assert.equal(state.phase, before.state, state.id);
    }
  }
}

test('Chapter Three owns every authored moving body, gap, rail, and presentation node in order', () => {
  const scene = fixture();
  assert.equal(scene.current.list.length, 35);
  assert.deepEqual(scene.current.list.map(state => state.definition), definitions);
  for (const state of scene.current.list) if (state.kind !== 'wind') {
    assert.strictEqual(scene.world.body(state.id), state.body);
    assert.deepEqual(state.body.tris.map(triangleState), scene.original.get(state.id).body.tris.map(triangleState), state.id);
  }
  compareAll(scene);
  assert.throws(() => createChapterThreeMechanisms(scene.world), /br5 was already installed/);
});

test('fixed ticks preserve bridge loading, plank tilt, wind phase, drift, and cue order', () => {
  const scene = fixture();
  let pushedByWind = false;
  let slidOnTip = false;
  for (let tick = 0; tick < 660; tick++) {
    const rideBridge = tick < 150 || tick >= 240 && tick < 420;
    const rideTip = tick >= 150 && tick < 240;
    const position = rideBridge ? { x: -103, y: 24.4, z: -202.3 }
      : rideTip ? { x: -443.1, y: 41.2, z: -244.2 } : { x: -34, y: 25, z: -200 };
    const drift = scene.step(1 / 60, position, rideBridge ? 'br5' : rideTip ? 'tip0' : undefined);
    if (drift.air !== 1) pushedByWind = true;
    if (rideTip && (drift.x !== 0 || drift.z !== 0)) slidOnTip = true;
    if (tick % 11 === 0) compareAll(scene);
  }
  assert.ok(pushedByWind);
  assert.ok(slidOnTip);
  assert.ok(scene.events.some(event => event.name === 'bridgeCreak'));
  assert.ok(scene.events.some(event => event.name === 'gustBlow'));
  assert.ok(scene.events.some(event => event.name === 'tipKnock'));
  assert.deepEqual(scene.events, scene.originalEvents);
  scene.current.reset();
  scene.original.bind();
  scene.sync();
  compareAll(scene);
});

test('fixed ticks preserve crumble shake, drop, occupied recovery, and collision teardown', () => {
  const scene = fixture();
  const stone = scene.current.get('tp_0');
  const { x, y, z } = stone.definition;
  const phases = new Set();
  for (let tick = 0; tick < 420; tick++) {
    const rider = tick < 80;
    const clear = tick >= 360;
    scene.step(1 / 60, { x: clear ? x + 4 : x, y, z }, rider ? stone.id : undefined);
    phases.add(stone.phase);
    if (tick % 9 === 0) compareAll(scene);
    if (tick === 359) assert.equal(stone.phase, 'gone');
  }
  assert.deepEqual([...phases], ['shaking', 'falling', 'gone', 'rising', 'whole']);
  assert.deepEqual(scene.events, scene.originalEvents);
  assert.strictEqual(scene.world.groundAt(x, z).body, stone.body);
  scene.current.dispose();
  scene.current.reset();
  assert.ok(scene.current.list.every(state => state.kind === 'wind' || !state.body.enabled && !state.body.moved));
  assert.equal(scene.world.groundAt(x, z), null);
});
