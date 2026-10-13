import { describe, expect, it } from 'vitest';
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
  type StaffInput,
  type StaffResult,
  StaffState,
  staffConfig,
  stepStaff,
} from './StaffCombat';
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

/**
 * The second Entrance Exam (fase 3.8): three waves of slimes on the Academy training field,
 * run with the real wave code, the real enemy AI and the real status effects. The point of the
 * check is the same as for Sultan: a normal player should usually get through it, and someone
 * who only mashes the attack button should not.
 */

const questsFile = questsFileSchema.parse(readPublicJson('data/quests.json'));
const items = itemsFileSchema.parse(readPublicJson('data/items.json')) as ItemsFile;
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
const skills = skillsFileSchema.parse(readPublicJson('data/skills.json')) as SkillsFile;
const staff = staffConfig(player, spells);
const itemsById = new Map(items.items.map((item) => [item.id, item]));
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

const freeShots = { heightAt: () => 0, blocked: () => false };
/** Seconds a simulated player steps away from a lunge, and how long it then holds its ground. */
const DODGE_SECONDS = 0.5;
const ATTACK_SECONDS = 0.8;

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

interface DrillBot {
  path: PlayerPath;
  /** Keeps its distance from a slime that is winding up (false: only walks in and hits). */
  dodges: boolean;
  /** Seconds before reacting to a warning. */
  reaction: number;
  level: number;
  points: StatPoints;
}

interface DrillResult {
  won: boolean;
  waves: number;
  seconds: number;
  hpLeft: number;
  damageTaken: number;
}

/**
 * One run of a path's drill with a simulated player. Walking, fighting, status effects and the
 * waves are all the real code; only the decisions are a robot's.
 */
function runDrill(bot: DrillBot, seed: number, maxSeconds = 240): DrillResult {
  const def = waveFight(DRILLS[bot.path]);
  const field = trainingField();
  const box = shapeBounds(field, emptyBox());
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const enemies = new Enemies(
    fieldOnly(),
    monsters,
    { showRadius: 160, hideMargin: 20 },
    new Map([['academy_training_field', field]]),
    null,
    seed,
    [def],
  );
  const status = new StatusEffects(monsters.statusEffects);
  const shots = new Shots();

  // The build, the weapon and the path, exactly as the world puts them together.
  const c = new CombatState();
  const effects = emptyStatEffects();
  computeStatEffects(stats, bot.points, bot.path, effects);
  const pathBonus = applyPath(player, skills, stats, bot.path, effects);
  const weapon = itemsById.get(WEAPONS[bot.path]);
  const gear = gearStats({ weapon: weapon?.id ?? '' }, itemsById, emptyGearStats());
  c.weaponBonus = weapon?.weapon?.damageBonus ?? 0;
  c.gearHp = gear.hp;
  c.gearMana = gear.mana;
  c.damageFactor = 1 + gear.damagePercent / 100;
  applyStatsToCombat(stats, effects, c, gear.damageReductionPercent);
  c.hasMana = pathBonus.hasMana;
  applyStats(c, player, bot.level);
  c.hp = c.maxHp;
  c.mana = c.maxMana;
  const spellId = SPELLS[bot.path];
  const spell = spellId ? (staff.spells.get(spellId) ?? null) : null;
  const power = powerFactor(spells.powerCurves, bot.path, bot.level);

  const arena: Arena = { x: cx, z: cz, radius: field.type === 'circle' ? field.radius : 9 };
  const s = new MoverState();
  s.x = cx;
  s.z = cz;
  s.energy = moveCfg.maxEnergy;
  const walkSpeed = moveCfg.walkSpeed * (1 + effects.moveSpeedPercent / 100);
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

  let won = false;
  let cleared = 0;
  const fight = new WaveFight(def, {
    alive: () => enemies.waveAlive(def.id),
    spawnWave: (index) => void enemies.spawnWave(def.id, index, cx, cz, def.spawnRadius),
    clear: () => enemies.clearWave(def.id),
    // The robot never walks off the field (it is clamped to it below).
    inArea: () => true,
    say: () => {},
    waveCleared: () => cleared++,
    finished: () => {
      won = true;
    },
    reset: () => {},
  });
  enemies.step(DT, target, world);
  fight.start();

  const cmd: MoveCommand = { x: 0, z: 0, dash: false };
  const swordInput = { fast: false, heavy: false, critRoll: 1 };
  const staffInput: StaffInput = { shard: false, spell: false, critRoll: 1 };
  const swordOut: SwordResult = { landed: 'none', damage: 0, combo: false, crit: false };
  const staffOut: StaffResult = { fired: 'none', shot: null, damage: 0, charge: 0, crit: false };
  const staffState = new StaffState();
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
    // The nearest slime that can still be hit.
    let near: Enemy | null = null;
    let nearGap = Infinity;
    let threat = false;
    for (const e of enemies.shown) {
      if (!e.hittable) continue;
      const gap = Math.hypot(e.x - s.x, e.z - s.z) - e.radius - moveCfg.radius;
      if (e.dodging && gap < 2.4) threat = true;
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
        // The button masher: walks straight at the nearest slime and keeps the button down,
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
        // straight up in a ring of slimes only puts you against the fence.
        const toMiddleX = cx - s.x;
        const toMiddleZ = cz - s.z;
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
      } else {
        // A mage keeps away from everything at once: it walks away from every slime that is
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
        const edge = Math.hypot(s.x - cx, s.z - cz);
        if (edge > arena.radius - 2.5) {
          awayX += ((cx - s.x) / Math.max(1e-6, edge)) * 2.5;
          awayZ += ((cz - s.z) / Math.max(1e-6, edge)) * 2.5;
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
        walkSpeed *
        (c.heavyWindup > 0 ? sword.heavyMoveFactor : 1) *
        slowFactor(totals.slowPercent);
    } else {
      if ((staffInput.shard || staffInput.spell || staffState.casting) && near && s.dashTime <= 0) {
        s.heading = headingTo(s.x, s.z, near.x, near.z, s.heading);
      }
      stepStaff(
        staffState,
        c,
        s.dashTime > 0 ? { shard: false, spell: false, critRoll: 1 } : staffInput,
        staff,
        spell,
        power,
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
        walkSpeed *
        (staffState.casting ? staff.castMoveFactor : 1) *
        slowFactor(totals.slowPercent);
    }
    stepMovement(s, cmd, moveCfg, DT, free);
    // A real player stays on the field (walking off it resets the drill, see WaveFight).
    keepInArena(s, arena, moveCfg.radius);
    regenMana(c, player.regen.manaPerSecond + effects.manaRegenPerSecond, DT);
    target.x = s.x;
    target.z = s.z;
    enemies.step(DT, target, world);
    shots.step(DT, enemies.shown, freeShots, (hit, shot) => {
      const e = hit as Enemy;
      if (!e.hittable) return;
      enemies.hit(e, shot.damage);
      c.sinceCombat = 0;
    });
    fight.step(DT);
    if (won) break;
    if (c.hp <= 0) break;
  }
  moveCfg.walkSpeed = movementConfig(player).walkSpeed;
  return { won, waves: cleared, seconds: time, hpLeft: Math.max(0, c.hp), damageTaken };
}

function drillSummary(results: DrillResult[]): string {
  const wins = results.filter((r) => r.won);
  const avg = (list: number[]) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
  return (
    `wins ${wins.length}/${results.length} · ` +
    `waves ${avg(results.map((r) => r.waves)).toFixed(1)}/3 · ` +
    `time ${avg(wins.map((r) => r.seconds)).toFixed(0)} s · ` +
    `hp left ${avg(wins.map((r) => r.hpLeft)).toFixed(0)} · ` +
    `damage taken ${avg(results.map((r) => r.damageTaken)).toFixed(0)}`
  );
}

describe('balance: the second Entrance Exam (three waves on the training field)', () => {
  /** A normal player: level 3 or 4, one of the starting spreads from stats.json. */
  const normal = (path: PlayerPath, level: number): DrillBot => ({
    path,
    dodges: true,
    reaction: 0.3,
    level,
    points: build(
      path === 'sword' ? 'sword_fighter' : path === 'light' ? 'light_mage' : 'dark_mage',
      level,
    ),
  });

  const average = (list: number[]): number =>
    list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);

  for (const path of ['sword', 'light', 'dark'] as const) {
    it(`is usually beaten by a normal ${path} player at level 3-4`, () => {
      const results = SEEDS.flatMap((seed) =>
        [3, 4].map((level) => runDrill(normal(path, level), seed)),
      );
      console.log(`drill, ${path}, level 3-4, plays it properly: ${drillSummary(results)}`);
      const wins = results.filter((r) => r.won);
      // "Usually": at least three out of four runs, and never a walkover in a few seconds.
      expect(wins.length).toBeGreaterThanOrEqual(Math.ceil(results.length * 0.75));
      expect(average(wins.map((r) => r.seconds))).toBeGreaterThan(15);
      // And it costs you something: the waves really get through now and then.
      expect(average(results.map((r) => r.damageTaken))).toBeGreaterThan(8);
    });

    it(`punishes a ${path} player who only mashes the attack button`, () => {
      const masher = SEEDS.map((seed) =>
        runDrill({ ...normal(path, 3), dodges: false, reaction: 0 }, seed),
      );
      const careful = SEEDS.map((seed) => runDrill(normal(path, 3), seed));
      console.log(`drill, ${path}, button masher: ${drillSummary(masher)}`);
      const wins = (list: DrillResult[]) => list.filter((r) => r.won).length;
      const damage = (list: DrillResult[]) => average(list.map((r) => r.damageTaken));
      const hpLeft = (list: DrillResult[]) => average(list.map((r) => r.hpLeft));
      // Walking into the ring and holding the button down always costs clearly more.
      expect(damage(masher)).toBeGreaterThan(damage(careful));
      if (path === 'sword') {
        // A sword fighter can brute-force a field of slimes (his swing hits all of them at
        // once), but he comes out of it with clearly less left than someone who steps out of
        // the lunges. Slimes are simply no wall for a sword: see docs/PROGRESS.md.
        expect(hpLeft(masher)).toBeLessThan(hpLeft(careful));
      } else {
        // A mage who stands between the slimes does not come out: distance is the lesson.
        expect(wins(masher)).toBe(0);
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
