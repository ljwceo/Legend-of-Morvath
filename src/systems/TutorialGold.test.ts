import { describe, expect, it } from 'vitest';
import { Random } from '../core/Random';
import {
  monstersFileSchema,
  npcsFileSchema,
  playerFileSchema,
  questsFileSchema,
  zonesFileSchema,
} from '../data/schemas';
import type { MonstersFile, PlayerConfig, Zone } from '../data/types';
import type { Enemy } from '../entities/Enemy';
import { createNewSave } from '../save/SaveData';
import { SaveManager, type StorageLike } from '../save/SaveManager';
import { readPublicJson } from '../test/loadPublic';
import type { PointXZ } from '../world/Colliders';
import { Enemies, type EnemiesWorld } from './Enemies';
import type { EnemyTarget } from './EnemyAI';
import { canPickUpMarker, markerAfterDeath } from './GoldMarker';
import { addItem, GOLD_ITEM, type ItemStack, rollDrops } from './Inventory';
import type { Mover } from './Movement';
import { deathGoldLoss } from './Progression';
import { QuestBook } from './Quests';

/**
 * GG.7.1: the gold soft-lock before Sultan. Marco's "Just For You" needs 2 Health Potions
 * (20 Gold) and Ansel's 20 Gold used to be the only gold in Greyhaven, so a Straw Hat bought
 * first, or two deaths, locked the tutorial for good. A Green Slime now always drops 2 Gold, and
 * the slime yard in the city comes back, so the gold can always be earned again by fighting.
 */

const DT = 1 / 60;
const RANGES = { showRadius: 160, hideMargin: 20 };
const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile;
const npcs = npcsFileSchema.parse(readPublicJson('data/npcs.json'));
const quests = questsFileSchema.parse(readPublicJson('data/quests.json'));
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;

const greyhaven = zones.zones.find((zone) => zone.id === 'greyhaven') as Zone;

function findYard() {
  const area = greyhaven.spawnAreas?.find((entry) => entry.id === 'greyhaven_slime_yard');
  if (!area) throw new Error('missing greyhaven_slime_yard');
  return area;
}
const yard = findYard();

const marco = npcs.npcs.find((npc) => npc.id === 'marco');
const priceOf = (item: string): number => {
  const entry = marco?.shop?.items.find((e) => e.item === item);
  if (!entry) throw new Error(`Marco does not sell ${item}`);
  return entry.price;
};

function findBuyObjective() {
  const objective = quests.quests.find((q) => q.id === 'just_for_you')?.objectives[0];
  if (objective?.type !== 'buy') throw new Error('Just For You is no longer a buy quest');
  return objective;
}
const buy = findBuyObjective();
/** The gold Marco's quest needs: 2 × Health Potion. */
const MARCO_NEEDS = buy.count * priceOf(buy.item);

const free: Mover = {
  moveCircle(p: PointXZ, _radius: number, dx: number, dz: number) {
    p.x += dx;
    p.z += dz;
  },
};

/** Greyhaven's monsters on flat ground, a player who can walk anywhere, and a purse. */
class City {
  readonly enemies = new Enemies([greyhaven], monsters, RANGES);
  readonly target: EnemyTarget = { x: yard.x, z: yard.z, radius: 0.4, hostile: false };
  readonly world: EnemiesWorld = {
    mover: free,
    heightAt: () => 0,
    hitPlayer: () => {},
    shoot: () => {},
    alert: (e) => this.enemies.alert(e),
    bossEvent: () => {},
  };
  readonly rng = new Random(71);
  readonly bag: ItemStack[] = [];
  private readonly drops: ItemStack[] = [];
  gold = 0;
  kills = 0;

  /** The yard's Green Slimes that stand in the world now. */
  slimes(): Enemy[] {
    return this.enemies.list.filter(
      (e) => e.def.id === 'green_slime' && e.active && e.alive && e.id.startsWith(yard.id),
    );
  }

  /**
   * One swing, and the rewards exactly as WorldState.landHit -> rewardDefeat hands them out:
   * only when `Enemies.hit` reports the killing blow, the rolled drops go to the purse/bag.
   */
  swing(e: Enemy, damage: number): boolean {
    const defeated = this.enemies.hit(e, damage);
    if (!defeated) return false;
    this.kills++;
    for (const drop of rollDrops(e.def, this.rng, this.drops)) {
      if (drop.item === GOLD_ITEM) this.gold += drop.count;
      else addItem(this.bag, drop.item, drop.count);
    }
    return true;
  }

  /** Defeats one standing yard slime (several swings, like a fight). False when none stands. */
  killOne(): boolean {
    const [e] = this.slimes();
    if (!e) return false;
    while (!this.swing(e, 9));
    return true;
  }

  /** Defeats every yard slime standing. */
  clearYard(): number {
    let n = 0;
    while (this.killOne()) n++;
    return n;
  }

  run(seconds: number): void {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) this.enemies.step(DT, this.target, this.world);
  }

  /**
   * What a player does to bring the yard back: the fallen slimes fade (a corpse only fades
   * while you are near), then you walk `meters` away (e.g. towards Marco), wait `seconds`
   * there and come back.
   */
  awayAndBack(meters: number, seconds: number): void {
    this.run(monsters.settings.corpseSeconds + 0.5);
    this.target.x = yard.x - meters;
    this.run(seconds);
    this.target.x = yard.x;
    this.run(DT);
  }
}

/** The shortest wait away from the yard that brings it back. */
const RESPAWN_WAIT = yard.respawnSeconds + 1;
/** Far enough away: the yard's radius plus `respawnMinPlayerDistance`, and a little more. */
const AWAY = yard.radius + monsters.settings.respawnMinPlayerDistance + 5;

describe('GG.7.1 tutorial gold: the Green Slime', () => {
  it('always drops exactly 2 Gold, and its Slime Gel stays at about half the time', () => {
    const def = monsters.monsters.find((m) => m.id === 'green_slime');
    if (!def) throw new Error('missing green_slime');
    const rng = new Random(5);
    const out: ItemStack[] = [];
    let gel = 0;
    const tries = 2000;
    for (let i = 0; i < tries; i++) {
      const drops = rollDrops(def, rng, out);
      expect(drops.filter((d) => d.item === GOLD_ITEM)).toEqual([{ item: GOLD_ITEM, count: 2 }]);
      if (drops.some((d) => d.item === 'slime_gel')) gel++;
    }
    expect(gel / tries).toBeGreaterThan(0.45);
    expect(gel / tries).toBeLessThan(0.55);
  });

  it('pays once per kill: hitting a fallen slime again gives nothing', () => {
    const city = new City();
    const [slime] = city.slimes();
    if (!slime) throw new Error('no slime in the yard');
    let kills = 0;
    for (let i = 0; i < 20; i++) if (city.swing(slime, 9)) kills++;
    expect(kills).toBe(1);
    expect(city.gold).toBe(2);
    // Lying down, and after it is gone: still nothing.
    city.run(3);
    for (let i = 0; i < 5; i++) city.swing(slime, 50);
    expect(city.gold).toBe(2);
  });
});

describe('GG.7.1 tutorial gold: the slime yard pays for Marco', () => {
  it('Marco still wants 2 Health Potions at 10 Gold (20 Gold)', () => {
    expect(buy.item).toBe('health_potion');
    expect(buy.count).toBe(2);
    expect(buy.npc).toBe('marco');
    expect(MARCO_NEEDS).toBe(20);
  });

  it('a player with 0 Gold earns the 20 Gold in the city: 10 kills, 4 visits to the yard', () => {
    const city = new City();
    let visits = 1;
    while (city.gold < MARCO_NEEDS && visits <= 10) {
      if (city.killOne()) continue;
      // The yard comes back once you were out of sight and its time has passed.
      city.awayAndBack(AWAY, RESPAWN_WAIT);
      visits++;
    }
    expect(city.gold).toBe(MARCO_NEEDS);
    expect(city.kills).toBe(10);
    expect(visits).toBe(Math.ceil(10 / yard.count));
  });

  it('the Straw Hat mistake (15 Gold, sold back for half) is fixed with 4 kills', () => {
    const hat = priceOf('straw_hat');
    const potion = priceOf('health_potion');
    const sellBack = Math.floor(hat * (marco?.shop?.sellRatio ?? 0.5));
    // Ansel's 20, the hat, the hat sold back, one potion: what is left (the run seen in GG.7).
    const left = 20 - hat + sellBack - potion;
    expect(left).toBe(2);
    const city = new City();
    city.gold = left;
    while (city.gold < potion) if (!city.killOne()) city.awayAndBack(AWAY, RESPAWN_WAIT);
    expect(city.kills).toBe(4);
  });

  it('the yard does not refill while you wait in it or just next to it (no standing farm)', () => {
    const waiting = new City();
    waiting.clearYard();
    waiting.run(300);
    expect(waiting.slimes()).toHaveLength(0);
    // A few steps out of the yard are not enough either.
    waiting.awayAndBack(30, 300);
    expect(waiting.slimes()).toHaveLength(0);
    // Out of sight but not long enough after the fight: still empty; long enough: all back.
    const leaving = new City();
    leaving.clearYard();
    leaving.awayAndBack(AWAY, yard.respawnSeconds - 5);
    expect(leaving.slimes()).toHaveLength(0);
    leaving.awayAndBack(AWAY, 6);
    expect(leaving.slimes()).toHaveLength(yard.count);
  });
});

describe('GG.7.1 tutorial gold: it stays available', () => {
  it("is not tied to Hilda's quest: the yard has no condition and refills after it", () => {
    expect(Object.keys(yard).sort()).toEqual(
      ['count', 'id', 'monster', 'radius', 'respawnSeconds', 'x', 'z'].sort(),
    );
    const save = createNewSave('en').quests;
    const book = new QuestBook(quests.quests, save);
    const bag: ItemStack[] = [{ item: 'slime_gel', count: 3 }];
    expect(book.accept('steel_and_slime')).toBe(true);
    expect(book.complete('steel_and_slime', bag)).toBe(true);
    // Rebuilt after the quest (a reload) and after another clear: the slimes are there.
    const city = new City();
    expect(city.slimes()).toHaveLength(yard.count);
    city.clearYard();
    city.awayAndBack(AWAY, RESPAWN_WAIT);
    expect(city.slimes()).toHaveLength(yard.count);
  });

  it('after two deaths that lose all your gold, the yard earns it back', () => {
    const fraction = player.death.goldLossFraction;
    let gold = 20;
    // First death: everything onto a marker. Second death before picking it up: the marker
    // is replaced by an empty one, the 20 Gold are gone for good (unchanged rules).
    const lost1 = deathGoldLoss(gold, fraction);
    gold -= lost1;
    let marker = markerAfterDeath(0, 0, 0, null, lost1);
    expect(marker?.amount).toBe(20);
    const lost2 = deathGoldLoss(gold, fraction);
    gold -= lost2;
    marker = markerAfterDeath(5, 0, 5, null, lost2);
    expect(gold).toBe(0);
    expect(marker).toBeNull();
    // Waking up puts every monster back (Enemies.resetAll), the yard included.
    const city = new City();
    city.clearYard();
    city.enemies.resetAll();
    expect(city.slimes()).toHaveLength(yard.count);
    city.gold = gold;
    while (city.gold < MARCO_NEEDS) if (!city.killOne()) city.awayAndBack(AWAY, RESPAWN_WAIT);
    expect(city.gold).toBeGreaterThanOrEqual(MARCO_NEEDS);
  });

  it('a marker still gives back exactly what it holds', () => {
    const marker = markerAfterDeath(1, 0, 1, null, 6);
    expect(marker).not.toBeNull();
    if (!marker) return;
    expect(canPickUpMarker(marker, 1.5, 1, null, player.death.markerPickupRadius)).toBe(true);
    expect(marker.amount).toBe(6);
  });
});

describe('GG.7.1 tutorial gold: no extra gold from nothing', () => {
  class MemoryStorage implements StorageLike {
    readonly items = new Map<string, string>();
    getItem(key: string): string | null {
      return this.items.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
      this.items.set(key, value);
    }
    removeItem(key: string): void {
      this.items.delete(key);
    }
  }

  it('saving and loading keeps the gold, and a reload pays nothing without a kill', () => {
    const city = new City();
    city.clearYard();
    expect(city.gold).toBe(6);
    const save = createNewSave('en');
    save.character = {
      name: 'GG71',
      appearance: {
        bodyType: 'female',
        hairstyle: 'female_braid',
        hairColor: 'red_dark',
        skinTone: 'tone_3',
        mantleColor: 'navy',
      },
      gold: city.gold,
      inventory: [{ item: 'old_sword', count: 1 }],
      equipment: { weapon: 'old_sword' },
      pack: [],
      stats: {},
      spells: [],
      spellLoadout: [],
      crystal: null,
      upgrades: {},
      elements: [],
      incantations: [],
    };
    const manager = new SaveManager(new MemoryStorage());
    expect(manager.write(save)).toBe(true);
    const loaded = manager.load();
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.save.character?.gold).toBe(6);
    // The world is built again on load: the yard is back, but gold only comes from a kill.
    const reloaded = new City();
    reloaded.gold = loaded.save.character?.gold ?? 0;
    reloaded.run(10);
    expect(reloaded.gold).toBe(6);
    const [slime] = reloaded.slimes();
    if (!slime) throw new Error('no slime after reload');
    while (slime.alive) reloaded.swing(slime, 9);
    expect(reloaded.gold).toBe(8);
  });

  it('training dummies and other things you can hit forever give no gold', () => {
    for (const m of monsters.monsters) {
      if (m.behavior !== 'static') continue;
      expect(
        m.drops.some((d) => d.item === GOLD_ITEM),
        m.id,
      ).toBe(false);
      expect(m.xp, m.id).toBe(0);
    }
  });
});

describe('GG.7.1 tutorial gold: nothing else changed', () => {
  it('only the Green Slime was added to the monsters that drop gold', () => {
    const withGold = monsters.monsters
      .filter((m) => m.drops.some((d) => d.item === GOLD_ITEM))
      .map((m) => m.id)
      .sort();
    expect(withGold).toEqual(
      [
        'blightborn',
        'bogmaw',
        'dunmar_sentinel',
        'fenstalker',
        'goblin',
        'goblin_archer',
        'goblin_chief',
        'green_slime',
        'hollow_whisperer',
        'hoarfrost_warden',
        'mossback',
        'rootgnarl',
        'stonejaw',
        'windlash',
      ].sort(),
    );
    // The other slimes (big, elemental, dark) keep their old drops.
    for (const m of monsters.monsters) {
      if (m.id === 'green_slime' || !m.id.includes('slime')) continue;
      expect(
        m.drops.some((d) => d.item === GOLD_ITEM),
        m.id,
      ).toBe(false);
    }
  });

  it("Marco's prices, the death penalty and Sultan's requirements are unchanged", () => {
    expect(Object.fromEntries(marco?.shop?.items.map((e) => [e.item, e.price]) ?? [])).toEqual({
      health_potion: 10,
      greater_health_potion: 40,
      mana_potion: 12,
      greater_mana_potion: 45,
      straw_hat: 15,
      brass_ring: 25,
      copper_amulet: 30,
      padded_mantle: 60,
      adept_staff: 250,
    });
    expect(player.death.goldLossFraction).toBe(1);
    expect(quests.quests.find((q) => q.id === 'defeat_sultan')?.requires).toEqual({
      level: 3,
      quests: [
        'a_quiet_awakening',
        'just_for_you',
        'steel_and_slime',
        'a_patch_of_earth',
        'tales_by_the_fire',
      ],
    });
  });

  it('the first day still ends at level 3, so Defeat Sultan still starts by itself', () => {
    const firstDay = [
      'a_quiet_awakening',
      'just_for_you',
      'steel_and_slime',
      'a_patch_of_earth',
      'tales_by_the_fire',
    ];
    const questXp = firstDay.reduce(
      (sum, id) => sum + (quests.quests.find((q) => q.id === id)?.rewards.xp ?? 0),
      0,
    );
    const slimeXp = monsters.monsters.find((m) => m.id === 'green_slime')?.xp ?? 0;
    const toLevel3 = (player.xpToNextLevel[0] ?? 0) + (player.xpToNextLevel[1] ?? 0);
    // Three Slime Gel take at least three kills.
    expect(questXp + 3 * slimeXp).toBeGreaterThanOrEqual(toLevel3);
    const save = createNewSave('en').quests;
    save.completed.push(...firstDay);
    const book = new QuestBook(quests.quests, save);
    expect(book.status('defeat_sultan', 3, [])).toBe('available');
    expect(book.status('defeat_sultan', 2, [])).toBe('locked');
  });
});
