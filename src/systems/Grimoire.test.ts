import { describe, expect, it } from 'vitest';
import { itemsFileSchema, playerFileSchema, spellsFileSchema } from '../data/schemas';
import type { ItemDef, ItemsFile, PlayerConfig, SpellsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import {
  hasGrimoireAccess,
  knownIncantations,
  LEGACY_GRIMOIRE_ACCESS,
  ownsGrimoire,
  selectedIncantation,
} from './Grimoire';

const items = itemsFileSchema.parse(readPublicJson('data/items.json')) as ItemsFile;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
const byId = new Map<string, ItemDef>(items.items.map((item) => [item.id, item]));

describe('Grimoire access (G.3)', () => {
  it('a new character carries the Rookie Grimoire from the start kit and so owns one', () => {
    expect(ownsGrimoire(player.start.items, byId)).toBe(true);
    expect(hasGrimoireAccess(player.start.items, byId)).toBe(true);
  });

  it('owning one is enough: it is never equipped, and an empty stack does not count', () => {
    expect(player.start.equipment).not.toHaveProperty('grimoire');
    expect(ownsGrimoire([{ item: 'rookie_grimoire', count: 0 }], byId)).toBe(false);
    expect(ownsGrimoire([{ item: 'old_sword', count: 1 }], byId)).toBe(false);
    expect(ownsGrimoire([{ item: 'rookie_grimoire', count: 2 }], byId)).toBe(true);
  });

  it('until G.4 an older save without the item may cast all the same (no migration, v20)', () => {
    expect(LEGACY_GRIMOIRE_ACCESS).toBe(true);
    expect(hasGrimoireAccess([], byId)).toBe(true);
    expect(hasGrimoireAccess([{ item: 'mage_staff', count: 1 }], byId)).toBe(true);
  });

  it('knows exactly the incantations of an always-unlocked element: Push, and nothing by level', () => {
    const known = knownIncantations(spells, []);
    expect(known).toEqual(['push']);
    expect(selectedIncantation(known)).toBe('push');
    expect(selectedIncantation([])).toBeNull();
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
    expect(knownIncantations(more, out)).toEqual(['push']);
    expect(out).toEqual(['push']);
  });
});
