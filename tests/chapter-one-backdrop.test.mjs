import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  CustomBlending, DataTexture, MathUtils, PerspectiveCamera, Scene, Vector3, WGSLNodeBuilder, WebGPURenderer,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { chapterOneRail } from '../src/application/chapter-one-rail.mts';
import { chapterOneBackdropOpacity, mountChapterOneBackdrop } from '../src/rendering/chapter-one-backdrop.mts';

const shipped = await readFile(new URL('../sumiro/bundle/backdrop-DdFE5-aJ.js', import.meta.url), 'utf8');
const assetDir = new URL('../sumiro/assets/', import.meta.url);

function sourceSpan(start, next) {
  const from = shipped.indexOf(start);
  const end = shipped.indexOf(next, from);
  assert.ok(from >= 0 && end > from, 'Shipped backdrop boundary changed: ' + start);
  return shipped.slice(from, end);
}

const originalUpdate = new Function('s', 'H', 'W', 'U', 'K', 'G', 'J', 'q',
  'let V={uFallbackVig:{}};' + sourceSpan('function I(e,t)', 'var L=') +
  sourceSpan('function ce(e)', 'function le(e)') + 'return ce;');
const originalStrip = new Function('w', 'v', 'k', 'h', 'b', 'p', 'T', 'E', 'c',
  sourceSpan('function ee(e,t,n)', 'function te(e,t,n)') + 'return ee;');
const originalRibbons = new Function(sourceSpan('var M={0:', 'function I(e,t)') + 'return re();');

async function mountFixture() {
  const bytes = await readFile(new URL('backdrop/hills.glb', assetDir));
  const { scene: model } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const textures = new Map();
  const scene = new Scene();
  const loadJSON = async path => JSON.parse(await readFile(new URL(path, assetDir), 'utf8'));
  const backdrop = await mountChapterOneBackdrop(scene, {
    loadGLTF: async path => {
      assert.equal(path, 'backdrop/hills.glb');
      return { scene: model };
    },
    loadJSON,
    async loadTexture(path) {
      const bytes = await readFile(new URL(path, assetDir));
      if (path.endsWith('.webp')) {
        assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
        assert.equal(bytes[20] & 0x10, 0x10, `${path} must preserve the WebP alpha plane`);
      } else {
        assert.equal(bytes.readUInt16BE(0), 0xffd8);
      }
      const source = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
      source.name = path;
      textures.set(path, source);
      return source;
    },
  });
  return { backdrop, model, scene, textures, loadJSON };
}

function compileNode(mesh, scene, camera) {
  const renderer = new WebGPURenderer({ canvas: { width: 32, height: 32 } });
  renderer.hasFeature = () => false;
  renderer._bindings = { getSharedBindGroup: group => group };
  const compiler = new WGSLNodeBuilder(mesh, renderer);
  compiler.camera = camera;
  compiler.scene = scene;
  compiler.build();
  return compiler;
}

function drawUniform(compiler, name) {
  const binding = compiler.uniforms.fragment.find(uniform => uniform.name === name);
  assert.ok(binding, `Missing generated uniform ${name}`);
  return binding.node;
}

test('authored backdrop geometry, scale and camera fades agree with the supplied GLB and original routine', async () => {
  const { backdrop, model, scene, textures, loadJSON } = await mountFixture();
  const hills = await loadJSON('backdrop/hills.json');
  const strips = await loadJSON('backdrop/strips.json');
  const camera = new PerspectiveCamera(40, 16 / 9, 0.03, 3000);
  const rows = hills.map(hill => ({
    ...hill, mesh: { visible: true }, material: { uniforms: { uShow: { value: 1 } } },
  }));
  const authoredRibbons = originalRibbons();
  for (const ribbon of authoredRibbons) {
    rows.push({
      name: 'ribbons_' + ribbon.name, side: ribbon.side, mesh: { visible: true }, material: { uniforms: { uShow: { value: 1 } } },
    });
  }
  const sky = { uniforms: { uRedFade: {}, uBank: {} } };
  const vista = { position: camera.position.clone() };
  const regularUpdate = originalUpdate(MathUtils, sky, 1, false, false, vista, rows, []);
  const cards = new Map();
  const representativeCards = new Set(['NF', 'NA1', 'NA2', 'WA1']);
  assert.equal(hills.length, 30);
  assert.equal(strips.length, 8);
  assert.equal(textures.size, 41);
  for (const hill of hills) {
    const name = hill.name;
    const mesh = backdrop.group.getObjectByName('backdrop_' + name);
    assert.ok(mesh?.isMesh);
    assert.equal(mesh.geometry, model.getObjectByName(name).geometry);
    assert.deepEqual(mesh.position.toArray(), [0, 0, 0]);
    assert.deepEqual(mesh.scale.toArray(), [1, 1, 1]);
    if (representativeCards.has(name)) {
      const shader = compileNode(mesh, scene, camera);
      cards.set(name, { mesh, show: drawUniform(shader, 'backdropShow') });
    }
  }
  for (const strip of strips) {
    const source = originalStrip({ x: 2, y: 5, z: -25 }, function (...args) { this.args = args; },
      x => x, function () {}, () => ({}), null, null, null,
      function (geometry) { this.geometry = geometry; this.position = { set: (...xyz) => { this.xyz = xyz; } }; });
    const original = source({}, strip, null);
    const actual = backdrop.group.getObjectByName('backdrop_strip_' + strip.name);
    const { radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded } = actual.geometry.parameters;
    assert.deepEqual([radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded], original.geometry.args);
    assert.deepEqual(actual.position.toArray(), original.xyz);
  }

  const adjacentOrder = [...strips.map(s => [s.r, 'strip_' + s.name]), ...hills.map(h => [h.dist, h.name]),
    ...authoredRibbons.map(r => [r.dist - 1, 'ribbons_' + r.name])].sort((a, b) => b[0] - a[0]);
  assert.deepEqual(backdrop.group.children.filter(x => x.isMesh).sort((a, b) => a.renderOrder - b.renderOrder).map(x => x.name),
    adjacentOrder.map(([, name]) => 'backdrop_' + name));
  for (const ribbon of authoredRibbons) {
    const [{ x, y, z, w, h }] = ribbon.ribbons;
    const mesh = backdrop.group.getObjectByName('backdrop_ribbons_' + ribbon.name);
    assert.deepEqual(mesh.position.toArray(), [x, y, z]);
    assert.deepEqual(mesh.scale.toArray(), [w, h, 1]);
  }
  const pose = {};
  for (let frame = 0; frame <= 378; frame += 0.5) {
    chapterOneRail.poseAt(frame / 24, pose);
    camera.position.set(pose.x, pose.y, pose.z);
    camera.rotation.set(MathUtils.degToRad(pose.pitch), MathUtils.degToRad(pose.yaw), 0, 'YXZ');
    camera.updateMatrixWorld(true);
    backdrop.update(camera, frame / 24);
    regularUpdate({ camera, renderFn: true });
    const world = camera.matrixWorld.elements;
    const yaw = MathUtils.radToDeg(Math.atan2(world[8], world[10]));
    for (const row of rows) {
      const alpha = row.material.uniforms.uShow.value;
      assert.equal(chapterOneBackdropOpacity(row.side, yaw, pose.z, row.showZ), alpha, row.name);
      assert.equal(backdrop.group.getObjectByName('backdrop_' + row.name).visible, row.mesh.visible);
      if (cards.has(row.name)) assert.equal(cards.get(row.name).show.value, alpha);
    }
    for (const ribbon of authoredRibbons) {
      const mesh = backdrop.group.getObjectByName('backdrop_ribbons_' + ribbon.name);
      const originalRight = new Vector3(camera.position.z - mesh.position.z, 0, mesh.position.x - camera.position.x).normalize();
      const nativeRight = new Vector3(1, 0, 0).applyQuaternion(mesh.quaternion);
      assert.ok(nativeRight.distanceTo(originalRight) < 1e-15);
    }
  }

  const nativeVista = backdrop.group.getObjectByName('backdrop_vista');
  backdrop.setPalette({ vista: 98 });
  backdrop.update(camera, 25);
  originalUpdate(MathUtils, sky, 1, false, true, vista, rows, [])({ camera, renderFn: true });
  assert.deepEqual(nativeVista.position.toArray(), vista.position.toArray());
  assert.equal(nativeVista.rotation.y, MathUtils.degToRad(98));
  for (const [index, sector] of nativeVista.children.entries()) {
    assert.equal(sector.rotation.y, index * 2 * Math.PI / 3);
    const eligible = hills.filter(hill => hill.side === 'N' && !hill.showZ);
    assert.equal(sector.children.length, eligible.length);
    for (const hill of eligible) {
      const mesh = sector.getObjectByName('backdrop_vista_' + hill.name);
      assert.deepEqual(mesh.position.toArray(), hill.key.map(x => -x));
      assert.equal(mesh.material, backdrop.group.getObjectByName('backdrop_' + hill.name).material);
    }
  }
  for (const row of rows) assert.equal(backdrop.group.getObjectByName('backdrop_' + row.name).visible, row.mesh.visible);
  backdrop.dispose();
  assert.equal(scene.children.length, 0);
});

test('r187 WGSL binds native hill transparency and moving strip inputs with owned texture wrappers', async () => {
  const { backdrop, model, scene, textures } = await mountFixture();
  const camera = new PerspectiveCamera(40, 16 / 9, 0.03, 3000);
  const hill = backdrop.group.getObjectByName('backdrop_NF');
  const strip = backdrop.group.getObjectByName('backdrop_strip_s2');
  const ribbon = backdrop.group.getObjectByName('backdrop_ribbons_authored_W196');
  const glslHill = sourceSpan('uniform sampler2D tMap;', 'function ne(');
  const glslStrip = sourceSpan('uniform sampler2D tStrip;', '`,D=`');
  const glslRibbon = sourceSpan('uniform sampler2D tRibbons;', 'function k(');
  const borrowed = model.getObjectByName('NF').geometry;
  const owned = strip.geometry;
  const released = { borrowed: 0, owned: 0, texture: 0, wrapper: 0 };
  borrowed.addEventListener('dispose', () => released.borrowed++);
  owned.addEventListener('dispose', () => released.owned++);
  for (const source of textures.values()) source.addEventListener('dispose', () => released.texture++);
  for (const [mesh, glsl, count, flip] of [[hill, glslHill, 2, false], [strip, glslStrip, 3, true], [ribbon, glslRibbon, 2, true]]) {
    const compiler = compileNode(mesh, scene, camera);
    const shader = compiler.fragmentShader;
    const cutoff = /if \(a < ([\d.]+)\) discard;/.exec(glsl)[1];
    assert.match(shader, new RegExp(`< ${cutoff.replace('.', '\\.')}`));
    assert.match(shader, /discard;/);
    assert.equal((shader.match(/textureSample\(/g) ?? []).length, count);
    assert.equal(mesh.material.blending, CustomBlending);
    assert.equal(mesh.material.depthWrite, false);
    const name = mesh === hill ? 'backdrop/hills/NF.webp' : mesh === strip ? 'backdrop/strips/s2.jpg' : 'backdrop/ribbons.jpg';
    const source = textures.get(name);
    const wrapper = compiler.uniforms.fragment.map(uniform => uniform.node?.value)
      .find(value => value?.isTexture && value.source === source.source);
    assert.ok(wrapper && wrapper !== source);
    assert.equal(wrapper.flipY, flip);
    assert.equal(wrapper.generateMipmaps, mesh !== strip);
    wrapper.addEventListener('dispose', () => released.wrapper++);
    if (mesh === strip) {
      assert.match(shader, /backdropSeconds/);
      for (const coefficient of ['0.0013', '0.0009', '0.002']) {
        assert.ok(shader.includes(coefficient) && glsl.includes(coefficient));
      }
    }
  }
  backdrop.dispose();
  backdrop.dispose();
  assert.deepEqual(released, { borrowed: 0, owned: 1, texture: 0, wrapper: 3 });
});
