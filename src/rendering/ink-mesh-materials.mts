import { Mesh, MeshStandardMaterial, NoBlending, NormalBlending, type Material, type Object3D } from 'three/webgpu';
import { createInkMaterial, type InkMaterialOptions } from './ink-material.mts';

export type InkMaterialFactory = (material: MeshStandardMaterial, meshName: string) => Material;

/** Temporarily bind source-native materials. Restore the imported model before its owner disposes it. */
export function bindInkMeshMaterials(root: Object3D, style?: InkMaterialOptions | InkMaterialFactory) {
  const sources = new Map<Mesh, Material | Material[]>();
  const substitutions = new Map<Material, Map<string, Material>>();

  function replace(source: Material, meshName: string) {
    if (!(source instanceof MeshStandardMaterial) || 'isMeshPhysicalMaterial' in source || source.transparent ||
      !source.depthWrite || !source.colorWrite || (source.blending !== NormalBlending && source.blending !== NoBlending)) return source;
    let variants = substitutions.get(source);
    if (!variants) substitutions.set(source, variants = new Map());
    const key = typeof style === 'function' ? meshName : '';
    let replacement = variants.get(key);
    if (!replacement) {
      replacement = typeof style === 'function' ? style(source, meshName) : createInkMaterial(source, style);
      variants.set(key, replacement);
    }
    return replacement;
  }

  function release() {
    for (const [mesh, original] of sources) mesh.material = original;
    sources.clear();
    for (const [source, variants] of substitutions) {
      for (const material of new Set(variants.values())) if (material !== source) material.dispose();
    }
    substitutions.clear();
  }

  try {
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const original = object.material;
      sources.set(object, original);
      object.material = Array.isArray(original)
        ? original.map(material => replace(material, object.name)) : replace(original, object.name);
    });
  } catch (error) {
    release();
    throw error;
  }
  return release;
}
