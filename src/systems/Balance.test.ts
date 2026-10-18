import { beforeAll, describe, expect, it } from 'vitest';
import {
  itemsFileSchema,
  monstersFileSchema,
  playerFileSchema,
  questsFileSchema,
  skillsFileSchema,
  spellsFileSchema,
  statsFileSchema,
  zonesFileSchema,
} from '../data/schemas';
import type {
  ItemsFile,
  MonstersFile,
  PlayerConfig,
  PlayerPath,
  Shape,
  SkillsFile,
  SpellsFile,
  StatsFile,
  WaveFightDef,
  Zone,
} from '../data/types';
import type { Enemy } from '../entities/Enemy';
import { readPublicJson } from '../test/loadPublic';
import type { PointXZ } from '../world/Colliders';
import { emptyBox, shapeBounds } from '../world/Shapes';
import { type Arena, keepInArena } from './BossAI';
import { emptyGearStats, gearStats } from './Gear';
import { headingTo } from './LockOn';
import { applyPath } from './Paths';
import { Shots } from './Shots';
import {
  powerFactor,
  type ShotConfig,
  type CastInput,
  type CastResult,
  type CastSources,
  CastState,
  castConfig,
  stepCast,
} from './Casting';
import { leechHeal, slowFactor, StatusEffects, weakenFactor } from './StatusEffects';
import { WaveFight } from './WaveFight';
import {
  applyStats,
  assistedHeading,
  CombatState,
  damageTaken as damageTakenBy,
  inSwingArc,
  regenMana,
  type SwordResult,
  stepSword,
  swordConfig,
  tickCombatClock,
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
  type StatEffects,
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
  /** Starts a heavy hit as he retreats so it lands in his opening (fase S.11). */
  heavy?: boolean;
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
  /** How many times Sultan's poise broke (he staggered). */
  poiseBreaks?: number;
}

/** One Sultan fight with a simulated player; stops at a win, a loss or after `maxSeconds`. */
function fightSultan(bot: Bot, seed: number, maxSeconds = 400, sultanPoise?: number): FightResult {
  const enemies = new Enemies(zones.zones, monsters, { showRadius: 160, hideMargin: 20 });
  const boss = enemies.bossOf('sultan') as Enemy;
  const def = boss.boss?.def;
  if (!def) throw new Error('no boss');
  let poiseBreaks = 0;
  let wasStaggered = false;
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
  if (sultanPoise !== undefined) boss.poise.reset(sultanPoise);
  const cmd: MoveCommand = { x: 0, z: 0, dash: false };
  const input = { fast: false, heavy: false, critRoll: 1 };
  const result: SwordResult = {
    landed: 'none',
    damage: 0,
    poiseDamage: 0,
    combo: false,
    crit: false,
  };
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
    input.heavy = false;
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
      input.fast = gap < sword.range && opened >= bot.reaction && c.heavyWindup <= 0;
      // The heavy hit starts as he retreats, so it lands in the opening.
      input.heavy = !!bot.heavy && b.phase === 'retreat' && gap < sword.range + 1;
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
        if (e.hittable) enemies.hit(e, result.damage, result.poiseDamage);
      }
    }
    stepMovement(s, cmd, moveCfg, DT, free);
    keepInArena(s, def.arena, moveCfg.radius);
    target.x = s.x;
    target.z = s.z;
    enemies.step(DT, target, world);
    if (boss.poise.staggered && !wasStaggered) poiseBreaks++;
    wasStaggered = boss.poise.staggered;
    if (!boss.alive)
      return { won: true, seconds: time, hpLeft: c.hp, hitsTaken, damageTaken, poiseBreaks };
    if (c.hp <= 0)
      return { won: false, seconds: time, hpLeft: 0, hitsTaken, damageTaken, poiseBreaks };
  }
  return { won: false, seconds: time, hpLeft: c.hp, hitsTaken, damageTaken, poiseBreaks };
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

  it("a player with heavy hits breaks Sultan's poise (S.11)", () => {
    const heavyBot = { ...level3, dodges: true, reaction: 0.3, heavy: true };
    const breaks = (poise?: number) =>
      SEEDS.map((seed) => fightSultan(heavyBot, seed, 400, poise).poiseBreaks ?? 0);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const data = breaks();
    console.log(`heavy bot poise breaks per fight, data poise: ${data.join(',')}`);
    console.log(
      `  with poise 60: ${breaks(60).join(',')}, with poise 200: ${breaks(200).join(',')}`,
    );
    // Every fight sees him stagger at least once, with the poise from the data.
    expect(data.every((n) => n >= 1)).toBe(true);
    // Poise still means something: a much sturdier Sultan breaks far less often.
    expect(sum(data)).toBeGreaterThan(sum(breaks(200)) * 2);
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

/**
 * Fighting outside the boss arena: the Entrance Exams (fase 3.8) and the mini-bosses after the
 * city gate (fase 3.9), fought by one simulated player that knows all three paths. Walking,
 * fighting, shots, status effects, the waves of a drill and the enemy AI are the real code on
 * the fixed step; only the decisions are a robot's.
 *
 * Step 3.10.1 uses it to measure three things: a normal player of each path, the extreme
 * builds (everything in one stat), and whether any build walks over the content or cannot get
 * through it at all. The robot never drinks a potion, so every number here is the bare build.
 */

const questsFile = questsFileSchema.parse(readPublicJson('data/quests.json'));
const items = itemsFileSchema.parse(readPublicJson('data/items.json')) as ItemsFile;
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
const skills = skillsFileSchema.parse(readPublicJson('data/skills.json')) as SkillsFile;
const staff = castConfig(player, spells);
const itemsById = new Map(items.items.map((item) => [item.id, item]));
const PATHS: readonly PlayerPath[] = ['sword', 'light', 'dark'];
const DRILLS: Readonly<Record<PlayerPath, string>> = {
  sword: 'garrick_field_drill',
  light: 'brink_field_drill',
  dark: 'sam_field_drill',
};
/** What each path fights with after the first exam (its teacher hands it over). */
const WEAPONS: Readonly<Record<PlayerPath, string>> = {
  sword: 'academy_blade',
  light: 'mage_staff',
  dark: 'mage_staff',
};
/** The spell the crystal of each path comes with (Master Brink draws one of four). */
const SPELLS: Readonly<Record<PlayerPath, string | null>> = {
  sword: null,
  light: 'thorn_shot',
  dark: 'shadow_bolt',
};
/** The starting spread of each path (stats.json). */
const PRESETS: Readonly<Record<PlayerPath, string>> = {
  sword: 'sword_fighter',
  light: 'light_mage',
  dark: 'dark_mage',
};

const freeShots = { heightAt: () => 0, blocked: () => false };
/** Seconds a simulated player steps away from a lunge, and how long it then holds its ground. */
const DODGE_SECONDS = 0.5;
const ATTACK_SECONDS = 0.8;
/** Walking speed without any stats on it (the fight changes `moveCfg.walkSpeed` while it runs). */
const BASE_WALK_SPEED = moveCfg.walkSpeed;
/** Meters of room around a fight in the open world that the simulated player keeps to. */
const ARENA_MARGIN = 8;

function waveFight(id: string): WaveFightDef {
  const def = questsFile.waveFights.find((entry) => entry.id === id);
  if (!def) throw new Error(`missing wave fight ${id}`);
  return def;
}

/** Greyhaven with nothing in it but the training field, so only the drill spawns monsters. */
function fieldOnly(): Zone[] {
  const base = zones.zones.find((zone) => zone.id === 'greyhaven');
  if (!base) throw new Error('missing greyhaven');
  return [{ ...base, spawns: [], spawnAreas: [], nightSpawns: [] }];
}

function trainingField(): Shape {
  const greyhaven = zones.zones.find((zone) => zone.id === 'greyhaven');
  const area = greyhaven?.areas.find((entry) => entry.id === 'academy_training_field');
  if (!area) throw new Error('missing training field');
  return area.shape;
}

/** The simulated player: a build on a path, and how sharply it plays. */
interface SimBot {
  path: PlayerPath;
  /** Keeps its distance from a monster that is winding up (false: only walks in and hits). */
  dodges: boolean;
  /** Seconds before reacting to a warning. */
  reaction: number;
  level: number;
  points: StatPoints;
}

/** The player as the world puts it together: build, path, weapon and the spell of its crystal. */
interface Fighter {
  c: CombatState;
  effects: StatEffects;
  spell: ShotConfig | null;
  /** The power curve of its path at this level (spells.json). */
  power: number;
  /** Walking speed with its stats and perks (m/s). */
  walkSpeed: number;
}

/**
 * Build, weapon, gear and path exactly as WorldState puts them together, so the balance tests
 * fight with the same numbers the game gives you.
 */
function makeFighter(bot: SimBot): Fighter {
  const c = new CombatState();
  const effects = emptyStatEffects();
  computeStatEffects(stats, bot.points, bot.path, effects);
  applyPath(player, skills, stats, bot.path, effects);
  const weapon = itemsById.get(WEAPONS[bot.path]);
  const gear = gearStats({ weapon: weapon?.id ?? '' }, itemsById, emptyGearStats());
  c.weaponBonus = weapon?.weapon?.damageBonus ?? 0;
  c.gearHp = gear.hp;
  c.gearMana = gear.mana;
  c.damageFactor = 1 + gear.damagePercent / 100;
  applyStatsToCombat(stats, effects, c, gear.damageReductionPercent);
  applyStats(c, player, bot.level);
  c.hp = c.maxHp;
  c.mana = c.maxMana;
  const spellId = SPELLS[bot.path];
  return {
    c,
    effects,
    spell: spellId ? (staff.spells.get(spellId) ?? null) : null,
    power: powerFactor(spells.powerCurves, bot.path, bot.level),
    walkSpeed: BASE_WALK_SPEED * (1 + effects.moveSpeedPercent / 100),
  };
}

/** Where a fight happens: the monsters, the ground the player keeps to, and how it is won. */
interface Scene {
  enemies: Enemies;
  /** The ground the simulated player stays on (a drill resets if you walk off the field). */
  arena: Arena;
  startX: number;
  startZ: number;
  /** Called once the monsters have had their first step (a drill starts its waves here). */
  start(): void;
  /** Stepped after the monsters (the script of a drill); does nothing in the open world. */
  step(dt: number): void;
  /** True once the fight is over and won. */
  won(): boolean;
  /** Waves cleared so far (0 outside a drill). */
  waves(): number;
}

/**
 * A different spot to start from per seed, near the middle of the fight: a real player never
 * stands in exactly the same place twice, but also does not begin a drill in a corner of the
 * field. Repeatable, so one seed is always the same fight.
 */
function startSpot(cx: number, cz: number, radius: number, seed: number): PointXZ {
  // The golden angle, so every seed walks in from another side.
  const angle = seed * 2.39996;
  const r = radius * (0.1 + 0.3 * (((seed * 7) % 5) / 4));
  return { x: cx + Math.sin(angle) * r, z: cz + Math.cos(angle) * r };
}

/** One drill of a path on the Academy training field (quests.json `waveFights`). */
function drillScene(path: PlayerPath, seed: number): Scene {
  const def = waveFight(DRILLS[path]);
  const field = trainingField();
  const box = shapeBounds(field, emptyBox());
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const radius = field.type === 'circle' ? field.radius : 9;
  const enemies = new Enemies(
    fieldOnly(),
    monsters,
    { showRadius: 160, hideMargin: 20 },
    new Map([['academy_training_field', field]]),
    null,
    seed,
    [def],
  );
  let cleared = 0;
  let done = false;
  const fight = new WaveFight(def, {
    alive: () => enemies.waveAlive(def.id),
    spawnWave: (index) => void enemies.spawnWave(def.id, index, cx, cz, def.spawnRadius),
    clear: () => enemies.clearWave(def.id),
    // The robot never walks off the field (it is clamped to it in runFight).
    inArea: () => true,
    say: () => {},
    waveCleared: () => cleared++,
    finished: () => {
      done = true;
    },
    reset: () => {},
  });
  const spot = startSpot(cx, cz, radius, seed);
  return {
    enemies,
    arena: { x: cx, z: cz, radius },
    startX: spot.x,
    startZ: spot.z,
    start: () => fight.start(),
    step: (dt) => fight.step(dt),
    won: () => done,
    waves: () => cleared,
  };
}

/**
 * A fight in the open world: one zone with nothing in it but the picked spawns from
 * zones.json, so the monsters, their spots and their numbers are the real ones. Nothing comes
 * back: the fight is over once everything is down.
 */
function worldScene(zoneId: string, pick: readonly string[], seed: number): Scene {
  const base = zones.zones.find((zone) => zone.id === zoneId);
  if (!base) throw new Error(`missing zone ${zoneId}`);
  const spawns = (base.spawns ?? []).filter((spawn) => pick.includes(spawn.id));
  const areas = (base.spawnAreas ?? []).filter((area) => pick.includes(area.id));
  if (spawns.length + areas.length !== pick.length) {
    throw new Error(`missing spawns ${pick.join(', ')} in ${zoneId}`);
  }
  const zone: Zone = {
    ...base,
    spawns: spawns.map((spawn) => ({ ...spawn, respawnSeconds: Infinity })),
    spawnAreas: areas.map((area) => ({ ...area, respawnSeconds: Infinity })),
    nightSpawns: [],
  };
  const spots = [
    ...spawns.map((spawn) => ({ x: spawn.x, z: spawn.z, radius: 0 })),
    ...areas.map((area) => ({ x: area.x, z: area.z, radius: area.radius })),
  ];
  let cx = 0;
  let cz = 0;
  for (const spot of spots) {
    cx += spot.x / spots.length;
    cz += spot.z / spots.length;
  }
  let extent = 0;
  for (const spot of spots) {
    extent = Math.max(extent, Math.hypot(spot.x - cx, spot.z - cz) + spot.radius);
  }
  // The room the world really gives you: a monster follows you until it is `leashRadius` from
  // its own spot and then walks home, so that circle is the ground a player can use to keep
  // his distance. Keeping a simulated mage inside a smaller ring would corner him against a
  // fence that is not there in the game.
  let room = ARENA_MARGIN;
  for (const monsterId of [...spawns.map((s) => s.monster), ...areas.map((a) => a.monster)]) {
    const def = monsters.monsters.find((entry) => entry.id === monsterId);
    room = Math.max(room, def?.ai?.leashRadius ?? ARENA_MARGIN);
  }
  const enemies = new Enemies([zone], monsters, { showRadius: 160, hideMargin: 20 });
  const spot = startSpot(cx, cz, extent, seed);
  return {
    enemies,
    arena: { x: cx, z: cz, radius: extent + room },
    startX: spot.x,
    startZ: spot.z,
    start: () => {},
    step: () => {},
    won: () => !enemies.list.some((e) => e.alive),
    waves: () => 0,
  };
}

interface FightOutcome {
  won: boolean;
  /** Waves cleared (a drill), 0 elsewhere. */
  waves: number;
  seconds: number;
  hpLeft: number;
  damageTaken: number;
  /** The HP this build has (gear and stats in): what the damage taken is measured against. */
  maxHp: number;
}

/**
 * One fight of a simulated player in a scene. The player walks, swings, shoots and takes hits
 * through the real systems; what a robot decides is where to stand and when to attack.
 */
function runFight(bot: SimBot, scene: Scene, maxSeconds = 240): FightOutcome {
  const { enemies, arena } = scene;
  const fighter = makeFighter(bot);
  const c = fighter.c;
  const spell = fighter.spell;
  const status = new StatusEffects(monsters.statusEffects);
  const shots = new Shots();
  const s = new MoverState();
  s.x = scene.startX;
  s.z = scene.startZ;
  s.energy = moveCfg.maxEnergy;
  let damageTaken = 0;
  const target: EnemyTarget = { x: s.x, z: s.z, radius: moveCfg.radius, hostile: true };
  const world: EnemiesWorld = {
    mover: free,
    heightAt: () => 0,
    hitPlayer: (e, damage) => {
      const taken = damageTakenBy(c, damage);
      c.hp -= taken;
      damageTaken += taken;
      c.sinceCombat = 0;
      status.applyAll(e.def);
      leechHeal(e, taken);
    },
    shoot: () => {},
    alive: () => 0,
    alert: (e) => enemies.alert(e),
    bossEvent: () => {},
  } as EnemiesWorld;
  enemies.step(DT, target, world);
  scene.start();

  const cmd: MoveCommand = { x: 0, z: 0, dash: false };
  const swordInput = { fast: false, heavy: false, critRoll: 1 };
  const staffInput: CastInput = { shard: false, spell: false, cast: false, critRoll: 1 };
  const swordOut: SwordResult = {
    landed: 'none',
    damage: 0,
    poiseDamage: 0,
    combo: false,
    crit: false,
  };
  const staffOut: CastResult = {
    fired: 'none',
    shot: null,
    damage: 0,
    charge: 0,
    crit: false,
    effect: 'none',
    incantation: null,
    poiseDamage: 0,
  };
  const staffState = new CastState();
  const castSources: CastSources = { staff: true, spell: null, power: 1, incantation: null };
  let warned = 0;
  // A player does not back off forever in a crowd: dodge a lunge, then hit again.
  let dodgeLeft = 0;
  let holdGround = 0;
  let time = 0;
  for (; time < maxSeconds; time += DT) {
    const totals = status.step(DT);
    if (totals.damage > 0) {
      const taken = damageTakenBy(c, totals.damage);
      c.hp -= taken;
      damageTaken += taken;
    }
    const weaken = weakenFactor(totals.weakenPercent);
    // The nearest monster that can still be hit, and whether anything is winding up at you.
    let near: Enemy | null = null;
    let nearGap = Infinity;
    let threat = false;
    let hunting = true;
    for (const e of enemies.shown) {
      if (!e.hittable) continue;
      const gap = Math.hypot(e.x - s.x, e.z - s.z) - e.radius - moveCfg.radius;
      if (e.dodging && gap < 2.4) threat = true;
      // Something is already coming for you: no need to go looking for it.
      if (e.engaged) hunting = false;
      if (gap < nearGap) {
        nearGap = gap;
        near = e;
      }
    }
    warned = threat ? warned + DT : 0;
    dodgeLeft = Math.max(0, dodgeLeft - DT);
    holdGround = Math.max(0, holdGround - DT);
    if (bot.dodges && threat && warned >= bot.reaction && dodgeLeft <= 0 && holdGround <= 0) {
      dodgeLeft = DODGE_SECONDS;
      holdGround = DODGE_SECONDS + ATTACK_SECONDS;
    }
    cmd.x = 0;
    cmd.z = 0;
    cmd.dash = false;
    swordInput.fast = false;
    staffInput.shard = false;
    staffInput.spell = false;
    if (near) {
      const dx = near.x - s.x;
      const dz = near.z - s.z;
      const d = Math.max(1e-6, Math.hypot(dx, dz));
      const keep = bot.path === 'sword' ? 0 : 5.5;
      if (!bot.dodges) {
        // The button masher: walks straight at the nearest monster and keeps the button down,
        // whatever is winding up around it.
        if (nearGap > (bot.path === 'sword' ? sword.range * 0.75 : 1)) {
          cmd.x = dx / d;
          cmd.z = dz / d;
        }
        swordInput.fast = true;
        staffInput.shard = true;
        staffInput.spell = spell !== null && c.mana >= spell.manaCost;
      } else if (dodgeLeft > 0) {
        // Step out of the jump: sideways, towards the middle of the field, because backing
        // straight up in a ring of monsters only puts you against the fence.
        const toMiddleX = arena.x - s.x;
        const toMiddleZ = arena.z - s.z;
        const side = -dz * toMiddleX + dx * toMiddleZ >= 0 ? 1 : -1;
        const px = (-dz / d) * side;
        const pz = (dx / d) * side;
        const middle = Math.max(1e-6, Math.hypot(toMiddleX, toMiddleZ));
        cmd.x = px * 0.8 + (toMiddleX / middle) * 0.5;
        cmd.z = pz * 0.8 + (toMiddleZ / middle) * 0.5;
        cmd.dash = nearGap < 1.2;
      } else if (bot.path === 'sword') {
        if (nearGap > sword.range * 0.75) {
          cmd.x = dx / d;
          cmd.z = dz / d;
        }
        swordInput.fast = nearGap < sword.range;
      } else if (hunting && nearGap > keep) {
        // In the open world you are the one looking for the fight: walk up until the monster
        // is within reach of your shots, shooting on the way. In a drill the waves come to
        // you, so a mage never has to do this there.
        cmd.x = dx / d;
        cmd.z = dz / d;
        staffInput.shard = true;
        staffInput.spell = spell !== null && c.mana >= spell.manaCost;
      } else {
        // A mage keeps away from everything at once: it walks away from every monster that is
        // too close (the nearer, the harder) and back towards the middle when the fence is
        // behind it. That is what kiting in a ring looks like.
        let awayX = 0;
        let awayZ = 0;
        for (const e of enemies.shown) {
          if (!e.hittable) continue;
          const ex = s.x - e.x;
          const ez = s.z - e.z;
          const gap = Math.max(0.2, Math.hypot(ex, ez) - e.radius - moveCfg.radius);
          if (gap > keep + 2) continue;
          awayX += (ex / Math.max(1e-6, Math.hypot(ex, ez))) * (keep / gap);
          awayZ += (ez / Math.max(1e-6, Math.hypot(ex, ez))) * (keep / gap);
        }
        const edge = Math.hypot(s.x - arena.x, s.z - arena.z);
        if (edge > arena.radius - 2.5) {
          awayX += ((arena.x - s.x) / Math.max(1e-6, edge)) * 2.5;
          awayZ += ((arena.z - s.z) / Math.max(1e-6, edge)) * 2.5;
        }
        const run = Math.hypot(awayX, awayZ);
        if (run > 1e-6) {
          cmd.x = awayX / run;
          cmd.z = awayZ / run;
        }
        // The Shard is free, so it is always on; the spell goes out whenever it is ready.
        staffInput.shard = true;
        staffInput.spell = spell !== null && c.mana >= spell.manaCost;
      }
    }
    if (bot.path === 'sword') {
      if (swordInput.fast && s.dashTime <= 0 && near) {
        // A real player turns the camera towards what they are hitting; aim assist only
        // refines a heading that already points roughly the right way.
        s.heading = headingTo(s.x, s.z, near.x, near.z, s.heading);
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
        s.dashTime > 0 ? { fast: false, heavy: false, critRoll: 1 } : swordInput,
        sword,
        DT,
        swordOut,
      );
      if (swordOut.landed !== 'none') {
        const damage = Math.max(1, Math.round(swordOut.damage * weaken));
        for (const e of enemies.shown) {
          if (!e.hittable) continue;
          if (!inSwingArc(s.x, s.z, s.heading, e.x, e.z, e.radius, sword.range, sword.halfArc)) {
            continue;
          }
          enemies.hit(e, damage);
          c.sinceCombat = 0;
        }
      }
      moveCfg.walkSpeed =
        fighter.walkSpeed *
        (c.heavyWindup > 0 ? sword.heavyMoveFactor : 1) *
        slowFactor(totals.slowPercent);
    } else {
      if ((staffInput.shard || staffInput.spell || staffState.casting) && near && s.dashTime <= 0) {
        s.heading = headingTo(s.x, s.z, near.x, near.z, s.heading);
      }
      // With a staff the world ticks the fight clock itself (a sword does it in stepSword).
      tickCombatClock(c, DT);
      castSources.spell = spell;
      castSources.power = fighter.power;
      stepCast(
        staffState,
        c,
        s,
        s.dashTime > 0 ? { shard: false, spell: false, cast: false, critRoll: 1 } : staffInput,
        staff,
        castSources,
        DT,
        staffOut,
      );
      if (staffOut.shot) {
        shots.fire(
          staffOut.shot,
          s.x,
          s.y + staff.shotHeight,
          s.z,
          s.heading,
          Math.max(1, Math.round(staffOut.damage * weaken)),
          // A mage locks on (fase 3.6), so the shot curves after its target — and lets go
          // again the moment that target jumps at you, which is how shots miss.
          near?.hittable ? near : null,
          staffOut.charge,
          staffOut.crit,
        );
        c.sinceCombat = 0;
      }
      moveCfg.walkSpeed =
        fighter.walkSpeed *
        (staffState.casting ? staff.castMoveFactor : 1) *
        slowFactor(totals.slowPercent);
    }
    stepMovement(s, cmd, moveCfg, DT, free);
    // A real player stays where the fight is (walking off the drill field resets it).
    keepInArena(s, arena, moveCfg.radius);
    regenMana(c, player.regen.manaPerSecond + fighter.effects.manaRegenPerSecond, DT);
    target.x = s.x;
    target.z = s.z;
    enemies.step(DT, target, world);
    shots.step(DT, enemies.shown, freeShots, (hit, shot) => {
      const e = hit as Enemy;
      if (!e.hittable) return;
      enemies.hit(e, shot.damage);
      c.sinceCombat = 0;
    });
    scene.step(DT);
    if (scene.won()) break;
    if (c.hp <= 0) break;
  }
  moveCfg.walkSpeed = BASE_WALK_SPEED;
  return {
    won: scene.won() && c.hp > 0,
    waves: scene.waves(),
    seconds: time,
    hpLeft: Math.max(0, c.hp),
    damageTaken,
    maxHp: c.maxHp,
  };
}

/** One drill run of a path with a simulated player. */
function runDrill(bot: SimBot, seed: number, maxSeconds = 240): FightOutcome {
  return runFight(bot, drillScene(bot.path, seed), maxSeconds);
}

const average = (list: number[]): number =>
  list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);

/** What a fight cost, as a share of the HP the build has (0.5 = half your health). */
function hpCost(results: FightOutcome[]): number {
  return average(results.map((r) => r.damageTaken / Math.max(1, r.maxHp)));
}

function fightSummary(results: FightOutcome[], waves = false): string {
  const wins = results.filter((r) => r.won);
  return (
    `wins ${wins.length}/${results.length} · ` +
    (waves ? `waves ${average(results.map((r) => r.waves)).toFixed(1)}/3 · ` : '') +
    `time ${average(wins.map((r) => r.seconds)).toFixed(0)} s · ` +
    `hp left ${average(wins.map((r) => r.hpLeft)).toFixed(0)} · ` +
    `damage taken ${average(results.map((r) => r.damageTaken)).toFixed(0)} ` +
    `(${(hpCost(results) * 100).toFixed(0)}% of its HP)`
  );
}

/** A normal player: one of the starting spreads from stats.json, plus its levelling points. */
function normal(path: PlayerPath, level: number): SimBot {
  return { path, dodges: true, reaction: 0.3, level, points: build(PRESETS[path], level) };
}

describe('balance: the second Entrance Exam (three waves on the training field)', () => {
  for (const path of PATHS) {
    it(`is usually beaten by a normal ${path} player at level 3-4`, () => {
      const results = SEEDS.flatMap((seed) =>
        [3, 4].map((level) => runDrill(normal(path, level), seed)),
      );
      console.log(`drill, ${path}, level 3-4, plays it properly: ${fightSummary(results, true)}`);
      const wins = results.filter((r) => r.won);
      // "Usually": at least three out of four runs, and never a walkover in a few seconds.
      expect(wins.length).toBeGreaterThanOrEqual(Math.ceil(results.length * 0.75));
      expect(average(wins.map((r) => r.seconds))).toBeGreaterThan(15);
      // And it costs you something: the waves really get through now and then.
      expect(average(results.map((r) => r.damageTaken))).toBeGreaterThan(8);
    });

    it(`is ${path === 'sword' ? 'brute-forced' : 'lost'} by a ${path} player who only mashes`, () => {
      const masher = SEEDS.map((seed) =>
        runDrill({ ...normal(path, 3), dodges: false, reaction: 0 }, seed),
      );
      const careful = SEEDS.map((seed) => runDrill(normal(path, 3), seed));
      console.log(`drill, ${path}, button masher: ${fightSummary(masher, true)}`);
      const wins = (list: FightOutcome[]) => list.filter((r) => r.won).length;
      if (path === 'sword') {
        // Measured again in 3.10.1 (open vraag 16): a sword fighter does not just get through
        // the drill by holding the button down — it is his *best* way through it. One swing
        // hits the whole ring, so killing faster means fewer lunges ever land. Slimes alone
        // are no wall for a sword; it takes another kind of monster to make him fail.
        expect(wins(masher)).toBe(SEEDS.length);
        expect(average(masher.map((r) => r.damageTaken))).toBeLessThan(
          average(careful.map((r) => r.damageTaken)) * 1.5,
        );
      } else {
        // A mage who stands between the monsters does not come out: distance is the lesson.
        expect(wins(masher)).toBe(0);
        expect(average(masher.map((r) => r.damageTaken))).toBeGreaterThan(
          average(careful.map((r) => r.damageTaken)),
        );
      }
    });
  }

  it('makes every wave heavier than the one before it', () => {
    const hpOf = (id: string): number =>
      monsters.monsters.find((entry) => entry.id === id)?.hp ?? 0;
    for (const fight of questsFile.waveFights) {
      let previous = 0;
      for (const wave of fight.waves) {
        const hp = wave.monsters.reduce(
          (sum, entry) => sum + hpOf(entry.monsters[0] as string) * entry.count,
          0,
        );
        expect(hp).toBeGreaterThan(previous);
        previous = hp;
      }
    }
  });
});

/**
 * The third Entrance Exam (fase 3.8): four goblins and four green slimes in the Greenwood.
 * The simulated player fights the real spawns from zones.json — the goblin trail (two packs,
 * five goblins, about 27 m apart) and the western slime meadow (five slimes spread over some
 * 20 m) — so the monsters, their numbers and their spots are the ones a player walks into.
 */
const GOBLIN_TRAIL = ['goblin_trail'];
const SLIME_MEADOW = ['slime_meadow_west'];
/** The first mini-boss on the way east (fase 3.9): Mossback, 450 HP, in the Greenwood. */
const MOSSBACK = ['mossback_lair'];
/** What one hit of Mossback does (monsters.json): the price of a quick win, see `neverFree`. */
const MOSSBACK_HIT = monsters.monsters.find((entry) => entry.id === 'mossback')?.damage.max ?? 0;

/**
 * The rule the content of fase 3 is held to: a fight may be short or it may be safe, but
 * never both. Either it takes real time, or the monster lands real hits on the way down — a
 * sword fighter trades (Mossback is down in ten seconds and takes half of him with it), a
 * mage pays in time instead because he never lets it near him. Nothing is simply walked over.
 */
function neverFree(results: FightOutcome[], hit: number): boolean {
  const wins = results.filter((r) => r.won);
  if (wins.length === 0) return true;
  return (
    average(wins.map((r) => r.seconds)) > 15 || average(results.map((r) => r.damageTaken)) >= hit
  );
}

describe('balance: the third Entrance Exam (the Greenwood)', () => {
  for (const path of PATHS) {
    it(`lets a normal ${path} player clear the goblin trail and the slime meadow`, () => {
      const goblins = SEEDS.flatMap((seed) =>
        [4, 5].map((level) =>
          runFight(normal(path, level), worldScene('greenwood', GOBLIN_TRAIL, seed)),
        ),
      );
      const slimes = SEEDS.flatMap((seed) =>
        [4, 5].map((level) =>
          runFight(normal(path, level), worldScene('greenwood', SLIME_MEADOW, seed)),
        ),
      );
      console.log(`greenwood goblins, ${path}, level 4-5: ${fightSummary(goblins)}`);
      console.log(`greenwood slimes, ${path}, level 4-5: ${fightSummary(slimes)}`);
      // The third exam is doable for every path at the level the exams bring you to, and it
      // is not over in a blink: two goblin packs and a meadow of slimes have to be walked up
      // to and worn down pack by pack.
      expect(goblins.filter((r) => r.won).length).toBeGreaterThanOrEqual(
        Math.ceil(goblins.length * 0.75),
      );
      expect(slimes.filter((r) => r.won).length).toBeGreaterThanOrEqual(
        Math.ceil(slimes.length * 0.75),
      );
      expect(average(goblins.map((r) => r.seconds))).toBeGreaterThan(5);
      // And the goblins are the half that bites: unlike the slimes, they get through.
      expect(average(goblins.map((r) => r.damageTaken))).toBeGreaterThan(
        average(slimes.map((r) => r.damageTaken)),
      );
    });
  }
});

describe('balance: the first mini-boss (Mossback in the Greenwood)', () => {
  for (const path of PATHS) {
    it(`is a real fight for a normal ${path} player at level 5-6`, () => {
      const results = SEEDS.flatMap((seed) =>
        [5, 6].map((level) =>
          runFight(normal(path, level), worldScene('greenwood', MOSSBACK, seed), 300),
        ),
      );
      console.log(`mossback, ${path}, level 5-6: ${fightSummary(results)}`);
      const wins = results.filter((r) => r.won);
      // A mini-boss is a step up from the exams, not a wall: every path gets through it.
      expect(wins.length).toBeGreaterThanOrEqual(Math.ceil(results.length * 0.5));
      // And it is never free (see `neverFree`). The numbers themselves, and the open question
      // whether Mossback should simply have more HP, are in docs/PROGRESS.md.
      expect(neverFree(results, MOSSBACK_HIT), `mossback is free for a ${path} player`).toBe(true);
    });
  }
});

/**
 * Extreme builds (fase 3.7, measured again in 3.10.1): everything in one stat, on all three
 * paths. The point is not that they are good, but that none of them breaks the balance —
 * nothing walks over the content of fase 3, and nothing is stuck with no way forward.
 */
describe('balance: extreme builds on the content of fase 3', () => {
  /** Everything in one stat: two that help a build and two that do nothing for its path. */
  const EXTREMES = ['hp', 'strength', 'power', 'magic_power'] as const;
  /** Level 5: your pad, your gear and your three exams done, the city gate just opened. */
  const LEVEL = 5;
  const extreme = (statId: string, level: number): StatPoints =>
    normalizeStatPoints(stats, { [statId]: pointBudget(stats, level) }, level);
  const bot = (path: PlayerPath, statId: string): SimBot => ({
    path,
    dodges: true,
    reaction: 0.3,
    level: LEVEL,
    points: extreme(statId, LEVEL),
  });

  /** One extreme build measured on both: its second exam and the first mini-boss. */
  interface Row {
    path: PlayerPath;
    statId: string;
    drill: FightOutcome[];
    miniBoss: FightOutcome[];
  }

  const rows: Row[] = [];
  beforeAll(() => {
    for (const path of PATHS) {
      for (const statId of EXTREMES) {
        rows.push({
          path,
          statId,
          drill: SEEDS.map((seed) => runDrill(bot(path, statId), seed)),
          miniBoss: SEEDS.map((seed) =>
            runFight(bot(path, statId), worldScene('greenwood', MOSSBACK, seed), 300),
          ),
        });
      }
    }
    for (const row of rows) {
      console.log(
        `all ${row.statId}, ${row.path}, level ${LEVEL}: ` +
          `exam 2 ${fightSummary(row.drill, true)} | ` +
          `mossback ${fightSummary(row.miniBoss)}`,
      );
    }
  });

  it('leaves every build a way forward: its second exam is never a wall', () => {
    for (const row of rows) {
      expect(
        row.drill.filter((r) => r.won).length,
        `all ${row.statId}, ${row.path} cannot clear its second exam`,
      ).toBeGreaterThan(0);
    }
  });

  it('gives no build a free pass: the first mini-boss is never free', () => {
    for (const row of rows) {
      // The same rule as for a normal build: short or safe, never both.
      expect(
        neverFree(row.miniBoss, MOSSBACK_HIT),
        `all ${row.statId}, ${row.path} walks over Mossback for free`,
      ).toBe(true);
    }
  });
});
