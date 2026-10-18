import type { Enemy } from '../entities/Enemy';
import type { MonsterDef } from '../data/types';
import { angleDelta, type Mover } from './Movement';
import { turnTowards } from './NpcBehavior';
import type { EnemyTarget } from './EnemyAI';

const DEG = Math.PI / 180;
/** A swipe hits in this half arc in front of the boss (plus the player's width). */
const SWIPE_HALF_ARC = 70 * DEG;
/** While circling between attacks the boss walks sideways at this fraction of its speed. */
const CIRCLE_FACTOR = 0.35;
/** Backing off (too close for the next attack) at this fraction of its speed. */
const BACK_OFF_FACTOR = 0.8;
/** No attack in range this long (s) past the pause: switch to one that fits the gap now. */
const GIVE_UP_EXTRA_SECONDS = 2;
/** A pounce stops this far (m) before your body, so the two do not overlap. */
const POUNCE_CONTACT = 0.1;
/** The leap back to its last stand flies this fast (m/s), so a long leap takes longer. */
const LAST_STAND_LEAP_SPEED = 18;

/**
 * Phases count whole fixed steps: a timer that float rounding leaves a hair above zero must not
 * buy one extra step (same idea as EnemyAI), so 60 and 120 Hz agree.
 */
const PHASE_EPSILON = 1e-9;
/** Hit window (s) of a swipe or a landing when the data does not say (monsters.json `hitSeconds`). */
const DEFAULT_HIT_SECONDS = 0.1;

export type BossAttack = NonNullable<MonsterDef['attacks']>[number];
export type BossDef = NonNullable<MonsterDef['boss']>;

/**
 * What a boss is doing:
 * - `stalk`: circling and closing in (or backing off) until the next attack is in range,
 * - `telegraph`: the warning (claws glow, a crouch with golden eyes, a red line on the ground),
 * - `attack`: the swipes, the leap or the run,
 * - `retreat`: a leap away after the attack,
 * - `opening`: standing still for a moment: the only time it can be hit,
 * - `idle`: the player is down (or switched off in the cheat menu): waits, guarded.
 */
export type BossPhase = 'idle' | 'stalk' | 'telegraph' | 'attack' | 'retreat' | 'opening';

/** Things the fight scene shows: a warning starts (hints), an opening, the boss gets faster. */
export type BossEventKind = 'telegraph' | 'opening' | 'enraged';

/** What a boss does to the world: walking (with collision), hurting the player, events. */
export interface BossWorld {
  mover: Mover;
  hitPlayer(e: Enemy, damage: number): void;
  bossEvent(e: Enemy, kind: BossEventKind, attack: BossAttack | null): void;
}

/** The ring the fight happens in (neither the boss nor the player can leave it). */
export interface Arena {
  x: number;
  z: number;
  radius: number;
}

/** Simulation state of one boss (on Enemy.boss). Reused between fights; reset by `start`. */
export class BossState {
  phase: BossPhase = 'idle';
  /** Seconds spent in the current phase. */
  elapsed = 0;
  /** How long the current stalk pause lasts (rolled), or the current phase's length. */
  duration = 0;
  /** The attack being prepared or done (chosen when the stalk starts). */
  attack: BossAttack | null = null;
  lastAttack: BossAttack | null = null;
  /** Attacks done this fight (Flurry comes every n-th once enraged). */
  attacksDone = 0;
  /** Combo: swipes still to come, seconds until the next one, swipes done (drawing). */
  hitsLeft = 0;
  hitTimer = 0;
  swipes = 0;
  /** The current swipe, landing or run already hit the player (one hit per window). */
  struck = false;
  /**
   * True while a hit window is open (a swipe, the landing of a pounce, the run of a charge):
   * the only time the boss can hurt you. Announcement and recovery are never `hitting`.
   */
  hitting = false;
  /** Seconds left of the open hit window of a swipe or landing (counted in whole steps). */
  windowLeft = 0;
  /** A pounce has landed (its hit window runs). */
  landed = false;
  /** Below the enrage HP: faster, and Flurry joins its attacks. */
  enraged = false;
  /** Pounce aim is fixed (the last moment of the warning). */
  aimed = false;
  /** Start and end of a leap, pounce or charge; the charge direction. */
  fromX = 0;
  fromZ = 0;
  toX = 0;
  toZ = 0;
  dirX = 0;
  dirZ = 1;
  /** Circling direction between attacks (+1 or -1). */
  circle = 1;

  constructor(
    readonly def: BossDef,
    readonly arena: Arena,
  ) {}

  /** 0–1 through a leap, pounce or charge (drawing: the jump arc). */
  get travel(): number {
    return this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 1;
  }

  /** Speed multiplier (enraged: `enrage.speedFactor`). */
  speedFactor(monster: MonsterDef): number {
    return this.enraged ? (monster.enrage?.speedFactor ?? 1) : 1;
  }
}

/** Puts a boss into its fight: at `start`, full HP, guarded, choosing its first attack. */
export function startBoss(e: Enemy, heading: number): void {
  const boss = e.boss;
  if (!boss) return;
  e.spawn(boss.def.start.x, boss.def.start.z, heading);
  e.mode = 'chase';
  e.guarded = true;
  boss.attacksDone = 0;
  boss.lastAttack = null;
  boss.enraged = false;
  boss.swipes = 0;
  boss.hitting = false;
  boss.windowLeft = 0;
  boss.landed = false;
  beginStalk(e, boss);
}

/**
 * One fixed step of a boss fight (Sultan). Allocation-free; the same at 60 and 120 Hz.
 * Pattern: stalk → telegraph (a clear warning) → attack → leap away → opening (it stands still
 * and can be hit) → stalk … Below `enrage.belowHpFraction` it gets faster and adds Flurry.
 */
export function stepBoss(e: Enemy, target: EnemyTarget, world: BossWorld, dt: number): void {
  const boss = e.boss;
  if (!boss || !e.active) return;
  if (e.mode === 'dead') {
    e.timer -= dt;
    if (e.timer <= 0) e.active = false;
    return;
  }
  const enrage = e.def.enrage;
  if (!boss.enraged && enrage && e.hp < e.maxHp * enrage.belowHpFraction) {
    boss.enraged = true;
    world.bossEvent(e, 'enraged', null);
  }
  if (!target.hostile) {
    // The player is down: it stops (an attack in the air still lands somewhere).
    if (boss.phase !== 'idle') {
      boss.phase = 'idle';
      boss.hitting = false;
      e.guarded = true;
    }
    return;
  }
  if (boss.phase === 'idle') beginStalk(e, boss);
  boss.elapsed += dt;
  switch (boss.phase) {
    case 'stalk':
      stalk(e, boss, target, world, dt);
      break;
    case 'telegraph':
      telegraph(e, boss, target, dt);
      break;
    case 'attack':
      attack(e, boss, target, world, dt);
      break;
    case 'retreat':
      if (travelTo(e, boss, world.mover)) beginOpening(e, boss, world);
      break;
    case 'opening':
      // Catching its breath: it only turns to watch you.
      turnTo(e, target.x, target.z, boss.def.turnDegreesPerSecond.recovery, dt);
      if (boss.duration - boss.elapsed <= PHASE_EPSILON) {
        e.guarded = true;
        beginStalk(e, boss);
      }
      break;
  }
}

/** Picks the next attack: Flurry every n-th once enraged, otherwise a different one each time. */
export function chooseAttack(e: Enemy, boss: BossState): BossAttack | null {
  const attacks = e.def.attacks;
  if (!attacks || attacks.length === 0) return null;
  const next = boss.attacksDone + 1;
  if (boss.enraged) {
    for (let i = 0; i < attacks.length; i++) {
      const a = attacks[i] as BossAttack;
      if (a.onlyWhenEnraged && a.everyNth && next % a.everyNth === 0) return a;
    }
  }
  let count = 0;
  for (let i = 0; i < attacks.length; i++) {
    const a = attacks[i] as BossAttack;
    if (!a.onlyWhenEnraged && a !== boss.lastAttack) count++;
  }
  if (count === 0) return boss.lastAttack;
  let pick = Math.floor(e.rng.next() * count);
  for (let i = 0; i < attacks.length; i++) {
    const a = attacks[i] as BossAttack;
    if (a.onlyWhenEnraged || a === boss.lastAttack) continue;
    if (pick-- === 0) return a;
  }
  return null;
}

function beginStalk(e: Enemy, boss: BossState): void {
  boss.phase = 'stalk';
  boss.elapsed = 0;
  const [min, max] = boss.def.pauseSeconds;
  boss.duration = (min + (max - min) * e.rng.next()) / boss.speedFactor(e.def);
  boss.attack = chooseAttack(e, boss);
  boss.circle = e.rng.next() < 0.5 ? -1 : 1;
  e.mode = 'chase';
}

function stalk(e: Enemy, boss: BossState, target: EnemyTarget, world: BossWorld, dt: number): void {
  const a = boss.attack;
  if (!a) return;
  const dx = target.x - e.x;
  const dz = target.z - e.z;
  const d = Math.max(1e-6, Math.hypot(dx, dz));
  const gap = d - target.radius - e.radius;
  const speed = e.speed * boss.speedFactor(e.def);
  const minGap = a.minGap ?? 0;
  const maxGap = a.maxGap ?? 2;
  const inRange = gap >= minGap && gap <= maxGap;
  let mx: number;
  let mz: number;
  if (gap > maxGap) {
    mx = (dx / d) * speed;
    mz = (dz / d) * speed;
  } else if (gap < minGap) {
    mx = (-dx / d) * speed * BACK_OFF_FACTOR;
    mz = (-dz / d) * speed * BACK_OFF_FACTOR;
  } else {
    // Circling sideways around you, like a cat waiting for its moment.
    mx = (dz / d) * speed * CIRCLE_FACTOR * boss.circle;
    mz = (-dx / d) * speed * CIRCLE_FACTOR * boss.circle;
  }
  move(e, boss, world.mover, mx * dt, mz * dt);
  turnTo(e, target.x, target.z, boss.def.turnDegreesPerSecond.stalk, dt);
  if (inRange && boss.duration - boss.elapsed <= PHASE_EPSILON) {
    beginTelegraph(e, boss, target, world);
  } else if (gap < minGap && boss.elapsed >= boss.duration + GIVE_UP_EXTRA_SECONDS) {
    // Cannot back off far enough (you stay glued to him): switch to an attack that fits the
    // gap now. (Running away does not work: he is faster than you.)
    boss.attack = attackForGap(e, gap) ?? boss.attack;
    boss.elapsed = boss.duration;
  }
}

function beginTelegraph(e: Enemy, boss: BossState, target: EnemyTarget, world: BossWorld): void {
  const a = boss.attack;
  if (!a) return;
  boss.phase = 'telegraph';
  boss.elapsed = 0;
  boss.duration = a.warningSeconds;
  boss.aimed = false;
  boss.hitting = false;
  e.mode = 'windup';
  if (a.pattern === 'charge') {
    // The red line is fixed from the start: step off it.
    aimAt(boss, e, target.x, target.z);
    const length = a.length ?? 10;
    boss.fromX = e.x;
    boss.fromZ = e.z;
    clampEnd(e, boss, e.x + boss.dirX * length, e.z + boss.dirZ * length);
  }
  world.bossEvent(e, 'telegraph', a);
}

function telegraph(e: Enemy, boss: BossState, target: EnemyTarget, dt: number): void {
  const a = boss.attack;
  if (!a) return;
  const rate = boss.def.turnDegreesPerSecond.telegraph;
  if (a.pattern !== 'charge' && !boss.aimed) turnTo(e, target.x, target.z, rate, dt);
  else e.heading = turnTowards(e.heading, Math.atan2(boss.dirX, boss.dirZ), rate * DEG * dt);
  if (
    a.pattern === 'pounce' &&
    !boss.aimed &&
    boss.duration - boss.elapsed <= (a.aimLockSeconds ?? 0)
  ) {
    // From here on the leap goes to where you are now: dash sideways to dodge.
    boss.aimed = true;
    aimAt(boss, e, target.x, target.z);
    const d = Math.hypot(target.x - e.x, target.z - e.z);
    const stop = Math.max(0, d - target.radius - e.radius - POUNCE_CONTACT);
    boss.fromX = e.x;
    boss.fromZ = e.z;
    clampEnd(e, boss, e.x + boss.dirX * stop, e.z + boss.dirZ * stop);
  }
  if (boss.duration - boss.elapsed > PHASE_EPSILON) return;
  boss.phase = 'attack';
  boss.elapsed = 0;
  boss.struck = false;
  boss.landed = false;
  boss.windowLeft = 0;
  e.mode = 'strike';
  switch (a.pattern) {
    case 'combo':
      boss.duration = 0;
      boss.hitsLeft =
        a.minHits !== undefined
          ? a.minHits + Math.floor(e.rng.next() * (a.hits - a.minHits + 1))
          : a.hits;
      boss.hitTimer = 0;
      break;
    case 'pounce':
    case 'charge':
      boss.duration = a.travelSeconds ?? 0.4;
      break;
    default:
      boss.duration = 0;
      boss.hitsLeft = a.hits;
  }
}

function attack(
  e: Enemy,
  boss: BossState,
  target: EnemyTarget,
  world: BossWorld,
  dt: number,
): void {
  const a = boss.attack;
  if (!a) return;
  // The hit window turns slowly (or not at all): walk round him. A pounce or run keeps to its line.
  const rate = boss.def.turnDegreesPerSecond.attack;
  if (a.pattern === 'pounce' || a.pattern === 'charge') {
    e.heading = turnTowards(e.heading, Math.atan2(boss.dirX, boss.dirZ), rate * DEG * dt);
  } else {
    turnTo(e, target.x, target.z, rate, dt);
  }
  if (a.pattern === 'pounce') {
    // The leap itself hurts nobody; the hit window is the landing (`hitSeconds`).
    if (!boss.landed) {
      if (!travelTo(e, boss, world.mover)) return;
      boss.landed = true;
      boss.windowLeft = a.hitSeconds ?? DEFAULT_HIT_SECONDS;
    } else {
      boss.windowLeft -= dt;
    }
    if (boss.windowLeft <= PHASE_EPSILON) {
      finishAttack(e, boss, target);
      return;
    }
    boss.hitting = true;
    const gap = Math.hypot(target.x - e.x, target.z - e.z) - target.radius - e.radius;
    if (!boss.struck && gap <= (a.reach ?? 1)) {
      boss.struck = true;
      world.hitPlayer(e, a.damage);
    }
    return;
  }
  if (a.pattern === 'charge') {
    // The whole run is the hit window.
    boss.hitting = true;
    const fromX = e.x;
    const fromZ = e.z;
    const done = travelTo(e, boss, world.mover);
    if (!boss.struck) {
      // Did the run pass through you this step?
      const reach = (a.width ?? 1) / 2 + target.radius;
      if (segmentDistance(target.x, target.z, fromX, fromZ, e.x, e.z) <= reach) {
        boss.struck = true;
        world.hitPlayer(e, a.damage);
      }
    }
    if (done) finishAttack(e, boss, target);
    return;
  }
  // Combo (Claw Combo, Flurry): swipes in a row, each a small step towards you. Every swipe has
  // its own hit window (`hitSeconds`) in which it hurts once; between swipes nothing does.
  boss.hitTimer -= dt;
  if (boss.windowLeft > 0) {
    boss.windowLeft -= dt;
    if (boss.windowLeft <= PHASE_EPSILON) {
      boss.windowLeft = 0;
      boss.hitting = false;
    } else if (!boss.struck && swipeReaches(e, a, target)) {
      boss.struck = true;
      world.hitPlayer(e, a.damage);
    }
  }
  if (boss.hitTimer > 0) return;
  if (boss.hitsLeft <= 0) {
    finishAttack(e, boss, target);
    return;
  }
  boss.hitsLeft--;
  boss.swipes++;
  boss.hitTimer = (a.hitIntervalSeconds ?? 0.35) / boss.speedFactor(e.def);
  const dx = target.x - e.x;
  const dz = target.z - e.z;
  const step = a.stepPerHit ?? 0;
  const d = Math.hypot(dx, dz);
  const room = Math.max(0, d - target.radius - e.radius - POUNCE_CONTACT);
  const forward = Math.min(step, room);
  if (forward > 0)
    move(e, boss, world.mover, Math.sin(e.heading) * forward, Math.cos(e.heading) * forward);
  boss.windowLeft = a.hitSeconds ?? DEFAULT_HIT_SECONDS;
  boss.hitting = true;
  boss.struck = false;
  if (swipeReaches(e, a, target)) {
    boss.struck = true;
    world.hitPlayer(e, a.damage);
  }
}

/** Is the player inside the arc and reach of a swipe right now? */
function swipeReaches(e: Enemy, a: BossAttack, target: EnemyTarget): boolean {
  const dx = target.x - e.x;
  const dz = target.z - e.z;
  const gap = Math.hypot(dx, dz) - target.radius - e.radius;
  const delta = Math.abs(angleDelta(e.heading, Math.atan2(dx, dz)));
  const d = Math.hypot(dx, dz);
  const widen = d > 1e-6 ? Math.asin(Math.min(1, target.radius / d)) : Math.PI;
  return gap <= (a.reach ?? 1) && delta <= SWIPE_HALF_ARC + widen;
}

/** After an attack: leap away from you, landing `retreatGap` m from you. */
function finishAttack(e: Enemy, boss: BossState, target: EnemyTarget): void {
  boss.lastAttack = boss.attack;
  boss.hitting = false;
  boss.windowLeft = 0;
  boss.attacksDone++;
  boss.phase = 'retreat';
  boss.elapsed = 0;
  boss.duration = boss.def.retreatSeconds;
  e.mode = 'recover';
  let dx = e.x - target.x;
  let dz = e.z - target.z;
  let d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    dx = -Math.sin(e.heading);
    dz = -Math.cos(e.heading);
    d = 1;
  }
  boss.fromX = e.x;
  boss.fromZ = e.z;
  // Cornered: low on HP it leaps back to its last stand (its back to the wall), wherever you are.
  const stand = boss.def.lastStand;
  if (stand && e.hp < e.maxHp * stand.belowHpFraction) {
    const far = Math.hypot(stand.x - e.x, stand.z - e.z);
    boss.duration = Math.max(boss.def.retreatSeconds, far / LAST_STAND_LEAP_SPEED);
    clampEnd(e, boss, stand.x, stand.z);
    return;
  }
  const away = boss.def.retreatGap + target.radius + e.radius;
  clampEnd(e, boss, target.x + (dx / d) * away, target.z + (dz / d) * away);
}

function beginOpening(e: Enemy, boss: BossState, world: BossWorld): void {
  const a = boss.lastAttack;
  boss.phase = 'opening';
  boss.elapsed = 0;
  boss.duration = a?.recoverySeconds ?? boss.def.vulnerableSeconds;
  e.mode = 'idle';
  e.guarded = false;
  world.bossEvent(e, 'opening', a);
}

/** Moves along from → to over `duration`; returns true when it arrived. */
function travelTo(e: Enemy, boss: BossState, mover: Mover): boolean {
  const t = boss.travel;
  const x = boss.fromX + (boss.toX - boss.fromX) * t;
  const z = boss.fromZ + (boss.toZ - boss.fromZ) * t;
  move(e, boss, mover, x - e.x, z - e.z);
  return boss.duration - boss.elapsed <= PHASE_EPSILON;
}

/** Fixes the direction of a leap or run (not the heading: that turns at the phase's speed). */
function aimAt(boss: BossState, e: Enemy, x: number, z: number): void {
  const dx = x - e.x;
  const dz = z - e.z;
  const d = Math.hypot(dx, dz);
  if (d > 1e-6) {
    boss.dirX = dx / d;
    boss.dirZ = dz / d;
  } else {
    boss.dirX = Math.sin(e.heading);
    boss.dirZ = Math.cos(e.heading);
  }
}

/** Sets the end of a leap or run, kept inside the arena. */
function clampEnd(e: Enemy, boss: BossState, x: number, z: number): void {
  const a = boss.arena;
  const max = Math.max(0, a.radius - e.radius);
  const dx = x - a.x;
  const dz = z - a.z;
  const d = Math.hypot(dx, dz);
  if (d > max) {
    x = a.x + (dx / d) * max;
    z = a.z + (dz / d) * max;
  }
  boss.toX = x;
  boss.toZ = z;
}

/** Walks with collision, then stays inside the arena. */
function move(e: Enemy, boss: BossState, mover: Mover, dx: number, dz: number): void {
  if (dx !== 0 || dz !== 0) mover.moveCircle(e, e.radius, dx, dz);
  keepInArena(e, boss.arena, e.radius);
}

/** Pushes a circle at p back inside the arena ring (also used for the player). */
export function keepInArena(p: { x: number; z: number }, arena: Arena, radius: number): boolean {
  const max = Math.max(0, arena.radius - radius);
  const dx = p.x - arena.x;
  const dz = p.z - arena.z;
  const d2 = dx * dx + dz * dz;
  if (d2 <= max * max) return false;
  const d = Math.sqrt(d2);
  p.x = arena.x + (dx / d) * max;
  p.z = arena.z + (dz / d) * max;
  return true;
}

/** Turns towards a point at most `degreesPerSecond` (a phase's speed from the boss data). */
function turnTo(e: Enemy, x: number, z: number, degreesPerSecond: number, dt: number): void {
  e.heading = turnTowards(e.heading, Math.atan2(x - e.x, z - e.z), degreesPerSecond * DEG * dt);
}

function attackForGap(e: Enemy, gap: number): BossAttack | null {
  for (const a of e.def.attacks ?? []) {
    if (a.onlyWhenEnraged) continue;
    if (gap >= (a.minGap ?? 0) && gap <= (a.maxGap ?? 2)) return a;
  }
  return null;
}

/** Distance from point (px, pz) to the segment a → b. */
export function segmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}
