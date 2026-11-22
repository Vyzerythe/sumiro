import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chapterOneCameraAreas, chapterOneRail } from '../src/application/chapter-one-rail.mts';
import { createFollowCamera } from '../src/rendering/follow-camera.mts';
import { i as publishedFeetAt } from '../sumiro/bundle/layout-BxJUyHwJ.js';
import { n as publishedRailEnd, o as publishedPoseAt } from '../sumiro/bundle/rail-V5OV_nvf.js';

function assertSamplesAt(seconds) {
  const pose = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN };
  const feet = { x: NaN, y: NaN, z: NaN };
  chapterOneRail.poseAt(seconds, pose);
  chapterOneRail.feetAt(seconds, feet);
  assert.deepEqual(pose, publishedPoseAt(seconds), 'camera pose at ' + seconds + ' seconds');
  assert.deepEqual(feet, publishedFeetAt(seconds), 'reference feet at ' + seconds + ' seconds');
}

test('Chapter One rail matches authored frame samples, segment boundaries and independent endpoints', () => {
  assert.equal(publishedRailEnd, 15.75);
  for (let frame = 0; frame <= publishedRailEnd * 24; frame++) assertSamplesAt(frame / 24);

  // Walking, gap, plateau and the two authored endpoints. Sample on both sides
  // to exercise interval selection and the clamping behavior.
  for (const frame of [0, 195, 199, 228, 258, 267, 300, 303, 360, 378]) {
    assertSamplesAt((frame - 0.001) / 24);
    assertSamplesAt((frame + 0.001) / 24);
  }
  assertSamplesAt(-2);
  assertSamplesAt(publishedRailEnd + 2);
});

test('Chapter One rail matches the published curves at seeded subframe positions', () => {
  let seed = 0x57a71;
  for (let i = 0; i < 128; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    assertSamplesAt(seed / 2 ** 32 * publishedRailEnd);
  }
});

test('way-up camera areas apply the authored framing in priority order', () => {
  const follow = createFollowCamera({ rail: chapterOneRail, wayUpAreas: chapterOneCameraAreas });
  const baseline = createFollowCamera({ rail: chapterOneRail });
  const fixtures = [
    { x: 5.5, z: -45, yaw: 30, pitch: 0, lift: 0 },
    { x: 9, z: -40, yaw: -70, pitch: -6, lift: 1.2 },
    { x: 7, z: -45, yaw: -96, pitch: 0, lift: 0 },
    { x: 0, z: -30, yaw: 0, pitch: 0, lift: 0 },
  ];
  for (const [teleport, { x, z, yaw, pitch, lift }] of fixtures.entries()) {
    const sample = { feet: { x, y: 5.5, z }, deltaSeconds: 0, speed: 0, teleport };
    const pose = follow.update(sample);
    const original = baseline.update(sample);
    assert.equal(pose.zone, 'way_up');
    assert.equal(pose.yaw, original.yaw + yaw);
    assert.equal(pose.pitch, original.pitch + pitch);
    assert.ok(Math.abs(pose.y - original.y - lift) < 1e-12);
  }
});
