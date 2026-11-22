import type { AssetManager } from '../assets/asset-manager.mts';
import { installGroundAsset } from '../physics/ground-asset.mts';
import { createCollisionWorld } from '../physics/world.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { installChapterOneObstacles } from './chapter-one-obstacles.mts';
import { chapterOneGroundRegions } from './chapter-one-terrain.mts';
import { createCollisionSurfacePreview } from './collision-surface-preview.mts';

export async function loadChapterOneTraversalScene(assets: AssetManager, lifetime: ChapterLifetime) {
  const bytes = await assets.loadArrayBuffer('levels/ch1_climb/ground.bin', { signal: lifetime.signal });
  lifetime.signal.throwIfAborted();
  const world = createCollisionWorld();
  const ground = installGroundAsset(world, bytes, chapterOneGroundRegions);
  installChapterOneObstacles(world, ground);
  const root = createCollisionSurfacePreview(world, lifetime);
  root.name = 'ch1_climb';
  return { world, root };
}
