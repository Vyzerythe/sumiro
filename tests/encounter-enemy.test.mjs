import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { createEncounterEnemy } from '../src/combat/encounter-enemy.mts';

const source = await readFile(new URL('../sumiro/bundle/combat-Dp_zXhrv.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('combat-Dp_zXhrv.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = new Map(ast.statements.flatMap(item => ts.isVariableStatement(item) ? [...item.declarationList.declarations] : [item])
  .map(item => [item.name?.getText(ast), item]));
const exact = name => {
  assert.ok(declarations.has(name), name);
  return declarations.get(name).getText(ast);
};
const original = Function(`const ${['ie','ae','R','z','oe','se','ce','le','ue','de','fe','be','Pe','Ae','Me','Ne','Ie','Le','Re','ze'].map(exact).join(',')};
  ${exact('H').startsWith('H=') ? `const ${exact('H')};` : exact('H')}
  ${exact('Be')}
  ${exact('pe')}
  return { wraith: [ie, ae], ronin: fe, stats: be, floors: Pe, arrowSpeed: Ae, drawTime: Me, aimLock: Ne, scale: Be, windup: Le, clamp: H, hitIn: pe };
`)();

const tick = .0025;
const base = { x: 0, y: 0, z: 0 };
const target = { x: 0, y: 0, z: -1.8 };
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
const makeEnemy = (kind, options = {}, spawn = {}) => createEncounterEnemy({
  ...base, id: kind + '_test', kind, heading: 0, encounter: 'test', leash: { circle: [0, 0, 25] },
  aggro: 99, riseTime: .9, ...spawn,
}, options);

function until(enemy, player, predicate, maximum = 8) {
  for (let elapsed = 0; elapsed <= maximum; elapsed += tick) {
    if (predicate()) return elapsed;
    enemy.step(tick, player);
  }
  assert.fail(`Timed out in ${enemy.state.state} / ${enemy.state.move}`);
}

test('both wraith attacks use shipped clip and frame timing and a parry cancels the strike', () => {
  for (const [index, random] of [[0, .25], [1, .8]]) {
    const hits = [];
    const events = [];
    const tempo = { windup: 1.1, cooldown: 1.15 };
    const enemy = makeEnemy('wraith', { random: () => random, tempo,
      onAttack(attack, state) {
        hits.push({ attack, frame: state.frame, clip: state.clip });
        return 'parried';
      },
      onEvent: event => events.push(event),
    });
    const { state } = enemy;
    assert.equal(state.hp, original.stats.wraith.hp);
    assert.equal(enemy.damage({ dmg: 1 }), null);
    enemy.step(.45, target);
    close(state.yOffset, -.474609375);
    close(state.dissolve, .5);
    enemy.step(.45, target);
    assert.equal(state.state, 'CHASE');
    const move = original.wraith[index];
    until(enemy, target, () => state.state === 'MOVE');
    assert.equal(state.move, move.id);
    assert.equal(state.clip, move.beats[0].clip);
    assert.equal(state.frame, move.beats[0].from);
    const scaled = original.scale(move, original.clamp(tempo.windup * original.windup, .5, 2));
    const authored = original.hitIn({ def: scaled, beat: 0, t: 0, hitDone: false });
    const elapsed = until(enemy, target, () => !!hits.length);
    close(elapsed, authored, tick * 3);
    const hit = move.beats.find(beat => beat.hit).hit;
    assert.equal(hits[0].attack.type, 'melee');
    for (const key of ['reach','arc','dmg','parryable']) assert.equal(hits[0].attack[key], hit[key]);
    assert.equal(hits[0].clip, move.beats[0].clip);
    assert.ok(hits[0].frame >= hit.key && hits[0].frame < hit.key + .1);
    assert.equal(state.state, 'STAGGER');
    assert.equal(state.opening, true);
    assert.equal(state.clip, 'hit');
    enemy.step(1.49, target);
    assert.equal(state.state, 'STAGGER');
    enemy.step(.02, target);
    assert.equal(state.state, 'CHASE');
    assert.equal(hits.length, 1);
    assert.deepEqual(events.map(event => event.name), ['inkRise', 'wraithBeat', 'wraithCut']);
  }
});

test('archer requires line of sight, locks aim before release, and issues an authored-speed arrow once', () => {
  let blocked = true;
  const player = { x: 0, y: 1, z: -10 };
  const arrows = [];
  const events = [];
  const leftHand = { x: .35, y: 1.5, z: -.45 };
  const enemy = makeEnemy('archer', {
    random: () => .2,
    tempo: { windup: 1, cooldown: 1 },
    world: { groundAt: () => ({ y: 0 }), sweepCapsule: (from, dx, dz) => ({ x: from.x + dx, z: from.z + dz }),
      raycast: () => blocked ? 3 : Infinity },
    arrowOrigin: () => leftHand,
    onAttack: event => arrows.push(event),
    onEvent: event => events.push(event),
  });
  const { state } = enemy;
  enemy.step(.9, player);
  enemy.step(2, player);
  assert.equal(state.hp, original.stats.archer.hp);
  assert.equal(state.clip, 'stand_idle');
  assert.equal(state.state, 'CHASE');
  assert.equal(arrows.length, 0);
  blocked = false;
  until(enemy, player, () => state.state === 'DRAW');
  close(state.draw, original.drawTime * original.windup);
  until(enemy, player, () => state.draw < original.aimLock);
  const moved = { ...player, x: 4, y: 5 };
  until(enemy, moved, () => state.state === 'LOOSED');
  assert.deepEqual(arrows, [{ type: 'arrow', origin: leftHand, target: { x: 0, y: 2.15, z: -10 },
    speed: original.arrowSpeed, dmg: 1, parryable: true }]);
  enemy.step(.44, moved);
  assert.equal(state.state, 'LOOSED');
  enemy.step(.02, moved);
  assert.equal(state.state, 'CHASE');
  assert.deepEqual(events.map(event => event.name), ['inkRise', 'bowDraw', 'arrowLoose']);
});

test('ronin health stops at both shipped phase floors, leaps in phase two and sends an ink wave in phase three', () => {
  const attacks = [];
  const events = [];
  const enemy = makeEnemy('ronin', { random: () => .75,
    onAttack: (attack, state) => { attacks.push({ attack, move: state.move, frame: state.frame }); },
    onEvent: event => events.push(event),
  });
  const { state } = enemy;
  const far = { x: 0, y: 0, z: -8 };
  enemy.step(.9, far);
  assert.equal(state.hp, original.stats.ronin.hp);
  assert.equal(enemy.damage({ dmg: 999 }), 'hit');
  close(state.hp, original.floors[1] * original.stats.ronin.hp);
  assert.equal(state.phase, 2);
  assert.equal(state.clip, 'dodge');
  assert.equal(state.state, 'BREATH_STEP');
  assert.equal(enemy.damage({ dmg: 1 }), 'immune');
  until(enemy, far, () => state.state === 'BREATH');
  assert.equal(state.clip, 'drink');
  until(enemy, far, () => state.state === 'CHASE');
  until(enemy, far, () => state.flying);
  const leap = original.ronin[2].find(rule => rule.move.id === state.move).move;
  assert.equal(leap.id, 'leapfall');
  const leapBeat = leap.beats.find(beat => beat.leap);
  enemy.step(leapBeat.time / 2 - tick, far);
  close(state.y, leapBeat.leap.height);
  assert.equal(state.clip, leapBeat.clip);
  until(enemy, far, () => attacks.length === 1);
  assert.ok(attacks[0].frame >= leap.beats.find(beat => beat.hit).hit.key);
  assert.equal(attacks[0].attack.arc, 360);
  assert.equal(attacks[0].attack.parryable, false);
  assert.equal(state.y, 0);

  const waveTarget = { x: state.x, y: 0, z: state.z - 13.5 };
  assert.equal(enemy.damage({ dmg: 999 }), 'hit');
  close(state.hp, original.floors[2] * original.stats.ronin.hp);
  assert.equal(state.phase, 3);
  until(enemy, waveTarget, () => state.state === 'BREATH');
  const from = { x: state.x, y: state.y, z: state.z - 13.5 };
  until(enemy, from, () => attacks.length === 2);
  const emission = attacks[1];
  const shipped = original.ronin[3].find(rule => rule.move.id === 'wave').move.beats.find(beat => beat.wave).wave;
  assert.equal(emission.attack.type, 'wave');
  assert.ok(emission.frame >= shipped.at);
  for (const key of ['speed', 'length', 'width', 'dmg']) assert.equal(emission.attack[key], shipped[key]);
  assert.equal(enemy.damage({ dmg: 999 }), 'dead');
  assert.equal(enemy.damage({ dmg: 999 }), null);
  assert.equal(state.alive, false);
  assert.equal(state.clip, 'death');
  enemy.step(2.2, from);
  assert.equal(state.dissolve, 1);
  assert.deepEqual(events.filter(event => event.type !== 'cue').map(event => [event.type, event.phase]),
    [['phase', 2], ['phase', 3], ['defeated', undefined], ['dissolved', undefined]]);
});

test('enemy movement consumes the world surface and never accepts a pose outside its authored leash', () => {
  const visited = [];
  const enemy = makeEnemy('wraith', { random: () => 0, world: {
    groundAt: (x, z) => { visited.push([x,z]); return { y: 2 }; },
    sweepCapsule: (from, dx, dz) => ({ x: from.x + dx, z: from.z + dz }),
    raycast: () => Infinity,
  } }, { leash: { poly: [[-1,-1],[1,-1],[1,1],[-1,1]] }, y: 1 });
  const player = { x: 0, y: 2, z: -10 };
  enemy.step(.9, player);
  for (let i = 0; i < 1800; i++) enemy.step(tick, player);
  assert.ok(enemy.state.z >= -1 && enemy.state.z < -.95);
  assert.equal(enemy.state.y, 2);
  assert.ok(visited.some(([,z]) => z < -1));
  enemy.dispose();
  const pose = { ...enemy.state };
  enemy.step(1, player);
  assert.deepEqual(enemy.state, pose);
  assert.equal(enemy.damage({ dmg: 1 }), null);
});
