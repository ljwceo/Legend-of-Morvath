import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { dataSchemas } from '../data/schemas';
import type { DayNightFile } from '../data/types';
import type { DayNightService, LookBlend } from '../services/DayNightService';
import { readPublicJson } from '../test/loadPublic';
import { colorTokens } from './palette';
import { DayNightLighting } from './DayNightLighting';

const daynight = dataSchemas.daynight.parse(readPublicJson('data/daynight.json')) as DayNightFile;
const color = (token: string): number => colorTokens.get(token) ?? 0;

/** A clock that always says: fully in phase `index`. */
function clockAt(index: number): DayNightService {
  return {
    blend: (out: LookBlend = { a: 0, b: 0, t: 0 }) => {
      out.a = index;
      out.b = index;
      out.t = 0;
      return out;
    },
  } as unknown as DayNightService;
}

const lookOf = (id: string) => {
  const look = daynight.looks.find((entry) => entry.id === id);
  if (!look) throw new Error(`no look ${id}`);
  return look;
};

describe('DayNightLighting with a fixed look', () => {
  const day = clockAt(0);

  it('follows the cycle by default', () => {
    const lighting = new DayNightLighting(daynight, color);
    lighting.update(day, 0);
    expect(lighting.sun.getHex()).toBe(color(lookOf('day').sun));
    expect(lighting.sunStrength).toBe(lookOf('day').sunStrength);
  });

  it('shows the fixed look at once when asked (building the world, a teleport)', () => {
    const lighting = new DayNightLighting(daynight, color);
    lighting.setMode('fixed', 'blight', true);
    lighting.update(day, 0);
    const blight = lookOf('blight');
    expect(lighting.sun.getHex()).toBe(color(blight.sun));
    expect(lighting.fog.getHex()).toBe(color(blight.fog));
    expect(lighting.sunStrength).toBe(blight.sunStrength);
    expect(lighting.uniforms.stars.value).toBe(blight.stars);
    expect(lighting.uniforms.sunDisk.value).toBe(blight.sunDisk);
  });

  it('fades into the fixed look over a few seconds when walking across the border', () => {
    const lighting = new DayNightLighting(daynight, color);
    lighting.update(day, 0);
    const dayFog = new Color().copy(lighting.fog);
    lighting.setMode('fixed', 'blight', false);
    lighting.update(day, 1.5);
    const halfway = new Color().copy(lighting.fog);
    const blightFog = new Color(color(lookOf('blight').fog));
    const expected = dayFog.clone().lerp(blightFog, 0.5);
    expect(halfway.r).toBeCloseTo(expected.r, 3);
    expect(halfway.g).toBeCloseTo(expected.g, 3);
    expect(halfway.b).toBeCloseTo(expected.b, 3);
    lighting.update(day, 5);
    expect(lighting.fog.getHex()).toBe(blightFog.getHex());
    // And back out again.
    lighting.setMode('cycle', null, false);
    lighting.update(day, 10);
    expect(lighting.fog.getHex()).toBe(dayFog.getHex());
  });

  it('ignores an unknown look (the DataValidator reports it) and snaps on request', () => {
    const lighting = new DayNightLighting(daynight, color);
    lighting.setMode('fixed', 'nowhere', true);
    lighting.update(day, 0);
    expect(lighting.sun.getHex()).toBe(color(lookOf('day').sun));
    lighting.setMode('fixed', 'blight', false);
    lighting.snap();
    lighting.update(day, 0);
    expect(lighting.sun.getHex()).toBe(color(lookOf('blight').sun));
  });

  it('keeps the golden hour as it was', () => {
    const lighting = new DayNightLighting(daynight, color);
    lighting.setMode('goldenHour', null, true);
    lighting.update(clockAt(2), 0);
    expect(lighting.sun.getHex()).toBe(color(lookOf('golden_hour').sun));
  });
});
