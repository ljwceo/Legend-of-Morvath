import { describe, expect, it } from 'vitest';
import { type HorizonProjection, horizonVisibility, projectToHorizon } from './HorizonLandmarks';

describe('projectToHorizon', () => {
  const out: HorizonProjection = { x: 0, y: 0, z: 0, scale: 0, distance: 0 };

  it('puts the landmark on the same ray at the given radius, scaled by radius / distance', () => {
    // Camera at (0, 2, 0), a tower 600 m east with its base at height 14.
    expect(projectToHorizon(0, 2, 0, 600, 14, 0, 150, out)).toBe(true);
    expect(out.distance).toBeCloseTo(Math.hypot(600, 12));
    expect(out.scale).toBeCloseTo(150 / out.distance);
    expect(out.x).toBeCloseTo(600 * out.scale);
    expect(out.y).toBeCloseTo(2 + 12 * out.scale);
    expect(out.z).toBeCloseTo(0);
    // The apparent size is unchanged: height / distance is the same before and after.
    const realAngle = 110 / out.distance;
    const drawnAngle = (110 * out.scale) / 150;
    expect(drawnAngle).toBeCloseTo(realAngle);
  });

  it('is hidden once the landmark is within the radius (the real structure shows)', () => {
    expect(projectToHorizon(0, 0, 0, 100, 0, 0, 150, out)).toBe(false);
    expect(out.scale).toBe(0);
    expect(projectToHorizon(0, 0, 0, 0, 0, 0, 150, out)).toBe(false);
  });

  it('is the same on every graphics preset: only the radius differs, never the direction or angle', () => {
    const low: HorizonProjection = { x: 0, y: 0, z: 0, scale: 0, distance: 0 };
    const high: HorizonProjection = { x: 0, y: 0, z: 0, scale: 0, distance: 0 };
    projectToHorizon(10, 3, -5, 700, 20, 300, 113, low);
    projectToHorizon(10, 3, -5, 700, 20, 300, 360, high);
    expect(low.scale / 113).toBeCloseTo(high.scale / 360);
    expect((low.x - 10) / (low.z + 5)).toBeCloseTo((high.x - 10) / (high.z + 5));
  });
});

describe('horizonVisibility', () => {
  it('is clearest at the edge of the fog and fades with distance, never to nothing', () => {
    expect(horizonVisibility(150, 150)).toBeCloseTo(0.55);
    expect(horizonVisibility(2000, 150)).toBeCloseTo(0.22);
    expect(horizonVisibility(5000, 150)).toBeCloseTo(0.22);
    expect(horizonVisibility(800, 150)).toBeGreaterThan(0.22);
    expect(horizonVisibility(800, 150)).toBeLessThan(0.55);
  });
});
