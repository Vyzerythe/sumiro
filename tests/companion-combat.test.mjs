import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { AnimationClip, Group } from 'three/webgpu';
import { createChapterThreeWorld } from '../src/application/chapter-three-world.mts';
import { loadEncounterCombat } from '../src/application/encounter-combat.mts';
import { createEncounterProjectiles } from '../src/application/encounter-projectiles.mts';
import { createCompanionRisk } from '../src/domain/companion-risk.mts';
import { createRunProgress } from '../src/domain/run-progress.mts';
import { createRunVitals } from '../src/domain/run-vitals.mts';
import { createDefaultRun } from '../src/domain/save.mts';
import { createCollisionWorld } from '../src/physics/world.mts';
import { createTraversalController } from '../src/player/traversal-controller.mts';

const model = await readFile(new URL('../sumiro/assets/player/player.glb', import.meta.url));
const gltf = JSON.parse(model.toString('utf8', 20, 20 + model.readUInt32LE(12)));
const clips = gltf.animations.map(clip => new AnimationClip(clip.name,
  Math.max(...clip.samplers.map(sampler => gltf.accessors[sampler.input].max[0])), []));

test('an authored Pines wraith can harm the uncarried cat while carried companionship is immune', async () => {
  async function replay(phase) {
    const { world } = createChapterThreeWorld();
    const root = new Group();
    const player = createTraversalController(world, { x: -15, z: -197, heading: 0 });
    const progress = createRunProgress({ getItem: () => JSON.stringify({ ...createDefaultRun(), chapter: 'ch3_pines' }) });
    const catRisk = createCompanionRisk();
    const health = createRunVitals();
    const owned = [];
    const lifetime = new AbortController();
    const position = { x: -18.6, y: world.groundAt(-18.6, -200.2).y, z: -200.2 };
    const frame = () => ({ phase, position, found: true, playing: true, fighting: true,
      player: { x: player.state.x, y: player.state.y, z: player.state.z, alive: health.strokes > 0 } });
    const combat = await loadEncounterCombat({
      id: 'ch3_pines', world, root, player, progress, health, companion: { frame, risk: catRisk },
      lifetime: { signal: lifetime.signal, defer: release => owned.push(release) },
      duration: () => 1, random: () => .3, onCue() {}, onHint() {},
      assets: { async loadGLTF() {
        const scene = new Group();
        return { scene, scenes: [scene], animations: clips };
      } },
    });
    try {
      for (let step = 0; step < 600 && catRisk.health === catRisk.maxHealth; step++) {
        catRisk.step(1 / 60, frame());
        combat.step(1 / 60, step / 60, {}, true);
      }
      assert.ok(combat.report().length >= 1);
      return catRisk.health;
    } finally {
      lifetime.abort();
      for (const dispose of owned.reverse()) dispose();
    }
  }
  assert.equal(await replay('IDLE'), 9);
  assert.equal(await replay('CARRIED'), 10);
});

test('arrows can strike a companion before the player and cannot pass through an occluder', () => {
  const world = createCollisionWorld();
  const root = new Group();
  const shots = createEncounterProjectiles(world, root);
  const launch = () => shots.launch({ type: 'arrow', origin: { x: 0, y: .2, z: 0 },
    target: { x: 5, y: .2, z: 0 }, speed: 15, dmg: 1, parryable: true });
  const player = { x: 3.5, y: 0, z: 0 };
  const cat = { x: 1.2, y: 0, z: 0 };
  let hits = 0;
  function tick() {
    shots.step(.2, player, () => assert.fail('the distant player should not be struck'),
      { position: cat, onStrike() { hits++; } });
  }
  try {
    launch();
    tick();
    assert.equal(hits, 1);
    assert.equal(root.children.length, 0);
    world.addTriangles([.5, -1, -1, .5, 1, 1, .5, 1, -1], { kind: 2 });
    launch();
    tick();
    assert.equal(hits, 1);
    assert.equal(root.children.length, 0);
  } finally { shots.dispose(); }
});
