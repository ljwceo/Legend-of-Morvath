import { describe, expect, it } from 'vitest';
import type { ItemDef } from '../data/types';
import { applyUpgrade, checkUpgrade, effectiveDamageBonus, transferUpgrade } from './Forge';
import { emptyGearStats, gearStats } from './Gear';

const sword = {
  id: 'sword',
  name: 'Sword',
  type: 'weapon',
  rarity: 'common',
  tradeable: true,
  weapon: { kind: 'sword', damageBonus: 2 },
  upgrade: {
    levels: [
      { gold: 50, materials: [{ item: 'iron_ore', count: 1 }], damageBonus: 3 },
      { gold: 100, materials: [{ item: 'iron_ore', count: 2 }], damageBonus: 3 },
    ],
  },
} as ItemDef;

const make = (gold: number, ore: number) => ({
  gold,
  inventory: [{ item: 'iron_ore', count: ore }],
  upgrades: {} as Record<string, number>,
});

describe('Forge', () => {
  it('adds the level bonuses to the weapon bonus', () => {
    expect(effectiveDamageBonus(sword, {})).toBe(2);
    expect(effectiveDamageBonus(sword, { sword: 2 })).toBe(8);
    expect(effectiveDamageBonus(sword, { sword: 9 })).toBe(8);
  });

  it('takes gold and materials and raises the level', () => {
    const c = make(60, 1);
    expect(applyUpgrade(sword, c)).toBe('upgraded');
    expect(c.gold).toBe(10);
    expect(c.inventory).toEqual([]);
    expect(c.upgrades.sword).toBe(1);
  });

  it('refuses without taking anything', () => {
    const poor = make(10, 5);
    expect(applyUpgrade(sword, poor)).toBe('notEnoughGold');
    const noOre = make(500, 0);
    noOre.inventory = [];
    expect(applyUpgrade(sword, noOre)).toBe('notEnoughMaterials');
    expect(poor.gold).toBe(10);
    expect(poor.inventory[0]?.count).toBe(5);
    expect(poor.upgrades).toEqual({});
  });

  it('stops at the last level', () => {
    expect(checkUpgrade(sword, { sword: 2 }, 999, [])).toBe('maxLevel');
    expect(checkUpgrade({ ...sword, upgrade: undefined } as ItemDef, {}, 999, [])).toBe(
      'notUpgradable',
    );
  });
});

const helm = {
  id: 'helm',
  name: 'Helm',
  type: 'armor',
  slot: 'hat',
  rarity: 'common',
  tradeable: true,
  stats: { hp: 10 },
  upgrade: {
    levels: [
      { gold: 10, materials: [], stats: { hp: 5, damageReductionPercent: 1 } },
      { gold: 20, materials: [], stats: { hp: 5 } },
    ],
  },
} as ItemDef;

describe('Forge gear and swaps', () => {
  it('adds gear upgrade stats to the worn stats', () => {
    const items = new Map([[helm.id, helm]]);
    const eq = { hat: 'helm' };
    expect(gearStats(eq, items, emptyGearStats(), {}).hp).toBe(10);
    const one = gearStats(eq, items, emptyGearStats(), { helm: 1 });
    expect([one.hp, one.damageReductionPercent]).toEqual([15, 1]);
    expect(gearStats(eq, items, emptyGearStats(), { helm: 2 }).hp).toBe(20);
  });

  it('moves the level along when a quest swaps the item', () => {
    const to = { ...sword, id: 'honed' } as ItemDef;
    const up = { sword: 2 } as Record<string, number>;
    transferUpgrade(up, 'sword', to);
    expect(up).toEqual({ honed: 2 });
    const short = { sword: 3 } as Record<string, number>;
    transferUpgrade(short, 'sword', to);
    expect(short).toEqual({ honed: 2 });
  });
});
