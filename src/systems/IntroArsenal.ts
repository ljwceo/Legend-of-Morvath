import { Random } from '../core/Random';
import {
  type ControlAction,
  FIGHT_DODGE,
  STORM_HIT_CHANCE,
  STORM_STRIKE_REACH,
} from '../data/schemas';
import { assistedHeading } from './Combat';
import type { FightDef } from './FightScript';
import { readiness } from './Readiness';
import { type Shot, Shots, type ShotTarget, type ShotWorld } from './Shots';
import type { ShotConfig } from './StaffCombat';

export type FightAbility = NonNullable<FightDef['abilities']>[number];
export type MeleeAbility = Extract<FightAbility, { kind: 'melee' }>;
export type BurstAbility = Extract<FightAbility, { kind: 'burst' }>;
export type StormAbility = Extract<FightAbility, { kind: 'storm' }>;
export type ProjectileAbility = Extract<FightAbility, { kind: 'projectile' }>;
/** How a foe dodges and blinks (`fights[].dodge`). */
export type DodgeDef = NonNullable<FightDef['dodge']>;

const DEG = Math.PI / 180;
/** Icicles in flight at the same time (§4.3: three); a press while all are flying does nothing. */
export const ICICLE_POOL_SIZE = 3;
/** The most strikes one storm may have (the schema's `bolts` ceiling). */
export const MAX_BOLTS = 24;
/**
 * Contacts (hits and dodges) `ArsenalEvents` holds when nothing says how many: enough for the
 * tests; a fight sizes them by `IntroArsenal.maxContacts`, so none is ever dropped.
 */
const DEFAULT_CONTACTS = 16;
/** The icicle leaves the player's chest at this height (m). */
export const ICICLE_HEIGHT = 1.1;
/** A strike this many bolt radii from a foe is "near" it and mostly moved away (§4.3). */
const NEAR_FOE_FACTOR = 2;

/**
 * A foe of the fight as the arsenal sees it: the sword's and the shots' target (`hittable`,
 * never `dodging`, so an icicle flies straight at it) plus how often a hit is a dodge (0–1).
 */
export interface ArsenalFoe extends ShotTarget {
  readonly dodgeChance: number;
}

/** What the player pressed this step (once per press, see `Input.consumePressed`). */
export interface ArsenalInput {
  /**
   * The sword's hit. The sword's own timing (`stepSword`) decides when it lands, and the scene
   * reports what it touched with `contact`; it is here so one record covers all four.
   */
  strike: boolean;
  burst: boolean;
  storm: boolean;
  bolt: boolean;
}

export interface ArsenalPlayer {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

/**
 * How an icicle snaps to a foe in front when its ability sets no `aimRange`/`aimArcDegrees`:
 * the staff's aim assist from player.json (the icicle is a spell, so it aims like the staff's
 * shots), as a range (m) and half an arc (radians).
 */
export interface AimAssist {
  readonly aimRange: number;
  readonly aimHalfArc: number;
}

export interface Dodge {
  foe: number;
  /** Where the foe blinks to. */
  x: number;
  z: number;
}

export interface Point {
  x: number;
  z: number;
}

/** One strike of a storm: where, and when after the press (s). */
export interface StormBolt {
  x: number;
  z: number;
  at: number;
  struck: boolean;
}

/**
 * What the arsenal did this step, in fixed-capacity arrays with counters (nothing allocated
 * while fighting). Hits and dodges name a foe by its index in the fight's list: a hit shows a
 * "0", a dodge moves the foe to (x, z) with the purple puff. Both count as a hit for the script.
 * `contacts` is how many hits and how many dodges fit (`IntroArsenal.maxContacts`).
 */
export class ArsenalEvents {
  /** The explosion went off this step (at the player's feet). */
  burst = false;
  /** A storm started this step. */
  storm = false;
  hitCount = 0;
  readonly hits: number[] = [];
  dodgeCount = 0;
  readonly dodges: Dodge[] = [];
  strikeCount = 0;
  readonly strikes: Point[] = [];
  shatterCount = 0;
  readonly shatters: Point[] = [];

  constructor(contacts = DEFAULT_CONTACTS) {
    for (let i = 0; i < contacts; i++) {
      this.hits.push(0);
      this.dodges.push({ foe: 0, x: 0, z: 0 });
    }
    for (let i = 0; i < MAX_BOLTS; i++) this.strikes.push({ x: 0, z: 0 });
    for (let i = 0; i < ICICLE_POOL_SIZE; i++) this.shatters.push({ x: 0, z: 0 });
  }

  clear(): void {
    this.burst = false;
    this.storm = false;
    this.hitCount = this.dodgeCount = this.strikeCount = this.shatterCount = 0;
  }
}

/** Which input action fires each of the four abilities (null: the fight does not have it). */
export interface ArsenalActions {
  strike: ControlAction | null;
  burst: ControlAction | null;
  storm: ControlAction | null;
  bolt: ControlAction | null;
}

/**
 * The player's four abilities in the intro fight (cutscenes.json `fights[].abilities`), as pure
 * logic on the fixed step: the explosion around the player (`burst`), the thunder that strikes
 * `bolts` times across the room (`storm`), the icicle that flies from the chest (`projectile`,
 * on the `Shots` pool) and the sword's hit (`melee`, whose timing the sword itself keeps). Every
 * contact with a foe goes through one rule (`contact`): a seeded roll against the foe's
 * `dodgeChance` makes it a dodge (the foe blinks aside) or a hit for 0 damage. Everything
 * random comes from the fight's `seed`, so the same presses give the same fight on every device
 * and at 60 and 120 Hz. Nothing is allocated after construction.
 */
export class IntroArsenal {
  readonly actions: ArsenalActions;
  readonly burstDef: BurstAbility | null = null;
  readonly stormDef: StormAbility | null = null;
  readonly projectileDef: ProjectileAbility | null = null;
  /** The icicles (read-only for drawing: `shots.list`). */
  readonly shots = new Shots(ICICLE_POOL_SIZE);
  /** The strikes of the running storm (read-only for drawing; `struck` ones have landed). */
  readonly stormBolts: readonly StormBolt[];
  /**
   * The most contacts one step can make: every foe touched by the explosion, the sword, every
   * icicle and every bolt of the storm at once. Size `ArsenalEvents` by it.
   */
  readonly maxContacts: number;

  private readonly random: Random;
  /** How far a dodge blinks (m) and how clear it stays of the others (`fights[].dodge`). */
  private readonly dodgeMin: number;
  private readonly dodgeMax: number;
  private readonly dodgeClearance: number;
  /** Strikes land within this part of the set's radius. */
  private readonly strikeReach: number;
  private readonly icicle: ShotConfig | null = null;
  private readonly aimRange: number;
  private readonly aimHalfArc: number;
  private readonly world: ShotWorld;
  private burstCooldown = 0;
  private stormCooldown = 0;
  private boltCooldown = 0;
  private stormElapsed = 0;
  private stormActive = false;
  private playerX = 0;
  private playerZ = 0;
  /** Where each icicle left from and how far it flies (for where it shatters). */
  private readonly originX: number[] = [];
  private readonly originZ: number[] = [];
  private readonly flight: number[] = [];
  private readonly wasActive: boolean[] = [];
  private readonly hitThisStep: boolean[] = [];
  private out: ArsenalEvents | null = null;

  constructor(
    abilities: FightDef['abilities'],
    private readonly foes: readonly ArsenalFoe[],
    private readonly setRadius: number,
    seed: number,
    aim: AimAssist,
    dodge: DodgeDef = FIGHT_DODGE,
  ) {
    this.random = new Random(seed);
    this.dodgeMin = dodge.minMeters;
    this.dodgeMax = dodge.maxMeters;
    this.dodgeClearance = dodge.clearanceMeters;
    this.actions = { strike: null, burst: null, storm: null, bolt: null };
    for (const ability of abilities ?? []) {
      switch (ability.kind) {
        case 'melee':
          this.actions.strike ??= ability.action;
          break;
        case 'burst':
          if (!this.burstDef) {
            this.burstDef = ability;
            this.actions.burst = ability.action;
          }
          break;
        case 'storm':
          if (!this.stormDef) {
            this.stormDef = ability;
            this.actions.storm = ability.action;
          }
          break;
        case 'projectile':
          if (!this.projectileDef) {
            this.projectileDef = ability;
            this.actions.bolt = ability.action;
          }
          break;
      }
    }
    const p = this.projectileDef;
    if (p) {
      this.icicle = {
        id: 'intro_icicle',
        element: '',
        damage: 0,
        poiseDamage: 0,
        manaCost: 0,
        windupSeconds: 0,
        cooldownSeconds: p.cooldownSeconds,
        speed: p.speed,
        range: p.range ?? 2 * setRadius,
        radius: p.radius,
        homingRadians: 0,
        charge: null,
      };
    }
    this.aimRange = p?.aimRange ?? aim.aimRange;
    this.aimHalfArc = p?.aimArcDegrees !== undefined ? (p.aimArcDegrees / 2) * DEG : aim.aimHalfArc;
    this.strikeReach = this.stormDef?.strikeReach ?? STORM_STRIKE_REACH;
    this.maxContacts =
      foes.length * (2 + ICICLE_POOL_SIZE + (this.stormDef?.bolts ?? 0)) || DEFAULT_CONTACTS;
    const r2 = setRadius * setRadius;
    this.world = { heightAt: () => 0, blocked: (x, z) => x * x + z * z > r2 };
    const bolts: StormBolt[] = [];
    for (let i = 0; i < (this.stormDef?.bolts ?? 0); i++) {
      bolts.push({ x: 0, z: 0, at: 0, struck: true });
    }
    this.stormBolts = bolts;
    for (let i = 0; i < ICICLE_POOL_SIZE; i++) {
      this.originX.push(0);
      this.originZ.push(0);
      this.flight.push(0);
      this.wasActive.push(false);
      this.hitThisStep.push(false);
    }
  }

  /** Seconds before the ability fires again (0 = ready). */
  cooldown(kind: 'burst' | 'storm' | 'bolt'): number {
    return kind === 'burst'
      ? this.burstCooldown
      : kind === 'storm'
        ? this.stormCooldown
        : this.boltCooldown;
  }

  /** True while a storm is striking. */
  get storming(): boolean {
    return this.stormActive;
  }

  /**
   * How ready an ability is to fire again (0–1, see `readiness`): its cooldown against the
   * `cooldownSeconds` of its data. 1 for an ability the fight does not have.
   */
  readiness(kind: 'burst' | 'storm' | 'projectile'): number {
    switch (kind) {
      case 'burst':
        return readiness(this.burstCooldown, this.burstDef?.cooldownSeconds ?? 0);
      case 'storm':
        return readiness(this.stormCooldown, this.stormDef?.cooldownSeconds ?? 0);
      case 'projectile':
        return readiness(this.boltCooldown, this.icicle?.cooldownSeconds ?? 0);
    }
  }

  /** False while every icicle of the pool is in flight: a press does nothing then (§4.3). */
  get icicleSlotFree(): boolean {
    return this.shots.activeCount < ICICLE_POOL_SIZE;
  }

  /**
   * One fixed step: cooldowns run down, a ready ability that was pressed goes off, the storm's
   * due strikes land and the icicles fly. `out` is cleared by the caller.
   */
  step(dt: number, input: ArsenalInput, player: ArsenalPlayer, out: ArsenalEvents): void {
    this.playerX = player.x;
    this.playerZ = player.z;
    this.burstCooldown = Math.max(0, this.burstCooldown - dt);
    this.stormCooldown = Math.max(0, this.stormCooldown - dt);
    this.boltCooldown = Math.max(0, this.boltCooldown - dt);
    if (this.stormActive) this.stormElapsed += dt;

    const burst = this.burstDef;
    if (burst && input.burst && this.burstCooldown <= 0) {
      this.burstCooldown = burst.cooldownSeconds;
      out.burst = true;
      for (let i = 0; i < this.foes.length; i++) {
        const foe = this.foes[i] as ArsenalFoe;
        const reach = burst.radius + foe.radius;
        const dx = foe.x - player.x;
        const dz = foe.z - player.z;
        if (dx * dx + dz * dz <= reach * reach) this.contact(i, out);
      }
    }

    // A press while a storm is still striking is ignored: starting over would drop its strikes.
    const storm = this.stormDef;
    if (storm && input.storm && this.stormCooldown <= 0 && !this.stormActive) {
      this.stormCooldown = storm.cooldownSeconds;
      this.startStorm(storm);
      out.storm = true;
    }
    if (this.stormActive && storm) this.strikeDue(storm, out);

    const icicle = this.icicle;
    if (icicle && input.bolt && this.boltCooldown <= 0 && this.icicleSlotFree) {
      this.boltCooldown = icicle.cooldownSeconds;
      this.fireIcicle(icicle, player);
    }
    this.flyIcicles(dt, out);
  }

  /**
   * An ability touched foe `index`: a roll against its `dodgeChance` makes it a dodge (the foe
   * blinks sideways, inside the room and clear of the player) or a hit for 0. The sword's
   * hits come in here from the scene, so all four abilities share one roll.
   */
  contact(index: number, out: ArsenalEvents): void {
    const foe = this.foes[index];
    if (!foe) return;
    if (this.random.next() < foe.dodgeChance) {
      if (out.dodgeCount >= out.dodges.length) return;
      const dodge = out.dodges[out.dodgeCount++] as Dodge;
      dodge.foe = index;
      this.dodgeSpot(foe, dodge);
      return;
    }
    if (out.hitCount >= out.hits.length) return;
    out.hits[out.hitCount++] = index;
  }

  /** The fight is over: no icicle flies on into the film, nothing is still cooling down. */
  clear(): void {
    this.shots.clear();
    this.stormActive = false;
    this.stormElapsed = 0;
    this.burstCooldown = this.stormCooldown = this.boltCooldown = 0;
    for (const bolt of this.stormBolts) bolt.struck = true;
  }

  /**
   * Where a dodging foe lands: `dodgeMin`–`dodgeMax` m to one side (as seen from the player).
   * The side is a roll, but a spot past the wall or within `dodgeClearance` of another foe
   * gives way to the other side when that one is better (so a brother never blinks into his
   * brother while the other side is free); one too close to the player is pushed straight away
   * from them; and whatever is left outside the room is held at the wall.
   */
  private dodgeSpot(foe: ArsenalFoe, out: Dodge): void {
    const clearance = this.dodgeClearance;
    const px = this.playerX;
    const pz = this.playerZ;
    let dirX = foe.x - px;
    let dirZ = foe.z - pz;
    const d = Math.hypot(dirX, dirZ);
    if (d > 1e-6) {
      dirX /= d;
      dirZ /= d;
    } else {
      dirX = 0;
      dirZ = 1;
    }
    const side = this.random.next() < 0.5 ? 1 : -1;
    const distance = this.dodgeMin + this.random.next() * (this.dodgeMax - this.dodgeMin);
    const max = Math.max(0, this.setRadius - foe.radius);
    // Sideways is perpendicular to the line from the player.
    const sideX = dirZ * distance;
    const sideZ = -dirX * distance;
    let x = foe.x + sideX * side;
    let z = foe.z + sideZ * side;
    const otherX = foe.x - sideX * side;
    const otherZ = foe.z - sideZ * side;
    if (this.spotScore(otherX, otherZ, foe, max) > this.spotScore(x, z, foe, max)) {
      x = otherX;
      z = otherZ;
    }
    let ax = x - px;
    let az = z - pz;
    const away = Math.hypot(ax, az);
    if (away < clearance) {
      if (away < 1e-6) {
        ax = dirX;
        az = dirZ;
      } else {
        ax /= away;
        az /= away;
      }
      x = px + ax * clearance;
      z = pz + az * clearance;
    }
    const r = Math.hypot(x, z);
    if (r > max && r > 1e-6) {
      // Held at the wall. The player stands near it too, so the spot straight in from here
      // would be too close to them: take the spot on the wall exactly `clearance` from the
      // player on this side, if the wall has one (two circles crossing).
      const pr = Math.hypot(px, pz);
      // Along the player's own direction from the middle: where the chord of the crossings
      // lies; `h` is half that chord (no crossings when the player is far from the wall).
      const along = pr > 1e-6 ? (pr * pr + max * max - clearance * clearance) / (2 * pr) : 0;
      const h2 = max * max - along * along;
      if (pr > 1e-6 && h2 >= 0) {
        const h = Math.sqrt(h2);
        const ux = px / pr;
        const uz = pz / pr;
        // Of the two crossings, the one on the side the foe was blinking to.
        const sideOf = x * uz - z * ux >= 0 ? 1 : -1;
        x = ux * along + uz * h * sideOf;
        z = uz * along - ux * h * sideOf;
      } else {
        x *= max / r;
        z *= max / r;
      }
    }
    out.x = x;
    out.z = z;
  }

  /**
   * How good a dodge spot is for `foe`: inside the room (up to `max` from the middle) counts
   * most, clear of every other foe counts next.
   */
  private spotScore(x: number, z: number, foe: ArsenalFoe, max: number): number {
    let score = x * x + z * z <= max * max ? 2 : 0;
    if (this.clearOfOthers(x, z, foe)) score += 1;
    return score;
  }

  /** True when no other foe stands within `dodgeClearance` of (x, z). */
  private clearOfOthers(x: number, z: number, foe: ArsenalFoe): boolean {
    const clearance = this.dodgeClearance;
    for (let i = 0; i < this.foes.length; i++) {
      const other = this.foes[i] as ArsenalFoe;
      if (other === foe) continue;
      const dx = other.x - x;
      const dz = other.z - z;
      if (dx * dx + dz * dz < clearance * clearance) return false;
    }
    return true;
  }

  /**
   * Picks where every bolt of the storm strikes, spread evenly over `strikeSeconds` (the first
   * at once). A point near a foe is kept with `hitChance`, otherwise picked again once, so most
   * bolts miss by design (§4.3).
   */
  private startStorm(storm: StormAbility): void {
    const hitChance = storm.hitChance ?? STORM_HIT_CHANCE;
    const bolts = this.stormBolts as StormBolt[];
    for (let i = 0; i < bolts.length; i++) {
      const bolt = bolts[i] as StormBolt;
      this.pickStrike(bolt);
      if (this.nearFoe(bolt.x, bolt.z, storm.boltRadius) && !(this.random.next() < hitChance)) {
        this.pickStrike(bolt);
      }
      bolt.at = (i / bolts.length) * storm.strikeSeconds;
      bolt.struck = false;
    }
    this.stormElapsed = 0;
    this.stormActive = true;
  }

  /** A seeded-random point on the floor, evenly spread (square root: not crowded at the middle). */
  private pickStrike(bolt: StormBolt): void {
    const angle = this.random.next() * Math.PI * 2;
    const distance = Math.sqrt(this.random.next()) * this.setRadius * this.strikeReach;
    bolt.x = Math.sin(angle) * distance;
    bolt.z = Math.cos(angle) * distance;
  }

  private nearFoe(x: number, z: number, boltRadius: number): boolean {
    const near = boltRadius * NEAR_FOE_FACTOR;
    for (let i = 0; i < this.foes.length; i++) {
      const foe = this.foes[i] as ArsenalFoe;
      const dx = foe.x - x;
      const dz = foe.z - z;
      if (dx * dx + dz * dz <= near * near) return true;
    }
    return false;
  }

  /** The strikes whose time has come land: a foe within `boltRadius` of one is touched. */
  private strikeDue(storm: StormAbility, out: ArsenalEvents): void {
    let left = false;
    for (let i = 0; i < this.stormBolts.length; i++) {
      const bolt = this.stormBolts[i] as StormBolt;
      if (bolt.struck) continue;
      if (bolt.at > this.stormElapsed) {
        left = true;
        continue;
      }
      bolt.struck = true;
      if (out.strikeCount < out.strikes.length) {
        const strike = out.strikes[out.strikeCount++] as Point;
        strike.x = bolt.x;
        strike.z = bolt.z;
      }
      for (let f = 0; f < this.foes.length; f++) {
        const foe = this.foes[f] as ArsenalFoe;
        const reach = storm.boltRadius + foe.radius;
        const dx = foe.x - bolt.x;
        const dz = foe.z - bolt.z;
        if (dx * dx + dz * dz <= reach * reach) this.contact(f, out);
      }
    }
    if (!left) this.stormActive = false;
  }

  /** The icicle leaves the chest towards the nearest foe in front (aim assist), else straight on. */
  private fireIcicle(icicle: ShotConfig, player: ArsenalPlayer): void {
    const heading = assistedHeading(
      player.x,
      player.z,
      player.heading,
      this.foes,
      this.aimRange,
      this.aimHalfArc,
    );
    const shot = this.shots.fire(icicle, player.x, ICICLE_HEIGHT, player.z, heading, 0, null);
    const slot = this.shots.list.indexOf(shot);
    this.originX[slot] = player.x;
    this.originZ[slot] = player.z;
    // How far it flies before it fizzles (its range and the little extra `Shots` gives it).
    this.flight[slot] = shot.life * shot.speed;
  }

  /**
   * The icicles fly one step. One that touches a foe makes contact; one that leaves the room
   * or runs out shatters where it stopped (worked out from its line of flight, so 60 and 120 Hz
   * put the shards at the same spot).
   */
  private flyIcicles(dt: number, out: ArsenalEvents): void {
    const list = this.shots.list;
    for (let i = 0; i < list.length; i++) {
      this.wasActive[i] = (list[i] as Shot).active;
      this.hitThisStep[i] = false;
    }
    this.out = out;
    this.shots.step(dt, this.foes, this.world, this.onShotHit);
    this.out = null;
    for (let i = 0; i < list.length; i++) {
      const shot = list[i] as Shot;
      if (!this.wasActive[i] || shot.active || this.hitThisStep[i]) continue;
      if (out.shatterCount >= out.shatters.length) continue;
      const shatter = out.shatters[out.shatterCount++] as Point;
      this.shatterPoint(shot, i, shatter);
    }
  }

  private readonly onShotHit = (target: ShotTarget, shot: Shot): void => {
    const out = this.out;
    if (!out) return;
    const slot = this.shots.list.indexOf(shot);
    if (slot >= 0) this.hitThisStep[slot] = true;
    const index = this.foes.indexOf(target as ArsenalFoe);
    if (index >= 0) this.contact(index, out);
  };

  /**
   * Where a stopped icicle shatters: on the wall where its line of flight crosses it, or, when
   * it ran out of range inside the room, where its range ended.
   */
  private shatterPoint(shot: Shot, slot: number, out: Point): void {
    const r = this.setRadius;
    if (shot.x * shot.x + shot.z * shot.z > r * r) {
      // The segment it flew this step crosses the circle once: solve |from + t·d| = r.
      const fx = shot.fromX;
      const fz = shot.fromZ;
      const dx = shot.x - fx;
      const dz = shot.z - fz;
      const a = dx * dx + dz * dz;
      const b = 2 * (fx * dx + fz * dz);
      const c = fx * fx + fz * fz - r * r;
      const disc = b * b - 4 * a * c;
      if (a > 1e-12 && disc >= 0) {
        const t = Math.max(0, Math.min(1, (-b + Math.sqrt(disc)) / (2 * a)));
        out.x = fx + dx * t;
        out.z = fz + dz * t;
        return;
      }
      out.x = shot.x;
      out.z = shot.z;
      return;
    }
    const flight = this.flight[slot] ?? 0;
    out.x = (this.originX[slot] ?? shot.x) + shot.dirX * flight;
    out.z = (this.originZ[slot] ?? shot.z) + shot.dirZ * flight;
  }
}
