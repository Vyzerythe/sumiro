import { Group } from 'three/webgpu';
import type { AssetManager } from '../assets/asset-manager.mts';
import type { CollisionWorld } from '../physics/world.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { chapterFiveSceneAssets, createChapterFiveWorld } from './chapter-five-world.mts';
import { chapterFourSceneAssets, createChapterFourWorld } from './chapter-four-world.mts';
import { chapterSixSceneAssets, createChapterSixWorld } from './chapter-six-world.mts';
import { chapterThreeSceneAssets, createChapterThreeWorld } from './chapter-three-world.mts';
import { loadChapterTwoScene } from './chapter-two-scene.mts';
import { createChapterTwoWorld } from './chapter-two-world.mts';
import { loadInkSceneAsset } from './ink-scene-asset.mts';

interface WorldDefinition {
  world: CollisionWorld;
  spawn: Readonly<{ x: number; z: number; heading: number }>;
  killDrop?: number | undefined;
  killY: number;
}

type LoadScene = (assets: AssetManager, resources: ChapterLifetime) => Promise<Group>;

function modelFiles(id: string, ...paths: string[]): LoadScene {
  return async (assets, resources) => {
    const parts = await Promise.all(paths.map(path => loadInkSceneAsset(assets, path, resources)));
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
}

const staticChapters: Readonly<Record<string, ChapterDefinition>> = {
  ch2_pass: { loadGeometry: loadChapterTwoScene, createWorld: createChapterTwoWorld },
  ch3_pines: { loadGeometry: modelFiles('ch3_pines', chapterThreeSceneAssets.world), createWorld: createChapterThreeWorld },
  ch4_temple: { loadGeometry: modelFiles('ch4_temple', chapterFourSceneAssets.temple), createWorld: createChapterFourWorld },
  ch5_sea: { loadGeometry: modelFiles('ch5_sea', chapterFiveSceneAssets.world), createWorld: createChapterFiveWorld },
  ch6_summit: { loadGeometry: modelFiles('ch6_summit', chapterSixSceneAssets.terrain, chapterSixSceneAssets.props,
    chapterSixSceneAssets.far), createWorld: createChapterSixWorld },
};

export function getStaticChapter(id: string): ChapterDefinition {
  const chapter = Object.hasOwn(staticChapters, id) ? staticChapters[id] : undefined;
  if (!chapter) throw Error(`Native traversal is unavailable for ${id}`);
  return chapter;
}
