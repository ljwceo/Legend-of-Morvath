import { describe, expect, it } from 'vitest';
import type { ControlsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { Bindings, isBindableCode, mouseCode, WHEEL_DOWN, WHEEL_UP } from './Bindings';

const file = readPublicJson('data/controls.json') as ControlsFile;

function fresh(saved?: Record<string, string[]>): Bindings {
  const bindings = new Bindings();
  bindings.configure(file, saved);
  return bindings;
}

describe('bindings from controls.json', () => {
  it('starts on the defaults: W and the up arrow walk forward, the left button attacks', () => {
    const b = fresh();
    expect([...b.codesFor('moveForward')]).toEqual(['KeyW', 'ArrowUp']);
    expect(b.actionFor('KeyW')).toBe('moveForward');
    expect(b.actionFor('ArrowUp')).toBe('moveForward');
    expect(b.actionFor('Mouse0')).toBe('attack');
    expect(b.actionFor(mouseCode(2))).toBe('heavy');
    expect(b.actionFor('Tab')).toBe('lock');
    expect(b.isDefault()).toBe(true);
    expect(b.unbound()).toEqual([]);
  });

  it('has the combat controls of 2026-10-17 (Elden Ring-style) on keyboard, mouse and pad', () => {
    const b = fresh();
    // PC: wheel = spell, 1 / 2 / 3 = weapon / off hand / quick item, Q uses the item.
    expect(b.actionFor(WHEEL_UP)).toBe('spellNext');
    expect(b.actionFor(WHEEL_DOWN)).toBe('spellPrev');
    expect(b.actionFor('Digit1')).toBe('weaponNext');
    expect(b.actionFor('Digit2')).toBe('offhandNext');
    expect(b.actionFor('Digit3')).toBe('itemNext');
    expect(b.actionFor('KeyQ')).toBe('potion');
    expect(b.actionFor('Space')).toBe('dash');
    // Controller: D-pad up / left / right / down, RB attack, RT spell or heavy, X the item.
    expect(b.actionForPad(12)).toBe('spellNext');
    expect(b.actionForPad(14)).toBe('weaponNext');
    expect(b.actionForPad(15)).toBe('offhandNext');
    expect(b.actionForPad(13)).toBe('itemNext');
    expect(b.actionForPad(5)).toBe('attack');
    expect(b.actionForPad(7)).toBe('heavy');
    expect(b.actionForPad(2)).toBe('potion');
    // Kept: A rolls, Y talks, L3 blocks, R3 locks on, LT switches target.
    expect(b.actionForPad(0)).toBe('dash');
    expect(b.actionForPad(3)).toBe('interact');
    expect(b.actionForPad(10)).toBe('block');
    expect(b.actionForPad(11)).toBe('lock');
    expect(b.actionForPad(6)).toBe('lockSwitch');
    // The left stick walks; no button does.
    expect([...b.padCodesFor('moveForward')]).toEqual([]);
  });

  it('can bind a wheel notch like a key', () => {
    const b = fresh();
    expect(isBindableCode(WHEEL_UP)).toBe(true);
    expect(b.bind('lockSwitch', 0, WHEEL_DOWN)).toBe('spellPrev');
    expect(b.actionFor(WHEEL_DOWN)).toBe('lockSwitch');
  });

  it('lists every action of the data file, and knows which one is debug only', () => {
    const b = fresh();
    expect([...b.actions]).toEqual(file.actions.map((action) => action.id));
    expect(b.isDebugOnly('down')).toBe(true);
    expect(b.isDebugOnly('dash')).toBe(false);
  });

  it('binds a key in a slot and leaves the other slot alone', () => {
    const b = fresh();
    // KeyM is bound to nothing by default, so no other action loses it.
    expect(b.bind('dash', 1, 'KeyM')).toBe(null);
    expect([...b.codesFor('dash')]).toEqual(['Space', 'KeyM']);
    expect(b.actionFor('KeyM')).toBe('dash');
    expect(b.isDefault()).toBe(false);
  });

  it('has its own key for closing a window, which can be rebound like any other', () => {
    const b = fresh();
    expect(b.actionFor('KeyF')).toBe('close');
    // Giving it to another action takes it away from closing, with the usual message.
    expect(b.bind('dash', 1, 'KeyF')).toBe('close');
    expect(b.actionFor('KeyF')).toBe('dash');
    expect([...b.codesFor('close')]).toEqual([]);
  });

  it('lets go of the key that was in the slot, so the old key does nothing', () => {
    const b = fresh();
    b.bind('moveForward', 0, 'KeyT');
    expect([...b.codesFor('moveForward')]).toEqual(['KeyT', 'ArrowUp']);
    expect(b.actionFor('KeyT')).toBe('moveForward');
    expect(b.actionFor('KeyW')).toBe(undefined);
    expect(b.actionFor('ArrowUp')).toBe('moveForward');
  });

  it('takes a key away from the action that had it, and says which one that was', () => {
    const b = fresh();
    expect(b.bind('dash', 0, 'KeyE')).toBe('interact');
    expect(b.actionFor('KeyE')).toBe('dash');
    expect([...b.codesFor('interact')]).toEqual([]);
    expect(b.unbound()).toEqual(['interact']);
  });

  it('never binds the same code twice, also not within one action', () => {
    const b = fresh();
    b.bind('dash', 1, 'Space');
    expect([...b.codesFor('dash')]).toEqual(['Space']);
    expect(b.actionFor('Space')).toBe('dash');
  });

  it('keeps at most two bindings per action', () => {
    const b = fresh();
    b.bind('bag', 0, 'KeyN');
    b.bind('bag', 1, 'KeyM');
    b.bind('bag', 5, 'KeyL');
    expect([...b.codesFor('bag')]).toEqual(['KeyN', 'KeyL']);
  });

  it('clears a slot, and back to default restores everything', () => {
    const b = fresh();
    b.clear('bag', 0);
    expect([...b.codesFor('bag')]).toEqual(['KeyB']);
    b.bind('dash', 0, 'KeyG');
    b.resetToDefaults();
    expect(b.isDefault()).toBe(true);
    expect(b.actionFor('KeyG')).toBe(undefined);
    expect([...b.codesFor('bag')]).toEqual(['KeyI', 'KeyB']);
  });

  it('counts a version up on every change, so cached key labels are rebuilt', () => {
    const b = fresh();
    const before = b.version;
    b.bind('dash', 0, 'KeyG');
    expect(b.version).toBeGreaterThan(before);
  });

  it('does not bind keys the game needs itself', () => {
    const b = fresh();
    expect(isBindableCode('Escape')).toBe(false);
    expect(isBindableCode('F3')).toBe(false);
    expect(isBindableCode('Backspace')).toBe(false);
    expect(isBindableCode('KeyW')).toBe(true);
    expect(isBindableCode('Mouse3')).toBe(true);
    expect(isBindableCode('Mouse9')).toBe(false);
    expect(b.bind('dash', 0, 'Escape')).toBe(null);
    expect([...b.codesFor('dash')]).toEqual(['Space']);
  });
});

describe('saved bindings', () => {
  it('takes over the saved keys and leaves the rest on the defaults', () => {
    const b = fresh({ dash: ['KeyG'] });
    expect([...b.codesFor('dash')]).toEqual(['KeyG']);
    expect([...b.codesFor('interact')]).toEqual(['KeyE']);
    expect(b.actionFor('Space')).toBe(undefined);
  });

  it('skips unknown actions and codes, so an older save still works', () => {
    const b = fresh({ fireLaser: ['KeyL'], dash: ['Escape', 'KeyG', 'KeyH'] });
    expect([...b.codesFor('dash')]).toEqual(['KeyG', 'KeyH']);
    expect(b.actionFor('KeyL')).toBe(undefined);
  });

  it('lets a saved key win over a default of another action', () => {
    const b = fresh({ dash: ['KeyE'] });
    expect(b.actionFor('KeyE')).toBe('dash');
    expect([...b.codesFor('interact')]).toEqual([]);
  });

  it('writes every action to the save, so changed defaults cannot surprise a player', () => {
    const b = fresh();
    b.bind('dash', 0, 'KeyG');
    const saved = b.toSave();
    // Every action twice: its keys, and its controller buttons under `pad:<action>`.
    const expected = [...b.actions, ...b.actions.map((action) => `pad:${action}`)];
    expect(Object.keys(saved).sort()).toEqual(expected.sort());
    expect(saved.dash).toEqual(['KeyG']);
    const again = fresh(saved as Record<string, string[]>);
    expect([...again.codesFor('dash')]).toEqual(['KeyG']);
  });
});
