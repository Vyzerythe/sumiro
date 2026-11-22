import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, Uint16BufferAttribute,
  WebGPURenderer, WGSLNodeBuilder,
} from 'three/webgpu';
import { pass } from 'three/tsl';
import { createLaterChapterInkMaterial, resolveLaterChapterInkMaterial } from '../src/application/later-chapter-materials.mts';
import { configureInkSurfacePass } from '../src/rendering/ink-surface-pass.mts';
import { n as originalPresets } from '../sumiro/bundle/constants-BjlLV5tN.js';
import { t as originalTerrain } from '../sumiro/bundle/materials-CGuChJ0C.js';

const files = ['ch3_pines-BCHma7IG.js', 'ch4_temple-XtSLeUue.js', 'ch5_sea-CpHUIhkX.js', 'ch6_summit-BczK7QHX.js'];
const [pines, temple, sea, summit] = await Promise.all(files.map(file =>
  readFile(new URL('../sumiro/bundle/' + file, import.meta.url), 'utf8')));

function span(source, begin, end) {
  const from = source.indexOf(begin);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'Published selector boundary changed: ' + begin);
  return source.slice(from, to);
}

const pinesStyles = Function('var ' + span(pines, 'J={preset:', ',Ce=new Set(') + ';return {base:J,styles:Se};')();
const templeStyles = Function('v', span(temple, 'function Se(', 'function Te(') +
  ';return {styles:Se(null),select:Y};')(originalTerrain);
const seaStyles = Function('Y', '_', span(sea, 'var ye=', 'function Te(') + ';return we();')(option => option, option => option);
const summitStyle = Function(span(summit, 'var _e=3.2', 'function Ee(') + ';return Te;')();
const summitFar = /y\(i\.scene,\(\)=>\(\{([^}]+)\}\)/.exec(summit);
assert.ok(summitFar);
const summitFarStyle = Function('return {' + summitFar[1] + '};')();

async function loadGlb(chapter, asset) {
  const bytes = await readFile(new URL('../sumiro/assets/levels/' + chapter + '/' + asset + '.glb', import.meta.url));
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
}

function expectedStyle(chapter, asset, meshName, materialName) {
  if (chapter === 'ch3_pines') return pinesStyles.styles[meshName.split('_').pop()] ?? pinesStyles.base;
  if (chapter === 'ch4_temple') {
    const key = templeStyles.select({ name: meshName });
    return key === 'glow' ? { useRamp: false, color: 13129786, lineWeight: 0 }
      : templeStyles.styles[key] ?? { preset: 'stone', vertexPaint: false };
  }
  if (chapter === 'ch5_sea') return seaStyles[materialName.replace(/\.\d+$/, '')];
  return asset === 'far' ? summitFarStyle : summitStyle({ name: meshName });
}

test('all supplied later chapter GLB primitives match the authored selectors and paint roles', async () => {
  for (const [chapter, asset, count] of [
    ['ch3_pines', 'world', 106], ['ch4_temple', 'temple', 153], ['ch5_sea', 'sea', 37],
    ['ch6_summit', 'terrain', 60], ['ch6_summit', 'props', 41], ['ch6_summit', 'far', 1],
  ]) {
    const gltf = await loadGlb(chapter, asset);
    let matched = 0;
    for (const { mesh, name } of gltf.nodes) {
      if (mesh === undefined) continue;
      for (const primitive of gltf.meshes[mesh].primitives) {
        const materialName = gltf.materials?.[primitive.material]?.name ?? '';
        const expected = expectedStyle(chapter, asset, name, materialName);
        assert.ok(expected, name);
        const mode = resolveLaterChapterInkMaterial(chapter, name, materialName, asset);
        assert.ok(mode, name);
        const preset = originalPresets[expected.preset];
        const hasRamp = expected.useRamp ?? preset?.useRamp ?? true;
        const vertices = expected.vertexColors ? 'color' : (expected.vertexPaint ?? hasRamp) ? 'ink' : 'none';
        assert.equal(mode.vertices, vertices, name);
        assert.equal(mode.lineWeight, expected.lineWeight ?? preset?.lineWeight ?? 1, name);
        assert.equal(mode.color, expected.color, name);
        assert.equal(mode.side, expected.side, name);
        assert.equal(mode.snow === true, expected.snow === 1, name);
        assert.equal(mode.ramp !== undefined, hasRamp && expected.snow !== 1, name);
        if (mode.ramp) {
          assert.equal(mode.ramp.bias, expected.rampBias ?? preset?.rampBias ?? 0.02, name);
          assert.equal(mode.ramp.scale, expected.rampScale ?? 1.06, name);
          assert.deepEqual(mode.ramp.tint ?? [1, 1, 1], expected.tint ?? [1, 1, 1], name);
          if (vertices === 'ink') assert.equal(mode.ramp.cavity, expected.cavityK ?? 0.8, name);
        }
        if (vertices !== 'none') {
          const paint = gltf.accessors[primitive.attributes.COLOR_0];
          assert.equal(paint.type, 'VEC4');
          assert.equal(paint.componentType, 5123);
          assert.equal(paint.normalized, true);
        }
        matched++;
      }
    }
    assert.equal(matched, count, chapter + '/' + asset);
  }
  assert.equal(resolveLaterChapterInkMaterial('ch6_summit', 'not_a_style'), undefined);
  assert.equal(resolveLaterChapterInkMaterial('ch5_sea', 'sea_top', 'sea_far.001').lineWeight, 0);
  assert.equal(resolveLaterChapterInkMaterial('ch4_temple', 't_glow_a1').unlit, true);
});

test('the native Summit snow shader uses paint as a hollow and line mask', () => {
  const source = new MeshStandardMaterial({ vertexColors: true });
  const material = createLaterChapterInkMaterial(source, 'ch6_summit', 'snow_a1');
  const geometry = new PlaneGeometry();
  geometry.setAttribute('color', new Uint16BufferAttribute([
    65535,0,0,65535, 32768,0,0,32768, 65535,0,0,65535, 0,0,0,0,
  ], 4, true));
  const renderer = new WebGPURenderer({ canvas: { width: 16, height: 16 } });
  renderer.hasFeature = () => false;
  renderer._bindings = { getSharedBindGroup: group => group };
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const scenePass = pass(scene, camera);
  configureInkSurfacePass(scenePass);
  renderer.setRenderTarget(scenePass.renderTarget);
  renderer.setMRT(scenePass.getMRT());
  try {
    assert.equal(source.vertexColors, true);
    assert.equal(material.vertexColors, false);
    assert.deepEqual(material.color.toArray(), [0.925, 0.915, 0.885]);
    const builder = new WGSLNodeBuilder(new Mesh(geometry, material), renderer);
    builder.scene = scene;
    builder.camera = camera;
    builder.build();
    assert.match(builder.fragmentShader, /vec3<f32>\( 0\.74, 0\.8, 0\.92 \).*1\.0 - clamp\( \w+\.x/);
    assert.match(builder.fragmentShader, /normalWorld \* .*clamp\( \w+\.w, 0\.0, 1\.0 \) \* 0\.9/);
  } finally {
    material.dispose();
    source.dispose();
    geometry.dispose();
    scenePass.dispose();
  }
});
