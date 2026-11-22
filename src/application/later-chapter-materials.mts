import { DoubleSide, type MeshStandardMaterial, type Node, type Side } from 'three/webgpu';
import { clamp, materialColor, mix, smoothstep, vec3, vec4, vertexColor } from 'three/tsl';
import { createInkMaterial, type InkMaterialPreset } from '../rendering/ink-material.mts';
import { resolveChapterTwoInkMaterial, type ChapterTwoInkStyle } from './chapter-two-materials.mts';

export type LaterInkChapter = 'ch3_pines' | 'ch4_temple' | 'ch5_sea' | 'ch6_summit';
export type SummitInkAsset = 'terrain' | 'props' | 'far';

interface LaterInkStyle extends ChapterTwoInkStyle {
  readonly snow?: true;
  readonly unlit?: true;
}

type Ramp = NonNullable<ChapterTwoInkStyle['ramp']>;
interface StyleControls {
  readonly lineWeight?: number;
  readonly vertices?: ChapterTwoInkStyle['vertices'];
  readonly side?: Side;
}

function ramp(preset: InkMaterialPreset, settings: Ramp, { lineWeight = 1, vertices = 'ink', side }: StyleControls = {}): LaterInkStyle {
  return { preset, ramp: settings, lineWeight, vertices, ...(side !== undefined ? { side } : {}) };
}

function solid(preset: InkMaterialPreset, color: number, { lineWeight = 1, vertices = 'none', side }: StyleControls = {}): LaterInkStyle {
  return { preset, color, lineWeight, vertices, ...(side !== undefined ? { side } : {}) };
}

// Chapter Three selects the last token of the mesh name (Se and Le).
const PINES_ROCK = { bias: 0.17, scale: 0.84, tint: [1.02, 1, 0.965], cavity: 0.85 } as const;
const PINES = {
  rock: ramp('rock', PINES_ROCK),
  top: ramp('rock', { ...PINES_ROCK, bias: 0.4, scale: 0.56 }),
  far: ramp('rock', { ...PINES_ROCK, bias: 0.34, scale: 0.5 }, { lineWeight: 0.45 }),
  bark: ramp('rock', { bias: 0.06, scale: 0.98, tint: [1.02, 1, 0.96], cavity: 0.7 }, { lineWeight: 0.9 }),
  wood: ramp('rock', { bias: 0.3, scale: 0.56, tint: [1.035, 1, 0.95], cavity: 0.9 }, { lineWeight: 0.8 }),
  rope: solid('wood', 8352352, { lineWeight: 0.55 }),
  needles: solid('pineNeedles', 1645338, { lineWeight: 0 }),
  mesh: ramp('rock', { ...PINES_ROCK, bias: 0.26, scale: 0.72 }),
  lacquer: solid('wood', 9255724, { lineWeight: 0.85 }),
} as const;

// Chapter Four's Se reuses the court conventions for these prop styles.
function templeCourt(name: string) {
  return resolveChapterTwoInkMaterial('court', 'court_' + name);
}

const TEMPLE_FACE = { bias: 0.14, scale: 0.86, tint: [1, 1, 1.01], cavity: 0.7 } as const;
const TEMPLE = {
  side: ramp('face', TEMPLE_FACE),
  floor: ramp('path', { bias: 0.3, scale: 0.56, tint: [1.008, 1, 0.972] }, { vertices: 'none' }),
  hfloor: ramp('path', { bias: 0.2, scale: 0.36, tint: [1.02, 1, 0.96] }, { vertices: 'none' }),
  step: ramp('rubble', { bias: 0.26, scale: 0.62, tint: [1.008, 1, 0.972] }, { vertices: 'none' }),
  plaster: ramp('face', { ...TEMPLE_FACE, bias: 0.34, scale: 0.54, tint: [1.012, 1, 0.98] }),
  hwall: ramp('face', { ...TEMPLE_FACE, bias: 0, scale: 0.3 }, { lineWeight: 0.6 }),
  boulder: ramp('boulder', { bias: 0.03, scale: 0.86, tint: [1.018, 1, 0.965], cavity: 0.5 }),
  tile: templeCourt('tile'),
  stone: templeCourt('stone'),
  slab: templeCourt('slab'),
  lacquer: templeCourt('lacquer'),
  wood: templeCourt('wood'),
  beam: templeCourt('wood'),
  plank: templeCourt('wood'),
  door: templeCourt('door'),
  hbeam: solid('wood', 0xffffff, { lineWeight: 0.4, vertices: 'color' }),
  rope: templeCourt('rope'),
  chain: templeCourt('chain'),
  iron: templeCourt('iron'),
  bronze: templeCourt('bronze'),
  ink: templeCourt('ink'),
  ceiling: solid('dark', 2960168, { lineWeight: 0, side: DoubleSide }),
  paper: solid('wood', 14206112, { lineWeight: 0.6 }),
  lantern_red: solid('wood', 10504762, { lineWeight: 0.6 }),
  far: solid('far', 2500650, { lineWeight: 0 }),
  glow: { ...solid('far', 13129786, { lineWeight: 0 }), unlit: true },
} as const;

const TEMPLE_FALLBACK = ramp('stone', { bias: 0.1, scale: 1.06 }, { vertices: 'none' });

// Chapter Five's Te binds we() by glTF material name. The GLB carries no paint.
const SEA_ROCK = { bias: 0.36, scale: 0.66, tint: [1, 0.995, 0.985] } as const;
const SEA_STONE = ramp('rock', { ...SEA_ROCK, bias: 0.4, scale: 0.6 }, { vertices: 'none' });
const SEA = {
  sea_rock: ramp('rock', SEA_ROCK, { vertices: 'none' }),
  sea_top: ramp('rock', { ...SEA_ROCK, bias: 0.44, scale: 0.54 }, { vertices: 'none' }),
  sea_stone: SEA_STONE,
  sea_stair: SEA_STONE,
  sea_float_rock: SEA_STONE,
  sea_wood: solid('wood', 7169113, { lineWeight: 0.8, side: DoubleSide }),
  sea_float_wood: solid('wood', 7169113, { lineWeight: 0.8, side: DoubleSide }),
  sea_lacquer: solid('wood', 6172453, { lineWeight: 0.85 }),
  sea_float_lacquer: solid('wood', 6172453, { lineWeight: 0.85, side: DoubleSide }),
  sea_pine: solid('wood', 3486254, { lineWeight: 0.9 }),
  sea_far: solid('far', 6251884, { lineWeight: 0 }),
  sea_rope: solid('wood', 9405031, { lineWeight: 0.5 }),
  sea_sail: solid('wood', 11051668, { lineWeight: 0.5, side: DoubleSide }),
  sea_paper: solid('wood', 14208952, { lineWeight: 0.5 }),
} as const;

// Summit Te selects mesh prefixes for terrain and props. The far asset uses one fixed style.
const SUMMIT_SNOW = { preset: 'stone', vertices: 'ink', lineWeight: 0.9, side: DoubleSide, snow: true } as const;
const SUMMIT = {
  snow: SUMMIT_SNOW,
  trail: { ...SUMMIT_SNOW, lineWeight: 0 },
  rock: ramp('rock', { bias: 0.06, scale: 0.5, tint: [0.985, 1, 1.03], cavity: 0.9 }, { side: DoubleSide }),
  stone: ramp('stone', { bias: 0.42, scale: 0.5, tint: [0.99, 1, 1.02], cavity: 0.8 }, { side: DoubleSide }),
  ice: solid('stone', 13030363, { lineWeight: 0.8, side: DoubleSide }),
  ink: solid('dark', 1185050, { lineWeight: 0 }),
  wood: solid('wood', 6114879, { lineWeight: 0.85 }),
  rope: solid('wood', 9405031, { lineWeight: 0.5 }),
  bronze: solid('wood', 2433823),
  red: solid('torii', 11022879, { lineWeight: 0.3 }),
} as const;

const SUMMIT_FAR = solid('far', 7635084, { lineWeight: 0, side: DoubleSide });

function lookup(styles: Readonly<Record<string, LaterInkStyle>>, key: string): LaterInkStyle | undefined {
  return Object.hasOwn(styles, key) ? styles[key] : undefined;
}

export function resolveLaterChapterInkMaterial(
  chapter: LaterInkChapter, meshName: string, materialName = '', asset?: SummitInkAsset,
): LaterInkStyle | undefined {
  const name = meshName.replace(/\.\d+$/, '');
  switch (chapter) {
    case 'ch3_pines':
      return lookup(PINES, name.split('_').at(-1) ?? '') ?? PINES.rock;
    case 'ch4_temple': {
      const key = (name.split('__')[1] ?? name.replace(/^t_/, '').replace(/_a\d+$/, ''))
        .replace(/\.\d+$/, '').replace(/_\d+$/, '');
      return lookup(TEMPLE, key) ?? TEMPLE_FALLBACK;
    }
    case 'ch5_sea':
      return lookup(SEA, materialName.replace(/\.\d+$/, ''));
    case 'ch6_summit':
      return asset === 'far' || name.startsWith('far_')
        ? SUMMIT_FAR
        : lookup(SUMMIT, name.split('_')[0] ?? '');
  }
}

// Same neutral working-space ramp sampling as Chapter Two. These are the
// published ink ramp stops rather than RGB interpretations of the paint.
const RAMP = [
  [13,16,20], [25,33,40], [45,52,58], [69,72,73], [90,90,87],
  [110,109,104], [132,131,124], [155,154,146], [178,177,168], [203,202,193],
] as const;

function referenceColor({ bias, scale, tint = [1, 1, 1] }: Ramp): [number, number, number] {
  const index = Math.min(Math.max((bias + 0.5 * scale) * 8, 0), RAMP.length - 1);
  const first = Math.floor(index);
  const last = Math.min(first + 1, RAMP.length - 1);
  const fraction = index - first;
  const blend = fraction * fraction * (3 - 2 * fraction);
  const channel = (i: 0 | 1 | 2) => (RAMP[first]![i] + (RAMP[last]![i] - RAMP[first]![i]) * blend) / 255 * tint[i];
  return [channel(0), channel(1), channel(2)];
}

/** Adapt a later chapter's opaque style using the native ink material and scene lights. */
export function createLaterChapterInkMaterial(
  source: MeshStandardMaterial, chapter: LaterInkChapter, meshName: string, asset?: SummitInkAsset,
) {
  const style = resolveLaterChapterInkMaterial(chapter, meshName, source.name, asset);
  if (!style) return source;
  const paint = style.vertices === 'ink';
  const material = createInkMaterial(source, { preset: style.preset, lineWeight: style.lineWeight, vertexPaint: paint });
  material.vertexColors = style.vertices === 'color';
  material.lights = !style.unlit;
  if (style.side !== undefined) material.side = style.side;
  if (style.color !== undefined) material.color.setHex(style.color);
  if (style.ramp) material.color.setRGB(...referenceColor(style.ramp));
  if (style.snow) material.color.setRGB(0.925, 0.915, 0.885);
  if (chapter === 'ch6_summit') {
    // Summit's GLBs omit PBR materials. glTF's fully metallic fallback absorbs
    // the scene's diffuse light, while the authored ink shader uses pigment.
    material.metalness = 0;
    if (meshName.startsWith('trail_')) {
      material.polygonOffset = true;
      material.polygonOffsetFactor = -2;
      material.polygonOffsetUnits = -4;
    }
  }

  if (paint) {
    const base = vec4(materialColor as unknown as Node<'vec4'>);
    const red = clamp(vertexColor().r, 0, 1);
    const tint = style.snow
      ? mix(vec3(1), vec3(0.74, 0.8, 0.92), smoothstep(0, 0.65, red.oneMinus()))
      : mix(1, red, style.ramp?.cavity ?? 0);
    material.colorNode = vec4(base.rgb.mul(tint), base.a);
  } else {
    material.colorNode = null;
  }
  return material;
}
