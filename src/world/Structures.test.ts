import { describe, expect, it } from 'vitest';
import { zonesFileSchema } from '../data/schemas';
import type { Zone } from '../data/types';
import { hasStructureModel, structureShape } from '../entities/StructureFactory';
import { colorTokens } from '../render/palette';
import { readPublicJson } from '../test/loadPublic';
import { type Collider, pushOutOf } from './Colliders';
import { riverProfile } from './RiverWater';
import { placeStructures, segmentEntersBox } from './StructurePlacement';
import { buildWorldGenConfig } from './terrainConfig';
import { TerrainField } from './TerrainField';

const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const config = buildWorldGenConfig(zones, (token) => colorTokens.get(token) ?? 0, 1);
const field = new TerrainField(config.terrain);
const sink = zones.world.terrain.structureSink;
const placed = placeStructures(
  zones.zones,
  (x, z) => field.heightAt(x, z),
  structureShape,
  zones.world.chunkSize,
  sink,
);

function zoneWith(structures: Zone['structures']): Zone {
  return { ...(zones.zones[0] as Zone), id: 'test', structures };
}

describe('structures in zones.json', () => {
  it('use known placeholder models', () => {
    for (const zone of zones.zones) {
      for (const s of zone.structures ?? []) expect(hasStructureModel(s.model), s.model).toBe(true);
    }
  });

  it('include the places the concept asks for', () => {
    const ids = new Set(placed.map((s) => s.def.id));
    for (const id of [
      'monastery',
      'academy',
      'forge',
      'alchemy_lab',
      'golden_kettle',
      'aqueduct',
      'watchtower',
      'island_fort',
      'old_tjikko',
      'greenwood_shrine',
      'wortelgrotten_entrance',
      'stilt_monastery',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('never float: grounded structures reach below the ground at every corner', () => {
    for (const s of placed) {
      const d = s.def;
      if (d.connects || d.y !== undefined || (d.elevation ?? 0) > 0) continue;
      const hx = d.size[0] / 2;
      const hz = d.size[2] / 2;
      for (const [cx, cz] of [
        [-hx, -hz],
        [hx, -hz],
        [-hx, hz],
        [hx, hz],
      ] as const) {
        if ((d.rotation ?? 0) % 180 !== 0) continue;
        expect(s.y).toBeLessThan(field.heightAt(s.x + cx, s.z + cz));
      }
      // The top stays the given height above the ground at the center.
      expect(s.top).toBeCloseTo(field.heightAt(s.x, s.z) + d.size[1], 5);
    }
  });

  it('keep NPCs, spawn points and checkpoints out of solid buildings', () => {
    const npcs = readPublicJson('data/npcs.json') as {
      npcs: { id: string; zone: string; position: { x: number; z: number } }[];
    };
    // A Blender-built zone (Greyhaven) is played in its own scene, without these placeholder
    // buildings: its NPCs and spawn points stand in the Blender city.
    const scene = new Set(zones.zones.filter((zone) => zone.scene).map((zone) => zone.id));
    const points = npcs.npcs
      .filter((npc) => !scene.has(npc.zone))
      .map((npc) => ({ id: npc.id, ...npc.position }));
    for (const zone of zones.zones) {
      if (scene.has(zone.id)) continue;
      for (const spawn of zone.spawnPoints) points.push({ id: spawn.id, x: spawn.x, z: spawn.z });
      if (zone.checkpoint) points.push(zone.checkpoint);
    }
    for (const point of points) {
      for (const s of placed) {
        for (const collider of s.colliders) {
          const p = { x: point.x, z: point.z };
          expect(pushOutOf(p, 0.4, collider), `${point.id} in ${s.def.id}`).toBe(false);
        }
      }
    }
  });
});

describe('placeStructures', () => {
  const flat = () => 2;
  const shape = structureShape;

  it('gives a barrier colliders but no camera box, and a wall both', () => {
    const zone = zoneWith([
      {
        id: 'barrier',
        model: 'placeholder:barrier',
        x: 0,
        z: 0,
        size: [100, 1, 20],
        collider: 'box',
      },
      { id: 'wall', model: 'placeholder:wall', x: 0, z: 50, size: [100, 9, 3], collider: 'box' },
    ]);
    const [barrier, wall] = placeStructures([zone], flat, shape, 64, 1);
    expect(barrier?.colliders).toHaveLength(1);
    expect(barrier?.solid).toBeNull();
    expect(wall?.colliders).toHaveLength(1);
    expect(wall?.solid).not.toBeNull();
    // The barrier still blocks walking exactly like a wall.
    const p = { x: 0, z: 0 };
    expect(pushOutOf(p, 0.4, barrier?.colliders[0] as Collider)).toBe(true);
    expect(Math.abs(p.z)).toBeGreaterThanOrEqual(10.4 - 1e-6);
  });

  it('every barrier in zones.json has a collider and no camera box', () => {
    const barriers = placed.filter((s) => s.def.model === 'placeholder:barrier');
    expect(barriers.length).toBeGreaterThan(0);
    for (const s of barriers) {
      expect(s.colliders.length, s.def.id).toBeGreaterThan(0);
      expect(s.solid, s.def.id).toBeNull();
    }
  });

  it('lifts elevated structures and spans bridges between tops', () => {
    const zone = zoneWith([
      { id: 'a', model: 'placeholder:platform', x: 0, z: 0, size: [10, 8, 10], collider: 'posts' },
      {
        id: 'b',
        model: 'placeholder:platform',
        x: 30,
        z: 40,
        size: [10, 4, 10],
        collider: 'posts',
      },
      {
        id: 'hut',
        model: 'placeholder:house',
        x: 0,
        z: 0,
        size: [6, 4, 6],
        elevation: 8,
        collider: 'none',
      },
      {
        id: 'bridge',
        model: 'placeholder:bridge',
        size: [2, 0.5, 0],
        collider: 'none',
        connects: ['a', 'b'],
      },
    ]);
    const [a, b, hut, bridge] = placeStructures([zone], flat, shape, 64, 1);
    expect(a?.top).toBeCloseTo(10);
    expect(a?.colliders).toHaveLength(4);
    expect(hut?.y).toBeCloseTo(10);
    expect(bridge?.def.id).toBe('bridge');
    expect(bridge?.scaleZ).toBeCloseTo(Math.hypot(50, 4));
    expect(bridge?.y).toBeCloseTo((10 + 6) / 2 - 0.5);
    expect(bridge?.pitch).toBeLessThan(0);
    expect(b?.chunkKeys.length).toBeGreaterThan(0);
  });

  it('turns box colliders with the rotation', () => {
    const zone = zoneWith([
      {
        id: 'h',
        model: 'placeholder:house',
        x: 0,
        z: 0,
        size: [20, 5, 4],
        rotation: 90,
        collider: 'box',
      },
    ]);
    const [h] = placeStructures([zone], flat, shape, 64, 1);
    const box = h?.colliders[0];
    expect(box?.kind).toBe('box');
    if (box?.kind === 'box') {
      expect(box.maxX - box.minX).toBeCloseTo(4);
      expect(box.maxZ - box.minZ).toBeCloseTo(20);
    }
  });

  it('lists every chunk a long wall touches', () => {
    const zone = zoneWith([
      { id: 'w', model: 'placeholder:wall', x: 0, z: 10, size: [200, 5, 2], collider: 'box' },
    ]);
    const [w] = placeStructures([zone], flat, shape, 64, 1);
    // −100..100 in x covers chunks −2..1.
    expect(w?.chunkKeys).toHaveLength(4);
  });
});

describe('segmentEntersBox (camera vs walls)', () => {
  const box = { minX: 4, minY: 0, minZ: -1, maxX: 6, maxY: 5, maxZ: 1 };
  it('finds where the line of sight enters a wall', () => {
    expect(segmentEntersBox(0, 1, 0, 10, 1, 0, box)).toBeCloseTo(0.4);
    expect(segmentEntersBox(0, 8, 0, 10, 8, 0, box)).toBe(1);
    expect(segmentEntersBox(0, 1, 0, 3, 1, 0, box)).toBe(1);
    // Starting inside never pulls the camera onto the player.
    expect(segmentEntersBox(5, 1, 0, 10, 1, 0, box)).toBe(1);
  });
});

describe('rivers', () => {
  it('carve a bed below the land, with the water between bed and land', () => {
    const drop = zones.world.terrain.riverWaterDrop;
    for (const river of config.terrain.rivers) {
      const samples = riverProfile(field, river, drop);
      for (let k = 0; k < samples.length; k += 3 * 10) {
        const x = samples[k] as number;
        const z = samples[k + 1] as number;
        const water = samples[k + 2] as number;
        expect(field.riverAt(x, z)).toBe(1);
        const bed = field.heightAt(x, z);
        const land = field.landHeightAt(x, z);
        expect(bed).toBeCloseTo(land - river.depth, 5);
        // Smoothing moves the level a little, but it stays inside the river bed.
        expect(water).toBeGreaterThan(bed);
        expect(water).toBeLessThan(land + 0.5);
      }
    }
  });

  it('stay shallow enough to wade through (never deeper than the deep-water limit)', () => {
    const t = zones.world.terrain;
    for (const river of zones.world.rivers ?? []) {
      expect(river.depth - t.riverWaterDrop).toBeLessThan(t.deepWater);
    }
  });

  it('keep trees out of the water', () => {
    expect(field.riverAt(-1820, 172)).toBeGreaterThan(0);
    expect(field.riverAt(-1820, 120)).toBe(0);
  });
});
