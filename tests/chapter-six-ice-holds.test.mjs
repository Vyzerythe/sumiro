import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Group } from 'three';
import ts from 'typescript';
import { createChapterSixIceHolds } from '../src/application/chapter-six-ice-holds.mts';
import { createChapterSixTraversal } from '../src/application/chapter-six-ledges.mts';
import { createChapterSixWorld } from '../src/application/chapter-six-world.mts';
import { createLedgePath } from '../src/player/ledge-path.mts';

const sourcePath = new URL('../sumiro/bundle/ch6_summit-BczK7QHX.js', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
const ast = ts.createSourceFile(sourcePath.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = new Map(ast.statements.flatMap(node => ts.isVariableStatement(node)
  ? [...node.declarationList.declarations] : [node]).map(node => [node.name?.getText(ast), node]));
const exact = name => { assert.ok(declarations.has(name), name); return declarations.get(name).getText(ast); };
const start = source.indexOf('var b={discs:');
assert.ok(start >= 0);
const original = Function('v', `${source.slice(start, declarations.get('q').getEnd())};
  const ${['_e', 'Q', 've'].map(exact).join(',')};
  ${['$e', 'et', 'tt'].map(exact).join('\n')}
  return { bodies: de, prepare: $e, reset: et, step: tt };`)(() => {});

const asset = await readFile(new URL('../sumiro/assets/levels/ch6_summit/props.glb', import.meta.url));
assert.equal(asset.toString('ascii', 0, 4), 'glTF');
assert.equal(asset.toString('ascii', 16, 20), 'JSON');
const props = JSON.parse(asset.toString('utf8', 20, 20 + asset.readUInt32LE(12)));

function presentationFixture() {
  const root = new Group();
  const names = original.bodies.map(body => `hold_${body.id.slice('body_'.length)}`);
  for (const name of names) {
    const definition = props.nodes.find(node => node.name === name);
    assert.ok(definition, name);
    const node = new Group();
    node.name = name;
    node.position.fromArray(definition.translation ?? [0, 0, 0]);
    if (definition.rotation) node.quaternion.fromArray(definition.rotation);
    root.add(node);
  }
  return root;
}

test('all authored Chapter Six grips bind to fixed empty bodies without adding ground', () => {
  const { world } = createChapterSixWorld();
  const samples = original.bodies.map(({ path: [[x, , z]] }) => {
    const ground = world.groundAt(x, z);
    return ground && { ...ground };
  });
  const ice = createChapterSixIceHolds(world);
  assert.equal(ice.holds.length, 5);
  const traversal = createChapterSixTraversal(world);
  assert.equal(traversal.ledges.length, 10);
  assert.deepEqual(traversal.skippedBodyIds, []);
  for (const [index, hold] of ice.holds.entries()) {
    const reference = original.bodies[index];
    const { body, pose } = hold;
    assert.equal(hold.bodyId, reference.id);
    assert.deepEqual([body.x, body.y, body.z], reference.path[0]);
    assert.deepEqual(body.tris, reference.parts);
    assert.equal(body.enabled, true);
    assert.equal(body.moved, false);
    assert.deepEqual([pose.x, pose.y, pose.z], reference.path[0]);
    assert.deepEqual(world.groundAt(body.x, body.z), samples[index]);
    const ledge = traversal.ledges.find(ledge => ledge.id === hold.id);
    assert.strictEqual(ledge.body, body);
    const path = createLedgePath(ledge);
    assert.equal(path.at(path.length / 2).y, body.y);
  }
  assert.throws(() => createChapterSixIceHolds(world), /already installed/);
});

test('wobble, sag, detached fall, reappearance and teleport reset match the shipped ice update', () => {
  const { world } = createChapterSixWorld();
  const { world: expectedWorld } = createChapterSixWorld();
  const actualRoot = presentationFixture();
  const expectedRoot = presentationFixture();
  const events = [];
  const expectedEvents = [];
  const ice = createChapterSixIceHolds(world, { onEvent: event => events.push(event) });
  ice.bindPresentation(actualRoot);
  for (const { id, path: [[x, y, z]], parts } of original.bodies) expectedWorld.addBody(id, parts).setPose(x, y, z);
  const expected = { group: expectedRoot, world: expectedWorld, iceTeleports: -1 };
  const registry = { set(key, value) {
    expectedEvents.push(key === 'audio.cue' ? { type: 'cue', name: value.name } : { type: 'shake', strength: value });
  } };
  original.prepare({}, expected);
  original.reset(expected);

  function compare(delta, state, id = 'ice_a1', teleports = 0) {
    const player = { state, ledge: { id }, teleports };
    ice.step(delta, player);
    original.step(delta, { registry }, expected, player);
    for (const [index, hold] of ice.holds.entries()) {
      const prior = expected.ice[index];
      const node = actualRoot.getObjectByName(hold.nodeName);
      assert.equal(hold.phase, prior.state, hold.id);
      assert.equal(hold.body.enabled, expectedWorld.body(hold.bodyId).enabled, hold.id);
      assert.deepEqual(node.position.toArray(), prior.node.position.toArray(), hold.id);
      assert.equal(node.rotation.z, prior.node.rotation.z, hold.id);
      assert.equal(node.visible, prior.node.visible, hold.id);
      assert.deepEqual([hold.body.x, hold.body.y, hold.body.z], original.bodies[index].path[0]);
      assert.equal(hold.body.moved, false);
    }
    assert.deepEqual(events, expectedEvents);
  }

  compare(0.25, 'CLIMB');
  assert.equal(ice.holds[0].phase, 'whole');
  compare(1 / 60, 'GRAB');
  compare(1.28, 'SHIMMY');
  assert.equal(events.length, 0);
  compare(0.01, 'WALK'); // Letting go does not stop the countdown.
  assert.equal(ice.holds[0].phase, 'holding');
  assert.equal(ice.holds[0].body.enabled, true);
  compare(1.92, 'WALK');
  assert.equal(ice.holds[0].phase, 'falling');
  assert.equal(ice.holds[0].body.enabled, false);
  compare(0.5, 'WALK');
  assert.ok(ice.holds[0].pose.rotationZ > 0);
  compare(0.7, 'WALK'); // Exactly 1.2 seconds is still visible.
  assert.equal(ice.holds[0].pose.visible, true);
  compare(0.01, 'WALK');
  assert.equal(ice.holds[0].pose.visible, false);
  compare(4.49, 'WALK');
  assert.equal(ice.holds[0].phase, 'gone');
  compare(0.02, 'WALK');
  assert.equal(ice.holds[0].phase, 'whole');
  compare(0.1, 'HANG', 'f2');
  assert.equal(ice.holds.find(hold => hold.id === 'f2').phase, 'holding');
  compare(1.4, 'HANG', 'f2');
  compare(0.1, 'IDLE', 'f2', 1);
  assert.ok(ice.holds.every(hold => hold.phase === 'whole' && hold.body.enabled));
});

test('binding fails before mutating a partial stage and teardown restores the borrowed presentation', () => {
  const { world } = createChapterSixWorld();
  const ice = createChapterSixIceHolds(world);
  const root = presentationFixture();
  const missing = root.children.at(-1);
  missing.removeFromParent();
  const first = root.children[0];
  first.position.set(1, 2, 3);
  first.rotation.z = 0.3;
  first.visible = false;
  assert.throws(() => ice.bindPresentation(root), /missing/);
  assert.deepEqual(first.position.toArray(), [1, 2, 3]);
  root.add(missing);
  ice.bindPresentation(root);
  assert.equal(first.visible, true);
  assert.deepEqual(first.position.toArray(), [ice.holds[0].body.x, ice.holds[0].body.y, ice.holds[0].body.z]);
  ice.dispose();
  ice.dispose();
  ice.reset();
  ice.step(4, { state: 'HANG', ledge: { id: ice.holds[0].id } });
  assert.deepEqual(first.position.toArray(), [1, 2, 3]);
  assert.equal(first.rotation.z, 0.3);
  assert.equal(first.visible, false);
  assert.ok(ice.holds.every(hold => !hold.body.enabled));
});
