import { describe, expect, it } from 'vitest';
import { itemsFileSchema, playerFileSchema, spellsFileSchema } from '../data/schemas';
import type { ItemDef, ItemsFile, PlayerConfig, SpellsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { elementUnlocked, knownIncantations, ownsGrimoire } from './Grimoire';

const items = itemsFileSchema.parse(readPublicJson('data/items.json')) as ItemsFile;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
const byId = new Map<string, ItemDef>(items.items.map((item) => [item.id, item]));

const NONE: readonly string[] = [];

describe('Grimoire access (G.3, G.4)', () => {
  it('a new character carries the Rookie Grimoire from the start kit and so owns one', () => {
    expect(ownsGrimoire(player.start.items, byId)).toBe(true);
  });

  it('owning one is enough: it is never equipped, and an empty stack does not count', () => {
    expect(player.start.equipment).not.toHaveProperty('grimoire');
    expect(ownsGrimoire([{ item: 'rookie_grimoire', count: 0 }], byId)).toBe(false);
    expect(ownsGrimoire([{ item: 'old_sword', count: 1 }], byId)).toBe(false);
    expect(ownsGrimoire([{ item: 'rookie_grimoire', count: 2 }], byId)).toBe(true);
  });

  it('without a Grimoire there is no casting: the temporary access of G.3 is gone (G.4)', () => {
    expect(ownsGrimoire([], byId)).toBe(false);
    expect(ownsGrimoire([{ item: 'mage_staff', count: 1 }], byId)).toBe(false);
  });

  it('Neutral is unlocked for everyone; another element only when the character unlocked it', () => {
    expect(elementUnlocked(spells, NONE, 'neutral')).toBe(true);
    expect(elementUnlocked(spells, NONE, 'dark')).toBe(false);
    expect(elementUnlocked(spells, ['dark'], 'dark')).toBe(true);
    expect(elementUnlocked(spells, ['dark'], 'fire')).toBe(false);
    expect(elementUnlocked(spells, ['nothing'], 'nothing')).toBe(false);
  });

  it('knows exactly the incantations of an always-unlocked element: Push, and nothing by level', () => {
    const known = knownIncantations(spells, NONE, NONE, []);
    expect(known).toEqual(['push']);
    // A new incantation of a locked element is not known by itself.
    const more: SpellsFile = {
      ...spells,
      incantations: [
        ...spells.incantations,
        {
          ...spells.incantations[0],
          id: 'ember_push',
          element: 'fire',
        } as SpellsFile['incantations'][number],
      ],
    };
    const out: string[] = ['stale'];
    expect(knownIncantations(more, NONE, NONE, out)).toEqual(['push']);
    expect(out).toEqual(['push']);
    // Unlocking the element alone teaches nothing; learning it without the element casts nothing.
    expect(knownIncantations(more, ['fire'], NONE, out)).toEqual(['push']);
    expect(knownIncantations(more, NONE, ['ember_push'], out)).toEqual(['push']);
    // Both together: known. Push needs no entry of its own, and an unknown id is ignored.
    expect(knownIncantations(more, ['fire'], ['ember_push', 'nothing'], out)).toEqual([
      'push',
      'ember_push',
    ]);
  });
});
