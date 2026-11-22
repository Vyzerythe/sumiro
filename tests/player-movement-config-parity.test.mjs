import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { movementConfig } from '../src/player/movement-config.mts';

const source = await readFile(new URL('../sumiro/bundle/player-1_KrBWnI.js',import.meta.url),'utf8');
const catalog = source.match(/var O=(\{[\s\S]*?\}),k=O,ee=24/);
assert.ok(catalog, 'published movement configuration boundary changed; re-audit');
const original = runInNewContext('('+catalog[1]+')');
test('all player movement, jump, collision and animation tuning matches shipped game',()=>{
  assert.deepEqual(movementConfig, JSON.parse(JSON.stringify(original)));
  assert.deepEqual(Object.keys(movementConfig),Object.keys(original));
  assert.equal(movementConfig.gravity,24);
  assert.equal(movementConfig.jumpHeight,1.3);
  assert.equal(movementConfig.buffer,.15);
});
