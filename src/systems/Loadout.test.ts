import { describe, expect, it } from 'vitest';
import { itemsFileSchema } from '../data/schemas';
import type { ItemDef, ItemsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import {
  type BusyState,
  canSwitchWeapon,
  cycle,
  cycleSpellSlot,
  preparedConsumables,
  preparedWeapons,
  selectedConsumable,
  selectedSpell,
} from './Loadout';

const file = itemsFileSchema.parse(readPublicJson('data/items.json')) as ItemsFile;
const items = new Map<string, ItemDef>(file.items.map((item) => [item.id, item]));

const bag = [
  { item: 'health_potion', count: 2 },
  { item: 'old_sword', count: 1 },
  { item: 'slime_gel', count: 4 },
  { item: 'mage_staff', count: 1 },
  { item: 'mana_potion', count: 1 },
  { item: 'old_sword', count: 1 },
];

describe('prepared lists come from the bag', () => {
  it('weapons: each once, in bag order; nothing else', () => {
    expect(preparedWeapons(bag, items)).toEqual(['old_sword', 'mage_staff']);
  });

  it('consumables: the potions you have, each once', () => {
    expect(preparedConsumables(bag, items)).toEqual(['health_potion', 'mana_potion']);
    expect(preparedConsumables([{ item: 'health_potion', count: 0 }], items)).toEqual([]);
  });
});

describe('cycling', () => {
  const list = ['a', 'b', 'c'];

  it('goes to the next and wraps around, both ways', () => {
    expect(cycle(list, 'a', 1)).toBe('b');
    expect(cycle(list, 'c', 1)).toBe('a');
    expect(cycle(list, 'a', -1)).toBe('c');
  });

  it('starts at the first entry when the current one is gone, and gives null for nothing', () => {
    expect(cycle(list, 'x', 1)).toBe('a');
    expect(cycle(list, null, 1)).toBe('a');
    expect(cycle([], 'a', 1)).toBeNull();
    expect(cycle(['a'], 'a', 1)).toBe('a');
  });
});

describe('the quick item', () => {
  const order = ['health_potion', 'greater_health_potion'];

  it('keeps your choice while you have it', () => {
    expect(selectedConsumable(['health_potion', 'mana_potion'], 'mana_potion', order)).toBe(
      'mana_potion',
    );
  });

  it('falls back to the quick order, then to anything you have', () => {
    expect(selectedConsumable(['mana_potion', 'health_potion'], null, order)).toBe('health_potion');
    expect(selectedConsumable(['mana_potion'], 'health_potion', order)).toBe('mana_potion');
    expect(selectedConsumable([], 'health_potion', order)).toBeNull();
  });
});

describe('spell slots', () => {
  it('cycle through the filled slots only', () => {
    const loadout = ['fireball', '', 'ember_burst'];
    expect(cycleSpellSlot(loadout, 0, 1)).toBe(2);
    expect(cycleSpellSlot(loadout, 2, 1)).toBe(0);
    expect(cycleSpellSlot(loadout, 0, -1)).toBe(2);
    expect(cycleSpellSlot(loadout, 2, -1)).toBe(0);
  });

  it('stay on the only spell, and give -1 without any', () => {
    expect(cycleSpellSlot(['fireball'], 0, 1)).toBe(0);
    expect(cycleSpellSlot(['', ''], 0, 1)).toBe(-1);
    expect(cycleSpellSlot([], 0, 1)).toBe(-1);
  });

  it('a slot out of range starts from the first filled one', () => {
    expect(cycleSpellSlot(['', 'fireball', 'ember_burst'], 5, 1)).toBe(1);
  });

  it('the selected slot casts; an empty or missing one falls back to the first spell', () => {
    expect(selectedSpell(['fireball', 'ember_burst'], 1)).toBe('ember_burst');
    expect(selectedSpell(['fireball', ''], 1)).toBe('fireball');
    expect(selectedSpell(['fireball'], 3)).toBe('fireball');
    expect(selectedSpell([''], 0)).toBeNull();
  });
});

describe('weapon switching waits until you are free', () => {
  const free: BusyState = {
    swinging: false,
    windingUp: false,
    rolling: false,
    casting: false,
    guarding: false,
    staggered: false,
  };

  it('happens when nothing runs', () => {
    expect(canSwitchWeapon(free)).toBe(true);
  });

  it('never during an attack, a roll, a parry, a cast or a stagger', () => {
    for (const key of Object.keys(free) as (keyof BusyState)[]) {
      expect(canSwitchWeapon({ ...free, [key]: true })).toBe(false);
    }
  });
});
