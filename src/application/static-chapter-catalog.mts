import { Group } from 'three/webgpu';
import type { AssetManager } from '../assets/asset-manager.mts';
import type { CollisionWorld } from '../physics/world.mts';
import type { TraversalLedgeDefinition, TraversalLeapDefinition } from '../player/climbing-controller.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { chapterFiveSceneAssets, createChapterFiveWorld } from './chapter-five-world.mts';
import { createChapterFiveTraversal } from './chapter-five-ledges.mts';
import { chapterFourSceneAssets, createChapterFourWorld } from './chapter-four-world.mts';
import { createChapterFourTraversal } from './chapter-four-ledges.mts';
import { chapterSixSceneAssets, createChapterSixWorld } from './chapter-six-world.mts';
import { createChapterSixTraversal } from './chapter-six-ledges.mts';
import { chapterThreeSceneAssets, createChapterThreeWorld } from './chapter-three-world.mts';
import { createChapterThreeTraversal } from './chapter-three-ledges.mts';
import { createChapterTwoTraversal } from './chapter-two-ledges.mts';
import { loadChapterTwoScene } from './chapter-two-scene.mts';
import { createChapterTwoWorld } from './chapter-two-world.mts';
import { loadInkSceneAsset } from './ink-scene-asset.mts';
import { createLaterChapterInkMaterial, type LaterInkChapter } from './later-chapter-materials.mts';

interface WorldDefinition {
  world: CollisionWorld;
  spawn: Readonly<{ x: number; z: number; heading: number }>;
  killDrop?: number | undefined;
  killY: number;
}

type LoadScene = (assets: AssetManager, resources: ChapterLifetime) => Promise<Group>;

function modelFiles(id: LaterInkChapter, ...paths: string[]): LoadScene {
  return async (assets, resources) => {
    const parts = await Promise.all(paths.map(path => loadInkSceneAsset(assets, path, resources,
      (material, name) => createLaterChapterInkMaterial(material, id, name))));
    resources.signal.throwIfAborted();
    const root = new Group();
    root.name = id;
    root.add(...parts);
    return root;
  };
}

interface ChapterDefinition {
  loadGeometry: LoadScene;
  createWorld(): WorldDefinition;
  createTraversal(world: CollisionWorld): { ledges: readonly TraversalLedgeDefinition[]; leapLinks: readonly TraversalLeapDefinition[] };
}

const staticChapters: Readonly<Record<string, ChapterDefinition>> = {
  ch2_pass: { loadGeometry: loadChapterTwoScene, createWorld: createChapterTwoWorld, createTraversal: createChapterTwoTraversal },
  ch3_pines: { loadGeometry: modelFiles('ch3_pines', chapterThreeSceneAssets.world), createWorld: createChapterThreeWorld,
    createTraversal: createChapterThreeTraversal },
  ch4_temple: { loadGeometry: modelFiles('ch4_temple', chapterFourSceneAssets.temple), createWorld: createChapterFourWorld,
    createTraversal: createChapterFourTraversal },
  ch5_sea: { loadGeometry: modelFiles('ch5_sea', chapterFiveSceneAssets.world), createWorld: createChapterFiveWorld,
    createTraversal: createChapterFiveTraversal },
  ch6_summit: { loadGeometry: modelFiles('ch6_summit', chapterSixSceneAssets.terrain, chapterSixSceneAssets.props,
    chapterSixSceneAssets.far), createWorld: createChapterSixWorld,
    createTraversal: createChapterSixTraversal },
};

export function getStaticChapter(id: string): ChapterDefinition {
  const chapter = Object.hasOwn(staticChapters, id) ? staticChapters[id] : undefined;
  if (!chapter) throw Error(`Native traversal is unavailable for ${id}`);
  return chapter;
}
