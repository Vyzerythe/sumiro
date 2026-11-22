import type { Node, TextureNode } from 'three/webgpu';
import {
  clamp, dot, exp, fract, length, max, min, pow,
  screenCoordinate, screenSize, screenUV, textureSize, vec2, vec3, vec4,
} from 'three/tsl';

type Rgb = readonly [number, number, number];

interface InkGradeSettings {
  filterRadiusPixels: number;
  shoulder: number;
  ceiling: number;
  vignette: { strength: Rgb; power: number };
  cornerBurn: { strength: Rgb; power: number };
  ditherAmplitude: number;
}

const DEFAULT_GRADE: InkGradeSettings = {
  filterRadiusPixels: 0.5,
  shoulder: 0.78,
  ceiling: 0.85,
  vignette: { strength: [0.253, 0.325, 0.4], power: 2.258 },
  cornerBurn: { strength: [0.22, 0.23, 0.24], power: 4.6 },
  ditherAmplitude: 1 / 255,
};

/**
 * Grades a linear scene texture. The outer render pipeline owns conversion
 * to the display color space.
 */
export function createInkGrade(input: TextureNode, settings: InkGradeSettings = DEFAULT_GRADE) {
  const { filterRadiusPixels, shoulder, ceiling, vignette, cornerBurn, ditherAmplitude } = settings;
  const compressionRange = ceiling - shoulder;
  if (!Number.isFinite(compressionRange) || compressionRange <= 0) {
    throw RangeError('Ink grade ceiling must be above the shoulder');
  }

  // r187's TextureSizeNode is a uvec2, which its declaration does not expose.
  const inputResolution = vec2(textureSize(input) as unknown as Node<'uvec2'>);
  const scale = inputResolution.y.div(screenSize.y);
  const offset = vec2(filterRadiusPixels).mul(scale).div(inputResolution);
  const horizontal = vec2(offset.x, 0);
  const vertical = vec2(0, offset.y);
  const filtered = input.sample(screenUV).rgb.mul(0.4)
    .add(input.sample(screenUV.add(horizontal)).rgb.mul(0.15))
    .add(input.sample(screenUV.sub(horizontal)).rgb.mul(0.15))
    .add(input.sample(screenUV.add(vertical)).rgb.mul(0.15))
    .add(input.sample(screenUV.sub(vertical)).rgb.mul(0.15));

  const excess = max(filtered.sub(shoulder), vec3(0));
  const compressed = exp(excess.div(-compressionRange)).oneMinus().mul(compressionRange);
  const tone = min(filtered, vec3(shoulder)).add(compressed);
  const radius = clamp(length(screenUV.mul(2).sub(1)).div(Math.SQRT2), 0, 1);
  const vignetteFactor = vec3(...vignette.strength).mul(pow(radius, vignette.power)).oneMinus();
  const burnFactor = vec3(...cornerBurn.strength).mul(pow(radius, cornerBurn.power)).oneMinus();

  // Match the legacy lower-left pixel origin for the dithering pattern.
  const pixel = vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y));
  const grain = fract(fract(dot(pixel, vec2(0.06711056, 0.00583715))).mul(52.9829189));
  const dither = grain.sub(0.5).mul(ditherAmplitude);
  return vec4(tone.mul(vignetteFactor).mul(burnFactor).add(dither), 1);
}
