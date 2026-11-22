import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHudTimeline } from '../src/runtime/hud-timeline.mts';

test('wash eases over HUD ticks and a replacement starts from current opacity', async () => {
  const timeline = createHudTimeline();
  const incoming = timeline.wash(1, 4);
  timeline.advance(1);
  assert.equal(timeline.opacity, 0.15625);
  const outgoing = timeline.wash(0, 2);
  await incoming;
  timeline.advance(1);
  assert.equal(timeline.opacity, 0.078125);
  timeline.advance(1);
  await outgoing;
  assert.equal(timeline.opacity, 0);
});

test('pending waits advance together and resolve in the shipped order on a tick', async () => {
  const timeline = createHudTimeline();
  const order = [];
  const first = timeline.wait(1).then(() => order.push(1));
  const second = timeline.wait(0).then(() => order.push(2));
  timeline.advance(0);
  await Promise.resolve();
  assert.deepEqual(order, []);
  timeline.advance(1);
  await Promise.all([first, second]);
  assert.deepEqual(order, [2, 1]);
});

test('disposal settles waits and washes and admits no later animation work', async () => {
  const timeline = createHudTimeline();
  const fading = timeline.wash(1, 1);
  const waiting = timeline.wait(2);
  timeline.dispose();
  timeline.dispose();
  await Promise.all([fading, waiting, timeline.wash(1, 1), timeline.wait(1)]);
  timeline.advance(2);
  assert.equal(timeline.opacity, 0);
});
