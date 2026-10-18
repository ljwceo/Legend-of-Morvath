import { describe, expect, it } from 'vitest';
import {
  fogRemainder,
  type HorizonProjection,
  horizonVisibility,
  projectToHorizon,
} from './HorizonLandmarks';

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
  // The open world's fog: near = 0.35 × far, the silhouette at 0.9 × far (WorldState).
  const far = 260 * 0.7;
  const near = far * 0.35;
  const radius = far * 0.9;

  it('hands over to the real building without a jump: at the radius it shows what the fog leaves', () => {
    const left = fogRemainder(radius, near, far);
    expect(left).toBeCloseTo(1 - (0.9 - 0.35) / 0.65, 5);
    expect(horizonVisibility(radius, radius, near, far)).toBeCloseTo(left, 6);
    // Just beyond the radius the silhouette is as dark as the real building just inside it.
    expect(horizonVisibility(radius + 0.01, radius, near, far)).toBeCloseTo(left, 3);
  });

  it('grows a little with distance so a far landmark stays readable, and never beyond 1', () => {
    const atRadius = horizonVisibility(radius, radius, near, far);
    const far1km = horizonVisibility(1000, radius, near, far);
    const far5km = horizonVisibility(5000, radius, near, far);
    expect(far1km).toBeGreaterThan(atRadius);
    expect(far5km).toBeGreaterThan(far1km);
    expect(far5km).toBeLessThanOrEqual(1);
    expect(far5km).toBeCloseTo(horizonVisibility(2000, radius, near, far), 6);
  });

  it('fogRemainder follows Three.js linear fog', () => {
    expect(fogRemainder(0, 10, 100)).toBe(1);
    expect(fogRemainder(55, 10, 100)).toBeCloseTo(0.5);
    expect(fogRemainder(100, 10, 100)).toBe(0);
    expect(fogRemainder(50, 100, 100)).toBe(0);
  });
});
