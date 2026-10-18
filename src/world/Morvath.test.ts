import { describe, expect, it } from 'vitest';
import { dataSchemas, zonesFileSchema } from '../data/schemas';
import type { PlayerConfig, TriggersFile, Zone } from '../data/types';
import { structureShape } from '../entities/StructureFactory';
import { colorTokens } from '../render/palette';
import { readPublicJson } from '../test/loadPublic';
import { type Collider, pushOutOf } from './Colliders';
import { placeStructures } from './StructurePlacement';
import { buildWorldGenConfig } from './terrainConfig';
import { TerrainField } from './TerrainField';

/**
 * Morvath World Prototype V1: the valley from the western pass to the gate of the Black Citadel
 * must be walkable with the real movement rules, without softlocks, and closed off by its ridges.
 * The same formula (TerrainField) runs in the game, so what passes here is what you walk on.
 */

const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const player = dataSchemas.player.parse(readPublicJson('data/player.json')) as PlayerConfig;
const triggers = dataSchemas.triggers.parse(readPublicJson('data/triggers.json')) as TriggersFile;
const config = buildWorldGenConfig(zones, (token) => colorTokens.get(token) ?? 0, 1);
const field = new TerrainField(config.terrain);
const morvath = zones.zones.find((zone) => zone.id === 'morvath') as Zone;
const citadel = zones.zones.find((zone) => zone.id === 'black_citadel') as Zone;
const placed = placeStructures(
  [morvath, citadel],
  (x, z) => field.heightAt(x, z),
  structureShape,
  zones.world.chunkSize,
  zones.world.terrain.structureSink,
);
const colliders: Collider[] = placed.flatMap((s) => s.colliders);

const DEG = Math.PI / 180;
/** The movement rules of GroundedMover, from the same data as the game. */
const maxRise = Math.tan(player.movement.slopeLimitDegrees * DEG);
const minHeight = zones.world.terrain.seaLevel - zones.world.terrain.deepWater;
const radius = player.movement.radius;

/** The slice: the pass (with a bit of the Plains of Tharond) up to the Citadel's court. */
const GRID = { minX: 1150, maxX: 1960, minZ: -270, maxZ: 270, step: 1 };
const columns = Math.round((GRID.maxX - GRID.minX) / GRID.step) + 1;
const rows = Math.round((GRID.maxZ - GRID.minZ) / GRID.step) + 1;

const heights = new Float32Array(columns * rows);
const blocked = new Uint8Array(columns * rows);
const probe = { x: 0, z: 0 };
for (let j = 0; j < rows; j++) {
  for (let i = 0; i < columns; i++) {
    const x = GRID.minX + i * GRID.step;
    const z = GRID.minZ + j * GRID.step;
    const v = j * columns + i;
    heights[v] = field.heightAt(x, z);
    for (const collider of colliders) {
      probe.x = x;
      probe.z = z;
      if (pushOutOf(probe, radius, collider)) {
        blocked[v] = 1;
        break;
      }
    }
  }
}

function cellOf(x: number, z: number): number {
  const i = Math.round((x - GRID.minX) / GRID.step);
  const j = Math.round((z - GRID.minZ) / GRID.step);
  if (i < 0 || j < 0 || i >= columns || j >= rows) throw new Error(`outside the grid: ${x}, ${z}`);
  return j * columns + i;
}

/** Can the player step from cell `from` to cell `to` (GroundedMover.allowed)? */
function canStep(from: number, to: number, distance: number): boolean {
  if (blocked[to]) return false;
  const hFrom = heights[from] as number;
  const hTo = heights[to] as number;
  if (hTo < minHeight && hTo < hFrom) return false;
  return hTo - hFrom <= maxRise * distance;
}

/**
 * Sixteen directions (the eight neighbors and the knight's moves), because the mover's slope rule
 * is per movement direction: a slope too steep to walk straight up can be taken at an angle.
 */
const NEIGHBORS: [number, number, number][] = [];
for (let dj = -2; dj <= 2; dj++) {
  for (let di = -2; di <= 2; di++) {
    if (di === 0 && dj === 0) continue;
    if (Math.abs(di) === 2 && Math.abs(dj) !== 1) continue;
    if (Math.abs(dj) === 2 && Math.abs(di) !== 1) continue;
    NEIGHBORS.push([di, dj, Math.hypot(di, dj) * GRID.step]);
  }
}

/** Every cell reachable from `start`; `reverse` = cells from which `start` can be reached. */
function flood(start: number, reverse: boolean): Uint8Array {
  const seen = new Uint8Array(columns * rows);
  const queue = new Int32Array(columns * rows);
  let head = 0;
  let tail = 0;
  seen[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const v = queue[head++] as number;
    const i = v % columns;
    const j = (v - i) / columns;
    for (const [di, dj, distance] of NEIGHBORS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= columns || nj >= rows) continue;
      const n = nj * columns + ni;
      if (seen[n]) continue;
      // A knight's move passes a cell in between; that one must be free too.
      if (distance > GRID.step * 1.5) {
        const mi = i + Math.sign(di) * (Math.abs(di) === 2 ? 1 : 0);
        const mj = j + Math.sign(dj) * (Math.abs(dj) === 2 ? 1 : 0);
        if (blocked[mj * columns + mi]) continue;
      }
      if (!(reverse ? canStep(n, v, distance) : canStep(v, n, distance))) continue;
      seen[n] = 1;
      queue[tail++] = n;
    }
  }
  return seen;
}

const spawn = morvath.spawnPoints[0];
if (!spawn) throw new Error('Morvath has no spawn point');
const start = cellOf(spawn.x, spawn.z);
const reachable = flood(start, false);
const canReturn = flood(start, true);

function describeCell(v: number): string {
  const i = v % columns;
  const j = (v - i) / columns;
  return `(${GRID.minX + i * GRID.step}, ${GRID.minZ + j * GRID.step}) h=${(heights[v] as number).toFixed(1)}`;
}

describe('Morvath World Prototype V1', () => {
  it('starts you on dry, free ground inside the zone, facing east', () => {
    expect(spawn.headingDegrees).toBe(90);
    expect(blocked[start]).toBe(0);
    expect(heights[start]).toBeGreaterThan(zones.world.terrain.seaLevel + 1);
  });

  it('the primary route, the checkpoint and every place are reachable from the spawn', () => {
    const places = triggers.triggers.filter(
      (trigger) =>
        (trigger.zone === 'morvath' || trigger.zone === 'black_citadel') &&
        trigger.kind === 'place' &&
        trigger.shape.type === 'circle',
    );
    expect(places.length).toBeGreaterThanOrEqual(8);
    for (const place of places) {
      if (place.shape.type !== 'circle') continue;
      expect(reachable[cellOf(place.shape.x, place.shape.z)], place.id).toBe(1);
    }
    const checkpoint = morvath.checkpoint;
    if (!checkpoint) throw new Error('no checkpoint');
    expect(reachable[cellOf(checkpoint.x, checkpoint.z)]).toBe(1);
    // In front of the sealed crypt door and the Citadel keep (future instances).
    for (const zone of [morvath, citadel]) {
      for (const instance of zone.instances) {
        expect(reachable[cellOf(instance.entrance.x, instance.entrance.z)], instance.id).toBe(1);
      }
    }
    // The Citadel's own spawn point (the gate) and the way back west into the Plains.
    const gate = citadel.spawnPoints[0];
    if (!gate) throw new Error('no gate spawn');
    expect(reachable[cellOf(gate.x, gate.z)]).toBe(1);
    expect(reachable[cellOf(1170, 0)]).toBe(1);
  });

  it('has no softlocks: wherever you can walk, you can walk back to the spawn', () => {
    const traps: string[] = [];
    for (let v = 0; v < reachable.length && traps.length < 12; v++) {
      if (reachable[v] && !canReturn[v]) traps.push(describeCell(v));
    }
    expect(traps).toEqual([]);
  });

  it('is closed off by its ridges: the rest of Morvath is not reachable on foot', () => {
    for (const [x, z] of [
      [1300, -250],
      [1300, 250],
      [1400, -250],
      [1400, 250],
      [1700, -255],
      [1700, 255],
      [1900, -240],
      [1900, 240],
    ] as const) {
      expect(reachable[cellOf(x, z)], `${x}, ${z}`).toBe(0);
    }
  });

  it('the western ridge cannot be climbed anywhere along the border (only the pass is open)', () => {
    const step = 0.25;
    for (let z = -1200; z <= 1200; z += 40) {
      if (Math.abs(z) < 70) continue;
      let climbable = true;
      for (let x = 1150; x < 1260 && climbable; x += step) {
        const rise = field.heightAt(x + step, z) - field.heightAt(x, z);
        if (rise > maxRise * step) climbable = false;
      }
      expect(climbable, `z = ${z}`).toBe(false);
    }
  });

  it('the Black Citadel keep is a far landmark that stands on the court, well above the valley', () => {
    const keep = placed.find((s) => s.def.id === 'black_citadel_keep');
    expect(keep?.def.horizon).toBe(true);
    expect(keep?.top).toBeGreaterThan((heights[start] as number) + 100);
  });

  it('the Blightborn and the slime packs stay off the primary route', () => {
    const road = morvath.terrain.features?.find((feature) => feature.id === 'morvath_road');
    if (!road) throw new Error('no road');
    const nearRoad = (x: number, z: number, margin: number) =>
      road.points.some((p) => Math.hypot(p[0] - x, p[1] - z) < margin);
    for (const spawnDef of morvath.spawns ?? []) {
      expect(nearRoad(spawnDef.x, spawnDef.z, 60), spawnDef.id).toBe(false);
    }
  });
});
