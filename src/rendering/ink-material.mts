import { MeshStandardNodeMaterial, NoBlending, NormalBlending, type MeshStandardMaterial, type Node } from 'three/webgpu';
import { clamp, materialColor, mix, vec3, vec4, vertexColor } from 'three/tsl';
import { createInkSurfaceOutput } from './ink-surface-pass.mts';

interface SurfacePreset {
  lineWeight: number;
  /** Linear channel multipliers from the shipped presets. */
  tint?: readonly [number, number, number];
  /** Strength of the authored vertex cavity channel in the native diffuse color. */
  cavity?: number;
}

const DEFAULT_TINT = [1, 1, 1] as const;
const STONE_TINT = [1.008, 1, 0.972] as const;
const ROCK_TINT = [1.018, 1, 0.965] as const;
const CLIFF_TINT = [1.012, 1, 0.975] as const;

// The line weights, RGB multipliers and cavity controls used here come from
// constants-BjlLV5tN.js and materials-CGuChJ0C.js.
const PRESETS = {
  rock: { lineWeight: 1, cavity: 0.8 },
  stone: { lineWeight: 1, cavity: 0.8 },
  stair: { lineWeight: 0.9, cavity: 0.8 },
  wood: { lineWeight: 0.8 },
  torii: { lineWeight: 0.7 },
  pineTrunk: { lineWeight: 0.8 },
  pineNeedles: { lineWeight: 0.25 },
  cloth: { lineWeight: 0.45 },
  hat: { lineWeight: 0.8 },
  skin: { lineWeight: 0.45 },
  crow: { lineWeight: 0 },
  far: { lineWeight: 0 },
  cliff: { lineWeight: 1, tint: CLIFF_TINT, cavity: 0.3 },
  lobe: { lineWeight: 1, tint: CLIFF_TINT, cavity: 0.45 },
  path: { lineWeight: 0.9, tint: STONE_TINT, cavity: 0.5 },
  face: { lineWeight: 1, tint: CLIFF_TINT, cavity: 0.5 },
  rubble: { lineWeight: 1, tint: STONE_TINT, cavity: 0.65 },
  apron: { lineWeight: 1, tint: [1.01, 1, 0.975], cavity: 0.72 },
  boulder: { lineWeight: 1, tint: ROCK_TINT, cavity: 0.72 },
  mass: { lineWeight: 1, tint: [0.99, 1, 1.02], cavity: 0.72 },
  field: { lineWeight: 1, tint: ROCK_TINT, cavity: 0.72 },
  dark: { lineWeight: 0, cavity: 0.8 },
  pillar: { lineWeight: 0.85, cavity: 0.7 },
} as const satisfies Record<string, SurfacePreset>;

export type InkMaterialPreset = keyof typeof PRESETS;

export interface InkMaterialOptions {
  preset?: InkMaterialPreset;
  lineWeight?: number;
  fogWeight?: number;
  movingSurfaceId?: number;
  /** Use COLOR_0 as ink paint data. Defaults to true for known stone presets with vertex colors. */
  vertexPaint?: boolean;
}

function isPreset(name: string): name is InkMaterialPreset {
  return Object.hasOwn(PRESETS, name);
}

/**
 * Create a native opaque or alpha-tested material for the ink scene pass.
 * Standard lighting, map sampling, and alpha testing stay in Three.js.
 * Provide correctly tagged textures, for example from loadGLTF(displaySpace: false).
 * The returned material borrows the source textures and owns only its own
 * material lifetime. Tint and painted cavities operate on working-space RGB.
 * The ink graph owns fog, using the source fog flag by default.
 */
export function createInkMaterial(source: MeshStandardMaterial, {
  preset: requestedPreset, lineWeight, fogWeight = source.fog ? 1 : 0, movingSurfaceId = 0, vertexPaint,
}: InkMaterialOptions = {}): MeshStandardNodeMaterial {
  if (source.isMeshStandardMaterial !== true || 'isMeshPhysicalMaterial' in source) {
    throw TypeError('Ink materials require a MeshStandardMaterial source');
  }
  const opaqueBlending = source.blending === NormalBlending || source.blending === NoBlending;
  if (source.transparent || !source.depthWrite || !source.colorWrite || !opaqueBlending) {
    throw RangeError('Ink materials require the opaque or alpha-tested depth-writing path');
  }
  const name = source.name.replace(/\.\d+$/, '').replace(/^mat_/, '');
  const namedPreset = isPreset(name) ? name : undefined;
  const preset = requestedPreset ?? namedPreset ?? 'rock';
  if (!isPreset(preset)) throw RangeError('Unknown ink material preset ' + preset);
  const style: SurfacePreset = PRESETS[preset];
  const weight = lineWeight ?? style.lineWeight;
  if (![weight, fogWeight].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw RangeError('Ink line and fog weights must be between zero and one');
  }
  // The scene stores moving IDs in a half-float attachment.
  if (!Number.isInteger(movingSurfaceId) || movingSurfaceId < 0 || movingSurfaceId > 2048) {
    throw RangeError('Ink moving surface IDs must be integers from 0 to 2048');
  }

  const material = new MeshStandardNodeMaterial().copy(source);
  const recognized = namedPreset !== undefined || requestedPreset !== undefined;
  const usesPaint = vertexPaint ?? (recognized && style.cavity !== undefined && source.vertexColors);
  const paint = usesPaint ? vertexColor() : null;
  if (paint) material.vertexColors = false;
  if (paint || style.tint) {
    // r187's materialColor may carry map alpha despite its vec3 declaration.
    // Request vec4 without replacing the original alpha-test input.
    const base = vec4(materialColor as unknown as Node<'vec4'>);
    const tinted = base.rgb.mul(vec3(...(style.tint ?? DEFAULT_TINT)));
    const cavity = paint ? mix(1, clamp(paint.r, 0, 1), style.cavity ?? 0) : 1;
    material.colorNode = vec4(tinted.mul(cavity), base.a);
  }
  material.fog = false;
  material.mrtNode = createInkSurfaceOutput({
    lineWeight: paint ? clamp(paint.a, 0, 1).mul(weight) : weight,
    fogWeight,
    movingSurfaceId,
  });
  return material;
}
