import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { parseLaunchOptions } from '../src/runtime/launch-options.mts';

const original = await readFile(new URL('../sumiro/bundle/index-DnHRwVtn.js', import.meta.url), 'utf8');
const begin = original.indexOf('function Yh(e,t)');
const end = original.indexOf('function rg(e)', begin);
assert.ok(begin >= 0 && end > begin);
const originalParser = original.slice(begin, end);

function publishedOptions(query) {
  const diagnostics = [];
  const options = runInNewContext(originalParser + ';ng();tg', {
    window: { location: { search: query } }, URLSearchParams,
    console: { error: message => diagnostics.push(message) },
  });
  return { options, diagnostics };
}

function serializable(options) {
  const { raw, ...parameters } = options;
  return JSON.parse(JSON.stringify({ parameters, query: raw.toString() }));
}

test('launch options preserve ordinary modes, defaults, numbers and raw parameters', () => {
  for (const query of [
    '', '?capture&autorun=false&perf=0&t=-5&seed=-17.9&hz=120',
    '?capture=true&autorun&perf=true&only=game,%20level,%20&cam=1,2,3,4,5,6&size=1920x1080&play=1',
    '?t=Infinity&seed=NaN&hz=-1', '?only=&capture=0&capture=1',
    '?cam=1,2,x,4,5,6&size=wide&t=bad&hz=NaN',
  ]) {
    const original = publishedOptions(query);
    const candidate = parseLaunchOptions(query);
    assert.deepEqual(serializable(candidate.options), serializable(original.options), query);
    assert.equal(candidate.diagnostics.length, original.diagnostics.length, query);
  }
});

test('incomplete camera coordinates and zero or overflowing viewport dimensions are rejected', () => {
  for (const query of ['?cam=1,,3,4,5,6', '?size=0x1080', '?size=99999999999999999999999x2']) {
    assert.equal(publishedOptions(query).diagnostics.length, 0);
    const candidate = parseLaunchOptions(query);
    assert.equal(candidate.options.cam, null);
    assert.equal(candidate.options.size, null);
    assert.equal(candidate.diagnostics.length, 1);
  }
});
