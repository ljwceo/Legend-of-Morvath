import {
  BufferGeometry,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { palette, terrainColors } from '../render/palette';
import type { StructureShape } from '../world/StructurePlacement';

/**
 * Placeholder models for buildings and landmarks (zones.json `structures[].model`). Every model
 * is built at size 1 × 1 × 1 (width x, height y, depth z) with its base at y = 0, centered in
 * x and z; the instance matrix scales it to the structure's size. All structures of one model
 * share one InstancedMesh, so the whole world costs one draw call per model.
 *
 * Vertex colors hold the shading of the parts (walls bright, roofs darker, ...). A tinted model
 * is multiplied by the structure's color (instance color); other models keep their own colors.
 * Real glTF models replace this file later; nothing else changes.
 */

export type Part = [geometry: BufferGeometry, color: number, x: number, y: number, z: number];

/**
 * An invisible wall: collision only, nothing is drawn (StructureLayer skips it). Buried in a
 * cliff or ridge it makes a natural boundary really hold: the mover's slope rule is per movement
 * direction, so any slope can be inched up at a grazing angle, a collider cannot.
 */
export const BARRIER_MODEL = 'placeholder:barrier';

export interface StructureModel extends StructureShape {
  geometry: BufferGeometry;
  /** True: the instance color (the structure's color) tints the whole model. */
  tinted: boolean;
}

/** Shades of white for tinted models (multiplied by the structure color). */
const WALL = 0xffffff;
const ROOF = 0x8a8494;
const DARK = 0x4a4652;

/** Merges parts into one geometry with their colors as vertex colors. */
export function colored(parts: Part[]): BufferGeometry {
  const pieces = parts.map(([geometry, color, x, y, z]) => {
    const piece = geometry.index ? geometry.toNonIndexed() : geometry;
    if (piece !== geometry) geometry.dispose();
    piece.translate(x, y, z);
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
  if (!merged) throw new Error('Could not merge placeholder structure parts');
  merged.computeBoundingSphere();
  return merged;
}

/** A gable roof (triangular prism) along x, 1 wide, 1 high, 1 deep, base at y = 0. */
function gableRoof(): BufferGeometry {
  // A 3-sided cylinder lying along x is a prism, turned so one edge points up: the triangle
  // then spans y −0.5..1 and z ±0.866. Moved and scaled to fill the unit box.
  const cylinder = new CylinderGeometry(1, 1, 1, 3, 1).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
  cylinder.translate(0, 0.5, 0).scale(1, 1 / 1.5, 1 / Math.sqrt(3));
  // Flat roof faces: per-face normals instead of the cylinder's smooth ones.
  const prism = cylinder.toNonIndexed();
  cylinder.dispose();
  prism.computeVertexNormals();
  return prism;
}

interface ModelDef {
  build: () => BufferGeometry;
  tinted: boolean;
  circleRadius?: number;
  postOffset?: number;
  postRadius?: number;
}

const POST_OFFSET = 0.42;
const POST_RADIUS = 0.05;

const MODELS: Readonly<Record<string, ModelDef>> = {
  // Plain block: fences, hedges, beds, piers, a grate.
  'placeholder:block': {
    tinted: true,
    build: () => colored([[new BoxGeometry(1, 1, 1), WALL, 0, 0.5, 0]]),
  },
  // City wall with a darker walkway band on top.
  'placeholder:wall': {
    tinted: true,
    build: () =>
      colored([
        [new BoxGeometry(1, 0.9, 1), WALL, 0, 0.45, 0],
        [new BoxGeometry(1, 0.1, 1), ROOF, 0, 0.95, 0],
      ]),
  },
  // House: walls (70 %) under a darker gable roof (30 %), ridge along x.
  'placeholder:house': {
    tinted: true,
    build: () =>
      colored([
        [new BoxGeometry(1, 0.7, 1), WALL, 0, 0.35, 0],
        [gableRoof().scale(1.04, 0.3, 1.08), ROOF, 0, 0.7, 0],
        // A door on the front (+z), so you can see which way a house faces.
        [new BoxGeometry(0.16, 0.32, 0.02), DARK, 0, 0.16, 0.505],
      ]),
  },
  // Round tower with a pointed roof.
  'placeholder:tower': {
    tinted: true,
    circleRadius: 0.5,
    build: () =>
      colored([
        [new CylinderGeometry(0.5, 0.5, 0.78, 12), WALL, 0, 0.39, 0],
        [new ConeGeometry(0.58, 0.22, 12), ROOF, 0, 0.89, 0],
      ]),
  },
  // Aqueduct bridge: two piers and an arch beam carrying the water over a river (span along z).
  'placeholder:aqueduct': {
    tinted: true,
    build: () =>
      colored([
        [new BoxGeometry(1, 1, 0.16), WALL, 0, 0.5, -0.42],
        [new BoxGeometry(1, 1, 0.16), WALL, 0, 0.5, 0.42],
        [new BoxGeometry(1, 0.28, 1), WALL, 0, 0.86, 0],
        [new BoxGeometry(0.6, 0.04, 1), ROOF, 0, 1.0, 0],
      ]),
  },
  // Market stall: four posts and a cloth roof.
  'placeholder:stall': {
    tinted: true,
    build: () =>
      colored([
        [new BoxGeometry(0.06, 0.8, 0.06), ROOF, -0.45, 0.4, -0.45],
        [new BoxGeometry(0.06, 0.8, 0.06), ROOF, 0.45, 0.4, -0.45],
        [new BoxGeometry(0.06, 0.8, 0.06), ROOF, -0.45, 0.4, 0.45],
        [new BoxGeometry(0.06, 0.8, 0.06), ROOF, 0.45, 0.4, 0.45],
        [new BoxGeometry(1.1, 0.2, 1.1), WALL, 0, 0.9, 0],
        [new BoxGeometry(0.9, 0.3, 0.5), ROOF, 0, 0.15, 0],
      ]),
  },
  // Training dummy: a post with a cross bar.
  'placeholder:dummy': {
    tinted: true,
    circleRadius: 0.25,
    build: () =>
      colored([
        [new CylinderGeometry(0.12, 0.14, 1, 6), ROOF, 0, 0.5, 0],
        [new BoxGeometry(1, 0.12, 0.3), WALL, 0, 0.72, 0],
        [new BoxGeometry(0.4, 0.3, 0.6), WALL, 0, 0.55, 0],
      ]),
  },
  // Platform on four posts (elven city, stilt monastery). Walk under it between the posts.
  'placeholder:platform': {
    tinted: true,
    postOffset: POST_OFFSET,
    postRadius: POST_RADIUS,
    build: () =>
      colored([
        [new BoxGeometry(1, 0.1, 1), WALL, 0, 0.95, 0],
        [new BoxGeometry(0.1, 0.9, 0.1), ROOF, -POST_OFFSET, 0.45, -POST_OFFSET],
        [new BoxGeometry(0.1, 0.9, 0.1), ROOF, POST_OFFSET, 0.45, -POST_OFFSET],
        [new BoxGeometry(0.1, 0.9, 0.1), ROOF, -POST_OFFSET, 0.45, POST_OFFSET],
        [new BoxGeometry(0.1, 0.9, 0.1), ROOF, POST_OFFSET, 0.45, POST_OFFSET],
      ]),
  },
  // Bridge plank, length along z (set from the two structures it connects).
  'placeholder:bridge': {
    tinted: true,
    build: () =>
      colored([
        [new BoxGeometry(1, 1, 1), WALL, 0, 0.5, 0],
        [new BoxGeometry(0.06, 2, 1), ROOF, -0.5, 1, 0],
        [new BoxGeometry(0.06, 2, 1), ROOF, 0.5, 1, 0],
      ]),
  },
  // Rocky island in the sea.
  'placeholder:island': {
    tinted: true,
    circleRadius: 0.45,
    build: () => colored([[new CylinderGeometry(0.42, 0.5, 1, 9), WALL, 0, 0.5, 0]]),
  },
  // Old Tjikko: a huge trunk with a wide crown (own colors).
  'placeholder:giant_tree': {
    tinted: false,
    circleRadius: 0.12,
    build: () =>
      colored([
        [new CylinderGeometry(0.09, 0.14, 0.6, 10), palette.steengrijs, 0, 0.3, 0],
        [new IcosahedronGeometry(0.42, 1).scale(1, 0.55, 1), terrainColors.bosgroen, 0, 0.66, 0],
        [new IcosahedronGeometry(0.3, 1).scale(1, 0.6, 1), terrainColors.mosgroen, 0.1, 0.84, 0.05],
        [new IcosahedronGeometry(0.22, 1), terrainColors.mosgroen, -0.15, 0.78, -0.1],
      ]),
  },
  // Elven shrine: a ring of pillars around a softly glowing stone.
  'placeholder:shrine': {
    tinted: false,
    circleRadius: 0.14,
    build: () => {
      const parts: Part[] = [
        [new CylinderGeometry(0.5, 0.5, 0.05, 16), palette.steengrijs, 0, 0.025, 0],
      ];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push([
          new CylinderGeometry(0.04, 0.05, 0.8, 6),
          terrainColors.mosgroen,
          Math.cos(a) * 0.42,
          0.4,
          Math.sin(a) * 0.42,
        ]);
      }
      parts.push([new DodecahedronGeometry(0.12, 0), palette.spreukviolet, 0, 0.3, 0]);
      return colored(parts);
    },
  },
  // Ruin: a roofless shell whose walls are broken down to different heights (a collapsed chapel).
  'placeholder:ruin': {
    tinted: true,
    build: () =>
      colored([
        // Back wall (-z) still stands; the front (+z) is a low stump with a gap in the middle.
        [new BoxGeometry(1, 1, 0.08), WALL, 0, 0.5, -0.46],
        [new BoxGeometry(0.3, 0.3, 0.08), WALL, -0.35, 0.15, 0.46],
        [new BoxGeometry(0.3, 0.2, 0.08), WALL, 0.35, 0.1, 0.46],
        // Side walls, broken off towards the front.
        [new BoxGeometry(0.08, 0.85, 0.55), WALL, -0.46, 0.425, -0.225],
        [new BoxGeometry(0.08, 0.35, 0.45), WALL, -0.46, 0.175, 0.275],
        [new BoxGeometry(0.08, 0.6, 0.5), WALL, 0.46, 0.3, -0.25],
        [new BoxGeometry(0.08, 0.25, 0.5), WALL, 0.46, 0.125, 0.25],
        // Rubble on the floor and the stump of a tower in the back corner.
        [new DodecahedronGeometry(0.12, 0).scale(1, 0.6, 1), DARK, 0.15, 0.07, 0.1],
        [new DodecahedronGeometry(0.09, 0).scale(1, 0.6, 1), DARK, -0.2, 0.05, 0.25],
        [new CylinderGeometry(0.12, 0.13, 1.2, 8), ROOF, -0.36, 0.6, -0.36],
      ]),
  },
  // Obelisk: a tapered dark pillar (wayposts along a road).
  'placeholder:obelisk': {
    tinted: true,
    circleRadius: 0.5,
    build: () =>
      colored([
        [new BoxGeometry(1, 0.12, 1), ROOF, 0, 0.06, 0],
        [new CylinderGeometry(0.22, 0.4, 0.82, 4), WALL, 0, 0.53, 0],
        [new ConeGeometry(0.22, 0.12, 4), DARK, 0, 1.0, 0],
      ]),
  },
  // Citadel: a dark keep with four corner spires and a tall central tower (the Black Citadel).
  'placeholder:citadel': {
    tinted: true,
    build: () => {
      const parts: Part[] = [
        [new BoxGeometry(1, 0.42, 1), WALL, 0, 0.21, 0],
        [new BoxGeometry(0.6, 0.65, 0.6), WALL, 0, 0.325, 0],
        [new CylinderGeometry(0.11, 0.14, 0.86, 8), WALL, 0, 0.43, 0],
        [new ConeGeometry(0.13, 0.14, 8), DARK, 0, 0.93, 0],
      ];
      for (let i = 0; i < 4; i++) {
        const sx = i & 1 ? 0.42 : -0.42;
        const sz = i & 2 ? 0.42 : -0.42;
        parts.push(
          [new CylinderGeometry(0.07, 0.09, 0.62, 8), WALL, sx, 0.31, sz],
          [new ConeGeometry(0.09, 0.1, 8), DARK, sx, 0.67, sz],
        );
      }
      return colored(parts);
    },
  },
  // Invisible wall (see BARRIER_MODEL): no geometry at all.
  [BARRIER_MODEL]: {
    tinted: false,
    build: () => new BufferGeometry(),
  },
  // Cave entrance: a mound of rock with a dark opening on the front (+z).
  'placeholder:cave_entrance': {
    tinted: true,
    build: () =>
      colored([
        [new DodecahedronGeometry(0.6, 0).scale(0.85, 1, 0.85), WALL, 0, 0.45, 0],
        [new BoxGeometry(0.35, 0.45, 0.1), DARK, 0, 0.22, 0.47],
      ]),
  },
};

export function hasStructureModel(model: string): boolean {
  return model in MODELS;
}

export function structureModelNames(): string[] {
  return Object.keys(MODELS);
}

/** Collider fractions of a model, without building its geometry. */
export function structureShape(model: string): StructureShape {
  const def = MODELS[model];
  if (!def) throw new Error(`Unknown structure model: ${model}`);
  return {
    circleRadius: def.circleRadius ?? 0.5,
    postOffset: def.postOffset ?? POST_OFFSET,
    postRadius: def.postRadius ?? POST_RADIUS,
  };
}

/** Builds a placeholder structure model; the caller owns (and disposes) its geometry. */
export function buildStructureModel(model: string): StructureModel {
  const def = MODELS[model];
  if (!def) throw new Error(`Unknown structure model: ${model}`);
  return { geometry: def.build(), tinted: def.tinted, ...structureShape(model) };
}
