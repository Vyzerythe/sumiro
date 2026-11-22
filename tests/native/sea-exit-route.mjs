import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Drive the native Sea from the before_gate save through the actual Summit load.
 * createRuntime receives traversal-preview option overrides; savedRun returns
 * the last parsed storage write or undefined before the first write.
 */
export async function verifySeaExitRoute({ createRuntime, keyboardTarget, progress, savedRun }) {
  assert.equal(progress.current.chapter, 'ch5_sea');
  assert.equal(progress.current.shrine, 'before_gate');
  assert.equal(progress.current.abilities.inkStep, true);
  assert.equal(progress.current.abilities.sword, true);
  assert.equal(progress.current.flags.ch5_last_rock, undefined);
  assert.equal(savedRun(), undefined);

  const pad = { axes: [0, 0], buttons: [] };
  const runtime = await createRuntime({ progress, random: () => 0.3, input: { keyboardTarget, getGamepads: () => [pad] } });
  try {
    const { registry, scene } = runtime.context;
    const seaRoot = scene.getObjectByName('ch5_sea');
    const water = seaRoot?.getObjectByName('sea');
    assert.ok(water);
    const feet = () => registry.get('player.position');
    const encounter = () => registry.get('combat.encounters');
    const snapshot = () => JSON.stringify({ feet: feet(), tide: water.position.y,
      camera: registry.get('camera.zone'), combat: encounter(), chapter: progress.current.chapter });
    const tick = () => runtime.context.time.step;
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

    function reach(x, z, radius, maxSteps) {
      for (let step = 0; step < maxSteps; step++) {
        if (aim(x, z, radius) <= radius) return;
        runtime.step();
      }
      assert.fail(`Could not reach (${x}, ${z}): ${snapshot()}`);
    }

    const restored = feet();
    assert.deepEqual([restored.x, restored.y, restored.z, restored.grounded], [186.9, 3.6, -532.6, true]);
    assert.equal(registry.get('camera.zone'), 'gw');
    reach(191.5, -536, 0.35, 120);
    reach(191.5, -556.35, 0.25, 260);
    for (let step = 0; step < 25; step++) {
      aim(191.5, -575, 0.1);
      runtime.step();
    }
    const gate = feet();
    const gateStep = tick();
    assert.deepEqual([gate.y, gate.z, gate.grounded, water.position.y], [0.35, -556.7, true, 0],
      'ordinary input must stop one capsule radius before the veil at low tide');
    assert.equal(registry.get('camera.zone'), 'gate');
    tap('ShiftLeft');
    runtime.step();
    assert.equal(feet().state, 'DODGE');
    for (let step = 0; step < 12 && feet().z > -557.3; step++) {
      aim(191.5, -581, 0.6);
      runtime.step();
    }
    const veilCrossing = feet();
    assert.ok(veilCrossing.z <= -557.3 && veilCrossing.state === 'DODGE', snapshot());
    reach(191.5, -581, 0.6, 300);
    const lastRock = feet();
    const lastRockStep = tick();
    assert.ok(lastRock.grounded && lastRock.z < -578 && lastRock.z > -586, snapshot());
    assert.equal(registry.get('camera.zone'), 'end');
    const living = () => encounter().actors.filter(actor => actor.alive);
    const placements = actors => actors.map(({ kind, x, z }) => [kind, x, z]);
    assert.deepEqual(placements(living()), [['wraith', 186, -592], ['wraith', 197, -592]]);

    const defeats = [];
    const defeatedIds = new Set();
    let secondWave = false;
    let heldExit = false;
    const inExit = ({ x, z, grounded }) => grounded && x > 182 && x < 201 && z < -597 && z > -604;
    for (let step = 0; step < 4800 && !progress.current.flags.ch5_last_rock; step++) {
      const at = feet();
      const { player } = encounter();
      const separation = actor => Math.hypot(actor.x - at.x, actor.z - at.z);
      const enemy = living().sort((a, b) => separation(a) - separation(b))[0];
      assert.ok(enemy && player.action !== 'DEATH', snapshot());
      const distance = aim(enemy.x, enemy.z, 1.35);
      const keyframes = enemy.move === 'overhead' ? [8.4, 9.4] : [4.3, 5.1];
      if (distance < 2.6 && enemy.state === 'MOVE' && enemy.frame > keyframes[0] && enemy.frame < keyframes[1] &&
          (player.action !== 'PARRY' || player.elapsed > 0.26)) tap('KeyK');
      else if (distance < 2.65 && step % 6 === 0 && enemy.awake) tap('KeyJ');
      runtime.step();

      for (const actor of encounter().actors) {
        if (actor.alive || defeatedIds.has(actor.id)) continue;
        defeatedIds.add(actor.id);
        defeats.push({ kind: actor.kind, step: tick() });
      }
      if (defeats.length === 2 && !secondWave) {
        assert.deepEqual(placements(living()), [['wraith', 185, -596], ['wraith', 198, -596], ['archer', 191.5, -600.5]]);
        secondWave = true;
      }
      if (!progress.current.flags.ch5_last_rock && inExit(feet())) {
        heldExit = true;
        assert.equal(progress.current.chapter, 'ch5_sea');
        assert.equal(savedRun(), undefined);
      }
    }

    const exit = feet();
    const exitStep = tick();
    const remainingStrokes = registry.get('game.vitals').strokes;
    assert.equal(secondWave, true);
    assert.equal(heldExit, true, 'standing in the exit while the encounter is live must keep the chapter active');
    assert.deepEqual(defeats.map(({ kind }) => kind), ['wraith', 'wraith', 'wraith', 'wraith', 'archer']);
    assert.equal(progress.current.flags.ch5_last_rock, true, snapshot());
    assert.ok(inExit(exit), snapshot());
    assert.equal(savedRun()?.chapter, 'ch5_sea');
    assert.equal(savedRun()?.flags.ch5_last_rock, true);
    const deadline = performance.now() + 15_000;
    pad.axes.fill(0);
    while (progress.current.chapter === 'ch5_sea' && performance.now() < deadline) {
      runtime.step();
      await delay(20);
    }
    runtime.step();
    const arrival = feet();
    assert.equal(progress.current.chapter, 'ch6_summit', snapshot());
    assert.equal(registry.get('chapter.current'), 'ch6_summit');
    assert.equal(seaRoot.parent, null);
    assert.ok(scene.getObjectByName('ch6_summit')?.parent);
    assert.deepEqual([arrival.x, arrival.y, arrival.z, arrival.grounded], [29, 10, -50, true]);
    assert.equal(savedRun()?.chapter, 'ch6_summit');
    assert.equal(savedRun()?.flags.ch5_last_rock, true);
    return { restored, gate, gateStep, veilCrossing, lastRock, lastRockStep, defeats, exit, exitStep, remainingStrokes, arrival };
  } finally {
    await runtime.dispose();
  }
}
