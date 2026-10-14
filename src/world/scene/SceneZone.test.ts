import { describe, expect, it } from 'vitest';
import type { SceneDoorDef } from '../../data/types';
import { doorAngleFromCheat } from './SceneZone';

const DEG = Math.PI / 180;

function door(left: number, right: number): SceneDoorDef {
  return {
    id: 'test',
    hinge: { x: 0, z: 0 },
    tip: { x: 1, z: 0 },
    box: { min: { x: -1, y: 0, z: -1 }, max: { x: 2, y: 3, z: 1 } },
    openDegrees: { left, right },
  };
}

describe('doorAngleFromCheat', () => {
  it('is closed when the cheat is off', () => {
    expect(doorAngleFromCheat(null, door(85, 85))).toBe(0);
  });

  it('turns to the angle inside the stops (positive = left)', () => {
    expect(doorAngleFromCheat(45, door(85, 85))).toBeCloseTo(45 * DEG);
    expect(doorAngleFromCheat(-45, door(85, 85))).toBeCloseTo(-45 * DEG);
  });

  it('never goes past a stop, and a stop of 0 keeps that side shut', () => {
    expect(doorAngleFromCheat(120, door(85, 85))).toBeCloseTo(85 * DEG);
    expect(doorAngleFromCheat(-120, door(85, 85))).toBeCloseTo(-85 * DEG);
    expect(doorAngleFromCheat(85, door(0, 85))).toBe(0);
    expect(doorAngleFromCheat(-85, door(0, 85))).toBeCloseTo(-85 * DEG);
  });
});
