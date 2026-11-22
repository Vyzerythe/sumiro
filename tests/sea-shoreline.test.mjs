import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  Mesh, NodeMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, REVISION,
  Scene, Vector3, Vector4, WebGPURenderer, WGSLNodeBuilder,
} from 'three/webgpu';
import { pass, texture3D, uniform } from 'three/tsl';
import { createInkNoiseTexture } from '../src/rendering/ink-paper-wash.mts';
import { configureInkSurfacePass } from '../src/rendering/ink-surface-pass.mts';
import { createSeaLacquerColor, createSeaShoreline } from '../src/rendering/sea-shoreline.mts';

const sea = await readFile(new URL('../sumiro/bundle/ch5_sea-CpHUIhkX.js', import.meta.url), 'utf8');
const quote = String.fromCharCode(96);
const marker = sea.indexOf('uniform vec3 uSeaSmear, uMist;');
const start = sea.lastIndexOf(quote, marker), end = sea.indexOf(quote, marker);
assert.ok(start >= 0 && end > marker);
const publishedShader = sea.slice(start + 1, end);

function sourceScalar(name, variables) {
  const declaration = new RegExp('float ' + name + ' = ([^;]+);').exec(publishedShader);
  assert.ok(declaration, name);
  return Function(...variables, 'return ' + declaration[1] + ';');
}

const saturate = value => Math.min(Math.max(value, 0), 1);
function smooth(edge0, edge1, value) {
  const t = saturate((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function compile(camera, output) {
  const renderer = new WebGPURenderer({ canvas: { width: 16, height: 16 } });
  renderer.hasFeature = () => false;
  renderer._bindings = { getSharedBindGroup: group => group };
  const scene = new Scene();
  const scenePass = pass(scene, camera);
  const attachments = configureInkSurfacePass(scenePass);
  const volume = createInkNoiseTexture();
  const material = new NodeMaterial();
  const geometry = new PlaneGeometry();
  try {
    material.fragmentNode = output({
      ...attachments, noise: texture3D(volume),
      base: uniform(new Vector4(0.2, 0.3, 0.4, 1)).setName('background'),
      level: uniform(3).setName('seaLevel'),
      seconds: uniform(2).setName('seaSeconds'),
      stir: uniform(0.5).setName('seaStir'),
    });
    const builder = new WGSLNodeBuilder(new Mesh(geometry, material), renderer);
    builder.scene = scene;
    builder.camera = camera;
    builder.build();
    return builder.fragmentShader;
  } finally {
    material.dispose();
    geometry.dispose();
    scenePass.dispose();
    volume.dispose();
  }
}

test('native lacquer retains the published depth lip, horizon drift and descending cutoffs', () => {
  assert.equal(REVISION, '187');
  const shader = compile(new PerspectiveCamera(), ({ noise, seconds, stir }) => {
    const color = createSeaLacquerColor({
      noise, seconds, stir,
      position: uniform(new Vector3(0, 3, -10)).setName('seaPosition'),
      cameraPosition: uniform(new Vector3(0, 6, 0)).setName('viewOrigin'),
      sceneDistance: uniform(11).setName('landDistance'),
      waterDistance: uniform(10).setName('waterDistance'),
    });
    return color.toVec4();
  });
  assert.equal((shader.match(/textureSampleLevel\(/g) ?? []).length, 7);
  const depth = /\( object\.landDistance - object\.waterDistance \) \* clamp\( \( - \w+\.y \), ([\d.]+), ([\d.]+) \)/.exec(shader);
  const lip = /smoothstep\( ([\d.]+), ([\d.]+), (\w+) \) \* \( 1\.0 - smoothstep\( ([\d.]+), ([\d.]+), \3 \) \)/.exec(shader);
  const horizon = /smoothstep\( ([\d.]+), ([\d.]+), \( \w+ \+ .*? \* ([\d.]+) \) \) \) \* 0\.96/.exec(shader);
  assert.ok(depth && lip && horizon);

  const publishedDepth = sourceScalar('deep', ['scene', 'me', 'V', 'clamp']);
  const publishedLip = sourceScalar('gleam', ['deep', 'wob', 'smoothstep']);
  const publishedHorizon = sourceScalar('far', ['dist', 'drift', 'smoothstep']);
  const low = Number(depth[1]), high = Number(depth[2]);
  for (const [scene, water, y] of [[10.03, 10, -1], [25, 22, -0.6], [300, 270, -0.01]]) {
    const nativeDepth = (scene - water) * Math.min(Math.max(-y, low), high);
    assert.equal(nativeDepth, publishedDepth(scene, water, { y }, (v, a, b) => Math.min(Math.max(v, a), b)));
  }
  for (const offset of [-0.02, 0, 0.025, 0.03, 0.06, 0.09, 0.15, 0.18, 0.4]) {
    const nativeLip = smooth(Number(lip[1]), Number(lip[2]), offset) *
      (1 - smooth(Number(lip[4]), Number(lip[5]), offset));
    assert.ok(Math.abs(nativeLip - publishedLip(offset, 0, smooth)) < 1e-12, 'lip at depth ' + offset);
  }
  for (const [distance, drift] of [[130, 0], [200, 0.2], [390, -0.4], [620, 0], [900, -0.25]]) {
    assert.equal(smooth(Number(horizon[1]), Number(horizon[2]), distance + drift * Number(horizon[3])),
      publishedHorizon(distance, drift, smooth));
  }
  assert.match(shader, /1\.0 - smoothstep\( 25\.0, 90\.0,/);
  assert.match(shader, /vec3<f32>\( 0\.72 \).*smoothstep\( 0\.1, 0\.5,/);
  assert.match(shader, /vec3<f32>\( 0\.62, 0\.61, 0\.6 \).* \* 0\.96/);
});

test('both projections evaluate Sea only at a top-side plane hit in front of completed land depth', () => {
  for (const camera of [new PerspectiveCamera(), new OrthographicCamera()]) {
    const shader = compile(camera, ({ base, depth, surfaceData, ...water }) =>
      createSeaShoreline(base, camera, { ...water, depth, marker: { texture: surfaceData, value: -7 } }));
    const depthBinding = /var (\w+) : texture_depth_2d;/.exec(shader);
    const gate = /if \( \( (\w+) >= (\w+) \) \) \{/.exec(shader);
    assert.ok(depthBinding && gate);
    assert.match(shader, /object\.seaLevel - \w+\.y \) \/ \w+\.y/);
    assert.match(shader, /if \( \( \w+\.y < -0\.000001 \) \) \{/);
    assert.match(shader, /\.x <= 1800\.0.*\.y <= 1800\.0.*\.x == -7\.0/);
    const load = shader.split('\n').find(line => line.includes('textureLoad( ' + depthBinding[1]));
    assert.match(load, /clamp\(/);
    assert.ok(shader.indexOf(load) < gate.index);
    assert.ok(gate.index < shader.indexOf('textureSampleLevel('));
    assert.equal((shader.match(/textureLoad\(/g) ?? []).length, 2);
    assert.equal((shader.match(/textureSampleLevel\(/g) ?? []).length, 7);
    assert.match(shader, /vec4<f32>\( mix\( \w+\.xyz,.* \w+\.w \)/);
  }
});

test('disabling the pre-grade layer reuses the unmodified input without texture reads', () => {
  const camera = new PerspectiveCamera();
  const shader = compile(camera, ({ base, depth, surfaceData, ...inputs }) => {
    const layer = createSeaShoreline(base, camera, { ...inputs, depth, strength: 0 });
    assert.equal(layer, base);
    return layer;
  });
  assert.doesNotMatch(shader, /textureLoad|textureSampleLevel|seaLevel/);
});
