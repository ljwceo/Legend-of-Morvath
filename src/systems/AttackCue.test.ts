import { describe, expect, it } from 'vitest';
import { FixedStep } from '../core/Time';
import { monstersFileSchema } from '../data/schemas';
import type { MonstersFile } from '../data/types';
import { Enemy } from '../entities/Enemy';
import { readPublicJson } from '../test/loadPublic';
import { attackCueFor, newAttackCue } from './AttackCue';
import { windupSeconds } from './EnemyAI';

const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile;
const DT = 1 / 60;

function windingUp(id: string): Enemy {
  const def = monsters.monsters.find((m) => m.id === id);
  if (!def) throw new Error(id);
  const e = new Enemy('m', def, 0, 0, 1);
  e.spawn(0, 0, 0);
  e.mode = 'windup';
  e.attackKind = 'normal';
  e.attackCount = 1;
  e.timer = windupSeconds(e);
  return e;
}

describe('attack cues', () => {
  it('every monster with a normal attack announces it with a cue of the data duration', () => {
    const cue = newAttackCue();
    let checked = 0;
    for (const def of monsters.monsters) {
      if (!def.ai) continue;
      const e = windingUp(def.id);
      attackCueFor(e, cue);
      expect(cue.shape, def.id).not.toBe('none');
      expect(cue.seconds, def.id).toBe(def.ai.attack.windupSeconds);
      expect(cue.progress).toBe(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('shows no cue outside the announcement', () => {
    const cue = newAttackCue();
    const e = windingUp('green_slime');
    for (const mode of ['chase', 'strike', 'recover', 'idle'] as const) {
      e.mode = mode;
      expect(attackCueFor(e, cue).shape).toBe('none');
    }
  });

  it('green slime shows a line and goblin a disc, sized from data', () => {
    const cue = newAttackCue();
    const slime = windingUp('green_slime');
    attackCueFor(slime, cue);
    expect(cue.shape).toBe('line');
    expect(cue.length).toBe(slime.def.ai?.attack.lungeDistance);
    const goblin = windingUp('goblin');
    attackCueFor(goblin, cue);
    expect(cue.shape).toBe('disc');
    expect(cue.radius).toBeCloseTo(goblin.radius + (goblin.def.ai?.attack.range ?? 0));
  });

  it('shows the cue for the data duration and the same progress per step at 60 and 120 fps', () => {
    const cue = newAttackCue();
    /**
     * Runs the announcement through a FixedStep accumulator at a display rate of `fps` and records
     * the progress after every simulation step in which the cue is still visible.
     */
    const run = (id: string, fps: number): number[] => {
      const time = new FixedStep();
      const e = windingUp(id);
      const progress: number[] = [];
      for (let frame = 0; frame < 600 && e.mode === 'windup'; frame++) {
        const n = time.advance(1 / fps);
        for (let i = 0; i < n && e.mode === 'windup'; i++) {
          e.timer -= time.dt;
          if (e.timer <= 1e-9) e.mode = 'strike';
          attackCueFor(e, cue);
          if (cue.shape !== 'none') progress.push(cue.progress);
        }
      }
      return progress;
    };
    for (const id of ['green_slime', 'goblin']) {
      const seconds = monsters.monsters.find((m) => m.id === id)?.ai?.attack.windupSeconds ?? 0;
      const at60 = run(id, 60);
      const at120 = run(id, 120);
      // The cue is visible for the announcement time from the data (the last step starts the hit).
      expect((at60.length + 1) * DT).toBeCloseTo(Math.ceil(seconds / DT - 1e-9) * DT, 9);
      expect(at60.length * DT).toBeLessThanOrEqual(seconds);
      expect(at60.length * DT).toBeGreaterThan(seconds - 2 * DT);
      // Same steps, same progress, whatever the display rate.
      expect(at120).toEqual(at60);
    }
  });

  it('takes only the enemy and the output object: no graphics preset, no frame time', () => {
    expect(attackCueFor.length).toBe(2);
    const a = newAttackCue();
    const b = newAttackCue();
    const e = windingUp('goblin');
    e.timer = 0.2;
    attackCueFor(e, a);
    attackCueFor(e, b);
    expect(b).toEqual(a);
  });

  it('shows the area of a special attack with its own warning time', () => {
    const cue = newAttackCue();
    const e = windingUp('goblin_chief');
    e.attackCount = 3;
    e.attackKind = 'special';
    e.timer = windupSeconds(e);
    attackCueFor(e, cue);
    expect(cue.shape).toBe('area');
    expect(cue.seconds).toBe(1.0);
    expect(cue.radius).toBe(3.5);
  });
});
