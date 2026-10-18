import { fbm2 } from './Noise';

/**
 * The height and color of the ground anywhere in the world, as a pure function of the data in
 * zones.json and the world seed. The terrain worker builds chunk meshes from it; the main thread
 * uses the same function for places that are not loaded yet (spawning, teleporting), so both
 * always agree.
 *
 * Every zone has a base height, a hill amplitude and a color. Near a border the values of the
 * neighboring zones blend over `blendWidth` meters, so there is never a step between zones.
 * Zones with a higher priority (the Black Citadel inside Morvath) are painted over the others.
 * Towards the world edge the ground sinks to the sea floor (the coast).
 */

/** One zone, reduced to what the terrain needs. Plain numbers: it is sent to the worker. */
export interface TerrainZone {
  id: string;
  priority: number;
  /** Bounding box (zones are rectangles for now; other shapes use their bounding box). */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  baseHeight: number;
  amplitude: number;
  /** Terrain color as 0xRRGGBB. */
  color: number;
}

/** A river carved into the ground (zones.json `world.rivers`). Plain numbers for the worker. */
export interface TerrainRiver {
  /** Half the water width and the bank width (m). */
  half: number;
  bank: number;
  depth: number;
  /** Center line as x, z pairs. */
  points: number[];
  /** Bounding box of the river including its banks (quick rejection). */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * A shape pressed into the ground (zones.json `terrain.features`): a ridge, a gorge, a sunken
 * road, a plateau or a crater. Plain numbers for the worker. `points` is x, z, height triples;
 * within `half` meters of the line the feature is at full strength, fading out over `falloff`
 * meters. `level` true pulls the ground towards the (interpolated) absolute height, false adds it.
 */
export interface TerrainFeature {
  id: string;
  level: boolean;
  half: number;
  falloff: number;
  points: number[];
  /** Ground tint where the feature is, 0xRRGGBB (-1 = none), and how much of it shows (0–1). */
  color: number;
  colorStrength: number;
  /** Bounding box including the falloff (quick rejection). */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface TerrainConfig {
  seed: number;
  /** World rectangle; outside it is sea. */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Height of the sea floor (below sea level). */
  seaFloor: number;
  /** Width (m) of the coast where the land sinks to the sea floor at the world edge. */
  coastWidth: number;
  /** Width (m) over which two zones blend at their border. */
  blendWidth: number;
  /** Wavelength (m) of the largest hills, and how many finer layers of detail are added. */
  wavelength: number;
  octaves: number;
  /** Color of the sea floor, 0xRRGGBB. */
  seaColor: number;
  zones: TerrainZone[];
  rivers: TerrainRiver[];
  /** Color of a river bed, 0xRRGGBB. */
  riverColor: number;
  /** Ridges, gorges, roads, plateaus and craters, applied after the zone hills. */
  features: TerrainFeature[];
}

/** Result of `nearestOnLine` (reused; no allocation). */
export interface LineHit {
  /** Distance (m) from the point to the line. */
  distance: number;
  /** Fraction along the nearest segment (0 at its first point, 1 at its last). */
  t: number;
  /** Index (into the x, z pairs or x, z, h triples) of the nearest segment's first point. */
  segment: number;
}

/** Result of `TerrainField.sample` (reused; no allocation). */
export interface TerrainSample {
  height: number;
  /** Color channels 0–1. */
  r: number;
  g: number;
  b: number;
}

/** Brightness variation of the ground color (fraction), so slopes and fields are readable. */
const COLOR_VARIATION = 0.08;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class TerrainField {
  private readonly zones: TerrainZone[];
  /** Index in `zones` where each priority group starts (zones are sorted by priority). */
  private readonly groupStarts: number[] = [];
  private readonly seaR: number;
  private readonly seaG: number;
  private readonly seaB: number;
  private readonly riverR: number;
  private readonly riverG: number;
  private readonly riverB: number;
  private readonly scratch: TerrainSample = { height: 0, r: 0, g: 0, b: 0 };
  private readonly lineHit: LineHit = { distance: 0, t: 0, segment: 0 };

  constructor(readonly config: TerrainConfig) {
    this.zones = [...config.zones].sort((a, b) => a.priority - b.priority);
    this.zones.forEach((zone, i) => {
      if (i === 0 || zone.priority !== this.zones[i - 1]?.priority) this.groupStarts.push(i);
    });
    this.groupStarts.push(this.zones.length);
    this.seaR = ((config.seaColor >> 16) & 255) / 255;
    this.seaG = ((config.seaColor >> 8) & 255) / 255;
    this.seaB = (config.seaColor & 255) / 255;
    this.riverR = ((config.riverColor >> 16) & 255) / 255;
    this.riverG = ((config.riverColor >> 8) & 255) / 255;
    this.riverB = (config.riverColor & 255) / 255;
  }

  /** Ground height at (x, z) as if there were no rivers (the river's water level follows it). */
  landHeightAt(x: number, z: number): number {
    return this.sample(x, z, this.scratch, false).height;
  }

  /**
   * How much a river carves at (x, z): 1 in the water, falling to 0 at the outer edge of the
   * banks, 0 elsewhere. Allocation-free.
   */
  riverAt(x: number, z: number): number {
    const rivers = this.config.rivers;
    let strongest = 0;
    for (let r = 0; r < rivers.length; r++) {
      const river = rivers[r] as TerrainRiver;
      if (x < river.minX || x > river.maxX || z < river.minZ || z > river.maxZ) continue;
      const d = distanceToLine(river.points, x, z);
      const reach = river.half + river.bank;
      if (d >= reach) continue;
      const profile = d <= river.half ? 1 : 1 - smoothstep(river.half, reach, d);
      if (profile > strongest) strongest = profile;
    }
    return strongest;
  }

  /** Depth (m) a river carves at (x, z); 0 away from rivers. */
  private riverCarve(x: number, z: number): number {
    const rivers = this.config.rivers;
    let carve = 0;
    for (let r = 0; r < rivers.length; r++) {
      const river = rivers[r] as TerrainRiver;
      if (x < river.minX || x > river.maxX || z < river.minZ || z > river.maxZ) continue;
      const d = distanceToLine(river.points, x, z);
      const reach = river.half + river.bank;
      if (d >= reach) continue;
      const profile = d <= river.half ? 1 : 1 - smoothstep(river.half, reach, d);
      const depth = river.depth * profile;
      if (depth > carve) carve = depth;
    }
    return carve;
  }

  /** Ground height at (x, z). */
  heightAt(x: number, z: number): number {
    return this.sample(x, z, this.scratch).height;
  }

  /**
   * Height and color at (x, z), written into `out`. Allocation-free.
   * @param rivers false = the land without river beds
   */
  sample(x: number, z: number, out: TerrainSample, rivers = true): TerrainSample {
    const cfg = this.config;
    const half = cfg.blendWidth / 2;
    // Start from the sea; each priority group is painted over what lies below it.
    let base = cfg.seaFloor;
    let amplitude = 0;
    let r = this.seaR;
    let g = this.seaG;
    let b = this.seaB;
    const starts = this.groupStarts;
    for (let group = 0; group < starts.length - 1; group++) {
      let weight = 0;
      let gBase = 0;
      let gAmp = 0;
      let gR = 0;
      let gG = 0;
      let gB = 0;
      for (let i = starts[group] as number; i < (starts[group + 1] as number); i++) {
        const zone = this.zones[i] as TerrainZone;
        // Signed distance into the zone rectangle (negative outside).
        const inside = Math.min(x - zone.minX, zone.maxX - x, z - zone.minZ, zone.maxZ - z);
        if (inside <= -half) continue;
        // smoothstep(-h, h, d) + smoothstep(-h, h, -d) = 1: two neighbors always add up to 1.
        const w = smoothstep(-half, half, inside);
        weight += w;
        gBase += zone.baseHeight * w;
        gAmp += zone.amplitude * w;
        gR += ((zone.color >> 16) & 255) * w;
        gG += ((zone.color >> 8) & 255) * w;
        gB += (zone.color & 255) * w;
      }
      if (weight <= 1e-6) continue;
      const cover = Math.min(1, weight);
      const inv = 1 / weight;
      base += (gBase * inv - base) * cover;
      amplitude += (gAmp * inv - amplitude) * cover;
      r += ((gR * inv) / 255 - r) * cover;
      g += ((gG * inv) / 255 - g) * cover;
      b += ((gB * inv) / 255 - b) * cover;
    }

    // Hills: 0..1 noise, so the base height is the lowest point of a zone's land.
    const hills = fbm2(cfg.seed, x, z, cfg.wavelength, cfg.octaves) * 0.5 + 0.5;
    let height = base + amplitude * hills;

    // Features: ridges, gorges, roads and craters pressed into the hills (level design).
    const features = cfg.features;
    for (let i = 0; i < features.length; i++) {
      const feature = features[i] as TerrainFeature;
      if (x < feature.minX || x > feature.maxX || z < feature.minZ || z > feature.maxZ) continue;
      const hit = nearestOnLine(feature.points, 3, x, z, this.lineHit);
      const reach = feature.half + feature.falloff;
      if (hit.distance >= reach) continue;
      const profile =
        hit.distance <= feature.half ? 1 : 1 - smoothstep(feature.half, reach, hit.distance);
      const h0 = feature.points[hit.segment + 2] as number;
      const h1 = feature.points[hit.segment + 5] ?? h0;
      const target = h0 + (h1 - h0) * hit.t;
      height += (feature.level ? target - height : target) * profile;
      if (feature.color >= 0) {
        const wet = profile * feature.colorStrength;
        r += (((feature.color >> 16) & 255) / 255 - r) * wet;
        g += (((feature.color >> 8) & 255) / 255 - g) * wet;
        b += ((feature.color & 255) / 255 - b) * wet;
      }
    }

    // Coast: the land sinks to the sea floor towards the world edge.
    const toEdge = Math.min(x - cfg.minX, cfg.maxX - x, z - cfg.minZ, cfg.maxZ - z);
    const land = smoothstep(0, cfg.coastWidth, toEdge);
    height = cfg.seaFloor + (height - cfg.seaFloor) * land;
    r = this.seaR + (r - this.seaR) * land;
    g = this.seaG + (g - this.seaG) * land;
    b = this.seaB + (b - this.seaB) * land;

    // Rivers: the bed sinks below the land and takes the river color.
    if (rivers && cfg.rivers.length > 0) {
      const carve = this.riverCarve(x, z);
      if (carve > 0) {
        height -= carve;
        const wet = Math.min(1, carve / 0.5);
        r += (this.riverR - r) * wet;
        g += (this.riverG - g) * wet;
        b += (this.riverB - b) * wet;
      }
    }

    // Slight brightness variation, from a finer noise layer than the hills.
    const shade = 1 + fbm2((cfg.seed ^ 0x5bd1e995) | 0, x, z, 40, 2) * COLOR_VARIATION * 2;
    out.height = height;
    out.r = Math.min(1, r * shade);
    out.g = Math.min(1, g * shade);
    out.b = Math.min(1, b * shade);
    return out;
  }
}

/**
 * Nearest point of a polyline to (x, z): the line's points are x, z (`stride` 2) or x, z, h
 * (`stride` 3) tuples. A line of one point is that point. Writes into `out`; allocation-free.
 */
export function nearestOnLine(
  points: readonly number[],
  stride: number,
  x: number,
  z: number,
  out: LineHit,
): LineHit {
  let best = Infinity;
  out.t = 0;
  out.segment = 0;
  if (points.length <= stride) {
    const dx = x - (points[0] ?? 0);
    const dz = z - (points[1] ?? 0);
    out.distance = Math.sqrt(dx * dx + dz * dz);
    return out;
  }
  for (let i = 0; i + stride + 1 < points.length; i += stride) {
    const ax = points[i] as number;
    const az = points[i + 1] as number;
    const dx = (points[i + stride] as number) - ax;
    const dz = (points[i + stride + 1] as number) - az;
    const lengthSq = dx * dx + dz * dz;
    let t = lengthSq > 0 ? ((x - ax) * dx + (z - az) * dz) / lengthSq : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = x - (ax + dx * t);
    const pz = z - (az + dz * t);
    const d = px * px + pz * pz;
    if (d < best) {
      best = d;
      out.t = t;
      out.segment = i;
    }
  }
  out.distance = Math.sqrt(best);
  return out;
}

/** Distance from (x, z) to a polyline given as x, z pairs. Allocation-free. */
export function distanceToLine(points: readonly number[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const ax = points[i] as number;
    const az = points[i + 1] as number;
    const dx = (points[i + 2] as number) - ax;
    const dz = (points[i + 3] as number) - az;
    const lengthSq = dx * dx + dz * dz;
    let t = lengthSq > 0 ? ((x - ax) * dx + (z - az) * dz) / lengthSq : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = x - (ax + dx * t);
    const pz = z - (az + dz * t);
    const d = px * px + pz * pz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
