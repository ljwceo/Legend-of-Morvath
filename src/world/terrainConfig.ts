import type { ZonesFile } from '../data/types';
import { BARRIER_MODEL } from '../entities/StructureFactory';
import { emptyBox, shapeBounds } from './Shapes';
import type { TerrainConfig, TerrainFeature } from './TerrainField';

/** Extra room (m) kept free of props around a building. */
const STRUCTURE_MARGIN = 1.5;
/** Style-guide color of river beds (water in the shadow). */
const RIVER_BED_COLOR = 'zeewater';

/** One scatter rule of one zone, flattened for the worker. */
export interface ScatterRule {
  /** Zone rectangle the props may stand in. */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Index into `ScatterConfig.props`. */
  prop: number;
  perHectare: number;
  /**
   * Decorative props (no collider, e.g. reeds) follow the quality density; solid ones (trees,
   * rocks) are the same on every preset, because you can bump into them (CLAUDE.md §2.3).
   */
  decorative: boolean;
  minScale: number;
  maxScale: number;
}

export interface ScatterConfig {
  seed: number;
  /** Prop ids in data order; results come back per prop index. */
  props: string[];
  rules: ScatterRule[];
  /**
   * No props in these circles: [x, z, radius] triples (spawn points, checkpoints, entrances,
   * buildings).
   */
  clearings: number[];
  /** No props in these rectangles: [minX, minZ, maxX, maxZ] (areas with `noScatter`). */
  clearRects: number[];
  /**
   * No props within reach of these lines (terrain features with `noScatter`, e.g. a road):
   * for each line its x, z pairs; `clearLineReach` gives its reach (m).
   */
  clearLines: number[][];
  clearLineReach: number[];
  /** Props never stand in water shallower than this above sea level. */
  minHeight: number;
  /** Quality density (0–1) multiplies `perHectare` of decorative props only. */
  density: number;
}

/** Everything the terrain worker needs, as plain data (structured-cloned into the worker). */
export interface WorldGenConfig {
  terrain: TerrainConfig;
  scatter: ScatterConfig;
  chunkSize: number;
  lodSegments: [number, number];
  skirtDepth: number;
  farGridSpacing: number;
}

/** Builds the worker config from zones.json. `color` turns a color token into 0xRRGGBB. */
export function buildWorldGenConfig(
  zones: ZonesFile,
  color: (token: string) => number,
  propDensity: number,
): WorldGenConfig {
  const world = zones.world;
  const t = world.terrain;
  const worldBox = shapeBounds(world.bounds, emptyBox());
  const box = emptyBox();
  const props = world.props.map((prop) => prop.id);
  const rules: ScatterRule[] = [];
  const clearings: number[] = [];
  const clearRects: number[] = [];
  const clearLines: number[][] = [];
  const clearLineReach: number[] = [];
  const features: TerrainFeature[] = [];
  const terrainZones = zones.zones.map((zone) => {
    shapeBounds(zone.bounds, box);
    for (const rule of zone.scatter ?? []) {
      rules.push({
        minX: box.minX,
        minZ: box.minZ,
        maxX: box.maxX,
        maxZ: box.maxZ,
        prop: props.indexOf(rule.prop),
        perHectare: rule.perHectare,
        decorative: (world.props.find((prop) => prop.id === rule.prop)?.colliderRadius ?? 0) === 0,
        minScale: rule.minScale,
        maxScale: rule.maxScale,
      });
    }
    for (const spawn of zone.spawnPoints) clearings.push(spawn.x, spawn.z, t.clearingRadius);
    if (zone.checkpoint) clearings.push(zone.checkpoint.x, zone.checkpoint.z, t.clearingRadius);
    for (const instance of zone.instances) {
      clearings.push(instance.entrance.x, instance.entrance.z, t.clearingRadius);
    }
    for (const structure of zone.structures ?? []) {
      if (structure.x === undefined || structure.z === undefined) continue;
      // An invisible barrier inside a cliff leaves the trees and rocks on the cliff alone.
      if (structure.model === BARRIER_MODEL) continue;
      // Half the diagonal of the footprint, plus room to walk around it.
      const radius = Math.hypot(structure.size[0], structure.size[2]) / 2 + STRUCTURE_MARGIN;
      clearings.push(structure.x, structure.z, radius);
    }
    for (const area of zone.areas) {
      if (!area.noScatter) continue;
      const areaBox = shapeBounds(area.shape, emptyBox());
      clearRects.push(areaBox.minX, areaBox.minZ, areaBox.maxX, areaBox.maxZ);
    }
    for (const feature of zone.terrain.features ?? []) {
      const reach = feature.half + feature.falloff;
      const xs = feature.points.map((point) => point[0]);
      const zs = feature.points.map((point) => point[1]);
      features.push({
        id: feature.id,
        level: feature.mode === 'level',
        half: feature.half,
        falloff: feature.falloff,
        points: feature.points.flat(),
        color: feature.color ? color(feature.color) : -1,
        colorStrength: feature.colorStrength ?? 1,
        minX: Math.min(...xs) - reach,
        minZ: Math.min(...zs) - reach,
        maxX: Math.max(...xs) + reach,
        maxZ: Math.max(...zs) + reach,
      });
      if (feature.noScatter) {
        clearLines.push(feature.points.flatMap((point) => [point[0], point[1]]));
        clearLineReach.push(reach);
      }
    }
    return {
      id: zone.id,
      priority: zone.priority ?? 0,
      minX: box.minX,
      minZ: box.minZ,
      maxX: box.maxX,
      maxZ: box.maxZ,
      baseHeight: zone.terrain.baseHeight,
      amplitude: zone.terrain.amplitude,
      color: color(zone.terrainColor),
    };
  });
  return {
    terrain: {
      seed: world.seed,
      minX: worldBox.minX,
      minZ: worldBox.minZ,
      maxX: worldBox.maxX,
      maxZ: worldBox.maxZ,
      seaFloor: t.seaFloor,
      coastWidth: t.coastWidth,
      blendWidth: t.blendWidth,
      wavelength: t.wavelength,
      octaves: t.octaves,
      seaColor: color(world.outsideZoneColor),
      zones: terrainZones,
      rivers: (world.rivers ?? []).map((river) => {
        const points = river.points.flat();
        const reach = river.width / 2 + river.bank;
        const xs = river.points.map((point) => point[0]);
        const zs = river.points.map((point) => point[1]);
        return {
          half: river.width / 2,
          bank: river.bank,
          depth: river.depth,
          points,
          minX: Math.min(...xs) - reach,
          minZ: Math.min(...zs) - reach,
          maxX: Math.max(...xs) + reach,
          maxZ: Math.max(...zs) + reach,
        };
      }),
      riverColor: color(RIVER_BED_COLOR),
      features,
    },
    scatter: {
      seed: world.seed,
      props,
      rules,
      clearings,
      clearRects,
      clearLines,
      clearLineReach,
      minHeight: t.seaLevel + 0.3,
      density: propDensity,
    },
    chunkSize: world.chunkSize,
    lodSegments: [t.lodSegments[0], t.lodSegments[1]],
    skirtDepth: t.skirtDepth,
    farGridSpacing: t.farGridSpacing,
  };
}
