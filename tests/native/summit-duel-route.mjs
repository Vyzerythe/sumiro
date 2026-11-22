import assert from 'node:assert/strict';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';

// The short parry window spans the end of windup and start of the hit beat.
function canTimeParry({ state, move, clip, frame }) {
  if (state !== 'MOVE') return false;
  if (clip === 'attack_1') return move === 'iai' ? frame > 4.4 && frame < 5.65 : frame > 4.7 && frame < 5.55;
  if (clip === 'attack_2') return frame > 3.8 && frame < 4.55;
  return clip === 'attack_3' && move !== 'leapfall' && move !== 'wave' && frame > 8.7 && frame < 9.55;
}

/**
 * Drive a fresh arena_door save through the earned duel clear and reunion.
 * createRuntime accepts traversal-preview option overrides. The optional frame
 * inspector receives the still-mounted runtime for reunion and finale rendering.
 */
export async function verifySummitDuelRoute({ createRuntime, keyboardTarget, progress, savedRun, inspectFrame }) {
  assert.equal(progress.current.chapter, 'ch6_summit');
  assert.equal(progress.current.shrine, 'arena_door');
  assert.equal(progress.current.abilities.sword, true);
  assert.equal(progress.current.abilities.inkStep, true);
  assert.equal(progress.current.flags.ch6_duel, undefined);
  assert.equal(progress.current.flags.finished, undefined);
  assert.equal(savedRun(), undefined);

  const pad = { axes: [0, 0], buttons: [] };
  const runtime = await createRuntime({ progress, random: () => 0.3, input: { keyboardTarget, getGamepads: () => [pad] } });
  try {
    const { registry, scene } = runtime.context;
    const feet = () => registry.get('player.position');
    const combat = () => registry.get('combat.encounters');
    const ronin = () => combat()?.actors.find(actor => actor.id === 'ronin');
    const story = () => registry.get('story.scene');
    const vitals = () => registry.get('game.vitals');
    const tick = () => runtime.context.time.step;
    const snapshot = () => JSON.stringify({ step: tick(), feet: feet(), camera: registry.get('camera.zone'),
      vitals: vitals(), combat: combat(), story: story(), flags: progress.current.flags });
    const tap = code => {
      keyboardTarget.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: false }));
      keyboardTarget.dispatchEvent(Object.assign(new Event('keyup'), { code, repeat: false }));
    };

    function aim(x, z, stopRadius) {
      const at = feet();
      const dx = x - at.x, dz = z - at.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= stopRadius) {
        pad.axes.fill(0);
        return distance;
      }
      const yaw = registry.get('camera.steeringYaw') * Math.PI / 180;
      const gain = distance > stopRadius + 1.25 ? 1 : distance > stopRadius + 0.5 ? 0.66 : 0.32;
      pad.axes[0] = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / distance * gain;
      pad.axes[1] = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / distance * gain;
      return distance;
    }

    function reach(x, z, radius, maxSteps, stop = () => false) {
      for (let step = 0; step < maxSteps; step++) {
        if (stop() || aim(x, z, radius) <= radius) return;
        runtime.step();
      }
      assert.fail(`Could not reach (${x}, ${z}): ${snapshot()}`);
    }

    const restored = feet();
    assert.deepEqual([restored.x, restored.y, restored.z, restored.grounded], [-216.5, 86.4, -345, true]);
    assert.equal(registry.get('camera.zone'), 'z_a11b');
    reach(-219, -350, 0.6, 200);
    reach(-236, -350, 0.5, 400, () => Boolean(ronin()));
    const triggerStep = tick();
    const entrance = ronin();
    assert.ok(entrance, snapshot());
    assert.deepEqual([entrance.x, entrance.y, entrance.z, entrance.hp, entrance.phase, entrance.state], [-251, 86.4, -350, 52, 1, 'RISE']);
    assert.equal(registry.get('camera.zone'), 'z_duel');

    let parries = 0, ripostes = 0;
    const phases = [];
    const recovered = new Set();
    const inkSteps = [];
    let evade;
    const stopCues = registry.on('combat.cue', cue => { if (cue === 'parry') parries++; });
    try {
      for (let step = 0; step < 6000 && !progress.current.flags.ch6_duel; step++) {
        const { player } = combat();
        const enemy = ronin();
        const at = feet();
        assert.ok(enemy && player.action !== 'DEATH', snapshot());
        if (phases.at(-1)?.phase !== enemy.phase) {
          phases.push({ phase: enemy.phase, hp: enemy.hp, state: enemy.state, immune: enemy.immune, step: tick() });
        }
        if (!enemy.immune) recovered.add(enemy.phase);

        const distance = aim(enemy.x, enemy.z, 1.35);
        const { state, move, clip, frame } = enemy;
        const unblockable = state === 'MOVE' && (move === 'leapfall' || move === 'wave');
        const evadeWindow = unblockable && clip === 'attack_3' &&
          frame >= (move === 'leapfall' ? 6 : 8.5) && frame < (move === 'leapfall' ? 12 : 16);

        if (evadeWindow) {
          if (!evade) {
            // Keep moving laterally once the slam's landing point or wave's aim is fixed.
            const dx = at.x - enemy.x, dz = at.z - enemy.z;
            const norm = Math.hypot(dx, dz) || 1;
            const towardCenter = (at.x + 243) * dz - (at.z + 350) * dx > 0 ? -1 : 1;
            evade = { x: at.x + dz / norm * towardCenter * 6, z: at.z - dx / norm * towardCenter * 6, sent: false };
          }
          aim(evade.x, evade.z, 0.3);
          if (!evade.sent && player.action === 'IDLE' && at.state !== 'DODGE') {
            tap('ShiftLeft');
            evade.sent = true;
          }
        } else if (distance < 3.3 && canTimeParry(enemy) && (player.action !== 'PARRY' || player.elapsed > 0.26)) {
          tap('KeyK');
        } else if (distance < 2.65 && step % 6 === 0 && enemy.awake && !enemy.immune && (!unblockable || enemy.opening)) {
          tap('KeyJ');
        }
        if (!unblockable || enemy.opening) evade = undefined;

        runtime.step();
        if (feet().state === 'DODGE' && at.state !== 'DODGE') inkSteps.push({ move, step: tick() });
        if (combat().player.combo === 'riposte' && player.combo !== 'riposte') ripostes++;
      }
    } finally { stopCues(); }

    const clearStep = tick();
    assert.equal(ronin()?.state, 'DEAD', snapshot());
    assert.equal(ronin().hp, 0);
    assert.equal(vitals().strokes, 5);
    assert.deepEqual(phases.map(({ phase, hp, state, immune }) => [phase, hp, state, immune]), [
      [1, 52, 'RISE', true], [2, 2 * 52 / 3, 'BREATH_STEP', true], [3, 52 / 3, 'BREATH_STEP', true],
    ]);
    assert.deepEqual([...recovered], [1, 2, 3]);
    assert.ok(parries > 0 && ripostes > 0 && inkSteps.some(({ move }) => move === 'leapfall'));
    assert.equal(progress.current.flags.ch6_duel, true);
    assert.equal(savedRun()?.flags.ch6_duel, true);
    assert.equal(progress.current.flags.finished, undefined);

    reach(-286, -350, 0.7, 1200, () => Boolean(story()));
    const reunion = feet();
    const reunionStep = tick();
    assert.equal(story(), 'reunion', snapshot());
    assert.ok(scene.getObjectByName('family0')?.visible);
    pad.axes.fill(0);
    for (let step = 0; step < 45; step++) runtime.step();
    await inspectFrame?.(runtime, 'reunion');
    tap('Enter');
    runtime.step();
    assert.equal(story(), null);
    assert.ok(feet().grounded && feet().x < -288, snapshot());

    let haiku;
    const stopHaiku = runtime.onInteraction(event => {
      if (event.type === 'hint' && event.text.startsWith('The last stroke')) haiku = event.text;
    });
    try {
      for (let step = 0; step < 145; step++) runtime.step();
    } finally { stopHaiku(); }
    const sun = scene.getObjectByName('ink_sun');
    assert.ok(sun?.visible && sun.position.y > 124);
    assert.equal(haiku, 'The last stroke lifted\nonly the red sun still wet\non the empty page');
    await inspectFrame?.(runtime, 'finale');
    for (let step = 0; step < 680 && !progress.current.flags.finished; step++) runtime.step();
    await yieldEventLoop();
    assert.equal(registry.get('companion.state').phase, 'REUNITED');
    assert.equal(savedRun()?.flags.finished, true);
    assert.equal(registry.get('game.completed'), true);
    assert.equal(runtime.context.paused, true);
    return { restored, triggerStep, phases, parries, ripostes, inkSteps, clearStep, reunion, reunionStep,
      finished: savedRun().flags.finished, sun: sun.position.y, haiku };
  } finally {
    await runtime.dispose();
  }
}
