import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Group, Mesh, MeshBasicNodeMaterial, NodeMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  Scene, Vector3, WebGPURenderer, WGSLNodeBuilder } from 'three/webgpu';
import { pass, texture3D, vec4 } from 'three/tsl';
import { createInkNoiseTexture } from '../src/rendering/ink-paper-wash.mts';
import { blendSummitAtmosphere, createSummitCloudTexture, mountSummitAtmosphere } from '../src/rendering/summit-atmosphere.mts';

const source = await readFile(new URL('../sumiro/bundle/ch6_summit-BczK7QHX.js', import.meta.url), 'utf8');
function span(start, next) {
  const from = source.indexOf(start);
  const to = source.indexOf(next, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

function extractCloudDraws() {
  const draws = [];
  let fill = '';
  let transform;
  const context = {
    set fillStyle(value) { fill = value; },
    save() { transform = { x: 0, y: 0, sx: 1, sy: 1 }; },
    translate(x, y) { Object.assign(transform, { x, y }); },
    scale(sx, sy) { Object.assign(transform, { sx, sy }); },
    restore() { transform = undefined; },
    createRadialGradient(x, y, inner, outerX, outerY, radius) {
      assert.deepEqual([x, y, inner, outerX, outerY], [0, 0, 0, 0, 0]);
      return { radius, stops: [], addColorStop(_, color) { this.stops.push(color.match(/[.\d]+/g).map(Number)); } };
    },
    fillRect() { draws.push({ transform, fill }); },
  };
  const canvas = { getContext(kind) { assert.equal(kind, '2d'); return context; } };
  const original = new Function('document', 's', 'i', span('function Oe(', 'function ke(') + 'return Oe();');
  original({ createElement: () => canvas }, function () {}, 'repeat');
  return { canvas, draws };
}

test('native cloud tile follows the original ordered, periodic elliptical gradient strokes', () => {
  const { canvas, draws } = extractCloudDraws();
  const map = createSummitCloudTexture();
  try {
    assert.deepEqual([map.image.width, map.image.height], [canvas.width, canvas.height]);
    assert.equal(draws.length, 1 + 160 * 9);
    assert.equal(draws[0].fill, 'rgb(140,140,140)');
    assert.equal(map.wrapS, map.wrapT);
    assert.equal(map.anisotropy, 8);
    assert.equal(map.colorSpace, '');
    const positions = [0, 1, 9, 37, 241, 511, 648, 940, 1019, 1023];
    let lowest = 255, highest = 0;
    for (const x of positions) for (const y of positions) {
      let intensity = 140;
      for (const { transform: { x: dx, y: dy, sx, sy }, fill: { radius, stops } } of draws.slice(1)) {
        const distance = Math.hypot((x + .5 - dx) / sx, (y + .5 - dy) / sy);
        if (distance > radius) continue;
        const [[gray, , , peakAlpha]] = stops;
        const opacity = peakAlpha * (1 - distance / radius);
        intensity = Math.round(gray * opacity + intensity * (1 - opacity));
      }
      const actual = map.image.data[(canvas.height - 1 - y) * canvas.width + x];
      assert.equal(actual, intensity, `raster position (${x}, ${y})`);
      lowest = Math.min(lowest, actual);
      highest = Math.max(highest, actual);
    }
    assert.ok(lowest < 140 && highest > 140, 'sampled shadows and highlights must straddle the original base');
  } finally { map.dispose(); }
});

function compile(mesh, scene, camera, layer) {
  const renderer = new WebGPURenderer({ canvas: { width: 32, height: 32 } });
  renderer.hasFeature = () => false;
  renderer._bindings = { getSharedBindGroup: group => group };
  if (layer) {
    renderer.setRenderTarget(layer.renderTarget);
    renderer.setMRT(layer.getMRT());
  }
  const compiler = new WGSLNodeBuilder(mesh, renderer);
  compiler.camera = camera;
  compiler.scene = scene;
  compiler.build();
  return compiler;
}

test('Summit cloud and all thirty mist cards preserve shipped placement, drift, and render order', () => {
  const document = { group: new Group() };
  const cloudMaterial = new MeshBasicNodeMaterial();
  const mistMaterial = new MeshBasicNodeMaterial();
  let bankOptions;
  const createCloud = new Function('c', 'o', 'a', 'n', 'Oe', span('function ke(', 'function Ae(') + 'return ke;');
  createCloud(PlaneGeometry, function (spec) {
    cloudMaterial.uniforms = spec.uniforms;
    return cloudMaterial;
  }, Vector3, Mesh, () => ({}))(document);
  const createBanks = new Function('te', 'c', 'n', span('var Me=', 'var Pe=') + 'return Ne;');
  createBanks(options => {
    bankOptions = options;
    mistMaterial.uniforms = { uTime: {} };
    return mistMaterial;
  }, PlaneGeometry, Mesh)(document);
  assert.deepEqual(bankOptions, { bank: true, freq: 1.4, alphaMax: .62, rise: .015 });
  const originalUpdate = new Function(span('function Le(', 'function Re(') + 'return Le;')();
  const camera = new PerspectiveCamera(52, 4 / 3, .1, 1800);
  const opaque = pass(new Scene(), camera);
  const layer = mountSummitAtmosphere(camera, opaque.getTextureNode('depth'));
  const gpuPass = layer.texture.passNode;
  try {
    assert.equal(layer.group.children.length, 31);
    for (const [index, expected] of document.group.children.entries()) {
      const actual = layer.group.children[index];
      assert.equal(actual.name, expected.name);
      assert.equal(actual.renderOrder, expected.renderOrder);
      assert.deepEqual(actual.scale.toArray(), expected.scale.toArray());
      assert.deepEqual(actual.rotation.toArray(), expected.rotation.toArray());
      assert.deepEqual(actual.geometry.parameters, expected.geometry.parameters);
      assert.deepEqual([...actual.geometry.attributes.position.array], [...expected.geometry.attributes.position.array]);
    }
    const [cloud, bank] = layer.group.children;
    const cloudWGSL = compile(cloud, gpuPass.scene, camera, gpuPass);
    const bankWGSL = compile(bank, gpuPass.scene, camera, gpuPass);
    for (const [xyz, time] of [[[30, 94, -600], 0], [[-295, 90, -345], 8.25], [[-303, 124, -390], 45]]) {
      camera.position.set(...xyz);
      originalUpdate({ camera, time: { t: time } }, document);
      layer.update(time);
      assert.deepEqual(cloud.position.toArray(), document.sea.position.toArray());
      assert.deepEqual(layer.group.children.map(child => child.position.toArray()), document.group.children.map(child => child.position.toArray()));
      assert.equal(cloudWGSL.uniforms.fragment.find(node => node.name === 'summitCloudDrift').node.value, document.sea.material.uniforms.uDrift.value);
      assert.equal(bankWGSL.uniforms.fragment.find(node => node.name === 'summitMistSeconds').node.value, document.mistMat.uniforms.uTime.value);
    }
    const clear = gpuPass.getMRT().getClearColor('output');
    assert.deepEqual([clear.r, clear.g, clear.b, clear.a], [0, 0, 0, 0]);
    assert.equal(gpuPass.renderTarget.depthTexture, null);
    layer.setEnabled(false);
    assert.equal(layer.group.visible, false);
    layer.setEnabled(true);
    assert.equal(layer.group.visible, true);
  } finally {
    layer.dispose();
    layer.dispose();
    assert.equal(layer.group.children.length, 0);
    assert.equal(layer.group.parent, null);
    opaque.dispose();
    for (const geometry of new Set(document.group.children.map(mesh => mesh.geometry))) geometry.dispose();
    cloudMaterial.dispose();
    mistMaterial.dispose();
  }
});

test('r187 shaders sample only completed opaque depth and keep the atmosphere isolated before grading', () => {
  const originalCloud = span('function ke(', 'function Ae(');
  for (const camera of [new PerspectiveCamera(), new OrthographicCamera()]) {
    const opaque = pass(new Scene(), camera);
    const depth = opaque.getTextureNode('depth');
    const noise = createInkNoiseTexture();
    const atmosphere = mountSummitAtmosphere(camera, depth, texture3D(noise));
    const gpuPass = atmosphere.texture.passNode;
    const [cloud, mist] = atmosphere.group.children;
    const quad = new Mesh(new PlaneGeometry(), new NodeMaterial());
    try {
      for (const mesh of [cloud, mist]) {
        const compiler = compile(mesh, gpuPass.scene, camera, gpuPass);
        const inputs = compiler.uniforms.fragment.map(uniform => uniform.node?.value);
        assert.ok(inputs.includes(depth.value));
        assert.ok(!inputs.includes(atmosphere.texture.value));
        assert.equal(mesh.material.depthWrite, false);
        assert.equal((compiler.fragmentShader.match(/textureLoad\(/g) ?? []).length, 1);
        assert.match(compiler.fragmentShader, /discard;/);
        if (mesh === cloud) {
          assert.equal((compiler.fragmentShader.match(/textureSample\(/g) ?? []).length, 2);
          for (const coefficient of ['420.0', '0.37', '0.31', '0.012', '0.11', '620.0', '1500.0']) {
            assert.ok(compiler.fragmentShader.includes(coefficient) && originalCloud.includes(coefficient));
          }
        } else {
          assert.ok(inputs.includes(noise));
          for (const coefficient of ['1.4', '0.62', '0.015', '1.2', '10.0', '40.0']) assert.ok(compiler.fragmentShader.includes(coefficient));
        }
      }
      quad.material.fragmentNode = blendSummitAtmosphere(vec4(.2, .3, .4, .77), atmosphere.texture);
      const composer = compile(quad, new Scene(), camera);
      assert.ok(composer.uniforms.fragment.some(uniform => uniform.node?.value === atmosphere.texture.value));
      assert.equal((composer.fragmentShader.match(/textureSample\(/g) ?? []).length, 1);
      assert.match(composer.fragmentShader, /1\.0 - .*\.w/);
      assert.match(composer.fragmentShader, /0\.77/);
    } finally {
      atmosphere.dispose();
      noise.dispose();
      opaque.dispose();
      quad.geometry.dispose();
      quad.material.dispose();
    }
  }
});
