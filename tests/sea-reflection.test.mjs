import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  CustomBlending, Group, MaxEquation, Mesh, MeshBasicNodeMaterial, NodeMaterial, OneFactor,
  OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, Vector4, WebGPURenderer, WGSLNodeBuilder,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { pass, texture3D, uniform } from 'three/tsl';
import { createInkNoiseTexture } from '../src/rendering/ink-paper-wash.mts';
import { blendSeaReflection, createSeaReflectionPass, seaReflectionMeshes } from '../src/rendering/sea-reflection.mts';

const sea = await readFile(new URL('../sumiro/bundle/ch5_sea-CpHUIhkX.js', import.meta.url), 'utf8');
function span(source, first, next) {
  const from = source.indexOf(first);
  const end = source.indexOf(next, from);
  assert.ok(from >= 0 && end > from, 'Published reflection boundary changed: ' + first);
  return source.slice(from, end);
}
const quote = String.fromCharCode(96);
const glsl = span(sea, ',me=' + quote, 'function he(');
const assembly = span(sea, 'let c=new e;c.name=' + quote + 'mirror' + quote, 'r.group.add(c),r.mirror=c');
const originalGroup = Function('e', 'n', 'he', 'i', 's', assembly + ';return c;');
const originalHeight = Function('a', 'r', span(sea, 'r.mirror.position.y=', ',r.mirrorMat.uniforms.uSea') + ';');

const clamp01 = value => Math.min(Math.max(value, 0), 1);
function smooth(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function createCompiler(camera) {
  const renderer = new WebGPURenderer({ canvas: { width: 32, height: 32 } });
  renderer.hasFeature = () => false;
  renderer._bindings = { getSharedBindGroup: group => group };
  return (mesh, scene, target = null) => {
    renderer.setRenderTarget(target);
    const compiler = new WGSLNodeBuilder(mesh, renderer);
    compiler.camera = camera;
    compiler.scene = scene;
    compiler.build();
    renderer.setRenderTarget(null);
    return compiler;
  };
}

function mirrorFixture(camera) {
  const opaque = pass(new Scene(), camera);
  const depth = opaque.getTextureNode('depth');
  const volume = createInkNoiseTexture();
  const mirror = createSeaReflectionPass(camera, { depth, noise: texture3D(volume) });
  return { mirror, depth, volume, stage: mirror.texture.passNode, dispose() {
    mirror.dispose();
    opaque.dispose();
    volume.dispose();
  } };
}

test('the supplied Sea GLB uses the published selected meshes and world reflection transforms', async () => {
  const bytes = await readFile(new URL('../sumiro/assets/levels/ch5_sea/sea.glb', import.meta.url));
  const model = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const { scene } = model;
  const fallback = new MeshBasicNodeMaterial();
  const original = originalGroup(Group, Mesh, () => fallback, { scene }, name => scene.getObjectByName(name));
  assert.deepEqual(original.children.map(mesh => mesh.geometry),
    seaReflectionMeshes.map(name => scene.getObjectByName(name).geometry));
  const fixture = mirrorFixture(new PerspectiveCamera());
  const actual = fixture.stage.scene.getObjectByName('mirror');
  const unbind = fixture.mirror.bind(scene);
  let releases = 0;
  scene.getObjectByName('wreck').geometry.addEventListener('dispose', () => releases++);
  try {
    for (const level of [0, 0.35, 1.8, 3]) {
      fixture.mirror.update(level, 19);
      originalHeight(level, { mirror: original });
      original.updateMatrixWorld(true);
      actual.updateMatrixWorld(true);
      for (const [index, mesh] of actual.children.entries()) {
        assert.equal(mesh.geometry, original.children[index].geometry);
        assert.deepEqual(mesh.matrixWorld.elements, original.children[index].matrixWorld.elements, mesh.name);
      }
    }
    unbind();
    unbind();
    assert.equal(actual.children.length, 0);
    assert.equal(releases, 0);
    assert.equal(scene.getObjectByName('wreck').parent, scene);
  } finally {
    fixture.dispose();
    fallback.dispose();
    scene.traverse(mesh => {
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    });
  }
});

test('native reflection rejects the original water and depth boundaries without reading its own attachment', () => {
  const sourceIf = glsl.split('\n').filter(line => line.includes('discard;')).join('\n');
  const originalReject = Function('d', 'gl_FragCoord', 'tDepth', 'uRes', 'linZ', 'texture',
    sourceIf.replaceAll('discard;', 'return true;') + '\nreturn false;');
  const originalK = Function('d', 'streak', 'dist', 'exp', 'mix', 'smoothstep',
    'return ' + /float k = ([^;]+)/.exec(glsl)[1] + ';');
  for (const camera of [new PerspectiveCamera(), new OrthographicCamera()]) {
    const fixture = mirrorFixture(camera);
    const compile = createCompiler(camera);
    const geometry = new PlaneGeometry();
    const source = new Mesh(geometry);
    source.name = 'reflector';
    fixture.mirror.bind(source, ['reflector']);
    const reflected = fixture.stage.scene.getObjectByName('reflector');
    try {
      const compiler = compile(reflected, fixture.stage.scene, fixture.stage.renderTarget);
      const shader = compiler.fragmentShader;
      assert.equal(fixture.stage.renderTarget.depthTexture, null);
      assert.equal(reflected.material.blending, CustomBlending);
      assert.equal(reflected.material.blendEquation, MaxEquation);
      assert.equal(reflected.material.blendSrc, OneFactor);
      assert.equal(reflected.material.blendDst, OneFactor);
      assert.match(shader, /textureLoad\(.*clamp\(.*fragCoord\.xy/);
      assert.ok(shader.indexOf('discard;') < shader.indexOf('textureSampleLevel('));
      const inputs = compiler.uniforms.fragment.map(uniform => uniform.node?.value);
      assert.ok(inputs.includes(fixture.depth.value));
      assert.ok(inputs.includes(fixture.volume));
      assert.ok(!inputs.includes(fixture.mirror.texture.value));
      assert.equal((shader.match(/textureLoad\(/g) ?? []).length, 1);
      assert.equal((shader.match(/textureSampleLevel\(/g) ?? []).length, 1);
      const bias = /\( (\w+) < ([\d.]+) \) \|\| .* - ([\d.]+) \)/.exec(shader);
      const attenuation = /exp\( \( \w+ \/ -([\d.]+) \) \) \* mix\( ([\d.]+), 1\.0, smoothstep\( ([\d.]+), ([\d.]+),/.exec(shader);
      const fade = /1\.0 - smoothstep\( ([\d.]+), ([\d.]+), length/.exec(shader);
      assert.ok(bias && attenuation && fade);
      for (const [immersion, mirrored, opaque] of [[-0.01, 2, 5], [0, 4, 5], [0, 4.97, 5], [3, 4.98, 5], [3, 6, 5]]) {
        assert.equal(immersion < Number(bias[2]) || mirrored > opaque - Number(bias[3]),
          originalReject(immersion, { z: mirrored, xy: 0 }, 0, 1, x => x, () => ({ r: opaque })));
      }
      for (const [immersion, streak, distance] of [[0, 0, 0], [3, 0.52, 130], [7, 1, 340], [30, 0.81, 421]]) {
        const mix = (a, b, t) => a + (b - a) * t;
        const native = Math.exp(-immersion / Number(attenuation[1])) *
          mix(Number(attenuation[2]), 1, smooth(Number(attenuation[3]), Number(attenuation[4]), streak)) *
          (1 - smooth(Number(fade[1]), Number(fade[2]), distance));
        assert.equal(native, originalK(immersion, streak, distance, Math.exp, mix, smooth));
      }
    } finally {
      fixture.dispose();
      source.material.dispose();
      geometry.dispose();
    }
  }
});

test('composition uses the isolated color and component-wise maximum with base alpha', () => {
  const camera = new PerspectiveCamera();
  const fixture = mirrorFixture(camera);
  const base = uniform(new Vector4(0.2, 0.2, 0.2, 0.8)).setName('seaBase');
  const material = new NodeMaterial();
  const geometry = new PlaneGeometry();
  try {
    assert.equal(blendSeaReflection(base, fixture.mirror.texture, 0), base);
    material.fragmentNode = blendSeaReflection(base, fixture.mirror.texture);
    const compiler = createCompiler(camera)(new Mesh(geometry, material), new Scene());
    const shader = compiler.fragmentShader;
    assert.equal((shader.match(/textureSample\(/g) ?? []).length, 1);
    assert.doesNotMatch(shader, /textureLoad|texture_depth/);
    assert.match(shader, /max\( object\.seaBase\.xyz,.*object\.seaBase\.w/);
    assert.ok(compiler.uniforms.fragment.some(uniform => uniform.node?.value === fixture.mirror.texture.value));
  } finally {
    material.dispose();
    geometry.dispose();
    fixture.dispose();
  }
});
