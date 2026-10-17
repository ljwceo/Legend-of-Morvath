import { describe, expect, it } from 'vitest';
import { canPickUpMarker, markerAfterDeath } from './GoldMarker';

describe('GoldMarker', () => {
  it('a death that costs gold sets a marker where you fell', () => {
    expect(markerAfterDeath(1, 2, 3, null, 7)).toEqual({
      x: 1,
      y: 2,
      z: 3,
      instance: null,
      amount: 7,
    });
  });

  it('a death that costs nothing leaves no marker', () => {
    expect(markerAfterDeath(1, 2, 3, null, 0)).toBeNull();
  });

  it('a second death replaces the marker; the old gold is gone', () => {
    const first = markerAfterDeath(1, 0, 1, null, 10);
    const second = markerAfterDeath(50, 0, 60, null, 4);
    expect(first?.amount).toBe(10);
    expect(second).toEqual({ x: 50, y: 0, z: 60, instance: null, amount: 4 });
  });

  it('is picked up within the radius, in the same instance only', () => {
    const marker = markerAfterDeath(10, 0, 10, null, 5);
    if (!marker) throw new Error('marker expected');
    expect(canPickUpMarker(marker, 10.5, 10.5, null, 1.5)).toBe(true);
    expect(canPickUpMarker(marker, 13, 10, null, 1.5)).toBe(false);
    expect(canPickUpMarker(marker, 10, 10, 'tower', 1.5)).toBe(false);
  });
});
