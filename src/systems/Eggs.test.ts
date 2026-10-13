import { describe, expect, it } from 'vitest';
import {
  itemsFileSchema,
  monstersFileSchema,
  npcsFileSchema,
  statsFileSchema,
  triggersFileSchema,
  zonesFileSchema,
} from '../data/schemas';
import type { ItemDef } from '../data/types';
import { colorTokens } from '../render/palette';
import { readPublicJson } from '../test/loadPublic';
import { pointInShape } from '../world/Shapes';
import { buildWorldGenConfig } from '../world/terrainConfig';
import { TerrainField } from '../world/TerrainField';
import { eggCount, eggOffer, eggReward, eggsInBag, handInEggs, isEgg } from './Eggs';
import type { ItemStack } from './Inventory';
import { pointBudget, spentPoints, unspentPoints } from './Stats';

const items = itemsFileSchema.parse(readPublicJson('data/items.json'));
const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json'));
const npcs = npcsFileSchema.parse(readPublicJson('data/npcs.json'));
const stats = statsFileSchema.parse(readPublicJson('data/stats.json'));
const triggers = triggersFileSchema.parse(readPublicJson('data/triggers.json'));
const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const byId = new Map<string, ItemDef>(items.items.map((item) => [item.id, item]));
const eggItems = items.items.filter((item) => item.type === 'egg');
const sultan = npcs.npcs.find((npc) => npc.eggReset);
const defeatedSultan = {
  level: 5,
  completedQuests: new Set(['defeat_sultan']),
  path: 'sword' as const,
};
const beforeSultan = { level: 3, completedQuests: new Set<string>(), path: null };

function monsterOf(id: string) {
  const def = monsters.monsters.find((monster) => monster.id === id);
  if (!def) throw new Error(`no monster "${id}"`);
  return def;
}

describe('eggs in the bag', () => {
  it('knows an egg from everything else', () => {
    expect(isEgg(byId.get('sultan_egg'))).toBe(true);
    expect(isEgg(byId.get('health_potion'))).toBe(false);
    expect(isEgg(byId.get('old_sword'))).toBe(false);
    expect(isEgg(undefined)).toBe(false);
  });

  it('counts only the eggs, in the order they are carried', () => {
    const bag: ItemStack[] = [
      { item: 'health_potion', count: 3 },
      { item: 'mossback_egg', count: 1 },
      { item: 'slime_gel', count: 2 },
      { item: 'sultan_egg', count: 1 },
    ];
    expect(eggsInBag(bag, byId)).toEqual(['mossback_egg', 'sultan_egg']);
    expect(eggCount(bag, byId)).toBe(2);
    expect(eggCount([{ item: 'slime_gel', count: 9 }], byId)).toBe(0);
  });
});

describe('an egg drops once in the whole game', () => {
  it('gives a mini-boss egg the first time and never again', () => {
    const mossback = monsterOf('mossback');
    expect(eggReward(mossback, [])).toBe('mossback_egg');
    // The mini-boss comes back after its respawn time, but its egg does not.
    expect(eggReward(mossback, ['mossback_egg'])).toBe(null);
    expect(eggReward(mossback, ['sultan_egg'])).toBe('mossback_egg');
  });

  it('gives nothing for an ordinary monster', () => {
    expect(eggReward(monsterOf('green_slime'), [])).toBe(null);
    expect(eggReward(monsterOf('goblin_chief'), [])).toBe(null);
  });

  it('gives Sultan his own egg from the boss fight', () => {
    expect(eggReward(monsterOf('sultan'), [])).toBe('sultan_egg');
  });
});

describe("Sultan's offer", () => {
  const withEgg: ItemStack[] = [{ item: 'sultan_egg', count: 1 }];

  it('stands once he is beaten and you carry an egg', () => {
    expect(sultan).toBeDefined();
    if (!sultan) return;
    const offer = eggOffer(sultan, triggers.conditions, defeatedSultan, withEgg, byId);
    expect(offer?.cost).toBe(1);
  });

  it('does not stand without an egg, before his fight, or for anybody else', () => {
    expect(sultan).toBeDefined();
    if (!sultan) return;
    expect(eggOffer(sultan, triggers.conditions, defeatedSultan, [], byId)).toBe(null);
    expect(eggOffer(sultan, triggers.conditions, beforeSultan, withEgg, byId)).toBe(null);
    const marco = npcs.npcs.find((npc) => npc.shop);
    expect(marco).toBeDefined();
    if (!marco) return;
    expect(eggOffer(marco, triggers.conditions, defeatedSultan, withEgg, byId)).toBe(null);
  });
});

describe('handing an egg in', () => {
  const spread = { hp: 8, strength: 6, mana: 4, luck: 2 };

  it('takes the egg and frees every point', () => {
    const bag: ItemStack[] = [
      { item: 'mossback_egg', count: 1 },
      { item: 'health_potion', count: 2 },
    ];
    const result = handInEggs(stats, bag, byId, spread, 1);
    expect(result?.paid).toEqual(['mossback_egg']);
    expect(result?.freed).toBe(20);
    expect(spentPoints(stats, result?.points ?? {})).toBe(0);
    // The egg is gone, the rest of the bag is untouched.
    expect(bag).toEqual([{ item: 'health_potion', count: 2 }]);
  });

  it('keeps the total you may spend exactly the same', () => {
    const level = 7;
    const result = handInEggs(stats, [{ item: 'sultan_egg', count: 1 }], byId, spread, 1);
    expect(result).not.toBe(null);
    if (!result) return;
    expect(unspentPoints(stats, level, result.points)).toBe(pointBudget(stats, level));
    expect(result.freed).toBe(spentPoints(stats, spread));
  });

  it('changes nothing without enough eggs', () => {
    const bag: ItemStack[] = [{ item: 'health_potion', count: 1 }];
    expect(handInEggs(stats, bag, byId, spread, 1)).toBe(null);
    expect(bag).toEqual([{ item: 'health_potion', count: 1 }]);
    const one: ItemStack[] = [{ item: 'sultan_egg', count: 1 }];
    expect(handInEggs(stats, one, byId, spread, 2)).toBe(null);
    expect(one).toEqual([{ item: 'sultan_egg', count: 1 }]);
  });
});

describe('the eggs in the data', () => {
  it('has ten findable eggs at mini-bosses plus the one from Sultan', () => {
    const carriers = monsters.monsters.filter((monster) => monster.egg);
    expect(carriers).toHaveLength(11);
    expect(carriers.filter((monster) => monster.rank === 'miniboss')).toHaveLength(10);
    expect(carriers.filter((monster) => monster.boss)).toHaveLength(1);
    expect(eggItems).toHaveLength(11);
    // Every egg belongs to exactly one monster.
    expect(new Set(carriers.map((monster) => monster.egg)).size).toBe(11);
  });

  it('weighs nothing and cannot be used', () => {
    for (const egg of eggItems) {
      expect(egg.weight).toBeUndefined();
      expect(egg.potion).toBeUndefined();
      expect(egg.weapon).toBeUndefined();
      expect(egg.slot).toBeUndefined();
      expect(egg.tradeable).toBe(false);
    }
  });

  it('puts every mini-boss on its own fixed spot, each in a different zone or corner', () => {
    const spots: { id: string; x: number; z: number }[] = [];
    for (const zone of zones.zones) {
      for (const spawn of zone.spawns ?? []) {
        const def = monsters.monsters.find((monster) => monster.id === spawn.monster);
        if (!def?.egg) continue;
        spots.push({ id: spawn.id, x: spawn.x, z: spawn.z });
      }
    }
    expect(spots).toHaveLength(10);
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i] as { x: number; z: number };
        const b = spots[j] as { x: number; z: number };
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(200);
      }
    }
  });

  it('puts every mini-boss on dry ground and outside the safe zones', () => {
    const color = (token: string): number => colorTokens.get(token) ?? 0;
    const config = buildWorldGenConfig(zones, color, 1);
    const field = new TerrainField(config.terrain);
    const water = zones.world.terrain.seaLevel - zones.world.terrain.deepWater;
    for (const zone of zones.zones) {
      for (const spawn of zone.spawns ?? []) {
        const def = monsters.monsters.find((monster) => monster.id === spawn.monster);
        if (!def?.egg) continue;
        // The spot and everything it roams over must be walkable ground.
        for (let a = 0; a < 8; a++) {
          const angle = (a / 8) * Math.PI * 2;
          const r = spawn.wanderRadius ?? 0;
          const x = spawn.x + Math.cos(angle) * r;
          const z = spawn.z + Math.sin(angle) * r;
          expect(field.heightAt(x, z)).toBeGreaterThan(water);
        }
        for (const safe of zone.safeZones ?? []) {
          expect(pointInShape(safe.shape, spawn.x, spawn.z)).toBe(false);
        }
      }
    }
  });
});
