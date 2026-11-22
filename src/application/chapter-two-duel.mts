import type { AssetManager } from '../assets/asset-manager.mts';
import { createSwordDuel, type SwordDuelEvent } from '../combat/sword-duel.mts';
import type { CollisionWorld } from '../physics/world.mts';
import type { createTraversalController } from '../player/traversal-controller.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { loadSwordWraithPresentation } from './sword-wraith-presentation.mts';

export async function loadChapterTwoDuel(
  assets: AssetManager, lifetime: ChapterLifetime, world: CollisionWorld,
  player: ReturnType<typeof createTraversalController>, onEvent: (event: SwordDuelEvent) => void,
  random?: () => number,
) {
  const wraith = await loadSwordWraithPresentation(assets, lifetime);
  const driver = createSwordDuel(world, { movePlayer: player.moveCombat, onEvent, ...(random ? { random } : {}) });
  return {
    root: wraith.root,
    driver,
    present(delta: number) {
      wraith.update({ ...driver.enemy, y: driver.enemy.y + driver.enemy.yOffset }, delta);
    },
  };
}
