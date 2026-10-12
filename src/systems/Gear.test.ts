import { describe, expect, it } from 'vitest';
import type { ItemDef, ItemsFile, PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { CollisionWorld } from './Collision';
import { SpatialHash } from '../world/SpatialHash';
import {
  carriedWeight,
  dropMissingEquipment,
  emptyGearStats,
  type Equipment,
  equip,
  gearStats,
  loadTier,
  maxLoad,
  unequip,
} from './Gear';
import type { ItemStack } from './Inventory';
import { loadedMovement, movementConfig, MoverState, stepMovement } from './Movement';

const player = readPublicJson('data/player.json') as PlayerConfig;
const itemsFile = readPublicJson('data/items.json') as ItemsFile;
const items = new Map<string, ItemDef>(itemsFile.items.map((item) => [item.id, item]));
const load = player.load;
const tierAt = (kg: number, level = 1, strengthKg = 0): string =>
  loadTier(load, kg, maxLoad(load, level, strengthKg)).id;

describe('equip load (like Elden Ring)', () => {
  it('counts weapons and armor, worn or spare; resources and potions weigh nothing', () => {
    const bag: ItemStack[] = [
      { item: 'old_sword', count: 1 },
      { item: 'travel_mantle', count: 1 },
      { item: 'goblin_cleaver', count: 2 },
      { item: 'health_potion', count: 10 },
      { item: 'slime_gel', count: 50 },
    ];
    expect(carriedWeight(bag, items)).toBe(4 + 1 + 2 * 8);
  });

  it('starts light: the start gear is far below 30%', () => {
    const start = player.start.items.map((stack) => ({ ...stack }));
    expect(tierAt(carriedWeight(start, items))).toBe('light');
  });

  it('has the tiers light < 30% ≤ medium < 70% ≤ heavy ≤ 100% < overloaded', () => {
    // Level 1 carries 30 kg.
    expect(maxLoad(load, 1)).toBe(30);
    expect(tierAt(9)).toBe('light');
    expect(tierAt(9.1)).toBe('medium');
    expect(tierAt(21)).toBe('medium');
    expect(tierAt(21.1)).toBe('heavy');
    expect(tierAt(30)).toBe('heavy');
    expect(tierAt(30.1)).toBe('overloaded');
  });

  it('carries more with Strength, not with a level (fase 3.7)', () => {
    expect(maxLoad(load, 5)).toBe(maxLoad(load, 1));
    // Strength: 2 kg per point, so 5 points is 10 kg more.
    expect(maxLoad(load, 1, 10)).toBe(maxLoad(load, 1) + 10);
    expect(tierAt(30.1)).toBe('overloaded');
    expect(tierAt(30.1, 1, 10)).toBe('heavy');
  });
});

describe('wearing gear', () => {
  const bag: ItemStack[] = [
    { item: 'old_sword', count: 1 },
    { item: 'straw_hat', count: 1 },
    { item: 'iron_helm', count: 1 },
    { item: 'brass_ring', count: 2 },
    { item: 'swift_ring', count: 1 },
    { item: 'health_potion', count: 3 },
  ];

  it('puts gear in its slot and replaces what was there', () => {
    const eq: Equipment = { weapon: 'old_sword' };
    expect(equip(eq, bag, items, 'straw_hat')).toBe('equipped');
    expect(equip(eq, bag, items, 'iron_helm')).toBe('equipped');
    expect(eq.hat).toBe('iron_helm');
    expect(equip(eq, bag, items, 'health_potion')).toBe('notGear');
    expect(equip(eq, bag, items, 'goblin_cleaver')).toBe('notInBag');
  });

  it('wears two rings, the same ring twice only when you have two', () => {
    const eq: Equipment = {};
    expect(equip(eq, bag, items, 'brass_ring')).toBe('equipped');
    expect(equip(eq, bag, items, 'brass_ring')).toBe('equipped');
    expect([eq.ring1, eq.ring2]).toEqual(['brass_ring', 'brass_ring']);
    expect(equip(eq, bag, items, 'brass_ring')).toBe('alreadyWorn');
    // A third ring replaces one of them.
    expect(equip(eq, bag, items, 'swift_ring')).toBe('equipped');
    expect([eq.ring1, eq.ring2].sort()).toEqual(['brass_ring', 'swift_ring']);
    expect(equip(eq, bag, items, 'swift_ring')).toBe('alreadyWorn');
  });

  it('never leaves you without a weapon', () => {
    const eq: Equipment = { weapon: 'old_sword', hat: 'straw_hat' };
    expect(unequip(eq, 'weapon')).toBe('required');
    expect(unequip(eq, 'hat')).toBe('unequipped');
    expect(eq.hat).toBeUndefined();
    expect(unequip(eq, 'hat')).toBe('empty');
  });

  it('adds up the stats of what you wear', () => {
    const eq: Equipment = { weapon: 'old_sword', hat: 'iron_helm', ring1: 'swift_ring' };
    const stats = gearStats(eq, items, emptyGearStats());
    expect(stats.hp).toBe(25);
    expect(stats.damageReductionPercent).toBe(6);
    expect(stats.moveSpeedPercent).toBe(3);
  });

  it('takes off worn gear that left the bag', () => {
    const eq: Equipment = { weapon: 'old_sword', ring1: 'swift_ring', ring2: 'swift_ring' };
    expect(dropMissingEquipment(eq, bag)).toBe(true);
    expect([eq.ring1, eq.ring2].filter(Boolean)).toEqual(['swift_ring']);
    expect(dropMissingEquipment(eq, bag)).toBe(false);
  });
});

describe('moving with a load', () => {
  const base = movementConfig(player);
  const world = new CollisionWorld(new SpatialHash());
  const DT = 1 / 60;
  const tier = (id: string) => {
    const found = load.tiers.find((entry) => entry.id === id);
    if (!found) throw new Error(id);
    return found;
  };

  function dashDistance(id: string, dt = DT): { distance: number; stuck: number } {
    const cfg = loadedMovement(base, tier(id), 0, movementConfig(player));
    const s = new MoverState();
    s.energy = 100;
    s.sinceEnergySpent = 10;
    stepMovement(s, { x: 0, z: 1, dash: true }, cfg, dt, world);
    // Keep walking forward: while getting up after a heavy dash you cannot.
    let stuck = 0;
    for (let i = 0; i < Math.round(0.6 / dt); i++) {
      const before = s.z;
      const wasDashing = s.dashing;
      stepMovement(s, { x: 0, z: 1, dash: false }, cfg, dt, world);
      if (!wasDashing && s.z === before) stuck += dt;
    }
    return { distance: s.z, stuck };
  }

  it('light is exactly the old movement', () => {
    const cfg = loadedMovement(base, tier('light'), 0, movementConfig(player));
    expect(cfg).toEqual(base);
  });

  it('walks slower and dashes shorter the heavier you are', () => {
    const walk = (id: string) =>
      loadedMovement(base, tier(id), 0, movementConfig(player)).walkSpeed;
    expect(walk('light')).toBe(4);
    expect(walk('medium')).toBeLessThan(walk('light'));
    expect(walk('heavy')).toBeLessThan(walk('medium'));
    expect(walk('overloaded')).toBeLessThan(walk('heavy'));
    const dash = (id: string) =>
      loadedMovement(base, tier(id), 0, movementConfig(player)).dashDistance;
    expect(dash('medium')).toBeLessThan(dash('light'));
    expect(dash('heavy')).toBeLessThan(dash('medium'));
  });

  it('heavy: a short "fat roll" and you are stuck for a moment', () => {
    const light = dashDistance('light');
    const heavy = dashDistance('heavy');
    expect(light.stuck).toBe(0);
    expect(heavy.stuck).toBeCloseTo(tier('heavy').dashRecoverySeconds, 1);
    expect(heavy.distance).toBeLessThan(light.distance);
  });

  it('overloaded: no dash at all, and it costs no energy', () => {
    const cfg = loadedMovement(base, tier('overloaded'), 0, movementConfig(player));
    const s = new MoverState();
    s.energy = 100;
    stepMovement(s, { x: 0, z: 0, dash: true }, cfg, DT, world);
    expect(s.dashing).toBe(false);
    expect(s.energy).toBe(100);
  });

  it('a heavy dash plays the same at 60 and 120 Hz', () => {
    const at60 = dashDistance('heavy', 1 / 60);
    const at120 = dashDistance('heavy', 1 / 120);
    expect(at120.distance).toBeCloseTo(at60.distance, 1);
  });

  it('gear speed makes you faster, on top of the load', () => {
    const cfg = loadedMovement(base, tier('light'), 3, movementConfig(player));
    expect(cfg.walkSpeed).toBeCloseTo(4 * 1.03, 5);
  });
});
