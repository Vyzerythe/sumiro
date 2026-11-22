import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Group, Object3D } from 'three';
import { bindChapterSixMechanismPresentation, createChapterSixMechanisms } from '../src/application/chapter-six-mechanisms.mts';
import { createCollisionWorld } from '../src/physics/world.mts';
import { n as extrude, r as contains, t as createPublishedWorld } from '../sumiro/bundle/collision-DtBQEpmQ.js';

const [chapter, shared, combat] = await Promise.all(['ch6_summit-BczK7QHX.js', 'level-O-RtwNJJ.js', 'combat-Dp_zXhrv.js'].map(
  file => readFile(new URL(`../sumiro/bundle/${file}`, import.meta.url), 'utf8')));

function span(source, first, next) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `Published Summit source boundary changed at ${first}`);
  return source.slice(start, end);
}

const data = Function(span(chapter, 'var b={discs', 'function ge(') +
  '; return { mechanisms: q.mechs.slice(de.length), ice: de, groups: G, encounters: q.combat.encounters };')();
// These classes are only used for demonstration visuals when no node is supplied.
class Plank { translate() {} }
const originalFactory = Function('S', 'C', 'm', 'c', 't',
  span(shared, 'var T=Math.PI/180', 'function B(e,t)') + ';return z;',
)(extrude, contains, Plank, Object3D, () => {});
const gateController = Function('X', span(combat, 'function Xt(e,t,n,r=!1)', 'function Qt(') + 'return Zt;');
const updateRopes = Function('ye', span(chapter, 'function ze(e){', 'function Be(') + 'return ze;')(76);

function rootFixture() {
  const root = new Group();
  for (const definition of data.mechanisms) for (const name of definition.nodes ?? (definition.node ? [definition.node] : [])) {
    const node = new Group();
    node.name = name;
    root.add(node);
  }
  for (const name of ['rope_lift_a', 'rope_lift_b']) {
    const node = new Group();
    node.name = name;
    root.add(node);
  }
  return root;
}

function installGates(world) {
  for (const { group, pts, y, h } of data.groups) {
    world.addTriangles(extrude(pts, () => y - 1, () => y + h), { group, kind: 2 });
  }
}

function fixture() {
  const world = createCollisionWorld();
  const originalWorld = createPublishedWorld();
  installGates(world);
  installGates(originalWorld);
  const events = [], expectedEvents = [];
  const root = rootFixture();
  const originalRoot = rootFixture();
  let originalPlayer;
  const listeners = new Map();
  const encounterStates = new Map();
  const flags = new Set();
  const targets = new Map();
  const stage = { world: originalWorld, group: originalRoot, mechs: data.mechanisms.map(definition =>
    ['bridge', 'wind'].includes(definition.kind) ? { ...definition, visual: false } : definition) };
  const original = originalFactory({ registry: {
    get(key) {
      if (key === 'level.current') return stage;
      if (key === 'player.body') return { c: originalPlayer };
      if (key === 'game.state') return 'PLAY';
      if (key === 'combat') return { addTarget(target) { targets.set(target.id, target); return target; } };
    },
    set(key, value) {
      if (key === 'audio.cue') expectedEvents.push({ type: 'cue', ...value });
      if (key === 'camera_rig.shake') expectedEvents.push({ type: 'shake', strength: value });
    },
    on(key, callback) { listeners.set(key, callback); return () => listeners.delete(key); },
  } }, stage);
  const applyOriginalGates = gateController({ level: stage });

  function updateOriginalGates() {
    for (const def of data.encounters) if (def.doors) {
      const status = encounterStates.get(def.id) ?? (flags.has(def.flag) ? 'clear' : 'idle');
      applyOriginalGates({ def }, status);
    }
  }
  original.bind();
  updateOriginalGates();
  stage.liftRopes = ['lift_a', 'lift_b'].map(name => ({
    car: originalRoot.getObjectByName(name), rope: originalRoot.getObjectByName('rope_' + name),
  }));
  updateRopes(stage);

  const current = createChapterSixMechanisms(world, { encounterState: id => encounterStates.get(id),
    hasFlag: flag => flags.has(flag), onEvent: event => events.push(event) });
  const sync = bindChapterSixMechanismPresentation(root, current);
  return { world, originalWorld, current, original, root, originalRoot, flags, encounterStates, events, expectedEvents,
    reset() { current.reset(); original.bind(); updateOriginalGates(); updateRopes(stage); sync(); },
    inkStep() { current.inkStep(); listeners.get('player.inkStep')(); },
    ring() {
      const bell = original.get('lift_bell');
      const before = bell.rings;
      const result = current.ringLiftBell();
      targets.get('lift_bell').onHit({});
      assert.equal(result, before !== bell.rings);
      return result;
    },
    step(delta, position, bodyId) {
      const player = position && { ...position, carrier: bodyId ? world.body(bodyId) : null, drift: {} };
      originalPlayer = position && { ...position, carrier: bodyId ? originalWorld.body(bodyId) : null, drift: {} };
      const drift = current.step(delta, player);
      original.update(delta);
      updateOriginalGates();
      updateRopes(stage);
      sync();
      if (player) {
        assert.deepEqual(drift, originalPlayer.drift);
        assert.deepEqual(player.drift, originalPlayer.drift);
      }
      return { ...drift };
    },
  };
}

const bodyState = body => [body.x, body.y, body.z, body.yaw, body.pitch, body.roll, body.vx, body.vy, body.vz,
  body.enabled, body.moved, body.minX, body.maxX, body.minY, body.maxY, body.minZ, body.maxZ];
const poseState = node => [node.position.x, node.position.y, node.position.z,
  node.rotation.x, node.rotation.y, node.rotation.z, node.visible, node.scale.y];

function compareAll({ current, original, root, originalRoot }, compareGeometry = false) {
  const compareBodies = (actual, expected) => {
    assert.deepEqual(bodyState(actual), bodyState(expected), actual.id);
    if (compareGeometry) {
      const shape = triangle => [triangle.kind, triangle.surface, [...triangle.local], [...triangle]];
      assert.deepEqual(actual.tris.map(shape), expected.tris.map(shape), actual.id);
    }
  };
  const compareNodes = name => assert.deepEqual(poseState(root.getObjectByName(name)), poseState(originalRoot.getObjectByName(name)), name);
  for (const mechanism of current.list) {
    const expected = original.get(mechanism.id);
    if ('body' in mechanism) {
      compareBodies(mechanism.body, expected.body);
      if (mechanism.kind === 'crumble') assert.equal(mechanism.phase, expected.state);
    }
    if (mechanism.kind === 'lift') {
      assert.equal(mechanism.balance, expected.b);
      assert.equal(mechanism.hoistLeft, expected.hoistT);
      for (const [index, body] of mechanism.bodies.entries()) {
        compareBodies(body, expected.cars[index]);
        compareNodes(body.id);
        compareNodes('rope_' + body.id);
      }
    }
    if (mechanism.kind === 'wind') {
      assert.deepEqual([mechanism.phase, mechanism.shown, mechanism.flow, mechanism.pushing],
        [expected.state, expected.shown, expected.flow, !!expected.pushing], mechanism.id);
    }
    if (mechanism.kind === 'veil') assert.equal(mechanism.passable, expected.passable);
    if (mechanism.kind === 'bell') assert.equal(mechanism.rings, expected.rings);
    if ('node' in mechanism.definition) compareNodes(mechanism.definition.node);
  }
}

test('Summit installs the shipped mechanism data, surfaces, rope gaps, and moving body order', () => {
  const scene = fixture();
  assert.equal(scene.current.list.length, 17);
  assert.deepEqual(scene.current.list.map(mechanism => mechanism.definition), data.mechanisms);
  assert.deepEqual(scene.current.gates.map(gate => gate.definition), data.groups);
  assert.ok(data.ice.every(definition => !scene.world.body(definition.id)));
  compareAll(scene, true);
  assert.throws(() => createChapterSixMechanisms(scene.world), /corn_0 was already installed/);
});

test('the Summit lift matches rider direction, obstruction, bell cooldown, and hoist expiry', () => {
  const scene = fixture();
  const { lift } = scene.current;
  const [a, b] = lift.bodies;
  assert.deepEqual([a.y, b.y], [52.6, 70]);
  scene.step(1 / 60);
  assert.equal(scene.ring(), true);
  assert.equal(scene.ring(), false);
  for (let tick = 0; tick < 10; tick++) scene.step(1 / 60, { x: b.x, y: 68.4, z: b.z });
  assert.equal(lift.balance, 1);
  for (let tick = 0; tick < 840; tick++) {
    scene.step(1 / 60, { x: a.x, y: a.y, z: a.z }, a.id);
    if (tick % 19 === 0) compareAll(scene);
    if (tick === 600) assert.equal(a.y, 70);
  }
  assert.ok(a.y < 70);
  assert.deepEqual(scene.events, scene.expectedEvents);
  scene.reset();
  compareAll(scene);
});

test('fixed ticks preserve Summit bridge loading, tilt, crumbles and angled wind', () => {
  const scene = fixture();
  let feltWind = false, tilted = false;
  const phases = new Set();
  const corn = scene.current.get('corn_0');
  for (let tick = 0; tick < 1030; tick++) {
    const [position, body] = tick < 120 ? [{ x: 4, y: 50.4, z: -323 }, 'rope1']
      : tick < 240 ? [{ x: -36, y: 51.4, z: -321 }, 'floe1']
      : tick < 660 ? [corn.definition, tick < 290 ? 'corn_0' : undefined]
      : [{ x: 31, y: 32, z: -236 }, undefined];
    const drift = scene.step(1 / 60, position, body);
    if (tick >= 660 && drift.x < 0 && drift.z > 0 && drift.air === 2.2) feltWind = true;
    if (body === 'floe1' && drift.x !== 0 && drift.z !== 0) tilted = true;
    if (tick >= 240) phases.add(corn.phase);
    if (tick % 17 === 0) compareAll(scene);
  }
  assert.deepEqual([...phases], ['shaking', 'falling', 'gone', 'rising', 'whole']);
  assert.ok(feltWind && tilted);
  assert.deepEqual(scene.events, scene.expectedEvents);
  assert.strictEqual(scene.world.groundAt(corn.body.x, corn.body.z).body, corn.body);
});

test('Summit veil and encounter gates consume actor and flag commands without modifying ice ownership', () => {
  const scene = fixture();
  const veilRay = [-71, 53, -320, -1, 0, 0, 2, 2];
  const cairnIn = [31, 38, -277, 0, 0, -1, 2, 2];
  const cairnOut = [31, 38, -301, 0, 0, -1, 2, 2];
  const ray = (query, distance) => {
    assert.equal(scene.world.raycast(...query), distance);
    assert.equal(scene.originalWorld.raycast(...query), distance);
  };
  ray(veilRay, 1);
  scene.inkStep();
  ray(veilRay, Infinity);
  for (const state of ['DASH', 'DODGE', 'RUN']) {
    scene.step(1 / 60, { x: -71, y: 52.6, z: -320, state });
    ray(veilRay, state === 'RUN' ? 1 : Infinity);
  }
  ray(cairnIn, Infinity);
  ray(cairnOut, 1);
  scene.encounterStates.set('cairn', 'fighting');
  scene.step(1 / 60);
  ray(cairnIn, 1);
  ray(cairnOut, 1);
  scene.encounterStates.delete('cairn');
  scene.flags.add('ch6_cairn');
  scene.step(1 / 60);
  ray(cairnIn, Infinity);
  ray(cairnOut, Infinity);
  const ice = scene.world.addBody(data.ice[0].id, []);
  scene.current.dispose();
  scene.current.reset();
  assert.ok(ice.enabled);
  assert.ok(scene.current.lift.bodies.every(body => !body.enabled && !body.moved));
  assert.equal(scene.world.raycast(...veilRay), Infinity);
});
