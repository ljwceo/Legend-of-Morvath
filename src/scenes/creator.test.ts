import { describe, expect, it } from 'vitest';
import { Random } from '../core/Random';
import { validateGameData } from '../data/DataValidator';
import { saveDataSchema, createNewSave } from '../save/SaveData';
import { readAllData } from '../test/loadPublic';
import {
  checkName,
  createCharacter,
  hairstylesFor,
  normalizeAppearance,
  randomAppearance,
  sanitizeName,
  withBodyType,
} from './creator';
import { presetPoints, unspentPoints } from '../systems/Stats';

const { data } = validateGameData(readAllData());
if (!data) throw new Error('data invalid');
const appearance = data.appearance;
const rules = appearance.name;

describe('character creator data', () => {
  it('has the options from the concept', () => {
    expect(appearance.bodyTypes).toHaveLength(2);
    for (const body of appearance.bodyTypes) {
      expect(hairstylesFor(appearance, body.id)).toHaveLength(5);
    }
    expect(appearance.hairColors).toHaveLength(19);
    expect(appearance.skinTones).toHaveLength(6);
    expect(appearance.mantleColors).toHaveLength(6);
    expect(rules.maxLength).toBe(16);
  });
});

describe('sanitizeName', () => {
  it('drops spaces, punctuation and emoji', () => {
    expect(sanitizeName('Bo the 2nd!', rules)).toBe('Bothe2nd');
    expect(sanitizeName('Lu🐱cas', rules)).toBe('Lucas');
  });

  it('keeps letters with accents', () => {
    expect(sanitizeName('Zoë', rules)).toBe('Zoë');
  });

  it('cuts at the maximum length', () => {
    expect(sanitizeName('abcdefghijklmnopqrstuvwxyz', rules)).toBe('abcdefghijklmnop');
  });
});

describe('checkName', () => {
  it('accepts letters and numbers up to 16 characters', () => {
    expect(checkName('Lucas', rules)).toEqual({ ok: true, name: 'Lucas' });
    expect(checkName('Bo2', rules)).toEqual({ ok: true, name: 'Bo2' });
    expect(checkName('abcdefghijklmnop', rules).ok).toBe(true);
  });

  it('refuses empty, too long and invalid names', () => {
    expect(checkName('', rules)).toEqual({ ok: false, reason: 'empty' });
    expect(checkName('   ', rules)).toEqual({ ok: false, reason: 'empty' });
    expect(checkName('abcdefghijklmnopq', rules)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkName('Bo Lucas', rules)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkName('<b>', rules)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('withBodyType', () => {
  it('keeps a hairstyle with the same label', () => {
    const start = normalizeAppearance({ bodyType: 'male', hairstyle: 'male_ponytail' }, appearance);
    expect(withBodyType(start, appearance, 'female').hairstyle).toBe('female_ponytail');
  });

  it('otherwise keeps the position in the list', () => {
    const start = normalizeAppearance({ bodyType: 'female', hairstyle: 'female_bob' }, appearance);
    const switched = withBodyType(start, appearance, 'male');
    expect(switched.bodyType).toBe('male');
    expect(switched.hairstyle).toBe('male_swept');
  });

  it('always gives a hairstyle that fits the body type', () => {
    for (const style of appearance.hairstyles) {
      for (const body of appearance.bodyTypes) {
        const start = normalizeAppearance(
          { bodyType: style.bodyType, hairstyle: style.id },
          appearance,
        );
        const result = withBodyType(start, appearance, body.id);
        expect(hairstylesFor(appearance, body.id).map((s) => s.id)).toContain(result.hairstyle);
      }
    }
  });
});

describe('normalizeAppearance', () => {
  it('falls back to the defaults for unknown ids', () => {
    expect(normalizeAppearance(null, appearance)).toEqual(appearance.defaults);
    const fixed = normalizeAppearance({ hairColor: 'rainbow', skinTone: 'tone_4' }, appearance);
    expect(fixed.hairColor).toBe(appearance.defaults.hairColor);
    expect(fixed.skinTone).toBe('tone_4');
  });

  it('replaces a hairstyle of the other body type', () => {
    const fixed = normalizeAppearance({ bodyType: 'female', hairstyle: 'male_short' }, appearance);
    expect(fixed.hairstyle.startsWith('female_')).toBe(true);
  });
});

describe('randomAppearance', () => {
  it('always produces a valid appearance and uses every option list', () => {
    const random = new Random(7);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const result = randomAppearance(appearance, random);
      expect(normalizeAppearance(result, appearance)).toEqual(result);
      seen.add(result.hairColor);
    }
    expect(seen.size).toBe(appearance.hairColors.length);
  });
});

describe('createCharacter', () => {
  it('gives the start items from player.json and fits the save format', () => {
    const character = createCharacter('Lucas', appearance.defaults, data.player);
    expect(character.inventory.map((entry) => entry.item)).toEqual(
      data.player.start.items.map((entry) => entry.item),
    );
    expect(character.equipment).toEqual(data.player.start.equipment);
    expect(character.equipment).not.toBe(data.player.start.equipment);
    const save = createNewSave('en');
    save.character = character;
    expect(saveDataSchema.safeParse(save).success).toBe(true);
  });

  it('starts with nothing spent when no points are given', () => {
    const character = createCharacter('Lucas', appearance.defaults, data.player);
    expect(character.stats).toEqual({});
    expect(unspentPoints(data.stats, 1, character.stats)).toBe(data.stats.startPoints);
  });

  it('keeps the points you spread in the creator, as a copy', () => {
    const points = presetPoints(data.stats, 'sword_fighter');
    const character = createCharacter('Bo', appearance.defaults, data.player, points);
    expect(character.stats).toEqual(points);
    expect(character.stats).not.toBe(points);
    expect(unspentPoints(data.stats, 1, character.stats)).toBe(0);
    const save = createNewSave('en');
    save.character = character;
    expect(saveDataSchema.safeParse(save).success).toBe(true);
  });
});
