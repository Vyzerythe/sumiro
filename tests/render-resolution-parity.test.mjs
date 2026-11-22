import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { capRenderScale, measureRenderTargets, selectAdaptiveRenderScale } from '../src/rendering/frame-resolution.mts';

const published = await readFile(new URL('../sumiro/bundle/render_pipeline-BTCk4Dyc.js', import.meta.url), 'utf8');
const worldHeightLimit = 2160;
const keyMapDivisor = 4;
const scaleSteps = [2, 1.75, 1.5, 1.25, 1, 0.85, 0.7, 0.6, 0.5, 0.42];

function publishedMethod(name, uniforms) {
  const method = published.match(new RegExp(name + '\\(e\\)\\{[^}]+\\}'));
  assert.ok(method, 'published renderer method must exist: ' + name);
  return Function('O', 'A', 'C', 'k', 'E', `return ({ ${method[0]} }).${name}`)(
    worldHeightLimit, scaleSteps, { render: { ss: 2 } }, keyMapDivisor, uniforms);
}

const views = [
  { drawWidth: 1280, drawHeight: 704, pxScale: 1 },
  { drawWidth: 2311, drawHeight: 1081, pxScale: 1.25 },
  { drawWidth: 3840, drawHeight: 2160, pxScale: 2 },
  { drawWidth: 5120, drawHeight: 2880, pxScale: 1 },
];

test('render scale reproduces the published height ceiling, pixel budget and minimum', () => {
  const publishedCap = publishedMethod('_ssFull');
  const publishedSelect = publishedMethod('_ssFor');
  assert.equal(capRenderScale(704, 2, worldHeightLimit), 2);
  assert.equal(capRenderScale(2880, 2, worldHeightLimit), 1);
  for (const view of views) {
    const cap = capRenderScale(view.drawHeight, 2, worldHeightLimit);
    assert.equal(cap, publishedCap(view));
    for (const pixelBudget of [0, 491_520, 2_073_600, Infinity]) {
      const reference = publishedSelect.call({ ssFixed: 0, pixelCap: pixelBudget, _ssFull: publishedCap }, view);
      assert.equal(selectAdaptiveRenderScale(view, pixelBudget, cap, scaleSteps.at(-1)), reference);
    }
  }
});

test('frame targets use the same rounding and actual pixel scale as the published resize', () => {
  for (const view of views) {
    for (const supersampling of [0.42, 0.85, 1, 1.25, 2]) {
      const calls = new Map();
      const target = name => ({ setSize: (width, height) => calls.set(name, [width, height]) });
      const uniforms = { uPxScale: { value: 0 }, uRes: { value: { set: target('uniform').setSize } } };
      const gradeMaterial = { uniforms: { uSS: { value: 0 } } };
      const compositeMaterial = { uniforms: { uSS: { value: 0 } } };
      publishedMethod('setSize', uniforms).call({
        _ssFor: () => supersampling,
        gbuf: target('color'), depthCopy: target('depth'), keyMap: target('key'),
        lineMask: target('line'), post: target('post'), gradeMaterial, compositeMaterial,
      }, view);

      const actual = measureRenderTargets(view, supersampling, keyMapDivisor);
      for (const name of ['color', 'depth', 'line', 'post', 'uniform']) {
        assert.deepEqual([actual.width, actual.height], calls.get(name));
      }
      assert.deepEqual([actual.keyWidth, actual.keyHeight], calls.get('key'));
      assert.equal(actual.pixelScale, uniforms.uPxScale.value);
      assert.equal(actual.effectiveScale, gradeMaterial.uniforms.uSS.value);
      assert.equal(actual.effectiveScale, compositeMaterial.uniforms.uSS.value);
      assert.ok(actual.keyWidth * keyMapDivisor >= actual.width);
      assert.ok(actual.keyHeight * keyMapDivisor >= actual.height);
    }
  }
});
