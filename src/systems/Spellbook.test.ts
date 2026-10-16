import { describe, expect, it } from 'vitest';
import { activeSpell, normalizeLoadout, setSlot, spellsToLearn, usableSpells } from './Spellbook';

const known = ['fireball', 'thorn_shot', 'wind_slice'];

describe('normalizeLoadout', () => {
  it('fills a never-chosen loadout from the known spells', () => {
    expect(normalizeLoadout([], known, 2)).toEqual(['fireball', 'thorn_shot']);
    expect(normalizeLoadout([], [], 2)).toEqual(['', '']);
  });
  it('drops unknown spells and duplicates, and pads to the slots', () => {
    expect(normalizeLoadout(['nope', 'fireball', 'fireball'], known, 3)).toEqual([
      '',
      'fireball',
      '',
    ]);
  });
  it('clears slots beyond the staff without forgetting spells', () => {
    expect(normalizeLoadout(['thorn_shot', 'fireball', 'wind_slice'], known, 1)).toEqual([
      'thorn_shot',
    ]);
  });
});

describe('setSlot', () => {
  it('puts a spell in a slot and moves it from another', () => {
    expect(setSlot(['fireball', ''], 1, 'fireball', known, 2, false)).toEqual(['', 'fireball']);
  });
  it('can empty a slot', () => {
    expect(setSlot(['fireball', 'thorn_shot'], 0, '', known, 2, false)).toEqual(['', 'thorn_shot']);
  });
  it('refuses in a fight, unknown spells and missing slots', () => {
    expect(setSlot(['fireball'], 0, 'thorn_shot', known, 1, true)).toBeNull();
    expect(setSlot(['fireball'], 0, 'water_bolt', known, 1, false)).toBeNull();
    expect(setSlot(['fireball'], 1, 'thorn_shot', known, 1, false)).toBeNull();
  });
});

describe('activeSpell', () => {
  it('is the first filled slot', () => {
    expect(activeSpell(['', 'thorn_shot'])).toBe('thorn_shot');
    expect(activeSpell(['', ''])).toBeNull();
  });
});

const defs = [
  { id: 'fireball', element: 'fire' },
  { id: 'ember_burst', element: 'fire', learnLevel: 5 },
  { id: 'tidal_lash', element: 'water', learnLevel: 5 },
];

describe('element of the crystal', () => {
  it('only offers known spells of the crystal element', () => {
    expect(usableSpells(['fireball', 'tidal_lash'], defs, 'fire')).toEqual(['fireball']);
    expect(usableSpells(['fireball'], defs, null)).toEqual([]);
  });
  it('keeps a spell of another element out of the slots', () => {
    const usable = usableSpells(['fireball', 'tidal_lash'], defs, 'fire');
    expect(setSlot([''], 0, 'tidal_lash', usable, 1, false)).toBeNull();
    expect(normalizeLoadout(['tidal_lash'], usable, 1)).toEqual(['']);
  });
  it('learns level spells of the crystal element once', () => {
    expect(spellsToLearn(['fireball'], defs, 'fire', 4)).toEqual([]);
    expect(spellsToLearn(['fireball'], defs, 'fire', 5)).toEqual(['ember_burst']);
    expect(spellsToLearn(['fireball', 'ember_burst'], defs, 'fire', 9)).toEqual([]);
    expect(spellsToLearn([], defs, null, 9)).toEqual([]);
  });
});
