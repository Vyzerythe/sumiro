import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { chapterFourMechanismSites, createChapterFourMechanisms } from '../src/application/chapter-four-mechanisms.mts';
import { createChapterFourWorld } from '../src/application/chapter-four-world.mts';

const url = new URL('../sumiro/bundle/ch4_temple-XtSLeUue.js', import.meta.url);
const ast = ts.createSourceFile(url.pathname, await readFile(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = new Map(ast.statements.flatMap(node => ts.isVariableStatement(node)
  ? [...node.declarationList.declarations] : [node]).map(node => [node.name?.getText(ast), node]));
const exact = name => { assert.ok(declarations.has(name), name); return declarations.get(name).getText(ast); };
const level = declarations.get('W').initializer;
const property = name => {
  const member = level.properties.find(node => node.name?.getText(ast) === name);
  assert.ok(member && ts.isPropertyAssignment(member), name);
  return member.initializer.getText(ast);
};
const originalMechs = Function(`return ${property('mechs')};`)();
const originalGates = Function(`const ${exact('ye')}; return ye;`)();
const originalEncounters = Function(`const ${['S', 'I', 'V', 'H', 'U'].map(exact).join(',')}; return (${property('combat')}).encounters;`)();
const originalFlow = Function('Le', 'g', `const ${exact('S')}; ${exact('He')}; return He;`)(() => {}, () => false);
const originalGatesStep = Function(`${exact('Oe')} ${exact('ke')} return ke;`)();

const player = { x: 30, y: 59, z: -448 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);

function fixture() {
  const { world } = createChapterFourWorld();
  const flags = new Set();
  const states = new Map();
  const events = [];
  const driver = createChapterFourMechanisms(world, {
    hasFlag: flag => flags.has(flag), setFlag: flag => flags.add(flag), encounterState: id => states.get(id),
    onEvent: event => events.push(event),
  });
  return { world, flags, states, events, driver };
}

test('all body, bell, moving stage, collision-group, and leaf definitions match shipped records', () => {
  for (const [name, kind] of [['doors','door'], ['bells','bell'], ['platforms','platform'], ['crumbles','crumble']]) {
    const original = originalMechs.filter(item => item.kind === kind).map(({ kind, ...item }) => item);
    assert.deepEqual(chapterFourMechanismSites[name], original, name);
  }
  assert.deepEqual(chapterFourMechanismSites.lifts, originalMechs.filter(item => item.kind === 'lift').map(({ kind, cars, ...item }) => ({
    ...item, cars: cars.map(({ x, z }) => [x, z]),
  })));
  assert.deepEqual(chapterFourMechanismSites.gates, originalGates);
  assert.deepEqual(chapterFourMechanismSites.encounters, Object.fromEntries(originalEncounters.map(({ id, flag, doors }) => [id, {
    flag, doors: (doors ?? []).map(({ group, startsOpen }) => ({ group, startsOpen: Boolean(startsOpen) })),
  }])));
});

test('the west/east pair emits the original hint and opens the great door only after both saved flags', () => {
  const { world, flags, states, events, driver } = fixture();
  const great = driver.doors.find(door => door.id === 'great_door');
  const view = driver.gates.find(gate => gate.id === 'g_great');
  const ray = () => world.raycast(30, 60.8, -451, 0, 0, -1, 3, 2);
  assert.ok(ray() < Infinity);

  const referenceEvents = [];
  const referenceFlags = new Set();
  const game = { story: true, flag: flag => referenceFlags.has(flag), setFlag: flag => referenceFlags.add(flag),
    hint: (text, { ms }) => referenceEvents.push({ type: 'hint', text, ms }) };
  const registry = { get(name) { return { 'game': game, 'game.state': 'PLAY', 'player.body': { c: { grounded: false } } }[name]; },
    set(key, value) { referenceEvents.push(key === 'audio.cue' ? { type: 'cue', name: value.name } : { type: 'shake', strength: value }); } };
  const level = { flow: { ended: false, great: false }, triggers: [{ id: 'road_on', poly: [] }] };

  states.set('great', 'fighting');
  assert.equal(driver.ringBell('b_gw'), false);
  assert.equal(flags.has('ch4_gd_w'), false);
  states.set('great', 'clear');
  assert.equal(driver.ringBell('b_gw'), true);
  assert.equal(flags.has('ch4_gd_w'), true);
  assert.equal(driver.ringBell('b_gw'), false);
  referenceFlags.add('ch4_gd_w');
  driver.step(0.1, player);
  originalFlow(0.1, { registry }, level);
  assert.equal(great.progress, 0);
  driver.step(0.1, player);
  originalFlow(0.1, { registry }, level);
  assert.equal(driver.ringBell('b_ge'), true);
  referenceFlags.add('ch4_gd_e');
  driver.step(0.1, player);
  originalFlow(0.1, { registry }, level);
  assert.deepEqual([...flags], [...referenceFlags]);
  assert.deepEqual(events.filter(event => event.type === 'hint' || event.name === 'gate' || event.strength === 0.25), referenceEvents);
  assert.equal(great.progress, 0);
  driver.step(1.1, player);
  near(great.progress, 0.5);
  near(great.body.y, 59 + 6.6 / 2);
  near(view.leftYaw, 0.875);
  driver.step(1.1, player);
  assert.equal(great.body.enabled, false);
  assert.equal(ray(), Infinity);

  states.set('hall', 'fighting');
  driver.step(2, player);
  assert.equal(great.body.enabled, false);
  assert.equal(view.progress, 0);
  assert.ok(ray() < Infinity); // The separate encounter group closed the hall.
  states.set('hall', 'clear');
  driver.step(2, player);
  assert.equal(ray(), Infinity);
  assert.equal(view.progress, 1);
});

test('combat barriers and leaf angles follow authored idle, fighting, and cleared phases', () => {
  const { world, flags, states, driver } = fixture();
  const pairs = [
    ['forecourt', [30, 26, -144]], ['court1', [30, 26, -176], [30, 26, -200]],
    ['court2', [79, 45, -318], [62, 45, -331]], ['great', [30, 60, -420]],
    ['hall', [30, 60, -452], [30, 60, -508]],
  ];
  const reference = { mech: { get: id => ({ k: driver.doors.find(door => door.id === id)?.progress ?? 0 }) },
    gates: originalGates.map(def => ({ def, k: null, left: { rotation: {} }, right: { rotation: {} } })) };
  const registry = { get: () => ({ encounter: id => ({ state: states.get(id) ?? 'idle' }) }) };
  const sample = (dt = 0.1) => {
    driver.step(dt);
    originalGatesStep(dt, { registry }, reference);
    for (const [index, gate] of driver.gates.entries()) {
      near(gate.progress, reference.gates[index].k);
      near(gate.leftYaw, reference.gates[index].left.rotation.y);
      near(gate.rightYaw, reference.gates[index].right.rotation.y);
    }
  };
  const reach = (point, sideways = false) => {
    const [x, y, z] = point;
    return world.raycast(x + (sideways ? 0.5 : 0), y, z + (sideways ? 0 : 0.5), sideways ? -1 : 0, 0, sideways ? 0 : -1, 1, 2);
  };
  flags.add('ch4_great_door');
  driver.reset();
  sample();
  for (const [id, entry, exit] of pairs) {
    assert.equal(reach(entry), Infinity, id);
    if (exit) assert.ok(reach(exit, id === 'court2') < Infinity, id);
    states.set(id, 'fighting');
    sample();
    assert.ok(reach(entry) < Infinity, id);
    states.set(id, 'clear');
    sample();
    assert.equal(reach(entry), Infinity, id);
    if (exit) assert.equal(reach(exit, id === 'court2'), Infinity, id);
  }
});

test('platform-only bells work in fights, lift bells hoist paired cars, and the race door closes after its six-second pulse', () => {
  const { world, states, driver } = fixture();
  const slab = driver.platforms.find(platform => platform.id === 's1');
  const poolLift = driver.lifts.find(lift => lift.id === 'l1');
  const race = driver.doors.find(door => door.id === 'race_door');
  states.set('mid_guard', 'fighting');
  assert.equal(driver.ringBell('b1'), true);
  assert.equal(driver.ringBell('b_l1'), false);
  driver.step(0.5);
  near(slab.body.z, -249.9 + 3.5);
  near(slab.body.vz, 7);
  assert.equal(world.groundAt(slab.body.x, slab.body.z).body, slab.body);
  assert.equal(poolLift.balance, 0);
  states.set('mid_guard', 'clear');
  assert.equal(driver.ringBell('b_l1'), true);
  driver.step(1);
  near(poolLift.bodies[0].y, 35);
  near(poolLift.bodies[1].y, 33);
  assert.equal(driver.ringBell('b_race'), true);
  driver.step(0.4);
  assert.equal(race.progress, 1);
  assert.equal(race.body.enabled, false);
  driver.step(5.7);
  assert.equal(race.progress, 0);
  assert.equal(race.body.enabled, true);
  near(slab.body.z, -222.1);
  driver.step(0.1);
  assert.equal(slab.body.moved, false);
  assert.equal(slab.body.vz, 0);
  driver.dispose();
  assert.ok([...driver.doors, ...driver.platforms, ...driver.crumbles].every(({ body }) => !body.enabled));
});
