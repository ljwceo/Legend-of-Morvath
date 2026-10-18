import { hashSeed, Random } from '../core/Random';
import type { ScatterConfig } from './terrainConfig';
import { type LineHit, nearestOnLine, type TerrainField } from './TerrainField';

/** Floats per placed prop: local x, height, local z, scale, rotation around y. */
export const PROP_STRIDE = 5;
/** Steeper ground than this (rise per meter) gets no props. */
const MAX_SLOPE = 0.7;

const random = new Random(0);
const lineHit: LineHit = { distance: 0, t: 0, segment: 0 };

/**
 * Places the props (trees, rocks, ...) of one chunk. Deterministic: every chunk has its own
 * random sequence from (seed, cx, cz, rule), so a chunk looks the same no matter when or in
 * which order it loads. Returns one array per prop kind (PROP_STRIDE floats per prop),
 * positions relative to the chunk corner.
 */
export function scatterChunk(
  field: TerrainField,
  cfg: ScatterConfig,
  cx: number,
  cz: number,
  size: number,
): Float32Array[] {
  const originX = cx * size;
  const originZ = cz * size;
  const placed: number[][] = cfg.props.map(() => []);
  cfg.rules.forEach((rule, r) => {
    // Part of the chunk that lies inside the rule's zone.
    const minX = Math.max(originX, rule.minX);
    const maxX = Math.min(originX + size, rule.maxX);
    const minZ = Math.max(originZ, rule.minZ);
    const maxZ = Math.min(originZ + size, rule.maxZ);
    if (minX >= maxX || minZ >= maxZ || rule.prop < 0) return;
    random.reseed(hashSeed(cfg.seed, cx, cz, r));
    const density = rule.decorative ? cfg.density : 1;
    const expected = ((rule.perHectare * (maxX - minX) * (maxZ - minZ)) / 10_000) * density;
    const count = Math.floor(expected) + (random.chance(expected % 1) ? 1 : 0);
    const out = placed[rule.prop] as number[];
    for (let k = 0; k < count; k++) {
      // Always draw all four numbers, so one rejected prop does not shift the others.
      const x = random.range(minX, maxX);
      const z = random.range(minZ, maxZ);
      const scale = random.range(rule.minScale, rule.maxScale);
      const rotation = random.range(0, Math.PI * 2);
      if (inClearing(cfg.clearings, x, z) || inRect(cfg.clearRects, x, z)) continue;
      if (nearLine(cfg.clearLines, cfg.clearLineReach, x, z)) continue;
      if (field.riverAt(x, z) > 0) continue;
      const h = field.heightAt(x, z);
      if (h < cfg.minHeight) continue;
      const slopeX = Math.abs(field.heightAt(x + 1, z) - h);
      const slopeZ = Math.abs(field.heightAt(x, z + 1) - h);
      if (slopeX > MAX_SLOPE || slopeZ > MAX_SLOPE) continue;
      out.push(x - originX, h, z - originZ, scale, rotation);
    }
  });
  return placed.map((list) => new Float32Array(list));
}

function inClearing(clearings: readonly number[], x: number, z: number): boolean {
  for (let i = 0; i < clearings.length; i += 3) {
    const dx = x - (clearings[i] as number);
    const dz = z - (clearings[i + 1] as number);
    const r = clearings[i + 2] as number;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

function inRect(rects: readonly number[], x: number, z: number): boolean {
  for (let i = 0; i < rects.length; i += 4) {
    if (
      x >= (rects[i] as number) &&
      z >= (rects[i + 1] as number) &&
      x <= (rects[i + 2] as number) &&
      z <= (rects[i + 3] as number)
    ) {
      return true;
    }
  }
  return false;
}

function nearLine(
  lines: readonly number[][],
  reach: readonly number[],
  x: number,
  z: number,
): boolean {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as number[];
    if (nearestOnLine(line, 2, x, z, lineHit).distance < (reach[i] as number)) return true;
  }
  return false;
}
