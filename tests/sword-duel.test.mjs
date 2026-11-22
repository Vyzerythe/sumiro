import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { createChapterTwoWorld } from '../src/application/chapter-two-world.mts';
import { canParrySwordBlow, createSwordDuel, swordCuts, swordWraithEncounter, swordWraithPatterns } from '../src/combat/sword-duel.mts';

async function parseBundle(name) {
  const file = new URL(`../sumiro/bundle/${name}`, import.meta.url);
  return ts.createSourceFile(file.pathname, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function declarations(source, names) {
  const map = new Map(source.statements.flatMap(node => ts.isVariableStatement(node)
    ? [...node.declarationList.declarations] : [node]).map(node => [node.name?.getText(source), node]));
  return names.map(name => { assert.ok(map.has(name), name); return map.get(name).getText(source); }).join(',');
}

const bundle = await parseBundle('combat-Dp_zXhrv.js');
const timing = Function(`const ${declarations(bundle, ['Qe', 'ie', 'ae', 'be', 'J', 'tt', 'nt'])}; return { Qe, ie, ae, be, J, tt, nt };`)();

const FRAME = 1 / 120;
function pose(x, z, extra = {}) {
  return { x, y: 6, z, heading: 0, state: 'WALK', stateT: 1, grounded: true, ...extra };
}

function fixture(random = () => 0) {
  const { world } = createChapterTwoWorld();
  const events = [];
  const duel = createSwordDuel(world, { random, onEvent: event => events.push(event) });
  const close = () => pose(duel.enemy.x, duel.enemy.z + 1.65, { y: duel.enemy.y });
  const step = (input = {}) => duel.step(FRAME, close(), input);
  const until = (predicate, limit = 900) => {
    for (let count = 0; count < limit && !predicate(); count++) step();
    assert.ok(predicate(), `phase=${duel.phase} player=${duel.player.action} frame=${duel.player.frame} enemy=${duel.enemy.action} hitIn=${duel.enemy.hitIn}`);
  };
  function start(strokes = 5) {
    duel.reset({ strokes });
    duel.step(FRAME, pose(14, -31));
    until(() => duel.enemy.action === 'CHASE');
    step();
    assert.equal(duel.player.swordOut, true);
  }
  return { events, duel, step, until, start };
}

test('authored court region, spawn, health, combo frames and both sword-wraith patterns match shipped data', async () => {
  assert.deepEqual(swordCuts, timing.Qe);
  assert.deepEqual(swordWraithPatterns, { overhead: timing.ie, sweep: timing.ae });
  assert.equal(swordWraithEncounter.health, timing.be.wraith.hp);
  const chapter = await parseBundle('ch2_pass-9Opjv4P2.js');
  let combat;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(chapter) === 'combat' && node.getText(chapter).includes('sword_wraith')) combat = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(chapter);
  assert.ok(combat);
  // The second encounter's separate bounding box is outside this unit.
  const original = Function(`const ${declarations(chapter, ['W', 'G'])}; const J=()=>[]; return ${combat.getText(chapter)};`)();
  const first = original.encounters[0];
  const [{ kind, ...spawn }] = first.waves[0];
  assert.equal(kind, 'wraith');
  assert.deepEqual(swordWraithEncounter.spawn, spawn);
  assert.deepEqual(swordWraithEncounter.start, first.start.poly);
  assert.deepEqual(swordWraithEncounter.leash, first.leash.poly);
  assert.equal(swordWraithEncounter.hint, first.hint);
  assert.equal(swordWraithEncounter.flag, first.flag);
  assert.deepEqual(swordWraithEncounter.tempo, original.tempo);
});

test('parry time and facing boundaries execute the original parrying predicate', () => {
  let original;
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(bundle) === 'parrying') original = node.getText(bundle);
    ts.forEachChild(node, visit);
  }
  visit(bundle);
  assert.ok(original);
  const bind = Function('s', 'J', 'tt', 'nt', `return ({${original}}).parrying;`);
  for (const action of ['IDLE', 'ATTACK', 'PARRY']) {
    for (const elapsed of [0.049, 0.05, 0.12, 0.269, 0.27, 0.271]) {
      const player = { action, elapsed, x: 0, z: 0, heading: 0.2 };
      const originalParry = bind({ ...player, state: action, stateT: elapsed }, timing.J, timing.tt, timing.nt);
      for (const [x, z] of [[0, 0], [0, -2], [-2, 1], [2, 0], [0, 2], [-3, 0], [1.75, -0.05]]) {
        assert.equal(canParrySwordBlow(player, { x, z }), originalParry(x, z), JSON.stringify({ action, elapsed, x, z }));
      }
    }
  }
});

test('only grounded entry while playing starts the authored encounter, and its rise protects the wraith', () => {
  const { duel, events } = fixture();
  duel.step(FRAME, pose(14, -20));
  duel.step(FRAME, pose(14, -30, { grounded: false }));
  duel.step(FRAME, pose(14, -30), { playing: false });
  assert.equal(duel.phase, 'idle');
  duel.step(FRAME, pose(14, -32), { attack: true });
  assert.equal(duel.phase, 'fighting');
  assert.equal(duel.enemy.action, 'RISING');
  assert.equal(duel.player.action, 'DRAW');
  for (let i = 0; i < 75; i++) duel.step(FRAME, pose(14, -32));
  assert.equal(duel.enemy.hp, 6);
  assert.equal(events.filter(event => event.type === 'encounter-start').length, 1);
  duel.reset({ cleared: true });
  duel.step(1, pose(14, -30));
  assert.equal(duel.phase, 'clear');
  assert.equal(duel.enemy.visible, false);
});

test('buffered one-two-three cuts deal their authored damage once and a second combo clears the duel', () => {
  const { duel, events, step, start, until } = fixture();
  start();
  const hits = () => events.filter(event => event.type === 'wraith-hit');
  step({ attack: true });
  until(() => duel.player.combo === 1 && duel.player.frame >= 8);
  step({ attack: true });
  until(() => duel.player.combo === 2 && duel.player.frame >= 7);
  step({ attack: true });
  until(() => hits().length === 3);
  assert.deepEqual(hits().map(({ combo, amount, hp }) => [combo, amount, hp]), [[1, 1, 5], [2, 1, 4], [3, 2, 2]]);
  until(() => duel.player.action === 'IDLE');
  step({ attack: true });
  until(() => duel.player.combo === 1 && duel.player.frame >= 8);
  step({ attack: true });
  until(() => duel.phase === 'clear');
  assert.equal(duel.enemy.hp, 0);
  assert.equal(duel.enemy.action, 'DEAD');
  assert.deepEqual(events.filter(event => event.type === 'encounter-clear'), [
    { type: 'encounter-clear', id: 'sword_wraith', flag: 'ch2_sword_wraith' },
  ]);
  until(() => !duel.enemy.visible);
  assert.equal(events.filter(event => event.type === 'encounter-clear').length, 1);
});

test('telegraphed strikes can be parried and riposted, while an unguarded strike causes hit recovery and defeat', () => {
  const { duel, events, step, start, until } = fixture();
  start();
  until(() => duel.enemy.pattern === 'overhead');
  assert.ok(Math.abs(duel.enemy.hitIn - ((timing.ie.beats[0].time + timing.ie.beats[1].time) * 0.72 + 0.075)) < 1e-9);
  until(() => duel.enemy.hitIn !== null && duel.enemy.hitIn < 0.15);
  step({ parry: true });
  until(() => duel.player.riposte > 0);
  assert.equal(duel.player.strokes, 5);
  assert.equal(duel.enemy.action, 'STAGGER');
  step({ attack: true });
  until(() => duel.enemy.hp === 3);
  assert.equal(events.find(event => event.type === 'wraith-hit').combo, 'riposte');

  start(2);
  until(() => duel.player.action === 'HIT');
  assert.equal(duel.player.strokes, 1);
  until(() => duel.player.action === 'IDLE');
  until(() => duel.phase === 'defeated');
  assert.equal(duel.player.strokes, 0);
  assert.equal(duel.player.action, 'DEATH');
  assert.deepEqual(events.filter(event => event.type === 'player-hurt').map(event => event.strokes), [1, 0]);
});
