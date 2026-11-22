import { Group } from 'three/webgpu';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { disposeGLTF, type AssetManager } from '../assets/asset-manager.mts';
import type { CombatActorKind } from '../combat/encounters.mts';
import { createAnimatedPlayer } from '../player/animated-player.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { createInkEnemyPresentation } from './sword-wraith-presentation.mts';

/** Borrow one supplied GLB's meshes for independently animated encounter rigs. */
export async function loadEncounterPresentation(assets: AssetManager, lifetime: ChapterLifetime) {
  const source = await assets.loadGLTF('player/player.glb', { displaySpace: false, signal: lifetime.signal });
  lifetime.defer(() => disposeGLTF(source));
  lifetime.signal.throwIfAborted();
  return (id: string, kind: CombatActorKind) => {
    const root = clone(source.scene);
    if (!(root instanceof Group)) throw Error('The supplied enemy rig must clone to a scene group');
    const actor = createAnimatedPlayer({ ...source, scene: root, scenes: [root] }, { ownsMeshResources: false });
    try {
      const visual = createInkEnemyPresentation(actor, kind);
      visual.root.name = id;
      return visual;
    } catch (error) {
      actor.dispose();
      throw error;
    }
  };
}
