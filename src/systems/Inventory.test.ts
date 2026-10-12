import { describe, expect, it } from 'vitest';
import { Random } from '../core/Random';
import { itemsFileSchema, monstersFileSchema, playerFileSchema } from '../data/schemas';
import type { ItemDef, MonsterDef, PlayerConfig, PotionDef } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { applyLevel, CombatState } from './Combat';
import {
  addItem,
  countItem,
  drinkPotion,
  type ItemStack,
  potionHp,
  potionMana,
  removeItem,
  rollDrops,
} from './Inventory';

const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const items = new Map(
  itemsFileSchema.parse(readPublicJson('data/items.json')).items.map((item) => [item.id, item]),
) as ReadonlyMap<string, ItemDef>;
const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')).monsters;
const monster = (id: string): MonsterDef => monsters.find((m) => m.id === id) as MonsterDef;
const order = player.potions.quickOrder;

function hurt(hp: number): CombatState {
  const c = new CombatState();
  applyLevel(c, player, 1);
  c.hp = hp;
  c.mana = c.maxMana;
  return c;
}

describe('bag', () => {
  it('stacks, counts and removes items', () => {
    const bag: ItemStack[] = [];
    addItem(bag, 'slime_gel', 2);
    addItem(bag, 'slime_gel', 1);
    addItem(bag, 'wood', 4);
    expect(bag).toEqual([
      { item: 'slime_gel', count: 3 },
      { item: 'wood', count: 4 },
    ]);
    expect(countItem(bag, 'slime_gel')).toBe(3);
    expect(countItem(bag, 'honey')).toBe(0);
    expect(removeItem(bag, 'slime_gel', 5)).toBe(false);
    expect(countItem(bag, 'slime_gel')).toBe(3);
    expect(removeItem(bag, 'slime_gel', 3)).toBe(true);
    expect(bag).toEqual([{ item: 'wood', count: 4 }]);
  });
});

describe('loot', () => {
  it('goblins always drop 2–5 gold (concept)', () => {
    const rng = new Random(7);
    const out: ItemStack[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const gold = rollDrops(monster('goblin'), rng, out).find((d) => d.item === 'gold');
      expect(gold).toBeDefined();
      expect(gold?.count).toBeGreaterThanOrEqual(2);
      expect(gold?.count).toBeLessThanOrEqual(5);
      seen.add(gold?.count ?? 0);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('a Green Slime drops Slime Gel about half the time', () => {
    const rng = new Random(11);
    const out: ItemStack[] = [];
    let gel = 0;
    const tries = 2000;
    for (let i = 0; i < tries; i++) {
      if (rollDrops(monster('green_slime'), rng, out).some((d) => d.item === 'slime_gel')) gel++;
    }
    expect(gel / tries).toBeGreaterThan(0.45);
    expect(gel / tries).toBeLessThan(0.55);
  });

  it('is the same for the same seed (a raid host can roll it)', () => {
    const a = rollDrops(monster('goblin_chief'), new Random(3), []);
    const b = rollDrops(monster('goblin_chief'), new Random(3), []);
    expect(a).toEqual(b);
    expect(a.some((d) => d.item === 'health_potion')).toBe(true);
  });

  it('training dummies drop nothing', () => {
    expect(rollDrops(monster('training_dummy'), new Random(1), [])).toEqual([]);
  });
});

describe('potions', () => {
  const healed = { item: '', hp: 0, mana: 0 };

  it('heals and takes one potion from the bag, never above the maximum', () => {
    const bag: ItemStack[] = [{ item: 'health_potion', count: 2 }];
    const c = hurt(30);
    expect(drinkPotion(bag, order, items, c, 0, healed)).toBe('drunk');
    expect(c.hp).toBe(80);
    expect(healed).toEqual({ item: 'health_potion', hp: 50, mana: 0 });
    expect(countItem(bag, 'health_potion')).toBe(1);
    expect(drinkPotion(bag, order, items, c, 0, healed)).toBe('drunk');
    expect(c.hp).toBe(100);
    expect(healed.hp).toBe(20);
    expect(bag).toEqual([]);
  });

  it('says why it cannot: no potion, already full, too soon', () => {
    expect(drinkPotion([], order, items, hurt(30), 0, healed)).toBe('none');
    const bag: ItemStack[] = [{ item: 'health_potion', count: 1 }];
    expect(drinkPotion(bag, order, items, hurt(100), 0, healed)).toBe('full');
    expect(drinkPotion(bag, order, items, hurt(30), 0.5, healed)).toBe('cooldown');
    expect(countItem(bag, 'health_potion')).toBe(1);
  });

  it('the drink key takes the first potion of quickOrder you have', () => {
    const bag: ItemStack[] = [{ item: 'greater_health_potion', count: 1 }];
    const c = hurt(10);
    expect(drinkPotion(bag, order, items, c, 0, healed)).toBe('drunk');
    expect(healed.item).toBe('greater_health_potion');
    expect(c.hp).toBe(100);
  });

  it('restores a share of your maximum, so it grows with your level', () => {
    const low = new CombatState();
    applyLevel(low, player, 1);
    low.hp = 1;
    expect(potionHp(items.get('health_potion')?.potion as PotionDef, low.maxHp)).toBe(50);

    const high = new CombatState();
    applyLevel(high, player, 10);
    expect(high.maxHp).toBe(190);
    expect(potionHp(items.get('health_potion')?.potion as PotionDef, high.maxHp)).toBe(95);
    expect(potionMana(items.get('mana_potion')?.potion as PotionDef, high.maxMana)).toBeCloseTo(
      high.maxMana * 0.3,
      6,
    );
  });

  it('a mana potion refills mana, also when your HP is full', () => {
    const bag: ItemStack[] = [{ item: 'mana_potion', count: 1 }];
    const c = hurt(100);
    c.mana = 0;
    expect(drinkPotion(bag, ['mana_potion'], items, c, 0, healed)).toBe('drunk');
    expect(c.mana).toBeCloseTo(c.maxMana * 0.3, 6);
    expect(healed.hp).toBe(0);
    expect(bag).toEqual([]);
  });

  it('never drinks something that is not a potion', () => {
    const bag: ItemStack[] = [{ item: 'slime_gel', count: 3 }];
    expect(drinkPotion(bag, ['slime_gel'], items, hurt(10), 0, healed)).toBe('none');
    expect(countItem(bag, 'slime_gel')).toBe(3);
  });
});
