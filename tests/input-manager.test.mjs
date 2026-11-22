import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createInputManager } from '../src/input/input-manager.mts';

const archive = new URL('../sumiro/bundle/index-DnHRwVtn.js', import.meta.url);
const published = ts.createSourceFile(archive.pathname, await readFile(archive, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const oracleNames = ['Vg', 'Hg', 'Ug', 'Wg', 'Gg', 'Kg', 'qg'];
const scope = published.statements.find(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => declaration.name.getText(published) === 'qg'));
assert.ok(scope, 'published input declaration scope changed');
const oracleDeclarations = scope.declarationList.declarations.filter(declaration => oracleNames.includes(declaration.name.getText(published)));
assert.deepEqual(oracleDeclarations.map(declaration => declaration.name.getText(published)), oracleNames);
assert.ok(ts.isClassExpression(oracleDeclarations.at(-1).initializer));
const oracleSource = `const ${oracleDeclarations.map(declaration => declaration.getText(published)).join(',')}; qg;`;

function createPublishedInput(target, getGamepads, route) {
  const Input = runInNewContext(oracleSource, { navigator: { getGamepads }, Bg: route });
  return new Input({ target, scripted: Boolean(route) });
}

const sampledFields = [
  'scripted', 'muted', 'forward', 'strafe', 'magnitude', 'lookX', 'lookY', 'leap', 'jump', 'jumpHeld',
  'walk', 'sprint', 'inkStep', 'attack', 'parry', 'drink', 'interact', 'cat', 'pause', 'fullStickS',
];

function sample(input) {
  const state = Object.fromEntries(sampledFields.map(name => [name, input[name]]));
  return { ...state, menu: { ...input.menu }, route: input.route && { ...input.route } };
}

function dispatch(target, type, fields = {}) {
  const event = Object.assign(new Event(type, { cancelable: true }), fields);
  target.dispatchEvent(event);
  return event;
}

function key(target, type, code, fields = {}) {
  return dispatch(target, type, { code, repeat: false, ctrlKey: false, altKey: false, ...fields });
}

function pair(context, getGamepads = () => [], route) {
  const publishedTarget = new EventTarget();
  const candidateTarget = new EventTarget();
  const original = createPublishedInput(publishedTarget, getGamepads, route);
  const candidate = createInputManager({
    keyboardTarget: candidateTarget, pointerTarget: candidateTarget, getGamepads, scriptedRoute: route,
  });
  context.after(() => { original.dispose(); candidate.dispose(); });
  return {
    original, candidate,
    key(type, code, fields) {
      const expected = key(publishedTarget, type, code, fields);
      const actual = key(candidateTarget, type, code, fields);
      assert.equal(actual.defaultPrevented, expected.defaultPrevented, `${type} ${code}`);
      return actual;
    },
    event(type, fields) {
      const expected = dispatch(publishedTarget, type, fields);
      const actual = dispatch(candidateTarget, type, fields);
      assert.equal(actual.defaultPrevented, expected.defaultPrevented, type);
      return actual;
    },
    compare(time = 1, dt = 0.1) {
      original._beginStep(time, dt);
      candidate.beginStep(time, dt);
      assert.deepEqual(sample(candidate), sample(original));
      const state = sample(candidate);
      original._endStep();
      candidate.endStep();
      return state;
    },
  };
}

function gamepad(axes, ...buttons) {
  return { axes, buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: buttons.includes(index) })) };
}

test('keyboard steering, a quick tap, held jump, and all action edges match the shipped class', context => {
  const input = pair(context);
  for (const code of [
    'ArrowUp', 'KeyS', 'KeyD', 'KeyC', 'Space', 'ShiftLeft', 'KeyJ', 'KeyK', 'KeyR', 'KeyE', 'KeyF', 'KeyP',
  ]) input.key('keydown', code);
  input.key('keyup', 'KeyS');
  const first = input.compare();
  assert.deepEqual([first.forward, first.strafe, first.magnitude], [-1, 1, 1]);
  for (const action of ['jump', 'leap', 'jumpHeld', 'walk', 'inkStep', 'attack', 'parry', 'drink', 'interact', 'cat', 'pause']) {
    assert.equal(first[action], true, action);
  }
  assert.equal(first.sprint, false);
  assert.deepEqual(first.menu, { up: true, down: true, left: false, right: true, confirm: true, back: false });
  const held = input.compare();
  assert.deepEqual([held.forward, held.strafe], [1, 1]);
  assert.equal(held.jump, false);
  assert.equal(held.jumpHeld, true);
  input.key('keydown', 'Space', { repeat: true });
  const repeat = input.compare();
  assert.equal(repeat.jump, false);
  assert.equal(repeat.menu.confirm, true);
  input.key('keyup', 'Space');
  assert.equal(input.compare().jumpHeld, false);

  assert.equal(input.key('keydown', 'KeyW', { ctrlKey: true }).defaultPrevented, false);
  assert.equal(input.key('keydown', 'F4', { altKey: true }).defaultPrevented, false);
  assert.equal(input.key('keydown', 'KeyG', { altKey: true }).defaultPrevented, true);
  assert.equal(input.key('keydown', 'Tab').defaultPrevented, true);
  assert.equal(input.key('keyup', 'AltRight').defaultPrevented, true);
});

test('pointer motion and gameplay muting preserve look, menu, and pause behavior', context => {
  const input = pair(context);
  input.event('mousemove', { movementX: 3, movementY: -4 });
  input.event('mousemove', { movementX: -1, movementY: 8 });
  input.event('mousedown', { button: 0 });
  input.event('mousedown', { button: 2 });
  assert.equal(input.event('contextmenu').defaultPrevented, true);
  const pointer = input.compare();
  assert.deepEqual([pointer.lookX, pointer.lookY, pointer.attack, pointer.parry], [2, 4, true, true]);
  assert.deepEqual([input.compare().lookX, input.compare().lookY], [0, 0]);
  assert.equal(input.candidate.isDown('Mouse0'), false);

  input.candidate.muted = input.original.muted = true;
  for (const code of ['KeyW', 'Space', 'Escape', 'KeyF']) input.key('keydown', code);
  input.event('mousemove', { movementX: 2, movementY: -1 });
  const muted = input.compare();
  assert.deepEqual([muted.forward, muted.jump, muted.jumpHeld, muted.cat, muted.pause], [0, false, false, false, true]);
  assert.deepEqual([muted.lookX, muted.lookY, muted.menu.confirm, muted.menu.back], [2, -1, true, true]);
});

test('gamepad dead zones, held buttons, full-stick timing and menu latching match the shipped class', context => {
  let pad = gamepad([0.14, -0.14, -0.14, 0.14]);
  const input = pair(context, () => [pad, gamepad([1, 1, 1, 1], 0)]);
  const idle = input.compare();
  assert.deepEqual([idle.forward, idle.strafe, idle.lookX, idle.lookY, idle.jump], [0, 0, 0, 0, false]);

  input.key('keydown', 'KeyS');
  const keyboard = input.compare(1, 0.125);
  assert.equal(keyboard.forward, -1);
  assert.equal(keyboard.fullStickS, 0.125);
  input.key('keyup', 'KeyS');
  input.event('mousemove', { movementX: 2, movementY: -2 });

  pad = gamepad([0.6, -0.8, 0.15, -0.25], 0, 1, 2, 3, 4, 5, 9, 13, 14, 15);
  const first = input.compare(2, 0.125);
  assert.deepEqual([first.forward, first.strafe, first.magnitude, first.fullStickS], [0.8, 0.6, 1, 0.25]);
  assert.deepEqual([first.lookX, first.lookY], [3.2, -4]);
  for (const action of ['jump', 'jumpHeld', 'inkStep', 'attack', 'drink', 'interact', 'parry', 'cat', 'pause']) {
    assert.equal(first[action], true, action);
  }
  assert.equal(Object.values(first.menu).every(Boolean), true);

  pad.axes = [-0.75, 0.75, 0, 0];
  const held = input.compare(3, 0.125);
  assert.deepEqual([held.jump, held.jumpHeld, held.inkStep, held.pause, held.fullStickS], [false, true, false, false, 0.375]);
  assert.equal(Object.values(held.menu).some(Boolean), false);
  pad = gamepad([0.15, 0, 0, 0]);
  const neutralMenu = input.compare(4, 0.125);
  assert.equal(neutralMenu.strafe, 0.15);
  assert.equal(neutralMenu.fullStickS, 0);
  pad = gamepad([-0.55, 0, 0, 0], 12);
  const entered = input.compare();
  assert.equal(entered.menu.left, true);
  assert.equal(entered.menu.up, true);
});

test('scripted capture samples the injected route and bypasses keyboard, pointer, and gamepad', context => {
  const ascent = { name: 'ascent' };
  const route = {
    sAtTime: time => time * 2,
    feetAtTime(time, output) { Object.assign(output, { x: time, y: time + 1, z: -time }); },
    atS: distance => ({ heading: distance / 10 }),
    segmentAt: distance => distance >= 2 ? ascent : null,
  };
  const input = pair(context, () => { throw new Error('scripted input polled a device'); }, route);
  assert.deepEqual(sample(input.candidate), sample(input.original));
  const snapshot = input.candidate.route;
  assert.equal(input.key('keydown', 'Space').defaultPrevented, false);
  assert.equal(input.event('contextmenu').defaultPrevented, false);
  input.candidate.muted = input.original.muted = true;
  const later = input.compare(2.5);
  assert.deepEqual(later.route, { t: 2.5, s: 5, x: 2.5, y: 3.5, z: -2.5, heading: 0.5, segment: ascent });
  assert.equal(input.candidate.route, snapshot);
  assert.equal(later.forward, 1);
  assert.equal(later.jump, false);
});

test('raw and derived edges share a tick boundary, including events arriving during a tick', () => {
  const target = new EventTarget();
  const input = createInputManager({ keyboardTarget: target, pointerTarget: target });
  key(target, 'keydown', 'Space');
  assert.equal(input.wasPressed('Space'), false);
  assert.equal(input.isDown('Space'), true);
  input.beginStep(1);
  assert.equal(input.wasPressed('Space'), true);
  assert.equal(input.jump, true);
  key(target, 'keyup', 'Space');
  key(target, 'keydown', 'KeyJ');
  dispatch(target, 'mousemove', { movementX: 3, movementY: -2 });
  assert.equal(input.isDown('Space'), true);
  assert.equal(input.wasPressed('KeyJ'), false);
  input.endStep();
  assert.equal(input.jump, false);
  assert.equal(input.menu.confirm, false);
  assert.equal(input.wasPressed('Space'), false);
  assert.equal(input.isDown('Space'), false);
  input.beginStep(2);
  assert.equal(input.wasPressed('KeyJ'), true);
  assert.equal(input.attack, true);
  assert.equal(input.jumpHeld, false);
  assert.deepEqual([input.lookX, input.lookY], [3, -2]);
  input.endStep();
  key(target, 'keydown', 'KeyJ');
  input.beginStep(3);
  assert.equal(input.attack, false);
  assert.deepEqual([input.lookX, input.lookY], [0, 0]);
  input.dispose();
});

class TrackedTarget extends EventTarget {
  active = new Map();

  addEventListener(type, listener, options) {
    this.active.set(type, listener);
    super.addEventListener(type, listener, options);
  }

  removeEventListener(type, listener, options) {
    assert.equal(this.active.get(type), listener);
    this.active.delete(type);
    super.removeEventListener(type, listener, options);
  }
}

test('blur drops queued input, reset resynchronizes the pad, and dispose unregisters every listener', () => {
  const keyboardTarget = new TrackedTarget();
  const pointerTarget = new TrackedTarget();
  const blurTarget = new TrackedTarget();
  let pollCount = 0;
  let pad = gamepad([0, -1, 0, 0], 0);
  const input = createInputManager({
    keyboardTarget, pointerTarget, blurTarget, getGamepads: () => { pollCount++; return [pad]; },
  });
  assert.deepEqual([...keyboardTarget.active.keys()], ['keydown', 'keyup']);
  assert.deepEqual([...pointerTarget.active.keys()], ['mousemove', 'mousedown', 'contextmenu']);
  assert.deepEqual([...blurTarget.active.keys()], ['blur']);
  input.beginStep(1, 0.1);
  assert.equal(input.jump, true);
  assert.equal(input.fullStickS, 0.1);
  input.endStep();
  key(keyboardTarget, 'keydown', 'KeyW');
  key(keyboardTarget, 'keydown', 'KeyP');
  dispatch(pointerTarget, 'mousemove', { movementX: 6, movementY: 5 });
  dispatch(pointerTarget, 'mousedown', { button: 0 });
  blurTarget.dispatchEvent(new Event('blur'));
  assert.equal(input.isDown('KeyW'), false);
  input.beginStep(2, 0.1);
  assert.deepEqual([input.lookX, input.lookY, input.jump, input.jumpHeld, input.attack, input.pause], [0, 0, false, true, false, false]);
  assert.equal(input.menu.up, false);
  input.endStep();

  pad = null;
  input.beginStep(3, 0.1);
  assert.equal(input.fullStickS, 0);
  assert.equal(input.jumpHeld, false);
  input.endStep();
  pad = gamepad([0, -1, 0, 0], 0);
  input.beginStep(4, 0.1);
  assert.equal(input.jump, true);
  assert.equal(input.menu.up, true);
  input.dispose();
  input.dispose();
  assert.equal(keyboardTarget.active.size + pointerTarget.active.size + blurTarget.active.size, 0);
  assert.equal(key(keyboardTarget, 'keydown', 'Space').defaultPrevented, false);
  assert.equal(dispatch(pointerTarget, 'contextmenu').defaultPrevented, false);
  input.beginStep(5, 0.1);
  assert.equal(pollCount, 4);
  assert.equal(input.jump, false);
  assert.equal(input.forward, 0);
  assert.equal(input.isDown('Space'), false);
});
