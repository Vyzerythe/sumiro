/** Visual assembly from the published cliff, bridge/stairs, plateau, gate and course systems. */
import { BufferAttribute, ClampToEdgeWrapping, DoubleSide, Group, Mesh, MeshBasicMaterial,
  NoColorSpace, Raycaster, Texture, Vector3, type Material, type Node, type Object3D } from 'three/webgpu';
import { clamp, texture, vec4 } from 'three/tsl';
import { disposeGLTF, type AssetManager } from '../assets/asset-manager.mts';
import { createInkMaterial, type InkMaterialOptions } from '../rendering/ink-material.mts';
import { bindInkMeshMaterials } from '../rendering/ink-mesh-materials.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';

export const chapterOneEnvironmentAssets = {
  cliff: ['env_cliff/wall.glb', 'env_cliff/path.glb', 'env_cliff/lobes.glb', 'env_cliff/rocks.glb'],
  crossing: ['env_bridge_stairs/bridge.glb', 'env_bridge_stairs/stairs.glb', 'env_bridge_stairs/slab.glb'],
  plateau: 'env_plateau/plateau.glb',
  gate: 'env_gate/gate.glb',
  course: 'levels/ch1_climb/pieces.glb',
} as const;

const coursePlacements = [
  { id: 'table_step', piece: 'rock_c', x: 8.05, z: -42.05, width: 1.25, depth: 1.25, top: 6.95, height: 3, solid: true },
  { id: 'table_hold', piece: 'slab_a', x: 9.95, z: -42.48, width: 2.5, depth: 0.62, top: 8, height: 0.55, solid: false },
  { id: 'table', piece: 'slab_a', x: 9.85, z: -41, width: 2.6, depth: 2.3, top: 9.72, height: 1.7, solid: true },
] as const;

type EnvironmentAssets = Pick<AssetManager, 'loadGLTF' | 'loadTexture'>;

export interface ChapterOneEnvironmentFrame {
  readonly railFrame: number;
  readonly cameraY?: number;
}

const smoothstep = (value: number, start: number, end: number) => {
  const t = Math.min(Math.max((value - start) / (end - start), 0), 1);
  return t * t * (3 - 2 * t);
};

function meshAt(root: Object3D, name: string): Mesh | undefined {
  const mesh = root.getObjectByName(name);
  return mesh instanceof Mesh ? mesh : undefined;
}

async function loadModel(assets: EnvironmentAssets, lifetime: ChapterLifetime, path: string) {
  const model = await assets.loadGLTF(path, { displaySpace: false, signal: lifetime.signal });
  lifetime.defer(() => disposeGLTF(model));
  lifetime.signal.throwIfAborted();
  return model.scene;
}

async function loadLook(assets: EnvironmentAssets, lifetime: ChapterLifetime, name: string) {
  const texture = await assets.loadTexture('env_plateau/' + name, { colorSpace: NoColorSpace, signal: lifetime.signal });
  lifetime.defer(() => texture.dispose());
  lifetime.signal.throwIfAborted();
  texture.flipY = false;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function swapMaterial(mesh: Mesh, material: Material, lifetime: ChapterLifetime) {
  const original = mesh.material;
  mesh.material = material;
  lifetime.defer(() => { mesh.material = original; });
}

function prepareCliff(root: Object3D, lifetime: ChapterLifetime) {
  lifetime.defer(bindInkMeshMaterials(root, source => {
    const material = createInkMaterial(source);
    const style = source.name.replace(/\.\d+$/, '').replace(/^mat_/, '');
    const lookMap = source.map;
    if (!lookMap || !material.colorNode || !/^(cliff|face|lobe|path)$/.test(style)) return material;

    // The baked look map packs value, dry brush, and pool masks into RGB.
    // Keep the original texture and UV transforms, but sample it as scalar data.
    lookMap.colorSpace = NoColorSpace;
    lookMap.needsUpdate = true;
    material.map = null;
    const value = clamp(texture(lookMap).r.sub(0.5).mul(1.1).add(1), 0, 1.55);
    // These four named ink presets construct a tinted RGBA node.
    const diffuse = material.colorNode as Node<'vec4'>;
    material.colorNode = vec4(diffuse.rgb.mul(value), diffuse.a);
    return material;
  }));
  const fade = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide });
  lifetime.defer(() => fade.dispose());
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    node.castShadow = false;
    if (/^(cliff_wall|lobe|face|pillar|mound|boulder|field)/.test(node.name)) node.receiveShadow = false;
    if (node.name.startsWith('fade_')) {
      swapMaterial(node, fade, lifetime);
      node.receiveShadow = false;
      node.renderOrder = -10;
    }
  });
}

function crossingStyle(name: string): InkMaterialOptions {
  if (name === 'bridge_lacing') return { preset: 'wood', lineWeight: 0 };
  if (/^bridge_(under|backing)/.test(name)) return { preset: 'wood', lineWeight: 0.2 };
  if (name.startsWith('bridge_')) return { preset: 'wood' };
  if (name === 'stair_blocks') return { preset: 'stair', lineWeight: 0.55 };
  if (name === 'slab_top') return { preset: 'stone' };
  return { preset: 'rock' };
}

function prepareCrossing(root: Object3D, lifetime: ChapterLifetime) {
  lifetime.defer(bindInkMeshMaterials(root, (material, name) => createInkMaterial(material, crossingStyle(name.replace(/\.\d+$/, '')))));
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    if (/^(slab_top|slab_side|bridge_backing|bridge_under|bridge_lacing|bridge_planks|stair_face_left|stair_cheek_right)/.test(node.name)) {
      node.castShadow = false;
    }
    if (/^(stair_face_left|stair_cheek_right|slab_side|bridge_backing|bridge_under)/.test(node.name)) {
      node.receiveShadow = false;
    }
  });
}

function preparePlateau(root: Object3D, lifetime: ChapterLifetime, wallLook: Texture, topLook: Texture) {
  root.name = 'env_plateau';
  lifetime.defer(bindInkMeshMaterials(root, (source, name) => {
    const top = name === 'plateau_top';
    const wall = name === 'wall_front';
    const material = createInkMaterial(source, {
      preset: top || name === 'plateau_steps' ? 'stone' : 'rock',
      ...(top ? { lineWeight: 0.4 } : {}), ...(wall || top ? { vertexPaint: true } : {}),
    });
    if (wall || top) material.map = top ? topLook : wallLook;
    return material;
  }));
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    if (/^(wall|shoulder)/.test(node.name) || node.name === 'plateau_collision') {
      node.receiveShadow = false;
      node.castShadow = false;
    }
    if (node.name === 'plateau_top') node.castShadow = false;
    if (node.name === 'plateau_collision') node.visible = false;
  });
  return ['shoulder_left', 'shoulder_left_low', 'shoulder_left_lower'].flatMap(name => {
    const node = root.getObjectByName(name);
    return node ? [{ node, x: node.position.x, z: node.position.z }] : [];
  });
}

function seatGateRidge(board: Mesh | undefined, tiles: Mesh | undefined) {
  if (!board || !tiles || !board.matrix.equals(tiles.matrix)) return;
  const position = board.geometry.getAttribute('position');
  if (!(position instanceof BufferAttribute)) return;
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const surface = new Mesh(tiles.geometry, material);
  const ray = new Raycaster();
  const down = new Vector3(0, -1, 0);
  const origin = new Vector3();
  const sections = new Map<number, number[]>();
  for (let index = 0; index < position.count; index++) {
    const x = Math.round(position.getX(index) * 1000);
    const section = sections.get(x);
    if (section) section.push(index);
    else sections.set(x, [index]);
  }
  try {
    for (const [x, points] of sections) {
      const ys = points.map(index => position.getY(index));
      const zs = points.map(index => position.getZ(index));
      const minY = Math.min(...ys), maxY = Math.max(...ys), minZ = Math.min(...zs), maxZ = Math.max(...zs);
      let roof = -Infinity;
      for (let probe = 0; probe <= 8; probe++) {
        ray.set(origin.set(x / 1000, maxY + 0.5, minZ + (maxZ - minZ) * probe / 8), down);
        ray.far = 4;
        const hit = ray.intersectObject(surface, false)[0];
        if (hit) roof = Math.max(roof, hit.point.y);
      }
      const gap = minY - roof;
      if (gap <= -0.03) continue;
      const lower = (1 - smoothstep(gap, 0.25, 0.42)) * (gap + 0.03);
      if (!(lower > 0)) continue;
      const midY = (minY + maxY) / 2;
      for (const index of points) if (position.getY(index) < midY) position.setY(index, position.getY(index) - lower);
    }
    position.needsUpdate = true;
    board.geometry.computeBoundingBox();
    board.geometry.computeBoundingSphere();
  } finally { material.dispose(); }
}

function resolveMap(mesh: Mesh | undefined): Texture | null {
  if (!mesh || Array.isArray(mesh.material) || !('map' in mesh.material)) return null;
  return mesh.material.map instanceof Texture ? mesh.material.map : null;
}

function prepareGate(root: Object3D, lifetime: ChapterLifetime) {
  root.updateMatrixWorld(true);
  const gate = root.getObjectByName('gate_root');
  const temple = root.getObjectByName('temple_root');
  if (!gate || !temple) throw Error('Chapter One gate is missing gate_root or temple_root');
  seatGateRidge(meshAt(root, 'gate_ridge_board'), meshAt(root, 'gate_tile'));
  lifetime.defer(bindInkMeshMaterials(root, (source, name) => createInkMaterial(source, {
    preset: /^(gate_steps|gate_plinths)$/.test(name) ? 'stone' : name === 'temple_mesh' ? 'far' : 'torii',
    ...(name === 'gate_tile' ? { lineWeight: 0.3 } : {}),
  })));
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    node.castShadow = node.name.startsWith('gate_');
    node.receiveShadow = /^(gate_plinths|gate_steps)$/.test(node.name);
  });
  const cards = meshAt(root, 'temple_cards');
  const fixed = meshAt(root, 'temple_cards_fixed');
  const map = resolveMap(cards) ?? resolveMap(fixed);
  if ((cards || fixed) && !map) throw Error('Chapter One gate is missing the embedded temple cards texture');
  if (map) { map.anisotropy = 8; map.needsUpdate = true; }
  const cardMaterial = new MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: DoubleSide });
  const fixedMaterial = cardMaterial.clone();
  lifetime.defer(() => { cardMaterial.dispose(); fixedMaterial.dispose(); });
  if (cards) swapMaterial(cards, cardMaterial, lifetime);
  if (fixed) swapMaterial(fixed, fixedMaterial, lifetime);
  gate.position.set(14.23, 8.35, -61.255);
  gate.rotation.set(0, Math.PI / 180 * -45.4, 0);
  return { temple, fixed, fixedMaterial };
}

function createCourse(pieces: Object3D, lifetime: ChapterLifetime) {
  const course = new Group();
  course.name = 'course';
  for (const { id, piece, x, z, width, depth, top, height, solid } of coursePlacements) {
    const template = meshAt(pieces, piece);
    if (!template) throw Error('Chapter One course is missing piece ' + piece);
    const geometry = solid ? template.geometry.clone() : template.geometry;
    if (solid) {
      lifetime.defer(() => geometry.dispose());
      geometry.computeBoundingBox();
      const thickness = -(geometry.boundingBox?.min.y ?? 0);
      const topScale = Math.min(1, 0.12 / (0.3 * height));
      if (topScale < 1 && thickness > 0.3) {
        const lowerScale = (thickness - 0.3 * topScale) / (thickness - 0.3);
        const positions = geometry.getAttribute('position');
        const normals = geometry.getAttribute('normal');
        for (let index = 0; index < positions.count; index++) {
          const y = positions.getY(index);
          const scale = y >= -0.3 ? topScale : lowerScale;
          positions.setY(index, y >= -0.3 ? y * topScale : -0.3 * topScale + (y + 0.3) * lowerScale);
          if (normals) {
            const x = normals.getX(index), y = normals.getY(index) / scale, z = normals.getZ(index);
            const length = Math.hypot(x, y, z) || 1;
            normals.setXYZ(index, x / length, y / length, z / length);
          }
        }
        positions.needsUpdate = true;
        if (normals) normals.needsUpdate = true;
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
      }
    }
    const mesh = new Mesh(geometry, template.material);
    mesh.name = id;
    mesh.position.set(x, top, z);
    const spread = solid ? 1.1 : 1;
    mesh.scale.set(width * spread, height, depth * spread);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    course.add(mesh);
  }
  lifetime.defer(bindInkMeshMaterials(course));
  return course;
}

/** Load the authored visual environment without installing collision or registering runtime systems. */
export async function loadChapterOneEnvironment(assets: EnvironmentAssets, lifetime: ChapterLifetime) {
  const paths = chapterOneEnvironmentAssets;
  const [cliff, crossing, plateau, gate, pieces, wallLook, topLook] = await Promise.all([
    Promise.all(paths.cliff.map(path => loadModel(assets, lifetime, path))),
    Promise.all(paths.crossing.map(path => loadModel(assets, lifetime, path))),
    loadModel(assets, lifetime, paths.plateau), loadModel(assets, lifetime, paths.gate), loadModel(assets, lifetime, paths.course),
    loadLook(assets, lifetime, 'wall_look.png'), loadLook(assets, lifetime, 'top_look.png'),
  ]);
  lifetime.signal.throwIfAborted();
  for (const model of cliff) prepareCliff(model, lifetime);
  for (const model of crossing) prepareCrossing(model, lifetime);
  const shoulders = preparePlateau(plateau, lifetime, wallLook, topLook);
  const { temple, fixed, fixedMaterial } = prepareGate(gate, lifetime);
  const course = createCourse(pieces, lifetime);
  const root = new Group();
  root.name = 'chapter_one_environment';
  root.add(...cliff, ...crossing, plateau, gate, course);

  function update({ railFrame, cameraY }: ChapterOneEnvironmentFrame) {
    const blend = smoothstep(railFrame, 202, 214);
    temple.position.set(2 * blend, 0.45 * blend, 0.17 * blend);
    if (fixed) {
      const opacity = smoothstep(railFrame, 186, 198);
      fixedMaterial.opacity = opacity;
      fixed.visible = opacity > 0;
    }
    if (cameraY !== undefined) {
      const slide = smoothstep(cameraY, 9.2, 10) * 2.6;
      for (const { node, x, z } of shoulders) {
        node.position.x = x + 0.9 * slide;
        node.position.z = z - 0.44 * slide;
      }
    }
  }
  update({ railFrame: 0 });
  return { root, course, plateau, gate, update };
}
