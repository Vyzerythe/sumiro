import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extrudeWallPolyline, pointInPolygon,
} from '../src/physics/geometry.mts';
import {
  n as publishedExtrudeWallPolyline,
  r as publishedPointInPolygon,
} from '../sumiro/bundle/collision-DtBQEpmQ.js';

test('polygon containment matches shipped collision logic for representative cases', () => {
  const polygons = [
    [],
    [[0, 0]],
    [[0, 0], [10, 0], [10, 10], [0, 10]],
    [[0, 0], [0, 10], [10, 10], [10, 0]],
    [[0, 0], [8, 0], [8, 2], [2, 2], [2, 8], [0, 8]],
    [[-5, -5], [5, -5], [0, 0], [5, 5], [-5, 5]],
  ];
  const samples = [-12, -5, -1, 0, 0.000001, 0.5, 2, 5, 8, 9.999999, 10, 12];
  for (const polygon of polygons) {
    for (const x of samples) for (const z of samples) {
      assert.equal(
        pointInPolygon(x, z, polygon),
        publishedPointInPolygon(x, z, polygon),
        'different containment at ' + JSON.stringify({polygon, x, z}),
      );
    }
  }
});

test('seeded edge-case samples remain equivalent', () => {
  let seed = 0x5e17;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 300; i++) {
    const polygon = Array.from({length: 3 + Math.floor(random() * 9)},
      () => [(random() - 0.5) * 50, (random() - 0.5) * 50]);
    const x = (random() - 0.5) * 50;
    const z = (random() - 0.5) * 50;
    assert.equal(pointInPolygon(x, z, polygon), publishedPointInPolygon(x, z, polygon));
  }
});

test('polyline wall extrusion retains callback order, mutation identity and vertex geometry', () => {
  const polylines = [
    [], [[0, 0]], [[0, 0], [2, 1]],
    [[-3, 1], [1, 2], [3, -6], [0, 0]],
  ];
  for (const points of polylines) {
    for (const [bottom, top] of [
      [(x, z) => x - z - 5, (x, z) => 3 + x + z],
      [() => 0, () => 5],
    ]) {
      const actualCalls = [];
      const originalCalls = [];
      const instrument = (callLog) => [
        (x, z) => { callLog.push(['bottom', x, z]); return bottom(x, z); },
        (x, z) => { callLog.push(['top', x, z]); return top(x, z); },
      ];
      const [bottomA, topA] = instrument(actualCalls);
      const [bottomB, topB] = instrument(originalCalls);
      const actual = [99, 98];
      const expected = [99, 98];
      assert.strictEqual(extrudeWallPolyline(points, bottomA, topA, actual), actual);
      assert.strictEqual(publishedExtrudeWallPolyline(points, bottomB, topB, expected), expected);
      assert.deepEqual(actualCalls, originalCalls);
      assert.deepEqual(actual, expected);
      assert.equal(actual.length, 2 + Math.max(0, points.length - 1) * 18);
    }
  }
});
