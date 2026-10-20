import { describe, expect, it } from 'vitest';
import { Random } from '../core/Random';
import { monstersFileSchema } from '../data/schemas';
import type { MonsterDef } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { addItem, countItem, type ItemStack, removeItem, rollDrops } from './Inventory';

const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')).monsters;
const monster = (id: string): MonsterDef => monsters.find((m) => m.id === id) as MonsterDef;

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
