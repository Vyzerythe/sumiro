import { DataTexture, Group, Mesh, MeshBasicMaterial, Sprite, SpriteMaterial, type Object3D } from 'three/webgpu';
import { disposeGLTF, type AssetManager } from '../assets/asset-manager.mts';
import type { createRunProgress } from '../domain/run-progress.mts';
import { scrollCount, scrollTexts, type ScrollId } from '../domain/scrolls.mts';
import type { CollisionWorld } from '../physics/world.mts';
import { createInkMaterial, type InkMaterialPreset } from '../rendering/ink-material.mts';
import { bindInkMeshMaterials } from '../rendering/ink-mesh-materials.mts';
import type { ChapterLifetime } from '../runtime/chapter-manager.mts';
import { getChapterCheckpoints } from './chapter-checkpoints.mts';

interface ScrollPlacement {
  readonly id: ScrollId;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly y?: number;
}

/** Authored placement order from each chapter's published entities array. */
export const chapterScrollPlacements: Readonly<Record<string, readonly ScrollPlacement[]>> = {
  ch1_climb: [{ id: 'first_mist', x: 10.2, y: 9.72, z: -40.7, heading: 0.6 }],
  ch2_pass: [
    { id: 'dry_well', x: 59, z: -213.5, heading: 0.4 },
    { id: 'snow_line', x: 29, z: -268, heading: -0.5 },
  ],
  ch3_pines: [
    { id: 'low_pine', x: 16.4, z: -158.6, heading: 1.2 },
    { id: 'crow_debt', x: -155.8, z: -184, heading: 2.8 },
    { id: 'rope_bridge', x: -313.79999999999995, z: -170.8, heading: 2.8 },
  ],
  ch4_temple: [
    { id: 'red_gate', x: 0.5, z: -69, heading: 0.5 },
    { id: 'cold_bell', x: 118, z: -280.5, heading: -1.2 },
    { id: 'wet_brush', x: 10, z: -312.5, heading: 2.8 },
  ],
  ch5_sea: [
    { id: 'black_tide', x: 10, z: -185.6, heading: 0.4 },
    { id: 'grey_boat', x: -15, z: -306, heading: -0.8 },
  ],
  ch6_summit: [{ id: 'last_stroke', x: 16.8, z: -238, heading: 1.2 }],
};

export interface ChapterScrollTarget extends ScrollPlacement {
  readonly kind: 'scroll';
  readonly y: number;
  readonly radius: 1.5;
  readonly prompt: 'E  take the scroll';
}

export interface ChapterScrollPlayer {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly grounded: boolean;
  readonly state: string;
}

export interface ChapterScrollCaptured {
  readonly type: 'scroll-captured';
  readonly id: ScrollId;
  readonly lines: readonly string[];
  readonly count: number;
  readonly total: number;
}

type RunProgress = Pick<ReturnType<typeof createRunProgress>, 'current' | 'collectScroll'>;
type CollectibleState = Pick<RunProgress['current'], 'chapter' | 'shrine' | 'scrolls'>;

interface KitMaterial {
  preset: InkMaterialPreset;
  lineWeight: number;
  color?: number;
}

const stone = { preset: 'stone', lineWeight: 0.95 } as const;
const kitMaterials: Readonly<Record<string, KitMaterial>> = {
  lantern_stone: stone,
  lantern_bowl: stone,
  lantern_niche: { preset: 'far', lineWeight: 0, color: 1512466 },
  lantern_cloth: { preset: 'cloth', lineWeight: 0.5, color: 14472125 },
  lantern_cord: { preset: 'cloth', lineWeight: 0.3, color: 11022879 },
  scroll_paper: { preset: 'cloth', lineWeight: 0.5, color: 14077104 },
  scroll_rods: { preset: 'wood', lineWeight: 0.7, color: 4863266 },
  scroll_cord: { preset: 'cloth', lineWeight: 0.2, color: 11022879 },
  scroll_cradle: stone,
};
const litParts = new Set(['lantern_glow', 'lantern_cloth', 'lantern_cord', 'lantern_bowl']);
const busyStates = new Set(['INTERACT', 'DRINK', 'TOUCH', 'DEATH']);
const actionStates = new Set(['IDLE', 'WALK', 'RUN', 'SPRINT', 'LAND', 'TEETER']);

function prepareKit(root: Object3D, lifetime: ChapterLifetime) {
  const originalGlow = root.getObjectByName('lantern_glow');
  lifetime.defer(bindInkMeshMaterials(root, (source, name) => {
    const style = kitMaterials[name.replace(/\.\d+$/, '')];
    if (!style) return source;
    const material = createInkMaterial(source, { preset: style.preset, lineWeight: style.lineWeight });
    if (style.color !== undefined) material.color.setHex(style.color);
    return material;
  }));
  if (originalGlow instanceof Mesh) {
    const original = originalGlow.material;
    const glow = new MeshBasicMaterial({ color: 15239754, name: 'lantern_glow' });
    originalGlow.material = glow;
    lifetime.defer(() => { originalGlow.material = original; glow.dispose(); });
  }
  root.traverse(node => {
    if (node instanceof Mesh) node.castShadow = node.receiveShadow = true;
  });
}

/** Rasterize the published scroll stamp's rotated ellipses with subpixel coverage. */
function createScrollStamp() {
  const size = 256;
  const rgba = new Uint8Array(size * size * 4);
  function ellipse(angle: number, radius: number, rx: number, ry: number, alpha: number, r: number, g: number, b: number) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const cx = 128 + cos * radius, cy = 128 + sin * radius;
    const bound = Math.max(rx, ry);
    for (let y = Math.floor(cy - bound); y < Math.ceil(cy + bound); y++) {
      for (let x = Math.floor(cx - bound); x < Math.ceil(cx + bound); x++) {
        let covered = 0;
        for (const dy of [0.25, 0.75]) {
          for (const dx of [0.25, 0.75]) {
            const ox = x + dx - cx, oy = y + dy - cy;
            const u = (cos * ox + sin * oy) / rx, v = (-sin * ox + cos * oy) / ry;
            if (u * u + v * v <= 1) covered++;
          }
        }
        if (!covered) continue;
        const index = ((size - 1 - y) * size + x) * 4;
        const incoming = alpha * covered / 4;
        const previous = rgba[index + 3]! / 255 * (1 - incoming);
        const combined = incoming + previous;
        rgba[index] = Math.round((r * incoming + rgba[index]! * previous) / combined);
        rgba[index + 1] = Math.round((g * incoming + rgba[index + 1]! * previous) / combined);
        rgba[index + 2] = Math.round((b * incoming + rgba[index + 2]! * previous) / combined);
        rgba[index + 3] = Math.round(combined * 255);
      }
    }
  }
  for (let mark = 0; mark < 90; mark++) {
    const angle = mark / 90 * Math.PI * 1.75 + 0.5;
    const width = 7 * Math.sin(mark / 90 * Math.PI) + 1;
    ellipse(angle, 92, width, width * 1.6, 0.35 + 0.35 * Math.sin(mark * 12.9898) ** 2, 30, 26, 22);
  }
  for (let mark = 0; mark < 16; mark++) {
    ellipse(-0.3 + mark * 0.05, 94, 5, 7, 0.8, 176, 52, 34);
  }
  const stamp = new DataTexture(rgba, size, size);
  stamp.needsUpdate = true;
  return stamp;
}

/** Prepare a detached visual group and the later-chapter scroll interaction. */
export async function loadChapterCollectibles(
  chapter: string, assets: Pick<AssetManager, 'loadGLTF'>, world: Pick<CollisionWorld, 'groundAt'>, lifetime: ChapterLifetime,
) {
  const root = new Group();
  root.name = 'chapter_collectibles';
  const shrines = new Map<string, Object3D>();
  const scrolls = new Map<ScrollId, Object3D>();
  const targets: ChapterScrollTarget[] = [];
  const shrineSites = getChapterCheckpoints(chapter);
  const scrollSites = Object.hasOwn(chapterScrollPlacements, chapter) ? chapterScrollPlacements[chapter]! : [];
  let state: CollectibleState | null = null;
  const ground = (x: number, z: number) => world.groundAt(x, z)?.y ?? 0;

  async function template(path: string) {
    const model = await assets.loadGLTF(path, { displaySpace: false, signal: lifetime.signal });
    lifetime.defer(() => disposeGLTF(model));
    lifetime.signal.throwIfAborted();
    prepareKit(model.scene, lifetime);
    return model.scene;
  }

  const [shrineModel, scrollModel] = await Promise.all([
    shrineSites.length ? template('kit/shrine.glb') : null,
    scrollSites.length ? template('kit/scroll.glb') : null,
  ]);
  lifetime.signal.throwIfAborted();

  if (shrineModel) {
    for (const site of shrineSites) {
      const shrine = shrineModel.clone(true);
      shrine.name = 'shrine_' + site.id;
      shrine.position.set(site.x, ground(site.x, site.z), site.z);
      shrine.rotation.y = site.heading;
      shrines.set(site.id, shrine);
      root.add(shrine);
    }
  }
  if (scrollModel) {
    const stamp = createScrollStamp();
    const material = new SpriteMaterial({ map: stamp, transparent: true, depthWrite: false, opacity: 0.8 });
    lifetime.defer(() => { material.dispose(); stamp.dispose(); });
    for (const site of scrollSites) {
      const y = site.y ?? ground(site.x, site.z);
      const scroll = scrollModel.clone(true);
      scroll.name = 'scroll_' + site.id;
      scroll.position.set(site.x, y, site.z);
      scroll.rotation.y = site.heading;
      const seal = new Sprite(material);
      seal.name = 'scroll_seal';
      seal.position.y = 1;
      seal.scale.setScalar(0.85);
      seal.renderOrder = 8;
      scroll.add(seal);
      scrolls.set(site.id, scroll);
      targets.push({ ...site, y, kind: 'scroll', radius: 1.5, prompt: 'E  take the scroll' });
      root.add(scroll);
    }
  }

  function sync(run: CollectibleState | null | undefined) {
    state = run ?? null;
    for (const [id, shrine] of shrines) {
      shrine.visible = state !== null;
      const lit = state?.chapter === chapter && state.shrine === id;
      shrine.traverse(node => { if (litParts.has(node.name)) node.visible = lit; });
    }
    for (const [id, scroll] of scrolls) scroll.visible = !state?.scrolls.includes(id);
  }

  function nearestScroll(player: ChapterScrollPlayer): ChapterScrollTarget | null {
    if (!state || chapter === 'ch1_climb' || lifetime.signal.aborted || !player.grounded || busyStates.has(player.state)) return null;
    let nearest: ChapterScrollTarget | null = null;
    let distanceToNearest = Infinity;
    for (const target of targets) {
      if (state.scrolls.includes(target.id) || Math.abs(target.y - player.y) > 1.6) continue;
      const distance = Math.hypot(target.x - player.x, target.z - player.z);
      if (distance >= target.radius || distance >= distanceToNearest) continue;
      nearest = target;
      distanceToNearest = distance;
    }
    return nearest;
  }

  function collectScroll(
    player: ChapterScrollPlayer, progress: RunProgress, tryAction?: (target: ChapterScrollTarget) => boolean,
  ): ChapterScrollCaptured | null {
    if (!actionStates.has(player.state)) return null;
    const target = nearestScroll(player);
    if (!target || progress.current.scrolls.includes(target.id) || tryAction?.(target) === false) return null;
    progress.collectScroll(target.id);
    sync(progress.current);
    return { type: 'scroll-captured', id: target.id, lines: scrollTexts[target.id], count: progress.current.scrolls.length, total: scrollCount };
  }

  sync(null);
  lifetime.defer(() => {
    root.removeFromParent().clear();
    shrines.clear();
    scrolls.clear();
    targets.length = 0;
    state = null;
  });
  return { root, shrines, scrolls, sync, nearestScroll, collectScroll };
}
