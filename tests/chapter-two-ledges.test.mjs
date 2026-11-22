import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createChapterTwoTraversal } from '../src/application/chapter-two-ledges.mts';
import { createChapterTwoMechanisms } from '../src/application/chapter-two-mechanisms.mts';
import { createChapterTwoWorld } from '../src/application/chapter-two-world.mts';
import { createLedgePath } from '../src/player/ledge-path.mts';
import { findLeapLink, resolveLeapTarget } from '../src/player/leap.mts';

const source = await readFile(new URL('../sumiro/bundle/ch2_pass-9Opjv4P2.js', import.meta.url), 'utf8');
const start = source.indexOf('var de=');
const end = source.indexOf(',Me=J(', start);
assert.ok(start >= 0 && end > start, 'Published Chapter Two chapter metadata boundary changed');
const original = Function(source.slice(start, end) + '; return Z;')();

test('Chapter Two ledges and routes match the published authored data in order', () => {
  const chapter = createChapterTwoTraversal();
  const other = createChapterTwoTraversal();
  assert.equal(chapter.ledges.length, 51);
  assert.equal(chapter.leapLinks.length, 14);
  assert.deepEqual(chapter.ledges, original.ledges);
  assert.deepEqual(chapter.leapLinks, original.leapLinks);
  assert.notStrictEqual(chapter.ledges[0].points, other.ledges[0].points);
  assert.notStrictEqual(chapter.leapLinks[0].to, other.leapLinks[0].to);
  assert.deepEqual(chapter.ledges.filter(ledge => Array.isArray(ledge.climbable)).map(ledge => ledge.id),
    ['crack1', 'cornice_c', 'i_crack']);
  assert.ok(chapter.ledges.filter(ledge => ledge.points.length === 5).length > 0);
});

test('the typed paths feed leap discovery across the published stair gap', () => {
  const chapter = createChapterTwoTraversal();
  const { world } = createChapterTwoWorld();
  const ledges = new Map(chapter.ledges.map(ledge => [ledge.id, createLedgePath(ledge)]));
  for (const { fromLedge, to } of chapter.leapLinks) {
    if (fromLedge) assert.ok(ledges.has(fromLedge));
    if ('ledge' in to) assert.ok(ledges.has(to.ledge));
  }

  const x = 57, z = -192;
  const state = { x, y: world.groundAt(x, z).y, z, state: 'RUN', recentSpeed: 5, stickMag: 1 };
  const direction = { x: 0, z: -1 };
  const resolve = link => resolveLeapTarget(state, link, ledges, world, direction, {});
  const match = findLeapLink(state, chapter, ledges, world, direction, {}, resolve);
  assert.equal(match.link.id, 'stair_gap');
  assert.strictEqual(match.t.ledge, ledges.get('r6_s'));
  assert.ok(match.t.s >= 5 && match.t.s <= 15);
  assert.equal(match.t.y, 33.5 - 2.1);
});

test('Chapter Two mechanism carriers do not acquire unauthored ledge or leap attachments', () => {
  const chapter = createChapterTwoTraversal();
  const { world } = createChapterTwoWorld();
  const mechanisms = createChapterTwoMechanisms(world);
  const slab = world.body('court_slab');
  assert.strictEqual(slab, mechanisms.slab.body);
  assert.equal(original.ledges.some(ledge => ledge.attach || ledge.body), false);
  assert.equal(original.leapLinks.some(link => link.from?.body || link.to.body), false);
  assert.equal(chapter.ledges.some(ledge => 'body' in ledge), false);
  assert.equal(chapter.leapLinks.some(link => link.from?.body || 'body' in link.to), false);

  const path = createLedgePath(chapter.ledges[0]);
  const point = path.at(1);
  const before = slab.z;
  assert.ok(mechanisms.ringBell('court_slab_bell'));
  mechanisms.step(0.25);
  assert.notEqual(slab.z, before);
  assert.deepEqual(path.at(1), point);
});
