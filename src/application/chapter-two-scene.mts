import { Group } from 'three/webgpu';
import { disposeGLTF, type AssetManager } from '../assets/asset-manager.mts';
import { bindInkMeshMaterials } from '../rendering/ink-mesh-materials.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { chapterTwoSceneAssets } from './chapter-two-world.mts';

/** Load the supplied static pass and court. Animated mechanisms have separate owners. */
export async function loadChapterTwoScene(assets: AssetManager, lifetime: ChapterLifetime) {
  const paths = [chapterTwoSceneAssets.pass, chapterTwoSceneAssets.court] as const;
  const [pass, court] = await Promise.all(paths.map(async path => {
    const model = await assets.loadGLTF(path, { displaySpace: false, signal: lifetime.signal });
    lifetime.defer(() => disposeGLTF(model));
    lifetime.signal.throwIfAborted();
    lifetime.defer(bindInkMeshMaterials(model.scene));
    return model.scene;
  }));
  lifetime.signal.throwIfAborted();
  if (!pass || !court) throw Error('Chapter Two requires both the pass and the court');
  pass.traverse(object => { if (object.name.startsWith('crumble')) object.visible = false; });
  for (const name of ['pass_lip', 'pass_lip_dark']) {
    const mesh = pass.getObjectByName(name);
    if (mesh) mesh.visible = false;
  }
  for (const name of ['court_leaf', 'court_blade']) {
    const prop = court.getObjectByName(name);
    if (prop) prop.visible = false;
  }
  const stage = new Group();
  stage.name = 'ch2_pass';
  stage.add(pass, court);
  return stage;
}
