import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { MeshStandardMaterial, PerspectiveCamera, Scene, WebGPURenderer, WGSLNodeBuilder } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { pass } from 'three/tsl';
import { createChapterTwoInkMaterial, resolveChapterTwoInkMaterial } from '../src/application/chapter-two-materials.mts';
import { configureInkSurfacePass } from '../src/rendering/ink-surface-pass.mts';
import { n as publishedPresets } from '../sumiro/bundle/constants-BjlLV5tN.js';
import { t as publishedTerrainPresets } from '../sumiro/bundle/materials-CGuChJ0C.js';

const source = await readFile(new URL('../sumiro/bundle/ch2_pass-9Opjv4P2.js', import.meta.url), 'utf8');

function span(begin, end) {
  const first = source.indexOf(begin);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, 'Published selector boundary changed');
  return source.slice(first, last);
}

const publishedPass = Function('v', span('function Je(', 'async function Ye(') + 'return Je;')(publishedTerrainPresets)
  ({ texture: 'cliff' }, { texture: 'top_rock' }, { texture: 'top_stone' });
const publishedCourt = Function('v', span('function Le(', 'var Re=') + 'return Le;')(publishedTerrainPresets)(publishedPass);
const publishedCourtName = Function(span('var Re=', 'async function ze(') + 'return Re;')();

async function assetBytes(asset) {
  return readFile(new URL('../sumiro/assets/levels/ch2_pass/' + asset + '.glb', import.meta.url));
}

function extractJson(bytes) {
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
}

test('all supplied Chapter Two primitives resolve the original Je and Le paint roles and line weights', async () => {
  const counted = {};
  for (const asset of ['pass', 'court']) {
    const gltf = extractJson(await assetBytes(asset));
    counted[asset] = 0;
    assert.equal(gltf.textures, undefined);
    for (const { name, primitives } of gltf.meshes) for (const { attributes, material } of primitives) {
      counted[asset]++;
      const color = gltf.accessors[attributes.COLOR_0];
      assert.equal(color.type, 'VEC4');
      assert.equal(color.componentType, 5123);
      assert.equal(color.normalized, true);
      const authored = asset === 'pass'
        ? publishedPass[name.startsWith('crumble') ? 'crumble' : name]
        : name.startsWith('pass_') ? publishedPass[name === 'pass_wall' ? 'pass_tread' : name]
          : publishedCourt[publishedCourtName(name)];
      assert.ok(authored, name);
      assert.ok(gltf.materials[material].name);
      const style = resolveChapterTwoInkMaterial(asset, name);
      const vertices = authored.vertexColors ? 'color'
        : authored.vertexPaint === false || authored.useRamp === false ? 'none' : 'ink';
      assert.equal(style.vertices, vertices, name);
      assert.equal(style.lineWeight, authored.lineWeight ?? publishedPresets[authored.preset]?.lineWeight ?? 1, name);
      assert.equal(style.side, authored.side, name);
      if (style.ramp) {
        assert.equal(style.ramp.bias, authored.rampBias, name);
        assert.equal(style.ramp.scale, authored.rampScale, name);
        assert.deepEqual(style.ramp.tint, authored.tint, name);
        if (vertices === 'ink') assert.equal(style.ramp.cavity, authored.cavityK, name);
      }
    }
  }
  assert.deepEqual(counted, { pass: 15, court: 24 });
  assert.equal(resolveChapterTwoInkMaterial('pass', 'pass_side.001').preset, 'face');
  assert.equal(resolveChapterTwoInkMaterial('pass', 'pass_top_rock').preset, 'path');
  assert.equal(resolveChapterTwoInkMaterial('court', 'pass_wall').preset, 'rubble');
  assert.equal(resolveChapterTwoInkMaterial('court', 'court_tile').preset, 'stone');
  assert.equal(resolveChapterTwoInkMaterial('pass', 'unknown').preset, 'rock');
});

test('the native shader reads real red GLB paint as cavity and weight, without tinting albedo red', async () => {
  const bytes = await assetBytes('pass');
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const mesh = gltf.scene.getObjectByName('pass_top_rock');
  assert.ok(mesh?.isMesh);
  const paint = mesh.geometry.getAttribute('color');
  assert.deepEqual([paint.getX(0), paint.getY(0), paint.getZ(0), paint.getW(0)], [1, 0, 0, 1]);
  const original = mesh.material;
  assert.equal(original.vertexColors, true);
  const mapped = createChapterTwoInkMaterial(original, 'pass', mesh.name);
  assert.equal(mapped.vertexColors, false);
  assert.equal(original.vertexColors, true);
  assert.ok(Math.max(mapped.color.r, mapped.color.g, mapped.color.b) - Math.min(mapped.color.r, mapped.color.g, mapped.color.b) < 0.08);

  const renderer = new WebGPURenderer({ canvas: { width: 16, height: 16 } });
  renderer.hasFeature = () => false;
  renderer._bindings = { getSharedBindGroup: group => group };
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const scenePass = pass(scene, camera);
  configureInkSurfacePass(scenePass);
  renderer.setRenderTarget(scenePass.renderTarget);
  renderer.setMRT(scenePass.getMRT());
  mesh.material = mapped;
  try {
    const builder = new WGSLNodeBuilder(mesh, renderer);
    builder.scene = scene;
    builder.camera = camera;
    builder.build();
    const shader = builder.fragmentShader;
    assert.match(shader, /DiffuseColor = .*mix\( 1\.0, clamp\( \w+\.x, 0\.0, 1\.0 \), 0\.5 \)/);
    assert.match(shader, /normalWorld \* .*clamp\( \w+\.w, 0\.0, 1\.0 \) \* 0\.9/);
  } finally {
    mapped.dispose();
    scenePass.dispose();
    gltf.scene.traverse(object => {
      if (object.isMesh) {
        object.geometry.dispose();
        if (object.material !== mapped) object.material.dispose();
      }
    });
    original.dispose();
  }

  const prop = new MeshStandardMaterial({ vertexColors: true });
  const door = createChapterTwoInkMaterial(prop, 'court', 'court_leaf__door');
  assert.equal(door.vertexColors, true);
  assert.equal(door.color.getHex(), 0xffffff);
  door.dispose();
  prop.dispose();
});
