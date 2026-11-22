import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { chapterOneInteractionSites, createChapterOneInteractions } from '../src/application/chapter-one-interactions.mts';
import { createRunProgress } from '../src/domain/run-progress.mts';
import { scrollCount, scrollTexts } from '../src/domain/scrolls.mts';
import { t as publishedPool, n as publishedPoolRadius } from '../sumiro/bundle/layout-BxJUyHwJ.js';
import { i as gateWorld } from '../sumiro/bundle/layout-BFL31pIQ.js';

const sites = chapterOneInteractionSites;
const archive = new URL('../sumiro/bundle/ch1_climb-D1obDXnH.js', import.meta.url);
const source = ts.createSourceFile(archive.pathname, await readFile(archive, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const topLevel = source.statements.flatMap(statement => ts.isVariableStatement(statement)
  ? [...statement.declarationList.declarations] : [statement]);
const level = topLevel.find(node => ts.isVariableDeclaration(node) && node.name.getText(source) === 'Z')?.initializer;
assert.ok(level && ts.isObjectLiteralExpression(level));

function at({ x, y = 0, z }, overrides = {}) {
  return { x, y, z, lastGroundY: y, grounded: true, state: 'IDLE', vx: 0, vz: 0, ...overrides };
}

function fixture(effects = {}) {
  const events = [];
  const commands = [];
  const interaction = createChapterOneInteractions({
    groundHeightAt: (x, z) => x === 9.2 && z === -40.5 ? 9.72 : 8.3,
    checkpoint(id) { commands.push(['checkpoint', id]); },
    collectScroll(id) { commands.push(['collect', id]); },
    learnInkStep() { commands.push(['learn']); },
    setGateBarrier(enabled) { commands.push(['barrier', enabled]); },
    tryAction(action, target) { commands.push(['act', action, target.id]); return true; },
    onEvent(event) { events.push(event); },
    ...effects,
  });
  return { interaction, commands, events };
}

test('sites match the shipped Chapter One definitions and authored pool geometry', () => {
  const read = name => {
    const property = level.properties.find(property => property.name?.getText(source) === name);
    assert.ok(property && ts.isPropertyAssignment(property));
    return structuredClone(runInNewContext(`(${property.initializer.getText(source)})`));
  };
  const originalShrines = read('shrines').map(({ stand, ...shrine }) => shrine);
  const [{ kind, ...originalScroll }] = read('entities');
  assert.equal(kind, 'scroll');
  assert.deepEqual(sites.shrines, originalShrines);
  assert.deepEqual(sites.scroll, originalScroll);
  assert.deepEqual(sites.pool, { id: 'pool', ...publishedPool, radius: publishedPoolRadius });
});

test('shrine rest requires an eligible ground pose, obeys combat, and writes the real checkpoint', () => {
  const store = new Map();
  const progress = createRunProgress({ getItem: key => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); } });
  const { interaction, events, commands } = fixture({ checkpoint: id => progress.checkpoint(id) });
  interaction.enter(progress.current);
  const table = at({ ...sites.shrines[0], y: 9.72 });
  interaction.update(0.1, { ...table, grounded: false }, { interact: true });
  assert.equal(interaction.near, null);
  interaction.update(0.1, { ...table, y: 9.72 - 1.601 }, { interact: true });
  assert.equal(interaction.near, null);
  interaction.update(0.1, { ...table, state: 'DRINK' }, { interact: true });
  assert.equal(interaction.near, null);
  interaction.update(0.1, table, { interact: true, fighting: true });
  assert.equal(interaction.near.id, 'table');
  assert.deepEqual(events.at(-1), { type: 'hint', text: 'Not while they’re here.', ms: 2400 });
  assert.equal(progress.current.shrine, null);
  interaction.update(0.1, table, { interact: true });
  assert.deepEqual(events.at(-1), { type: 'shrine-rested', id: 'table' });
  assert.equal(progress.current.shrine, 'table');
  assert.equal(JSON.parse(store.get('sumiro.save.v1')).shrine, 'table');
  interaction.update(0.1, table, { interact: true });
  interaction.update(0.1, { ...table, x: table.x - 2.4 });
  interaction.update(0.1, table, { interact: true });
  const tableActions = () => commands.filter(([type, , id]) => type === 'act' && id === 'table');
  assert.equal(tableActions().length, 1);
  interaction.update(0.1, { ...table, x: table.x - 2.6 });
  interaction.update(0.1, table, { interact: true });
  assert.equal(tableActions().length, 2);
});

test('the first scroll is the nearest authored target and can only be captured once', () => {
  let acceptInteraction = false;
  const { interaction, commands, events } = fixture({ tryAction: () => acceptInteraction });
  interaction.enter({ shrine: 'plateau', scrolls: ['dry_well'], flags: {} });
  assert.deepEqual(events.at(-1), { type: 'entry', litShrine: 'plateau', scrollCaptured: false, inkLearned: false });
  interaction.update(0.1, at(sites.scroll), { interact: true });
  assert.equal(interaction.near.id, 'first_mist');
  assert.deepEqual(commands, [['barrier', true]]);
  acceptInteraction = true;
  interaction.update(0.1, at(sites.scroll), { interact: true });
  assert.deepEqual(events.at(-1), { type: 'scroll-captured', id: 'first_mist', lines: scrollTexts.first_mist, count: 2, total: scrollCount });
  interaction.update(0.1, at(sites.scroll));
  assert.equal(interaction.near.id, 'table');
  assert.deepEqual(commands, [['barrier', true], ['collect', 'first_mist']]);
  interaction.enter({ shrine: null, scrolls: ['first_mist'], flags: {} });
  interaction.update(0.1, at(sites.scroll));
  assert.equal(interaction.near.id, 'table');
  assert.equal(events.filter(event => event.type === 'scroll-captured').length, 1);
});

test('pool reach can start a manual touch and respects height, ground, and play state', () => {
  const { interaction, commands } = fixture();
  interaction.enter();
  const besidePool = at({ ...sites.pool, x: sites.pool.x + 1.2 });
  interaction.update(0.25, { ...besidePool, y: sites.pool.y + 1.7 }, { interact: true });
  assert.equal(interaction.near, null);
  interaction.update(0.25, { ...besidePool, grounded: false }, { interact: true });
  assert.equal(interaction.near, null);
  interaction.update(0.25, besidePool, { playing: false, interact: true });
  assert.equal(interaction.near, null);
  interaction.update(0.25, besidePool);
  assert.equal(interaction.near.id, 'pool');
  assert.equal(interaction.inPool, true);
  assert.deepEqual(commands, [['barrier', true]]);
  interaction.update(1, besidePool, { interact: true });
  assert.deepEqual(commands.at(-1), ['act', 'TOUCH', 'pool']);
  interaction.update(1, besidePool, { playing: false });
  interaction.update(0.21, besidePool);
  assert.equal(commands.some(command => command[0] === 'learn'), false);
  interaction.update(0.21, besidePool);
  assert.deepEqual(commands.at(-1), ['learn']);
});

test('automatic pool contact unlocks ink, leads the camera, opens the gate, and allows exit', () => {
  const { interaction, commands, events } = fixture();
  interaction.enter();
  const pool = at(sites.pool, { state: 'LAND' });
  interaction.update(0.21, { ...pool, grounded: false });
  assert.deepEqual(commands, [['barrier', true]]);
  interaction.update(0.21, pool);
  assert.deepEqual(commands, [['barrier', true], ['act', 'TOUCH', 'pool']]);
  interaction.update(0.21, pool);
  assert.deepEqual(commands.at(-1), ['learn']);
  assert.equal(events.filter(event => event.type === 'pool-contact').length, 1);
  assert.equal(interaction.gatePhase, 'barred');
  interaction.update(2.45, pool);
  assert.deepEqual(events.at(-1), { type: 'camera-lead', target: { x: 12.6, z: -59.6, lift: 0.5, pitch: -3 } });
  const exit = at(gateWorld(0, 0, -2));
  interaction.update(0.8, exit);
  assert.equal(interaction.gatePhase, 'dropping');
  assert.equal(commands.at(-1)[0], 'learn');
  assert.equal(events.some(event => event.type === 'chapter-exit'), false);
  interaction.update(0.5, { ...exit, vx: 1.1 });
  assert.deepEqual(commands.at(-1), ['barrier', false]);
  assert.equal(events.filter(event => event.type === 'chapter-exit').length, 1);
  assert.deepEqual(events.filter(event => event.type === 'camera-lead').at(-1), { type: 'camera-lead', target: null });
  interaction.update(1.1, exit);
  assert.equal(interaction.gatePhase, 'open');
  assert.deepEqual(events.filter(event => event.type === 'hint').at(-1), {
    type: 'hint', text: 'Shift  Ink Step: a dodge on the ground, a dash in the air', ms: 6500,
  });
  interaction.update(2, exit);
  assert.equal(events.filter(event => event.type === 'chapter-exit').length, 1);
  assert.equal(commands.filter(command => command[0] === 'learn').length, 1);
});

test('entering with the saved ink flag restores the open gate without replaying the sequence', () => {
  const { interaction, commands, events } = fixture();
  interaction.enter({ shrine: 'plateau', scrolls: ['first_mist'], flags: { inkStep: true } });
  assert.equal(interaction.gatePhase, 'open');
  assert.deepEqual(commands, [['barrier', false]]);
  interaction.update(8, at(sites.pool), { interact: true });
  assert.equal(interaction.near, null);
  assert.equal(events.some(event => event.type === 'pool-contact' || event.type === 'hint'), false);
  assert.deepEqual(commands, [['barrier', false]]);
  interaction.enter({ shrine: null, scrolls: [], flags: {} });
  assert.equal(interaction.gatePhase, 'barred');
  assert.deepEqual(commands.at(-1), ['barrier', true]);
});
