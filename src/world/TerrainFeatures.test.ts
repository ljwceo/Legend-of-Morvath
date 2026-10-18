import { describe, expect, it } from 'vitest';
import { zonesFileSchema } from '../data/schemas';
import { colorTokens } from '../render/palette';
import { readPublicJson } from '../test/loadPublic';
import { PROP_STRIDE, scatterChunk } from './Scatter';
import { buildWorldGenConfig } from './terrainConfig';
import { type LineHit, nearestOnLine, type TerrainConfig, TerrainField } from './TerrainField';

const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const color = (token: string): number => colorTokens.get(token) ?? 0;

/** A flat world of one zone at height 10, without hills, to see the features on their own. */
function flatConfig(features: TerrainConfig['features']): TerrainConfig {
  return {
    seed: 1,
    minX: -1000,
    minZ: -1000,
    maxX: 1000,
    maxZ: 1000,
    seaFloor: -8,
    coastWidth: 1,
    blendWidth: 1,
    wavelength: 100,
    octaves: 1,
    seaColor: 0x000000,
    zones: [
      {
        id: 'flat',
        priority: 0,
        minX: -1000,
        minZ: -1000,
        maxX: 1000,
        maxZ: 1000,
        baseHeight: 10,
        amplitude: 0,
        color: 0x808080,
      },
    ],
    rivers: [],
    riverColor: 0,
    features,
  };
}

describe('nearestOnLine', () => {
  const hit: LineHit = { distance: 0, t: 0, segment: 0 };

  it('measures the distance to a single point', () => {
    nearestOnLine([10, 20, 5], 3, 13, 24, hit);
    expect(hit.distance).toBeCloseTo(5);
    expect(hit.segment).toBe(0);
  });

  it('finds the nearest segment and the fraction along it (x, z, h triples)', () => {
    const line = [0, 0, 1, 100, 0, 2, 100, 100, 3];
    nearestOnLine(line, 3, 25, -10, hit);
    expect(hit.distance).toBeCloseTo(10);
    expect(hit.segment).toBe(0);
    expect(hit.t).toBeCloseTo(0.25);
    nearestOnLine(line, 3, 108, 60, hit);
    expect(hit.distance).toBeCloseTo(8);
    expect(hit.segment).toBe(3);
    expect(hit.t).toBeCloseTo(0.6);
  });

  it('works with x, z pairs too (clearings for props)', () => {
    nearestOnLine([0, 0, 10, 0], 2, 20, 0, hit);
    expect(hit.distance).toBeCloseTo(10);
    expect(hit.t).toBe(1);
  });
});

describe('terrain features', () => {
  const ridge: TerrainConfig['features'][number] = {
    id: 'ridge',
    level: false,
    half: 5,
    falloff: 10,
    points: [0, -100, 20, 0, 100, 20],
    color: -1,
    colorStrength: 1,
    minX: -15,
    minZ: -115,
    maxX: 15,
    maxZ: 115,
  };

  it('an offset ridge adds its height on the line and fades out over the falloff', () => {
    const field = new TerrainField(flatConfig([ridge]));
    expect(field.heightAt(0, 0)).toBeCloseTo(30);
    expect(field.heightAt(4, 0)).toBeCloseTo(30);
    expect(field.heightAt(10, 0)).toBeCloseTo(20);
    expect(field.heightAt(16, 0)).toBeCloseTo(10);
    expect(field.heightAt(-200, 0)).toBeCloseTo(10);
    // Smooth: no step anywhere across the ridge.
    for (let x = -20; x < 20; x += 0.25) {
      expect(Math.abs(field.heightAt(x + 0.25, 0) - field.heightAt(x, 0))).toBeLessThan(0.8);
    }
  });

  it('a level feature pulls the ground to an absolute height, interpolated along the line', () => {
    const road: TerrainConfig['features'][number] = {
      ...ridge,
      id: 'road',
      level: true,
      points: [0, 0, 20, 100, 0, 40],
      minX: -15,
      minZ: -15,
      maxX: 115,
      maxZ: 15,
    };
    const field = new TerrainField(flatConfig([road]));
    expect(field.heightAt(0, 0)).toBeCloseTo(20);
    expect(field.heightAt(50, 0)).toBeCloseTo(30);
    expect(field.heightAt(100, 0)).toBeCloseTo(40);
    expect(field.heightAt(50, 10)).toBeCloseTo(20); // halfway through the falloff
    expect(field.heightAt(50, 40)).toBeCloseTo(10);
  });

  it('a one-point level feature is a flat round plateau or crater', () => {
    const crater: TerrainConfig['features'][number] = {
      ...ridge,
      id: 'crater',
      level: true,
      points: [0, 0, 4],
      half: 10,
      falloff: 10,
      minX: -20,
      minZ: -20,
      maxX: 20,
      maxZ: 20,
    };
    const field = new TerrainField(flatConfig([crater]));
    expect(field.heightAt(0, 0)).toBeCloseTo(4);
    expect(field.heightAt(7, 7)).toBeCloseTo(4);
    expect(field.heightAt(25, 0)).toBeCloseTo(10);
  });

  it('tints the ground where the feature is', () => {
    const dark = { ...ridge, color: 0x000000, colorStrength: 1 };
    const field = new TerrainField(flatConfig([dark]));
    const on = { height: 0, r: 0, g: 0, b: 0 };
    const off = { height: 0, r: 0, g: 0, b: 0 };
    field.sample(0, 0, on);
    field.sample(100, 0, off);
    expect(on.r).toBeLessThan(off.r * 0.05);
  });

  it('is skipped outside its bounding box (same result as without)', () => {
    const with_ = new TerrainField(flatConfig([ridge]));
    const without = new TerrainField(flatConfig([]));
    expect(with_.heightAt(300, 300)).toBe(without.heightAt(300, 300));
  });
});

describe('terrain features in zones.json', () => {
  const config = buildWorldGenConfig(zones, color, 1);

  it('are flattened for the worker with their bounding boxes', () => {
    const road = config.terrain.features.find((feature) => feature.id === 'morvath_road');
    expect(road).toBeDefined();
    expect(road?.level).toBe(false);
    expect(road?.points.length).toBeGreaterThan(6);
    expect(road?.minX).toBeLessThan(1222);
    expect(road?.maxX).toBeGreaterThan(1748);
  });

  it('keep props off features with noScatter (the road)', () => {
    const field = new TerrainField(config.terrain);
    // Every full-detail chunk the road crosses: no prop stands on the road itself.
    const road = zones.zones
      .find((zone) => zone.id === 'morvath')
      ?.terrain.features?.find((feature) => feature.id === 'morvath_road');
    if (!road) throw new Error('morvath_road missing');
    const line = road.points.flatMap((point) => [point[0], point[1]]);
    const hit: LineHit = { distance: 0, t: 0, segment: 0 };
    const size = config.chunkSize;
    let props = 0;
    for (let cx = Math.floor(1222 / size); cx <= Math.floor(1748 / size); cx++) {
      const cz = Math.floor(0 / size);
      for (const list of scatterChunk(field, config.scatter, cx, cz, size)) {
        for (let o = 0; o < list.length; o += PROP_STRIDE) {
          props++;
          const x = cx * size + (list[o] as number);
          const z = cz * size + (list[o + 2] as number);
          nearestOnLine(line, 2, x, z, hit);
          expect(hit.distance).toBeGreaterThanOrEqual(road.half + road.falloff);
        }
      }
    }
    expect(props).toBeGreaterThan(0);
  });
});
