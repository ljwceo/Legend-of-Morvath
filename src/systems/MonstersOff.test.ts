import { describe, expect, it } from 'vitest';
import { Random } from '../core/Random';
import { monstersFileSchema, questsFileSchema, zonesFileSchema } from '../data/schemas';
import type { MonstersFile, WaveFightDef, Zone } from '../data/types';
import type { Enemy } from '../entities/Enemy';
import { createNewSave } from '../save/SaveData';
import { readPublicJson } from '../test/loadPublic';
import type { PointXZ } from '../world/Colliders';
import { emptyBox, shapeBounds } from '../world/Shapes';
import { Cheats } from './Cheats';
import { Enemies, type EnemiesWorld } from './Enemies';
import { applyMonsterStance, canHurt, type EnemyTarget } from './EnemyAI';
import { GOLD_ITEM, type ItemStack, rollDrops } from './Inventory';
import { WaveFight, type WaveFightWorld } from './WaveFight';

// GG.8.5 step 2: "Monsters attack: Off" (cheat menu) made the slimes of Sir Garrick's drill
// practically unkillable. The cheat used to say "the player is gone", so a monster that was hit
// went home, and a drill slime is already home (its spot on the field): it was whole again within
// a frame. Now the cheat only makes monsters peaceful (no noticing, attacking or hurting you),
// they still take damage and die, and only going down (the game's own rule) sends them home.
// Real monsters.json, quests.json and zones.json; the real Enemies pool and WaveFight.

const DT = 1 / 60;
const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile;
const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const quests = questsFileSchema.parse(readPublicJson('data/quests.json'));
const FIELD = 'academy_training_field';
const drillDef = quests.waveFights.find((f) => f.id === 'garrick_field_drill') as WaveFightDef;
const greyhaven = zones.zones.find((z) => z.id === 'greyhaven') as Zone;
const fieldShape = greyhaven.areas.find((a) => a.id === FIELD)?.shape;
if (!drillDef || !fieldShape) throw new Error('missing drill or field');
const box = shapeBounds(fieldShape, emptyBox());
const CX = (box.minX + box.maxX) / 2;
const CZ = (box.minZ + box.maxZ) / 2;
const free = {
  moveCircle(p: PointXZ, _r: number, dx: number, dz: number) {
    p.x += dx;
    p.z += dz;
  },
};
const xpOf = new Map(monsters.monsters.map((m) => [m.id, m.xp]));

/** Sir Garrick's drill on the field, with the real pool, and what happened to the player. */
class Drill {
  readonly enemies = new Enemies(
    [{ ...greyhaven, spawns: [], spawnAreas: [], nightSpawns: [] }],
    monsters,
    { showRadius: 160, hideMargin: 20 },
    new Map([[FIELD, fieldShape as never]]),
    null,
    0,
    [drillDef],
  );
  readonly target: EnemyTarget = { x: CX, z: CZ, radius: 0.4, hostile: true };
  readonly cleared: number[] = [];
  finished = 0;
  playerHits = 0;
  /** Killing blows, per monster slot: a reward is paid for each (WorldState.defeated). */
  readonly kills = new Map<Enemy, number>();
  readonly fight: WaveFight;
  private readonly world: EnemiesWorld = {
    mover: free,
    heightAt: () => 0,
    hitPlayer: () => {
      this.playerHits++;
    },
    shoot: () => {},
    alert: (e) => this.enemies.alert(e),
    bossEvent: () => {},
  };

  constructor() {
    const fightWorld: WaveFightWorld = {
      alive: () => this.enemies.waveAlive(drillDef.id),
      spawnWave: (i) => void this.enemies.spawnWave(drillDef.id, i, CX, CZ, drillDef.spawnRadius),
      clear: () => this.enemies.clearWave(drillDef.id),
      inArea: () => true,
      say: () => {},
      waveCleared: (i) => this.cleared.push(i),
      finished: () => this.finished++,
      reset: () => {},
    };
    this.fight = new WaveFight(drillDef, fightWorld);
    this.stance(true);
    this.enemies.step(DT, this.target, this.world);
  }

  /** What WorldState sets every step from the cheat menu and the player's state. */
  stance(monstersOn: boolean, flying = false, down = false): void {
    applyMonsterStance(this.target, monstersOn, flying, down);
  }

  /** Starts the drill at wave 3 (two waves already beaten) and lets the slimes arrive. */
  startWave3(): void {
    this.fight.start(2);
    this.run(drillDef.pauseSeconds + 0.1);
  }

  run(seconds: number): void {
    for (let t = 0; t < seconds; t += DT) {
      this.fight.step(DT);
      this.enemies.step(DT, this.target, this.world);
    }
  }

  /** The drill's monsters on the field now (alive), optionally of one kind. */
  field(kind?: string): Enemy[] {
    return this.enemies.list.filter(
      (e) => e.alive && e.id.startsWith(drillDef.id) && (!kind || e.def.id === kind),
    );
  }

  /** One hit, as the world lands it; counts the killing blow. */
  hit(e: Enemy, damage: number): boolean {
    const killed = this.enemies.hit(e, damage, 6);
    if (killed) this.kills.set(e, (this.kills.get(e) ?? 0) + 1);
    return killed;
  }

  /**
   * Hits `e` every `every` s with `damage` (a sword fighter's pace) until it falls or `seconds`
   * pass, stepping the world in between; returns its HP after every hit and the highest HP seen
   * between two hits.
   */
  fightOne(e: Enemy, damage: number, every = 0.34, seconds = 30) {
    const afterHit: number[] = [];
    let highestBetween = 0;
    let next = 0;
    for (let t = 0; t < seconds && e.alive; t += DT) {
      if (t >= next) {
        this.hit(e, damage);
        afterHit.push(e.hp);
        next += every;
      } else {
        highestBetween = Math.max(highestBetween, e.hp - (afterHit.at(-1) ?? e.hp));
      }
      this.fight.step(DT);
      this.enemies.step(DT, this.target, this.world);
    }
    return { afterHit, healedBetweenHits: highestBetween, dead: !e.alive };
  }

  /** Beats everything on the field (splits included) at a sword fighter's pace. */
  clearField(seconds = 120): void {
    for (let t = 0; t < seconds && this.fight.state !== 'won'; t += 0.34) {
      const next = this.field()[0];
      if (next) this.hit(next, 10);
      this.run(0.34);
    }
  }
}

describe('Monsters attack: Off (GG.8.5 step 2)', () => {
  it('a Big Slime of the drill loses HP with every hit and never heals in between', () => {
    const d = new Drill();
    d.stance(false);
    d.startWave3();
    const big = d.field('big_slime');
    expect(big.length).toBe(3);
    const slime = big[0] as Enemy;
    const r = d.fightOne(slime, 10);
    expect(r.healedBetweenHits).toBe(0);
    for (let i = 1; i < r.afterHit.length; i++) {
      expect(r.afterHit[i] as number).toBeLessThan(r.afterHit[i - 1] as number);
    }
    expect(r.afterHit).toEqual([70, 60, 50, 40, 30, 20, 10, 0]);
    expect(r.dead).toBe(true);
  });

  it('it dies, splits into exactly two Green Slimes, and those can be killed too', () => {
    const d = new Drill();
    d.stance(false);
    d.startWave3();
    const greensBefore = d.field('green_slime').length;
    const slime = d.field('big_slime')[0] as Enemy;
    d.fightOne(slime, 10);
    const greens = d.field('green_slime');
    expect(greens.length).toBe(greensBefore + 2);
    const children = greens.filter((g) => Math.hypot(g.x - slime.x, g.z - slime.z) < 3);
    expect(children.length).toBe(2);
    for (const g of children) {
      expect(g.hp).toBe(30);
      expect(d.fightOne(g, 10).dead).toBe(true);
    }
  });

  it('the drill counts the wave: everything down, wave 3 cleared once, the exam finished once', () => {
    const d = new Drill();
    d.stance(false);
    d.startWave3();
    d.clearField();
    expect(d.fight.state).toBe('won');
    expect(d.cleared).toEqual([2]);
    expect(d.finished).toBe(1);
    expect(d.enemies.waveAlive(drillDef.id)).toBe(0);
  });

  it('XP, gold and loot are paid once per monster: one killing blow each, never more', () => {
    const d = new Drill();
    d.stance(false);
    d.startWave3();
    d.clearField();
    // 3 Big Slimes, their 6 halves and the 2 Green Slimes of the wave.
    expect(d.kills.size).toBe(11);
    for (const count of d.kills.values()) expect(count).toBe(1);
    // Hitting the fallen again pays nothing.
    for (const e of d.kills.keys()) expect(d.hit(e, 100)).toBe(false);
    expect([...d.kills.values()].every((n) => n === 1)).toBe(true);
    const xp = [...d.kills.keys()].reduce((sum, e) => sum + (xpOf.get(e.def.id) ?? 0), 0);
    expect(xp).toBe(3 * 30 + 8 * 10);
    // Each killing blow rolls the monster's drops once (WorldState.rewardDefeat): 2 Gold per Green.
    const random = new Random(7);
    const out: ItemStack[] = [];
    let gold = 0;
    for (const e of d.kills.keys()) {
      for (const drop of rollDrops(e.def, random, out)) {
        if (drop.item === GOLD_ITEM) gold += drop.count;
      }
    }
    expect(gold).toBe(8 * 2);
  });

  it('nobody hurts you while monsters are off, and they do with monsters on', () => {
    const off = new Drill();
    off.stance(false);
    off.startWave3();
    off.run(20);
    expect(off.playerHits).toBe(0);
    const on = new Drill();
    on.startWave3();
    on.run(20);
    expect(on.playerHits).toBeGreaterThan(0);
  });

  it('On → Off → On in the middle of a fight: they stop on the spot unhealed, then fight again', () => {
    const d = new Drill();
    d.startWave3();
    d.run(3);
    expect(d.playerHits).toBeGreaterThan(0);
    const slime = d.field('big_slime')[0] as Enemy;
    d.hit(slime, 40);
    expect(slime.hp).toBe(40);
    d.stance(false);
    d.run(0.2);
    expect(d.field().some((e) => e.engaged)).toBe(false);
    const hitsWhileOff = d.playerHits;
    d.run(10);
    expect(slime.hp).toBe(40);
    expect(d.playerHits).toBe(hitsWhileOff);
    d.stance(true);
    d.run(3);
    expect(d.field().some((e) => e.engaged)).toBe(true);
    expect(d.playerHits).toBeGreaterThan(hitsWhileOff);
    expect(slime.hp).toBe(40);
  });

  it('flying is the same as monsters off, and leaves nothing behind when you land', () => {
    const d = new Drill();
    d.stance(true, true);
    expect(d.target).toMatchObject({ hostile: true, peaceful: true });
    d.startWave3();
    const slime = d.field('big_slime')[0] as Enemy;
    d.hit(slime, 50);
    d.run(10);
    expect(slime.hp).toBe(30);
    expect(d.playerHits).toBe(0);
    d.stance(true, false);
    expect(d.target).toMatchObject({ hostile: true, peaceful: false });
    d.run(3);
    expect(d.field().some((e) => e.engaged)).toBe(true);
    expect(d.playerHits).toBeGreaterThan(0);
  });

  it("the game's own rules are unchanged: going down, and the leash, still send them home healed", () => {
    // Going down: a hurt slime stops fighting, goes home and is whole again.
    const down = new Drill();
    down.startWave3();
    const a = down.field('big_slime')[0] as Enemy;
    down.hit(a, 50);
    down.stance(true, false, true);
    down.run(10);
    expect(a.hp).toBe(80);
    expect(a.engaged).toBe(false);
    // The leash: chased more than 25 m from its spot, it gives up, walks home and heals.
    const leash = new Drill();
    leash.startWave3();
    const b = leash.field('big_slime')[0] as Enemy;
    leash.hit(b, 50);
    for (let t = 0; t < 60 && b.mode !== 'return'; t += 0.5) {
      leash.target.x = b.homeX + 40;
      leash.target.z = b.homeZ;
      leash.run(0.5);
    }
    expect(b.mode).toBe('return');
    leash.run(30);
    expect(b.hp).toBe(80);
  });

  it('every combination of the cheats and going down, and what may hurt you', () => {
    const t: EnemyTarget = { x: 0, z: 0, radius: 0.4, hostile: true };
    const cases: [boolean, boolean, boolean, boolean, boolean, boolean][] = [
      // monstersOn, flying, down → hostile, peaceful, can hurt
      [true, false, false, true, false, true],
      [false, false, false, true, true, false],
      [true, true, false, true, true, false],
      [false, true, false, true, true, false],
      [true, false, true, false, false, false],
      [false, false, true, false, true, false],
    ];
    for (const [on, fly, down, hostile, peaceful, hurt] of cases) {
      applyMonsterStance(t, on, fly, down);
      expect({ hostile: t.hostile, peaceful: t.peaceful, hurt: canHurt(t) }).toEqual({
        hostile,
        peaceful,
        hurt,
      });
    }
  });

  it('save and load: the cheats are never saved, so a loaded game always starts with monsters on', () => {
    const save = createNewSave('en');
    const text = JSON.stringify(save);
    for (const word of ['"monsters"', '"fly"', '"peaceful"', '"cheats"']) {
      expect(text).not.toContain(word);
    }
    const cheats = new Cheats();
    expect({ monsters: cheats.monsters, fly: cheats.fly }).toEqual({ monsters: true, fly: false });
    const t: EnemyTarget = { x: 0, z: 0, radius: 0.4, hostile: true };
    applyMonsterStance(t, cheats.monsters, cheats.fly, false);
    expect(t).toMatchObject({ hostile: true, peaceful: false });
  });
});
