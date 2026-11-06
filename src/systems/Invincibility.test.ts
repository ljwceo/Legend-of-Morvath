import { describe, expect, it } from 'vitest';
import { monstersFileSchema, questsFileSchema, zonesFileSchema } from '../data/schemas';
import type { MonstersFile, WaveFightDef, Zone } from '../data/types';
import type { Enemy } from '../entities/Enemy';
import { createNewSave } from '../save/SaveData';
import { readPublicJson } from '../test/loadPublic';
import type { PointXZ } from '../world/Colliders';
import { emptyBox, shapeBounds } from '../world/Shapes';
import { Cheats, powerCheatsAllowed } from './Cheats';
import { CombatState, damageTaken, hpAfterHit } from './Combat';
import { Enemies, type EnemiesWorld } from './Enemies';
import { applyMonsterStance, type EnemyTarget } from './EnemyAI';
import { Projectiles } from './Projectiles';
import { StatusEffects } from './StatusEffects';

// GG.8.5 step 3: Invincibility (cheat menu). Every way the player loses HP goes through
// WorldState.hurtPlayer (monsters, bosses, arrows, burning), and its HP part is `hpAfterHit`;
// these tests feed it the real damage sources: the drill's slimes, Sultan, an arrow and burning.
// Real monsters.json, quests.json and zones.json.

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
const HP = 200;

/** The player's HP as WorldState.hurtPlayer handles it: gear first, then `hpAfterHit`. */
class Player {
  readonly c = new CombatState();
  invincible = false;
  hits = 0;
  lowest = HP;
  constructor() {
    this.c.hp = this.c.maxHp = HP;
  }
  take(damage: number): void {
    this.hits++;
    this.c.hp = hpAfterHit(this.c.hp, damageTaken(this.c, damage), this.invincible);
    this.lowest = Math.min(this.lowest, this.c.hp);
  }
}

/** Sir Garrick's drill, wave 3, with the monsters attacking (no cheat but invincibility). */
function drill(player: Player) {
  const enemies = new Enemies(
    [{ ...greyhaven, spawns: [], spawnAreas: [], nightSpawns: [] }],
    monsters,
    { showRadius: 160, hideMargin: 20 },
    new Map([[FIELD, fieldShape as never]]),
    null,
    0,
    [drillDef],
  );
  const target: EnemyTarget = { x: CX, z: CZ, radius: 0.4, hostile: true };
  applyMonsterStance(target, true, false, false);
  const world: EnemiesWorld = {
    mover: free,
    heightAt: () => 0,
    hitPlayer: (_e, damage) => player.take(damage),
    shoot: () => {},
    alert: (e) => enemies.alert(e),
    bossEvent: () => {},
  };
  enemies.step(DT, target, world);
  enemies.spawnWave(drillDef.id, 2, CX, CZ, drillDef.spawnRadius);
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds; t += DT) enemies.step(DT, target, world);
  };
  const field = (kind?: string): Enemy[] =>
    enemies.list.filter(
      (e) => e.alive && e.id.startsWith(drillDef.id) && (!kind || e.def.id === kind),
    );
  return { enemies, run, field };
}

describe('Invincibility (GG.8.5 step 3)', () => {
  it('melee: the drill slimes keep attacking, but take no HP; without it they do', () => {
    const on = new Player();
    on.invincible = true;
    drill(on).run(20);
    const off = new Player();
    drill(off).run(20);
    expect(on.hits).toBeGreaterThan(0);
    // The monsters do exactly the same either way: they never know you are invincible.
    expect(on.hits).toBe(off.hits);
    expect(on.c.hp).toBe(HP);
    expect(off.c.hp).toBeLessThan(HP);
  });

  it('an arrow that hits takes no HP', () => {
    for (const invincible of [true, false]) {
      const player = new Player();
      player.invincible = invincible;
      const arrows = new Projectiles();
      const target = { x: 0, z: 0, radius: 0.4, hostile: true };
      arrows.fire(0, 1.2, -10, 0, 0, 15, 12, 30);
      for (let t = 0; t < 2; t += DT) {
        arrows.step(DT, target, { heightAt: () => 0, blocked: () => false }, (d) => player.take(d));
      }
      expect(player.hits).toBe(1);
      expect(player.c.hp).toBe(invincible ? HP : HP - 12);
    }
  });

  it("Sultan's attacks land, but take no HP", () => {
    for (const invincible of [true, false]) {
      const player = new Player();
      player.invincible = invincible;
      const enemies = new Enemies(zones.zones, monsters, { showRadius: 160, hideMargin: 20 });
      const boss = enemies.bossOf('sultan') as Enemy;
      const def = boss.boss?.def;
      if (!def) throw new Error('no Sultan');
      const target: EnemyTarget = {
        x: def.playerStart.x,
        z: def.playerStart.z,
        radius: 0.4,
        hostile: true,
      };
      const world: EnemiesWorld = {
        mover: free,
        heightAt: () => 0,
        hitPlayer: (_e, damage) => player.take(damage),
        shoot: () => {},
        alert: () => {},
        bossEvent: () => {},
      };
      enemies.step(DT, target, world);
      enemies.startBoss(boss, Math.atan2(target.x - def.start.x, target.z - def.start.z));
      for (let t = 0; t < 60 && player.hits < 3; t += DT) enemies.step(DT, target, world);
      expect(player.hits).toBeGreaterThanOrEqual(3);
      if (invincible) expect(player.c.hp).toBe(HP);
      else expect(player.c.hp).toBeLessThan(HP);
    }
  });

  it('burning (damage over time) ticks, but takes no HP', () => {
    for (const invincible of [true, false]) {
      const player = new Player();
      player.invincible = invincible;
      const status = new StatusEffects(monsters.statusEffects);
      const fireSlime = monsters.monsters.find((m) => m.id === 'fire_slime');
      if (!fireSlime) throw new Error('no fire slime');
      status.applyAll(fireSlime);
      let ticks = 0;
      for (let t = 0; t < 4; t += DT) {
        const totals = status.step(DT);
        if (totals.damage > 0) {
          ticks++;
          player.take(totals.damage);
        }
      }
      expect(ticks).toBeGreaterThan(0);
      if (invincible) expect(player.c.hp).toBe(HP);
      else expect(player.c.hp).toBeLessThan(HP);
    }
  });

  it('a hit that would be deadly (or broken numbers) never takes you below 0 or makes NaN', () => {
    expect(hpAfterHit(50, 1e9, true)).toBe(50);
    expect(hpAfterHit(50, Number.POSITIVE_INFINITY, true)).toBe(50);
    expect(hpAfterHit(50, 1e9, false)).toBe(0);
    expect(hpAfterHit(50, Number.POSITIVE_INFINITY, false)).toBe(0);
    for (const bad of [Number.NaN, 0, -20]) {
      expect(hpAfterHit(50, bad, false)).toBe(50);
      expect(hpAfterHit(50, bad, true)).toBe(50);
    }
    const player = new Player();
    player.invincible = true;
    player.take(1e9);
    expect(player.c.hp).toBe(HP);
  });

  it('On → Off → On in the middle of a fight: the HP only goes down while it is off', () => {
    const player = new Player();
    const fight = drill(player);
    player.invincible = true;
    fight.run(6);
    const hitsOn = player.hits;
    expect(hitsOn).toBeGreaterThan(0);
    expect(player.c.hp).toBe(HP);
    player.invincible = false;
    fight.run(6);
    const afterOff = player.c.hp;
    expect(player.hits).toBeGreaterThan(hitsOn);
    expect(afterOff).toBeLessThan(HP);
    player.invincible = true;
    const hitsBefore = player.hits;
    fight.run(6);
    expect(player.hits).toBeGreaterThan(hitsBefore);
    expect(player.c.hp).toBe(afterOff);
  });

  it('the monsters stay hurtable: a Big Slime still loses HP, dies and splits, never healed', () => {
    const player = new Player();
    player.invincible = true;
    const fight = drill(player);
    fight.run(1);
    const slime = fight.field('big_slime')[0] as Enemy;
    const greens = fight.field('green_slime').length;
    const seen: number[] = [];
    for (let i = 0; i < 20 && slime.alive; i++) {
      fight.enemies.hit(slime, 10, 6);
      seen.push(slime.hp);
      fight.run(0.34);
      expect(slime.hp).toBe(seen.at(-1));
    }
    expect(seen).toEqual([70, 60, 50, 40, 30, 20, 10, 0]);
    expect(fight.field('green_slime').length).toBe(greens + 2);
  });

  it('save and load: it is never saved, starts off, and switches off with the other cheats', () => {
    expect(JSON.stringify(createNewSave('en'))).not.toContain('invincible');
    const cheats = new Cheats();
    expect(cheats.invincible).toBe(false);
    expect(cheats.active).toBe(false);
    cheats.invincible = true;
    expect(cheats.active).toBe(true);
    cheats.reset();
    expect(cheats.invincible).toBe(false);
  });

  it('only a dev build or ?debug=1 allows it, never debug mode from the Settings alone', () => {
    const p = (query: string) => new URLSearchParams(query);
    expect(powerCheatsAllowed(p(''), true)).toBe(true);
    expect(powerCheatsAllowed(p('?debug=1'), false)).toBe(true);
    expect(powerCheatsAllowed(p(''), false)).toBe(false);
    expect(powerCheatsAllowed(p('?debug=0'), false)).toBe(false);
    expect(powerCheatsAllowed(p('?debug=true'), false)).toBe(false);
  });
});
