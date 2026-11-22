import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { runSceneTransition } from '../src/domain/scene-transition.mts';

const bundled = await readFile(new URL('../sumiro/bundle/game-B5zfa1fm.js', import.meta.url), 'utf8');
const original = bundled.match(/async function z\(e,t,[\s\S]*?(?=function B\(e,t\))/)?.[0];
assert.ok(original, 'published scene transition boundary');

function presentation() {
  const events = [];
  const state = { covering: false };
  const context = {
    registry: { set(key, value) { events.push([key, value]); } },
    set paused(value) { events.push(['paused', value]); },
  };
  const hud = {
    closeMenu() { events.push('close'); },
    async wash(opacity, seconds) { events.push(['wash', opacity, seconds]); },
    async wait(seconds) { events.push(['wait', seconds]); },
    showClosing(text) { events.push(['closing', text]); },
    hideClosing() { events.push('hide closing'); },
    showCard(card) { events.push(['card', card]); },
    hideCard() { events.push('hide card'); },
    setVitals() { events.push('vitals'); },
  };
  const phase = (destination) => events.push(['state', destination]);
  const sceneEffects = {
    ...hud,
    now: () => 0,
    begin: () => phase('CHAPTER_CARD'),
    setDucked: (value) => context.registry.set('audio.duck', value),
    setPaused: (value) => { context.paused = value; },
    synchronize: () => { events.push('sync'); hud.setVitals(); },
    arrive: (destination) => {
      phase(destination);
      if (destination === 'PLAY') events.push('pointer');
    },
    recoverToTitle: async () => { events.push('recovery'); },
  };
  return { state, context, hud, events, sceneEffects, phase };
}

test('the normal transition matches the shipped waits, presentation, and arrival order', async () => {
  for (const then of ['PLAY', 'CREDITS']) {
    const baseline = presentation();
    const candidate = presentation();
    const transition = runInNewContext(original + ';z', {
      E: { ...baseline.state, hud: baseline.hud }, performance: { now: () => 0 },
      ue: 0.25, x: 0.75, le: 3.2, ce: 1.1, ve: card => card,
      A: (_context, destination) => baseline.phase(destination),
      M: () => baseline.events.push('sync'), F: () => baseline.events.push('pointer'),
    });
    const options = { card: { id: 'next' }, closing: 'closing notice', hold: 0.5, then };
    await transition(baseline.context, () => { baseline.events.push('change'); }, options);
    assert.equal(await runSceneTransition(candidate.state, candidate.sceneEffects,
      () => { candidate.events.push('change'); }, options), true);
    assert.deepEqual(candidate.events, baseline.events);
    assert.equal(candidate.state.covering, false);
  }
});

test('a second transition cannot reenter during the outgoing wash', async () => {
  const { state, sceneEffects } = presentation();
  const started = Promise.withResolvers();
  const finished = Promise.withResolvers();
  sceneEffects.wash = async opacity => {
    if (opacity !== 0) return;
    started.resolve();
    await finished.promise;
  };
  const outgoing = runSceneTransition(state, sceneEffects, () => {});
  await started.promise;
  assert.equal(state.covering, true);
  assert.equal(await runSceneTransition(state, sceneEffects, () => assert.fail('reentered')), false);
  finished.resolve();
  assert.equal(await outgoing, true);
  assert.equal(state.covering, false);
});

test('cancellation releases the guard without starting work after a pending wash', async () => {
  const { state, sceneEffects, events } = presentation();
  const started = Promise.withResolvers();
  const never = Promise.withResolvers();
  const owner = new AbortController();
  sceneEffects.wash = () => {
    started.resolve();
    return never.promise;
  };
  const transition = runSceneTransition(state, sceneEffects, () => assert.fail('cancelled change ran'),
    { signal: owner.signal });
  await started.promise;
  owner.abort();
  assert.equal(await transition, false);
  assert.equal(state.covering, false);
  assert.deepEqual(events, ['close', ['state', 'CHAPTER_CARD'], ['audio.duck', true]]);
});

test('a failed fallback and a failed HUD cleanup still restore pause and audio', async () => {
  const { state, sceneEffects, events } = presentation();
  sceneEffects.recoverToTitle = async () => { throw Error('fallback rejected'); };
  sceneEffects.hideCard = () => { throw Error('HUD cleanup rejected'); };
  await assert.rejects(runSceneTransition(state, sceneEffects, async () => { throw Error('load rejected'); }),
    error => error instanceof AggregateError &&
      error.errors.map(issue => issue.message).join('|') === 'fallback rejected|HUD cleanup rejected');
  assert.equal(state.covering, false);
  assert.ok(events.some(([name, value]) => name === 'paused' && value === false));
  assert.ok(events.some(([name, value]) => name === 'audio.duck' && value === false));
  assert.ok(events.some(([name, value]) => name === 'state' && value === 'TITLE'));
});
