import { describe, expect, it } from 'vitest';
import { monstersFileSchema, playerFileSchema, zonesFileSchema } from '../data/schemas';
import type { MonstersFile, PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { CombatState, holdCombat, swordConfig } from './Combat';
import { Enemies, type EnemiesWorld } from './Enemies';
import type { EnemyTarget } from './EnemyAI';
import { canModifyLoadout, canSwitchPrepared, type PlayerAction } from './Loadout';

const DT = 1 / 60;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile;
const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const linger = swordConfig(player).combatLingerSeconds;

function fighter(): CombatState {
  const c = new CombatState();
  c.lingerSeconds = linger;
  c.hp = 100;
  return c;
}

/** One fixed step of the fight clock, as the world runs it (sword step, then the enemies). */
function step(c: CombatState, engaged: boolean, dt = DT): void {
  c.sinceCombat += dt;
  holdCombat(c, engaged);
}

function steps(c: CombatState, seconds: number, engaged: boolean, dt = DT): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) step(c, engaged, dt);
}

const idle: PlayerAction = { rolling: false, casting: false };

describe('combat state', () => {
  it('exploring: the loadout is free', () => {
    const c = fighter();
    expect(c.inCombat).toBe(false);
    expect(canModifyLoadout(c)).toBe(true);
  });

  it('an enemy engaging you starts the fight at once, without a hit', () => {
    const c = fighter();
    step(c, true);
    expect(c.inCombat).toBe(true);
    expect(canModifyLoadout(c)).toBe(false);
  });

  it('stays in the fight as long as an enemy fights you, however long nobody hits', () => {
    const c = fighter();
    steps(c, linger * 5, true);
    expect(c.inCombat).toBe(true);
  });

  it('leaves the fight only lingerSeconds after the last enemy let go, at 60 and 120 Hz', () => {
    for (const dt of [1 / 60, 1 / 120]) {
      const c = fighter();
      steps(c, 2, true, dt);
      steps(c, linger - 0.1, false, dt);
      expect(c.inCombat).toBe(true);
      steps(c, 0.2, false, dt);
      expect(c.inCombat).toBe(false);
      expect(canModifyLoadout(c)).toBe(true);
    }
  });

  it('an aggro edge that flips on and off does not flicker the fight', () => {
    const c = fighter();
    let changes = 0;
    let was = c.inCombat;
    // An enemy engaging and letting go every half second, for ten seconds.
    for (let i = 0; i < 600; i++) {
      step(c, Math.floor(i / 30) % 2 === 0);
      if (c.inCombat !== was) changes++;
      was = c.inCombat;
    }
    expect(changes).toBe(1);
  });
});

describe('combat state with real monsters', () => {
  const base = zones.zones.find((zone) => zone.id === 'greenwood');
  if (!base) throw new Error('missing greenwood');
  // A goblin spawn is a pack of 2–3 (they alert each other).
  const spawns = [{ id: 'a', monster: 'goblin', x: 0, z: 0, wanderRadius: 0, respawnSeconds: 999 }];

  function world(enemies: Enemies): EnemiesWorld {
    return {
      mover: {
        moveCircle(p, _radius, dx, dz) {
          p.x += dx;
          p.z += dz;
        },
      },
      heightAt: () => 0,
      hitPlayer: () => {},
      shoot: () => {},
      alert: (e) => enemies.alert(e),
      bossEvent: () => {},
    };
  }

  it('a goblin pack: in a fight until every goblin is defeated, then out after the linger', () => {
    const enemies = new Enemies(
      [{ ...base, spawns, spawnAreas: [], areas: [] }],
      monsters,
      { showRadius: 160, hideMargin: 20 },
      new Map(),
    );
    const w = world(enemies);
    const target: EnemyTarget = { x: 3, z: 0, radius: 0.4, hostile: true };
    const c = fighter();
    const run = (seconds: number): void => {
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        c.sinceCombat += DT;
        enemies.step(DT, target, w);
        holdCombat(c, enemies.anyEngaged);
      }
    };
    run(0.5);
    expect(c.inCombat).toBe(true);
    const goblins = enemies.list.filter((e) => e.def.id === 'goblin' && e.alive);
    expect(goblins.length).toBeGreaterThan(1);
    const last = goblins.pop();
    if (!last) throw new Error('missing goblin');
    for (const e of goblins) enemies.hit(e, e.maxHp);
    run(linger + 1);
    // One goblin is still fighting: still locked.
    expect(last.engaged).toBe(true);
    expect(c.inCombat).toBe(true);
    enemies.hit(last, last.maxHp);
    run(linger - 0.5);
    expect(c.inCombat).toBe(true);
    run(1);
    expect(enemies.anyEngaged).toBe(false);
    expect(c.inCombat).toBe(false);
  });

  it('a goblin that gives up (you ran beyond its leash) ends the fight', () => {
    const enemies = new Enemies(
      [{ ...base, spawns, spawnAreas: [], areas: [] }],
      monsters,
      { showRadius: 160, hideMargin: 20 },
      new Map(),
    );
    const w = world(enemies);
    const target: EnemyTarget = { x: 3, z: 0, radius: 0.4, hostile: true };
    const c = fighter();
    for (let i = 0; i < 30; i++) {
      c.sinceCombat += DT;
      enemies.step(DT, target, w);
      holdCombat(c, enemies.anyEngaged);
    }
    expect(c.inCombat).toBe(true);
    // Run away faster than the goblin, far beyond its leash.
    for (let i = 0; i < 20 * 60; i++) {
      target.x = 3 + Math.min(i * DT * 6, 70);
      c.sinceCombat += DT;
      enemies.step(DT, target, w);
      holdCombat(c, enemies.anyEngaged);
    }
    expect(enemies.anyEngaged).toBe(false);
    expect(c.inCombat).toBe(false);
  });

  it('a boss fight holds the fight until it is won or lost', () => {
    const c = fighter();
    let bossFight = true;
    for (let i = 0; i < 60 * 30; i++) step(c, bossFight);
    expect(canModifyLoadout(c)).toBe(false);
    // Lost: the encounter aborts and you wake up (the world resets the fight clock).
    bossFight = false;
    c.sinceCombat = Infinity;
    step(c, bossFight);
    expect(canModifyLoadout(c)).toBe(true);
  });
});

describe('switching what is prepared', () => {
  it('is allowed in a fight while you are free', () => {
    const c = fighter();
    step(c, true);
    expect(c.inCombat).toBe(true);
    expect(canSwitchPrepared(c, idle)).toBe(true);
  });

  it('never cuts off a swing, a heavy wind-up, a roll, a guard, a cast or a stagger', () => {
    const swing = fighter();
    swing.swingTime = 0.1;
    expect(canSwitchPrepared(swing, idle)).toBe(false);
    const heavy = fighter();
    heavy.heavyWindup = 0.2;
    expect(canSwitchPrepared(heavy, idle)).toBe(false);
    const guard = fighter();
    guard.guard.up = true;
    expect(canSwitchPrepared(guard, idle)).toBe(false);
    const staggered = fighter();
    staggered.poise.staggerTime = 0.5;
    expect(canSwitchPrepared(staggered, idle)).toBe(false);
    const free = fighter();
    expect(canSwitchPrepared(free, { rolling: true, casting: false })).toBe(false);
    expect(canSwitchPrepared(free, { rolling: false, casting: true })).toBe(false);
    free.hp = 0;
    expect(canSwitchPrepared(free, idle)).toBe(false);
  });
});
