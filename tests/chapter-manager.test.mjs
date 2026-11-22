import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { createChapterManager } from '../src/runtime/chapter-manager.mts';

function sceneFixture() {
  const children = [];
  return {
    children,
    add(root) {
      assert.equal(children.includes(root), false, 'root was attached twice');
      children.push(root);
    },
    remove(root) {
      const index = children.indexOf(root);
      if (index >= 0) children.splice(index, 1);
    },
  };
}

function chapter(id) {
  return { root: { name: id }, data: { map: `${id}-map` } };
}

test('the old chapter stays live through preparation and is released only after the next activation', async context => {
  const scene = sceneFixture();
  const preparation = Promise.withResolvers();
  const prepared = Promise.withResolvers();
  const cleanup = [];
  const lookups = new Map();
  const manager = createChapterManager({
    scene,
    async load(id, lifetime) {
      lookups.set(id, lifetime.signal);
      const loaded = chapter(id);
      lifetime.defer(() => { cleanup.push(id); });
      if (id === 'second') {
        prepared.resolve(loaded);
        await preparation.promise;
      }
      return loaded;
    },
    activate(next, previous) {
      assert.equal(manager.current, previous);
      assert.deepEqual(scene.children, previous ? [previous.root] : []);
      assert.equal(scene.children.includes(next.root), false);
      assert.deepEqual(cleanup, []);
    },
  });
  context.after(() => manager.dispose());
  const first = await manager.switchTo('first');
  const change = manager.switchTo('second');
  const candidate = await prepared.promise;
  assert.equal(manager.current, first);
  assert.deepEqual(scene.children, [first.root]);
  assert.equal(lookups.get('first').aborted, false);
  preparation.resolve();
  const second = await change;
  assert.equal(second.root, candidate.root);
  assert.equal(second.data, candidate.data);
  assert.equal(manager.current, second);
  assert.deepEqual(scene.children, [second.root]);
  assert.equal(lookups.get('first').aborted, true);
  await setImmediate();
  assert.deepEqual(cleanup, ['first']);
});

test('failed activation rolls back candidate changes and keeps the old chapter usable', async context => {
  const scene = sceneFixture();
  const cleanups = [];
  const reversals = [];
  const signals = new Map();
  const activationError = new Error('Could not activate candidate');
  let selected;
  const manager = createChapterManager({
    scene,
    load(id, lifetime) {
      signals.set(id, lifetime.signal);
      lifetime.defer(() => { cleanups.push(id); });
      return chapter(id);
    },
    activate(next, previous, lifetime) {
      selected = next.id;
      lifetime.rollback(() => { reversals.push('publication'); selected = previous?.id; });
      lifetime.rollback(() => { reversals.push('settings'); });
      if (next.id === 'failed') throw activationError;
    },
  });
  context.after(() => manager.dispose());
  const old = await manager.switchTo('old');
  await assert.rejects(manager.switchTo('failed'), error => error === activationError);
  assert.equal(manager.current, old);
  assert.equal(old.data.map, 'old-map');
  assert.deepEqual(scene.children, [old.root]);
  assert.equal(selected, 'old');
  assert.deepEqual(reversals, ['settings', 'publication']);
  assert.deepEqual(cleanups, ['failed']);
  assert.equal(signals.get('old').aborted, false);
  assert.equal(signals.get('failed').reason, activationError);
  assert.equal((await manager.switchTo('new')).id, 'new');
  assert.equal(selected, 'new');
});

test('a scene operation that throws after mutation rolls back the root swap', async context => {
  const scene = sceneFixture();
  const removeRoot = scene.remove;
  const failRemoval = new Error('Old root removal failed');
  const cleanups = [];
  const manager = createChapterManager({
    scene,
    load(id, lifetime) {
      lifetime.defer(() => { cleanups.push(id); });
      return chapter(id);
    },
  });
  context.after(() => manager.dispose());
  const old = await manager.switchTo('old');
  scene.remove = root => {
    removeRoot(root);
    if (root === old.root) throw failRemoval;
  };
  await assert.rejects(manager.switchTo('new'), error => error === failRemoval);
  assert.equal(manager.current, old);
  assert.deepEqual(scene.children, [old.root]);
  assert.deepEqual(cleanups, ['new']);
  scene.remove = removeRoot;
});

test('superseding a load rejects it promptly and releases both early and late resources', async context => {
  const scene = sceneFixture();
  const abandonedLoad = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const cleanups = [];
  const activations = [];
  const manager = createChapterManager({
    scene,
    async load(id, lifetime) {
      if (id === 'abandoned') {
        lifetime.defer(() => { cleanups.push('early'); });
        entered.resolve(lifetime.signal);
        await abandonedLoad.promise;
        lifetime.defer(() => { cleanups.push('late'); });
      }
      return chapter(id);
    },
    activate(next) { activations.push(next.id); },
  });
  context.after(() => manager.dispose());
  const abandoned = assert.rejects(manager.switchTo('abandoned'), { name: 'AbortError' });
  const signal = await entered.promise;
  const winner = manager.switchTo('winner');
  await abandoned;
  assert.equal(signal.aborted, true);
  assert.deepEqual(cleanups, ['early']);
  const active = await winner;
  abandonedLoad.resolve();
  await setImmediate();
  assert.equal(manager.current, active);
  assert.deepEqual(scene.children, [active.root]);
  assert.deepEqual(cleanups, ['early', 'late']);
  assert.deepEqual(activations, ['winner']);
});

test('teardown cancels pending preparation and waits for registered cleanup in reverse order', async () => {
  const scene = sceneFixture();
  const cleanupGate = Promise.withResolvers();
  const pendingGate = Promise.withResolvers();
  const pendingEntered = Promise.withResolvers();
  const cleanups = [];
  const manager = createChapterManager({
    scene,
    async load(id, lifetime) {
      if (id === 'active') {
        lifetime.defer(() => { cleanups.push('active first'); });
        lifetime.defer(async () => {
          cleanups.push('active second start');
          await cleanupGate.promise;
          cleanups.push('active second end');
        });
      } else {
        lifetime.defer(() => { cleanups.push('pending'); });
        pendingEntered.resolve(lifetime.signal);
        await pendingGate.promise;
        lifetime.defer(() => { cleanups.push('pending late'); });
      }
      return chapter(id);
    },
  });
  await manager.switchTo('active');
  const stopped = assert.rejects(manager.switchTo('pending'), { name: 'AbortError' });
  const pendingSignal = await pendingEntered.promise;
  const disposal = manager.dispose();
  assert.equal(manager.dispose(), disposal);
  assert.equal(manager.current, null);
  assert.deepEqual(scene.children, []);
  await stopped;
  assert.equal(pendingSignal.aborted, true);
  assert.deepEqual(cleanups, ['pending', 'active second start']);
  await assert.rejects(manager.switchTo('later'), { name: 'AbortError' });
  cleanupGate.resolve();
  await disposal;
  assert.deepEqual(cleanups, ['pending', 'active second start', 'active second end', 'active first']);
  pendingGate.resolve();
  await setImmediate();
  assert.equal(cleanups.at(-1), 'pending late');
  assert.deepEqual(scene.children, []);
});

test('a matching switch coalesces and caller cancellation applies only before commit', async context => {
  const scene = sceneFixture();
  const held = Promise.withResolvers();
  const signals = [];
  const manager = createChapterManager({
    scene,
    async load(id, lifetime) {
      signals.push(lifetime.signal);
      if (id === 'held') await held.promise;
      return chapter(id);
    },
  });
  context.after(() => manager.dispose());
  const caller = new AbortController();
  const reason = new Error('Cancelled transition');
  const flight = manager.switchTo('held', { signal: caller.signal });
  assert.equal(manager.switchTo('held', { signal: caller.signal }), flight);
  const failure = assert.rejects(flight, error => error === reason);
  await Promise.resolve();
  caller.abort(reason);
  await failure;
  assert.equal(signals[0].reason, reason);
  assert.equal(manager.current, null);
  held.resolve();

  const owner = new AbortController();
  const active = await manager.switchTo('active', { signal: owner.signal });
  owner.abort();
  assert.equal(signals[1].aborted, false);
  assert.equal(await manager.switchTo('active'), active);
  assert.deepEqual(scene.children, [active.root]);
  assert.equal(signals.length, 2);
});
