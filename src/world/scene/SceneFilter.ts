import { BufferAttribute, BufferGeometry, type Matrix4, Vector3 } from 'three';
import type { InstanceDef, InstanceSceneDef } from '../../data/types';

/** A box in local scene coordinates (relative to the Blender origin). */
export interface SceneBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/**
 * Which part of a Blender scene to build. An instance keeps only the triangles inside its
 * region (minus some materials); a zone leaves out the triangles that were cut out for its
 * instances (all of them, or only some materials). A triangle is inside a box when all three
 * corners are.
 */
export interface SceneFilter {
  keep: { box: SceneBox; exclude: ReadonlySet<string> } | null;
  cuts: { box: SceneBox; materials: ReadonlySet<string> | null }[];
}

export interface WorldBox {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** World box → local box (the scene is drawn at `offset`). */
export function localBox(box: WorldBox, offset: { x: number; y: number; z: number }): SceneBox {
  return {
    minX: box.min.x - offset.x,
    minY: box.min.y - offset.y,
    minZ: box.min.z - offset.z,
    maxX: box.max.x - offset.x,
    maxY: box.max.y - offset.y,
    maxZ: box.max.z - offset.z,
  };
}

/** The filter for one instance: only its region. */
export function instanceFilter(
  scene: InstanceSceneDef,
  offset: { x: number; y: number; z: number },
): SceneFilter {
  return {
    keep: { box: localBox(scene.region, offset), exclude: new Set(scene.region.exclude) },
    cuts: [],
  };
}

/** The filter for a zone: everything except what its instances cut out (null = nothing cut). */
export function zoneFilter(
  instances: readonly InstanceDef[],
  offset: { x: number; y: number; z: number },
): SceneFilter | null {
  const cuts: SceneFilter['cuts'] = [];
  for (const instance of instances) {
    const cut = instance.scene?.cut;
    if (!cut) continue;
    cuts.push({
      box: localBox(cut, offset),
      materials: cut.materials ? new Set(cut.materials) : null,
    });
  }
  return cuts.length > 0 ? { keep: null, cuts } : null;
}

export function inBox(box: SceneBox, p: Vector3): boolean {
  return (
    p.x >= box.minX &&
    p.x <= box.maxX &&
    p.y >= box.minY &&
    p.y <= box.maxY &&
    p.z >= box.minZ &&
    p.z <= box.maxZ
  );
}

/** Is this triangle (local corners) inside one of the boxes (all three corners)? */
export function insideAnyBox(
  boxes: readonly SceneBox[],
  a: Vector3,
  b: Vector3,
  c: Vector3,
): boolean {
  for (const box of boxes) {
    if (inBox(box, a) && inBox(box, b) && inBox(box, c)) return true;
  }
  return false;
}

/** Does this triangle (local corners) of `material` belong to the filtered scene? */
export function keepsTriangle(
  filter: SceneFilter,
  material: string,
  a: Vector3,
  b: Vector3,
  c: Vector3,
): boolean {
  const keep = filter.keep;
  if (keep) {
    if (keep.exclude.has(material)) return false;
    if (!inBox(keep.box, a) || !inBox(keep.box, b) || !inBox(keep.box, c)) return false;
  }
  for (const cut of filter.cuts) {
    if (cut.materials && !cut.materials.has(material)) continue;
    if (inBox(cut.box, a) && inBox(cut.box, b) && inBox(cut.box, c)) return false;
  }
  return true;
}

/** Does a point (local) belong to the filtered scene (trees, lanterns)? */
export function keepsPoint(filter: SceneFilter, material: string, p: Vector3): boolean {
  return keepsTriangle(filter, material, p, p, p);
}

/**
 * The triangles of a mesh that pass `keep` (corners in local scene space via `matrix`): the
 * geometry itself when all pass, null when none do, else a new geometry that shares the vertex
 * data and only has a smaller index. Runs once while building, never while playing.
 */
export function filterGeometry(
  geometry: BufferGeometry,
  matrix: Matrix4,
  keep: (a: Vector3, b: Vector3, c: Vector3) => boolean,
): BufferGeometry | null {
  const position = geometry.getAttribute('position');
  if (!position) return null;
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const kept: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(position, ia).applyMatrix4(matrix);
    b.fromBufferAttribute(position, ib).applyMatrix4(matrix);
    c.fromBufferAttribute(position, ic).applyMatrix4(matrix);
    if (keep(a, b, c)) kept.push(ia, ib, ic);
  }
  if (kept.length === 0) return null;
  if (kept.length === count) return geometry;
  const filtered = new BufferGeometry();
  for (const [key, attribute] of Object.entries(geometry.attributes)) {
    filtered.setAttribute(key, attribute);
  }
  const big = position.count > 65_535;
  filtered.setIndex(new BufferAttribute(big ? new Uint32Array(kept) : new Uint16Array(kept), 1));
  filtered.name = geometry.name;
  return filtered;
}
