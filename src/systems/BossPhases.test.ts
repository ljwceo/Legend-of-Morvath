import { describe, expect, it } from 'vitest';
import { monstersFileSchema } from '../data/schemas';
import type { MonstersFile, PlayerConfig } from '../data/types';
import { Enemy } from '../entities/Enemy';
import { readPublicJson } from '../test/loadPublic';
import type { PointXZ } from '../world/Colliders';
import { SpatialHash } from '../world/SpatialHash';
import { attackCueFor, newAttackCue } from './AttackCue';
import {
  type BossAttack,
  BossState,
  type BossWorld,
  keepInArena,
  startBoss,
  stepBoss,
} from './BossAI';
import { CollisionWorld } from './Collision';
import type { EnemyTarget } from './EnemyAI';
import { movementConfig, MoverState, stepMovement } from './Movement';
import type { Mover } from './Movement';

/**
 * S.8: Sultan's attacks in phases (announcement, hit window, recovery). Damage only falls in the
 * hit window, the windows are whole 60 Hz steps (the same at 60 and 120 Hz), and a simulated
 * player with the real roll (iFrames from player.json) dodges them.
 */
const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile;
const player = readPublicJson('data/player.json') as PlayerConfig;
const cfg = movementConfig(player);
const sultan = monsters.monsters.find((m) => m.id === 'sultan');
if (!sultan?.boss || !sultan.attacks) throw new Error('sultan missing');
const BOSS = sultan.boss;
const ARENA = BOSS.arena;
const open = new CollisionWorld(new SpatialHash());
const wall: Mover = { moveCircle() {} };

function attackDef(id: string): BossAttack {
  const a = sultan?.attacks?.find((x) => x.id === id);
  if (!a) throw new Error(id);
  return a;
}

interface Hit {
  step: number;
  damage: number;
  hitting: boolean;
  phase: string;
  attack: string;
  blocked: boolean;
}
type Policy = (d: Duel, cmd: { x: number; z: number; dash: boolean }) => void;

/** One fight with a player who moves with the real movement code (roll included). */
class Duel {
  readonly boss: Enemy;
  readonly state: BossState;
  readonly me = new MoverState();
  readonly target: EnemyTarget;
  readonly hits: Hit[] = [];
  readonly world: BossWorld;
  readonly dt: number;
  step = 0;
  /** Lengths in steps of every hit window (runs of `hitting`), in order. */
  readonly windows: number[] = [];
  readonly attacks: string[] = [];
  private run = 0;
  private lastPhase = '';
  damageTaken = 0;

  constructor(
    readonly hz: number,
    seed: number,
    readonly policy: Policy | null,
    readonly playerMover: Mover = open,
    enraged = false,
  ) {
    this.dt = 1 / hz;
    this.boss = new Enemy('boss', sultan as never, BOSS.start.x, BOSS.start.z, seed);
    this.boss.speed = monsters.speedClasses[sultan?.speed ?? 'fast'] ?? 4.5;
    this.state = new BossState(BOSS, ARENA);
    this.boss.boss = this.state;
    this.me.x = BOSS.playerStart.x;
    this.me.z = BOSS.playerStart.z;
    this.me.energy = cfg.maxEnergy;
    this.me.sinceEnergySpent = 10;
    this.target = { x: this.me.x, z: this.me.z, radius: cfg.radius, hostile: true };
    this.world = {
      mover: { moveCircle: (p: PointXZ, _r, dx, dz) => ((p.x += dx), (p.z += dz)) },
      hitPlayer: (_e, damage) => {
        const blocked = this.me.invulnerable;
        this.hits.push({
          step: this.step,
          damage,
          hitting: this.state.hitting,
          phase: this.state.phase,
          attack: this.state.attack?.id ?? '',
          blocked,
        });
        if (!blocked) this.damageTaken += damage;
      },
      bossEvent: (_e, kind, attack) => {
        if (kind === 'telegraph' && attack) this.attacks.push(attack.id);
      },
    };
    startBoss(this.boss, -Math.PI / 2);
    if (enraged) this.boss.hp = this.boss.maxHp * 0.4;
  }

  /** One fixed step, in the world's order: the player moves, then the boss acts. */
  tick(): void {
    const cmd = { x: 0, z: 0, dash: false };
    this.policy?.(this, cmd);
    stepMovement(this.me, cmd, cfg, this.dt, this.playerMover);
    keepInArena(this.me, ARENA, cfg.radius);
    this.target.x = this.me.x;
    this.target.z = this.me.z;
    this.boss.beginStep();
    stepBoss(this.boss, this.target, this.world, this.dt);
    // Bookkeeping of the hit windows.
    if (this.state.hitting) this.run++;
    else if (this.run > 0) {
      this.windows.push(this.run);
      this.run = 0;
    }
    this.lastPhase = this.state.phase;
    this.step++;
  }

  runFor(seconds: number): void {
    const steps = Math.round(seconds * this.hz);
    for (let i = 0; i < steps; i++) this.tick();
  }

  get phase(): string {
    return this.lastPhase;
  }
}

/** A player who rolls out of every attack at the moment the announcement runs low. */
const roller: Policy = (d, cmd) => {
  const b = d.state;
  const a = b.attack;
  if (!a || b.phase !== 'telegraph') return;
  const remaining = b.duration - b.elapsed;
  let lead: number;
  if (a.pattern === 'pounce') {
    // The leap is aimed in the last 0.3 s of the announcement: roll once it is locked.
    if (!b.aimed) return;
    lead = Infinity;
  } else if (a.pattern === 'charge') lead = 0.35;
  else lead = 0.15;
  if (remaining > lead) return;
  const bx = d.me.x - d.boss.x;
  const bz = d.me.z - d.boss.z;
  const len = Math.max(1e-6, Math.hypot(bx, bz));
  // Candidates: away from the claws first (combos), otherwise to either side; the first one
  // that stays inside the ring wins.
  const sx = -bz / len;
  const sz = bx / len;
  const away: [number, number] = [bx / len, bz / len];
  const candidates: [number, number][] =
    a.pattern === 'combo'
      ? [away, [sx, sz], [-sx, -sz]]
      : [
          [sx, sz],
          [-sx, -sz],
        ];
  const dist = player.dash.distance;
  const inside = (c: [number, number]) =>
    Math.hypot(d.me.x + c[0] * dist - ARENA.x, d.me.z + c[1] * dist - ARENA.z) < ARENA.radius - 0.5;
  const pick = candidates.find(inside) ?? candidates[0] ?? away;
  cmd.x = pick[0];
  cmd.z = pick[1];
  cmd.dash = true;
};

describe('Sultan: attack phases from data', () => {
  it('has a hit window in whole 60 Hz steps that fits between two swipes', () => {
    for (const id of ['claw_combo', 'pounce', 'flurry']) {
      const a = attackDef(id);
      expect(a.hitSeconds, id).toBeGreaterThan(0);
      const steps = (a.hitSeconds ?? 0) * 60;
      expect(Math.abs(steps - Math.round(steps)), id).toBeLessThan(1e-6);
      if (a.pattern === 'combo') {
        const fastest = (a.hitIntervalSeconds ?? 1) / (sultan?.enrage?.speedFactor ?? 1);
        expect(a.hitSeconds ?? 0, id).toBeLessThan(fastest);
      }
    }
    // The announcement and the recovery are in data too.
    for (const a of sultan?.attacks ?? []) {
      expect(a.warningSeconds, a.id).toBeGreaterThan(0);
      expect(a.recoverySeconds, a.id).toBeGreaterThan(0);
    }
  });

  it('hurts only inside a hit window, at 60 and 120 Hz, even for a player who stands still', () => {
    for (const hz of [60, 120]) {
      const d = new Duel(hz, 7, null, open, true);
      d.runFor(90);
      expect(d.hits.length).toBeGreaterThan(8);
      for (const h of d.hits) {
        expect(h.hitting).toBe(true);
        expect(h.phase).toBe('attack');
      }
      // The four attacks all hurt a player who does nothing.
      const seen = new Set(d.hits.map((h) => h.attack));
      for (const id of ['claw_combo', 'pounce', 'dash_strike', 'flurry']) {
        expect(seen.has(id), `${id} at ${hz} Hz`).toBe(true);
      }
    }
  });

  it('never has an open hit window outside the attack phase', () => {
    const d = new Duel(60, 3, null, open, true);
    for (let i = 0; i < 60 * 60; i++) {
      d.tick();
      if (d.state.hitting) expect(d.state.phase).toBe('attack');
      if (d.state.phase === 'telegraph' || d.state.phase === 'retreat') {
        expect(d.state.hitting).toBe(false);
      }
    }
  });

  it('swipes and landings have a window of exactly hitSeconds, the same at 60 and 120 Hz', () => {
    const swipe = attackDef('claw_combo').hitSeconds ?? 0;
    for (const hz of [60, 120]) {
      const d = new Duel(hz, 5, null, open, true);
      d.runFor(90);
      const seconds = d.windows.map((w) => w / hz);
      expect(seconds.length).toBeGreaterThan(10);
      // Swipes and landings: exactly the data. Runs (charges) last their travel time.
      const charge = attackDef('dash_strike').travelSeconds ?? 0;
      for (const sec of seconds) {
        const ok = Math.abs(sec - swipe) < 1e-9 || Math.abs(sec - charge) < 1 / 60 + 1e-9;
        expect(ok, `${sec} s at ${hz} Hz`).toBe(true);
      }
    }
  });

  it('60 and 120 Hz give the same attacks in the same order', () => {
    const a = new Duel(60, 9, null, open, true);
    const b = new Duel(120, 9, null, open, true);
    a.runFor(60);
    b.runFor(60);
    const n = Math.min(a.attacks.length, b.attacks.length);
    expect(n).toBeGreaterThan(8);
    expect(b.attacks.slice(0, n)).toEqual(a.attacks.slice(0, n));
  });
});

describe('Sultan: a rolling player dodges him', () => {
  it('takes no damage over a long fight, normal and enraged, at 60 and 120 Hz', () => {
    for (const hz of [60, 120]) {
      for (const enraged of [false, true]) {
        const d = new Duel(hz, 11, roller, open, enraged);
        d.runFor(120);
        expect(d.attacks.length, `${hz} Hz`).toBeGreaterThan(12);
        if (enraged) expect(d.attacks).toContain('flurry');
        for (const id of ['claw_combo', 'pounce', 'dash_strike']) {
          expect(d.attacks, id).toContain(id);
        }
        expect(
          d.hits.filter((h) => !h.blocked).map((h) => h.attack),
          `${hz} Hz enraged=${enraged}`,
        ).toEqual([]);
      }
    }
  });

  it('the same fight without rolling does hurt', () => {
    const d = new Duel(60, 11, null, open, true);
    d.runFor(120);
    expect(d.damageTaken).toBeGreaterThan(50);
  });

  it('a roll that cannot move still dodges the landing through its iFrames alone', () => {
    // The player is pinned against a wall (the roll does not move him), so only the
    // invulnerable frames can save him. Find the first step Sultan's pounce lands, then roll
    // `k` steps before it and see which rolls dodge.
    const first = (hz: number): number => {
      const d = forcedPounce(hz, null);
      for (let i = 0; i < hz * 20 && d.hits.length === 0; i++) d.tick();
      return d.hits[0]?.step ?? -1;
    };
    const landing = new Map<number, number>([
      [60, first(60)],
      [120, first(120)],
    ]);
    expect(landing.get(60)).toBeGreaterThan(0);
    const avoided: Record<number, number[]> = { 60: [], 120: [] };
    for (const hz of [60, 120]) {
      const w = landing.get(hz) ?? 0;
      for (let k = 0; k <= Math.round(0.4 * hz); k++) {
        const d = forcedPounce(hz, w - k);
        for (let i = 0; i < w + hz; i++) d.tick();
        const hit = d.hits.find((h) => !h.blocked);
        if (!hit) avoided[hz]?.push(k / hz);
      }
    }
    const { startSeconds, endSeconds } = player.dash.iFrames;
    for (const hz of [60, 120]) {
      const list = avoided[hz] ?? [];
      expect(list.length, `${hz} Hz`).toBeGreaterThan(0);
      // The roll dodges only when its window covers the moment of contact.
      for (const t of list) {
        const elapsed = t + 1 / hz;
        expect(elapsed >= startSeconds - 1e-6 && elapsed <= endSeconds + 1e-6, `${t}`).toBe(true);
      }
    }
    // Both rates dodge the same stretch of seconds, give or take one 60 Hz step at the edges.
    const a = avoided[60] ?? [];
    const b = avoided[120] ?? [];
    expect(Math.abs(Math.min(...a) - Math.min(...b))).toBeLessThanOrEqual(1 / 60 + 1e-9);
    expect(Math.abs(Math.max(...a) - Math.max(...b))).toBeLessThanOrEqual(1 / 60 + 1e-9);
  });
});

/** A fight where the pounce is forced and the player rolls (in place) on step `rollAt`. */
function forcedPounce(hz: number, rollAt: number | null): Duel {
  const d = new Duel(
    hz,
    21,
    (duel, cmd) => {
      const s = duel.state;
      if (s.phase === 'stalk' && s.attack?.id !== 'pounce') s.attack = attackDef('pounce');
      if (duel.step === rollAt) {
        cmd.dash = true;
        cmd.x = 1;
      }
    },
    wall,
  );
  // Close enough to be hit by the pounce at the player's feet.
  return d;
}

describe('Sultan: announcement cue and poise', () => {
  it('shows a cue while announcing, as long as warningSeconds', () => {
    const d = new Duel(60, 4, null);
    const cue = newAttackCue();
    expect(attackCueFor(d.boss, cue).shape).toBe('none');
    const seen = new Map<string, { shape: string; seconds: number; last: number }>();
    for (let i = 0; i < 60 * 40; i++) {
      d.tick();
      attackCueFor(d.boss, cue);
      const id = d.state.attack?.id ?? '';
      if (d.state.phase !== 'telegraph') {
        expect(cue.shape, `outside the announcement`).toBe('none');
        continue;
      }
      if (cue.shape === 'none') {
        expect(d.state.attack?.pattern).toBe('charge');
        continue;
      }
      expect(cue.seconds).toBeCloseTo(attackDef(id).warningSeconds, 6);
      expect(cue.progress).toBeGreaterThanOrEqual(0);
      expect(cue.progress).toBeLessThanOrEqual(1);
      seen.set(id, { shape: cue.shape, seconds: cue.seconds, last: cue.progress });
    }
    expect(seen.get('claw_combo')?.shape).toBe('disc');
    expect(seen.get('pounce')?.shape).toBe('line');
  });

  it('has poise: breaking it in the opening makes the opening one stagger longer', async () => {
    const { Enemies } = await import('./Enemies');
    const { zonesFileSchema } = await import('../data/schemas');
    const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
    const enemies = new Enemies(zones.zones, monsters, { showRadius: 160, hideMargin: 20 });
    const boss = enemies.bossOf('sultan') as Enemy;
    enemies.startBoss(boss, 0);
    const state = boss.boss as BossState;
    expect(boss.poise.max).toBe(sultan?.poise);
    // Guarded: no hit at all in the world (the scene checks `hittable`); in the opening:
    boss.guarded = false;
    state.phase = 'opening';
    state.duration = 1;
    const stagger = monsters.settings.poise.staggerSeconds;
    expect(enemies.hit(boss, 1, (sultan?.poise ?? 0) - 1)).toBe(false);
    expect(state.duration).toBe(1);
    expect(enemies.hit(boss, 1, 1)).toBe(false);
    expect(state.duration).toBeCloseTo(1 + stagger, 9);
    expect(boss.poise.staggered).toBe(true);
    // Staggered: no second extension.
    enemies.hit(boss, 1, 1000);
    expect(state.duration).toBeCloseTo(1 + stagger, 9);
  });
});
