import { describe, expect, it } from 'vitest';
import { playerFileSchema, spellsFileSchema } from '../data/schemas';
import { readPublicJson } from '../test/loadPublic';
import { MIN_SHOWN_COOLDOWN, readiness } from './Readiness';

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

  it('does not draw a wait shorter than MIN_SHOWN_COOLDOWN (it would only flicker)', () => {
    expect(readiness(0.3, 0.3)).toBe(1);
    expect(readiness(0.1, 0.49)).toBe(1);
    expect(readiness(MIN_SHOWN_COOLDOWN, MIN_SHOWN_COOLDOWN)).toBe(0);
  });

  it('draws every spell of spells.json, not the Shard or the fast hit (player.json)', () => {
    const player = playerFileSchema.parse(readPublicJson('data/player.json'));
    const spells = spellsFileSchema.parse(readPublicJson('data/spells.json'));
    for (const spell of spells.spells) {
      expect(spell.cooldownSeconds).toBeGreaterThanOrEqual(MIN_SHOWN_COOLDOWN);
    }
    const shard = 1 / player.staff.shard.maxPerSecond - player.staff.shard.windupSeconds;
    expect(shard).toBeLessThan(MIN_SHOWN_COOLDOWN);
    expect(1 / player.sword.fastHit.maxPerSecond).toBeLessThan(MIN_SHOWN_COOLDOWN);
  });
});
