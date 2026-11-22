import { pointInPolygon } from './geometry.mts';
import type { PointXZ } from './geometry.mts';
import type { CollisionWorld } from './world.mts';

// Layout and terrain rules from ch1_climb-D1obDXnH.js (Q, Be, Ve, $, He).
export const chapterOneGroundGrid = Object.freeze({
  x0: -5,
  z0: -68,
  spacing: 0.2,
  width: 136,
  height: 390,
  heightScale: 500,
});

const MISSING_HEIGHT = -32768;
const MAX_SLOPE_HEIGHT = 0.9;
const EDGE_SAMPLE_RADIUS = 3;
const FALLBACK_RADIUS = 12;
const surfacesByCode = [null, 'stone', 'wood', 'stair', 'rock', 'ink-rock'] as const;

type GroundBytes = ArrayBufferLike | ArrayBufferView;
type GroundSurface = NonNullable<(typeof surfacesByCode)[number]>;

export interface GroundRegion {
  poly: readonly PointXZ[];
}

export interface GroundAsset {
  readonly heights: Int16Array;
  readonly surfaces: Uint8Array;
  at(column: number, row: number): number | null;
  node(x: number, z: number): readonly [column: number, row: number];
}

/** Read the complete little-endian height plane followed by the surface plane. */
export function decodeGroundAsset(bytes: GroundBytes): GroundAsset {
  const { x0, z0, spacing, width, height, heightScale } = chapterOneGroundGrid;
  const count = width * height;
  const heightBytes = count * Int16Array.BYTES_PER_ELEMENT;
  const view = ArrayBuffer.isView(bytes)
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new DataView(bytes);
  const expectedBytes = heightBytes + count;
  if (view.byteLength !== expectedBytes) {
    throw new RangeError(`Chapter One ground asset has ${view.byteLength} bytes; expected ${expectedBytes}`);
  }

  const heights = new Int16Array(count);
  for (let index = 0; index < count; index++) {
    heights[index] = view.getInt16(index * Int16Array.BYTES_PER_ELEMENT, true);
  }
  const surfaces = new Uint8Array(view.buffer, view.byteOffset + heightBytes, count).slice();
  return {
    heights,
    surfaces,
    at(column, row) {
      if (!Number.isInteger(column) || !Number.isInteger(row) ||
        column < 0 || row < 0 || column >= width || row >= height) return null;
      const sample = heights[row * width + column]!;
      return sample === MISSING_HEIGHT ? null : sample / heightScale;
    },
    node(x, z) {
      return [Math.round((x - x0) / spacing), Math.round((z - z0) / spacing)];
    },
  };
}

function highestSample(ground: GroundAsset, column: number, row: number, radius: number, perimeter: boolean): number | null {
  let highest: number | null = null;
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
    if (perimeter && Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
    const sample = ground.at(column + dx, row + dz);
    if (sample !== null && (highest === null || sample > highest)) highest = sample;
  }
  return highest;
}

function searchGroundRings(ground: GroundAsset, column: number, row: number): number {
  for (let radius = 0; radius <= FALLBACK_RADIUS; radius++) {
    const sample = highestSample(ground, column, row, radius, true);
    if (sample !== null) return sample;
  }
  return 0;
}

/** Match the published height sampler used to place authored edges. */
export function sampleGroundEdgeHeight(ground: GroundAsset, x: number, z: number): number {
  const [column, row] = ground.node(x, z);
  return highestSample(ground, column, row, EDGE_SAMPLE_RADIUS, false) ?? searchGroundRings(ground, column, row);
}

/** Validate and build every terrain batch before modifying the supplied world. */
export function installGroundAsset(
  world: Pick<CollisionWorld, 'addTriangles'>,
  bytes: GroundBytes,
  regions: readonly GroundRegion[],
): GroundAsset {
  const ground = decodeGroundAsset(bytes);
  const { x0, z0, spacing, width, height } = chapterOneGroundGrid;
  const batches = new Map<GroundSurface, number[]>();

  for (let row = 0; row < height - 1; row++) for (let column = 0; column < width - 1; column++) {
    const centerX = x0 + (column + 0.5) * spacing;
    const centerZ = z0 + (row + 0.5) * spacing;
    if (!regions.some(({ poly }) => pointInPolygon(centerX, centerZ, poly))) continue;

    const surface = surfacesByCode[ground.surfaces[row * width + column]!] ?? 'rock';
    let positions = batches.get(surface);
    if (!positions) {
      positions = [];
      batches.set(surface, positions);
    }

    const x = x0 + column * spacing;
    const z = z0 + row * spacing;
    const nextX = x + spacing;
    const nextZ = z + spacing;
    let topLeft = ground.at(column, row);
    let topRight = ground.at(column + 1, row);
    let bottomRight = ground.at(column + 1, row + 1);
    let bottomLeft = ground.at(column, row + 1);
    const available = [topLeft, topRight, bottomRight, bottomLeft].filter(sample => sample !== null);
    const highest = Math.max(...available);

    // Fill incomplete cells and sharp discontinuities with a horizontal pair of triangles.
    if (topLeft === null || topRight === null || bottomRight === null || bottomLeft === null ||
      highest - Math.min(...available) > MAX_SLOPE_HEIGHT) {
      const [nearColumn, nearRow] = ground.node(centerX, centerZ);
      topLeft = topRight = bottomRight = bottomLeft = available.length > 0
        ? highest
        : searchGroundRings(ground, nearColumn, nearRow);
    }
    positions.push(
      x, topLeft, z, nextX, topRight, z, nextX, bottomRight, nextZ,
      x, topLeft, z, nextX, bottomRight, nextZ, x, bottomLeft, nextZ,
    );
  }

  for (const [surface, positions] of batches) world.addTriangles(positions, { kind: 1, surface });
  return ground;
}
