import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { FrameScheduler } from '../src/runtime/frame-scheduler.mts';
import { FixedStepClock } from '../src/runtime/fixed-step-clock.mts';

const options = { fixedDt: 1 / 60, maxFrameDt: 0.1, maxStepsPerFrame: 5 };
const active = { admitted: true, paused: false };
const behind = { admitted: false, paused: false };
const paused = { admitted: true, paused: true };

const original = await readFile(new URL('../sumiro/bundle/index-DnHRwVtn.js', import.meta.url), 'utf8');
const start = original.indexOf('runLive(){let{ctx:e}=this');
const end = original.indexOf('}_perfWarn(', start);
assert.ok(start >= 0 && end > start, 'published frame-loop boundary changed');

function createReference() {
  let callback;
  let steps;
  let alpha;
  let admitted;
  const runLive = Function('requestAnimationFrame', '_v', 'fg', 'tg',
    'return ({' + original.slice(start, end + 1) + '}).runLive;');
  runLive(next => { callback = next; }, 30, options, {}).call({
    ctx: { time: { fixedDt: options.fixedDt }, smooth() {} },
    _gpuBehind: () => !admitted,
    _keepPrevious() {},
    step() { steps++; },
    _renderBetween(value) { alpha = value; },
    _fenceFrame() {},
  });
  return (timestamp, allow = true) => {
    steps = 0;
    alpha = undefined;
    admitted = allow;
    callback(timestamp);
    return { steps, render: alpha !== undefined, alpha };
  };
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`);
}

for (const hz of [30, 60, 120]) {
  test(`${hz} Hz retains published simulation, interpolation, and render cadence`, () => {
    const scheduler = new FrameScheduler(options);
    const reference = createReference();
    const clock = new FixedStepClock(60, 24);
    for (let frame = 0; frame <= 2 * hz; frame++) {
      const timestamp = frame * 1000 / hz;
      const candidate = scheduler.schedule(timestamp, active);
      const expected = reference(timestamp);
      assert.equal(candidate.steps, expected.steps, `steps at callback ${frame}`);
      assert.equal(candidate.render, expected.render, `render at callback ${frame}`);
      if (candidate.render) near(candidate.alpha, expected.alpha);
      for (let step = 0; step < candidate.steps; step++) clock.advance();
    }
    assert.equal(clock.step, 120);
    assert.equal(clock.t, 2);
  });
}

test('GPU skips preserve the interpolation phase and do not consume cadence slots', () => {
  const scheduler = new FrameScheduler(options);
  const reference = createReference();
  const gpuSkips = new Set([2, 10, 30, 31, 34, 35, 37]);
  const decisions = [];
  for (let frame = 0; frame < 50; frame++) {
    const timestamp = frame * 1000 / 120;
    const admitted = !gpuSkips.has(frame);
    const actual = scheduler.schedule(timestamp, admitted ? active : behind);
    const expected = reference(timestamp, admitted);
    assert.equal(actual.steps, expected.steps, `steps at callback ${frame}`);
    assert.equal(actual.render, expected.render, `render at callback ${frame}`);
    if (actual.render) near(actual.alpha, expected.alpha);
    decisions.push(actual);
  }
  near(decisions[1].alpha, 0.5);
  assert.deepEqual(decisions[2], { steps: 0, render: false, alpha: 0.5, paused: false });
  near(decisions[3].alpha, 0.5);
});

test('pause renders once, polls with frozen time, and resets phase on resume', () => {
  const scheduler = new FrameScheduler(options);
  const clock = new FixedStepClock(60, 24);
  function advance(timestamp, status) {
    const decision = scheduler.schedule(timestamp, status);
    if (!decision.paused) for (let step = 0; step < decision.steps; step++) clock.advance();
    return decision;
  }
  advance(0, active);
  assert.equal(advance(1000 / 120, active).steps, 1);
  assert.deepEqual(advance(1000 / 60, { ...paused, admitted: false }),
    { steps: 0, render: false, alpha: 1, paused: true });
  assert.deepEqual(advance(2000 / 60, paused), { steps: 1, render: true, alpha: 1, paused: true });
  assert.deepEqual(advance(3000 / 60, paused), { steps: 1, render: false, alpha: 1, paused: true });
  assert.equal(clock.step, 1);
  assert.deepEqual(advance(30_000, active), { steps: 0, render: true, alpha: 1, paused: false });
  assert.equal(advance(30_000 + 1000 / 60, active).steps, 1);
  assert.equal(clock.step, 2);
  assert.equal(advance(30_050, paused).render, true);
});

test('explicit and backward resets reanchor time and invalid timestamps are ignored', () => {
  const scheduler = new FrameScheduler(options);
  for (let frame = 0; frame <= 36; frame++) scheduler.schedule(frame * 1000 / 120, active);
  scheduler.reset();
  assert.deepEqual(scheduler.schedule(500, paused), { steps: 0, render: false, alpha: 1, paused: true });
  assert.equal(scheduler.schedule(510, paused).render, true);
  assert.deepEqual(scheduler.schedule(100, active), { steps: 0, render: false, alpha: 1, paused: false });
  assert.equal(scheduler.schedule(NaN, active).render, false);
  assert.equal(scheduler.schedule(Infinity, paused).render, false);
  const frame = scheduler.schedule(100 + 1000 / 120, active);
  assert.equal(frame.render, true);
  assert.equal(frame.steps, 1);
  near(frame.alpha, 0.5);
});

test('hitches clamp elapsed time and capped work leaves only fractional phase', () => {
  const config = { fixedDt: 0.02, maxFrameDt: 0.09, maxStepsPerFrame: 8 };
  const clamped = new FrameScheduler(config);
  clamped.schedule(0, active);
  clamped.schedule(50, behind);
  const hitch = clamped.schedule(1000, active);
  assert.equal(hitch.steps, 5);
  near(hitch.alpha, 0.5);

  const capped = new FrameScheduler({ ...config, maxStepsPerFrame: 2 });
  capped.schedule(0, active);
  const first = capped.schedule(1000, active);
  assert.equal(first.steps, 2);
  near(first.alpha, 0.5);
  const boundary = capped.schedule(1010, active);
  assert.equal(boundary.steps, 0);
  near(boundary.alpha, 1);
  const next = capped.schedule(1020, active);
  assert.equal(next.steps, 1);
  near(next.alpha, 0.5);
});

test('16 ms callback intervals preserve elapsed time without snapping to a tick', () => {
  const scheduler = new FrameScheduler(options);
  const reference = createReference();
  let actualSteps = 0, referenceSteps = 0;
  for (let frame = 0; frame <= 50; frame++) {
    const timestamp = 16 * frame;
    actualSteps += scheduler.schedule(timestamp, active).steps;
    referenceSteps += reference(timestamp).steps;
  }
  assert.equal(actualSteps, 48, '800 ms at 60 ticks per second');
  assert.equal(referenceSteps, 50, 'published loop snaps every 16 ms interval to a full tick');
});

test('invalid timing and noninteger step limits are rejected', () => {
  for (const overrides of [
    { fixedDt: 0 }, { fixedDt: Infinity }, { maxFrameDt: -0.1 }, { maxFrameDt: Infinity },
    { maxStepsPerFrame: 0 }, { maxStepsPerFrame: 2.5 },
  ]) {
    assert.throws(() => new FrameScheduler({ ...options, ...overrides }), RangeError);
  }
});
