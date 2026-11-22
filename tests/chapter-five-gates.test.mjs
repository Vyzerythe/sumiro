import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Group } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import ts from 'typescript';
import { chapterFiveGateSites, createChapterFiveGates } from '../src/application/chapter-five-gates.mts';
import { createChapterFiveWorld } from '../src/application/chapter-five-world.mts';
import { n as originalExtrude, t as createOriginalWorld } from '../sumiro/bundle/collision-DtBQEpmQ.js';

const [sea, level, combat] = await Promise.all(['ch5_sea-CpHUIhkX.js', 'level-O-RtwNJJ.js', 'combat-Dp_zXhrv.js']
  .map(file => readFile(new URL('../sumiro/bundle/' + file, import.meta.url), 'utf8')));
const quote = String.fromCharCode(96);

function span(source, first, last) {
  const from = source.indexOf(first);
  const end = source.indexOf(last, from);
  assert.ok(from >= 0 && end > from, 'Published code boundary changed at ' + first);
  return source.slice(from, end);
}

const parsed = ts.createSourceFile('chapter.mjs', sea, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = new Map(parsed.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations].map(d => [d.name.getText(parsed), d])));
const defs = Function(
  'const ' + ['b', 'S', 'G', 'K', 'F', 'B'].map(name => declarations.get(name).getText(parsed)).join(',') +
  ';return ' + span(sea, 'mechs:[', ',combat:').slice('mechs:'.length) + ';',
)();
const originalCourt = Function('return {' + span(sea, 'id:' + quote + 'court' + quote + ',start:', '}],swarms:') + '};')();
const sourceTravel = Number(/Mt=(\.\d+)/.exec(combat)[1]);
const originalMechanisms = Function('f', 'S', 'J', 'U', 'W', 'i', 'w', 'X', 'r',
  span(level, 'function de(', 'let pe={') + 'return { veil: de, bell: fe };');
const originalEncounterDoors = Function('X', 'Mt', 'e',
  span(combat, 'function Xt(', 'function Qt(') + span(combat, 'function nn(', 'function rn(') +
  span(combat, 'function zt(', 'function Bt(') + 'return { set: Zt, step: nn, contains: zt };');
const originalCurtainFade = Function('e', 'n', 'r', 'u', 'l',
  span(sea, 'for(let t of r.curtains)', 'let d=n.registry.get'));

test('veil geometry, passability, and curtain fades match the shipped level rules', () => {
  const world = createChapterFiveWorld().world;
  const originalWorld = createOriginalWorld();
  const original = originalMechanisms(originalWorld, originalExtrude, () => ({ node: null }), () => false,
    () => {}, {}, new Map(), () => {}, { interactables: [] });
  const controller = createChapterFiveGates(world);
  const reference = defs.filter(def => def.kind === 'veil').map(original.veil);
  reference.forEach(veil => veil.reset());
  const curtains = reference.map(veil => ({ z: veil.def.pts[0][1], fade: 1,
    mesh: { material: { uniforms: { uFade: {}, uTime: {} } } } }));
  for (const [index, veil] of controller.veils.entries()) {
    const def = reference[index].def;
    const { site } = veil;
    assert.deepEqual([site.id, site.node, site.bottom, site.top, [[site.left, site.z], [site.right, site.z]]],
      [def.id, def.node, def.from, def.to, def.pts]);
  }
  assert.deepEqual(world.triangles().filter(triangle => triangle.group?.startsWith('veil_')), originalWorld.triangles());

  const ray = [86, 5, -346, 0, 0, -1, 4, 2];
  assert.equal(world.raycast(...ray), 2);
  controller.inkStep();
  reference.forEach(veil => veil.inkStep());
  assert.equal(world.raycast(...ray), Infinity);
  assert.equal(world.raycast(...ray), originalWorld.raycast(...ray));
  for (const [delta, seconds, cameraZ, playerZ, state] of [
    [0.05, 9, -346, -350, 'DASH'],
    [0.1, 9.1, -346, -352, 'DODGE'],
    [0.25, 9.35, -346, -352, 'IDLE'],
    [0.1, 9.45, -356, -352, 'IDLE'],
  ]) {
    const player = { x: 86, z: playerZ, state };
    controller.step(delta, { player, cameraZ, seconds });
    reference.forEach(veil => veil.update(delta, player));
    originalCurtainFade(delta, { time: { t: seconds } }, { curtains }, player, { z: cameraZ });
    for (const [index, veil] of controller.veils.entries()) {
      assert.equal(veil.passable, reference[index].read().passable);
      assert.equal(veil.fade, curtains[index].mesh.material.uniforms.uFade.value);
      assert.equal(veil.seconds, curtains[index].mesh.material.uniforms.uTime.value);
    }
    assert.equal(world.raycast(...ray), originalWorld.raycast(...ray));
  }
  controller.reset();
  assert.equal(world.raycast(...ray), 2);
  const finaleRay = [191.5, 5, -555, 0, 0, -1, 4, 2];
  assert.equal(world.raycast(...finaleRay), 2);
  controller.dispose();
  assert.equal(world.raycast(...finaleRay), Infinity);
});

test('the original bell hit cooldown and event order leave court groups independent', () => {
  const world = createChapterFiveWorld().world;
  const events = [];
  const refEvents = [];
  const effects = {
    onCue: cue => events.push(['audio.cue', cue]),
    onShake: strength => events.push(['camera_rig.shake', strength]),
    breakSwarm: id => events.push(['breakSwarm', id]),
  };
  const referenceState = { interactables: [] };
  let originalRoll = 0;
  const factory = originalMechanisms(world, originalExtrude, () => ({ node: null }), () => false,
    cue => refEvents.push(['audio.cue', cue]), { set: (...args) => refEvents.push(args), get: () => null },
    new Map(), (_node, _x, _y, _z, _a, _o, roll) => { originalRoll = roll; }, referenceState);
  const ref = factory.bell(defs.find(def => def.id === 'crow_bell'));
  const sourceLink = /onRing=\(\)=>t\.registry\.get\(([^\)]+)\)\?\.breakSwarm\(([^\)]+)\)/.exec(sea);
  assert.ok(sourceLink);
  const swarm = Function('return ' + sourceLink[2])();
  ref.onRing = () => refEvents.push(['breakSwarm', swarm]);
  const gate = createChapterFiveGates(world, effects);
  const { bell: site } = chapterFiveGateSites;
  const touch = referenceState.interactables[0];
  assert.deepEqual([site.id, site.x, site.standY, site.z, site.reach, site.prompt],
    [touch.id, touch.x, touch.y, touch.z, touch.r, touch.prompt]);
  for (const [delta, trigger] of [[0, 'strike'], [0.4, 'strike'], [0, 'interact'], [0.88, 'strike'], [0.03, 'strike']]) {
    ref.update(delta);
    gate.step(delta);
    assert.equal(gate.bell.roll, originalRoll);
    const before = ref.rings;
    if (trigger === 'strike') ref.ring({});
    else touch.use();
    assert.equal(gate.ringBell(trigger), ref.rings !== before);
    assert.equal(gate.bell.rings, ref.rings);
    assert.deepEqual(events, refEvents);
  }
  assert.equal(gate.court, 'idle');
  gate.reset();
  ref.reset();
  assert.equal(gate.bell.rings, ref.rings);
  assert.equal(gate.ringBell('strike'), false);
});

test('court groups switch immediately and the actual GLB doors travel on the authored schedule', async () => {
  const bytes = await readFile(new URL('../sumiro/assets/levels/ch5_sea/sea.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const world = createChapterFiveWorld().world;
  const flags = new Set();
  const events = [];
  const controller = createChapterFiveGates(world, { hasFlag: flag => flags.has(flag),
    setFlag: flag => { flags.add(flag); events.push(flag); }, onCue: cue => events.push(cue) });
  const originalGroups = new Map();
  const originalNodes = new Map(originalCourt.doors.map(def => [def.node, { position: { y: 3.6 } }]));
  const original = originalEncounterDoors({
    level: { world: { setGroup: (...args) => originalGroups.set(...args) }, group: { getObjectByName: name => originalNodes.get(name) } },
    encounters: [{ def: originalCourt }],
  }, sourceTravel, () => false);
  original.set({ def: originalCourt }, 'idle', true);
  const initial = chapterFiveGateSites.court.doors.map(site => gltf.scene.getObjectByName(site.node).position.toArray());
  const bell = new Group();
  const exposed = new Map();
  controller.bind(gltf.scene, { bell, onVeil: (id, state) => exposed.set(id, state) });
  assert.deepEqual(chapterFiveGateSites.court.start, originalCourt.start.circle);
  assert.deepEqual(chapterFiveGateSites.court.leash, originalCourt.leash.circle);
  assert.deepEqual(chapterFiveGateSites.court.catHide, originalCourt.catHide);
  assert.equal(chapterFiveGateSites.court.flag, originalCourt.flag);
  for (const x of [125, 131, 132, 133]) {
    assert.equal(controller.canStartCourt({ x, z: -499, state: 'IDLE', grounded: true }, true),
      original.contains(originalCourt.start, x, -499, 3.6));
  }
  const compare = () => {
    for (const { site, y, open } of controller.doors) {
      const ray = [125, 5, site.z + 1, 0, 0, -1, 2, 2];
      assert.equal(open, !originalGroups.get(site.group));
      assert.equal(world.raycast(...ray), open ? Infinity : 1);
      assert.equal(y, originalNodes.get(site.node).position.y);
      assert.equal(gltf.scene.getObjectByName(site.node).position.y, y);
      assert.equal(world.body(site.group), null);
    }
  };
  compare();
  for (const [state, delta] of [['fighting', 0], ['fighting', 0.23], ['fighting', 0.57], ['clear', 0], ['clear', 0.4], ['clear', 0.4]]) {
    original.set({ def: originalCourt }, state);
    original.step(delta);
    controller.step(delta, { court: state, seconds: 22 });
    compare();
  }
  assert.deepEqual(events, ['gate', 'ch5_court', 'gate']);
  assert.equal(exposed.get('veil0').seconds, 22);
  assert.deepEqual(bell.position.toArray(), [122, 7.4, -405.8]);
  original.set({ def: originalCourt }, 'clear', true);
  controller.reset();
  compare();
  controller.dispose();
  assert.deepEqual(chapterFiveGateSites.court.doors.map(site => gltf.scene.getObjectByName(site.node).position.toArray()), initial);
  gltf.scene.traverse(node => {
      if (node.isMesh) {
        node.geometry.dispose();
        node.material.dispose();
      }
  });
});
