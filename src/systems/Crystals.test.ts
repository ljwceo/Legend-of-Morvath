import { describe, expect, it } from 'vitest';
import {
  crystalBonus,
  effectiveLevel,
  levelFor,
  mergeCrystal,
  mergeElement,
  spellSizeFactor,
  type CrystalLevel,
  type MergeInput,
} from './Crystals';

const levels: CrystalLevel[] = [
  { size: 'small', units: 1, damageBonus: 1, spellSizePercent: 0 },
  { size: 'medium', units: 2, damageBonus: 2, spellSizePercent: 15 },
  { size: 'large', units: 4, damageBonus: 4, spellSizePercent: 30 },
  { size: 'grand', units: 8, damageBonus: 8, spellSizePercent: 50 },
];
const sizes = ['small', 'medium', 'large', 'grand'];

const base: MergeInput = {
  crystal: 'fire',
  units: 1,
  foundElement: 'fire',
  foundSize: 'small',
  staffMax: 'grand',
  inCombat: false,
  levels,
  sizes,
};

describe('crystal levels', () => {
  it('finds the size a worth reaches', () => {
    expect(levelFor(levels, 0)).toBeNull();
    expect(levelFor(levels, 1)?.size).toBe('small');
    expect(levelFor(levels, 3)?.size).toBe('medium');
    expect(levelFor(levels, 8)?.size).toBe('grand');
  });

  it('gives a bonus only with a crystal and a staff', () => {
    expect(crystalBonus(levels, sizes, 'fire', 2, 'grand').damageBonus).toBe(2);
    expect(crystalBonus(levels, sizes, null, 2, 'grand').damageBonus).toBe(0);
    expect(crystalBonus(levels, sizes, 'fire', 2, undefined).damageBonus).toBe(0);
  });

  it('caps the bonus at the biggest crystal the worn staff holds', () => {
    // A Grand crystal in a staff that holds Small only works as a Small one.
    const capped = crystalBonus(levels, sizes, 'fire', 8, 'small');
    expect(capped.damageBonus).toBe(1);
    expect(spellSizeFactor(capped)).toBe(1);
    expect(crystalBonus(levels, sizes, 'fire', 8, 'medium').damageBonus).toBe(2);
    expect(crystalBonus(levels, sizes, 'fire', 8, 'grand').damageBonus).toBe(8);
    expect(effectiveLevel(levels, sizes, 'fire', 8, 'large')?.size).toBe('large');
  });

  it('makes spells bigger with the size', () => {
    expect(spellSizeFactor(crystalBonus(levels, sizes, 'fire', 1, 'grand'))).toBe(1);
    expect(spellSizeFactor(crystalBonus(levels, sizes, 'fire', 4, 'grand'))).toBeCloseTo(1.3);
  });

  it('only merges crystals of one element', () => {
    expect(mergeElement(['fire'])).toBe('fire');
    expect(mergeElement(['water', 'fire'])).toBeNull();
  });
});

describe('mergeCrystal', () => {
  it('turns two equal crystals into one of the next size', () => {
    expect(mergeCrystal(base)).toEqual({ ok: true, units: 2 });
    expect(mergeCrystal({ ...base, units: 2, foundSize: 'medium' })).toEqual({
      ok: true,
      units: 4,
    });
    expect(mergeCrystal({ ...base, units: 4, foundSize: 'large' })).toEqual({
      ok: true,
      units: 8,
    });
  });

  it('refuses a crystal of another size, so a merge always makes a bigger crystal', () => {
    expect(mergeCrystal({ ...base, units: 2, foundSize: 'small' })).toEqual({
      ok: false,
      reason: 'sizeMismatch',
    });
    expect(mergeCrystal({ ...base, foundSize: 'medium' })).toEqual({
      ok: false,
      reason: 'sizeMismatch',
    });
  });

  it('refuses another element, no crystal, no staff and fights', () => {
    expect(mergeCrystal({ ...base, foundElement: 'water' })).toEqual({
      ok: false,
      reason: 'otherElement',
    });
    expect(mergeCrystal({ ...base, crystal: null })).toEqual({ ok: false, reason: 'noCrystal' });
    expect(mergeCrystal({ ...base, staffMax: undefined })).toEqual({
      ok: false,
      reason: 'noStaff',
    });
    expect(mergeCrystal({ ...base, inCombat: true })).toEqual({ ok: false, reason: 'inCombat' });
  });

  it('refuses a size the staff cannot hold', () => {
    expect(mergeCrystal({ ...base, staffMax: 'small' })).toEqual({
      ok: false,
      reason: 'staffTooSmall',
    });
  });

  it('refuses beyond the largest crystal', () => {
    expect(mergeCrystal({ ...base, units: 8, foundSize: 'grand' })).toEqual({
      ok: false,
      reason: 'maxSize',
    });
  });
});
