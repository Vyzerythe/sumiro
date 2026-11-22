import { disposeGLTF, type AssetManager } from '../assets/asset-manager.mts';
import { bindInkMeshMaterials } from '../rendering/ink-mesh-materials.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';

export async function loadInkSceneAsset(assets: AssetManager, path: string, lifetime: ChapterLifetime) {
  const model = await assets.loadGLTF(path, { displaySpace: false, signal: lifetime.signal });
  lifetime.defer(() => disposeGLTF(model));
  lifetime.signal.throwIfAborted();
  lifetime.defer(bindInkMeshMaterials(model.scene));
  return model.scene;
}
