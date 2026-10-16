import { describe, expect, it } from 'vitest';
import { monstersFileSchema, zonesFileSchema } from '../data/schemas';
import type { MonstersFile, PlayerConfig } from '../data/types';
import { Enemy } from '../entities/Enemy';
import { readPublicJson } from '../test/loadPublic';
import type { PointXZ } from '../world/Colliders';
import {
  type BossAttack,
  type BossEventKind,
  BossState,
  type BossWorld,
  keepInArena,
  segmentDistance,
  startBoss,
  stepBoss,
} from './BossAI';
import type { EnemyTarget } from './EnemyAI';
import { Enemies, type EnemiesWorld } from './Enemies';
import { angleDelta } from './Movement';
import { backstabPoiseDamage } from './Poise';
import { inSwingArc, swordConfig } from './Combat';

const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile;
const playerCfg = readPublicJson('data/player.json') as PlayerConfig;
const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const sultan = monsters.monsters.find((m) => m.id === 'sultan');
if (!sultan?.boss) throw new Error('sultan with boss settings missing');
const BOSS = sultan.boss;
const ARENA = BOSS.arena;

function attackDef(id: string): BossAttack {
  const a = sultan?.attacks?.find((entry) => entry.id === id);
  if (!a) throw new Error(`missing attack ${id}`);
  return a;
}

interface Hit {
  time: number;
  damage: number;
}

/** A boss fight on flat open ground: records hits on the player and boss events. */
class Fight {
  readonly boss: Enemy;
  readonly state: BossState;
  readonly target: EnemyTarget = {
    x: BOSS.playerStart.x,
    z: BOSS.playerStart.z,
    radius: 0.4,
    hostile: true,
  };
  readonly hits: Hit[] = [];
  readonly events: { time: number; kind: BossEventKind; attack: string | null }[] = [];
  time = 0;
  readonly world: BossWorld;

  constructor(seed = 7) {
    this.boss = new Enemy('boss', sultan as never, BOSS.start.x, BOSS.start.z, seed);
    this.boss.speed = monsters.speedClasses[sultan?.speed ?? 'fast'] ?? 4.5;
    this.state = new BossState(BOSS, ARENA);
    this.boss.boss = this.state;
    this.world = {
      mover: {
        moveCircle(p: PointXZ, _r: number, dx: number, dz: number) {
          p.x += dx;
          p.z += dz;
        },
      },
      hitPlayer: (_e, damage) => this.hits.push({ time: this.time, damage }),
      bossEvent: (_e, kind, attack) =>
        this.events.push({ time: this.time, kind, attack: attack?.id ?? null }),
    };
    startBoss(this.boss, -Math.PI / 2);
  }

  /** Runs `seconds` at `hz`; `each` may move the player before every step. */
  run(seconds: number, hz = 60, each?: (f: Fight, dt: number) => void): void {
    const dt = 1 / hz;
    const steps = Math.round(seconds * hz);
    for (let i = 0; i < steps; i++) {
      each?.(this, dt);
      this.boss.beginStep();
      stepBoss(this.boss, this.target, this.world, dt);
      this.time += dt;
    }
  }

  /** Runs until the boss starts winding up `attackId` (forced as its next attack). */
  until(predicate: (f: Fight) => boolean, maxSeconds = 20, hz = 60): void {
    const dt = 1 / hz;
    for (let t = 0; t < maxSeconds; t += dt) {
      if (predicate(this)) return;
      this.run(dt, hz);
    }
    throw new Error('condition never reached');
  }

  /** Makes `id` the next attack (as if it was rolled). */
  force(id: string): void {
    this.until((f) => f.state.phase === 'stalk');
    this.state.attack = attackDef(id);
  }
}

describe('boss fight (Sultan)', () => {
  it('has the numbers from the concept', () => {
    expect(sultan?.hp).toBe(800);
    expect(attackDef('claw_combo').damage).toBe(12);
    expect(attackDef('pounce').damage).toBe(15);
    expect(attackDef('dash_strike').damage).toBe(15);
    expect(attackDef('flurry').hits).toBe(5);
    expect(attackDef('flurry').recoverySeconds).toBe(2);
    expect(BOSS.vulnerableSeconds).toBe(1);
  });

  it('can only be hit in the opening after an attack, which lasts a second', () => {
    const f = new Fight();
    let guardedSteps = 0;
    let openSteps = 0;
    f.run(30, 60, (fight) => {
      if (fight.boss.guarded) guardedSteps++;
      else {
        openSteps++;
        expect(fight.state.phase).toBe('opening');
      }
    });
    const openings = f.events.filter((e) => e.kind === 'opening');
    expect(openings.length).toBeGreaterThanOrEqual(4);
    // About 1 s of every cycle (60 steps at 60 Hz); the rest it dodges everything.
    expect(openSteps / openings.length).toBeGreaterThan(55);
    expect(openSteps / openings.length).toBeLessThan(65);
    expect(guardedSteps).toBeGreaterThan(openSteps);
  });

  it('warns before every attack, then attacks, leaps away and stands still', () => {
    const f = new Fight();
    const phases: string[] = [];
    f.run(25, 60, (fight) => {
      if (phases[phases.length - 1] !== fight.state.phase) phases.push(fight.state.phase);
    });
    const cycle = phases.join(' ');
    expect(cycle).toContain('stalk telegraph attack retreat opening stalk');
    // Never an attack without a warning first.
    for (let i = 0; i < phases.length; i++) {
      if (phases[i] === 'attack') expect(phases[i - 1]).toBe('telegraph');
    }
  });

  it('hits a player who just stands there with every attack', () => {
    for (const id of ['claw_combo', 'pounce', 'dash_strike']) {
      const f = new Fight();
      f.force(id);
      f.until((fight) => fight.state.phase === 'opening');
      expect(f.hits.length, id).toBeGreaterThan(0);
      expect(f.hits[0]?.damage, id).toBe(attackDef(id).damage);
    }
  });

  it('gives time to get away from the Claw Combo (walking away during the glow)', () => {
    const f = new Fight();
    f.force('claw_combo');
    f.until((fight) => fight.state.phase === 'telegraph');
    // Walk away from him at 4 m/s from the moment the claws light up.
    f.until((fight) => {
      const dx = fight.target.x - fight.boss.x;
      const dz = fight.target.z - fight.boss.z;
      const d = Math.hypot(dx, dz);
      fight.target.x += (dx / d) * 4 * (1 / 60);
      fight.target.z += (dz / d) * 4 * (1 / 60);
      keepInArena(fight.target, ARENA, 0.4);
      return fight.state.phase === 'opening';
    }, 10);
    expect(f.hits).toEqual([]);
  });

  it('dodging the Pounce: stepping sideways once he crouches', () => {
    const f = new Fight();
    f.force('pounce');
    f.until((fight) => fight.state.phase === 'telegraph');
    expect(attackDef('pounce').warningSeconds).toBeGreaterThanOrEqual(0.6);
    // Wait until the aim is fixed, then dash 4 m sideways.
    f.until((fight) => fight.state.aimed);
    const dx = f.boss.x - f.target.x;
    const dz = f.boss.z - f.target.z;
    const d = Math.hypot(dx, dz);
    f.target.x += (-dz / d) * 4;
    f.target.z += (dx / d) * 4;
    f.until((fight) => fight.state.phase === 'opening');
    expect(f.hits).toEqual([]);
  });

  it('dodging the Dash Strike: stepping off the red line', () => {
    const f = new Fight();
    f.force('dash_strike');
    f.until((fight) => fight.state.phase === 'telegraph');
    const s = f.state;
    // The line runs from the boss through the player.
    expect(segmentDistance(f.target.x, f.target.z, s.fromX, s.fromZ, s.toX, s.toZ)).toBeLessThan(
      0.5,
    );
    // Two meters to the side is off the line.
    f.target.x += -s.dirZ * 2;
    f.target.z += s.dirX * 2;
    f.until((fight) => fight.state.phase === 'opening');
    expect(f.hits).toEqual([]);
  });

  it('runs the same at 60 and 120 Hz', () => {
    const a = new Fight(3);
    const b = new Fight(3);
    a.run(20, 60);
    b.run(20, 120);
    expect(b.hits.length).toBe(a.hits.length);
    expect(b.events.map((e) => e.attack)).toEqual(a.events.map((e) => e.attack));
    for (let i = 0; i < a.hits.length; i++) {
      expect(Math.abs((b.hits[i]?.time ?? 0) - (a.hits[i]?.time ?? 0))).toBeLessThan(0.1);
    }
  });

  it('gets faster below half HP and adds Flurry, with a longer opening after it', () => {
    const f = new Fight(11);
    f.run(1);
    f.boss.hp = 390;
    f.run(1 / 60);
    expect(f.state.enraged).toBe(true);
    expect(f.events.some((e) => e.kind === 'enraged')).toBe(true);
    f.run(60);
    const attacks = f.events.filter((e) => e.kind === 'telegraph').map((e) => e.attack);
    expect(attacks).toContain('flurry');
    // Flurry every 3rd attack once enraged.
    const flurries = attacks.filter((a) => a === 'flurry').length;
    expect(flurries).toBeGreaterThanOrEqual(Math.floor(attacks.length / 3) - 1);
    // After a Flurry he stands still (out of breath) for 2 s.
    const after = new Fight(11);
    after.boss.hp = 390;
    after.run(1 / 60);
    after.force('flurry');
    after.until((fight) => fight.state.phase === 'opening');
    let open = 0;
    after.until((fight) => {
      if (fight.state.phase === 'opening') open++;
      return fight.state.phase === 'stalk';
    });
    expect(open / 60).toBeCloseTo(2, 1);
  });

  it('never leaves the arena', () => {
    const f = new Fight(5);
    let maxD = 0;
    f.run(60, 60, (fight) => {
      // The player runs in circles along the edge.
      const angle = fight.time * 0.4;
      fight.target.x = ARENA.x + Math.sin(angle) * (ARENA.radius - 1);
      fight.target.z = ARENA.z + Math.cos(angle) * (ARENA.radius - 1);
      maxD = Math.max(maxD, Math.hypot(fight.boss.x - ARENA.x, fight.boss.z - ARENA.z));
    });
    expect(maxD).toBeLessThanOrEqual(ARENA.radius - (sultan?.radius ?? 0) + 1e-6);
  });

  it('stops attacking while the player is down', () => {
    const f = new Fight();
    f.target.hostile = false;
    f.run(10);
    expect(f.hits).toEqual([]);
    expect(f.state.phase).toBe('idle');
    expect(f.boss.guarded).toBe(true);
  });

  it('is part of the enemy pool, only in the world during its fight', () => {
    const enemies = new Enemies(zones.zones, monsters, { showRadius: 160, hideMargin: 20 });
    const boss = enemies.bossOf('sultan');
    if (!boss) throw new Error('no boss slot');
    expect(boss.active).toBe(false);
    const target: EnemyTarget = {
      x: BOSS.playerStart.x,
      z: BOSS.playerStart.z,
      radius: 0.4,
      hostile: true,
    };
    const world: EnemiesWorld = {
      mover: { moveCircle: (p, _r, dx, dz) => ((p.x += dx), (p.z += dz)) },
      heightAt: () => 0,
      hitPlayer: () => {},
      shoot: () => {},
      alert: () => {},
      bossEvent: () => {},
    };
    enemies.step(1 / 60, target, world);
    expect(enemies.shown).not.toContain(boss);
    enemies.startBoss(boss, 0);
    enemies.step(1 / 60, target, world);
    expect(enemies.shown).toContain(boss);
    expect(boss.hittable).toBe(false);
    // In an opening it can be hit; 800 HP later it is defeated and leaves.
    boss.guarded = false;
    expect(enemies.hit(boss, 100)).toBe(false);
    expect(boss.hp).toBe(700);
    expect(enemies.hit(boss, 700)).toBe(true);
    for (let i = 0; i < 300; i++) enemies.step(1 / 60, target, world);
    expect(boss.active).toBe(false);
    // Losing (resetAll after dying) also takes it out of the world.
    enemies.startBoss(boss, 0);
    enemies.resetAll();
    expect(boss.active).toBe(false);
  });
});

describe('boss last stand (Sultan backs off to the barrel)', () => {
  const lastStand = BOSS.lastStand;
  if (!lastStand) throw new Error('sultan has no lastStand');
  const stand = lastStand;

  /** Distance from the boss to its last stand at the start of every opening. */
  function openings(f: Fight, seconds: number): number[] {
    const out: number[] = [];
    f.run(seconds, 60, (fight) => {
      if (fight.state.phase === 'opening' && fight.state.elapsed === 0) {
        out.push(Math.hypot(fight.boss.x - stand.x, fight.boss.z - stand.z));
      }
    });
    return out;
  }

  it('leaps away from you while it has HP to spare', () => {
    const f = new Fight();
    const near = openings(f, 20).filter((d) => d < 0.5);
    expect(near.length).toBe(0);
  });

  it('low on HP it leaps back to its last stand after every attack', () => {
    const f = new Fight();
    f.boss.hp = f.boss.maxHp * stand.belowHpFraction - 1;
    const distances = openings(f, 30);
    expect(distances.length).toBeGreaterThanOrEqual(3);
    expect(distances.every((d) => d < 0.01)).toBe(true);
  });

  it('a long leap back takes longer than a short one (no teleport)', () => {
    const f = new Fight();
    f.boss.hp = f.boss.maxHp * stand.belowHpFraction - 1;
    f.until((fight) => fight.state.phase === 'retreat');
    const far = Math.hypot(f.state.toX - f.state.fromX, f.state.toZ - f.state.fromZ);
    expect(f.state.duration).toBeGreaterThanOrEqual(BOSS.retreatSeconds);
    expect(far / f.state.duration).toBeLessThanOrEqual(18.001);
  });

  it('lands on its last stand at 60 and 120 Hz alike', () => {
    for (const hz of [60, 120]) {
      const f = new Fight();
      f.boss.hp = f.boss.maxHp * stand.belowHpFraction - 1;
      f.until((fight) => fight.state.phase === 'opening', 20, hz);
      expect(Math.hypot(f.boss.x - stand.x, f.boss.z - stand.z)).toBeLessThan(0.01);
    }
  });
});

describe('boss turn speed per phase (Sultan can be walked round)', () => {
  const turn = BOSS.turnDegreesPerSecond;
  const poise = monsters.settings.poise;
  const DEG = Math.PI / 180;
  const PHASE_RATE: Record<string, number> = {
    stalk: turn.stalk,
    telegraph: turn.telegraph,
    attack: turn.attack,
    retreat: 0,
    opening: turn.recovery,
    idle: 0,
  };

  it('is slower in the warning and the hit window than while stalking', () => {
    expect(turn.telegraph).toBeLessThan(turn.stalk);
    expect(turn.attack).toBeLessThanOrEqual(turn.telegraph);
  });

  it('never turns faster than the data says in any phase, at 60 and 120 Hz', () => {
    for (const hz of [60, 120]) {
      const f = new Fight();
      const dt = 1 / hz;
      let angle = 0;
      let worst = 0;
      let before: number;
      let phase = 'idle';
      for (let i = 0; i < 40 * hz; i++) {
        angle += 3 * dt;
        f.target.x = f.boss.x + Math.sin(angle) * 2.5;
        f.target.z = f.boss.z + Math.cos(angle) * 2.5;
        keepInArena(f.target, ARENA, 0.4);
        before = f.boss.heading;
        f.run(dt, hz);
        // The phase the step ran in is the one before it, or the new one for a phase that began
        // in this step: take the larger of the two limits.
        const limit = Math.max(PHASE_RATE[phase] ?? 0, PHASE_RATE[f.state.phase] ?? 0);
        const turned = Math.abs(angleDelta(before, f.boss.heading)) / DEG / dt;
        if (turned > limit + 1e-6) worst = Math.max(worst, turned);
        phase = f.state.phase;
      }
      expect(worst, `${hz} Hz`).toBe(0);
    }
  });

  it('a player who rolls round him gets behind him and hits his back in the opening', () => {
    const sword = swordConfig(playerCfg);
    const roll = playerCfg.dash;
    const rollSpeed = roll.distance / roll.durationSeconds;
    for (const hz of [60, 120]) {
      const f = new Fight();
      f.force('claw_combo');
      f.until((fight) => fight.state.phase === 'telegraph', 20, hz);
      const dt = 1 / hz;
      // Rolls again whenever the dash is ready (cooldown from data), like a player would.
      let sinceRoll = 0;
      let backstabbed = false;
      f.until(
        (fight) => {
          const boss = fight.boss;
          const me = fight.target;
          // Walks (or rolls) round him on a ring of 1.6 m between the centres to the spot straight
          // behind him: never through him. First the distance to the ring, then the arc.
          if (sinceRoll >= roll.cooldownSeconds) sinceRoll = 0;
          const speed = sinceRoll < roll.durationSeconds ? rollSpeed : playerCfg.movement.walkSpeed;
          sinceRoll += dt;
          let budget = speed * dt;
          const ring = 1.6;
          const now = Math.atan2(me.x - boss.x, me.z - boss.z);
          let r = Math.hypot(me.x - boss.x, me.z - boss.z);
          const radial = Math.max(-budget, Math.min(budget, ring - r));
          r += radial;
          budget -= Math.abs(radial);
          const want = angleDelta(now, boss.heading + Math.PI);
          const arc = Math.max(-budget / r, Math.min(budget / r, want));
          me.x = boss.x + Math.sin(now + arc) * r;
          me.z = boss.z + Math.cos(now + arc) * r;
          // Bodies do not overlap: push the player out of Sultan (like Enemies.separate).
          const ox = me.x - boss.x;
          const oz = me.z - boss.z;
          const od = Math.hypot(ox, oz);
          const min = me.radius + boss.radius;
          if (od < min && od > 1e-6) {
            me.x = boss.x + (ox / od) * min;
            me.z = boss.z + (oz / od) * min;
          }
          keepInArena(me, ARENA, me.radius);
          expect(Math.hypot(me.x - boss.x, me.z - boss.z)).toBeGreaterThanOrEqual(min - 1e-9);
          if (fight.state.phase !== 'opening') return false;
          // The player swings at his back, facing him.
          const facing = Math.atan2(boss.x - me.x, boss.z - me.z);
          const reaches = inSwingArc(
            me.x,
            me.z,
            facing,
            boss.x,
            boss.z,
            boss.radius,
            sword.range,
            sword.halfArc,
          );
          if (!reaches) return false;
          const amount = backstabPoiseDamage(
            10,
            boss.x,
            boss.z,
            boss.heading,
            me.x,
            me.z,
            poise.backstabAngleDegrees,
            poise.backstabFactor,
          );
          expect(boss.hittable).toBe(true);
          backstabbed = amount === 10 * poise.backstabFactor;
          return true;
        },
        10,
        hz,
      );
      // No swipe ever caught the player, and the back was open in the opening.
      expect(f.hits, `${hz} Hz`).toEqual([]);
      expect(backstabbed, `${hz} Hz`).toBe(true);
    }
  });
});
