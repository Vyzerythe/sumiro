import { Mesh, MeshStandardMaterial, NoBlending, NormalBlending, type Material, type Object3D } from 'three/webgpu';
import { createInkMaterial, type InkMaterialOptions } from './ink-material.mts';

/** Temporarily bind source-native materials. Restore the imported model before its owner disposes it. */
export function bindInkMeshMaterials(root: Object3D, options?: InkMaterialOptions) {
  const sources = new Map<Mesh, Material | Material[]>();
  const substitutions = new Map<Material, Material>();

  function replace(source: Material) {
    if (!(source instanceof MeshStandardMaterial) || 'isMeshPhysicalMaterial' in source || source.transparent ||
      !source.depthWrite || !source.colorWrite || (source.blending !== NormalBlending && source.blending !== NoBlending)) return source;
    let replacement = substitutions.get(source);
    if (!replacement) {
      replacement = createInkMaterial(source, options);
      substitutions.set(source, replacement);
    }
    return replacement;
  }

  function release() {
    for (const [mesh, original] of sources) mesh.material = original;
    sources.clear();
    for (const material of substitutions.values()) material.dispose();
    substitutions.clear();
  }

  try {
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const original = object.material;
      sources.set(object, original);
      object.material = Array.isArray(original) ? original.map(replace) : replace(original);
    });
  } catch (error) {
    release();
    throw error;
  }
  return release;
}
