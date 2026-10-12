import { describe, expect, it } from 'vitest';
import {
  monstersFileSchema,
  playerFileSchema,
  statsFileSchema,
  zonesFileSchema,
} from '../data/schemas';
import type { MonstersFile, PlayerConfig, StatsFile } from '../data/types';
import type { Enemy } from '../entities/Enemy';
import { readPublicJson } from '../test/loadPublic';
import type { PointXZ } from '../world/Colliders';
import { keepInArena } from './BossAI';
import {
  applyStats,
  assistedHeading,
  CombatState,
  damageTaken as damageTakenBy,
  inSwingArc,
  type SwordResult,
  stepSword,
  swordConfig,
} from './Combat';
import { Enemies, type EnemiesWorld } from './Enemies';
import type { EnemyTarget } from './EnemyAI';
import { type MoveCommand, MoverState, movementConfig, stepMovement } from './Movement';
import {
  applyStatsToCombat,
  computeStatEffects,
  emptyStatEffects,
  normalizeStatPoints,
  pointBudget,
  presetPoints,
  type StatPoints,
} from './Stats';

/**
 * Balance checks (step 2.7): a simulated player fights with the real sword, movement and boss
 * code on the fixed step. Not exact human play, but it shows whether the numbers in the data
 * give the fight the concept asks for (Sultan: about 2 minutes, "semi lastig: wie niet op tijd
 * ontwijkt, verliest").
 */

const DT = 1 / 60;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile;
const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const stats = statsFileSchema.parse(readPublicJson('data/stats.json')) as StatsFile;
const sword = swordConfig(player);
const moveCfg = movementConfig(player);
/** Hilda's honed sword (items.json) after the first day. */
const HONED_BONUS = 3;

const free = {
  moveCircle(p: PointXZ, _r: number, dx: number, dz: number) {
    p.x += dx;
    p.z += dz;
  },
};

interface Bot {
  /** Dodges the warnings (false: only stands and hits). */
  dodges: boolean;
  /** Seconds before reacting to a warning. */
  reaction: number;
  level: number;
  weaponBonus: number;
  /** The build: points spent per stat (fase 3.7). */
  points: StatPoints;
}

/**
 * A build at a level: one of the suggested spreads from stats.json plus where the points from
 * levelling went. Anything that does not fit the budget is dropped (`normalizeStatPoints`).
 */
function build(presetId: string, level: number, extra: Readonly<StatPoints> = {}): StatPoints {
  const points = presetPoints(stats, presetId, level);
  for (const [statId, add] of Object.entries(extra)) {
    points[statId] = (points[statId] ?? 0) + add;
  }
  return normalizeStatPoints(stats, points, level);
}

interface FightResult {
  won: boolean;
  seconds: number;
  hpLeft: number;
  hitsTaken: number;
  damageTaken: number;
}

/** One Sultan fight with a simulated player; stops at a win, a loss or after `maxSeconds`. */
function fightSultan(bot: Bot, seed: number, maxSeconds = 400): FightResult {
  const enemies = new Enemies(zones.zones, monsters, { showRadius: 160, hideMargin: 20 });
  const boss = enemies.bossOf('sultan') as Enemy;
  const def = boss.boss?.def;
  if (!def) throw new Error('no boss');
  // A different but repeatable fight per seed.
  for (let i = 0; i < seed; i++) boss.rng.next();
  const s = new MoverState();
  s.x = def.playerStart.x;
  s.z = def.playerStart.z;
  s.heading = Math.atan2(def.start.x - s.x, def.start.z - s.z);
  s.energy = moveCfg.maxEnergy;
  const c = new CombatState();
  c.hp = Infinity;
  applyStatsToCombat(stats, computeStatEffects(stats, bot.points, 'sword', emptyStatEffects()), c);
  applyStats(c, player, bot.level);
  c.hp = c.maxHp;
  c.weaponBonus = bot.weaponBonus;
  let hitsTaken = 0;
  let damageTaken = 0;
  const target: EnemyTarget = { x: s.x, z: s.z, radius: moveCfg.radius, hostile: true };
  const world: EnemiesWorld = {
    mover: free,
    heightAt: () => 0,
    hitPlayer: (_e, damage) => {
      // Like the world does it: gear and Defense soften the hit first.
      const taken = damageTakenBy(c, damage);
      c.hp -= taken;
      hitsTaken++;
      damageTaken += taken;
    },
    shoot: () => {},
    alert: () => {},
    bossEvent: () => {},
  };
  enemies.step(DT, target, world);
  enemies.startBoss(boss, s.heading + Math.PI);
  const cmd: MoveCommand = { x: 0, z: 0, dash: false };
  const input = { fast: false, heavy: false, critRoll: 1 };
  const result: SwordResult = { landed: 'none', damage: 0, combo: false, crit: false };
  let warned = 0;
  let opened = 0;
  let side = 1;
  let time = 0;
  for (; time < maxSeconds; time += DT) {
    const b = boss.boss;
    if (!b) break;
    cmd.x = 0;
    cmd.z = 0;
    cmd.dash = false;
    input.fast = false;
    const dx = boss.x - s.x;
    const dz = boss.z - s.z;
    const d = Math.max(1e-6, Math.hypot(dx, dz));
    const gap = d - moveCfg.radius - boss.radius;
    const pattern = b.attack?.pattern;
    const threat = b.phase === 'telegraph' || b.phase === 'attack';
    warned = threat ? warned + DT : 0;
    opened = b.phase === 'opening' ? opened + DT : 0;
    if (bot.dodges && threat && warned >= bot.reaction) {
      if (pattern === 'charge') {
        // Step off the red line, to the side you are already on.
        const across = (s.x - b.fromX) * -b.dirZ + (s.z - b.fromZ) * b.dirX;
        side = across >= 0 ? 1 : -1;
        cmd.x = -b.dirZ * side;
        cmd.z = b.dirX * side;
      } else if (pattern === 'pounce') {
        // Wait for the crouch, then dash sideways.
        cmd.x = (-dz / d) * side;
        cmd.z = (dx / d) * side;
        cmd.dash = b.aimed;
      } else {
        // Claws: back off (dash once if he is close).
        cmd.x = -dx / d;
        cmd.z = -dz / d;
        cmd.dash = gap < 1.2;
      }
    } else if (b.phase === 'opening' || b.phase === 'retreat') {
      if (gap > 1.2) {
        cmd.x = dx / d;
        cmd.z = dz / d;
      }
      // Hits once it sees him stand still (the same reaction time).
      input.fast = gap < sword.range && opened >= bot.reaction;
    } else if (!bot.dodges) {
      // The button masher: walks up and keeps hitting.
      if (gap > 1) {
        cmd.x = dx / d;
        cmd.z = dz / d;
      }
      input.fast = true;
    }
    // The same order as WorldState: aim assist, sword, walking, arena, monsters.
    if (input.fast && s.dashTime <= 0) {
      s.heading = assistedHeading(
        s.x,
        s.z,
        s.heading,
        enemies.shown,
        sword.aimRange,
        sword.aimHalfArc,
      );
    }
    stepSword(
      c,
      s,
      s.dashTime > 0 ? { fast: false, heavy: false, critRoll: 1 } : input,
      sword,
      DT,
      result,
    );
    if (result.landed !== 'none') {
      for (const e of enemies.shown) {
        if (
          !e.alive ||
          !inSwingArc(s.x, s.z, s.heading, e.x, e.z, e.radius, sword.range, sword.halfArc)
        )
          continue;
        if (e.hittable) enemies.hit(e, result.damage);
      }
    }
    stepMovement(s, cmd, moveCfg, DT, free);
    keepInArena(s, def.arena, moveCfg.radius);
    target.x = s.x;
    target.z = s.z;
    enemies.step(DT, target, world);
    if (!boss.alive) return { won: true, seconds: time, hpLeft: c.hp, hitsTaken, damageTaken };
    if (c.hp <= 0) return { won: false, seconds: time, hpLeft: 0, hitsTaken, damageTaken };
  }
  return { won: false, seconds: time, hpLeft: c.hp, hitsTaken, damageTaken };
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

function summary(results: FightResult[]): string {
  const wins = results.filter((r) => r.won);
  const avg = (list: number[]) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
  return (
    `wins ${wins.length}/${results.length} · ` +
    `time ${avg(wins.map((r) => r.seconds)).toFixed(0)} s · ` +
    `hp left ${avg(wins.map((r) => r.hpLeft)).toFixed(0)} · ` +
    `damage taken ${avg(results.map((r) => r.damageTaken)).toFixed(0)}`
  );
}

describe('balance: Sultan (beginner boss)', () => {
  // Level 3 with Hilda's honed sword and a sword build: 20 start points plus 2 from levelling.
  const level3 = {
    level: 3,
    weaponBonus: HONED_BONUS,
    points: build('sword_fighter', 3, { hp: 1, power: 1 }),
  };

  it('is beaten in one to two minutes by a player who dodges in time', () => {
    const results = SEEDS.map((seed) =>
      fightSultan({ ...level3, dodges: true, reaction: 0.3 }, seed),
    );
    console.log(`dodging player, level 3, honed sword: ${summary(results)}`);
    const wins = results.filter((r) => r.won);
    expect(wins.length).toBeGreaterThanOrEqual(SEEDS.length - 1);
    const avgSeconds = wins.reduce((a, r) => a + r.seconds, 0) / wins.length;
    // Concept: "het gevecht duurt ongeveer 2 minuten". This player uses every opening; a real
    // one misses some, so the fight takes longer than here.
    expect(avgSeconds).toBeGreaterThan(50);
    expect(avgSeconds).toBeLessThan(150);
  });

  it('is lost by a player who never dodges ("wie niet op tijd ontwijkt, verliest")', () => {
    const results = SEEDS.map((seed) =>
      fightSultan({ ...level3, dodges: false, reaction: 0 }, seed),
    );
    console.log(`button masher, level 3: ${summary(results)}`);
    expect(results.filter((r) => r.won).length).toBe(0);
    // Glued to him does not stop his attacks: down within a minute.
    expect(results.every((r) => r.seconds < 60)).toBe(true);
  });

  it('is still won with slow reactions (a beginner), but only just', () => {
    const results = SEEDS.map((seed) =>
      fightSultan({ ...level3, dodges: true, reaction: 0.5 }, seed),
    );
    console.log(`slow reactions (0.5 s), level 3: ${summary(results)}`);
    // Even without potions most fights are won, with little HP left: a test, not a wall.
    const wins = results.filter((r) => r.won);
    expect(wins.length).toBeGreaterThanOrEqual(SEEDS.length - 2);
    const hpLeft = wins.reduce((a, r) => a + r.hpLeft, 0) / Math.max(1, wins.length);
    expect(hpLeft).toBeLessThan(80);
  });
});

/**
 * Extreme builds (fase 3.7): everything in one stat. The point of the check is that none of
 * them breaks the fight — no build walks over Sultan, and no build is simply stuck.
 */
describe('balance: extreme builds against Sultan', () => {
  const extreme = (statId: string, level = 3) =>
    normalizeStatPoints(stats, { [statId]: pointBudget(stats, level) }, level);
  const bot = (statId: string) => ({
    level: 3,
    weaponBonus: HONED_BONUS,
    dodges: true,
    reaction: 0.3,
    points: extreme(statId),
  });

  it('all in Power hits hard but has nothing to take hits with', () => {
    const results = SEEDS.map((seed) => fightSultan(bot('power'), seed));
    console.log(`all Power, level 3: ${summary(results)}`);
    const balanced = SEEDS.map((seed) =>
      fightSultan(
        {
          level: 3,
          weaponBonus: HONED_BONUS,
          dodges: true,
          reaction: 0.3,
          points: build('sword_fighter', 3, { hp: 1, power: 1 }),
        },
        seed,
      ),
    );
    const seconds = (list: FightResult[]) => {
      const wins = list.filter((r) => r.won);
      return wins.reduce((a, r) => a + r.seconds, 0) / Math.max(1, wins.length);
    };
    // Faster than a spread build, but never a walkover: the fight still takes half a minute.
    expect(seconds(results)).toBeLessThan(seconds(balanced));
    expect(seconds(results)).toBeGreaterThan(30);
  });

  it('all in HP survives everything but needs much longer', () => {
    const results = SEEDS.map((seed) => fightSultan(bot('hp'), seed, 600));
    console.log(`all HP, level 3: ${summary(results)}`);
    // Still gets through — slowly — and keeps plenty of HP while doing it.
    expect(results.filter((r) => r.won).length).toBeGreaterThanOrEqual(SEEDS.length - 1);
    const wins = results.filter((r) => r.won);
    expect(wins.reduce((a, r) => a + r.seconds, 0) / wins.length).toBeGreaterThan(90);
  });

  it('all in Defense takes clearly less damage', () => {
    const results = SEEDS.map((seed) => fightSultan(bot('defense'), seed, 600));
    console.log(`all Defense, level 3: ${summary(results)}`);
    const plain = SEEDS.map((seed) => fightSultan(bot('luck'), seed, 600));
    const damage = (list: FightResult[]) =>
      list.reduce((a, r) => a + r.damageTaken, 0) / list.length;
    expect(damage(results)).toBeLessThan(damage(plain));
  });

  it('a build with nothing spent is weak but not hopeless', () => {
    const results = SEEDS.map((seed) =>
      fightSultan(
        { level: 3, weaponBonus: HONED_BONUS, dodges: true, reaction: 0.3, points: {} },
        seed,
        600,
      ),
    );
    console.log(`nothing spent, level 3: ${summary(results)}`);
    // It can be done, but you feel every missing point: this is the floor of the balance.
    expect(results.some((r) => r.won)).toBe(true);
  });
});
