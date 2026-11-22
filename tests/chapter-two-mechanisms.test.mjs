import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { chapterTwoMechanismSites, createChapterTwoMechanisms } from '../src/application/chapter-two-mechanisms.mts';
import { createCollisionWorld } from '../src/physics/world.mts';

const sites = chapterTwoMechanismSites;

function fixture() {
  const world = createCollisionWorld();
  const flags = new Set();
  const events = [];
  const mechanisms = createChapterTwoMechanisms(world, {
    hasFlag: flag => flags.has(flag), setFlag: flag => flags.add(flag), onEvent: event => events.push(event),
  });
  return { world, flags, events, mechanisms };
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);
const cues = events => events.filter(event => event.type === 'cue');

test('moving mechanism definitions agree with the shipped Chapter Two data', async () => {
  const url = new URL('../sumiro/bundle/ch2_pass-9Opjv4P2.js', import.meta.url);
  const source = ts.createSourceFile(url.pathname, await readFile(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const definitions = new Map();
  const clauses = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'B.push') clauses.push(node.getText(source));
    ts.forEachChild(node, visit);
  }
  // Only the top-level declarations own the chapter mechanism metadata.
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) for (const node of statement.declarationList.declarations) definitions.set(node.name.getText(source), node.getText(source));
    else if (ts.isExpressionStatement(statement)) visit(statement);
  }
  const selected = ['x', 'F', 'z', 'B', 'U', 'O', 'G', 'Ie'];
  const declarations = selected.map(name => { assert.ok(definitions.has(name), name); return definitions.get(name); });
  assert.equal(clauses.length, 2);
  const original = structuredClone(runInNewContext(`const W=()=>null; const ${declarations.join(',')}; ${clauses.join(';')}; ({B,Ie})`));
  const originalDoor = original.B.find(definition => definition.id === 'court_door');
  assert.deepEqual([sites.door.x, sites.door.y, sites.door.z, sites.door.width, sites.door.height],
    [originalDoor.x, originalDoor.y, originalDoor.z, originalDoor.width, originalDoor.height]);
  assert.deepEqual([sites.door.hinge, sites.door.leafWidth, sites.door.leafHeight], [original.Ie.hinge, original.Ie.w, original.Ie.h]);
  const originalSlab = original.B.find(definition => definition.id === 'court_slab');
  assert.deepEqual([[sites.slab.x, sites.slab.y, sites.slab.farZ], [sites.slab.x, sites.slab.y, sites.slab.nearZ]], originalSlab.path);
  assert.deepEqual([sites.slab.width, sites.slab.depth, sites.slab.thickness, sites.slab.speed, sites.slab.node],
    [...originalSlab.size, originalSlab.thick, originalSlab.speed, originalSlab.node]);
  assert.deepEqual(sites.bells, original.B.filter(definition => definition.kind === 'bell')
    .map(({ kind, r, flag, links, ...definition }) => ({ ...definition, radius: r })));
  assert.deepEqual(sites.crumbles, original.B.filter(definition => definition.kind === 'crumble')
    .map(({ kind, size, thick, ...definition }) => ({ ...definition, width: size[0], depth: size[1], thickness: thick })));
});

test('court bell cooldown, combat guard, and door collision follow fixed-step progress', () => {
  const { world, flags, events, mechanisms } = fixture();
  const door = mechanisms.door;
  const ray = () => world.raycast(14, 7, -36.6, 0, 0, -1, 5, 2);
  assert.equal(world.body('court_door'), door.body);
  near(ray(), 1);
  assert.equal(mechanisms.ringBell('court_bell', { fighting: true }), false);
  assert.deepEqual(cues(events), [{ type: 'cue', name: 'bell', pitch: 1.12 }]);
  assert.equal(flags.size, 0);
  assert.equal(mechanisms.ringBell('court_bell'), false);
  mechanisms.step(0.91);
  assert.equal(mechanisms.ringBell('court_bell'), true);
  assert.equal(flags.has('ch2_court_door'), true);
  mechanisms.step(0.4);
  near(door.progress, 0.5);
  near(door.leafAngle, 0.875);
  near(door.body.y, 7.9);
  assert.equal(door.body.enabled, true);
  mechanisms.step(0.17);
  assert.equal(door.body.enabled, false);
  assert.equal(ray(), Infinity);
  mechanisms.step(0.5);
  near(door.leafAngle, 1.75);
  flags.delete('ch2_court_door');
  mechanisms.step(0.8, { x: 14, y: 6, z: -37.6 });
  assert.equal(door.progress, 1);
  mechanisms.step(0.8);
  assert.equal(door.progress, 0);
  near(ray(), 1);
});

test('both slab bells switch the authored slab and stationary ticks clear the carry delta', () => {
  const { world, events, mechanisms } = fixture();
  const { slab } = mechanisms;
  const far = sites.slab.farZ;
  assert.equal(world.groundAt(sites.slab.x, far).body, slab.body);
  mechanisms.step(0.1);
  assert.deepEqual(events, []);
  assert.equal(mechanisms.ringBell('court_slab_bell', { catBlocksCrossing: true }), false);
  assert.deepEqual(events.at(-1), { type: 'hint', text: 'F  pick up the cat. It cannot cross on its own', ms: 4200 });
  assert.equal(slab.called, false);
  mechanisms.step(0.91);
  assert.equal(mechanisms.ringBell('court_slab_bell'), true);
  const rider = { x: sites.slab.x, y: sites.slab.y, z: far, carrier: slab.body };
  for (let index = 0; index < 4; index++) {
    mechanisms.step(0.25, rider);
    near(slab.body.vz, 4);
    slab.body.carry(rider);
  }
  near(rider.z, far + 4);
  mechanisms.step(1, rider);
  slab.body.carry(rider);
  near(rider.z, sites.slab.nearZ);
  assert.equal(world.groundAt(rider.x, rider.z).body, slab.body);
  mechanisms.step(0.1, rider);
  assert.equal(slab.body.moved, false);
  assert.equal(slab.body.vz, 0);
  slab.body.carry(rider);
  near(rider.z, sites.slab.nearZ);
  assert.equal(cues(events).filter(event => event.name === 'stoneStop').length, 1);
  assert.equal(mechanisms.ringBell('court_far_bell'), true);
  assert.equal(slab.called, false);
  mechanisms.step(2);
  near(slab.body.z, far);
});

test('riding an authored crumble shakes, removes collision, waits for clearance, and restores', () => {
  const { world, events, mechanisms } = fixture();
  assert.equal(mechanisms.crumbles.length, 13);
  const stone = mechanisms.crumbles[0];
  const player = { x: stone.x, y: stone.y, z: stone.z, carrier: stone.body };
  const hit = () => world.groundAt(stone.x, stone.z)?.body;
  assert.equal(hit(), stone.body);
  mechanisms.step(0.1, { ...player, carrier: null });
  assert.equal(stone.phase, 'whole');
  mechanisms.step(0.01, player);
  assert.equal(stone.phase, 'shaking');
  mechanisms.step(0.84, player);
  assert.equal(stone.phase, 'shaking');
  assert.notEqual(stone.pose.x, stone.x);
  mechanisms.step(0.02, player);
  assert.equal(stone.phase, 'falling');
  assert.equal(hit(), undefined);
  assert.deepEqual(events.slice(-2), [{ type: 'cue', name: 'crumbleFall' }, { type: 'shake', strength: 0.12 }]);
  mechanisms.step(0.7, player);
  assert.equal(stone.pose.visible, true);
  assert.ok(stone.pose.y < stone.y);
  mechanisms.step(0.61, player);
  assert.equal(stone.phase, 'gone');
  assert.equal(stone.pose.visible, false);
  mechanisms.step(5, player);
  assert.equal(stone.phase, 'gone');
  mechanisms.step(0.1, { ...player, x: player.x + 3 });
  assert.equal(stone.phase, 'rising');
  assert.equal(stone.pose.visible, true);
  near(stone.pose.y, stone.y - 1.2);
  mechanisms.step(0.25);
  near(stone.pose.y, stone.y - 0.6);
  assert.equal(hit(), undefined);
  mechanisms.step(0.25);
  assert.equal(stone.phase, 'whole');
  assert.equal(hit(), stone.body);
});

test('a checkpoint beyond the court restores the authored flags and teardown disables owned bodies', () => {
  const { world, flags, mechanisms } = fixture();
  mechanisms.enter({ chapter: 'ch2_pass', shrine: 'court', flags: {} });
  assert.equal(mechanisms.door.progress, 0);
  mechanisms.enter({ chapter: 'ch2_pass', shrine: 'first_holds', flags: {} });
  assert.deepEqual([...flags], ['ch2_sword_wraith', 'ch2_court_door']);
  assert.equal(mechanisms.door.progress, 1);
  assert.equal(mechanisms.slab.body.enabled, true);
  mechanisms.ringBell('court_slab_bell');
  mechanisms.step(0.1);
  assert.equal(mechanisms.slab.body.moved, true);
  mechanisms.dispose();
  mechanisms.reset();
  assert.equal(mechanisms.ringBell('court_far_bell'), false);
  assert.equal(mechanisms.slab.body.enabled, false);
  assert.equal(mechanisms.slab.body.moved, false);
  assert.equal(world.groundAt(sites.slab.x, sites.slab.farZ), null);
  assert.ok(mechanisms.crumbles.every(stone => !stone.body.enabled));
});
