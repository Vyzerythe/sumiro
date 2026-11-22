import type { Object3D } from 'three/webgpu';
import type { createRunProgress } from '../domain/run-progress.mts';
import type { CollisionWorld } from '../physics/world.mts';
import type { createTraversalController } from '../player/traversal-controller.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { createChapterFiveMechanisms } from './chapter-five-mechanisms.mts';
import { createChapterFiveWater } from './chapter-five-water.mts';
import { createChapterFourMechanisms } from './chapter-four-mechanisms.mts';
import { bindChapterFourPresentation } from './chapter-four-presentation.mts';
import { bindChapterThreeMechanismPresentation, createChapterThreeMechanisms } from './chapter-three-mechanisms.mts';

type Progress = ReturnType<typeof createRunProgress>;
type Player = ReturnType<typeof createTraversalController>;
type MechanismEvent = { type: 'cue'; name: string } | { type: 'hint'; text: string; ms: number } | { type: 'shake'; strength: number };

export interface LateChapterMechanisms {
  reset(): void;
  /** Returns true when the mechanism requires the player to respawn. */
  step(delta: number, player: Player, attack: boolean, seconds: number): boolean;
}

export function mountLateChapterMechanisms(id: string, world: CollisionWorld, root: Object3D,
  lifetime: ChapterLifetime, progress: Progress, onEvent: (event: MechanismEvent) => void,
): LateChapterMechanisms | undefined {
  switch (id) {
    case 'ch3_pines': {
      const driver = createChapterThreeMechanisms(world, { onEvent });
      lifetime.defer(() => driver.dispose());
      const sync = bindChapterThreeMechanismPresentation(root, driver);
      return {
        reset() { driver.reset(); sync(); },
        step(delta, player) {
          const { x, y, z, carrier } = player.state;
          player.setDrift(driver.step(delta, { x, y, z, carrier }));
          sync();
          return false;
        },
      };
    }
    case 'ch4_temple': {
      const driver = createChapterFourMechanisms(world, {
        hasFlag: flag => Boolean(progress.current.flags[flag]), setFlag: flag => { progress.setFlag(flag); }, onEvent,
      });
      lifetime.defer(() => driver.dispose());
      const sync = bindChapterFourPresentation(root, driver);
      return {
        reset() { driver.enter(progress.current); sync(); },
        step(delta, { state }, attack) {
          if (attack && state.grounded) {
            const bell = driver.bells.find(target => Math.abs(target.y - state.y) < 2.1 &&
              Math.hypot(target.x - state.x, target.z - state.z) <= target.r + 0.6);
            if (bell) driver.ringBell(bell.id);
          }
          driver.step(delta, state);
          sync();
          return false;
        },
      };
    }
    case 'ch5_sea': {
      const scene = root.children[0];
      if (!scene) throw Error('The supplied Sea scene is missing');
      const water = createChapterFiveWater(lifetime);
      root.add(water.node);
      let fell = false;
      const driver = createChapterFiveMechanisms(world, {
        onCue: cue => onEvent({ type: 'cue', ...cue }), onFallOut: () => { fell = true; },
      });
      lifetime.defer(() => driver.dispose());
      driver.bind(scene, water.node);
      return {
        reset() { driver.reset(); fell = false; },
        step(delta, { state }, _attack, seconds) {
          fell = false;
          driver.step(delta, { player: state, playing: true, seconds });
          water.update(driver.presentation.seconds, driver.presentation.stir);
          return fell;
        },
      };
    }
    default: return undefined;
  }
}
