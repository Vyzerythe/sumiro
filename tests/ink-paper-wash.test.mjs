import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  LinearFilter, Mesh, NodeMaterial, NoColorSpace, PerspectiveCamera, PlaneGeometry, RedFormat,
  RepeatWrapping, REVISION, Scene, UnsignedByteType, Vector2, Vector3, Vector4,
  WebGPURenderer, WGSLNodeBuilder,
} from 'three/webgpu';
import { texture3D, uniform } from 'three/tsl';
import {
  blendInkWash, createInkAnimatedWash, createInkNoiseTexture, createInkPaperColor,
} from '../src/rendering/ink-paper-wash.mts';

function buildFragment(build) {
  const renderer = new WebGPURenderer({ canvas: { width: 32, height: 32 } });
  renderer.hasFeature = () => false;
  renderer._bindings = { getSharedBindGroup: group => group };
  const material = new NodeMaterial();
  const geometry = new PlaneGeometry();
  const volume = createInkNoiseTexture();
  const input = {
    noise: texture3D(volume),
    direction: uniform(new Vector3(0, 0.5, 1)).setName('paperRay'),
    radiansPerPixel: uniform(0.001).setName('paperRadiansPerPixel'),
    position: uniform(new Vector3(4, 5, 6)).setName('washPosition'),
    uv: uniform(new Vector2(0.5, 0.5)).setName('washUv'),
    seconds: uniform(1).setName('washSeconds'),
    sceneDistance: uniform(55).setName('sceneDistance'),
    washDistance: uniform(35).setName('washDistance'),
  };
  const base = uniform(new Vector4(0.8, 0.6, 0.4, 1)).setName('paperBase');
  try {
    material.fragmentNode = build(base, input);
    const builder = new WGSLNodeBuilder(new Mesh(geometry, material), renderer);
    builder.scene = new Scene();
    builder.camera = new PerspectiveCamera();
    builder.build();
    return builder.fragmentShader;
  } finally {
    material.dispose();
    geometry.dispose();
    volume.dispose();
  }
}

test('the default noise volume matches the shipped generator byte for byte', () => {
  const volume = createInkNoiseTexture();
  const other = createInkNoiseTexture(1);
  try {
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    // Evaluated from the original R() in ink_material-CrFtRYQr.js.
    assert.equal(digest(volume.image.data), '74e1f0b78f17416b036046e3d9d540fce117580ccaa6ece57ed3b8d802bf936f');
    assert.notEqual(digest(other.image.data), digest(volume.image.data));
    assert.deepEqual([volume.image.width, volume.image.height, volume.image.depth], [64, 64, 64]);
    assert.equal(volume.format, RedFormat);
    assert.equal(volume.type, UnsignedByteType);
    assert.equal(volume.colorSpace, NoColorSpace);
    assert.equal(volume.wrapS, RepeatWrapping);
    assert.equal(volume.wrapT, RepeatWrapping);
    assert.equal(volume.wrapR, RepeatWrapping);
    assert.equal(volume.minFilter, LinearFilter);
    assert.equal(volume.magFilter, LinearFilter);
    assert.equal(volume.generateMipmaps, false);
    assert.throws(() => createInkNoiseTexture(0), RangeError);
  } finally {
    volume.dispose();
    other.dispose();
  }
});

test('paper texture samples mip zero along a stable ray and preserves the base alpha', () => {
  assert.equal(REVISION, '187');
  const shader = buildFragment((base, input) => createInkPaperColor(base, { ...input, strength: 0.5 }));
  assert.equal((shader.match(/\btexture_3d<f32>/g) ?? []).length, 1);
  assert.equal((shader.match(/\btextureSampleLevel\(/g) ?? []).length, 23);
  assert.match(shader, /normalize\( object\.paperRay \)/);
  assert.match(shader, /object\.paperRadiansPerPixel/);
  assert.match(shader, /fract\(/);
  assert.match(shader, /floor\(/);
  assert.doesNotMatch(shader, /washSeconds|washDistance/);
  assert.match(shader, /output\.color = .*object\.paperBase\.xyz.*0\.5.*object\.paperBase\.w/);
});

test('animated wash clips at the plane rim and fades against linear scene depth', () => {
  const billow = buildFragment((_, input) => createInkAnimatedWash(input));
  const bank = buildFragment((base, input) => blendInkWash(base, createInkAnimatedWash(input, { kind: 'bank' })));
  for (const [shader, taps] of [[billow, 9], [bank, 12]]) {
    assert.equal((shader.match(/\btextureSampleLevel\(/g) ?? []).length, taps);
    assert.match(shader, /object\.washSeconds .*vec3<f32>\( 0\.02, -0\.05, 0\.01 \)/);
    assert.match(shader, /smoothstep\( 0\.0, 1\.2, \( object\.sceneDistance - object\.washDistance \) \)/);
    assert.match(shader, /\* 0\.95/);
  }
  assert.match(billow, /1\.0 - smoothstep\( 0\.66, 0\.98, max\( abs\(/);
  assert.doesNotMatch(billow, /smoothstep\( 10\.0, 40\.0,/);
  assert.match(bank, /1\.0 - smoothstep\( 0\.9, 1\.0, abs\(/);
  assert.match(bank, /smoothstep\( 10\.0, 40\.0, object\.washDistance \)/);
  assert.match(bank, /output\.color = .*mix\( object\.paperBase\.xyz,.*object\.paperBase\.w/);
});

test('disabled effects require no paper or wash texture bindings', () => {
  const paper = buildFragment((base, input) => {
    const disabled = createInkPaperColor(base, { ...input, strength: 0 });
    assert.equal(disabled, base);
    return disabled;
  });
  const wash = buildFragment((_, input) => createInkAnimatedWash(input, { strength: 0 }));
  assert.doesNotMatch(paper + wash, /texture_3d|washSeconds|paperRadiansPerPixel/);
  assert.match(wash, /output\.color = vec4<f32>\( 0\.0, 0\.0, 0\.0, 0\.0 \)/);
});
