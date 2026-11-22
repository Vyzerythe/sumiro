import type { AssetManager } from '../assets/asset-manager.mts';
import { chapterCombat, createEncounterController, type EncounterTicket } from '../combat/encounters.mts';
import { createSwordDuel, type SwordDuelEvent, type SwordDuelInput } from '../combat/sword-duel.mts';
import type { createRunProgress } from '../domain/run-progress.mts';
import type { CollisionWorld } from '../physics/world.mts';
import type { createTraversalController } from '../player/traversal-controller.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { loadSwordWraithPresentation } from './sword-wraith-presentation.mts';

export async function loadChapterTwoDuel(
  assets: AssetManager, lifetime: ChapterLifetime, world: CollisionWorld,
  player: ReturnType<typeof createTraversalController>, progress: ReturnType<typeof createRunProgress>, onEvent: (event: SwordDuelEvent) => void,
  random?: () => number,
) {
  const wraith = await loadSwordWraithPresentation(assets, lifetime);
  let ticket: EncounterTicket | undefined;
  const driver = createSwordDuel(world, { movePlayer: player.moveCombat, manualActivation: true,
    onEvent(event) {
      if (event.type === 'encounter-clear' && ticket) encounter.defeat(ticket);
      onEvent(event);
    }, ...(random ? { random } : {}) });
  const court = chapterCombat[2]?.encounters.find(item => item.id === 'sword_wraith');
  if (!court) throw Error('Chapter Two court encounter is missing');
  const encounter = createEncounterController([court], {
    spawn(_actor, active) {
      ticket = active;
      driver.start(player.state);
      return () => { if (ticket === active) ticket = undefined; };
    },
    hasFlag: flag => Boolean(progress.current.flags[flag]),
    setFlag: flag => { progress.setFlag(flag); },
  });
  lifetime.defer(() => encounter.dispose());
  return {
    root: wraith.root,
    driver,
    step(delta: number, input: SwordDuelInput) {
      if (delta > 0) encounter.step(player.state, input.playing);
      driver.step(delta, player.state, input);
    },
    reset() {
      encounter.reset();
      driver.reset({ cleared: encounter.state(court.id) === 'clear' });
    },
    present(delta: number) {
      wraith.update({ ...driver.enemy, y: driver.enemy.y + driver.enemy.yOffset }, delta);
    },
  };
}
