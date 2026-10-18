import type { Zone } from '../data/types';
import { chunkCoord, chunkKey } from './ChunkPlanner';
import { boxColliderAt, circleCollider, type Collider } from './Colliders';

const DEG = Math.PI / 180;

export type StructureDef = NonNullable<Zone['structures']>[number];

/**
 * An invisible wall: collision only, nothing is drawn (StructureLayer skips it) and the camera
 * passes through it (no `solid` box). Buried in a cliff or ridge it makes a natural boundary
 * really hold: the mover's slope rule is per movement direction, so any slope can be inched up
 * at a grazing angle, a collider cannot.
 */
export const BARRIER_MODEL = 'placeholder:barrier';

/**
 * Collider fractions of a structure model (from StructureFactory): circle radius as a fraction
 * of the larger footprint side (trunk, pillar); corner posts' offset from the center and radius.
 */
export interface StructureShape {
  circleRadius: number;
  postOffset: number;
  postRadius: number;
}

/** Axis-aligned 3D box that blocks the camera (walls, towers; not platforms or bridges). */
export interface SolidBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** A structure with everything worked out: where it is drawn, what blocks, which chunks. */
export interface PlacedStructure {
  readonly def: StructureDef;
  readonly zoneId: string;
  /** Center of the base. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Rotation around y (radians) and tilt (bridges going up or down). */
  readonly yaw: number;
  readonly pitch: number;
  /** Drawn size: the model's unit box is scaled by this. */
  readonly scaleX: number;
  readonly scaleY: number;
  readonly scaleZ: number;
  /** Highest point (for debug labels and bridges). */
  readonly top: number;
  readonly colliders: Collider[];
  readonly solid: SolidBox | null;
  /** Every chunk the structure touches: it is shown while any of them is loaded. */
  readonly chunkKeys: number[];
}

/** Smallest corner post radius (m), so posts never get too thin to bump into. */
const MIN_POST_RADIUS = 0.25;

/**
 * Works out the placement of every structure from data and the terrain: standing on the ground
 * (sunk `sink` meters below the lowest point under the footprint, so it never floats on a
 * slope), lifted by `elevation`, at an absolute `y`, or (bridges) spanning between the tops of
 * two other structures. Pure numbers; the Three.js side only turns them into matrices.
 */
export function placeStructures(
  zones: readonly Zone[],
  heightAt: (x: number, z: number) => number,
  shapeOf: (model: string) => StructureShape,
  chunkSize: number,
  sink: number,
): PlacedStructure[] {
  const placed: PlacedStructure[] = [];
  for (const zone of zones) {
    const byId = new Map<string, PlacedStructure>();
    const bridges: StructureDef[] = [];
    for (const def of zone.structures ?? []) {
      if (def.connects) {
        bridges.push(def);
        continue;
      }
      const structure = placeStanding(zone.id, def, heightAt, shapeOf(def.model), chunkSize, sink);
      byId.set(def.id, structure);
      placed.push(structure);
    }
    // Bridges last: they need the structures they connect.
    for (const def of bridges) {
      const [a, b] = def.connects ?? [];
      const from = a ? byId.get(a) : undefined;
      const to = b ? byId.get(b) : undefined;
      if (!from || !to) continue;
      placed.push(placeBridge(zone.id, def, from, to, chunkSize));
    }
  }
  return placed;
}

function placeStanding(
  zoneId: string,
  def: StructureDef,
  heightAt: (x: number, z: number) => number,
  shape: StructureShape,
  chunkSize: number,
  sink: number,
): PlacedStructure {
  const x = def.x ?? 0;
  const z = def.z ?? 0;
  const [width, height, depth] = def.size;
  const yaw = (def.rotation ?? 0) * DEG;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // Footprint half extents along the world axes (rotated rectangle's bounding box).
  const halfX = (Math.abs(cos) * width + Math.abs(sin) * depth) / 2;
  const halfZ = (Math.abs(sin) * width + Math.abs(cos) * depth) / 2;

  const ground = heightAt(x, z);
  let base: number;
  let drawnHeight = height;
  if (def.y !== undefined) {
    base = def.y;
  } else if ((def.elevation ?? 0) > 0) {
    base = ground + (def.elevation ?? 0);
  } else {
    let lowest = ground;
    for (let i = 0; i < 4; i++) {
      const cx = x + (i & 1 ? halfX : -halfX);
      const cz = z + (i & 2 ? halfZ : -halfZ);
      lowest = Math.min(lowest, heightAt(cx, cz));
    }
    base = lowest - sink;
    // The top stays `height` above the ground at the center.
    drawnHeight = ground + height - base;
  }
  const top = base + drawnHeight;

  const colliders: Collider[] = [];
  let solid: SolidBox | null = null;
  // A barrier blocks walking, never the camera: its box would be a tall invisible wall.
  const occludes = def.model !== BARRIER_MODEL;
  switch (def.collider) {
    case 'box': {
      colliders.push(boxColliderAt(x, z, halfX * 2, halfZ * 2));
      if (!occludes) break;
      solid = {
        minX: x - halfX,
        minY: base,
        minZ: z - halfZ,
        maxX: x + halfX,
        maxY: top,
        maxZ: z + halfZ,
      };
      break;
    }
    case 'circle': {
      const radius = shape.circleRadius * Math.max(width, depth);
      colliders.push(circleCollider(x, z, radius));
      if (!occludes) break;
      solid = {
        minX: x - radius,
        minY: base,
        minZ: z - radius,
        maxX: x + radius,
        maxY: top,
        maxZ: z + radius,
      };
      break;
    }
    case 'posts': {
      const radius = Math.max(MIN_POST_RADIUS, shape.postRadius * Math.min(width, depth));
      for (let i = 0; i < 4; i++) {
        const lx = (i & 1 ? 1 : -1) * shape.postOffset * width;
        const lz = (i & 2 ? 1 : -1) * shape.postOffset * depth;
        // Model space to world: rotation.y = yaw turns +z towards +x.
        colliders.push(circleCollider(x + lx * cos + lz * sin, z - lx * sin + lz * cos, radius));
      }
      break;
    }
    case 'none':
      break;
  }

  return {
    def,
    zoneId,
    x,
    y: base,
    z,
    yaw,
    pitch: 0,
    scaleX: width,
    scaleY: drawnHeight,
    scaleZ: depth,
    top,
    colliders,
    solid,
    chunkKeys: chunksOf(x - halfX, z - halfZ, x + halfX, z + halfZ, chunkSize),
  };
}

function placeBridge(
  zoneId: string,
  def: StructureDef,
  from: PlacedStructure,
  to: PlacedStructure,
  chunkSize: number,
): PlacedStructure {
  const [width, thickness] = def.size;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dy = to.top - from.top;
  const run = Math.hypot(dx, dz);
  const x = (from.x + to.x) / 2;
  const z = (from.z + to.z) / 2;
  // The plank's top lies flush with both tops.
  const y = (from.top + to.top) / 2 - thickness;
  const half = width / 2;
  return {
    def,
    zoneId,
    x,
    y,
    z,
    yaw: Math.atan2(dx, dz),
    pitch: Math.atan2(dy, run),
    scaleX: width,
    scaleY: thickness,
    scaleZ: Math.hypot(run, dy),
    top: Math.max(from.top, to.top),
    colliders: [],
    solid: null,
    chunkKeys: chunksOf(
      Math.min(from.x, to.x) - half,
      Math.min(from.z, to.z) - half,
      Math.max(from.x, to.x) + half,
      Math.max(from.z, to.z) + half,
      chunkSize,
    ),
  };
}

function chunksOf(minX: number, minZ: number, maxX: number, maxZ: number, size: number): number[] {
  const keys: number[] = [];
  for (let cz = chunkCoord(minZ, size); cz <= chunkCoord(maxZ, size); cz++) {
    for (let cx = chunkCoord(minX, size); cx <= chunkCoord(maxX, size); cx++) {
      keys.push(chunkKey(cx, cz));
    }
  }
  return keys;
}

// Running interval of segmentEntersBox (module scope: no allocation per call).
let enterT = 0;
let exitT = 1;

/** Narrows [enterT, exitT] to where the segment lies between min and max on one axis. */
function slab(start: number, delta: number, min: number, max: number): boolean {
  if (Math.abs(delta) < 1e-9) return start >= min && start <= max;
  let t0 = (min - start) / delta;
  let t1 = (max - start) / delta;
  if (t0 > t1) {
    const swap = t0;
    t0 = t1;
    t1 = swap;
  }
  if (t0 > enterT) enterT = t0;
  if (t1 < exitT) exitT = t1;
  return enterT <= exitT;
}

/**
 * Where a segment from A to B first enters a box, as a fraction 0–1 of the way (1 = never).
 * Slab method; a segment that starts inside the box is ignored (returns 1). Allocation-free.
 */
export function segmentEntersBox(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  box: SolidBox,
): number {
  const inside =
    ax > box.minX &&
    ax < box.maxX &&
    ay > box.minY &&
    ay < box.maxY &&
    az > box.minZ &&
    az < box.maxZ;
  if (inside) return 1;
  enterT = 0;
  exitT = 1;
  if (!slab(ax, bx - ax, box.minX, box.maxX)) return 1;
  if (!slab(ay, by - ay, box.minY, box.maxY)) return 1;
  if (!slab(az, bz - az, box.minZ, box.maxZ)) return 1;
  return enterT;
}
