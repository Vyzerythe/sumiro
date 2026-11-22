/**
 * Source reconstruction of the published collision world.
 *
 * This preserves the shipped query algorithms and their mutable result
 * objects. It is not the upstream original source, nor a new physics engine.
 *
 * Reference: sumiro/bundle/collision-DtBQEpmQ.js (Git blob
 * bb06154a9be5a24421a017f4c84adf7c87064d1b).
 */
import { createMovingTriangleBody } from "./moving-body.mts";
import type { MovingTriangleBatch, MovingTriangleBody, TriangleCoordinates } from "./moving-body.mts";

export type CollisionSurface = string | number | null;

export interface CollisionPosition {
  x: number;
  y: number;
  z: number;
}

/** Static and moving triangles share this query representation. */
export interface CollisionTriangle extends TriangleCoordinates {
  kind: number;
  surface: CollisionSurface;
  group: string | null;
  fades: string | null;
  round?: boolean;
  body?: MovingTriangleBody;
}

export type StaticTriangleOptions = Partial<Pick<CollisionTriangle, "kind" | "surface" | "group" | "fades" | "round">>;

export interface CollisionDisc {
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
}

export interface GroundHit {
  y: number;
  nx: number;
  ny: number;
  nz: number;
  surface: CollisionSurface;
  body: MovingTriangleBody | null;
}

export interface CapsuleOptions {
  radius?: number;
  height?: number;
  guards?: boolean;
  solid?: boolean;
}

export interface CapsuleHit {
  x: number;
  z: number;
  depth: number;
  hit: boolean;
  kind: number;
  nx: number;
  nz: number;
  group: string | null;
  round: boolean;
  solid: boolean;
  body: MovingTriangleBody | null;
}

type SweepResult<Output extends object> = Omit<Output, keyof CapsuleHit> & CapsuleHit;

export interface CollisionWorld {
  /** Fade identifier from the latest raycast hit, or null. */
  rayFades: string | null;
  addTriangles(positions: TriangleCoordinates, options?: StaticTriangleOptions): void;
  addDisc(x: number, z: number, radius: number, y0: number, y1: number): void;
  addBody(id: string, batches: Iterable<MovingTriangleBatch>): MovingTriangleBody;
  body(id: string): MovingTriangleBody | null;
  /** A successful query overwrites the previous hit object from this world. */
  groundAt(x: number, z: number, maxY?: number, minY?: number): GroundHit | null;
  /** Mutates and returns the supplied result or creates one when omitted. */
  sweepCapsule(start: Readonly<CollisionPosition>, dx: number, dz: number, options?: CapsuleOptions, result?: undefined): CapsuleHit;
  sweepCapsule<Output extends object>(start: Readonly<CollisionPosition>, dx: number, dz: number,
    options: CapsuleOptions | undefined, result: Output): SweepResult<Output>;
  raycast(x: number, y: number, z: number, dx: number, dy: number, dz: number, length: number, kinds?: number): number;
  setGroup(group: string, enabled: boolean): void;
  stats(): { triangles: number; cells: number };
  /** These lists expose the world's live storage. */
  triangles(): CollisionTriangle[];
  discs(): CollisionDisc[];
}

const CELL_SIZE = 2;
const SOLID_MARGIN = 0.35;
const cellKey = (x: number, z: number) => (x + 4096) * 8192 + z + 4096;

function isDegenerate(tri: TriangleCoordinates) {
  const ax = tri[3]! - tri[0]!, ay = tri[4]! - tri[1]!, az = tri[5]! - tri[2]!;
  const bx = tri[6]! - tri[0]!, by = tri[7]! - tri[1]!, bz = tri[8]! - tri[2]!;
  return (ay * bz - az * by) ** 2 +
    (az * bx - ax * bz) ** 2 +
    (ax * by - ay * bx) ** 2 < 1e-12;
}

/**
 * Fresh isolated world with a borrowed ground result and caller-owned capsule output.
 */
export function createCollisionWorld(): CollisionWorld {
  const triangles: CollisionTriangle[] = [];
  const discs: CollisionDisc[] = [];
  const bodies: MovingTriangleBody[] = [];
  const cells = new Map<number, CollisionTriangle[]>();
  const disabledGroups = new Set<string>();
  const groundResult: GroundHit = { y: 0, nx: 0, ny: 1, nz: 0, surface: null, body: null };
  const nearest = { x: 0, y: 0, z: 0 };
  const visited = new Set<CollisionTriangle>();

  function insertIntoGrid(triangle: CollisionTriangle) {
    const minX = Math.floor(Math.min(triangle[0]!, triangle[3]!, triangle[6]!) / CELL_SIZE);
    const maxX = Math.floor(Math.max(triangle[0]!, triangle[3]!, triangle[6]!) / CELL_SIZE);
    const minZ = Math.floor(Math.min(triangle[2]!, triangle[5]!, triangle[8]!) / CELL_SIZE);
    const maxZ = Math.floor(Math.max(triangle[2]!, triangle[5]!, triangle[8]!) / CELL_SIZE);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const key = cellKey(x, z);
      let list = cells.get(key);
      if (!list) cells.set(key, list = []);
      list.push(triangle);
    }
  }

  function addTriangles(positions: TriangleCoordinates,
    { kind = 1, surface = null, group = null, fades = null, round = false }: StaticTriangleOptions = {}) {
    for (let offset = 0; offset + 8 < positions.length; offset += 9) {
      // Keep the source array's storage type and attach metadata before indexing.
      const tri = positions.slice(offset, offset + 9) as CollisionTriangle;
      if (isDegenerate(tri)) continue;
      tri.kind = kind;
      tri.surface = surface;
      tri.group = group;
      tri.fades = fades;
      tri.round = round;
      triangles.push(tri);
      insertIntoGrid(tri);
    }
  }

  const isActive = (tri: CollisionTriangle) => tri.group === null || !disabledGroups.has(tri.group);

  function hasNearbySolid(x: number, z: number, baseY: number, height: number, margin: number) {
    const cell = cells.get(cellKey(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE)));
    if (!cell) return false;
    let above = Infinity, below = -Infinity;
    for (const tri of cell) {
      if (!(tri.kind & 1) || !isActive(tri)) continue;
      const det = (tri[5]! - tri[8]!) * (tri[0]! - tri[6]!) +
        (tri[6]! - tri[3]!) * (tri[2]! - tri[8]!);
      if (det > -1e-9 && det < 1e-9) continue;
      const u = ((tri[5]! - tri[8]!) * (x - tri[6]!) +
        (tri[6]! - tri[3]!) * (z - tri[8]!)) / det;
      const v = ((tri[8]! - tri[2]!) * (x - tri[6]!) +
        (tri[0]! - tri[6]!) * (z - tri[8]!)) / det;
      if (u < -1e-4 || v < -1e-4 || u + v > 1.0001) continue;
      const y = u * tri[1]! + v * tri[4]! + (1 - u - v) * tri[7]!;
      if (y > baseY + margin) above = Math.min(above, y);
      else below = Math.max(below, y);
    }
    return above === Infinity ? false : above - baseY < height || below < above - 20;
  }

  function blocksSweep(x: number, z: number, dx: number, dz: number,
    distance: number, y: number, radius: number, height: number) {
    return hasNearbySolid(x + dx, z + dz, y, height, SOLID_MARGIN) ||
      hasNearbySolid(x + dx + dx / distance * radius, z + dz + dz / distance * radius,
        y, height, SOLID_MARGIN + radius);
  }

  function deflectFromSolid(x: number, z: number, y: number, height: number, radius: number,
    dx: number, dz: number, result: Pick<CapsuleHit, "nx" | "nz">) {
    let pushX = 0, pushZ = 0;
    for (let sample = 0; sample < 12; sample++) {
      const cosine = Math.cos(sample / 12 * Math.PI * 2);
      const sine = Math.sin(sample / 12 * Math.PI * 2);
      if (hasNearbySolid(x + cosine * radius * 1.5,
        z + sine * radius * 1.5, y, height, SOLID_MARGIN)) {
        pushX -= cosine;
        pushZ -= sine;
      }
    }
    const length = Math.hypot(pushX, pushZ);
    const travel = Math.hypot(dx, dz) || 1;
    result.nx = length > .001 ? pushX / length : -dx / travel;
    result.nz = length > .001 ? pushZ / length : -dz / travel;
  }

  let bestGroundHeight = -Infinity;
  let bestGroundTriangle: CollisionTriangle | null = null;
  function scanGround(list: readonly CollisionTriangle[], x: number, z: number, maxY: number, minY: number) {
    for (const tri of list) {
      if (!(tri.kind & 1) || !isActive(tri)) continue;
      const det = (tri[5]! - tri[8]!) * (tri[0]! - tri[6]!) +
        (tri[6]! - tri[3]!) * (tri[2]! - tri[8]!);
      if (det > -1e-9 && det < 1e-9) continue;
      const u = ((tri[5]! - tri[8]!) * (x - tri[6]!) +
        (tri[6]! - tri[3]!) * (z - tri[8]!)) / det;
      const v = ((tri[8]! - tri[2]!) * (x - tri[6]!) +
        (tri[0]! - tri[6]!) * (z - tri[8]!)) / det;
      if (u < -1e-4 || v < -1e-4 || u + v > 1.0001) continue;
      const y = u * tri[1]! + v * tri[4]! + (1 - u - v) * tri[7]!;
      if (y <= maxY && y >= minY && y > bestGroundHeight) {
        bestGroundHeight = y;
        bestGroundTriangle = tri;
      }
    }
  }

  function groundAt(x: number, z: number, maxY = Infinity, minY = -Infinity): GroundHit | null {
    bestGroundHeight = -Infinity;
    bestGroundTriangle = null;
    const cell = cells.get(cellKey(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE)));
    if (cell) scanGround(cell, x, z, maxY, minY);
    for (const body of bodies) {
      if (body.enabled && x >= body.minX && x <= body.maxX &&
        z >= body.minZ && z <= body.maxZ) {
        scanGround(body.tris, x, z, maxY, minY);
      }
    }
    // scanGround can populate the shared candidate after the reset above.
    const tri = bestGroundTriangle as CollisionTriangle | null;
    if (!tri) return null;
    const ax = tri[3]! - tri[0]!, ay = tri[4]! - tri[1]!, az = tri[5]! - tri[2]!;
    const bx = tri[6]! - tri[0]!, by = tri[7]! - tri[1]!, bz = tri[8]! - tri[2]!;
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const norm = Math.hypot(nx, ny, nz) || 1;
    if (ny < 0 && norm) { nx = -nx; ny = -ny; nz = -nz; }
    groundResult.y = bestGroundHeight;
    groundResult.nx = nx / norm;
    groundResult.ny = ny / norm;
    groundResult.nz = nz / norm;
    groundResult.surface = tri.surface;
    groundResult.body = tri.body ?? null;
    return groundResult;
  }

  function closestPointOnTriangle(tri: CollisionTriangle, x: number, y: number, z: number) {
    const ax = tri[3]! - tri[0]!, ay = tri[4]! - tri[1]!, az = tri[5]! - tri[2]!;
    const bx = tri[6]! - tri[0]!, by = tri[7]! - tri[1]!, bz = tri[8]! - tri[2]!;
    const dx = x - tri[0]!, dy = y - tri[1]!, dz = z - tri[2]!;
    const u = ax * dx + ay * dy + az * dz;
    const v = bx * dx + by * dy + bz * dz;
    const set = (px: number, py: number, pz: number) => { nearest.x = px; nearest.y = py; nearest.z = pz; };
    if (u <= 0 && v <= 0) return set(tri[0]!, tri[1]!, tri[2]!);
    const ex = x - tri[3]!, ey = y - tri[4]!, ez = z - tri[5]!;
    const w = ax * ex + ay * ey + az * ez;
    const q = bx * ex + by * ey + bz * ez;
    if (w >= 0 && q <= w) return set(tri[3]!, tri[4]!, tri[5]!);
    const abEdge = u * q - w * v;
    if (abEdge <= 0 && u >= 0 && w <= 0) {
      const factor = u / (u - w);
      return set(tri[0]! + ax * factor, tri[1]! + ay * factor, tri[2]! + az * factor);
    }
    const fx = x - tri[6]!, fy = y - tri[7]!, fz = z - tri[8]!;
    const s = ax * fx + ay * fy + az * fz;
    const t = bx * fx + by * fy + bz * fz;
    if (t >= 0 && s <= t) return set(tri[6]!, tri[7]!, tri[8]!);
    const acEdge = s * v - u * t;
    if (acEdge <= 0 && v >= 0 && t <= 0) {
      const factor = v / (v - t);
      return set(tri[0]! + bx * factor, tri[1]! + by * factor, tri[2]! + bz * factor);
    }
    const bcEdge = w * t - s * q;
    if (bcEdge <= 0 && q - w >= 0 && s - t >= 0) {
      const factor = (q - w) / (q - w + s - t);
      return set(
        tri[3]! + (tri[6]! - tri[3]!) * factor,
        tri[4]! + (tri[7]! - tri[4]!) * factor,
        tri[5]! + (tri[8]! - tri[5]!) * factor,
      );
    }
    const divisor = 1 / (bcEdge + acEdge + abEdge);
    const weight1 = acEdge * divisor;
    const weight2 = abEdge * divisor;
    return set(
      tri[0]! + ax * weight1 + bx * weight2,
      tri[1]! + ay * weight1 + by * weight2,
      tri[2]! + az * weight1 + bz * weight2,
    );
  }

  function collideCapsule(point: CollisionPosition, radius: number, height: number, kinds: number, contact: CapsuleHit) {
    const levels = [point.y + radius + .05, point.y + height * .5, point.y + height - radius];
    const minX = Math.floor((point.x - radius) / CELL_SIZE);
    const maxX = Math.floor((point.x + radius) / CELL_SIZE);
    const minZ = Math.floor((point.z - radius) / CELL_SIZE);
    const maxZ = Math.floor((point.z + radius) / CELL_SIZE);
    visited.clear();
    let hit = false;
    const resolveTriangle = (tri: CollisionTriangle) => {
      for (const level of levels) {
        closestPointOnTriangle(tri, point.x, level, point.z);
        const dx = point.x - nearest.x, dy = level - nearest.y, dz = point.z - nearest.z;
        if (!(dx * dx + dy * dy + dz * dz < radius * radius)) continue;
        const distance = Math.hypot(dx, dz);
        if (distance < 1e-5) continue;
        const depth = Math.sqrt(Math.max(radius * radius - dy * dy, 0)) - distance;
        if (depth <= 0) continue;
        point.x += dx / distance * depth;
        point.z += dz / distance * depth;
        hit = true;
        if (contact && depth >= contact.depth) {
          contact.depth = depth;
          contact.nx = dx / distance;
          contact.nz = dz / distance;
          contact.kind = tri.kind;
          contact.group = tri.group;
          contact.round = !!tri.round;
          contact.body = tri.body ?? null;
        }
      }
    };
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const list = cells.get(cellKey(x, z));
      if (list) for (const tri of list) {
        if ((tri.kind & kinds) && !visited.has(tri) && isActive(tri)) {
          visited.add(tri);
          resolveTriangle(tri);
        }
      }
    }
    for (const body of bodies) {
      if (!body.enabled || point.x < body.minX - radius || point.x > body.maxX + radius ||
        point.z < body.minZ - radius || point.z > body.maxZ + radius) continue;
      for (const tri of body.tris) if (tri.kind & kinds) resolveTriangle(tri);
    }
    for (const disc of discs) {
      if (point.y + height < disc.y0 || point.y > disc.y1) continue;
      const dx = point.x - disc.x, dz = point.z - disc.z;
      const distance = Math.hypot(dx, dz);
      const depth = disc.r + radius - distance;
      if (depth <= 0) continue;
      const nx = distance > 1e-5 ? dx / distance : 1;
      const nz = distance > 1e-5 ? dz / distance : 0;
      point.x += nx * depth;
      point.z += nz * depth;
      hit = true;
      if (contact && depth >= contact.depth) {
        contact.depth = depth;
        contact.nx = nx; contact.nz = nz;
        contact.kind = 2; contact.group = null; contact.round = true;
      }
    }
    return hit;
  }

  function sweepCapsule<Output extends object = object>(start: Readonly<CollisionPosition>, dx: number, dz: number,
    { radius = .3, height = 1.7, guards = true, solid = false }: CapsuleOptions = {}, out = {} as Output,
  ): SweepResult<Output> {
    const kinds = 2 | (guards ? 4 : 0);
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (radius * .6)));
    const point = { x: start.x, y: start.y, z: start.z };
    // All contact fields are initialized below, with x and z filled on both return paths.
    const result = out as SweepResult<Output>;
    result.depth = 0; result.hit = false; result.kind = 0;
    result.nx = 0; result.nz = 0; result.group = null;
    result.round = false; result.solid = false; result.body = null;
    if (!Number.isFinite(start.x + start.z + dx + dz)) {
      result.x = start.x; result.z = start.z;
      return result;
    }
    for (let step = 0; step < count; step++) {
      let stepX = dx / count, stepZ = dz / count;
      let stepLength = Math.hypot(stepX, stepZ);
      if (solid && stepLength > 1e-6 &&
        !hasNearbySolid(point.x, point.z, point.y, height, SOLID_MARGIN) &&
        blocksSweep(point.x, point.z, stepX, stepZ, stepLength, point.y, radius, height)) {
        deflectFromSolid(point.x, point.z, point.y, height, radius,
          stepX, stepZ, result);
        result.hit = true; result.solid = true; result.kind = 2;
        const intoWall = stepX * result.nx + stepZ * result.nz;
        if (intoWall < 0) { stepX -= result.nx * intoWall; stepZ -= result.nz * intoWall; }
        stepLength = Math.hypot(stepX, stepZ);
        if (stepLength < 1e-5 ||
          blocksSweep(point.x, point.z, stepX, stepZ, stepLength, point.y, radius, height)) {
          stepX = stepZ = 0;
        }
      }
      point.x += stepX; point.z += stepZ;
      for (let iteration = 0; iteration < 2; iteration++) {
        if (collideCapsule(point, radius, height, kinds, result)) result.hit = true;
      }
    }
    result.x = point.x; result.z = point.z;
    return result;
  }

  const world: CollisionWorld = {
    rayFades: null,
    addTriangles,
    addDisc(x, z, radius, y0, y1) { discs.push({ x, z, r: radius, y0, y1 }); },
    addBody(id, batches) {
      const body = createMovingTriangleBody(id, batches);
      bodies.push(body);
      return body;
    },
    body(id) { return bodies.find(body => body.id === id) ?? null; },
    groundAt,
    sweepCapsule,
    raycast(x, y, z, dx, dy, dz, length, kinds = 10) {
      let distance = length;
      world.rayFades = null;
      visited.clear();
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) * length / 1));
      const rayTriangle = (tri: CollisionTriangle) => {
        const ax = tri[3]! - tri[0]!, ay = tri[4]! - tri[1]!, az = tri[5]! - tri[2]!;
        const bx = tri[6]! - tri[0]!, by = tri[7]! - tri[1]!, bz = tri[8]! - tri[2]!;
        const px = dy*bz-dz*by, py = dz*bx-dx*bz, pz = dx*by-dy*bx;
        const det = ax*px+ay*py+az*pz;
        if (det > -1e-8 && det < 1e-8) return;
        const inv = 1/det;
        const tx = x - tri[0]!, ty = y - tri[1]!, tz = z - tri[2]!;
        const u = (tx*px+ty*py+tz*pz)*inv;
        if (u < 0 || u > 1) return;
        const qx = ty*az-tz*ay, qy = tz*ax-tx*az, qz = tx*ay-ty*ax;
        const v = (dx*qx+dy*qy+dz*qz)*inv;
        if (v < 0 || u+v > 1) return;
        const t = (bx*qx+by*qy+bz*qz)*inv;
        if (t >= 0 && t < distance) { distance = t; world.rayFades = tri.fades; }
      };
      const visitCell = (cx: number, cz: number) => {
        const list = cells.get(cellKey(cx, cz));
        if (list) for (const tri of list) {
          if ((tri.kind & kinds) && !visited.has(tri) && isActive(tri)) {
            visited.add(tri); rayTriangle(tri);
          }
        }
      };
      let previousX: number | null = null;
      let previousZ = 0;
      for (let step = 0; step <= steps; step++) {
        const travel = step / steps * length;
        if (travel - 4 > distance) break;
        const cx = Math.floor((x+dx*travel)/CELL_SIZE);
        const cz = Math.floor((z+dz*travel)/CELL_SIZE);
        if (previousX !== null && previousX !== cx && previousZ !== cz) {
          visitCell(previousX, cz);
          visitCell(cx, previousZ);
        }
        visitCell(cx, cz);
        previousX = cx; previousZ = cz;
      }
      for (const body of bodies) if (body.enabled) {
        for (const tri of body.tris) if (tri.kind & kinds) rayTriangle(tri);
      }
      return distance < length ? distance : Infinity;
    },
    setGroup(group, enabled) {
      if (enabled) disabledGroups.delete(group);
      else disabledGroups.add(group);
    },
    stats: () => ({ triangles: triangles.length, cells: cells.size }),
    triangles: () => triangles,
    discs: () => discs,
  };
  return world;
}
