import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { AnimationClip, Group } from 'three/webgpu';
import { getStaticChapter } from '../src/application/static-chapter-catalog.mts';
import { resolveChapterSpawn } from '../src/application/chapter-checkpoints.mts';
import { createChapterExit } from '../src/application/chapter-exits.mts';
import { loadEncounterCombat } from '../src/application/encounter-combat.mts';
import { mountLateChapterMechanisms } from '../src/application/late-chapter-mechanisms.mts';
import { createLaterChapterCamera } from '../src/application/later-chapter-camera.mts';
import { createRunProgress } from '../src/domain/run-progress.mts';
import { createRunVitals } from '../src/domain/run-vitals.mts';
import { createDefaultRun } from '../src/domain/save.mts';
import { createInputManager } from '../src/input/input-manager.mts';
import { createTraversalController } from '../src/player/traversal-controller.mts';

const delta = 1 / 60;
const glb = await readFile(new URL('../sumiro/assets/player/player.glb', import.meta.url));
const rig = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)));
const clipDurations = Object.fromEntries(rig.animations.map(clip => [clip.name,
  Math.max(...clip.samplers.map(sampler => rig.accessors[sampler.input].max[0])),
]));
function duration(clip) {
  assert.ok(Number.isFinite(clipDurations[clip]), `Missing clip timing for ${clip}`);
  return clipDurations[clip];
}

async function prepareApproach(t, id, shrine, flags = {}, withCombat = false) {
  const chapter = getStaticChapter(id);
  const { world, spawn, killDrop, killY } = chapter.createWorld();
  const root = new Group();
  const save = {
    ...createDefaultRun(), chapter: id, unlocked: ['ch1_climb', id], shrine, flags,
  };
  const progress = createRunProgress({ getItem: () => JSON.stringify(save) });
  const health = createRunVitals();
  const lifecycle = new AbortController();
  const cleanups = [];
  const lifetime = { signal: lifecycle.signal, defer: dispose => cleanups.push(dispose) };
  t.after(() => { lifecycle.abort(); for (const dispose of cleanups.reverse()) dispose(); });
  const keyboard = new EventTarget();
  const gamepad = { axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
  const input = createInputManager({ keyboardTarget: keyboard, getGamepads: () => [gamepad] });
  lifetime.defer(input.dispose);
  // The CPU route exercises the production controller/scene adapters with
  // unrendered gate markers and the supplied GLB's authored clip durations.
  if (withCombat) for (const name of ['leaf_door', 'leaf_great']) {
    const leaf = new Group();
    leaf.name = name;
    root.add(leaf);
  }
  let combat;
  const cues = [];
  const mechanisms = mountLateChapterMechanisms(id, world, root, lifetime, progress, {
    encounterState: encounter => combat?.state(encounter),
    breakSwarm() {},
    onEvent: event => { if (event.type === 'cue') cues.push(event.name); },
  });
  const start = resolveChapterSpawn(id, spawn, progress.current, world);
  assert.notDeepEqual(start, spawn, 'The authored saved stand is reachable');
  const player = createTraversalController(world, start, {
    ...chapter.createTraversal(world), duration, canInkStep: () => progress.current.abilities.inkStep === true,
  });
  if (withCombat) combat = await loadEncounterCombat({
    id, root, world, player, lifetime, progress, health, duration, random: () => .23,
    assets: { async loadGLTF() {
      const scene = new Group();
      return { scene, scenes: [scene],
        animations: Object.entries(clipDurations).map(([name, seconds]) => new AnimationClip(name, seconds, [])) };
    } },
    onCue: cue => cues.push(cue), onHint() {},
  });
  const camera = createLaterChapterCamera(world, id, { fighting: encounter => combat?.state(encounter) === 'fighting' });
  const exit = createChapterExit(id);
  const { state } = player;
  const supportedBy = new Set();
  const heldLedges = new Set();
  const passed = [];
  let view = camera(state, 0, 0);
  let seconds = 0;
  let walking = false;
  const pose = () => `${state.state} at (${state.x.toFixed(3)}, ${state.y.toFixed(3)}, ${state.z.toFixed(3)})`;

  function step(frame = {}) {
    if (walking !== Boolean(frame.walk)) {
      walking = Boolean(frame.walk);
      keyboard.dispatchEvent(Object.assign(new Event(walking ? 'keydown' : 'keyup'), { code: 'KeyC' }));
    }
    gamepad.axes = [frame.strafe ?? 0, -(frame.forward ?? 0)];
    gamepad.buttons[0].pressed = Boolean(frame.jump || frame.jumpHeld);
    gamepad.buttons[2].pressed = Boolean(frame.attack);
    gamepad.buttons[4].pressed = Boolean(frame.parry);
    input.beginStep(seconds, delta);
    mechanisms.step({ delta, player, attack: input.attack, interact: input.interact, seconds, cameraZ: view.z });
    if (!combat || combat.player.action === 'IDLE') player.step(delta, input, view);
    combat?.step(delta, seconds, { attack: input.attack, parry: input.parry,
      swordAvailable: progress.current.abilities.sword === true }, true);
    input.endStep();
    view = camera(state, delta, 0);
    seconds += delta;
    assert.ok(state.y >= killY && state.lastGroundY - state.y <= killDrop, `Fell from the route: ${pose()}`);
    if (state.ledge) heldLedges.add(state.ledge.id);
    if (state.grounded && state.carrier) supportedBy.add(state.carrier.id);
    if (exit.update(delta, state, progress.current.flags)) {
      assert.ok(state.grounded);
      passed.push({ x: state.x, y: state.y, z: state.z });
    }
  }

  function aim(x, z, magnitude = 1) {
    const dx = x - state.x, dz = z - state.z;
    const scale = magnitude / (Math.hypot(dx, dz) || 1);
    const yaw = state.holdActive ? state.holdYaw : view.railYaw * Math.PI / 180;
    return { forward: (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) * scale,
      strafe: (Math.cos(yaw) * dx - Math.sin(yaw) * dz) * scale };
  }

  function frames(count, inputs = () => ({})) {
    for (let i = 0; i < count; i++) step(inputs(i));
  }

  function walkTo(name, x, z, { radius = .18, walk = false } = {}) {
    for (let i = 0; i < 480; i++) {
      if (Math.hypot(x - state.x, z - state.z) < radius) return;
      step({ ...aim(x, z), walk });
    }
    assert.fail(`Could not reach ${name}: ${pose()}`);
  }

  function jumpToward(x, z, count = 40) {
    frames(count, i => ({ ...aim(x, z), jump: i === 0, jumpHeld: true }));
  }

  function waitUntil(time) { while (seconds < time) step(); }

  return { world, state, combat, health, progress, passed, cues, supportedBy, heldLedges, step, aim, frames, walkTo, jumpToward, waitUntil };
}

test('Hanging Pines reaches the road from pines_4 via wall holds, tipping boards and both bridge gaps', async t => {
  const { state, heldLedges, supportedBy, passed, progress, cues, step, frames, walkTo, jumpToward, aim, waitUntil } =
    await prepareApproach(t, 'ch3_pines', 'pines_4');
  walkTo('stair entrance', -392, -212.3, { walk: true });
  walkTo('broken deck approach', -414.6, -212.4);
  jumpToward(-420, -212.4);
  assert.ok(state.grounded && state.x < -418 && state.y === 34);
  walkTo('first wall hold takeoff', -425.1, -213.5, { walk: true, radius: .08 });
  jumpToward(-425.3, -214.7, 30);
  assert.equal(state.ledge?.id, 'wall_a');
  for (const [count, next] of [[330, 'wall_b'], [250, 'wall_c']]) {
    frames(count, () => ({ strafe: -1 }));
    step({ strafe: -1, jump: true });
    frames(40);
    assert.equal(state.ledge?.id, next);
  }
  assert.deepEqual([...heldLedges], ['wall_a', 'wall_b', 'wall_c']);
  frames(100, () => ({ forward: 1 }));
  assert.ok(state.grounded && Math.abs(state.y - 41.2) < 1e-8);

  walkTo('upper shelf', -444.6, -238);
  // Gust 7 repeats every 8.8 seconds. Begin the board sequence in calm.
  waitUntil(35.25);
  walkTo('first board takeoff', -444.6, -241.1);
  jumpToward(-444.6, -246, 41);
  assert.equal(state.carrier?.id, 'tip0');
  walkTo('first board far edge', -444.55, -247, { radius: .13 });
  jumpToward(-444.1, -251);
  assert.equal(state.carrier?.id, 'tip1');
  walkTo('second board far edge', -444.15, -252.21, { radius: .1 });
  jumpToward(-445.1, -256.7);
  assert.equal(state.carrier?.id, 'tip2');
  walkTo('third board far edge', -445.1, -257.3, { radius: .1 });
  jumpToward(-444.6, -261.8);
  assert.ok(state.grounded && state.carrier === null);

  walkTo('bridge approach', -444.6, -267.4);
  assert.equal(state.carrier?.id, 'br12');
  walkTo('first bridge opening', -444.6, -273.31);
  jumpToward(-444.6, -278.2, 41);
  assert.ok(state.grounded && state.carrier?.id === 'br12' && state.z < -276.6);
  // Look down the bridge and trim side input to compensate for wind and roll.
  function bridgeInput() {
    const correction = Math.min(.45, Math.max(-.45, (-444.6 - state.x) * 2.5 - state.vx * .17));
    return aim(state.x + correction, state.z - 1);
  }
  for (let i = 0; i < 100 && state.z > -280.28; i++) step(bridgeInput());
  assert.ok(state.grounded && state.z <= -280.28 && state.z > -280.9);
  frames(41, i => ({ ...bridgeInput(), jump: i === 0, jumpHeld: true }));
  assert.ok(state.grounded && state.carrier?.id === 'br12' && state.z < -283.2);
  walkTo('far bridge landing', -444.6, -290.4);
  walkTo('road exit', -444.6, -303);
  assert.deepEqual([...supportedBy], ['tip0', 'tip1', 'tip2', 'br12']);
  assert.ok(cues.includes('gustBlow'));
  assert.equal(passed.length, 1);
  assert.ok(passed[0].z < -301 && Math.abs(passed[0].y - 41.2) < 1e-8);
  await progress.completeChapter(chapter => assert.equal(chapter, 'ch4_temple'));
  assert.equal(progress.current.chapter, 'ch4_temple');
});

test('Temple hall checkpoint clears nine enemies, rings the dais bell and reaches the natural exit', async t => {
  // These are the prerequisites of the saved hall checkpoint. Hall clearance
  // and the last bell must still be earned during the replay.
  const { world, state, combat, health, progress, passed, cues, step, frames, walkTo, aim } =
    await prepareApproach(t, 'ch4_temple', 'hall', {
      ch4_gd_w: true, ch4_gd_e: true, ch4_great_door: true, ch4_great: true,
    }, true);
  assert.equal(combat.state('hall'), 'idle');
  const hallExitClosed = () => world.raycast(30, 60, -507, 0, 0, -1, 2, 2) < Infinity;
  assert.ok(hallExitClosed());
  walkTo('hall center', 30, -470);
  walkTo('hall encounter', 30, -475);
  assert.equal(combat.state('hall'), 'fighting');
  const opponents = new Set();
  let previousWindup = false;
  for (let i = 0; i < 3600 && combat.state('hall') === 'fighting' && health.strokes > 0; i++) {
    const active = combat.report().filter(enemy => enemy.alive).map(enemy => ({
      ...enemy, distance: Math.hypot(enemy.x - state.x, enemy.z - state.z),
    })).sort((a, b) => a.distance - b.distance);
    for (const enemy of active) opponents.add(enemy.id);
    const target = active[0];
    if (!target) { step(); continue; }
    const windup = active.some(enemy => enemy.kind === 'wraith' && enemy.move === 'overhead' &&
      enemy.frame >= 8.82 && enemy.frame <= 9.1 && enemy.distance < 3);
    step({ ...aim(target.x, target.z, target.distance < 1.6 ? .22 : 1), walk: target.distance < 2.8,
      attack: target.awake && target.distance < 2.7 && !windup && i % 8 === 0, parry: windup && !previousWindup });
    previousWindup = windup;
  }
  assert.equal(combat.state('hall'), 'clear');
  assert.equal(opponents.size, 9);
  assert.equal(cues.filter(cue => cue === 'inkDissolve').length, 9);
  assert.ok(cues.includes('parry') && health.strokes > 0);
  assert.equal(progress.current.flags.ch4_hall, true);
  assert.equal(progress.current.flags.ch4_last_bell, undefined);
  assert.equal(hallExitClosed(), false);
  walkTo('hall center before the opening', 30, -502.5);
  walkTo('dais stair landing', 30, -516.8);
  walkTo('last bell', 30, -517.75, { walk: true });
  step({ attack: true });
  frames(110);
  assert.equal(progress.current.flags.ch4_last_bell, true);
  assert.ok(cues.includes('bell'));
  walkTo('around the bell plinth', 28.7, -518.4, { walk: true });
  walkTo('dais rear', 28.6, -525);
  walkTo('road exit', 30, -539);
  assert.equal(passed.length, 1);
  assert.ok(passed[0].z < -534 && Math.abs(passed[0].y - 61) < 1e-8);
  await progress.completeChapter(chapter => assert.equal(chapter, 'ch5_sea'));
  assert.equal(progress.current.chapter, 'ch5_sea');
});
