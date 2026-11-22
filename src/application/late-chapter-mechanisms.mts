import { Object3D } from 'three/webgpu';
import type { EncounterState } from '../combat/encounters.mts';
import type { createRunProgress } from '../domain/run-progress.mts';
import type { CollisionWorld } from '../physics/world.mts';
import type { createTraversalController } from '../player/traversal-controller.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { createChapterFiveMechanisms } from './chapter-five-mechanisms.mts';
import { chapterFiveGateSites, createChapterFiveGates } from './chapter-five-gates.mts';
import { mountChapterFiveCurtains } from './chapter-five-curtains.mts';
import { createChapterFourMechanisms } from './chapter-four-mechanisms.mts';
import { bindChapterFourPresentation } from './chapter-four-presentation.mts';
import { bindChapterThreeMechanismPresentation, createChapterThreeMechanisms } from './chapter-three-mechanisms.mts';
import { bindChapterSixMechanismPresentation, createChapterSixMechanisms } from './chapter-six-mechanisms.mts';

type Progress = ReturnType<typeof createRunProgress>;
type Player = ReturnType<typeof createTraversalController>;
type MechanismEvent = { type: 'cue'; name: string } | { type: 'hint'; text: string; ms: number } | { type: 'shake'; strength: number };
interface MechanismEffects {
  onEvent(event: MechanismEvent): void;
  encounterState(id: string): EncounterState | undefined;
  breakSwarm(id: string): void;
}

export interface LateChapterMechanisms {
  reset(): void;
  inkStep?(): void;
  sea?: Readonly<{ level: number; seconds: number; stir: number }>;
  /** Returns true when the mechanism requires the player to respawn. */
  step(frame: { delta: number; player: Player; attack: boolean; interact: boolean; seconds: number; cameraZ: number }): boolean;
}

export function mountLateChapterMechanisms(id: string, world: CollisionWorld, root: Object3D,
  lifetime: ChapterLifetime, progress: Progress, { onEvent, encounterState, breakSwarm }: MechanismEffects,
): LateChapterMechanisms | undefined {
  switch (id) {
    case 'ch3_pines': {
      const driver = createChapterThreeMechanisms(world, { onEvent });
      lifetime.defer(() => driver.dispose());
      const sync = bindChapterThreeMechanismPresentation(root, driver);
      return {
        reset() { driver.reset(); sync(); },
        step({ delta, player }) {
          const { x, y, z, carrier } = player.state;
          player.setDrift(driver.step(delta, { x, y, z, carrier }));
          sync();
          return false;
        },
      };
    }
    case 'ch4_temple': {
      const driver = createChapterFourMechanisms(world, {
        hasFlag: flag => Boolean(progress.current.flags[flag]), setFlag: flag => { progress.setFlag(flag); }, onEvent, encounterState,
      });
      lifetime.defer(() => driver.dispose());
      const sync = bindChapterFourPresentation(root, driver);
      return {
        reset() { driver.enter(progress.current); sync(); },
        step({ delta, player: { state }, attack }) {
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
      const water = new Object3D();
      water.name = 'sea';
      root.add(water);
      let fell = false;
      const driver = createChapterFiveMechanisms(world, {
        onCue: cue => onEvent({ type: 'cue', ...cue }), onFallOut: () => { fell = true; },
      });
      lifetime.defer(() => driver.dispose());
      driver.bind(scene, water);
      const gates = createChapterFiveGates(world, {
        hasFlag: flag => Boolean(progress.current.flags[flag]),
        setFlag: flag => { progress.setFlag(flag); },
        onCue: name => onEvent({ type: 'cue', name }),
        onShake: strength => onEvent({ type: 'shake', strength }),
        breakSwarm,
      });
      lifetime.defer(() => gates.dispose());
      gates.bind(root, { onVeil: mountChapterFiveCurtains(root, lifetime) });
      return {
        get sea() { return { level: driver.tide.y, seconds: driver.presentation.seconds, stir: driver.presentation.stir }; },
        reset() { driver.reset(); gates.reset(); fell = false; },
        inkStep: gates.inkStep,
        step({ delta, player: { state }, attack, interact, seconds, cameraZ }) {
          fell = false;
          driver.step(delta, { player: state, playing: true, seconds });
          const court = encounterState('court');
          gates.step(delta, { player: state, seconds, cameraZ, ...(court ? { court } : {}) });
          const bell = chapterFiveGateSites.bell;
          if ((attack || interact) && state.grounded && Math.abs(state.y - bell.standY) < 1.6 &&
            Math.hypot(state.x - bell.x, state.z - bell.z) < bell.reach) gates.ringBell(attack ? 'strike' : 'interact');
          return fell;
        },
      };
    }
    case 'ch6_summit': {
      const driver = createChapterSixMechanisms(world, {
        hasFlag: flag => Boolean(progress.current.flags[flag]), onEvent, encounterState,
      });
      lifetime.defer(() => driver.dispose());
      const sync = bindChapterSixMechanismPresentation(root, driver);
      return {
        reset() { driver.reset(); sync(); },
        inkStep: driver.inkStep,
        step({ delta, player, attack }) {
          const { state } = player;
          const bell = driver.liftBell.definition;
          if (attack && state.grounded && Math.abs(bell.y - state.y) < 2.1 &&
            Math.hypot(bell.x - state.x, bell.z - state.z) <= bell.r + 0.6) driver.ringLiftBell();
          player.setDrift(driver.step(delta, state));
          sync();
          return false;
        },
      };
    }
    default: return undefined;
  }
}
