import type { CollisionWorld } from '../physics/world.mts';
import type { createRunProgress } from '../domain/run-progress.mts';
import type { createTraversalController } from '../player/traversal-controller.mts';

export interface GroundedSpawn {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

interface Checkpoint extends GroundedSpawn {
  readonly id: string;
  readonly stand: GroundedSpawn;
}

function shrine(id: string, x: number, z: number, heading: number, standX: number, standZ: number, standHeading: number): Checkpoint {
  return { id, x, z, heading, stand: { x: standX, z: standZ, heading: standHeading } };
}

/** Authored shrine and standing locations from the six published chapter definitions. */
export const chapterCheckpoints: Readonly<Record<string, readonly Checkpoint[]>> = {
  ch1_climb: [shrine('table', 9.2, -40.5, 0.4, 9.6, -41.5, 1), shrine('plateau', 15.4, -55.6, 2.2, 14.6, -56.6, -0.2)],
  ch2_pass: [
    shrine('court', 8, -18.6, 0.9, 9.5, -17.6, 0), shrine('first_holds', 25.5, -107.5, 2.2, 26.6, -106.4, -1),
    shrine('above_the_stair', 63.5, -205, -0.6, 62.3, -204.2, 0.9), shrine('ridge', 42.6, -216.6, 2.4, 41.4, -217.6, 1.6),
    shrine('past_the_gaps', -50, -214, -2.2, -49, -215.2, 2.8), shrine('on_the_tooth', 37.5, -259.5, 0.5, 36.5, -258.4, 0),
  ],
  ch3_pines: [
    shrine('pines_1', -11, -201, 2.2, -11, -197.6, 1.57), shrine('pines_2', -119, -201.8, 2.2, -119, -198.4, 1.57),
    shrine('pines_far', -198.4, -212.2, 2.2, -198.4, -209.4, 1.57),
    shrine('pines_3', -285.4, -209.5, 2.2, -285.4, -205.8, 1.57),
    shrine('pines_4', -387.59999999999997, -210.6, 2.2, -387.59999999999997, -206.8, 1.57),
  ],
  ch4_temple: [
    shrine('fore', 21, -150, 0.6, 23, -148, 0), shrine('far', 84, -262, -0.6, 82, -259, 0),
    shrine('p6', 71, -306, 0.5, 73, -304, 0), shrine('f8', 36, -400, -0.5, 33.5, -398, 0),
    shrine('hall', 21.6, -455.4, 0.5, 23.8, -457.2, 0),
  ],
  ch5_sea: [
    shrine('first_rock', 26.5, -131, 0.9, 27.4, -130.1, 0), shrine('raft_top', 26, -231, 0.6, 26.9, -230.1, 0),
    shrine('after_veils', 80, -392, 0.6, 80.9, -391.1, -1.5), shrine('before_court', 118.5, -474, 0.6, 119.4, -473.1, 0),
    shrine('before_gate', 186, -533.5, 0.6, 186.9, -532.6, 0),
  ],
  ch6_summit: [
    shrine('snow_line', 22.5, -61, 0.4, 24.4, -59.6, 0), shrine('spine_end', 35.5, -271, -0.6, 33.4, -270, 0),
    shrine('veil_rest', -76, -318, 1.2, -77.4, -320, 1.57), shrine('arena_door', -218, -343, 0.8, -216.5, -345, 1.57),
  ],
};

export function getChapterCheckpoints(id: string): readonly Checkpoint[] {
  return Object.hasOwn(chapterCheckpoints, id) ? chapterCheckpoints[id]! : [];
}

export function resolveChapterSpawn(
  id: string, fallback: GroundedSpawn, save: Readonly<{ chapter: string; shrine: unknown }> | undefined,
  world?: Pick<CollisionWorld, 'groundAt'>,
) {
  const saved = save?.chapter === id ? getChapterCheckpoints(id).find(shrine => shrine.id === save.shrine)?.stand : undefined;
  return saved && (!world || world.groundAt(saved.x, saved.z)) ? saved : fallback;
}

type RunProgress = ReturnType<typeof createRunProgress>;
type PlayerState = ReturnType<typeof createTraversalController>['state'];
const REST_STANCES = new Set(['IDLE', 'WALK', 'RUN', 'SPRINT', 'LAND', 'TEETER']);

/** Resolve shrine input for chapters that do not own a more specific interaction driver. */
export function createCheckpointInteraction(id: string, world: Pick<CollisionWorld, 'groundAt'>, progress: RunProgress) {
  const sites = getChapterCheckpoints(id).map(shrine => ({ ...shrine, y: world.groundAt(shrine.x, shrine.z)?.y ?? -Infinity }));
  let rested: Checkpoint | undefined;
  return {
    update(feet: PlayerState, pressed: boolean, fighting: boolean): string | null {
      if (rested && Math.hypot(feet.x - rested.x, feet.z - rested.z) >= 2.5) rested = undefined;
      if (!feet.grounded || !REST_STANCES.has(feet.state) || !pressed || fighting) return null;
      let best: Checkpoint | undefined;
      let nearest = 1.9;
      for (const site of sites) {
        if (rested === site || Math.abs(feet.y - site.y) > 1.6) continue;
        const distance = Math.hypot(feet.x - site.x, feet.z - site.z);
        if (distance < nearest) { best = site; nearest = distance; }
      }
      if (!best) return null;
      progress.checkpoint(best.id);
      rested = best;
      return best.id;
    },
  };
}
