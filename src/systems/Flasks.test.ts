import { describe, expect, it } from 'vitest';
import { playerFileSchema } from '../data/schemas';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { CombatState } from './Combat';
import {
  allocation,
  chargesLeft,
  createFlasks,
  flaskAmount,
  FlaskUse,
  flasksValid,
  type FlaskState,
  grantFlaskCapacity,
  normalizeFlasks,
  restFlasks,
  useFlask,
} from './Flasks';

const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const cfg = player.flasks;
const DT = 1 / 60;

function fighter(hp = 40, mana = 10): CombatState {
  const c = new CombatState();
  c.maxHp = 100;
  c.maxMana = 50;
  c.hp = hp;
  c.mana = mana;
  return c;
}

function eight(): FlaskState {
  return { capacity: 8, health: 5, mana: 3, healthLeft: 5, manaLeft: 3, discoveries: [] };
}

const restored = { kind: 'health' as const, amount: 0 };

describe('Flasks (G.5): the approved start', () => {
  it('player.json holds the approved start: 2 charges, 1 Health and 1 Mana, provisional values', () => {
    expect(cfg.startCapacity).toBe(2);
    expect(cfg.startHealth).toBe(1);
    expect(cfg.startMana).toBe(1);
    expect(cfg.health.hpPercent).toBe(50);
    expect(cfg.mana.manaPercent).toBe(30);
    expect(cfg.drinkSeconds).toBe(0.6);
    expect(cfg.cooldownSeconds).toBe(1);
  });

  it('a new character starts with every charge full and no discoveries', () => {
    expect(createFlasks(cfg)).toEqual({
      capacity: 2,
      health: 1,
      mana: 1,
      healthLeft: 1,
      manaLeft: 1,
      discoveries: [],
    });
    expect(flasksValid(createFlasks(cfg))).toBe(true);
  });
});

describe('Flasks: allocation and rest', () => {
  it('a 5 / 3 split of 8 persists and refills exactly to the split', () => {
    const state = eight();
    state.healthLeft = 0;
    state.manaLeft = 1;
    const rested = restFlasks(state);
    expect(rested).toEqual({ ...eight(), discoveries: state.discoveries });
    expect(allocation(rested as FlaskState, 'health')).toBe(5);
    expect(chargesLeft(rested as FlaskState, 'mana')).toBe(3);
  });

  it('resting may change the split and fills according to the new one', () => {
    const rested = restFlasks({ ...eight(), healthLeft: 2, manaLeft: 0 }, 2);
    expect(rested).toEqual({
      capacity: 8,
      health: 2,
      mana: 6,
      healthLeft: 2,
      manaLeft: 6,
      discoveries: [],
    });
    expect(restFlasks(eight(), 8)?.mana).toBe(0);
    expect(restFlasks(eight(), 0)?.health).toBe(0);
  });

  it('refuses a split that does not fit the capacity, and changes nothing', () => {
    const state = { ...eight(), healthLeft: 1 };
    expect(restFlasks(state, 9)).toBeNull();
    expect(restFlasks(state, -1)).toBeNull();
    expect(restFlasks(state, 2.5)).toBeNull();
    expect(state.healthLeft).toBe(1);
  });

  it('rest never grants capacity: a rest of an empty 2-capacity gives exactly 2 charges', () => {
    const state = createFlasks(cfg);
    state.healthLeft = 0;
    state.manaLeft = 0;
    const rested = restFlasks(state) as FlaskState;
    expect(rested.capacity).toBe(2);
    expect(rested.healthLeft + rested.manaLeft).toBe(2);
  });
});

describe('Flasks: use (the commit point)', () => {
  it('one use takes exactly one charge of its kind and restores the configured share', () => {
    const state = eight();
    const c = fighter(40, 10);
    expect(flaskAmount(cfg, 'health', c)).toBe(50);
    expect(useFlask(state, 'health', cfg, c, restored)).toBe('used');
    expect(c.hp).toBe(90);
    expect(restored).toEqual({ kind: 'health', amount: 50 });
    expect(state).toEqual({ ...eight(), healthLeft: 4 });
    expect(useFlask(state, 'mana', cfg, c, restored)).toBe('used');
    expect(c.mana).toBe(25);
    expect(state).toEqual({ ...eight(), healthLeft: 4, manaLeft: 2 });
    // The permanent capacity and the split never move.
    expect(state.capacity).toBe(8);
    expect(state.health).toBe(5);
  });

  it('never above the maximum, and Faith (potionPercent) makes a charge restore more', () => {
    const c = fighter(80, 10);
    expect(useFlask(eight(), 'health', cfg, c, restored, 1.2)).toBe('used');
    expect(c.hp).toBe(100);
    expect(restored.amount).toBe(20);
    const c2 = fighter(10, 10);
    useFlask(eight(), 'health', cfg, c2, restored, 1.2);
    expect(c2.hp).toBe(70);
  });

  it('an empty flask cannot be used; a full bar keeps the charge', () => {
    const state = { ...eight(), healthLeft: 0 };
    const c = fighter(40, 10);
    expect(useFlask(state, 'health', cfg, c, restored)).toBe('empty');
    expect(c.hp).toBe(40);
    expect(state.healthLeft).toBe(0);
    const full = fighter(100, 50);
    const state2 = eight();
    expect(useFlask(state2, 'health', cfg, full, restored)).toBe('full');
    expect(useFlask(state2, 'mana', cfg, full, restored)).toBe('full');
    expect(state2).toEqual(eight());
  });

  it('a drink in progress: one press, one charge, however often the key is pressed', () => {
    const use = new FlaskUse();
    const state = eight();
    const c = fighter(40, 10);
    expect(use.start('health', state, c, 0)).toBe('started');
    expect(use.start('health', state, c, 0)).toBe('busy');
    expect(use.start('mana', state, c, 0)).toBe('busy');
    // Nothing is spent or restored before the commit point.
    let committed = 0;
    for (let i = 0; i < 100 && committed === 0; i++) {
      const kind = use.step(DT, cfg.drinkSeconds);
      if (kind) {
        committed++;
        expect(use.drinking).toBe(false);
        expect(state.healthLeft).toBe(5);
        expect(c.hp).toBe(40);
        expect(useFlask(state, kind, cfg, c, restored)).toBe('used');
      } else {
        expect(state.healthLeft).toBe(5);
      }
    }
    expect(committed).toBe(1);
    expect(state.healthLeft).toBe(4);
    expect(c.hp).toBe(90);
    // The step after the commit does nothing more: no second charge, no second effect.
    expect(use.step(DT, cfg.drinkSeconds)).toBeNull();
    expect(state.healthLeft).toBe(4);
  });

  it('commits exactly in the step the drink time is reached, at 60 and at 120 Hz', () => {
    for (const dt of [1 / 60, 1 / 120]) {
      const use = new FlaskUse();
      use.start('mana', eight(), fighter(), 0);
      let steps = 0;
      while (use.step(dt, cfg.drinkSeconds) === null) steps++;
      expect(Math.abs((steps + 1) * dt - cfg.drinkSeconds)).toBeLessThan(dt);
    }
  });

  it('interrupted before the commit point: no charge, no effect; after it nothing rolls back', () => {
    const use = new FlaskUse();
    const state = eight();
    const c = fighter(40, 10);
    use.start('health', state, c, 0);
    for (let i = 0; i < 10; i++) use.step(DT, cfg.drinkSeconds);
    expect(use.cancel()).toBe(true);
    expect(use.drinking).toBe(false);
    expect(state).toEqual(eight());
    expect(c.hp).toBe(40);
    expect(use.cancel()).toBe(false);
    // After the commit a cancel has nothing to undo.
    use.start('health', state, c, 0);
    let kind = null;
    while (kind === null) kind = use.step(DT, cfg.drinkSeconds);
    useFlask(state, kind, cfg, c, restored);
    expect(use.cancel()).toBe(false);
    expect(state.healthLeft).toBe(4);
    expect(c.hp).toBe(90);
  });

  it('refuses to start with no charge, a full bar or during the cooldown', () => {
    const use = new FlaskUse();
    expect(use.start('health', { ...eight(), healthLeft: 0 }, fighter(), 0)).toBe('empty');
    expect(use.start('health', eight(), fighter(100, 10), 0)).toBe('full');
    expect(use.start('mana', eight(), fighter(10, 50), 0)).toBe('full');
    expect(use.start('health', eight(), fighter(), 0.5)).toBe('cooldown');
    expect(use.drinking).toBe(false);
    expect(use.step(DT, cfg.drinkSeconds)).toBeNull();
  });
});

describe('Flasks: permanent capacity', () => {
  it('a discovery adds one empty charge to the capacity, exactly once', () => {
    const state = createFlasks(cfg);
    state.healthLeft = 0;
    expect(grantFlaskCapacity(state, 'cave_shrine')).toBe(true);
    expect(state).toEqual({
      capacity: 3,
      health: 2,
      mana: 1,
      healthLeft: 0,
      manaLeft: 1,
      discoveries: ['cave_shrine'],
    });
    // The same discovery again: nothing, however often it fires.
    expect(grantFlaskCapacity(state, 'cave_shrine')).toBe(false);
    expect(grantFlaskCapacity(state, 'cave_shrine')).toBe(false);
    expect(state.capacity).toBe(3);
    expect(grantFlaskCapacity(state, '')).toBe(false);
    // Another one counts, and the new charge is there after the next rest only.
    expect(grantFlaskCapacity(state, 'tower_top')).toBe(true);
    expect(state.capacity).toBe(4);
    expect(state.healthLeft).toBe(0);
    expect(restFlasks(state)).toEqual({ ...state, healthLeft: 3, manaLeft: 1 });
    expect(flasksValid(state)).toBe(true);
  });

  it('a discovery survives a save round trip as plain data', () => {
    const state = createFlasks(cfg);
    grantFlaskCapacity(state, 'cave_shrine');
    const loaded = JSON.parse(JSON.stringify(state)) as FlaskState;
    expect(grantFlaskCapacity(loaded, 'cave_shrine')).toBe(false);
    expect(loaded.capacity).toBe(3);
  });
});

describe('Flasks: loading a damaged state', () => {
  it('leaves a sound state alone (same object) and never refills', () => {
    const state = { ...eight(), healthLeft: 2, manaLeft: 0 };
    expect(normalizeFlasks(state)).toBe(state);
  });

  it('clamps charges to their allocation and the split to the capacity, inventing nothing', () => {
    expect(normalizeFlasks({ ...eight(), healthLeft: 9, manaLeft: -1 })).toEqual({
      ...eight(),
      healthLeft: 5,
      manaLeft: 0,
    });
    // A split that is too large: the Health Flask keeps what fits, the mana takes the rest.
    expect(
      normalizeFlasks({
        capacity: 4,
        health: 6,
        mana: 3,
        healthLeft: 6,
        manaLeft: 3,
        discoveries: [],
      }),
    ).toEqual({
      capacity: 4,
      health: 4,
      mana: 0,
      healthLeft: 4,
      manaLeft: 0,
      discoveries: [],
    });
    expect(
      normalizeFlasks({
        capacity: 2,
        health: 1,
        mana: 1,
        healthLeft: 1.7,
        manaLeft: NaN,
        discoveries: [],
      }),
    ).toEqual({ capacity: 2, health: 1, mana: 1, healthLeft: 1, manaLeft: 0, discoveries: [] });
    expect(
      normalizeFlasks({
        capacity: -3,
        health: 1,
        mana: 1,
        healthLeft: 1,
        manaLeft: 1,
        discoveries: [],
      }),
    ).toEqual({ capacity: 0, health: 0, mana: 0, healthLeft: 0, manaLeft: 0, discoveries: [] });
  });

  it('keeps each discovery once', () => {
    const state = { ...eight(), discoveries: ['a', 'a', 'b'] };
    expect(normalizeFlasks(state).discoveries).toEqual(['a', 'b']);
  });
});
