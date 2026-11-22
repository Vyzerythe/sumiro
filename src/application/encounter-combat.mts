import type { Object3D } from 'three/webgpu';
import type { AssetManager } from '../assets/asset-manager.mts';
import { createCrowSwarm } from '../combat/crow-swarm.mts';
import { createEncounterEnemy } from '../combat/encounter-enemy.mts';
import { chapterCombat, createEncounterController, type EncounterState, type EncounterTicket } from '../combat/encounters.mts';
import { createSwordPlayer } from '../combat/sword-player.mts';
import type { SwordDuelInput } from '../combat/sword-duel.mts';
import { chapters } from '../domain/chapters.mts';
import type { createRunProgress } from '../domain/run-progress.mts';
import type { StrokePool } from '../domain/run-vitals.mts';
import {
  chooseArcherTarget, companionMeleeHits, companionProvocationSeconds, resolveCompanionPressure, updateWraithTarget,
  type CompanionRiskFrame, type WraithTargetState, type createCompanionRisk,
} from '../domain/companion-risk.mts';
import type { CollisionWorld } from '../physics/world.mts';
import type { AnimatedPlayer } from '../player/animated-player.mts';
import type { createTraversalController } from '../player/traversal-controller.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { loadEncounterPresentation } from './encounter-presentation.mts';
import { createEncounterProjectiles } from './encounter-projectiles.mts';

interface CombatOptions {
  id: string;
  assets: AssetManager;
  lifetime: ChapterLifetime;
  world: CollisionWorld;
  root: Object3D;
  player: ReturnType<typeof createTraversalController>;
  progress: ReturnType<typeof createRunProgress>;
  health: StrokePool;
  companion?: { frame(): CompanionRiskFrame; risk: ReturnType<typeof createCompanionRisk> };
  duration: AnimatedPlayer['duration'];
  random?: () => number;
  onCue(name: string): void;
  onHint(text: string, milliseconds: number): void;
}

interface ActiveActor {
  enemy: ReturnType<typeof createEncounterEnemy>;
  visual: ReturnType<Awaited<ReturnType<typeof loadEncounterPresentation>>>;
  ticket: EncounterTicket;
  elapsed: number;
  lastClip: string;
  pressure: number;
  threat: WraithTargetState;
}

/** Own one player combat state, an authored wave controller, and the stage's opponents. */
export async function loadEncounterCombat({
  id, assets, lifetime, world, root, progress, health, companion, player, duration, random, onCue, onHint,
}: CombatOptions) {
  const chapterNumber = chapters.findIndex(chapter => chapter.id === id) + 1;
  const definition = chapterCombat[chapterNumber as 1 | 2 | 3 | 4 | 5 | 6];
  if (!definition) return undefined;
  const records = definition.encounters.filter(encounter => encounter.id !== 'sword_wraith');
  const makeVisual = await loadEncounterPresentation(assets, lifetime);
  const actors = new Map<string, ActiveActor>();
  const projectiles = createEncounterProjectiles(world, root);
  const sword = createSwordPlayer({
    duration, health, move: player.moveCombat,
    targets: () => [
      ...[...actors.values()].map(({ enemy }) => ({ ...enemy.state, targetable: enemy.state.alive && enemy.state.awake })),
      ...swarms.map(swarm => ({ ...swarm.state, targetable: !swarm.state.broken && !swarm.state.gone })),
    ],
    strike(target, cut, combo, origin) {
      const actor = actors.get(target.id);
      if (actor) {
        actor.threat.provoked = companionProvocationSeconds;
        const result = actor.enemy.damage({ dmg: cut.dmg, x: origin.x, z: origin.z,
          ...(combo === 'riposte' ? { riposte: true } : { combo }) });
        return result === 'hit' || result === 'dead';
      }
      return swarms.find(swarm => swarm.id === target.id)?.breakIt() ?? false;
    },
    cue: onCue,
  });
  const swarms = (definition.swarms ?? []).map((entry, index) => createCrowSwarm(entry, {
    parent: root, seed: 714025 + index * 3203,
    onContact(hit) { sword.receive(player.state, hit, hit.damage, false); },
    onState(event) {
      if (event.type === 'call') onCue('crowCalls');
      if (event.type === 'broken' && !event.quiet) onCue('wingBurst');
    },
  }));

  function release(id: string) {
    const actor = actors.get(id);
    if (!actor) return;
    actors.delete(id);
    actor.enemy.dispose();
    actor.visual.dispose();
  }

  function visible(from: Readonly<{ x: number; y: number; z: number }>, to: Readonly<{ x: number; y: number; z: number }>, height: number) {
    const y = from.y + 1.4;
    const dx = to.x - from.x, dy = to.y + height - y, dz = to.z - from.z;
    const distance = Math.hypot(dx, dy, dz);
    return distance === 0 || world.raycast(from.x, y, from.z, dx / distance, dy / distance, dz / distance, distance, 3) >= distance;
  }

  function targetFor(actor: ActiveActor, cat: CompanionRiskFrame['position'] | undefined, delta: number) {
    const { enemy, threat, pressure } = actor;
    const pose = enemy.state;
    if (pose.kind === 'ronin') return player.state;
    let hunters = 0;
    for (const other of actors.values()) if (other !== actor && other.enemy.state.alive && other.threat.target === 'cat') hunters++;
    if (pose.kind === 'wraith') {
      actor.threat = updateWraithTarget(threat, { enemy: pose, player: player.state, ...(cat ? { cat } : {}), pressure, hunters }, delta);
    } else {
      actor.threat.target = cat ? chooseArcherTarget({ current: threat.target, enemy: pose, cat,
        playerVisible: visible(pose, player.state, 1.1), catVisible: visible(pose, cat, .22), pressure, hunters }) : 'player';
    }
    return actor.threat.target === 'cat' && cat ? { ...cat, aimHeight: .22 } : player.state;
  }

  const controller = createEncounterController(records, {
    hasFlag: flag => Boolean(progress.current.flags[flag]),
    setFlag: flag => { progress.setFlag(flag); },
    setGate: (gate, open) => world.setGroup(gate.group, !open),
    cue: onCue,
    hint: onHint,
    spawn(entry, ticket) {
      release(entry.id);
      const visual = makeVisual(entry.id, entry.kind);
      try {
        const record = records.find(encounter => encounter.id === ticket.encounter);
        const tempo = record?.tempo ?? definition.tempo;
        const pressure = resolveCompanionPressure(definition.catPressure, record?.catPressure);
        const enemy = createEncounterEnemy(entry, {
          world, tempo, ...(random ? { random } : {}),
          mayAttack: state => state.kind === 'archer' || ![...actors.values()].some(other => other.enemy.state !== state &&
            other.enemy.state.kind !== 'archer' && other.enemy.state.state === 'MOVE'),
          onAttack(attack) {
            if (attack.type === 'melee') {
              const actor = actors.get(entry.id);
              const { origin, heading, reach, arc, dmg, parryable } = attack;
              const playerInArc = companionMeleeHits(origin, heading, reach + .06, arc, player.state);
              const outcome = actor?.threat.target !== 'cat' || playerInArc
                ? sword.receive(player.state, origin, dmg, parryable) : undefined;
              const frame = companion?.frame();
              if (outcome !== 'parried' && frame && companionMeleeHits(origin, heading, reach, arc, frame.position)) {
                if (companion?.risk.damage(frame, dmg, origin)) return 'hit';
              }
              return outcome ?? 'miss';
            }
            projectiles.launch(attack);
          },
          onEvent(event) {
            if (event.type === 'defeated') controller.defeat(ticket);
            else if (event.type === 'dissolved') release(entry.id);
            else if (event.type === 'cue') onCue(event.name);
          },
        });
        root.add(visual.root);
        actors.set(entry.id, { enemy, visual, ticket, elapsed: 0, lastClip: '', pressure,
          threat: { target: 'player', targetTime: 0, provoked: 0 } });
        return () => { if (lifetime.signal.aborted || enemy.state.alive) release(entry.id); };
      } catch (error) {
        visual.dispose();
        throw error;
      }
    },
  });
  lifetime.defer(() => {
    controller.dispose();
    for (const id of actors.keys()) release(id);
    for (const swarm of swarms) swarm.dispose();
    projectiles.dispose();
  });

  return {
    player: sword.state,
    state(encounter: string): EncounterState | undefined { return controller.state(encounter); },
    fighting() { return controller.fighting(); },
    breakSwarm(id: string) { swarms.find(swarm => swarm.id === id)?.breakIt(true); },
    report() { return [...actors.values()].map(({ enemy }) => ({ ...enemy.state })); },
    reset() {
      controller.reset();
      for (const id of actors.keys()) release(id);
      for (const swarm of swarms) swarm.reset();
      projectiles.reset();
      sword.reset();
    },
    step(delta: number, seconds: number, input: SwordDuelInput, enabled: boolean) {
      if (delta <= 0) return;
      controller.step(player.state, enabled);
      if (enabled) sword.step(delta, player.state, input, true);
      else if (sword.state.action !== 'IDLE') sword.reset(sword.state.strokes);
      const down = sword.state.action === 'DEATH';
      const frame = companion?.frame();
      const cat = frame && companion?.risk.targetable(frame) ? frame.position : undefined;
      for (const actor of actors.values()) {
        actor.enemy.step(delta, targetFor(actor, cat, delta), enabled && !down);
        // A dissolved callback can remove the rig during the update.
        const { enemy, visual } = actor;
        if (!actors.has(enemy.state.id)) continue;
        const state = enemy.state;
        if (actor.lastClip !== state.clip) { actor.lastClip = state.clip; actor.elapsed = 0; }
        actor.elapsed += delta * state.clipSpeed;
        const frames = visual.duration(state.clip) * 24;
        const free = actor.elapsed * 24;
        const frame = state.frame ?? (state.state === 'IDLE' || state.state === 'CHASE' ? free % frames : Math.min(free, frames));
        visual.update({ ...state, y: state.y + state.yOffset, frame, visible: true }, delta);
      }
      for (const swarm of swarms) swarm.step(delta, seconds, { ...player.state, down });
      projectiles.step(delta, player.state, attack => { sword.receive(player.state, attack.origin, attack.dmg, attack.parryable); },
        cat && frame && companion ? { position: cat, onStrike(attack) { companion.risk.damage(frame, attack.dmg, attack.origin); } } : undefined);
    },
  };
}
