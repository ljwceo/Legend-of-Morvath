import { describe, expect, it } from 'vitest';
import { readiness } from './Readiness';

describe('readiness', () => {
  it('is 1 when there is nothing to wait for', () => {
    expect(readiness(0, 2)).toBe(1);
    expect(readiness(-0.1, 2)).toBe(1);
    expect(readiness(1, 0)).toBe(1);
    expect(readiness(1, -1)).toBe(1);
  });

  it('rises from 0 to 1 as the cooldown runs down', () => {
    expect(readiness(2, 2)).toBe(0);
    expect(readiness(1, 2)).toBeCloseTo(0.5, 9);
    expect(readiness(0.5, 2)).toBeCloseTo(0.75, 9);
    expect(readiness(1e-9, 2)).toBeCloseTo(1, 6);
  });

  it('never leaves 0–1, even when more is left than the total', () => {
    expect(readiness(3, 2)).toBe(0);
  });
});
