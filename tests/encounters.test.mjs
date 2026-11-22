import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { chapterCombat, createEncounterController } from '../src/combat/encounters.mts';

async function getDeclarations(filename) {
  const url = new URL(`../sumiro/bundle/${filename}`, import.meta.url);
  const source = ts.createSourceFile(filename, await readFile(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = new Map(source.statements.flatMap(node => ts.isVariableStatement(node)
    ? [...node.declarationList.declarations] : [node]).map(node => [node.name?.getText(source), node]));
  const exact = name => {
    assert.ok(declarations.has(name), name);
    return declarations.get(name).getText(source);
  };
  const property = (name, key) => {
    const node = declarations.get(name)?.initializer.properties.find(member => member.name?.getText(source) === key);
    return node?.initializer.getText(source);
  };
  return { exact, property };
}

const levels = [
  ['ch1_climb-D1obDXnH.js', 'Z', []],
  ['ch2_pass-9Opjv4P2.js', 'Z', ['W', 'G', 'J']],
  ['ch3_pines-BCHma7IG.js', 'q', ['C']],
  ['ch4_temple-XtSLeUue.js', 'W', ['S', 'I', 'V', 'H', 'U']],
  ['ch5_sea-CpHUIhkX.js', 'q', ['x', 'C', 'N', 'I']],
  ['ch6_summit-BczK7QHX.js', 'q', ['x', 'ie', 'U', 'W']],
];
const originals = await Promise.all(levels.map(async ([filename, level, helpers]) => {
  const { exact, property } = await getDeclarations(filename);
  const combat = property(level, 'combat');
  return combat && Function(`const ${helpers.map(exact).join(',')}; return ${combat};`)();
}));
const originalCombat = await getDeclarations('combat-Dp_zXhrv.js');
const originalCollision = await getDeclarations('collision-DtBQEpmQ.js');

test('each chapter resolves the complete published combat catalogue exactly', () => {
  assert.deepEqual(Object.values(chapterCombat), originals);
  assert.deepEqual(originals.map(chapter => chapter?.encounters.length ?? 0), [0, 2, 2, 7, 6, 4]);
  assert.deepEqual([...new Set(originals.flatMap(chapter => chapter?.encounters.flatMap(
    encounter => encounter.waves.flatMap(wave => wave.map(actor => actor.kind)),
  ) ?? []))], ['wraith', 'archer', 'ronin']);
});

function capture() {
  const trace = [];
  const flags = new Set();
  return {
    trace, flags,
    setFlag: flag => { flags.add(flag); trace.push(['flag', flag]); },
    hasFlag: flag => flags.has(flag),
    cue: name => trace.push(['cue', name]),
    gate: (group, enabled) => trace.push(['group', group, enabled]),
    hint: (text, ms) => trace.push(['hint', text, ms]),
    hide: (center, def) => trace.push(['hide', center, def.id]),
    event: ({ type, id, wave }) => trace.push(['event', type, id, wave]),
    spawn: ({ id, riseTime, ...actor }) => trace.push(['spawn', actor, riseTime]),
  };
}

function sourceFixture(definitions) {
  const effects = capture();
  const actors = [];
  const released = [];
  const controller = createEncounterController(definitions, {
    ...effects,
    setGate: (gate, open) => effects.gate(gate.group, !open),
    hideCat: effects.hide,
    onEvent: event => { if (event.type !== 'defeated') effects.event(event); },
    spawn(actor, ticket) {
      actors.push(ticket);
      effects.spawn(actor);
      return () => released.push(ticket);
    },
  });
  return { ...effects, controller, actors, released };
}

function shippedFixture(definitions) {
  const effects = capture();
  const nodes = [];
  const group = {
    getObjectByName(key) {
      const node = { key, position: { y: 10 } };
      nodes.push(node);
      return node;
    },
  };
  const X = { level: { combat: { encounters: definitions }, world: { setGroup: effects.gate }, group },
    ctx: {}, encounters: [], clearing: false,
    cat: { hide: (center, entry) => effects.hide(center, entry.def), wavePoints: (entry, wave) => wave } };
  let current;
  const actors = [];
  const run = Function('X', '$', 'Vt', 'Ht', 'Q', 'Z', 'Kt', 'Yt', '$t', `
    ${originalCollision.exact('o')}
    const e = o;
    ${['Bt', 'zt', 'Xt', 'Zt', 'Qt', 'en', 'tn', 'dn'].map(originalCombat.exact).join('\n')}
    return { zt, Zt, en, tn, dn };
  `)(X, () => ({ hint: (text, { ms }) => effects.hint(text, ms) }), effects.hasFlag, effects.setFlag,
    () => current, (ctx, cue) => effects.cue(cue), effects.event, actor => {
      const handle = { alive: true, encounter: actor.encounter,
        riseUp(riseTime) { effects.spawn({ ...actor, riseTime }); } };
      actors.push(handle);
      return handle;
    }, () => {});
  run.dn();
  for (const entry of X.encounters) run.Zt(entry, entry.state, true);
  return { ...effects, actors, nodes, controller: {
    state: id => X.encounters.find(entry => entry.id === id)?.state,
    step(player, playing = true) {
      current = player;
      for (const entry of X.encounters) {
        if (playing && player.grounded && entry.state === 'idle' && run.zt(entry.def.start, player.x, player.z, player.y)) run.en(entry);
      }
    },
    defeat(actor) { actor.alive = false; run.tn(actor.encounter); },
  } };
}

test('grounded encounter starts, waves, clearance, saved flags and barriers match the shipped court lifecycle', () => {
  const native = sourceFixture(chapterCombat[5].encounters);
  const oracle = shippedFixture(structuredClone(originals[4].encounters));
  for (const side of [native, oracle]) {
    const { controller, actors } = side;
    assert.equal(controller.state('court'), 'idle');
    const center = { x: 125, y: 4, z: -499, grounded: true };
    controller.step({ ...center, x: 132 }); // Strict circle edge.
    controller.step({ ...center, grounded: false });
    controller.step(center, false);
    assert.equal(actors.length, 0);
    controller.step(center);
    assert.equal(controller.state('court'), 'fighting');
    assert.equal(actors.length, 2);
    controller.defeat(actors[0]);
    assert.equal(actors.length, 2);
    controller.defeat(actors[1]);
    assert.equal(actors.length, 5);
    for (let i = 2; i < 5; i++) controller.defeat(actors[i]);
    assert.equal(actors.length, 8);
    for (let i = 5; i < 8; i++) controller.defeat(actors[i]);
    assert.equal(controller.state('court'), 'clear');
    assert.ok(side.flags.has('ch5_court'));
  }
  assert.deepEqual(native.trace, oracle.trace);
  assert.equal(native.released.length, 8);
  assert.equal(native.controller.defeat(native.actors[0]), false);
  assert.equal(native.controller.defeat({ ...native.actors[7] }), false);
  native.controller.reset();
  assert.equal(native.controller.state('court'), 'clear');
  assert.deepEqual(native.trace.slice(-2), [['group', 'court_in', false], ['group', 'court_out', false]]);
});

test('polygon altitude, actor override leash, and ronin ID are passed to the injected spawner', () => {
  const archer = sourceFixture(chapterCombat[3].encounters);
  const oracle = shippedFixture(structuredClone(originals[2].encounters));
  const center = { x: -204, y: 26, z: -199, grounded: true };
  for (const side of [archer, oracle]) {
    side.controller.step({ ...center, y: 25.9 });
    assert.equal(side.actors.length, 0);
    side.controller.step(center);
    assert.equal(side.actors.length, 1);
  }
  assert.deepEqual(archer.trace, oracle.trace);
  assert.deepEqual(archer.trace.find(([type]) => type === 'spawn')[1].leash.poly[1], [-179, -214]);
  const ronin = sourceFixture(chapterCombat[6].encounters);
  ronin.controller.step({ x: -236, y: 86.4, z: -350, grounded: true });
  assert.equal(ronin.actors[0].id, 'ronin');
  assert.equal(ronin.actors[0].encounter, 'duel');
  assert.ok(ronin.controller.fighting('duel'));
});

test('reset and teardown release active resources and reject reports from prior generations', () => {
  const { controller, actors, released, flags } = sourceFixture(chapterCombat[2].encounters);
  const position = { x: 31, y: 39, z: -217, grounded: true };
  assert.equal(controller.start('missing'), false);
  assert.equal(controller.start('ridge', position), true);
  assert.equal(controller.start('ridge', position), false);
  const old = actors[0];
  controller.reset();
  assert.deepEqual(released, [old]);
  controller.step(position);
  assert.equal(controller.defeat(old), false);
  assert.equal(controller.defeat(actors[1]), true);
  assert.equal(controller.state('ridge'), 'fighting');
  controller.dispose();
  controller.dispose();
  assert.deepEqual(released, actors);
  assert.equal(controller.defeat(actors[2]), false);
  assert.equal(controller.start('ridge'), false);
  assert.equal(controller.fighting(), false);
  assert.equal(flags.has('ch2_ridge'), false);
});

test('failed activation releases a partially spawned wave and restores idle gates for retry', () => {
  const court = chapterCombat[5].encounters.find(encounter => encounter.id === 'court');
  const tickets = [];
  const released = [];
  const gates = [];
  let fail = true;
  const controller = createEncounterController([court], {
    spawn(actor, ticket) {
      tickets.push(ticket);
      if (fail && tickets.length === 2) throw Error('unavailable actor model');
      return () => released.push(ticket);
    },
    setGate: (gate, open, immediate) => gates.push([gate.group, open, immediate]),
  });
  assert.throws(() => controller.start('court'), /unavailable actor model/);
  assert.deepEqual(released, [tickets[0]]);
  assert.equal(controller.state('court'), 'idle');
  assert.deepEqual(gates.slice(-2), [['court_in', true, true], ['court_out', false, true]]);
  assert.equal(controller.defeat(tickets[0]), false);
  assert.equal(controller.defeat(tickets[1]), false);
  fail = false;
  assert.equal(controller.start('court'), true);
  assert.equal(controller.state('court'), 'fighting');
  assert.equal(tickets.length, 4);
});
