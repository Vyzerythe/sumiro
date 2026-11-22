import { DoubleSide, FrontSide, type MeshStandardMaterial, type Node, type Side } from 'three/webgpu';
import { clamp, materialColor, mix, vec4, vertexColor } from 'three/tsl';
import { createInkMaterial, type InkMaterialPreset } from '../rendering/ink-material.mts';

export type ChapterTwoAsset = 'pass' | 'court';
type Rgb = readonly [number, number, number];
type VertexUse = 'ink' | 'color' | 'none';

interface RampStyle {
  readonly bias: number;
  readonly scale: number;
  readonly tint?: Rgb;
  readonly cavity?: number;
}

export interface ChapterTwoInkStyle {
  readonly preset: InkMaterialPreset;
  readonly lineWeight: number;
  readonly vertices: VertexUse;
  readonly ramp?: RampStyle;
  readonly color?: number;
  readonly side?: Side;
}

const STONE_TINT = [1.008, 1, 0.972] as const;
const FACE_TINT = [1.012, 1, 0.975] as const;
const APRON_TINT = [1.01, 1, 0.975] as const;
const BOULDER_TINT = [1.018, 1, 0.965] as const;

// Je, Ye, Le and ze in ch2_pass-9Opjv4P2.js select these styles by mesh name.
// Keep paint channels separate from actual vertex colors when binding GLB materials.
const PASS = {
  pass_side: {
    preset: 'face', lineWeight: 1, vertices: 'ink', side: FrontSide,
    ramp: { bias: 0.14, scale: 1, tint: FACE_TINT, cavity: 0.7 },
  },
  pass_side_dark: {
    preset: 'face', lineWeight: 1, vertices: 'ink', side: FrontSide,
    ramp: { bias: -0.02, scale: 0.5, tint: FACE_TINT, cavity: 0.7 },
  },
  pass_top_rock: {
    preset: 'path', lineWeight: 0.9, vertices: 'ink',
    ramp: { bias: 0.34, scale: 0.68, tint: STONE_TINT, cavity: 0.5 },
  },
  pass_top_pale: {
    preset: 'path', lineWeight: 0.9, vertices: 'ink',
    ramp: { bias: 0.4, scale: 0.58, tint: STONE_TINT, cavity: 0.5 },
  },
  pass_top_stone: {
    preset: 'path', lineWeight: 1, vertices: 'ink',
    ramp: { bias: 0.38, scale: 0.62, tint: STONE_TINT, cavity: 0.5 },
  },
  pass_top_snow: {
    preset: 'path', lineWeight: 0.9, vertices: 'ink',
    ramp: { bias: 0.56, scale: 0.5, tint: [0.985, 1, 1.03], cavity: 0.5 },
  },
  pass_top_dark: {
    preset: 'path', lineWeight: 0.9, vertices: 'ink',
    ramp: { bias: 0.04, scale: 0.34, tint: STONE_TINT, cavity: 0.5 },
  },
  pass_tread: {
    preset: 'rubble', lineWeight: 1, vertices: 'ink',
    ramp: { bias: 0.3, scale: 0.68, tint: STONE_TINT, cavity: 0.65 },
  },
  pass_lip: {
    preset: 'apron', lineWeight: 1, vertices: 'ink',
    ramp: { bias: 0.3, scale: 0.6, tint: APRON_TINT, cavity: 0.72 },
  },
  pass_lip_dark: { preset: 'dark', lineWeight: 0, vertices: 'none', color: 1711648 },
  pass_boulder: {
    preset: 'boulder', lineWeight: 1, vertices: 'ink',
    ramp: { bias: 0.1, scale: 0.86, tint: BOULDER_TINT, cavity: 0.72 },
  },
  pass_stack: {
    preset: 'mass', lineWeight: 1, vertices: 'ink',
    ramp: { bias: -0.02, scale: 1, tint: [0.99, 1, 1.02], cavity: 0.72 },
  },
  crumble: {
    preset: 'apron', lineWeight: 1, vertices: 'ink',
    ramp: { bias: 0.2, scale: 0.8, tint: APRON_TINT, cavity: 0.72 },
  },
} as const satisfies Record<string, ChapterTwoInkStyle>;

function courtColor(preset: InkMaterialPreset, lineWeight: number, side?: Side): ChapterTwoInkStyle {
  return { preset, lineWeight, vertices: 'color', color: 0xffffff, ...(side !== undefined ? { side } : {}) };
}

const COURT = {
  stone: { preset: 'apron', lineWeight: 1, vertices: 'none', ramp: { bias: 0.2, scale: 0.66, tint: APRON_TINT } },
  slab: { preset: 'apron', lineWeight: 1, vertices: 'none', ramp: { bias: 0.14, scale: 0.72, tint: APRON_TINT } },
  tile: { preset: 'stone', lineWeight: 0.85, vertices: 'none', ramp: { bias: 0.1, scale: 0.42, tint: [1, 1, 1.02] } },
  boulder: PASS.pass_boulder,
  lacquer: courtColor('torii', 0.7),
  wood: courtColor('wood', 0.8),
  door: courtColor('wood', 0.8),
  rope: courtColor('wood', 0.8),
  chain: courtColor('wood', 0.3),
  iron: courtColor('wood', 0.5),
  bronze: courtColor('wood', 0.8),
  steel: courtColor('wood', 0.5, DoubleSide),
  cord: courtColor('wood', 0.4, DoubleSide),
  paper: { preset: 'wood', lineWeight: 0.6, vertices: 'none', color: 14206112, side: DoubleSide },
  ink: { preset: 'dark', lineWeight: 0, vertices: 'none', color: 789517 },
} as const satisfies Record<string, ChapterTwoInkStyle>;

const DEFAULT_ROCK: ChapterTwoInkStyle = {
  preset: 'rock', lineWeight: 1, vertices: 'ink', ramp: { bias: 0.02, scale: 1.06, cavity: 0.8 },
};
const DEFAULT_STONE: ChapterTwoInkStyle = {
  preset: 'stone', lineWeight: 1, vertices: 'none', ramp: { bias: 0.1, scale: 1.06 },
};

function lookup(styles: Readonly<Record<string, ChapterTwoInkStyle>>, key: string) {
  return Object.hasOwn(styles, key) ? styles[key] : undefined;
}

export function resolveChapterTwoInkMaterial(asset: ChapterTwoAsset, meshName: string): ChapterTwoInkStyle {
  const name = meshName.replace(/\.\d+$/, '');
  if (asset === 'pass') return name.startsWith('crumble') ? PASS.crumble : lookup(PASS, name) ?? DEFAULT_ROCK;
  if (name.startsWith('pass_')) return name === 'pass_wall' ? PASS.pass_tread : lookup(PASS, name) ?? DEFAULT_ROCK;
  const nameParts = name.split('__');
  const courtName = nameParts[1] ?? name.replace(/^court_/, '');
  return lookup(COURT, courtName) ?? DEFAULT_STONE;
}

// Working-space stops from rampLookup in ink_material-CrFtRYQr.js.
const RAMP = [
  [13,16,20], [25,33,40], [45,52,58], [69,72,73], [90,90,87],
  [110,109,104], [132,131,124], [155,154,146], [178,177,168], [203,202,193],
] as const;

function referenceColor({ bias, scale, tint = [1, 1, 1] }: RampStyle): Rgb {
  // The scene's native lamps provide lighting. Use the authored ramp at a
  // neutral lighting input with no look-map offset as the diffuse substrate.
  const index = Math.min(Math.max((bias + 0.5 * scale) * 8, 0), RAMP.length - 1);
  const segment = Math.floor(index);
  const from = RAMP[segment]!;
  const to = RAMP[Math.min(segment + 1, RAMP.length - 1)]!;
  const t = index - segment;
  const blend = t * t * (3 - 2 * t);
  const channel = (i: 0 | 1 | 2) => (from[i] + (to[i] - from[i]) * blend) / 255 * tint[i];
  return [channel(0), channel(1), channel(2)];
}

/** Build native PBR and MRT inputs from the authored opaque Chapter Two style. */
export function createChapterTwoInkMaterial(source: MeshStandardMaterial, asset: ChapterTwoAsset, meshName: string) {
  const style = resolveChapterTwoInkMaterial(asset, meshName);
  const paint = style.vertices === 'ink';
  const material = createInkMaterial(source, { preset: style.preset, lineWeight: style.lineWeight, vertexPaint: paint });
  material.vertexColors = style.vertices === 'color';
  if (style.side !== undefined) material.side = style.side;
  if (style.color !== undefined) material.color.setHex(style.color);
  if (style.ramp) material.color.setRGB(...referenceColor(style.ramp));

  // Apply the specific Je/Le cavity strength once. Retain authored vertex
  // alpha in the MRT for painted surfaces, and map alpha in the color path.
  if (paint) {
    const diffuse = vec4(materialColor as unknown as Node<'vec4'>);
    const cavity = mix(1, clamp(vertexColor().r, 0, 1), style.ramp?.cavity ?? 0);
    material.colorNode = vec4(diffuse.rgb.mul(cavity), diffuse.a);
  } else {
    material.colorNode = null;
  }
  return material;
}
