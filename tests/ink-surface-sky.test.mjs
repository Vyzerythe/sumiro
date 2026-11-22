import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Mesh, NodeMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, REVISION,
  Scene, Vector3, Vector4, WebGPURenderer, WGSLNodeBuilder,
} from 'three/webgpu';
import { pass, texture3D, uniform } from 'three/tsl';
import { createInkNoiseTexture } from '../src/rendering/ink-paper-wash.mts';
import { createInkSurfaceSky, createInkWashSheet, INK_PAPER_BASE } from '../src/rendering/ink-surface-sky.mts';

function compile(camera, build) {
  const renderer = new WebGPURenderer({ canvas: { width: 32, height: 32 } });
  renderer.hasFeature = () => false;
  renderer._bindings = { getSharedBindGroup: group => group };
  const scene = new Scene();
  const scenePass = pass(scene, camera);
  const volume = createInkNoiseTexture();
  const noise = texture3D(volume);
  const material = new NodeMaterial();
  const geometry = new PlaneGeometry();
  const base = uniform(new Vector4(...INK_PAPER_BASE, 1)).setName('sceneColor');
  const sheet = {
    noise,
    seconds: uniform(1).setName('washSeconds'),
    center: uniform(new Vector3(0, 0, -30)).setName('sheetCenter'),
    rightSpan: uniform(new Vector3(10, 0, 0)).setName('sheetRightSpan'),
    upSpan: uniform(new Vector3(0, 8, 0)).setName('sheetUpSpan'),
  };
  try {
    material.fragmentNode = build(base, scenePass.getTextureNode('depth'), sheet);
    const builder = new WGSLNodeBuilder(new Mesh(geometry, material), renderer);
    builder.scene = scene;
    builder.camera = camera;
    builder.build();
    return builder.fragmentShader;
  } finally {
    material.dispose();
    geometry.dispose();
    volume.dispose();
    scenePass.dispose();
  }
}

test('r187 textures only the clear-depth sky and leaves the composited foreground intact', () => {
  assert.equal(REVISION, '187');
  const camera = new PerspectiveCamera();
  const shader = compile(camera, (base, depth, { noise }) => createInkSurfaceSky(base, depth, camera, { noise }));
  const depth = /(\w+) = textureLoad\(/.exec(shader);
  const result = /(\w+) = object\.sceneColor;/.exec(shader);
  const gate = /if \( \( (\w+) == 1\.0 \) \) \{/.exec(shader);
  assert.ok(depth && result && gate);
  assert.equal(gate[1], depth[1]);
  assert.ok(depth.index < gate.index);
  assert.match(shader, /textureDimensions\(.*0/);
  assert.match(shader, /textureLoad\(.*clamp\(/);
  const paperScope = shader.slice(gate.index, shader.indexOf('\n\t}', gate.index));
  assert.equal((paperScope.match(/textureSampleLevel\(/g) ?? []).length, 23);
  assert.match(paperScope, /normalize\( .*\.xyz, 0\.0 \) \)\.xyz \)/);
  assert.match(paperScope, /\.y \* -2\.0/);
  assert.match(paperScope, /vec4<f32>\( 0\.0, 1\.0, 0\.0, 0\.0 \)/);
  assert.ok(paperScope.includes(result[1] + '.xyz'));
  assert.ok(paperScope.includes(result[1] + '.w'));
  assert.ok(shader.includes('output.color = ' + result[1] + ';'));
});

test('a perspective wash compares positive linear Z before sampling inside the finite sheet', () => {
  const camera = new PerspectiveCamera();
  const shader = compile(camera, (base, depth, sheet) => createInkWashSheet(base, depth, camera, sheet, { kind: 'bank' }));
  const gap = /smoothstep\( 0\.0, 1\.2, \( (\w+) - (\w+) \) \)/.exec(shader);
  const loaded = /(\w+) = textureLoad\(/.exec(shader);
  assert.ok(gap && loaded);
  const [, sceneDistance, washDistance] = gap;
  const fromDepth = shader.split('\n').find(line => line.includes(sceneDistance + ' ='));
  const fromTravel = shader.split('\n').find(line => line.includes(washDistance + ' ='));
  assert.match(fromDepth, /\/.*\*\s*\w+.*- object\./);
  assert.ok(fromDepth.includes(loaded[1]));
  assert.match(fromTravel, / \* \( - \w+\.z \)/);
  assert.match(shader, /cross\( object\.sheetRightSpan, object\.sheetUpSpan \)/);
  assert.ok(shader.includes('if ( ( ' + sceneDistance + ' > ' + washDistance + ' ) ) {'));
  assert.ok(shader.indexOf('.y < 1.0') < loaded.index);
  assert.equal((shader.match(/textureSampleLevel\(/g) ?? []).length, 12);
  assert.match(shader, /object\.washSeconds .*vec3<f32>\( 0\.02, -0\.05, 0\.01 \)/);
});

test('orthographic sheets unproject a varying origin and use linear camera depth', () => {
  const camera = new OrthographicCamera();
  const shader = compile(camera, (base, depth, sheet) => createInkWashSheet(base, depth, camera, sheet));
  assert.match(shader, /vec4<f32>\( vec3<f32>\( \( \w+\.xy \/ vec2<f32>\( \w+\.w \) \), 0\.0 \), 1\.0 \)/);
  const gap = /smoothstep\( 0\.0, 1\.2, \( (\w+) - \w+ \) \)/.exec(shader);
  assert.ok(gap);
  const linear = shader.split('\n').find(line => line.includes(gap[1] + ' ='));
  assert.match(linear, / \* /);
  assert.doesNotMatch(linear, /\//);
  assert.equal((shader.match(/textureSampleLevel\(/g) ?? []).length, 9);
});

test('disabled sky and wash controls reuse the exact input node', () => {
  const camera = new PerspectiveCamera();
  const shader = compile(camera, (base, depth, sheet) => {
    assert.equal(createInkSurfaceSky(base, depth, camera, { noise: sheet.noise, strength: 0 }), base);
    assert.equal(createInkWashSheet(base, depth, camera, sheet, { strength: 0 }), base);
    return base;
  });
  assert.doesNotMatch(shader, /texture_(depth|3d)|textureLoad|washSeconds/);
});
