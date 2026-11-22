import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { create, globals } from 'webgpu';
import { Group, Mesh, MeshBasicNodeMaterial, OrthographicCamera, PlaneGeometry, Scene } from 'three/webgpu';
import { mix, texture3D, uniform, vec3, vec4 } from 'three/tsl';
import { createChapterPreview } from '../../src/application/chapter-preview.mts';
import { createTraversalPreview } from '../../src/application/traversal-preview.mts';
import { createRunProgress } from '../../src/domain/run-progress.mts';
import { createDefaultRun } from '../../src/domain/save.mts';
import { createInkDepthKey } from '../../src/rendering/ink-depth-key.mts';
import { createInkRenderGraph } from '../../src/rendering/ink-render-graph.mts';
import { createInkNoiseTexture } from '../../src/rendering/ink-paper-wash.mts';
import { createInkSurfaceOutput } from '../../src/rendering/ink-surface-pass.mts';
import { blendSeaReflection, createSeaReflectionPass } from '../../src/rendering/sea-reflection.mts';
import { createSourceRuntime } from '../../src/runtime/source-runtime.mts';
import { installDracoWorker } from './draco-worker.mjs';
import { installFixtureTextures } from './windows-textures.mjs';
import { verifySeaExitRoute } from './sea-exit-route.mjs';
import { verifySummitDuelRoute } from './summit-duel-route.mjs';

const gpu = create(process.argv.slice(2));
let pendingFrame;
Object.assign(globalThis, globals, {
  self: globalThis,
  requestAnimationFrame(callback) {
    pendingFrame = callback;
    return 1;
  },
  cancelAnimationFrame() {
    pendingFrame = undefined;
  },
});
Object.defineProperty(navigator, 'gpu', { value: gpu, configurable: true });
const restoreDraco = installDracoWorker();
const fixtureTextures = installFixtureTextures();

// Dawn supplies a real device and queue. This harness substitutes an offscreen
// texture for the browser canvas's presentation texture.
let configuration;
let device;
let attachment;
let unconfigured = 0;
const canvas = {
  width: 32,
  height: 32,
  getContext(kind) {
    assert.equal(kind, 'webgpu');
    return context;
  },
};
const context = {
  configure(options) {
    configuration = options;
  },
  getCurrentTexture() {
    if (attachment?.width === canvas.width && attachment.height === canvas.height) return attachment;
    attachment?.destroy();
    attachment = configuration.device.createTexture({
      size: [canvas.width, canvas.height],
      format: configuration.format,
      usage: configuration.usage,
    });
    return attachment;
  },
  unconfigure() {
    unconfigured++;
    attachment?.destroy();
    attachment = undefined;
  },
};
const nativeGpu = {
  async requestAdapter(options) {
    const adapter = await gpu.requestAdapter(options);
    assert.ok(adapter, 'Dawn must expose a WebGPU adapter');
    const { vendor, architecture, device: name, description, isFallbackAdapter } = adapter.info;
    assert.equal(isFallbackAdapter, false, 'the native test requires a hardware adapter');
    assert.doesNotMatch([vendor, architecture, name, description].join(' '), /swiftshader|llvmpipe|lavapipe|\bwarp\b|software/i);
    console.log('WebGPU adapter', JSON.stringify({ vendor, architecture, device: name, description, isFallbackAdapter }));
    return {
      async requestDevice(descriptor) {
        device = await adapter.requestDevice(descriptor);
        return device;
      },
    };
  },
};

const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 2;
const scene = new Scene();
const geometry = new PlaneGeometry(2, 2);
const material = new MeshBasicNodeMaterial();
const strength = uniform(1);
const inspectNormalWeight = uniform(0);
const inspectDepth = uniform(0);
const inspectKey = uniform(0);
const inspectEdge = uniform(0);
const inspectComposite = uniform(0);
const applyInk = uniform(0);
material.mrtNode = createInkSurfaceOutput({ lineWeight: 0.25 });
const background = new Mesh(geometry, material);
const foregroundGeometry = new PlaneGeometry(0.12, 0.24);
const foregroundMaterial = new MeshBasicNodeMaterial();
foregroundMaterial.mrtNode = createInkSurfaceOutput({ lineWeight: 1, movingSurfaceId: 3 });
const foreground = new Mesh(foregroundGeometry, foregroundMaterial);
foreground.position.set(0.2, 0, 1);
const keyboardTarget = new EventTarget();

function keyboardDriver(runtime) {
  const held = new Set();
  const dispatch = (type, code) => keyboardTarget.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
  function hold(desired) {
    for (const code of held) if (!desired.has(code)) { dispatch('keyup', code); held.delete(code); }
    for (const code of desired) if (!held.has(code)) { dispatch('keydown', code); held.add(code); }
  }
  return {
    hold,
    release() { hold(new Set()); },
    tap(code, steps = 1) {
      dispatch('keydown', code);
      for (let step = 0; step < steps; step++) runtime.step();
      dispatch('keyup', code);
    },
    steer(target, position, stopRadius, yawDegrees = runtime.context.registry.get('camera.steeringYaw') ?? 0) {
      const dx = target.x - position.x, dz = target.z - position.z;
      const distance = Math.hypot(dx, dz);
      const desired = new Set();
      if (distance > stopRadius) {
        const yaw = yawDegrees * Math.PI / 180;
        const strafe = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
        const forward = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
        if (Math.abs(strafe) > Math.abs(forward) * 0.4) desired.add(strafe > 0 ? 'KeyD' : 'KeyA');
        if (Math.abs(forward) > Math.abs(strafe) * 0.4) desired.add(forward > 0 ? 'KeyW' : 'KeyS');
      }
      hold(desired);
      return distance;
    },
  };
}

function pressSpace() {
  const event = Object.assign(new Event('keydown', { cancelable: true }), {
    code: 'Space', repeat: false, ctrlKey: false, altKey: false,
  });
  keyboardTarget.dispatchEvent(event);
  return event.defaultPrevented;
}

async function sample(x, y) {
  const { format } = configuration;
  assert.match(format, /^(rgba|bgra)8unorm(?:-srgb)?$/, 'readback requires a four-byte normalized format');
  const bytesPerRow = 256;
  const readback = device.createBuffer({ size: bytesPerRow, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: attachment, origin: { x, y } },
      { buffer: readback, bytesPerRow },
      { width: 1, height: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const pixel = [...new Uint8Array(readback.getMappedRange()).subarray(0, 4)];
    if (format.startsWith('bgra')) [pixel[0], pixel[2]] = [pixel[2], pixel[0]];
    return pixel;
  } finally {
    readback.destroy();
  }
}

let runtime;
let depthKey;
let inkGraph;
let graphReleases = 0;
let contextRequests = 0;
let systemCleanups = 0;
let renderCallbacks = 0;
let updateCallbacks = 0;
try {
  runtime = await createSourceRuntime({
    graphics: {
      canvas, scene, camera,
      buildOutput(scenePass) {
        inkGraph = createInkRenderGraph(scenePass, camera, { referenceHeight: 60, fogStrength: 0 });
        const { color, depth, normalWeight, surfaceData } = inkGraph.attachments;
        depthKey = createInkDepthKey({ depth, surfaceData }, camera, { radiusPixels: 8, referenceHeight: 60 });
        depthKey.resize(32, 32);
        const normalPreview = vec4(normalWeight.r, normalWeight.b, normalWeight.a, 1);
        const depthPreview = vec4(vec3(depth.r), 1);
        const keyPreview = vec4(depthKey.texture.r.div(4), depthKey.texture.g.div(4), 0, 1);
        const edgePreview = vec4(vec3(inkGraph.edge.r), 1);
        const inspection = mix(mix(mix(inkGraph.outputNode, normalPreview, inspectNormalWeight), depthPreview,
          inspectDepth), keyPreview, inspectKey);
        return { ...inkGraph, outputNode: mix(mix(inspection, edgePreview, inspectEdge),
          mix(color, inkGraph.composite, applyInk), inspectComposite) };
      },
    },
    systems: {
      './fixture.mts': async () => ({
        whilePaused: true,
        async init(context, lifetime) {
          const rgb = await context.assets.loadJSON('data:application/json,%5B0.25%2C0.5%2C1.5%5D');
          material.colorNode = vec3(...rgb).mul(strength);
          lifetime.ownRoot(background);
          lifetime.defer(async () => {
            assert.equal(await context.assets.loadJSON('data:application/json,true'), true);
            assert.equal(unconfigured, 0, 'the GPU surface must survive asynchronous system cleanup');
            systemCleanups++;
          });
        },
        update(delta, context) {
          updateCallbacks++;
          context.registry.set('fixture.step', [context.time.step, delta, context.input.jump]);
        },
        beforeRender() { renderCallbacks++; },
      }),
    },
    viewport: { width: 32, height: 32, pixelRatio: 1 },
    assets: { assetBaseURL: 'https://reference.invalid/' },
    audio: { createContext() { contextRequests++; throw Error('Audio must wait for unlock'); } },
    input: { keyboardTarget },
    gpu: nativeGpu,
  });
  assert.equal(runtime.backend, 'webgpu');
  assert.equal(runtime.context.assets.pending, 0);
  const { audio, registry } = runtime.context;
  registry.set('game.options', { master: 1, music: 0.5, effects: 1 });
  const musicGain = audio.getEffectiveGain('music');
  const effectsGain = audio.getEffectiveGain('effects');
  assert.ok(Math.abs(musicGain - 0.09 * 10 ** (-5 / 20)) < 1e-12);
  registry.set('audio.duck', true);
  assert.equal(audio.getEffectiveGain('music'), musicGain);
  assert.ok(Math.abs(audio.getEffectiveGain('effects') - 0.1 * effectsGain) < 1e-12);
  assert.equal(contextRequests, 0);
  assert.equal(runtime.report()[0].failed, null);
  assert.ok(scene.children.includes(background));
  assert.deepEqual(runtime.context.registry.get('fixture.step'), [0, 0, false]);
  assert.equal(pressSpace(), true);
  runtime.step();
  assert.deepEqual(runtime.context.registry.get('fixture.step'), [1, 1 / 60, true]);
  assert.equal(runtime.context.input.jump, false);
  assert.equal(runtime.context.clock.elapsedTime, 1 / 60);
  runtime.context.paused = true;
  runtime.step();
  assert.equal(runtime.context.time.step, 1);
  assert.equal(updateCallbacks, 3);
  assert.deepEqual(runtime.context.registry.get('fixture.step'), [1, 1 / 60, false]);
  runtime.context.paused = false;
  device.pushErrorScope('validation');
  runtime.render();
  const first = { center: await sample(16, 16), corner: await sample(1, 1) };
  runtime.resize(64, 48, 1.25);
  runtime.setResolutionScale(0.75);
  depthKey.resize(60, 45);
  strength.value = 0.25;
  assert.equal(typeof pendingFrame, 'function', 'Three.js must schedule a new render frame');
  pendingFrame(performance.now());
  runtime.render();
  const resized = { center: await sample(40, 30), corner: await sample(1, 1) };
  inspectNormalWeight.value = 1;
  pendingFrame(performance.now());
  runtime.render();
  const normalWeight = await sample(40, 30);
  inspectDepth.value = 1;
  pendingFrame(performance.now());
  runtime.render();
  const depth = await sample(40, 30);
  scene.add(foreground);
  inspectKey.value = 1;
  pendingFrame(performance.now());
  runtime.render();
  const key = await sample(40, 30);
  inspectEdge.value = 1;
  pendingFrame(performance.now());
  runtime.render();
  const flatEdge = await sample(10, 30);
  let contourPeak = 0;
  let contourX = 43;
  for (let x = 43; x <= 53; x++) {
    const [level] = await sample(x, 30);
    if (level > contourPeak) {
      contourPeak = level;
      contourX = x;
    }
  }
  inspectComposite.value = 1;
  pendingFrame(performance.now());
  runtime.render();
  const baseColor = { flat: await sample(10, 30), contour: await sample(contourX, 30) };
  applyInk.value = 1;
  pendingFrame(performance.now());
  runtime.render();
  const inkColor = { flat: await sample(10, 30), contour: await sample(contourX, 30) };
  const error = await device.popErrorScope();
  assert.equal(error, null, error?.message);
  assert.deepEqual([canvas.width, canvas.height], [80, 60]);
  assert.deepEqual([runtime.context.view.drawWidth, runtime.context.view.drawHeight], [80, 60]);
  for (const texture of [inkGraph.edge, inkGraph.composite]) {
    assert.deepEqual([texture.renderTarget.width, texture.renderTarget.height], [60, 45]);
  }
  assert.equal(renderCallbacks, 8);

  // Independent CPU evaluation of the shoulder and corner curves, then sRGB.
  // A two-code-value band accommodates the bounded per-pixel dither and f16 sampling.
  const expected = [
    { center: [137, 188, 237, 255], corner: [115, 152, 186, 255] },
    { center: [71, 99, 165, 255], corner: [56, 76, 121, 255] },
  ];
  const tolerance = 2;
  for (const [index, frame] of [first, resized].entries()) {
    for (const [position, pixel] of Object.entries(frame)) {
      const target = expected[index][position];
      assert.ok(pixel.every((value, channel) => Math.abs(value - target[channel]) <= tolerance),
        `frame ${index + 1} ${position}: expected ${target} ± ${tolerance}, got ${pixel}`);
    }
  }
  const expectedNormalWeight = [188, 255, 137, 255];
  const expectedDepth = [121, 121, 121, 255];
  const expectedKey = [137, 225, 0, 255];
  assert.ok(normalWeight.every((value, channel) => Math.abs(value - expectedNormalWeight[channel]) <= tolerance),
    'encoded world normal and line weight ' + normalWeight);
  assert.ok(depth.every((value, channel) => Math.abs(value - expectedDepth[channel]) <= tolerance),
    'orthographic depth ' + depth);
  assert.ok(key.every((value, channel) => Math.abs(value - expectedKey[channel]) <= tolerance),
    'neighboring foreground depth and surface ID ' + key);
  assert.deepEqual(flatEdge, [0, 0, 0, 255], 'a flat, constant-depth surface should have zero contour');
  assert.ok(contourPeak >= 64, 'the near-to-far discontinuity should produce a visible contour');
  assert.deepEqual(inkColor.flat, baseColor.flat, 'a flat surface must retain its scene color');
  assert.ok(inkColor.contour.every((level, channel) => channel === 3
    ? level === baseColor.contour[channel]
    : level < baseColor.contour[channel] - 2), 'a contour must visibly darken the scene color');
  console.log('Native WebGPU readback', JSON.stringify({
    first, resized, expected, normalWeight, depth, key, flatEdge, contourPeak, baseColor, inkColor, tolerance,
  }));
} finally {
  depthKey?.dispose();
  geometry.dispose();
  material.dispose();
  foregroundGeometry.dispose();
  foregroundMaterial.dispose();
  if (runtime) {
    for (const texture of [inkGraph.edge, inkGraph.composite]) {
      texture.renderTarget.addEventListener('dispose', () => graphReleases++);
    }
    const disposing = runtime.dispose();
    assert.equal(runtime.dispose(), disposing);
    await disposing;
    assert.equal(systemCleanups, 1);
    assert.equal(graphReleases, 2);
    assert.equal(scene.children.includes(background), false);
    assert.equal(pressSpace(), false);
    await assert.rejects(runtime.context.assets.loadJSON('data:application/json,null'), { name: 'AbortError' });
    assert.ok(unconfigured > 0);
    assert.throws(() => runtime.render(), /disposed/);
  }
}

const assetURL = new URL('../../sumiro/assets/', import.meta.url);

async function verifySeaReflection() {
  const camera = new OrthographicCamera(-1, 1, 1, -1, .1, 10);
  camera.position.z = 3;
  const scene = new Scene();
  const geometry = new PlaneGeometry(.32, .26);
  const material = new MeshBasicNodeMaterial();
  const occluder = new Mesh(geometry, material);
  occluder.position.set(.38, -.42, 1.5);
  occluder.visible = false;
  scene.add(occluder);
  const source = new Group();
  const silhouette = new Mesh(geometry, material);
  silhouette.name = 'reflection_probe';
  silhouette.position.set(.38, .42, 1);
  source.add(silhouette);
  const noise = createInkNoiseTexture();
  let reflection;
  let stop;
  try {
    stop = await createSourceRuntime({
      graphics: { canvas, scene, camera, buildOutput(pass) {
        const depth = pass.getTextureNode('depth');
        reflection = createSeaReflectionPass(camera, { depth, noise: texture3D(noise) });
        reflection.bind(source, [silhouette.name]);
        reflection.update(0, 0);
        return { outputNode: blendSeaReflection(vec4(.015, .015, .015, 1), reflection.texture), ...reflection };
      } },
      assets: { assetBaseURL: assetURL }, systems: {}, gpu: nativeGpu,
      viewport: { width: 96, height: 72, pixelRatio: 1 },
    });
    device.pushErrorScope('validation');
    stop.render();
    const above = await sample(66, 21);
    const mirrored = await sample(66, 51);
    assert.ok(mirrored[0] > above[0] + 15, `a mirrored fragment must lighten the water: ${mirrored} vs ${above}`);
    occluder.visible = true;
    pendingFrame(performance.now());
    stop.render();
    const blocked = await sample(66, 51);
    assert.deepEqual(blocked, above, 'opaque land in front must reject the reflected fragment');
    const error = await device.popErrorScope();
    assert.equal(error, null, error?.message);
    console.log('Sea reflection WebGPU visibility', JSON.stringify({ above, mirrored, blocked }));
  } finally {
    try { await stop?.dispose(); } finally { geometry.dispose(); material.dispose(); noise.dispose(); }
  }
}
await verifySeaReflection();

const chapterAssets = {
  assetBaseURL: assetURL,
  async fetch(path) {
    return new Response(await readFile(new URL(path)));
  },
};
const createRouteRuntime = options => createTraversalPreview({
  canvas, viewport: { width: 96, height: 72, pixelRatio: 1 }, assets: chapterAssets, gpu: nativeGpu, ...options,
});
const chapter = await createChapterPreview({
  canvas,
  viewport: { width: 96, height: 72, pixelRatio: 1 },
  assets: chapterAssets,
  gpu: nativeGpu,
});
try {
  let meshes = 0;
  chapter.context.scene.traverse(object => { if (object.isMesh) meshes++; });
  assert.ok(meshes > 0, 'the actual chapter asset must populate the scene');
  device.pushErrorScope('validation');
  chapter.render();
  const scan = [];
  for (const x of [24, 36, 48, 60, 72]) {
    for (const y of [18, 27, 36, 45, 54]) scan.push(await sample(x, y));
  }
  const backgroundPixel = await sample(1, 1);
  const error = await device.popErrorScope();
  assert.equal(error, null, error?.message);
  assert.ok(scan.some(pixel => pixel[3] === 255 && Math.max(...pixel.slice(0, 3)) - Math.min(...pixel.slice(0, 3)) > 20),
    'the chapter scan should include opaque, strongly colored model pixels');
  console.log('Chapter geometry WebGPU readback', JSON.stringify({ meshes, backgroundPixel, center: scan[12] }));
} finally {
  await chapter.dispose();
}

const routePad = { axes: [0, 0], buttons: [{ pressed: false }] };
const freshRun = createRunProgress({ getItem: () => null });
const traversal = await createTraversalPreview({
  canvas,
  viewport: { width: 96, height: 72, pixelRatio: 1 },
  assets: chapterAssets,
  progress: freshRun,
  input: { keyboardTarget, getGamepads: () => [routePad] },
  gpu: nativeGpu,
});
try {
  const registry = traversal.context.registry;
  const spawn = registry.get('player.position');
  const avatar = traversal.context.scene.getObjectByName('player');
  assert.ok(avatar, 'the supplied player rig must join the scene');
  const environment = traversal.context.scene.getObjectByName('ch1_climb');
  assert.ok(environment?.getObjectByName('plateau_top')?.isMesh, 'the playable chapter uses the authored plateau');
  assert.ok(environment?.getObjectByName('bridge_planks')?.isMesh, 'the playable chapter uses the authored bridge');
  let skin;
  avatar.traverse(object => { if (object.isSkinnedMesh) skin = object; });
  assert.ok(skin?.skeleton.bones.length > 0, 'the supplied model must include a live skin');
  if (fixtureTextures.realImages) assert.ok(skin.material.map?.image.width > 1, 'the Windows fixture must decode the supplied player texture');
  const initialBones = skin.skeleton.bones.map(bone => bone.quaternion.clone());
  const initialRailFrame = registry.get('camera.railFrame');
  const initialCamera = traversal.context.camera.position.clone();
  assert.equal(spawn.state, 'IDLE');
  assert.equal(spawn.grounded, true);
  device.pushErrorScope('validation');
  traversal.render();
  const startingPixel = await sample(48, 58);
  const skyPixel = await sample(48, 8);
  const probePixels = [38, 44, 48, 52, 58].flatMap(x => [30, 39, 48, 56].map(y => [x, y]));
  const withAvatar = await Promise.all(probePixels.map(([x, y]) => sample(x, y)));
  avatar.visible = false;
  pendingFrame(performance.now());
  traversal.render();
  const terrainOnly = await Promise.all(probePixels.map(([x, y]) => sample(x, y)));
  const visibleAvatar = withAvatar.some((pixel, index) => pixel.slice(0, 3)
    .some((channel, component) => Math.abs(channel - terrainOnly[index][component]) > 10));
  assert.equal(visibleAvatar, true, 'the actual skinned geometry must contribute pixels to the frame');
  environment.visible = false;
  pendingFrame(performance.now());
  traversal.render();
  const backgroundOnly = await Promise.all(probePixels.map(([x, y]) => sample(x, y)));
  assert.ok(terrainOnly.some((pixel, index) => pixel.slice(0, 3)
    .some((channel, component) => Math.abs(channel - backgroundOnly[index][component]) > 8)),
  'authored environment models must contribute pixels even where pale rock and paper have similar colors');
  environment.visible = true;
  avatar.visible = true;
  keyboardTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
  for (let frame = 0; frame < 60; frame++) traversal.step();
  keyboardTarget.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyW' }));
  const movement = registry.get('player.position');
  assert.ok(movement.z < spawn.z - 3);
  assert.equal(movement.state, 'RUN');
  assert.equal(movement.grounded, true);
  assert.deepEqual(avatar.position.toArray(), [movement.x, movement.y, movement.z]);
  assert.ok(skin.skeleton.bones.some((bone, index) => bone.quaternion.angleTo(initialBones[index]) > 0.02),
    'the animation mixer must change the supplied skeletal pose during locomotion');
  const walkingRailFrame = registry.get('camera.railFrame');
  assert.ok(walkingRailFrame > initialRailFrame);
  assert.ok(traversal.context.camera.position.distanceTo(initialCamera) > 1);
  for (let frame = 0; frame < 25; frame++) traversal.step();
  const takeoff = registry.get('player.position');
  assert.equal(pressSpace(), true);
  let peak = takeoff.y;
  let landed = false;
  for (let frame = 0; frame < 100; frame++) {
    if (frame === 12) keyboardTarget.dispatchEvent(Object.assign(new Event('keyup'), { code: 'Space' }));
    traversal.step();
    const current = registry.get('player.position');
    if (frame === 0) assert.equal(current.state, 'JUMP');
    peak = Math.max(peak, current.y);
    landed ||= current.state === 'LAND' && current.grounded;
  }
  assert.ok(peak > takeoff.y + 0.6, 'the jump must lift the player above the authored terrain');
  assert.equal(landed, true, 'airborne motion must return to the terrain');
  keyboardTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyP', repeat: false }));
  traversal.step();
  const pauseStep = traversal.context.time.step;
  const pausePosition = registry.get('player.position');
  assert.equal(registry.get('game.paused'), true);
  assert.equal(registry.get('audio.duck'), true);
  for (let tick = 0; tick < 10; tick++) traversal.step();
  assert.equal(traversal.context.time.step, pauseStep);
  assert.strictEqual(registry.get('player.position'), pausePosition);
  traversal.setPaused(false);
  assert.equal(registry.get('game.paused'), false);
  assert.equal(registry.get('audio.duck'), false);
  traversal.step();
  assert.equal(traversal.context.time.step, pauseStep + 1);
  pendingFrame(performance.now());
  traversal.render();
  const error = await device.popErrorScope();
  assert.equal(error, null, error?.message);
  console.log('Chapter traversal WebGPU readback', JSON.stringify({
    spawn, movement, initialRailFrame, walkingRailFrame, jumpHeight: peak - takeoff.y, landed, startingPixel, skyPixel,
  }));
  const feet = () => registry.get('player.position');
  function drive(x, z, gain, jump = false) {
    const current = feet();
    const dx = x - current.x, dz = z - current.z;
    const length = Math.hypot(dx, dz);
    const yaw = registry.get('camera.steeringYaw') * Math.PI / 180;
    const ratio = length > 0 ? gain / length : 0;
    routePad.axes[0] = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) * ratio;
    routePad.axes[1] = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) * ratio;
    routePad.buttons[0].pressed = jump;
    traversal.step();
  }
  function walkTo(x, z, radius = .25, stop = () => false) {
    for (let step = 0; step < 800 && !stop(); step++) {
      const remaining = Math.hypot(x - feet().x, z - feet().z);
      if (remaining <= radius) break;
      drive(x, z, remaining > 1.1 ? 1 : remaining > .5 ? .68 : .3);
    }
    assert.ok(stop() || Math.hypot(x - feet().x, z - feet().z) < radius + .17,
      `route stalled before ${x}, ${z}: ${JSON.stringify(feet())}`);
  }
  for (const [x, z] of [[-1, -9], [-.9, -17], [-1.2, -25], [-1.4, -33], [-1, -38], [-.4, -41], [.1, -43]]) {
    walkTo(x, z);
  }
  routePad.axes.fill(0);
  for (let step = 0; step < 20; step++) traversal.step();
  const launch = { x: feet().x + 4, z: feet().z - 2.31 };
  for (let step = 0; step < 45 && (feet().x < 1.72 || feet().state !== 'RUN'); step++) drive(launch.x, launch.z, 1);
  drive(launch.x, launch.z, 1, true);
  assert.equal(feet().state, 'LEAP', JSON.stringify(feet()));
  routePad.buttons[0].pressed = false;
  routePad.axes[0] = 0;
  routePad.axes[1] = -1;
  const states = new Set();
  for (let step = 0; step < 230; step++) {
    states.add(feet().state);
    if (states.has('CLIMB') && feet().grounded) break;
    traversal.step();
  }
  routePad.axes.fill(0);
  assert.deepEqual([...states], ['LEAP', 'GRAB', 'HANG', 'CLIMB', 'IDLE']);
  assert.ok(feet().grounded && feet().y > 8);
  const plateau = feet();
  const scene = () => registry.get('story.scene');
  for (let step = 0; step < 180 && !scene(); step++) traversal.step();
  assert.equal(scene(), 'opening_cat');
  const keys = keyboardDriver(traversal);
  keys.tap('Enter');
  assert.equal(freshRun.current.flags.cat_found, true);
  walkTo(5.87, -59.16, 1.05);
  routePad.axes.fill(0);
  keys.tap('KeyE');
  for (let step = 0; step < 420; step++) traversal.step();
  assert.equal(freshRun.current.flags.inkStep, true);
  let hitGate = false;
  const unlisten = traversal.onInteraction(event => { hitGate ||= event.type === 'chapter-exit'; });
  walkTo(12.6, -59.6, .35, () => hitGate);
  walkTo(15.6, -62.65, .35, () => hitGate);
  routePad.axes.fill(0);
  unlisten();
  assert.equal(hitGate, true, JSON.stringify(feet()));
  await traversal.context.assets.whenIdle();
  for (let frame = 0; frame < 120 && freshRun.current.chapter === 'ch1_climb'; frame++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(freshRun.current.chapter, 'ch2_pass');
  pendingFrame?.(performance.now());
  traversal.render();
  assert.equal(registry.get('chapter.current'), 'ch2_pass');
  console.log('Native Chapter One complete', JSON.stringify({ states: [...states], plateau, next: freshRun.current.chapter }));
} finally {
  await traversal.dispose();
}

const checkpoints = [];
let rejectCourt = true;
const resumedRun = createRunProgress({
  getItem: () => JSON.stringify({ ...createDefaultRun(), shrine: 'plateau' }),
  setItem(key, value) { checkpoints.push([key, JSON.parse(value)]); },
});
const resumed = await createTraversalPreview({
  canvas,
  viewport: { width: 96, height: 72, pixelRatio: 1 },
  assets: { ...chapterAssets, fetch(path) {
    if (rejectCourt && new URL(path).pathname.endsWith('/ch2_pass/court.glb')) return Promise.resolve(new Response(null, { status: 503 }));
    return chapterAssets.fetch(path);
  } },
  progress: resumedRun,
  input: { keyboardTarget },
  random: () => 0.3,
  gpu: nativeGpu,
});
try {
  const position = resumed.context.registry.get('player.position');
  assert.deepEqual([position.x, position.z], [14.6, -56.6]);
  assert.ok(position.grounded && position.y > 8);
  assert.deepEqual(checkpoints, [], 'resuming must not write a save');
  const events = [];
  const unsubscribe = resumed.onInteraction(event => events.push(event));
  keyboardTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyE', repeat: false }));
  resumed.step();
  keyboardTarget.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyE' }));
  unsubscribe();
  assert.ok(events.some(event => event.type === 'shrine-rested' && event.id === 'plateau'));
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0][0], 'sumiro.save.v1');
  assert.equal(checkpoints[0][1].shrine, 'plateau');
  assert.equal(resumed.context.scene.getObjectByName('shrine_plateau').getObjectByName('lantern_glow').visible, true);
  device.pushErrorScope('validation');
  resumed.render();
  const error = await device.popErrorScope();
  assert.equal(error, null, error?.message);
  console.log('Chapter checkpoint WebGPU resume', JSON.stringify(position));

  const sceneRegistry = resumed.context.registry;
  const gateRope = resumed.context.scene.getObjectByName('gate_rope');
  const inkPoolMesh = resumed.context.scene.getObjectByName('ink_pool');
  assert.ok(gateRope?.visible, 'a run without Ink Step must show the gate rope');
  assert.ok(inkPoolMesh?.isMesh && inkPoolMesh.material.transparent);
  const ropeHeight = gateRope.position.y;
  for (let step = 0; step < 180 && sceneRegistry.get('story.scene') !== 'opening_cat'; step++) resumed.step();
  assert.equal(sceneRegistry.get('story.scene'), 'opening_cat', JSON.stringify(sceneRegistry.get('player.position')));
  const beforeScene = sceneRegistry.get('player.position');
  const storyInput = keyboardDriver(resumed);
  storyInput.tap('KeyW', 15);
  const sceneFeet = sceneRegistry.get('player.position');
  assert.deepEqual([sceneFeet.x, sceneFeet.y, sceneFeet.z], [beforeScene.x, beforeScene.y, beforeScene.z],
    'manual input must not drive the player while the opening cue holds them still');
  const seenSubtitles = [];
  const clearSubtitleListener = sceneRegistry.on('story.subtitle', text => { if (text) seenSubtitles.push(text); });
  for (let step = 0; step < 2400 && sceneRegistry.get('story.scene'); step++) {
    resumed.step();
    if (step % 240 !== 0) continue;
    pendingFrame(performance.now());
    device.pushErrorScope('validation');
    resumed.render();
    assert.equal(await device.popErrorScope(), null);
  }
  clearSubtitleListener();
  assert.equal(sceneRegistry.get('story.scene'), null, 'the full opening must release camera and controls');
  assert.equal(seenSubtitles.length, 2);
  assert.equal(resumedRun.current.flags.cat_found, true);
  assert.equal(sceneRegistry.get('companion.state').phase, 'CARRIED');
  const poolAndGate = [];
  const listenPool = resumed.onInteraction(event => {
    if (event.type === 'pool-contact' || event.type === 'gate') poolAndGate.push(event);
  });
  const inkPool = { x: 5.87, z: -59.16 };
  for (let step = 0; step < 240; step++) {
    if (storyInput.steer(inkPool, sceneRegistry.get('player.position'), 1.05) <= 1.05) break;
    resumed.step();
  }
  storyInput.release();
  storyInput.tap('KeyE');
  for (let step = 0; step < 330 && !poolAndGate.some(event => event.phase === 'dropping'); step++) resumed.step();
  assert.ok(poolAndGate.some(event => event.phase === 'dropping'));
  for (let step = 0; step < 42; step++) resumed.step();
  assert.ok(gateRope.visible && gateRope.position.y < ropeHeight - .3, 'the visible rope must fall during the authored gate phase');
  for (let step = 0; step < 180; step++) resumed.step();
  listenPool();
  assert.equal(resumedRun.current.abilities.inkStep, true, JSON.stringify(sceneRegistry.get('player.position')));
  assert.equal(checkpoints.at(-1)[1].flags.inkStep, true);
  assert.deepEqual(poolAndGate.map(event => event.phase ?? event.type), ['pool-contact', 'dropping', 'open']);
  assert.equal(gateRope.visible, false);
  storyInput.tap('ShiftLeft');
  assert.equal(sceneRegistry.get('player.position').state, 'DODGE');
  for (let step = 0; step < 40; step++) resumed.step();
  const beforeFailedSwitch = checkpoints.length;
  console.log('Native Chapter One cat scene', JSON.stringify({
    subtitles: seenSubtitles, storedFlag: checkpoints.at(-1)[1].flags.cat_found,
    position: sceneRegistry.get('player.position'),
  }));

  const previousRoot = resumed.context.scene.getObjectByName('ch1_climb');
  assert.ok(previousRoot?.parent);
  await assert.rejects(resumed.advanceChapter(), /HTTP 503/);
  assert.equal(resumed.context.scene.getObjectByName('ch1_climb'), previousRoot);
  assert.equal(resumedRun.current.chapter, 'ch1_climb');
  assert.equal(checkpoints.length, beforeFailedSwitch);
  rejectCourt = false;
  const gateEvents = [];
  const listenGate = resumed.onInteraction(event => { if (event.type === 'chapter-exit') gateEvents.push(event); });
  const gateInput = keyboardDriver(resumed);
  for (const mark of [{ x: 12.6, z: -59.6 }, { x: 15.6, z: -62.65 }]) {
    for (let step = 0; step < 600 && gateEvents.length === 0; step++) {
      if (gateInput.steer(mark, sceneRegistry.get('player.position'), .32, sceneRegistry.get('camera.steeringYaw')) <= .32) break;
      resumed.step();
    }
    gateInput.release();
  }
  listenGate();
  assert.equal(gateEvents.length, 1, JSON.stringify(sceneRegistry.get('player.position')));
  await resumed.context.assets.whenIdle();
  for (let frame = 0; frame < 120 && resumedRun.current.chapter === 'ch1_climb'; frame++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(resumedRun.current.chapter, 'ch2_pass');
  assert.equal(checkpoints.at(-1)[1].chapter, 'ch2_pass');
  assert.equal(previousRoot.parent, null);
  const nextRoot = resumed.context.scene.getObjectByName('ch2_pass');
  assert.ok(nextRoot?.parent);
  pendingFrame(performance.now());
  device.pushErrorScope('validation');
  resumed.render();
  const arrival = resumed.context.registry.get('player.position');
  assert.deepEqual([arrival.x, arrival.z], [14, -15.5]);
  assert.equal(arrival.grounded, true);
  assert.equal(resumed.context.registry.get('chapter.current'), 'ch2_pass');
  resumed.step();
  const cat = resumed.context.scene.getObjectByName('companion');
  assert.ok(cat?.visible);
  let fur;
  cat.traverse(object => { if (object.isSkinnedMesh) fur = object.material; });
  assert.ok(fur?.isNodeMaterial && fur.map, 'the cat uses its supplied fur texture with the native ink material');
  assert.equal(fur.vertexColors, false, 'packed vertex paint must not color the cat red');
  assert.equal(resumed.context.registry.get('companion.state').phase, 'CARRIED');
  keyboardTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyF', repeat: false }));
  resumed.step();
  keyboardTarget.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyF' }));
  assert.equal(resumed.context.registry.get('companion.state').phase, 'IDLE');
  keyboardTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyF', repeat: false }));
  resumed.step();
  keyboardTarget.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyF' }));
  assert.equal(resumed.context.registry.get('companion.state').phase, 'CARRIED');
  const chapterTwoPixel = await sample(48, 58);
  assert.equal(chapterTwoPixel[3], 255);
  assert.ok(chapterTwoPixel[0] > 100 && chapterTwoPixel[0] - chapterTwoPixel[1] < 35,
    'authoring paint must not appear as saturated red on the Chapter Two terrain');
  const chapterSamples = [[20, 58], [35, 48], [48, 58], [63, 48], [75, 58]];
  const passPixels = await Promise.all(chapterSamples.map(([x, y]) => sample(x, y)));
  nextRoot.visible = false;
  pendingFrame(performance.now());
  resumed.render();
  const emptyPixels = await Promise.all(chapterSamples.map(([x, y]) => sample(x, y)));
  assert.ok(passPixels.some((pixel, index) => pixel.slice(0, 3)
    .some((channel, component) => Math.abs(channel - emptyPixels[index][component]) > 8)));
  nextRoot.visible = true;
  const switchError = await device.popErrorScope();
  assert.equal(switchError, null, switchError?.message);
  console.log('Native chapter switch WebGPU readback', JSON.stringify({ arrival, chapterTwoPixel }));

  const { tap: key, steer: steerToward, release: releaseArrows } = keyboardDriver(resumed);
  key('KeyD', 43);
  for (let step = 0; step < 16; step++) resumed.step();
  keyboardTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
  for (let step = 0; step < 235 && resumed.context.registry.get('player.position').z > -35.4; step++) resumed.step();
  keyboardTarget.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyW' }));

  const readDuel = () => resumed.context.registry.get('combat.sword-wraith');
  assert.equal(readDuel().phase, 'fighting');
  assert.equal(nextRoot.getObjectByName('sword_wraith').visible, true);
  pendingFrame(performance.now());
  device.pushErrorScope('validation');
  resumed.render();
  assert.equal(await device.popErrorScope(), null);
  const playerNow = () => resumed.context.registry.get('player.position');
  const vitalsNow = () => resumed.context.registry.get('game.vitals');
  assert.equal(vitalsNow().strokes, 5);
  for (let step = 0; step < 1200 && vitalsNow().strokes === 5; step++) {
    steerToward(readDuel().enemy, playerNow(), 1.37);
    resumed.step();
  }
  releaseArrows();
  assert.equal(vitalsNow().strokes, 4, JSON.stringify(readDuel()));
  assert.equal(readDuel().player.strokes, vitalsNow().strokes);
  const retreat = { x: 9.6, z: -22 };
  for (let step = 0; step < 180; step++) {
    if (steerToward(retreat, playerNow(), .8) <= .8) break;
    resumed.step();
  }
  releaseArrows();
  for (let step = 0; step < 16; step++) resumed.step();
  const wounded = vitalsNow().strokes;
  key('KeyR');
  assert.equal(vitalsNow().drinks, 2);
  assert.equal(vitalsNow().strokes, wounded, 'drinking must wait for its animation cue to heal');
  for (let step = 0; step < 68; step++) resumed.step();
  assert.equal(vitalsNow().strokes, Math.min(5, wounded + 2));
  console.log('Native Court vitals recovery', JSON.stringify({ wounded, healed: vitalsNow().strokes, drinks: vitalsNow().drinks }));
  for (let step = 0; step < 45; step++) resumed.step();
  for (let step = 0; step < 1800 && readDuel().phase === 'fighting'; step++) {
    const { player, enemy } = readDuel();
    const position = resumed.context.registry.get('player.position');
    const distance = steerToward(enemy, position, 1.9);
    if (enemy.hitIn != null && enemy.hitIn > 0.07 && enemy.hitIn < 0.15 && player.action !== 'PARRY') key('KeyK', 1);
    else if (step % 6 === 0 && distance < 2.8 && enemy.action !== 'RISING') key('KeyJ', 1);
    else resumed.step();
  }
  assert.equal(readDuel().phase, 'clear', JSON.stringify(readDuel()));
  assert.equal(resumedRun.current.flags.ch2_sword_wraith, true);
  console.log('Native sword-wraith session', JSON.stringify({ phase: readDuel().phase, hp: readDuel().enemy.hp,
    strokes: readDuel().player.strokes, storedFlag: checkpoints.at(-1)[1].flags.ch2_sword_wraith }));

  const bell = { x: 17.4, z: -36.4 };
  for (let step = 0; step < 210; step++) {
    if (steerToward(bell, resumed.context.registry.get('player.position'), 1.2) <= 1.2) break;
    resumed.step();
  }
  releaseArrows();
  key('KeyJ', 1);
  assert.equal(resumedRun.current.flags.ch2_court_door, true, 'an attack near the bell must open the court');
  for (let step = 0; step < 55; step++) resumed.step();
  const leaves = nextRoot.getObjectByName('court_door_leaves');
  assert.deepEqual(leaves.children.map(node => node.rotation.y), [1.75, -1.75]);

  assert.equal(await resumed.advanceChapter(), true);
  assert.equal(nextRoot.parent, null);
  assert.ok(resumed.context.scene.getObjectByName('ch3_pines')?.parent);
  pendingFrame(performance.now());
  device.pushErrorScope('validation');
  resumed.render();
  const pines = resumed.context.registry.get('player.position');
  assert.deepEqual([pines.x, pines.y, pines.z, pines.grounded], [32, 20, -60, true]);
  const pinesPixel = await sample(48, 58);
  assert.equal(pinesPixel[3], 255);
  const pinesError = await device.popErrorScope();
  assert.equal(pinesError, null, pinesError?.message);
  const pineBridge = resumed.context.scene.getObjectByName('br5_mesh');
  assert.ok(pineBridge);
  const initialRoll = pineBridge.rotation.z;
  for (let step = 0; step < 30; step++) resumed.step();
  assert.ok(Math.abs(pineBridge.rotation.z - initialRoll) > 0.01);
  console.log('Native pines WebGPU readback', JSON.stringify({ pines, pinesPixel }));

  const laterChapters = [
    ['ch4_temple', 30, 8, -43],
    ['ch5_sea', 30, 3.6, -64],
    ['ch6_summit', 29, 10, -50],
  ];
  for (const [id, x, y, z] of laterChapters) {
    const prior = resumed.context.scene.getObjectByName(resumedRun.current.chapter);
    assert.ok(prior?.parent);
    assert.equal(await resumed.advanceChapter(), true);
    const root = resumed.context.scene.getObjectByName(id);
    assert.ok(root?.parent && prior.parent === null);
    assert.equal(resumedRun.current.chapter, id);
    resumed.render();
    if (id === 'ch4_temple') {
      const carrier = root.getObjectByName('n_mv');
      assert.ok(carrier);
      const before = carrier.position.z;
      for (let step = 0; step < 45; step++) resumed.step();
      assert.ok(root.getObjectByName('g_great')?.children.length === 2);
      assert.ok(Math.abs(carrier.position.z - before) > 0.5);
    }
    if (id === 'ch5_sea') {
      const sea = root.getObjectByName('sea'), raft = root.getObjectByName('raft_node');
      assert.ok(sea && raft);
      for (let step = 0; step < 600; step++) resumed.step();
      assert.ok(Math.abs(sea.position.y - 1.5) < 1e-8);
      assert.ok(Math.abs(raft.position.y - (sea.position.y + 0.4)) < 1e-8);
    }
    pendingFrame(performance.now());
    device.pushErrorScope('validation');
    resumed.render();
    const feet = resumed.context.registry.get('player.position');
    assert.deepEqual([feet.x, feet.y, feet.z, feet.grounded], [x, y, z, true]);
    let meshes = 0;
    root.traverse(object => { if (object.isMesh && object.geometry.attributes.position.count > 0) meshes++; });
    assert.ok(meshes > 0, 'the actual chapter asset must decode into drawable meshes');
    const samples = [[24, 52], [36, 56], [48, 56], [60, 56], [72, 52]];
    const visible = await Promise.all(samples.map(([x, y]) => sample(x, y)));
    if (id === 'ch6_summit') assert.ok(visible[2].slice(0, 3).every(channel => channel > 65),
      'Summit terrain must retain diffuse ink shading: ' + visible[2]);
    root.visible = false;
    pendingFrame(performance.now());
    resumed.render();
    const hidden = await Promise.all(samples.map(([x, y]) => sample(x, y)));
    assert.ok(visible.some((pixel, index) => pixel.slice(0, 3)
      .some((channel, component) => Math.abs(channel - hidden[index][component]) > 8)), `${id} must contribute pixels`);
    root.visible = true;
    const validation = await device.popErrorScope();
    assert.equal(validation, null, validation?.message);
    console.log('Native chapter WebGPU readback', JSON.stringify({ id, feet, meshes, center: visible[2] }));
  }
} finally {
  await resumed.dispose();
}

let seaWrite;
const seaProgress = createRunProgress({
  getItem: () => JSON.stringify({ ...createDefaultRun(), chapter: 'ch5_sea', shrine: 'first_rock' }),
  setItem(_key, value) { seaWrite = JSON.parse(value); },
});
const seaResume = await createTraversalPreview({
  canvas,
  viewport: { width: 96, height: 72, pixelRatio: 1 },
  assets: chapterAssets,
  progress: seaProgress,
  input: { keyboardTarget },
  gpu: nativeGpu,
});
try {
  const feet = seaResume.context.registry.get('player.position');
  assert.deepEqual([feet.x, feet.z, feet.grounded], [27.4, -130.1, true]);
  assert.equal(seaWrite, undefined);
  keyboardTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyE', repeat: false }));
  seaResume.step();
  keyboardTarget.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyE' }));
  assert.equal(seaWrite.chapter, 'ch5_sea');
  assert.equal(seaWrite.shrine, 'first_rock');
  const seaInput = keyboardDriver(seaResume);
  seaInput.tap('KeyS', 24);
  assert.notDeepEqual(seaResume.context.registry.get('player.position'), feet);
  seaResume.setPaused(true);
  seaResume.restartFromCheckpoint();
  assert.deepEqual(seaResume.context.registry.get('player.position'), feet);
  assert.equal(seaResume.context.paused, false);
  device.pushErrorScope('validation');
  seaResume.render();
  assert.equal(await device.popErrorScope(), null);
  console.log('Native Sea shrine resume', JSON.stringify(feet));
} finally {
  await seaResume.dispose();
}

let seaExitWrite;
const seaExitProgress = createRunProgress({
  getItem: () => JSON.stringify({ ...createDefaultRun(), chapter: 'ch5_sea', shrine: 'before_gate', flags: { cat_found: true } }),
  setItem(_key, value) { seaExitWrite = JSON.parse(value); },
});
const seaRoute = await verifySeaExitRoute({
  createRuntime: createRouteRuntime,
  keyboardTarget, progress: seaExitProgress, savedRun: () => seaExitWrite,
});
console.log('Native Sea gate to Summit', JSON.stringify(seaRoute));

let pinesWrite;
const pinesProgress = createRunProgress({
  getItem: () => JSON.stringify({ ...createDefaultRun(), chapter: 'ch3_pines', shrine: 'pines_1' }),
  setItem(_key, value) { pinesWrite = JSON.parse(value); },
});
const pinesCombat = await createTraversalPreview({
  canvas,
  viewport: { width: 96, height: 72, pixelRatio: 1 },
  assets: chapterAssets,
  progress: pinesProgress,
  input: { keyboardTarget },
  random: () => 0.3,
  gpu: nativeGpu,
});
const pinesInput = keyboardDriver(pinesCombat);
try {
  const { registry } = pinesCombat.context;
  const pinesFeet = () => registry.get('player.position');
  for (let step = 0; step < 180; step++) {
    if (pinesInput.steer({ x: -11, z: -199.8 }, pinesFeet(), .45) <= .45) break;
    pinesCombat.step();
  }
  pinesInput.release();
  pinesInput.tap('KeyE');
  assert.equal(registry.get('story.scene'), 'lantern_rest', JSON.stringify(pinesFeet()));
  let restSpoken = false;
  const stopRest = registry.on('story.subtitle', line => { restSpoken ||= line === 'Warm, is it? Rest a moment.'; });
  for (let step = 0; step < 1900 && registry.get('story.scene'); step++) {
    pinesCombat.step();
    if (step % 300 !== 0) continue;
    pendingFrame?.(performance.now());
    device.pushErrorScope('validation');
    pinesCombat.render();
    assert.equal(await device.popErrorScope(), null);
  }
  stopRest();
  assert.equal(registry.get('story.scene'), null, 'rest must release camera and player control');
  assert.equal(restSpoken, true);
  assert.equal(registry.get('companion.state').phase, 'CARRIED');
  assert.equal(pinesProgress.current.seen.story_lantern, true);
  console.log('Native Pines lantern rest', JSON.stringify({ feet: pinesFeet(), rested: pinesWrite.shrine, restSpoken }));
  const encounter = () => registry.get('combat.encounters');
  for (let step = 0; step < 180 && encounter()?.actors.length === 0; step++) {
    pinesInput.steer({ x: -16.2, z: -197.6 }, registry.get('player.position'), .35);
    pinesCombat.step();
  }
  pinesInput.release();
  assert.equal(encounter().actors.filter(actor => actor.alive).length, 2, JSON.stringify(registry.get('player.position')));
  device.pushErrorScope('validation');
  pinesCombat.render();
  assert.equal(await device.popErrorScope(), null);
  for (let step = 0; step < 2600 && !pinesProgress.current.flags.ch3_pines_first; step++) {
    const { actors, player } = encounter();
    const feet = registry.get('player.position');
    const living = actors.filter(actor => actor.alive);
    const distanceOf = actor => Math.hypot(actor.x - feet.x, actor.z - feet.z);
    const enemy = living.sort((a, b) => distanceOf(a) - distanceOf(b))[0];
    if (!enemy || player.action === 'DEATH') break;
    const distance = pinesInput.steer(enemy, feet, 1.9);
    const keyframe = enemy.move === 'overhead' ? [8.4, 9.4] : [4.3, 5.1];
    if (distance < 2.7 && enemy.state === 'MOVE' && enemy.frame > keyframe[0] && enemy.frame < keyframe[1] && player.action !== 'PARRY') {
      pinesInput.tap('KeyK');
    } else if (distance < 2.7 && step % 6 === 0 && enemy.awake) pinesInput.tap('KeyJ');
    else pinesCombat.step();
  }
  assert.equal(pinesWrite?.flags.ch3_pines_first, true, JSON.stringify(encounter()));
  console.log('Native Pines encounter clear', JSON.stringify({ actors: encounter().actors.map(actor => [actor.id, actor.hp]),
    strokes: encounter().player.strokes }));
} finally {
  pinesInput.release();
  await pinesCombat.dispose();
}

let summitWrite;
const summitProgress = createRunProgress({
  getItem: () => JSON.stringify({ ...createDefaultRun(), chapter: 'ch6_summit', shrine: 'arena_door',
    flags: { cat_found: true } }),
  setItem(_key, value) { summitWrite = JSON.parse(value); },
});
try {
  const summitRoute = await verifySummitDuelRoute({
    createRuntime: createRouteRuntime, keyboardTarget, progress: summitProgress, savedRun: () => summitWrite,
    async inspectFrame(runtime, phase) {
      pendingFrame?.(performance.now());
      device.pushErrorScope('validation');
      runtime.render();
      const error = await device.popErrorScope();
      assert.equal(error, null, `${phase}: ${error?.message}`);
    },
  });
  console.log('Native Summit duel, reunion, and ending', JSON.stringify(summitRoute));
} finally {
  try { fixtureTextures.restore(); } finally { restoreDraco(); }
}
