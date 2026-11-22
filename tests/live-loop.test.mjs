import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startLiveLoop } from '../src/runtime/live-loop.mts';

function createFrameSource() {
  let nextId = 0;
  const pending = new Map();
  return {
    request(callback) {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    cancel(id) { pending.delete(id); },
    fire(timestamp) {
      assert.equal(pending.size, 1);
      const [id, callback] = pending.entries().next().value;
      pending.delete(id);
      callback(timestamp);
    },
    get count() { return pending.size; },
  };
}

const timing = { fixedDt: 1 / 60, maxFrameDt: 0.1, maxStepsPerFrame: 5 };

test('live loop owns one frame, supports paused redraws, and cancels on stop', () => {
  const frames = createFrameSource();
  const events = [];
  let paused = false;
  const loop = startLiveLoop({
    ...timing,
    canSubmitFrame: () => true,
    isPaused: () => paused,
    beforeStep: () => events.push('before step'),
    step: () => events.push('step'),
    render: alpha => events.push(['render', alpha]),
    afterRender: () => events.push('after render'),
  }, frames);
  frames.fire(0);
  assert.deepEqual(events, []);
  frames.fire(1000 / 60);
  assert.deepEqual(events.splice(0), ['before step', 'step', ['render', 1], 'after render']);
  paused = true;
  frames.fire(2000 / 60);
  assert.deepEqual(events.splice(0), [['render', 1], 'after render']);
  frames.fire(3000 / 60);
  assert.deepEqual(events.splice(0), ['before step', 'step']);
  loop.invalidate();
  frames.fire(4000 / 60);
  assert.deepEqual(events.splice(0), ['before step', 'step', ['render', 1], 'after render']);
  loop.stop();
  loop.stop();
  assert.equal(frames.count, 0);
});

test('stopping from a simulation callback cancels the next frame and skips rendering', () => {
  const frames = createFrameSource();
  const loop = startLiveLoop({
    ...timing,
    canSubmitFrame: () => true,
    isPaused: () => false,
    beforeStep() {},
    step() { loop.stop(); },
    render() { assert.fail('stopped loop rendered'); },
    afterRender() { assert.fail('stopped loop submitted a fence'); },
  }, frames);
  frames.fire(0);
  frames.fire(1000 / 30);
  assert.equal(frames.count, 0);
});
