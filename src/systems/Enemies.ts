import { hashSeed, Random } from '../core/Random';
import { Enemy, WOBBLE_SECONDS } from '../entities/Enemy';
import type {
  MonsterDef,
  MonstersFile,
  NightSpawnDef,
  Shape,
  WaveFightDef,
  Zone,
  ZonesFile,
} from '../data/types';
import type { PointXZ } from '../world/Colliders';
import { emptyBox, pointInShape, shapeBounds } from '../world/Shapes';
import { type BossWorld, BossState, startBoss, stepBoss } from './BossAI';
import { damagePoise, stepPoise } from './Poise';
import {
  defeat,
  type EnemyAiConfig,
  enemyAiConfig,
  type EnemyTarget,
  type EnemyWorld,
  engage,
  stepEnemyAi,
} from './EnemyAI';

/** Seconds of the white flash after a hit. */
const FLASH_SECONDS = 0.12;
/** A static dummy without `resetSeconds` stands up again after this long. */
const DEFAULT_RESET_SECONDS = 3;
/** Pack mates stand within this distance (m) of the pack's spot. */
const PACK_SPREAD = 2.5;
/** Pack mates roam this far (m) around the pack's spot, so a pack stays together. */
const PACK_WANDER = 4;
/** Lone monsters of a spawn area roam this fraction of the area's radius around their spot. */
const AREA_WANDER_FRACTION = 0.5;
/** Monsters split from a dying one appear this far (m) to its sides. */
const SPLIT_OFFSET = 0.9;
/** Monsters push each other apart by this fraction of the overlap per step. */
const SEPARATION = 0.5;
const DEFAULT_SPEED = 2;
/** Random spots tried per night spawn attempt (some fall in safe zones, water or too close). */
const SPAWN_TRIES = 8;

/** Distances (m) for showing monsters: the same on every graphics preset (§2.3). */
export interface EnemyRanges {
  showRadius: number;
  hideMargin: number;
}

/** A group that spawns, fights and respawns together (one goblin pack, one slime, ...). */
interface Pack {
  members: Enemy[];
  /** Pool slots for monsters split from members (Big Slime → Green Slimes). */
  children: Enemy[];
  /** Spawn area (radius 0 = a fixed spot). */
  x: number;
  z: number;
  radius: number;
  def: MonsterDef;
  respawnSeconds: number;
  /** Seconds until the pack comes back (counts once everyone is gone). */
  timer: number;
  /** Rolls pack sizes and spots; seeded from the spawn id. */
  rng: Random;
  /** Fixed spots (training dummy, Treewarden, chief) never move to a new spot. */
  fixed: boolean;
  wanderRadius: number;
  /** Filled by night spawning (stepSpawning), not by the normal respawn. */
  night: boolean;
  /**
   * Part of a scripted fight in waves (the second Entrance Exam): only `spawnWave` puts it in
   * the world and only `clearWave` (or a knock-out) takes it out again. Never respawns.
   */
  scripted: boolean;
}

/** One monster slot of a wave: its pool slot and the pack that holds its split children. */
interface WaveSlot {
  pack: Pack;
  enemy: Enemy;
}

/** One entry of one wave: `count` monsters, each rolled from the entry's candidate list. */
interface WaveEntry {
  count: number;
  /** Pooled slots per candidate monster, `count` of each (so any roll always has a slot). */
  candidates: WaveSlot[][];
}

/** The pooled monsters of one scripted fight (quests.json `waveFights`). */
interface WaveSet {
  /** Per wave, its entries. */
  waves: WaveEntry[][];
  /** Which monster will be rolled; seeded from the fight id, so a replay is repeatable. */
  rng: Random;
}

/** Night spawning rules (zones.json `world.nightSpawning`). */
export type NightSpawnRules = ZonesFile['world']['nightSpawning'];

/** What night spawning needs from the world each step. */
export interface SpawnWorld {
  /** True while monsters appear (dusk and night). */
  spawning: boolean;
  /** Also use test-only areas (debug mode). */
  testAreas: boolean;
  heightAt(x: number, z: number): number;
  /** Can a monster stand here (ground, not deep water, loaded)? */
  canStand(x: number, z: number): boolean;
}

/**
 * One night spawn area (zones.json `nightSpawns`): per monster in its list `maxAlive` pooled
 * packs, of which at most `maxAlive` are in the world at once.
 */
interface NightArea {
  def: NightSpawnDef;
  /** The pooled packs per monster entry (same order as `def.monsters`). */
  packs: Pack[][];
  totalWeight: number;
  timer: number;
  rng: Random;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** The world as monsters see it: walking (EnemyWorld), boss events and the ground height. */
export interface EnemiesWorld extends EnemyWorld, Pick<BossWorld, 'bossEvent'> {
  heightAt(x: number, z: number): number;
}

/**
 * All monsters, in one pool built from zones.json (`spawns`, `spawnAreas` and the night
 * areas `nightSpawns`) and monsters.json. Monsters are drawn within `showRadius` of the player (with
 * a margin before they hide) and move and fight within `settings.simulateRadius`, the same on
 * every graphics preset. Packs (goblins in twos and threes) notice you together; a defeated
 * pack comes back after `respawnSeconds`, once you are away. A Big Slime splits into two
 * Green Slimes from slots kept for it. Training dummies stand still and get up again.
 * Night areas fill at dusk and at night (stepSpawning): a pack appears at a random spot,
 * never inside a safe zone, not too close to the player; once gone, its place is free again
 * after `respawnSeconds`. What happens to them by day is still open: for now they simply stay.
 * Allocation-free on the fixed step.
 */
export class Enemies {
  readonly list: Enemy[] = [];
  /** The enemies shown this step (a reused array). */
  readonly shown: Enemy[] = [];
  readonly ai: EnemyAiConfig;
  /** Monster poise settings from data: backstab cone and factor, poise bar look. */
  readonly poiseSettings: MonstersFile['settings']['poise'];
  /** Bosses (monsters with `boss`): one slot each, only in the world during their fight. */
  readonly bosses: Enemy[] = [];
  private readonly packs: Pack[] = [];
  private readonly nightAreas: NightArea[] = [];
  /** Scripted fights in waves (quests.json `waveFights`), by fight id. */
  private readonly waveSets = new Map<string, WaveSet>();
  private readonly safeZones: Shape[] = [];
  private readonly packOf = new Map<Enemy, Pack>();
  private readonly speeds: Readonly<Record<string, number>>;
  private readonly simulateRadius: number;
  private readonly respawnDistance: number;
  private readonly packAggroRadius: number;
  /** Simulated (moving) this step: separation only between these. */
  private readonly moving: Enemy[] = [];
  private world: EnemiesWorld | null = null;

  constructor(
    zones: readonly Zone[],
    monsters: MonstersFile,
    private readonly ranges: EnemyRanges,
    private readonly safeAreas: ReadonlyMap<string, Shape> = new Map(),
    private readonly rules: NightSpawnRules | null = null,
    seed = 0,
    waveFights: readonly WaveFightDef[] = [],
  ) {
    this.ai = enemyAiConfig(monsters);
    this.poiseSettings = monsters.settings.poise;
    this.speeds = monsters.speedClasses;
    this.simulateRadius = monsters.settings.simulateRadius;
    this.respawnDistance = monsters.settings.respawnMinPlayerDistance;
    this.packAggroRadius = monsters.settings.packAggroRadius;
    const byId = new Map(monsters.monsters.map((m) => [m.id, m]));
    const find = (zone: Zone, id: string): MonsterDef => {
      const def = byId.get(id);
      if (!def) throw new Error(`Unknown monster "${id}" in ${zone.id}`);
      return def;
    };
    for (const zone of zones) {
      for (const spawn of zone.spawns ?? []) {
        this.addPack(spawn.id, find(zone, spawn.monster), byId, {
          x: spawn.x,
          z: spawn.z,
          radius: 0,
          wanderRadius: spawn.wanderRadius ?? 0,
          respawnSeconds: spawn.respawnSeconds ?? Infinity,
          fixed: true,
          night: false,
          scripted: false,
        });
      }
      for (const area of zone.spawnAreas ?? []) {
        const def = find(zone, area.monster);
        for (let i = 0; i < area.count; i++) {
          this.addPack(`${area.id}_${i}`, def, byId, {
            x: area.x,
            z: area.z,
            radius: area.radius,
            wanderRadius: def.groupSize ? PACK_WANDER : area.radius * AREA_WANDER_FRACTION,
            respawnSeconds: area.respawnSeconds,
            fixed: false,
            night: false,
            scripted: false,
          });
        }
      }
      for (const safe of zone.safeZones ?? []) this.safeZones.push(safe.shape);
      if (rules) {
        for (const area of zone.nightSpawns ?? []) this.addNightArea(zone, area, find, byId, seed);
      }
    }
    for (const fight of waveFights) this.addWaveSet(fight, byId);
    for (const pack of this.packs) {
      if (pack.night || pack.scripted) this.clearPack(pack);
      else this.spawnPack(pack);
    }
    for (const def of monsters.monsters) {
      if (!def.boss) continue;
      const boss = new Enemy(`boss_${def.id}`, def, def.boss.start.x, def.boss.start.z, 0xb055);
      boss.speed = this.speeds[def.speed] ?? DEFAULT_SPEED;
      boss.boss = new BossState(def.boss, def.boss.arena);
      boss.active = false;
      this.list.push(boss);
      this.bosses.push(boss);
    }
  }

  /** The boss slot of a monster (null when it is no boss). */
  bossOf(monsterId: string): Enemy | null {
    for (let i = 0; i < this.bosses.length; i++) {
      const e = this.bosses[i] as Enemy;
      if (e.def.id === monsterId) return e;
    }
    return null;
  }

  /** Starts a boss fight: the boss appears at its start, facing `heading`. */
  startBoss(e: Enemy, heading: number): void {
    startBoss(e, heading);
    if (!this.world) return;
    e.y = this.world.heightAt(e.x, e.z);
    e.settleY();
  }

  /** Ends a boss fight early (the player lost): the boss leaves the world. */
  endBoss(e: Enemy): void {
    e.active = false;
    e.shown = false;
    e.guarded = false;
  }

  /**
   * Puts wave `index` (0-based) of a scripted fight on the field: every monster of the wave in
   * a ring of `radius` m around (x, z), facing the middle. Each slot's monster is rolled from
   * the entry's candidate list (Master Brink's elemental slimes), and they come for you right
   * away. Returns how many monsters it put down.
   */
  spawnWave(fightId: string, index: number, x: number, z: number, radius: number): number {
    const set = this.waveSets.get(fightId);
    const wave = set?.waves[index];
    if (!set || !wave) return 0;
    let total = 0;
    for (let e = 0; e < wave.length; e++) total += (wave[e] as WaveEntry).count;
    if (total === 0) return 0;
    let placed = 0;
    for (let e = 0; e < wave.length; e++) {
      const entry = wave[e] as WaveEntry;
      for (let i = 0; i < entry.count; i++) {
        const list = entry.candidates[set.rng.int(0, entry.candidates.length - 1)] as WaveSlot[];
        const slot = list[i] as WaveSlot;
        // Spread them evenly around the field, with a little jitter so it never looks drawn.
        const angle = ((placed + 0.5) / total) * Math.PI * 2 + (set.rng.next() - 0.5) * 0.4;
        const r = radius * (0.7 + 0.3 * set.rng.next());
        slot.pack.x = x + Math.sin(angle) * r;
        slot.pack.z = z + Math.cos(angle) * r;
        slot.enemy.homeX = slot.pack.x;
        slot.enemy.homeZ = slot.pack.z;
        this.spawnPack(slot.pack);
        // They look at the middle of the field and fight at once: no sneaking up on you.
        slot.enemy.heading = Math.atan2(x - slot.enemy.x, z - slot.enemy.z);
        slot.enemy.settleHeading();
        engage(slot.enemy);
        if (this.world) {
          slot.enemy.y = this.world.heightAt(slot.enemy.x, slot.enemy.z);
          slot.enemy.settleY();
        }
        placed++;
      }
    }
    return placed;
  }

  /** Monsters of a scripted fight that are still in the world (alive or lying down). */
  waveAlive(fightId: string): number {
    const set = this.waveSets.get(fightId);
    if (!set) return 0;
    let n = 0;
    for (const wave of set.waves) {
      for (const entry of wave) {
        for (const list of entry.candidates) {
          for (const slot of list) {
            if (slot.enemy.alive) n++;
            n += countAlive(slot.pack.children);
          }
        }
      }
    }
    return n;
  }

  /** Takes every monster of a scripted fight off the field (the drill resets, or you went down). */
  clearWave(fightId: string): void {
    const set = this.waveSets.get(fightId);
    if (!set) return;
    for (const wave of set.waves) {
      for (const entry of wave) {
        for (const list of entry.candidates) {
          for (const slot of list) this.clearPack(slot.pack);
        }
      }
    }
  }

  /** Heals a monster, never above its max HP (leech, see StatusEffects). Returns what it healed. */
  heal(e: Enemy, amount: number): number {
    if (!e.alive || amount <= 0) return 0;
    const healed = Math.min(e.maxHp - e.hp, amount);
    if (healed <= 0) return 0;
    e.hp += healed;
    return healed;
  }

  /** Number of monsters fighting the player right now (debug). */
  get engagedCount(): number {
    let n = 0;
    for (let i = 0; i < this.shown.length; i++) if ((this.shown[i] as Enemy).engaged) n++;
    return n;
  }

  /** The nearest living monster that is shown, or null (debug). */
  nearest(x: number, z: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD2 = Infinity;
    for (let i = 0; i < this.shown.length; i++) {
      const e = this.shown[i] as Enemy;
      if (!e.alive) continue;
      const d2 = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d2 < bestD2) {
        best = e;
        bestD2 = d2;
      }
    }
    return best;
  }

  /** Number of monsters in the world (alive or lying down). */
  get activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) if ((this.list[i] as Enemy).active) n++;
    return n;
  }

  /**
   * One fixed step: which enemies are shown, their AI (near the player), pushing apart, ground
   * height and respawns. `target` is the player (radius, and whether monsters may attack).
   */
  step(dt: number, target: EnemyTarget, world: EnemiesWorld): void {
    this.world = world;
    const px = target.x;
    const pz = target.z;
    const show2 = this.ranges.showRadius ** 2;
    const hide2 = (this.ranges.showRadius + this.ranges.hideMargin) ** 2;
    const sim2 = this.simulateRadius ** 2;
    this.shown.length = 0;
    this.moving.length = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i] as Enemy;
      if (!e.active) {
        e.shown = false;
        continue;
      }
      const dx = e.x - px;
      const dz = e.z - pz;
      const d2 = dx * dx + dz * dz;
      if (e.shown ? d2 > hide2 : d2 > show2) {
        e.shown = false;
        continue;
      }
      if (!e.shown) {
        e.shown = true;
        e.y = world.heightAt(e.x, e.z);
        e.settleY();
      }
      this.shown.push(e);
      e.beginStep();
      e.sinceHit += dt;
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt);
      if (e.wobble > 0) e.wobble = Math.max(0, e.wobble - dt);
      e.safe = this.inSafeArea(e);
      stepPoise(e.poise, this.ai.poise, dt);
      if (e.def.behavior === 'static') {
        this.stepDummy(e, dt);
      } else if (e.boss) {
        stepBoss(e, target, world, dt);
        if (e.alive) this.moving.push(e);
      } else if (d2 <= sim2) {
        stepEnemyAi(e, e.speed, this.ai, target, world, dt);
        if (e.alive) this.moving.push(e);
      } else if (e.engaged || e.mode === 'return') {
        // Left far behind (no collision out here): back home, healed.
        this.sendHome(e);
      }
      e.y = world.heightAt(e.x, e.z);
    }
    this.separate(target);
    this.stepPacks(dt, px, pz);
  }

  /** Night monsters alive right now (debug). */
  get nightAlive(): number {
    let n = 0;
    for (let i = 0; i < this.packs.length; i++) {
      const pack = this.packs[i] as Pack;
      if (pack.night) n += countAlive(pack.members) + countAlive(pack.children);
    }
    return n;
  }

  /** True when (x, z) is in a safe zone (city, village, Monastery, shrine). */
  inSafeZone(x: number, z: number): boolean {
    for (let i = 0; i < this.safeZones.length; i++) {
      if (pointInShape(this.safeZones[i] as Shape, x, z)) return true;
    }
    return false;
  }

  /**
   * Night spawning, once per fixed step: every `checkSeconds` each area brings one more pack
   * (up to `maxAlive`), picked by weight, at a random spot: inside the area, outside every safe
   * zone, between min and max distance from the player, on ground. A pack whose monsters are
   * all gone frees its place after the area's `respawnSeconds`.
   */
  stepSpawning(dt: number, px: number, pz: number, world: SpawnWorld): void {
    const rules = this.rules;
    if (!rules) return;
    for (let a = 0; a < this.nightAreas.length; a++) {
      const area = this.nightAreas[a] as NightArea;
      let taken = 0;
      for (let m = 0; m < area.packs.length; m++) {
        const list = area.packs[m] as Pack[];
        for (let p = 0; p < list.length; p++) {
          const pack = list[p] as Pack;
          if (anyActive(pack.members) || anyActive(pack.children)) {
            pack.timer = pack.respawnSeconds;
            taken++;
          } else if (pack.timer > 0) {
            // Gone, but its place stays taken until the respawn time has passed.
            pack.timer = Math.max(0, pack.timer - dt);
            taken++;
          }
        }
      }
      area.timer -= dt;
      if (area.timer > 0) continue;
      area.timer += rules.checkSeconds;
      if (!world.spawning || (area.def.testOnly && !world.testAreas)) continue;
      if (taken >= area.def.maxAlive) continue;
      this.trySpawn(area, px, pz, world);
    }
  }

  /**
   * Deals damage to an enemy. Returns true when this hit defeated it. A hit monster fights
   * back (with its pack); a defeated Big Slime splits. `poiseDamage` drains its poise (fase
   * S.6): when that breaks, the monster staggers and an attack in progress is interrupted.
   */
  hit(e: Enemy, damage: number, poiseDamage = 0): boolean {
    if (!e.alive) return false;
    e.hp = Math.max(0, e.hp - damage);
    e.sinceHit = 0;
    e.flash = FLASH_SECONDS;
    e.wobble = WOBBLE_SECONDS;
    if (e.def.behavior === 'static') {
      if (e.hp > 0) return false;
      e.downTime = e.def.resetSeconds ?? DEFAULT_RESET_SECONDS;
      return true;
    }
    if (e.boss) {
      if (e.hp > 0) {
        // A boss breaks poise only while it can be hit (its opening): it staggers, so the
        // opening lasts one stagger longer (it cannot start its next attack).
        if (damagePoise(e.poise, poiseDamage, this.ai.poise))
          e.boss.duration += this.ai.poise.staggerSeconds;
        return false;
      }
      e.guarded = false;
      defeat(e, this.ai);
      return true;
    }
    if (e.hp > 0) {
      if (e.mode === 'return') e.mode = 'chase';
      engage(e);
      this.alert(e);
      if (damagePoise(e.poise, poiseDamage, this.ai.poise)) this.stagger(e);
      return false;
    }
    defeat(e, this.ai);
    this.split(e);
    return true;
  }

  /**
   * The player parried this monster's attack (fase S.7): its attack is cut short and it staggers
   * for the usual stagger time. A monster without poise (a boss) only loses the attack.
   */
  parried(e: Enemy): void {
    if (!e.alive) return;
    if (e.poise.max > 0) e.poise.staggerTime = this.ai.poise.staggerSeconds;
    this.stagger(e);
  }

  /** Poise broke: whatever the monster was doing is cut short (it is back to chasing after). */
  private stagger(e: Enemy): void {
    if (e.attacking) {
      e.mode = 'chase';
      e.struck = true;
    }
    e.wobble = WOBBLE_SECONDS;
  }

  /** `e` noticed the player: its pack mates nearby join in. */
  alert(e: Enemy): void {
    const pack = this.packOf.get(e);
    if (!pack) return;
    const r2 = this.packAggroRadius * this.packAggroRadius;
    for (let i = 0; i < pack.members.length; i++) {
      const m = pack.members[i] as Enemy;
      if (m === e || !m.alive || m.engaged) continue;
      const dx = m.x - e.x;
      const dz = m.z - e.z;
      if (dx * dx + dz * dz <= r2) engage(m);
    }
  }

  /** Pushes a walking circle out of every shown, standing enemy (you cannot walk through). */
  pushOut(p: PointXZ, radius: number): boolean {
    let moved = false;
    for (let i = 0; i < this.shown.length; i++) {
      const e = this.shown[i] as Enemy;
      if (!e.alive) continue;
      const min = radius + e.radius;
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-6) {
        p.x = e.x + min;
      } else {
        p.x = e.x + (dx / d) * min;
        p.z = e.z + (dz / d) * min;
      }
      moved = true;
    }
    return moved;
  }

  /**
   * Everyone back at full strength (after the player was knocked out): packs at their spots,
   * calm, split slimes gone, dummies standing.
   */
  resetAll(): void {
    for (const pack of this.packs) {
      if (pack.night || pack.scripted) this.clearPack(pack);
      else this.spawnPack(pack);
    }
    for (const boss of this.bosses) this.endBoss(boss);
  }

  private addPack(
    id: string,
    def: MonsterDef,
    byId: ReadonlyMap<string, MonsterDef>,
    where: Pick<
      Pack,
      'x' | 'z' | 'radius' | 'wanderRadius' | 'respawnSeconds' | 'fixed' | 'night' | 'scripted'
    >,
  ): Pack {
    const seed = hashSeed(...Array.from(id, (c) => c.charCodeAt(0)));
    const size = def.groupSize?.max ?? 1;
    const pack: Pack = {
      ...where,
      def,
      members: [],
      children: [],
      timer: 0,
      rng: new Random(seed),
    };
    const childDef = def.splitsInto ? byId.get(def.splitsInto.monster) : undefined;
    for (let i = 0; i < size; i++) {
      pack.members.push(this.addEnemy(`${id}_${i}`, def, pack, seed + i));
      if (!childDef || !def.splitsInto) continue;
      for (let c = 0; c < def.splitsInto.count; c++) {
        const child = this.addEnemy(
          `${id}_${i}_split${c}`,
          childDef,
          pack,
          seed + 100 + i * 10 + c,
        );
        child.active = false;
        pack.children.push(child);
      }
    }
    this.packs.push(pack);
    return pack;
  }

  private addEnemy(id: string, def: MonsterDef, pack: Pack, seed: number): Enemy {
    const e = new Enemy(id, def, pack.x, pack.z, seed, pack.wanderRadius);
    e.speed = this.speeds[def.speed] ?? DEFAULT_SPEED;
    e.pack = this.packs.length;
    this.list.push(e);
    this.packOf.set(e, pack);
    return e;
  }

  /**
   * Puts a pack (back) in the world: a new spot in its area (fixed spots stay), a rolled pack
   * size, members around the spot.
   */
  private spawnPack(pack: Pack): void {
    const rng = pack.rng;
    let cx = pack.x;
    let cz = pack.z;
    if (!pack.fixed) {
      const angle = rng.next() * Math.PI * 2;
      // Keep the whole pack (and its roaming) inside the area.
      const r = Math.sqrt(rng.next()) * Math.max(0, pack.radius - pack.wanderRadius * 0.5);
      cx += Math.sin(angle) * r;
      cz += Math.cos(angle) * r;
    }
    const group = pack.def.groupSize;
    const count = group ? rng.int(group.min, group.max) : 1;
    for (let i = 0; i < pack.members.length; i++) {
      const e = pack.members[i] as Enemy;
      if (i >= count) {
        e.active = false;
        continue;
      }
      let x = cx;
      let z = cz;
      if (pack.members.length > 1) {
        const a = rng.next() * Math.PI * 2;
        x += Math.sin(a) * PACK_SPREAD * rng.next();
        z += Math.cos(a) * PACK_SPREAD * rng.next();
      }
      e.homeX = x;
      e.homeZ = z;
      e.spawn(x, z, pack.fixed ? 0 : rng.next() * Math.PI * 2);
      e.timer = rng.next() * this.ai.wanderPauseMax;
      if (this.world) {
        e.y = this.world.heightAt(x, z);
        e.settleY();
      }
    }
    for (const child of pack.children) child.active = false;
    pack.timer = 0;
  }

  /** Respawns: a pack whose monsters are all gone comes back after its time, out of sight. */
  private stepPacks(dt: number, px: number, pz: number): void {
    for (let i = 0; i < this.packs.length; i++) {
      const pack = this.packs[i] as Pack;
      if (
        pack.night ||
        pack.scripted ||
        pack.def.behavior === 'static' ||
        !Number.isFinite(pack.respawnSeconds)
      ) {
        continue;
      }
      if (anyActive(pack.members) || anyActive(pack.children)) {
        pack.timer = pack.respawnSeconds;
        continue;
      }
      pack.timer -= dt;
      if (pack.timer > 0) continue;
      const dx = pack.x - px;
      const dz = pack.z - pz;
      const away = pack.radius + this.respawnDistance;
      if (dx * dx + dz * dz < away * away) continue;
      this.spawnPack(pack);
    }
  }

  /**
   * The pooled monsters of one scripted fight: per wave, per entry, `count` slots for every
   * monster the entry may roll. They start out of the world; `spawnWave` puts a wave down.
   */
  private addWaveSet(fight: WaveFightDef, byId: ReadonlyMap<string, MonsterDef>): void {
    const seed = hashSeed(...Array.from(fight.id, (c) => c.charCodeAt(0)));
    const waves = fight.waves.map((wave, w) =>
      wave.monsters.map((entry, m) => ({
        count: entry.count,
        candidates: entry.monsters.map((monsterId, c) => {
          const def = byId.get(monsterId);
          if (!def) throw new Error(`Unknown monster "${monsterId}" in wave fight ${fight.id}`);
          const slots: WaveSlot[] = [];
          for (let i = 0; i < entry.count; i++) {
            const pack = this.addPack(`${fight.id}_${w}_${m}_${c}_${i}`, def, byId, {
              x: 0,
              z: 0,
              radius: 0,
              wanderRadius: 0,
              respawnSeconds: Infinity,
              fixed: true,
              night: false,
              scripted: true,
            });
            slots.push({ pack, enemy: pack.members[0] as Enemy });
          }
          return slots;
        }),
      })),
    );
    this.waveSets.set(fight.id, { waves, rng: new Random(seed) });
  }

  /** A night area: `maxAlive` pooled packs per monster entry, all out of the world at first. */
  private addNightArea(
    zone: Zone,
    def: NightSpawnDef,
    find: (zone: Zone, id: string) => MonsterDef,
    byId: ReadonlyMap<string, MonsterDef>,
    seed: number,
  ): void {
    const rules = this.rules;
    if (!rules) return;
    const packs = def.monsters.map((entry, m) => {
      const monster = find(zone, entry.monster);
      const list: Pack[] = [];
      for (let i = 0; i < def.maxAlive; i++) {
        list.push(
          this.addPack(`${def.id}_${m}_${i}`, monster, byId, {
            x: 0,
            z: 0,
            radius: 0,
            wanderRadius: rules.wanderRadius,
            respawnSeconds: def.respawnSeconds,
            fixed: true,
            night: true,
            scripted: false,
          }),
        );
      }
      return list;
    });
    const box = shapeBounds(def.shape, emptyBox());
    this.nightAreas.push({
      def,
      packs,
      totalWeight: def.monsters.reduce((sum, entry) => sum + entry.weight, 0),
      // Spread the first attempts so areas do not all try in the same step.
      timer: (this.nightAreas.length * 0.37) % rules.checkSeconds,
      rng: new Random(hashSeed(seed, this.nightAreas.length, def.maxAlive)),
      ...box,
    });
  }

  /** A pack out of the world (night packs before they appear, or after a knock-out). */
  private clearPack(pack: Pack): void {
    for (const e of pack.members) e.active = false;
    for (const child of pack.children) child.active = false;
    pack.timer = 0;
  }

  /** Tries a few random spots; the first good one gets a free pack of a monster picked by weight. */
  private trySpawn(area: NightArea, px: number, pz: number, world: SpawnWorld): void {
    const rules = this.rules;
    if (!rules) return;
    const rng = area.rng;
    const min2 = rules.minPlayerDistance ** 2;
    const max2 = rules.maxPlayerDistance ** 2;
    for (let i = 0; i < SPAWN_TRIES; i++) {
      const x = rng.range(area.minX, area.maxX);
      const z = rng.range(area.minZ, area.maxZ);
      if (!pointInShape(area.def.shape, x, z) || this.inSafeZone(x, z)) continue;
      const d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 < min2 || d2 > max2 || !world.canStand(x, z)) continue;
      const pack = this.freeNightPack(area);
      if (!pack) return;
      pack.x = x;
      pack.z = z;
      this.spawnPack(pack);
      for (const e of pack.members) {
        if (!e.active) continue;
        e.y = world.heightAt(e.x, e.z);
        e.settleY();
      }
      return;
    }
  }

  /** A pack of a monster picked by weight that is out of the world (null when all are in use). */
  private freeNightPack(area: NightArea): Pack | null {
    const monsters = area.def.monsters;
    let roll = area.rng.next() * area.totalWeight;
    let pick = monsters.length - 1;
    for (let m = 0; m < monsters.length; m++) {
      roll -= (monsters[m] as { weight: number }).weight;
      if (roll <= 0) {
        pick = m;
        break;
      }
    }
    const list = area.packs[pick] as Pack[];
    for (let p = 0; p < list.length; p++) {
      const pack = list[p] as Pack;
      if (pack.timer <= 0 && !anyActive(pack.members) && !anyActive(pack.children)) return pack;
    }
    return null;
  }

  /** A dying Big Slime becomes two Green Slimes that go straight for the player. */
  private split(e: Enemy): void {
    const pack = this.packOf.get(e);
    const split = e.def.splitsInto;
    if (!pack || !split) return;
    let made = 0;
    for (let i = 0; i < pack.children.length && made < split.count; i++) {
      const child = pack.children[i] as Enemy;
      if (child.active) continue;
      const side = made % 2 === 0 ? 1 : -1;
      const offset = SPLIT_OFFSET * (1 + Math.floor(made / 2));
      const x = e.x + Math.cos(e.heading) * offset * side;
      const z = e.z - Math.sin(e.heading) * offset * side;
      child.homeX = e.homeX;
      child.homeZ = e.homeZ;
      child.wanderRadius = e.wanderRadius;
      child.spawn(x, z, e.heading);
      child.y = e.y;
      child.settleY();
      engage(child);
      made++;
    }
  }

  /** Far away from the player: straight home, healed and calm. */
  private sendHome(e: Enemy): void {
    e.x = e.homeX;
    e.z = e.homeZ;
    e.hp = e.maxHp;
    e.mode = 'idle';
    e.timer = this.ai.wanderPauseMin;
    e.attackCount = 0;
  }

  /** Monsters do not stand inside each other, nor inside the player. */
  private separate(target: EnemyTarget): void {
    const list = this.moving;
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as Enemy;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j] as Enemy;
        const min = a.radius + b.radius;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * SEPARATION * 0.5;
        a.x -= dx * push;
        a.z -= dz * push;
        b.x += dx * push;
        b.z += dz * push;
      }
      const min = a.radius + target.radius;
      const dx = a.x - target.x;
      const dz = a.z - target.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      a.x = target.x + (dx / d) * min;
      a.z = target.z + (dz / d) * min;
    }
  }

  private inSafeArea(e: Enemy): boolean {
    const ids = e.def.safeAreas;
    if (!ids) return false;
    for (let i = 0; i < ids.length; i++) {
      const shape = this.safeAreas.get(ids[i] as string);
      if (shape && pointInShape(shape, e.x, e.z)) return true;
    }
    return false;
  }

  /** Training dummy: after a pause without hits (or after falling over) it is whole again. */
  private stepDummy(e: Enemy, dt: number): void {
    const reset = e.def.resetSeconds ?? DEFAULT_RESET_SECONDS;
    if (e.hp <= 0) {
      e.downTime = Math.max(0, e.downTime - dt);
      if (e.downTime === 0) e.hp = e.maxHp;
    } else if (e.hp < e.maxHp && e.sinceHit >= reset) {
      e.hp = e.maxHp;
    }
  }
}

function countAlive(list: readonly Enemy[]): number {
  let n = 0;
  for (let i = 0; i < list.length; i++) if ((list[i] as Enemy).alive) n++;
  return n;
}

function anyActive(list: readonly Enemy[]): boolean {
  for (let i = 0; i < list.length; i++) if ((list[i] as Enemy).active) return true;
  return false;
}
