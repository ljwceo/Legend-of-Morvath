import { Random } from '../core/Random';
import type { MonsterDef } from '../data/types';
import { angleDelta } from '../systems/Movement';
import type { SwordTarget } from '../systems/Combat';
import type { ShotTarget } from '../systems/Shots';
import type { BossState } from '../systems/BossAI';

/** Default body radius (m) when monsters.json gives none. */
export const DEFAULT_ENEMY_RADIUS = 0.5;
/** Seconds a hit target wobbles (drawn only). */
export const WOBBLE_SECONDS = 0.3;

/**
 * What a monster is doing (enemy AI, see EnemyAI):
 * idle → wander → (notices you) chase → windup → strike (lunge only) → recover → chase …;
 * too far from home: return; defeated: dead (lying down), then gone until its pack respawns.
 * Training dummies only use idle and dead.
 */
export type EnemyMode =
  'idle' | 'wander' | 'chase' | 'windup' | 'strike' | 'recover' | 'return' | 'dead';

/** Which attack a windup leads to: the normal one, or a special from `attacks` (area). */
export type EnemyAttackKind = 'normal' | 'special';

/**
 * One monster in the world (simulation state only; EnemyRenderer draws it). All monsters live
 * in one pool (Enemies) that is filled when the world is built: a slot keeps its monster type
 * and is switched on and off (spawn, defeat, respawn, a Big Slime splitting), so nothing is
 * allocated while playing. Position and heading are interpolated between fixed steps like the
 * player's.
 */
export class Enemy implements SwordTarget, ShotTarget {
  x: number;
  y = 0;
  z: number;
  heading = 0;
  /** In the world (alive, or lying down after a defeat). Off = waiting for a respawn. */
  active = true;
  /** Near enough to the player to be drawn (and maybe simulated). */
  shown = false;
  /** Inside one of its safe areas (Treewardens in the elven city): cannot be hit. */
  safe = false;
  /** A boss between its openings: it dodges every hit (see BossAI). */
  guarded = false;
  /** Boss fight state (monsters with `boss` in monsters.json), null for other monsters. */
  boss: BossState | null = null;
  hp: number;
  readonly maxHp: number;
  readonly radius: number;
  /** Walking speed (m/s), from the monster's speed class. */
  speed = 0;
  /** Seconds until a defeated dummy stands up again (0 = standing). */
  downTime = 0;
  /** Seconds since the last hit taken (dummies reset after a pause; Treewardens calm down). */
  sinceHit = Infinity;
  /** Seconds of the white hit flash left. */
  flash = 0;
  /** Seconds of the "knocked back" wobble left (drawn only). */
  wobble = 0;

  mode: EnemyMode = 'idle';
  /** Seconds left in the current mode (pause, windup, strike, recover, lying down). */
  timer = 0;
  /** Seconds until the next attack may start. */
  cooldown = 0;
  /** The current (or last) attack. */
  attackKind: EnemyAttackKind = 'normal';
  /** Attacks done since it noticed the player (specials come every n-th). */
  attackCount = 0;
  /** The current lunge already hit the player. */
  struck = false;
  /** Where it wanders around and returns to (a spot in its spawn area). */
  homeX: number;
  homeZ: number;
  /** How far from home it roams while calm. */
  wanderRadius: number;
  targetX = 0;
  targetZ = 0;
  /** Hop cycle for slimes (seconds into the current hop + pause). */
  hopTime = 0;
  /** Seconds a walk has made too little progress (blocked: give up). */
  stuckTime = 0;
  /** The pack it belongs to (Enemies), -1 for none. */
  pack = -1;
  /** Deterministic per slot: the same monster always wanders and rolls damage the same way. */
  readonly rng: Random;

  private prevX: number;
  private prevY = 0;
  private prevZ: number;
  private prevHeading = 0;

  constructor(
    readonly id: string,
    readonly def: MonsterDef,
    x: number,
    z: number,
    seed: number,
    wanderRadius = 0,
  ) {
    this.x = this.prevX = this.homeX = x;
    this.z = this.prevZ = this.homeZ = z;
    this.wanderRadius = wanderRadius;
    this.hp = this.maxHp = def.hp;
    this.radius = def.radius ?? DEFAULT_ENEMY_RADIUS;
    this.rng = new Random(seed);
  }

  get alive(): boolean {
    return this.active && this.hp > 0;
  }

  get hittable(): boolean {
    return this.alive && !this.safe && !this.guarded;
  }

  /**
   * Can you lock on to it? Everything you can hit except something that does not move or
   * fight: a training dummy stands in the middle of the Academy field, and locking on to it
   * while a wave of slimes comes at you only gets in the way.
   */
  get lockable(): boolean {
    return this.hittable && this.def.behavior !== 'static';
  }

  /**
   * Stepping aside right now: a shot of the player no longer curves towards it, so attacking
   * monsters are harder to hit (it does not dodge while recovering, so that is your opening).
   */
  get dodging(): boolean {
    return this.mode === 'windup' || this.mode === 'strike';
  }

  /** Busy attacking (windup, strike or recovery). */
  get attacking(): boolean {
    return this.mode === 'windup' || this.mode === 'strike' || this.mode === 'recover';
  }

  /** Fighting the player (chasing or attacking). */
  get engaged(): boolean {
    return this.mode === 'chase' || this.attacking;
  }

  /** Puts the monster somewhere fresh: full HP, calm, no interpolation from the old spot. */
  spawn(x: number, z: number, heading: number): void {
    this.active = true;
    this.x = this.prevX = x;
    this.z = this.prevZ = z;
    this.heading = this.prevHeading = heading;
    this.hp = this.maxHp;
    this.mode = 'idle';
    this.timer = 0;
    this.cooldown = 0;
    this.attackCount = 0;
    this.sinceHit = Infinity;
    this.flash = 0;
    this.wobble = 0;
    this.downTime = 0;
    this.stuckTime = 0;
    this.hopTime = 0;
    this.struck = false;
    this.safe = false;
    this.guarded = false;
  }

  beginStep(): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.prevHeading = this.heading;
  }

  /** The ground height was just set for a fresh spot: no interpolation from 0. */
  settleY(): void {
    this.prevY = this.y;
  }

  /** The heading was just turned by hand (a wave spawning): no interpolation from the old one. */
  settleHeading(): void {
    this.prevHeading = this.heading;
  }

  drawX(alpha: number): number {
    return this.prevX + (this.x - this.prevX) * alpha;
  }

  drawY(alpha: number): number {
    return this.prevY + (this.y - this.prevY) * alpha;
  }

  drawZ(alpha: number): number {
    return this.prevZ + (this.z - this.prevZ) * alpha;
  }

  drawHeading(alpha: number): number {
    return this.prevHeading + angleDelta(this.prevHeading, this.heading) * alpha;
  }
}
