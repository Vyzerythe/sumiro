/**
 * Source reconstruction of sumiro/bundle/sight-DXR0ElmN.js
 * (Git blob 278874e5ee81a87b366e63cd9c37d05b24448556).
 * a = createMeshRaycaster, i = hasLineOfSight, n = relaxLongEdgesInPlace,
 * r = raycastVisibleSurface, t = filterTrianglesByMaxEdge.
 */
import type { Mesh, Object3D } from 'three';

const CELL_SIZE = 2;
const PARALLEL_EPSILON = 1e-9;
const SURFACE_STEP = 0.02;
const NEAR_SURFACE_DISTANCE = 0.6;
const NEAR_SURFACE_PROBE = 0.45;
const TARGET_CLEARANCE = 0.3;

interface MeshRaycasterOptions {
  twoSided?: boolean;
}

export interface SightRaycaster {
  /** Winding and unnormalized face normal of the most recent hit. A miss retains them. */
  back: boolean;
  nx: number;
  ny: number;
  nz: number;
  raycast(x: number, y: number, z: number, dx: number, dy: number, dz: number, limit: number): number;
}

export interface MeshRaycaster extends SightRaycaster {
  count(): number;
  add(positions: ArrayLike<number>, indices?: ArrayLike<number> | null, matrix?: ArrayLike<number> | null): void;
  finish(): MeshRaycaster;
}

interface GridCell<T> {
  triangles: T;
  minY: number;
  maxY: number;
}

type Position = [number, number, number];
type WritablePositions = ArrayLike<number> & { [index: number]: number };

const gridKey = (x: number, z: number) => (x + 4096) * 8192 + z + 4096;

function createTriangleRaycaster({ twoSided = false }: MeshRaycasterOptions = {}): MeshRaycaster {
  const batches: Float32Array[] = [];
  const grid = new Map<number, GridCell<Int32Array>>();
  let triangleCount = 0;
  let positions: Float32Array | undefined;
  let visited: Uint32Array;
  let rayNumber = 0;

  function add(source: ArrayLike<number>, indices: ArrayLike<number> | null = null, matrix: ArrayLike<number> | null = null) {
    const vertexCount = indices ? indices.length : source.length / 3;
    const batch = new Float32Array(Math.floor(vertexCount / 3) * 9);
    const mirrored = matrix !== null && (
      matrix[0]! * (matrix[5]! * matrix[10]! - matrix[6]! * matrix[9]!) -
      matrix[4]! * (matrix[1]! * matrix[10]! - matrix[2]! * matrix[9]!) +
      matrix[8]! * (matrix[1]! * matrix[6]! - matrix[2]! * matrix[5]!) < 0
    );
    let output = 0;
    for (let triangle = 0; triangle + 2 < vertexCount; triangle += 3) {
      for (let vertex = 0; vertex < 3; vertex++) {
        const index = triangle + (mirrored ? 2 - vertex : vertex);
        const offset = (indices ? indices[index]! : index) * 3;
        const x = source[offset]!, y = source[offset + 1]!, z = source[offset + 2]!;
        if (matrix) {
          batch[output++] = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!;
          batch[output++] = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!;
          batch[output++] = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!;
        } else {
          batch[output++] = x;
          batch[output++] = y;
          batch[output++] = z;
        }
      }
    }
    batches.push(batch);
    triangleCount += batch.length / 9;
  }

  function finish(): MeshRaycaster {
    positions = new Float32Array(triangleCount * 9);
    visited = new Uint32Array(triangleCount);
    let output = 0;
    for (const batch of batches) {
      positions.set(batch, output);
      output += batch.length;
    }
    batches.length = 0;

    const cells = new Map<number, GridCell<number[]>>();
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const offset = triangle * 9;
      const ax = positions[offset]!, ay = positions[offset + 1]!, az = positions[offset + 2]!;
      const bx = positions[offset + 3]!, by = positions[offset + 4]!, bz = positions[offset + 5]!;
      const cx = positions[offset + 6]!, cy = positions[offset + 7]!, cz = positions[offset + 8]!;
      const minX = Math.floor(Math.min(ax, bx, cx) / CELL_SIZE);
      const maxX = Math.floor(Math.max(ax, bx, cx) / CELL_SIZE);
      const minZ = Math.floor(Math.min(az, bz, cz) / CELL_SIZE);
      const maxZ = Math.floor(Math.max(az, bz, cz) / CELL_SIZE);
      const minY = Math.min(ay, by, cy);
      const maxY = Math.max(ay, by, cy);
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          const key = gridKey(x, z);
          let cell = cells.get(key);
          if (!cell) {
            cell = { triangles: [], minY, maxY };
            cells.set(key, cell);
          }
          cell.triangles.push(triangle);
          if (minY < cell.minY) cell.minY = minY;
          if (maxY > cell.maxY) cell.maxY = maxY;
        }
      }
    }
    for (const [key, cell] of cells) {
      grid.set(key, { ...cell, triangles: Int32Array.from(cell.triangles) });
    }
    return raycaster;
  }

  function raycast(x: number, y: number, z: number, dx: number, dy: number, dz: number, limit: number): number {
    if (!positions) return Infinity;
    rayNumber++;
    let nearest = limit;
    let cellX = Math.floor(x / CELL_SIZE);
    let cellZ = Math.floor(z / CELL_SIZE);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const deltaX = dx === 0 ? Infinity : CELL_SIZE / Math.abs(dx);
    const deltaZ = dz === 0 ? Infinity : CELL_SIZE / Math.abs(dz);
    let nextX = dx === 0 ? Infinity : ((dx > 0 ? cellX + 1 : cellX) * CELL_SIZE - x) / dx;
    let nextZ = dz === 0 ? Infinity : ((dz > 0 ? cellZ + 1 : cellZ) * CELL_SIZE - z) / dz;
    let entry = 0;

    // Walk the horizontal grid in ray order, testing a cell only across its vertical span.
    for (;;) {
      const exit = Math.min(nextX, nextZ, limit);
      const cell = grid.get(gridKey(cellX, cellZ));
      if (cell) {
        const entryY = y + dy * entry;
        const exitY = y + dy * exit;
        if (Math.max(entryY, exitY) >= cell.minY && Math.min(entryY, exitY) <= cell.maxY) {
          for (const triangle of cell.triangles) {
            if (visited[triangle] === rayNumber) continue;
            visited[triangle] = rayNumber;
            const offset = triangle * 9;
            const ax = positions[offset]!, ay = positions[offset + 1]!, az = positions[offset + 2]!;
            const abx = positions[offset + 3]! - ax;
            const aby = positions[offset + 4]! - ay;
            const abz = positions[offset + 5]! - az;
            const acx = positions[offset + 6]! - ax;
            const acy = positions[offset + 7]! - ay;
            const acz = positions[offset + 8]! - az;
            const px = dy * acz - dz * acy;
            const py = dz * acx - dx * acz;
            const pz = dx * acy - dy * acx;
            const determinant = abx * px + aby * py + abz * pz;
            if (determinant > -PARALLEL_EPSILON && determinant < PARALLEL_EPSILON) continue;
            const inverse = 1 / determinant;
            const ox = x - ax, oy = y - ay, oz = z - az;
            const u = (ox * px + oy * py + oz * pz) * inverse;
            if (u < 0 || u > 1) continue;
            const qx = oy * abz - oz * aby;
            const qy = oz * abx - ox * abz;
            const qz = ox * aby - oy * abx;
            const v = (dx * qx + dy * qy + dz * qz) * inverse;
            if (v < 0 || u + v > 1) continue;
            const distance = (acx * qx + acy * qy + acz * qz) * inverse;
            if (distance >= 0 && distance < nearest) {
              nearest = distance;
              raycaster.back = !twoSided && determinant < 0;
              raycaster.nx = aby * acz - abz * acy;
              raycaster.ny = abz * acx - abx * acz;
              raycaster.nz = abx * acy - aby * acx;
            }
          }
        }
      }
      if (nearest <= exit || exit >= limit) break;
      entry = exit;
      if (nextX < nextZ) {
        cellX += stepX;
        nextX += deltaX;
      } else {
        cellZ += stepZ;
        nextZ += deltaZ;
      }
    }
    return nearest < limit ? nearest : Infinity;
  }

  const raycaster: MeshRaycaster = { back: false, nx: 0, ny: 0, nz: 0, count: () => triangleCount, add, finish, raycast };
  return raycaster;
}

/** Index named meshes with their current world matrices and return the finished raycaster. */
export function createMeshRaycaster(root: Object3D, names: RegExp | string, options?: MeshRaycasterOptions): MeshRaycaster {
  const raycaster = createTriangleRaycaster(options);
  const pattern = names instanceof RegExp ? names : new RegExp(names);
  root.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !pattern.test(mesh.name)) return;
    const positions = mesh.geometry.attributes.position;
    if (!positions) return;
    let coordinates: ArrayLike<number>;
    const interleaved = 'isInterleavedBufferAttribute' in positions && positions.isInterleavedBufferAttribute;
    if (interleaved || positions.normalized) {
      const unpacked = new Float32Array(positions.count * 3);
      for (let vertex = 0; vertex < positions.count; vertex++) {
        unpacked[vertex * 3] = positions.getX(vertex);
        unpacked[vertex * 3 + 1] = positions.getY(vertex);
        unpacked[vertex * 3 + 2] = positions.getZ(vertex);
      }
      coordinates = unpacked;
    } else {
      coordinates = positions.array;
    }
    raycaster.add(coordinates, mesh.geometry.index?.array ?? null, mesh.matrixWorld.elements);
  });
  return raycaster.finish();
}

/** Skip back faces and probe for a second hit behind a nearby front face. */
export function raycastVisibleSurface(
  raycaster: SightRaycaster, x: number, y: number, z: number,
  dx: number, dy: number, dz: number, limit: number,
): number {
  let start = 0;
  for (let step = 0; step < 6 && start < limit; step++) {
    const distance = raycaster.raycast(x + dx * start, y + dy * start, z + dz * start, dx, dy, dz, limit - start);
    if (distance === Infinity) return Infinity;
    const hit = start + distance;
    if (raycaster.back) {
      start = hit + SURFACE_STEP;
      continue;
    }
    if (hit >= NEAR_SURFACE_DISTANCE) return hit;
    const { nx, ny, nz } = raycaster;
    const probeStart = hit + SURFACE_STEP;
    const probe = raycaster.raycast(
      x + dx * probeStart, y + dy * probeStart, z + dz * probeStart,
      dx, dy, dz, NEAR_SURFACE_PROBE,
    );
    if (probe === Infinity) return hit;
    start = probeStart + probe + SURFACE_STEP;
    raycaster.nx = nx;
    raycaster.ny = ny;
    raycaster.nz = nz;
  }
  return Infinity;
}

/** Test the segment up to the clearance immediately before the target. */
export function hasLineOfSight(
  raycaster: Pick<SightRaycaster, 'raycast'>, x: number, y: number, z: number,
  targetX: number, targetY: number, targetZ: number,
): boolean {
  const dx = targetX - x, dy = targetY - y, dz = targetZ - z;
  const distance = Math.hypot(dx, dy, dz) || 1;
  return distance <= TARGET_CLEARANCE || raycaster.raycast(
    x, y, z, dx / distance, dy / distance, dz / distance, distance - TARGET_CLEARANCE,
  ) === Infinity;
}

/** Keep complete triangles whose three edges are within the maximum length. */
export function filterTrianglesByMaxEdge(indices: ArrayLike<number>, positions: ArrayLike<number>, maxEdge: number): number[] {
  const filtered: number[] = [];
  const limit = maxEdge * maxEdge;
  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    let kept = true;
    for (let vertex = 0; vertex < 3; vertex++) {
      const from = indices[triangle + vertex]! * 3;
      const to = indices[triangle + (vertex + 1) % 3]! * 3;
      if ((positions[from]! - positions[to]!) ** 2 +
          (positions[from + 1]! - positions[to + 1]!) ** 2 +
          (positions[from + 2]! - positions[to + 2]!) ** 2 > limit) kept = false;
    }
    if (kept) filtered.push(indices[triangle]!, indices[triangle + 1]!, indices[triangle + 2]!);
  }
  return filtered;
}

/** Move vertices with multiple long edges to the average position of their neighbors. */
export function relaxLongEdgesInPlace(indices: ArrayLike<number>, positions: WritablePositions, maxEdge: number): void {
  const vertexKey = (vertex: number) => {
    const offset = vertex * 3;
    const x = positions[offset]!.toFixed(3);
    const y = positions[offset + 1]!.toFixed(3);
    const z = positions[offset + 2]!.toFixed(3);
    return `${x},${y},${z}`;
  };
  const vertices = new Map<string, number[]>();
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const key = vertexKey(vertex);
    let group = vertices.get(key);
    if (!group) {
      group = [];
      vertices.set(key, group);
    }
    group.push(vertex);
  }

  const neighbors = new Map<string, Set<string>>();
  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    for (let vertex = 0; vertex < 3; vertex++) {
      const from = vertexKey(indices[triangle + vertex]!);
      const to = vertexKey(indices[triangle + (vertex + 1) % 3]!);
      if (!neighbors.has(from)) neighbors.set(from, new Set());
      if (!neighbors.has(to)) neighbors.set(to, new Set());
      neighbors.get(from)!.add(to);
      neighbors.get(to)!.add(from);
    }
  }

  const coordinates = new Map<string, Position>();
  for (const [key, group] of vertices) {
    const offset = group[0]! * 3;
    coordinates.set(key, [positions[offset]!, positions[offset + 1]!, positions[offset + 2]!]);
  }
  const limit = maxEdge * maxEdge;
  for (let iteration = 0; iteration < 32; iteration++) {
    let selected: string | undefined;
    let mostLongEdges = 1;
    for (const [key, adjacent] of neighbors) {
      const [x, y, z] = coordinates.get(key)!;
      let longEdges = 0;
      for (const neighbor of adjacent) {
        const [nx, ny, nz] = coordinates.get(neighbor)!;
        if ((x - nx) ** 2 + (y - ny) ** 2 + (z - nz) ** 2 > limit) longEdges++;
      }
      if (longEdges > mostLongEdges) {
        mostLongEdges = longEdges;
        selected = key;
      }
    }
    if (!selected) break;
    const average: Position = [0, 0, 0];
    const adjacent = neighbors.get(selected)!;
    for (const neighbor of adjacent) {
      const [x, y, z] = coordinates.get(neighbor)!;
      average[0] += x / adjacent.size;
      average[1] += y / adjacent.size;
      average[2] += z / adjacent.size;
    }
    coordinates.set(selected, average);
    for (const vertex of vertices.get(selected)!) {
      positions[vertex * 3] = average[0];
      positions[vertex * 3 + 1] = average[1];
      positions[vertex * 3 + 2] = average[2];
    }
  }
}
