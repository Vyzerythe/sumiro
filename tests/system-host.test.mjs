import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { Group, Scene } from 'three';
import { createSystemHost } from '../src/runtime/system-host.mts';

const published = await readFile(new URL('../sumiro/bundle/index-DnHRwVtn.js', import.meta.url), 'utf8');
const begin = published.indexOf('var uv=e=>');
const end = published.indexOf(',gv=2.5', begin);
assert.ok(begin >= 0 && end > begin, 'published host boundary');
const LegacyHost = runInNewContext(published.slice(begin, end) + ';hv', {
  console, dg() {}, og: { now: () => 0 }, fg: { systemMs: 1, systemInitTimeoutMs: 1000 },
  setTimeout, clearTimeout,
});

function createHost(scene, options = {}) {
  return createSystemHost({ scene }, { defaultBudgetMs: 1, initializeTimeoutMs: 1000, now: () => 0, ...options });
}

test('system host preserves source order, chapter membership, pause and render routing', async () => {
  async function run(factory) {
    const events = [];
    const scene = new Scene();
    const host = factory(scene);
    const loader = (name, order, chapter, whilePaused) => async () => ({
      name, order, chapter, whilePaused,
      init({ scene }) {
        const root = new Group();
        root.name = name;
        scene.add(root);
        events.push(['init', name]);
      },
      update(dt) { events.push(['update', name, dt]); },
      beforeRender() { events.push(['render', name]); },
    });
    await host.load({
      './systems/z.js': loader('z', 10, 'two', true),
      './systems/b.js': loader('b', 2, 'one', false),
      './systems/a.js': loader('a', 2, null, true),
      './systems/_debug.js': loader('_debug', -1, null, true),
    });
    host.setChapter('one');
    assert.deepEqual(scene.children.map(root => root.name), ['a', 'b']);
    host.update(0.25);
    host.update(0.5, true);
    host.beforeRender();
    host.setChapter('two');
    assert.deepEqual(scene.children.map(root => root.name), ['a', 'z']);
    assert.deepEqual(Array.from(host.chapterRoots('one'), root => root.name), ['b']);
    host.update(0.75);
    host.beforeRender();
    return { events, report: JSON.parse(JSON.stringify(host.report())) };
  }
  const reference = await run(scene => new LegacyHost({ scene }));
  assert.deepEqual(reference.events.slice(0, 3), [['init', 'a'], ['init', 'b'], ['init', 'z']]);
  assert.deepEqual(await run(createHost), reference);
});

test('failed systems roll back scene roots and cleanups while later systems still work', async () => {
  const scene = new Scene();
  const events = [];
  const errors = [];
  const host = createHost(scene, { diagnostics: { warn() {}, error: (...args) => errors.push(args) } });
  await host.load({
    './systems/a.js': async () => ({
      init(_context, lifetime) {
        lifetime.ownRoot(new Group());
        lifetime.defer(() => events.push('first cleanup'));
        lifetime.defer(() => events.push('second cleanup'));
        throw Error('partial initialization');
      },
      dispose() { events.push('a disposed'); },
    }),
    './systems/b.js': async () => ({
      init({ scene }) { scene.add(new Group()); },
      update() { events.push('b updated'); throw Error('update failed'); },
      dispose() { events.push('b disposed'); },
    }),
    './systems/c.js': async () => ({
      update() { events.push('c updated'); },
      dispose() { events.push('c disposed'); },
    }),
  });
  assert.equal(scene.children.length, 1);
  assert.deepEqual(events, ['second cleanup', 'first cleanup', 'a disposed']);
  host.update(1);
  host.update(1);
  assert.equal(scene.children.length, 0);
  host.dispose();
  host.dispose();
  assert.deepEqual(events, [
    'second cleanup', 'first cleanup', 'a disposed', 'b updated', 'b disposed',
    'c updated', 'c updated', 'c disposed',
  ]);
  assert.deepEqual(host.report().map(system => system.failed), ['init', 'update', null]);
  assert.equal(errors.length, 2);
});

test('disposing during initialization aborts it and releases late registrations', async () => {
  const scene = new Scene();
  const host = createHost(scene);
  const events = [];
  let signalEntered;
  const started = new Promise(resolve => { signalEntered = resolve; });
  let signalContinuation;
  const continuation = new Promise(resolve => { signalContinuation = resolve; });
  const loading = host.load({
    './systems/waiting.js': async () => ({
      async init(_context, lifetime) {
        lifetime.ownRoot(new Group());
        lifetime.defer(() => events.push('cleanup'));
        signalEntered();
        await continuation;
        assert.equal(lifetime.signal.aborted, true);
        lifetime.ownRoot(new Group());
        lifetime.defer(() => events.push('late cleanup'));
      },
      update() { events.push('unexpected update'); },
    }),
    './systems/z.js': async () => ({
      init() { events.push('unexpected init'); },
      dispose() { events.push('unexpected dispose'); },
    }),
  });
  await started;
  assert.equal(scene.children.length, 1);
  host.dispose();
  host.update(1);
  signalContinuation();
  await loading;
  assert.equal(scene.children.length, 0);
  assert.deepEqual(events, ['cleanup', 'late cleanup']);
});

test('a timed-out system aborts and rolls back before later initialization', async () => {
  const scene = new Scene();
  const host = createHost(scene, { initializeTimeoutMs: 10, diagnostics: { warn() {}, error() {} } });
  const events = [];
  await host.load({
    './systems/a.js': async () => ({
      init(_context, lifetime) {
        lifetime.ownRoot(new Group());
        lifetime.defer(() => events.push('cleanup'));
        return new Promise(resolve => {
          lifetime.signal.addEventListener('abort', () => { events.push('abort'); resolve(); }, { once: true });
        });
      },
    }),
    './systems/b.js': async () => ({
      init({ scene }) {
        assert.equal(scene.children.length, 0);
        events.push('later init');
      },
    }),
  });
  assert.deepEqual(events, ['abort', 'cleanup', 'later init']);
  assert.equal(host.report()[0].failed, 'init');
});

test('host disposal starts cleanup once and waits for it to settle', async () => {
  const host = createHost(new Scene());
  let finishCleanup;
  const gate = new Promise(resolve => { finishCleanup = resolve; });
  const events = [];
  await host.load({
    './systems/worker.js': async () => ({
      init(_context, lifetime) {
        lifetime.defer(async () => {
          events.push('cleanup began');
          await gate;
          events.push('cleanup finished');
        });
      },
    }),
  });
  const closing = host.dispose();
  assert.equal(host.dispose(), closing);
  let closed = false;
  void closing.then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  assert.deepEqual(events, ['cleanup began']);
  finishCleanup();
  await closing;
  assert.equal(closed, true);
  assert.deepEqual(events, ['cleanup began', 'cleanup finished']);
});
