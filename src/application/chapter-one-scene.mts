import type { AssetManager } from '../assets/asset-manager.mts';
import { installGroundAsset } from '../physics/ground-asset.mts';
import { createCollisionWorld } from '../physics/world.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { loadChapterOneEnvironment } from './chapter-one-environment.mts';
import { installChapterOneObstacles } from './chapter-one-obstacles.mts';
import { chapterOneGroundRegions } from './chapter-one-terrain.mts';

export async function loadChapterOneTraversalScene(assets: AssetManager, lifetime: ChapterLifetime) {
  const [bytes, environment] = await Promise.all([
    assets.loadArrayBuffer('levels/ch1_climb/ground.bin', { signal: lifetime.signal }),
    loadChapterOneEnvironment(assets, lifetime),
  ]);
  lifetime.signal.throwIfAborted();
  const world = createCollisionWorld();
  const ground = installGroundAsset(world, bytes, chapterOneGroundRegions);
  installChapterOneObstacles(world, ground);
  const { root } = environment;
  root.name = 'ch1_climb';
  return { world, root, updateEnvironment: environment.update };
}
