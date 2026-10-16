import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { textureTint } from './ScenePlayerModel';

// The average of Hero_BaseColor.jpg under the Skin faces (materials.json, linear).
const SKIN_AVERAGE: [number, number, number] = [0.7976, 0.4093, 0.2406];

describe('textureTint', () => {
  it('makes the texture average exactly the chosen color', () => {
    const chosen = new Color(0.6, 0.3, 0.2);
    const tint = textureTint(chosen, SKIN_AVERAGE, new Color());
    expect(tint.r * SKIN_AVERAGE[0]).toBeCloseTo(0.6, 6);
    expect(tint.g * SKIN_AVERAGE[1]).toBeCloseTo(0.3, 6);
    expect(tint.b * SKIN_AVERAGE[2]).toBeCloseTo(0.2, 6);
  });

  it('is 1 when the chosen color is the average (the texture as painted)', () => {
    const chosen = new Color(SKIN_AVERAGE[0], SKIN_AVERAGE[1], SKIN_AVERAGE[2]);
    const tint = textureTint(chosen, SKIN_AVERAGE, new Color());
    expect(tint.r).toBeCloseTo(1, 6);
    expect(tint.g).toBeCloseTo(1, 6);
    expect(tint.b).toBeCloseTo(1, 6);
  });

  it('leaves a channel alone when the average has none, and never explodes', () => {
    const tint = textureTint(new Color(1, 1, 1), [0, 0.001, 0.5], new Color());
    expect(tint.r).toBe(1);
    expect(tint.g).toBe(4);
    expect(tint.b).toBe(2);
  });

  it('writes into the given color and returns it (no allocation)', () => {
    const out = new Color();
    expect(textureTint(new Color(0.5, 0.5, 0.5), SKIN_AVERAGE, out)).toBe(out);
  });
});
