import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  MeshLambertMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { palette, terrainColors } from '../render/palette';

/**
 * Placeholder models for scattered props (zones.json `world.props[].model`). Each model is one
 * geometry with vertex colors, so a chunk draws all props of one kind in a single InstancedMesh
 * draw call. Real glTF models replace this file later; nothing else changes.
 * Sizes in meters at scale 1; the base stands at y = 0.
 */

type Part = [geometry: BufferGeometry, color: number, x: number, y: number, z: number];

function colored(parts: Part[]): BufferGeometry {
  const pieces = parts.map(([geometry, color, x, y, z]) => {
    const piece = geometry.index ? geometry.toNonIndexed() : geometry;
    if (piece !== geometry) geometry.dispose();
    piece.translate(x, y, z);
    // Color converts the sRGB style-guide color to the linear space vertex colors use.
    const { r, g, b } = new Color(color);
    const count = piece.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3);
    piece.setAttribute('color', new Float32BufferAttribute(colors, 3));
    piece.deleteAttribute('uv');
    return piece;
  });
  const merged = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error('Could not merge placeholder prop parts');
  merged.computeBoundingSphere();
  return merged;
}

const MODELS: Readonly<Record<string, () => BufferGeometry>> = {
  // Round leafy tree: trunk + two crowns.
  'placeholder:tree': () =>
    colored([
      [new CylinderGeometry(0.18, 0.28, 2.4, 6), palette.steengrijs, 0, 1.2, 0],
      [new IcosahedronGeometry(1.6, 0), terrainColors.bosgroen, 0, 3.4, 0],
      [new IcosahedronGeometry(1.1, 0), terrainColors.mosgroen, 0.3, 4.4, 0.2],
    ]),
  // Pine: trunk + two stacked cones.
  'placeholder:pine': () =>
    colored([
      [new CylinderGeometry(0.15, 0.22, 1.6, 6), palette.steengrijs, 0, 0.8, 0],
      [new ConeGeometry(1.5, 3.2, 7), terrainColors.bosgroen, 0, 2.8, 0],
      [new ConeGeometry(1.0, 2.4, 7), terrainColors.bosgroen, 0, 4.4, 0],
    ]),
  // Bare, crooked tree for swamps and corrupted land.
  'placeholder:dead_tree': () =>
    colored([
      [new CylinderGeometry(0.12, 0.25, 3.2, 5), palette.schemerviolet, 0, 1.6, 0],
      [new CylinderGeometry(0.05, 0.1, 1.4, 4).rotateZ(0.9), palette.schemerviolet, 0.5, 2.6, 0],
      [new CylinderGeometry(0.05, 0.09, 1.1, 4).rotateX(-0.8), palette.schemerviolet, 0, 2.2, 0.4],
    ]),
  'placeholder:rock': () =>
    colored([
      [new DodecahedronGeometry(0.9, 0).scale(1, 0.6, 0.8), palette.steengrijs, 0, 0.35, 0],
    ]),
  // Cluster of dead violet crystal shards (Morvath): three tilted spikes.
  'placeholder:blight_crystal': () =>
    colored([
      [new ConeGeometry(0.45, 2.6, 5).rotateZ(0.18), palette.schemerviolet, 0, 1.2, 0],
      [new ConeGeometry(0.3, 1.8, 5).rotateZ(-0.5), palette.spreukviolet, 0.55, 0.8, 0.1],
      [new ConeGeometry(0.22, 1.3, 5).rotateX(0.55), palette.schemerviolet, -0.3, 0.55, -0.35],
    ]),
  // Tuft of reeds (no collider).
  'placeholder:reed': () =>
    colored([
      [new ConeGeometry(0.05, 1.2, 3), terrainColors.steppe, 0, 0.6, 0],
      [new ConeGeometry(0.05, 1.0, 3).rotateZ(0.2), terrainColors.steppe, 0.12, 0.5, 0.05],
      [new ConeGeometry(0.05, 0.9, 3).rotateX(-0.2), terrainColors.mosgroen, -0.05, 0.45, 0.12],
    ]),
};

export function hasPropModel(model: string): boolean {
  return model in MODELS;
}

/**
 * Shared geometries and one material for all props. Created once per world visit and disposed
 * when leaving it; chunks only create (and dispose) their InstancedMeshes.
 */
export class PropLibrary {
  readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly geometries: BufferGeometry[];

  /** `models` in the same order as zones.json `world.props`. */
  constructor(models: readonly string[]) {
    this.geometries = models.map((model) => {
      const build = MODELS[model];
      if (!build) throw new Error(`Unknown prop model: ${model}`);
      return build();
    });
  }

  geometry(prop: number): BufferGeometry {
    const geometry = this.geometries[prop];
    if (!geometry) throw new Error(`Unknown prop index: ${prop}`);
    return geometry;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
  }
}
