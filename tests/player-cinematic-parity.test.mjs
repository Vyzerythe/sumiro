import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import {
  headingKeys, runFrameKeys, jogFrameKeys,
  interpolateHeading, runAnimationFrame, jogAnimationFrame,
  timelineState, timelineSurface,
} from '../src/player/cinematic-timeline.mts';

const bundle = await readFile(
  new URL('../sumiro/bundle/player-1_KrBWnI.js', import.meta.url), 'utf8',
);
const segment1 = bundle.match(/var H=\[\[[\s\S]*?\}\s*(?=var Me=)/);
const segment2 = bundle.match(/var Fe=\[[\s\S]*?\}(?=var Ge=)/);
assert.ok(segment1 && segment2, 'Published timing boundaries changed; re-audit manually');
const original = runInNewContext(
  segment1[0] + ';' + segment2[0] + ';({H,Fe,Ie,U,Ve,He,Ue,We})'
);
const normalize = value => JSON.parse(JSON.stringify(value));

test('source motion keys preserve reference content and ordering', () => {
  assert.deepEqual(headingKeys, normalize(original.H));
  assert.deepEqual(runFrameKeys, normalize(original.Fe));
  assert.deepEqual(jogFrameKeys, normalize(original.Ie));
});

test('scripted timing matches reference across boundaries and extrapolation', () => {
  const edges = [-100, -13, 0, 78, 116, 165, 187, 199, 203, 212, 216,
    229, 236, 246, 250, 256, 266, 270, 290, 292, 303, 360, 450];
  const observations = new Set(edges.flatMap(x => [x-1e-7,x,x+1e-7]));
  let seed = 17839;
  for (let i=0;i<400;i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    observations.add(seed / 4294967296 * 600 - 100);
  }
  const pairs = [
    [value => interpolateHeading(headingKeys,value), value => original.U(original.H,value)],
    [runAnimationFrame, original.Ve],
    [jogAnimationFrame, original.He],
    [timelineState, original.Ue],
    [timelineSurface, original.We],
  ];
  for (const frame of observations) for (const [actual,expected] of pairs) {
    assert.equal(actual(frame), expected(frame), 'Frame parity at ' + frame);
  }
});

test('non-finite and arbitrary custom curve input behavior remains equivalent', () => {
  const values=[NaN, Infinity, -Infinity, undefined, null, 0, 3];
  const curve=[[0,0],[1,10],[3,-2]];
  for(const value of values) {
    assert.equal(interpolateHeading(curve,value),original.U(curve,value));
    for(const [actual,expected] of [
      [runAnimationFrame,original.Ve],
      [jogAnimationFrame,original.He],
      [timelineState,original.Ue],
      [timelineSurface,original.We],
    ]) assert.equal(actual(value),expected(value));
  }
});
