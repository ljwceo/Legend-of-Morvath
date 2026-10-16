import { describe, expect, it } from 'vitest';
import { FixedStep } from '../core/Time';
import { monstersFileSchema } from '../data/schemas';
import type { MonstersFile, PlayerConfig } from '../data/types';
import { Enemy } from '../entities/Enemy';
import { readPublicJson } from '../test/loadPublic';
import type { PointXZ } from '../world/Colliders';
import { SpatialHash } from '../world/SpatialHash';
import { CollisionWorld } from './Collision';
import { enemyAiConfig, stepEnemyAi, type EnemyTarget, type EnemyWorld } from './EnemyAI';
import { movementConfig, MoverState, stepMovement, type Mover } from './Movement';

const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile;
const player = readPublicJson('data/player.json') as PlayerConfig;
const aiCfg = enemyAiConfig(monsters);
const moveCfg = movementConfig(player);
const open = new CollisionWorld(new SpatialHash());

const free: Mover = {
  moveCircle(p: PointXZ, _r: number, dx: number, dz: number) {
    p.x += dx;
    p.z += dz;
  },
};

const NEAR = 1.0;
const FAR = 30;
const IDS = ['green_slime', 'goblin'];

interface Result {
  /** Step numbers (0-based) in which damage reached the player. */
  hitSteps: number[];
  /** The steps in which each announcement began (the step that switched to 'windup'). */
  startSteps: number[];
  /** The steps in which each attack ended (mode left recovery). */
  endSteps: number[];
  /** The step in which the first announcement began. */
  startStep: number;
  dt: number;
  /** Phase lengths in whole fixed steps. */
  windup: number;
  hit: number;
  recovery: number;
}

interface Options {
  /** Distance (m) of the player in front of the monster, `k` steps after the announcement began. */
  distance?: (k: number, mode: string) => number;
  /** Step number at which the roll button goes down. */
  rollAt?: number;
  /** How many attacks in a row to run (default 1). */
  attacks?: number;
}

/**
 * Attacks of `id` against a player, at a display rate of `fps`, with the simulation on the
 * fixed 60 Hz step (as in the world loop). The roll uses the real MoverState and player.json.
 */
/** Whole fixed steps a phase lasts: it runs until its timer is used up (so it rounds up). */
function steps(seconds: number, dt: number): number {
  return Math.ceil(seconds / dt - 1e-9);
}

function simulate(id: string, fps: number, options: Options = {}): Result {
  const def = monsters.monsters.find((m) => m.id === id);
  if (!def?.ai) throw new Error(`missing monster ${id}`);
  const attack = def.ai.attack;
  const time = new FixedStep();
  const e = new Enemy('m', def, 0, 0, 1);
  e.spawn(0, 0, Math.PI / 2);
  e.mode = 'chase';
  e.cooldown = 0;
  const mover = new MoverState();
  mover.energy = moveCfg.maxEnergy;
  mover.sinceEnergySpent = 10;
  // Shooters keep their distance: stand where they want you, or they never attack.
  const base =
    def.ai.keepDistance === undefined ? NEAR : def.ai.keepDistance + (def.radius ?? 1) + 0.4 + 0.5;
  const target: EnemyTarget = { x: base, z: 0, radius: 0.4, hostile: true };
  const hitSteps: number[] = [];
  const startSteps: number[] = [];
  const endSteps: number[] = [];
  let step = 0;
  const world: EnemyWorld = {
    mover: free,
    hitPlayer: () => {
      if (!mover.invulnerable) hitSteps.push(step);
    },
    shoot: () => {},
    alert: () => {},
  };
  const wanted = options.attacks ?? 1;
  let finished = 0;
  let wasAttacking = false;
  for (let frame = 0; frame < fps * 20 && finished < wanted; frame++) {
    const n = time.advance(1 / fps);
    for (let i = 0; i < n && finished < wanted; i++) {
      stepMovement(mover, { x: 0, z: 0, dash: step === options.rollAt }, moveCfg, time.dt, open);
      const start = startSteps[startSteps.length - 1];
      const d = start === undefined ? base : (options.distance?.(step - start, e.mode) ?? base);
      target.x = e.x + d;
      target.z = e.z;
      stepEnemyAi(e, 0, aiCfg, target, world, time.dt);
      const mode = e.mode as string;
      const attacking = mode === 'windup' || mode === 'strike' || mode === 'recover';
      if (attacking && !wasAttacking) startSteps.push(step);
      if (!attacking && wasAttacking) {
        finished++;
        endSteps.push(step);
      }
      wasAttacking = attacking;
      step++;
    }
  }
  const dt = time.dt;
  return {
    hitSteps,
    startSteps,
    endSteps,
    startStep: startSteps[0] ?? -1,
    dt,
    windup: steps(attack.windupSeconds, dt),
    hit: steps(attack.hitSeconds, dt),
    recovery: steps(attack.recoverySeconds, dt),
  };
}

/** Runs the same scenario at 60 and 120 fps; the outcome must be identical, step for step. */
function both(id: string, options: Options = {}): Result {
  const a = simulate(id, 60, options);
  const b = simulate(id, 120, options);
  expect(b.hitSteps).toEqual(a.hitSteps);
  expect(b.startSteps).toEqual(a.startSteps);
  expect(b.endSteps).toEqual(a.endSteps);
  return a;
}

describe('enemy attack phases (announcement, hit window, recovery)', () => {
  // The announcement takes `windup` steps (k = 1..windup, the last one opens the window); the
  // hit window is then k = windup+1 .. windup+hit; from k = windup+hit+1 on it is recovery.
  for (const id of IDS) {
    describe(id, () => {
      it('has the phase lengths from data (whole steps)', () => {
        const r = simulate(id, 60);
        const def = monsters.monsters.find((m) => m.id === id);
        expect(r.windup).toBe(steps(def?.ai?.attack.windupSeconds ?? 0, r.dt));
        expect(r.hit).toBeGreaterThan(0);
      });

      it('hits once, inside the hit window', () => {
        const r = both(id);
        expect(r.hitSteps).toHaveLength(1);
        const k = (r.hitSteps[0] ?? -1) - r.startStep;
        expect(k).toBeGreaterThanOrEqual(r.windup + 1);
        expect(k).toBeLessThanOrEqual(r.windup + r.hit);
      });

      it('never hits a player who is in reach only during the announcement', () => {
        const r0 = simulate(id, 60);
        const r = both(id, { distance: (k) => (k <= r0.windup ? NEAR : FAR) });
        expect(r.hitSteps).toEqual([]);
      });

      it('never hits a player who is in reach only from the first step of the recovery', () => {
        const r0 = simulate(id, 60);
        const r = both(id, { distance: (k) => (k >= r0.windup + r0.hit + 1 ? NEAR : FAR) });
        expect(r.hitSteps).toEqual([]);
      });

      it('hits a player who is in reach only in the first step of the window', () => {
        const r0 = simulate(id, 60);
        const r = both(id, { distance: (k) => (k === r0.windup + 1 ? NEAR : FAR) });
        expect(r.hitSteps).toEqual([r0.startStep + r0.windup + 1]);
      });

      it('hits a player who is in reach only in the last step of the window', () => {
        const r0 = simulate(id, 60);
        const r = both(id, { distance: (k) => (k === r0.windup + r0.hit ? NEAR : FAR) });
        expect(r.hitSteps).toEqual([r0.startStep + r0.windup + r0.hit]);
      });

      it('does nothing to a player who steps away the moment the hit window opens', () => {
        const r = both(id, { distance: (_k, mode) => (mode === 'strike' ? FAR : NEAR) });
        expect(r.hitSteps).toEqual([]);
      });

      it('hits exactly once in each of two attacks in a row (the window resets)', () => {
        const r = both(id, { attacks: 2 });
        expect(r.startSteps).toHaveLength(2);
        expect(r.hitSteps).toHaveLength(2);
        for (let i = 0; i < 2; i++) {
          const k = (r.hitSteps[i] ?? -1) - (r.startSteps[i] ?? 0);
          expect(k).toBeGreaterThanOrEqual(r.windup + 1);
          expect(k).toBeLessThanOrEqual(r.windup + r.hit);
        }
      });

      it('a roll with the real invulnerable frames makes it miss, outside them it lands', () => {
        const base = both(id);
        const hitStep = base.hitSteps[0] ?? -1;
        const { startSeconds, endSeconds } = player.dash.iFrames;
        const inside = Math.round((startSeconds + endSeconds) / 2 / base.dt);
        // The hit falls in the middle of the roll's invulnerable frames: it misses.
        expect(both(id, { rollAt: hitStep - inside }).hitSteps).toEqual([]);
        // The roll starts only now (its frames have not begun): it lands.
        expect(both(id, { rollAt: hitStep }).hitSteps).toEqual([hitStep]);
        // The roll's frames were over long before: it lands.
        const late = Math.round((endSeconds + 0.2) / base.dt);
        expect(both(id, { rollAt: hitStep - late }).hitSteps).toEqual([hitStep]);
      });
    });
  }

  it('every attack ends exactly windup + hit + recovery steps after it began', () => {
    for (const m of monsters.monsters) {
      // Monsters without aggro radius (Treewarden) only fight when provoked: not simulated here.
      if (!m.ai || m.ai.aggroRadius <= 0) continue;
      const r = both(m.id);
      expect(r.startSteps, m.id).toHaveLength(1);
      // The very first attack is a special one only when the data says every attack is
      // (`everyNth` 1): that has its own warning and recovery and no separate hit window.
      const first = m.attacks?.find((a) => a.everyNth === 1 && a.areaRadius && !a.onlyWhenEnraged);
      const expected = first
        ? steps(first.warningSeconds, r.dt) +
          steps(first.recoverySeconds ?? m.ai.attack.recoverySeconds, r.dt)
        : r.windup + r.hit + r.recovery;
      expect((r.endSteps[0] ?? -1) - r.startStep, m.id).toBe(expected);
    }
  });

  it('every attack in the data has a hit window', () => {
    for (const m of monsters.monsters) {
      if (m.ai) expect(m.ai.attack.hitSeconds, m.id).toBeGreaterThan(0);
    }
  });
});
