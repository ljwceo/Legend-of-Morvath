import { describe, expect, it } from 'vitest';
import { playerFileSchema, spellsFileSchema } from '../data/schemas';
import type { PlayerConfig, SpellsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { applyLevel, CombatState } from './Combat';
import {
  powerFactor,
  SHARD_ID,
  type ShotConfig,
  shotDamage,
  staffConfig,
  type StaffInput,
  type StaffResult,
  StaffState,
  stepStaff,
} from './StaffCombat';

const DT = 1 / 60;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
const cfg = staffConfig(player, spells);
const fireball = cfg.spells.get('fireball') as ShotConfig;

function fresh(level = 1): { state: StaffState; combat: CombatState } {
  const combat = new CombatState();
  applyLevel(combat, player, level);
  combat.hp = combat.maxHp;
  combat.mana = combat.maxMana;
  return { state: new StaffState(), combat };
}

const out = (): StaffResult => ({ fired: 'none', shot: null, damage: 0 });
const press = (shard: boolean, spell = false): StaffInput => ({ shard, spell });

/** Runs `seconds` of steps with the same input; returns every shot that left the staff. */
function run(
  made: ReturnType<typeof fresh>,
  seconds: number,
  input: StaffInput,
  spell: ShotConfig | null = fireball,
  power = 1,
): StaffResult[] {
  const fired: StaffResult[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const r = stepStaff(made.state, made.combat, input, cfg, spell, power, DT, out());
    if (r.fired !== 'none') fired.push({ ...r });
  }
  return fired;
}

describe('Arcane Shard', () => {
  it('costs no mana and leaves the staff after its wind-up', () => {
    const made = fresh();
    const before = made.combat.mana;
    const fired = run(made, 0.19, press(true));
    expect(fired).toHaveLength(0);
    expect(made.state.casting).toBe(true);
    const after = run(made, 0.05, press(false));
    expect(after).toHaveLength(1);
    expect(after[0]?.shot?.id).toBe(SHARD_ID);
    expect(made.combat.mana).toBe(before);
  });

  it('fires at its rate from player.json, not once per step', () => {
    const made = fresh();
    const fired = run(made, 1, press(true));
    expect(fired).toHaveLength(player.staff.shard.maxPerSecond);
  });

  it('does 8 damage at level 1 and +2 per level', () => {
    expect(shotDamage(cfg.shard, 1)).toBe(8);
    expect(shotDamage(cfg.shard, 5)).toBe(16);
  });
});

describe('spells', () => {
  it('cost mana once, up front, and fire after the wind-up', () => {
    const made = fresh();
    made.combat.mana = 50;
    const fired = run(made, 0.2, press(false, true));
    expect(fired).toHaveLength(0);
    expect(made.combat.mana).toBe(50 - fireball.manaCost);
    const landed = run(made, 0.3, press(false));
    expect(landed).toHaveLength(1);
    expect(landed[0]?.shot?.id).toBe('fireball');
    expect(made.combat.mana).toBe(50 - fireball.manaCost);
  });

  it('do nothing without enough mana (and say so), the Shard still works', () => {
    const made = fresh();
    made.combat.mana = fireball.manaCost - 1;
    expect(run(made, 0.5, press(false, true))).toHaveLength(0);
    expect(made.state.noMana).toBe(true);
    expect(made.combat.mana).toBe(fireball.manaCost - 1);
    expect(run(made, 0.5, press(true)).length).toBeGreaterThan(0);
  });

  it('keep their cooldown: holding the button does not cast every wind-up', () => {
    const made = fresh();
    made.combat.mana = 1000;
    const fired = run(made, 3, press(false, true));
    const cycle = fireball.windupSeconds + fireball.cooldownSeconds;
    expect(fired.length).toBeLessThanOrEqual(Math.ceil(3 / cycle));
    expect(fired.length).toBeGreaterThan(0);
    for (const shot of fired) expect(shot.fired).toBe('spell');
  });

  it('are not cast at all without a spell; the Shard takes over', () => {
    const made = fresh();
    expect(run(made, 0.6, press(false, true), null)).toHaveLength(0);
    expect(run(made, 0.6, press(true, true), null).every((r) => r.fired === 'shard')).toBe(true);
  });
});

describe('power curves (light and dark)', () => {
  it('dark starts strong and gets weaker, light the other way round', () => {
    expect(powerFactor(spells.powerCurves, 'dark', 1)).toBeGreaterThan(
      powerFactor(spells.powerCurves, 'light', 1),
    );
    expect(powerFactor(spells.powerCurves, 'dark', 50)).toBeLessThan(
      powerFactor(spells.powerCurves, 'light', 50),
    );
  });

  it('is 1 without a path and keeps the last factor above the curve', () => {
    expect(powerFactor(spells.powerCurves, null, 3)).toBe(1);
    expect(powerFactor(spells.powerCurves, 'light', 99)).toBe(1.3);
  });

  it('multiplies the damage of a shot', () => {
    expect(shotDamage(fireball, 1, 1.3)).toBe(Math.round(fireball.damage * 1.3));
  });
});

describe('fps independence', () => {
  it('fires the same number of shards at 60 and at 120 steps per second', () => {
    const slow = fresh();
    const fast = fresh();
    let slowCount = 0;
    let fastCount = 0;
    for (let i = 0; i < 180; i++) {
      if (
        stepStaff(slow.state, slow.combat, press(true), cfg, fireball, 1, 1 / 60, out()).fired !==
        'none'
      ) {
        slowCount++;
      }
    }
    for (let i = 0; i < 360; i++) {
      if (
        stepStaff(fast.state, fast.combat, press(true), cfg, fireball, 1, 1 / 120, out()).fired !==
        'none'
      ) {
        fastCount++;
      }
    }
    expect(fastCount).toBe(slowCount);
  });
});
