import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DataTexture, DirectionalLight, DoubleSide, Mesh, MeshStandardMaterial, NoColorSpace,
  PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, Uint16BufferAttribute,
  WebGPURenderer, WGSLNodeBuilder,
} from 'three/webgpu';
import { lights, pass } from 'three/tsl';
import { createInkMaterial } from '../src/rendering/ink-material.mts';
import { configureInkSurfacePass } from '../src/rendering/ink-surface-pass.mts';

function buildFragment(material, vertexPaint = false) {
  const renderer = new WebGPURenderer({ canvas: { width: 16, height: 16 } });
  renderer.hasFeature = () => false;
  renderer._bindings = { getSharedBindGroup: group => group };
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const scenePass = pass(scene, camera);
  configureInkSurfacePass(scenePass);
  renderer.setRenderTarget(scenePass.renderTarget);
  renderer.setMRT(scenePass.getMRT());
  const geometry = new PlaneGeometry();
  if (vertexPaint) {
    geometry.setAttribute('color', new Uint16BufferAttribute([
      65535, 0, 0, 65535,
      32767, 0, 0, 32767,
      65535, 0, 0, 0,
      65535, 0, 0, 65535,
    ], 4, true));
  }
  const restore = material.lightsNode;
  material.lightsNode = lights([new DirectionalLight()]);
  try {
    const builder = new WGSLNodeBuilder(new Mesh(geometry, material), renderer);
    builder.scene = scene;
    builder.camera = camera;
    builder.build();
    return builder.fragmentShader;
  } finally {
    material.lightsNode = restore;
    renderer.setMRT(null);
    renderer.setRenderTarget(null);
    scenePass.dispose();
    geometry.dispose();
  }
}

test('ink materials borrow correctly tagged textures and retain source material settings', () => {
  const albedo = new DataTexture();
  albedo.colorSpace = SRGBColorSpace;
  const normal = new DataTexture();
  normal.colorSpace = NoColorSpace;
  let textureDisposals = 0;
  const onDispose = () => textureDisposals++;
  albedo.addEventListener('dispose', onDispose);
  normal.addEventListener('dispose', onDispose);
  const source = new MeshStandardMaterial({
    name: 'mat_boulder', map: albedo, normalMap: normal, roughness: 0.37,
    side: DoubleSide, alphaTest: 0.3, color: 0x8a9295,
  });
  const material = createInkMaterial(source);
  assert.equal(material.isMeshStandardNodeMaterial, true);
  assert.equal(material.name, source.name);
  assert.equal(material.map, albedo);
  assert.equal(material.normalMap, normal);
  assert.equal(material.map.colorSpace, SRGBColorSpace);
  assert.equal(material.normalMap.colorSpace, NoColorSpace);
  assert.equal(material.roughness, 0.37);
  assert.equal(material.side, DoubleSide);
  assert.equal(material.alphaTest, 0.3);
  assert.ok(material.color.equals(source.color));
  assert.notEqual(material.color, source.color);
  assert.equal(source.fog, true);
  assert.equal(material.fog, false);
  material.dispose();
  assert.equal(textureDisposals, 0);
  source.dispose();
  albedo.dispose();
  normal.dispose();
  assert.equal(textureDisposals, 2);
});

test('the field preset consumes vertex paint and writes normal, line, moving ID and fog outputs', () => {
  const map = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  map.colorSpace = SRGBColorSpace;
  const source = new MeshStandardMaterial({
    name: 'mat_field.001', map, vertexColors: true, alphaTest: 0.2,
  });
  const material = createInkMaterial(source, { lineWeight: 0.65, fogWeight: 0.25, movingSurfaceId: 7 });
  try {
    const shader = buildFragment(material, true);
    assert.equal(source.vertexColors, true);
    assert.equal(material.vertexColors, false);
    assert.match(shader, /@location\( 0 \) m0 : vec4<f32>/);
    assert.match(shader, /@location\( 1 \) m1 : vec4<f32>/);
    assert.match(shader, /@location\( 2 \) m2 : vec2<f32>/);
    assert.match(shader, /DiffuseColor = .*vec3<f32>\( 1\.018, 1\.0, 0\.965 \)/);
    const paint = /mix\( 1\.0, clamp\( (\w+)\.x, 0\.0, 1\.0 \), 0\.72 \)/.exec(shader);
    assert.ok(paint, 'red vertex paint must affect diffuse cavity shading');
    assert.match(shader, new RegExp(String.raw`clamp\( ${paint[1]}\.w, 0\.0, 1\.0 \) \* 0\.65`));
    assert.match(shader, /normalWorld \* vec3<f32>\( 0\.5 \)/);
    assert.match(shader, /discard;/);
    assert.match(shader, /output\.m2 = vec4<f32>\( 7\.0, 0\.25, 0\.0, 1\.0 \)\.xy/);
  } finally {
    material.dispose();
    source.dispose();
    map.dispose();
  }
});

test('an explicit preset overrides the name and unknown names preserve ordinary vertex color', () => {
  const source = new MeshStandardMaterial({ name: 'mat_field', fog: false });
  const crow = createInkMaterial(source, { preset: 'crow' });
  const pillar = createInkMaterial(source, { preset: 'pillar' });
  source.name = 'unnamed_paint';
  source.vertexColors = true;
  const fallback = createInkMaterial(source);
  try {
    const crowShader = buildFragment(crow);
    const pillarShader = buildFragment(pillar);
    assert.match(crowShader, /normalWorld \* .*0\.0 \);/);
    assert.match(pillarShader, /normalWorld \* .*0\.85 \);/);
    assert.match(crowShader, /output\.m2 = vec4<f32>\( 0\.0, 0\.0, 0\.0, 1\.0 \)\.xy/);
    assert.equal(fallback.vertexColors, true);
    assert.equal(fallback.colorNode, null);
  } finally {
    crow.dispose();
    pillar.dispose();
    fallback.dispose();
    source.dispose();
  }
});

test('the adapter rejects blended materials and invalid weights', () => {
  const source = new MeshStandardMaterial();
  try {
    assert.throws(() => createInkMaterial(source, { preset: 'constructor' }), /Unknown ink material preset/);
    assert.throws(() => createInkMaterial(source, { fogWeight: NaN }), /weights/);
    assert.throws(() => createInkMaterial(source, { movingSurfaceId: 2049 }), /surface IDs/);
    source.transparent = true;
    assert.throws(() => createInkMaterial(source), /depth-writing path/);
  } finally {
    source.dispose();
  }
});
