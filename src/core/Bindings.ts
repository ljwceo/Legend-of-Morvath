import { CONTROL_ACTIONS } from '../data/schemas';
import type { ControlsFile } from '../data/types';

/**
 * Game actions, independent of key, button or (later) gamepad. The list itself lives in
 * `schemas.ts`, next to the schema of `controls.json`, so data and code can never drift apart.
 * Every action can be bound to keys and mouse buttons in Settings -> Controls; the touch
 * buttons are their own buttons and never change.
 *
 * `down` only matters while flying (debug cheat). `confirm` advances a conversation; a left
 * click while the mouse is captured always confirms too, whatever `attack` is bound to.
 */
export const ACTIONS = CONTROL_ACTIONS;
export type Action = (typeof ACTIONS)[number];

/** Primary and secondary binding, e.g. W and the up arrow. */
export const BINDINGS_PER_ACTION = 2;

/** What the save stores: action id -> bound codes. */
export type SavedBindings = Readonly<Record<string, readonly string[]>>;

const ACTION_SET: ReadonlySet<string> = new Set<string>(ACTIONS);

/**
 * Keys the game never binds: Escape pauses, the function keys drive debug mode, and the
 * browser needs the meta keys. Everything else (letters, digits, arrows, Space, Tab, Enter,
 * the modifiers and mouse buttons 0-4) is fair game.
 */
const RESERVED: ReadonlySet<string> = new Set([
  'Escape',
  'MetaLeft',
  'MetaRight',
  'ContextMenu',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Pause',
  'PrintScreen',
  'Insert',
  'Backspace',
]);

/** `Mouse0` is the left button, `Mouse1` the middle one, `Mouse2` the right one. */
export function mouseCode(button: number): string {
  return `Mouse${button}`;
}

export function isMouseCode(code: string): boolean {
  return /^Mouse[0-4]$/.test(code);
}

/** True for a code the player may bind (a `KeyboardEvent.code` or `Mouse0`-`Mouse4`). */
export function isBindableCode(code: string): boolean {
  if (code.startsWith('Mouse')) return isMouseCode(code);
  if (RESERVED.has(code) || /^F\d{1,2}$/.test(code)) return false;
  return /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(code);
}

/**
 * Which key or mouse button does what. The defaults come from `controls.json`, the player's own
 * choices from the save, so a new default (or a new action) reaches everyone while their own
 * keys stay. One code belongs to one action: binding a code that is already in use takes it
 * away from the other action, and `bind` says which one that was so the UI can mention it.
 */
export class Bindings {
  private readonly order: Action[] = [];
  private readonly defaults = new Map<Action, string[]>();
  private readonly bound = new Map<Action, string[]>();
  private readonly byCode = new Map<string, Action>();
  private readonly debugOnly = new Set<Action>();
  private revision = 0;

  /** Reads `controls.json` and then the player's own bindings (anything invalid is skipped). */
  configure(file: ControlsFile, saved?: SavedBindings | null): void {
    this.order.length = 0;
    this.defaults.clear();
    this.debugOnly.clear();
    for (const action of file.actions) {
      this.order.push(action.id);
      this.defaults.set(action.id, [...action.keys]);
      if (action.debugOnly) this.debugOnly.add(action.id);
    }
    this.resetToDefaults();
    if (saved) this.apply(saved);
    this.revision++;
  }

  /** Counts up on every change, so cached key labels know when to be rebuilt. */
  get version(): number {
    return this.revision;
  }

  /** Actions in the order of `controls.json` (the order Settings shows them in). */
  get actions(): readonly Action[] {
    return this.order;
  }

  /** True for an action that only does something in debug mode (flying down). */
  isDebugOnly(action: Action): boolean {
    return this.debugOnly.has(action);
  }

  /** The codes bound to an action, primary first. */
  codesFor(action: Action): readonly string[] {
    return this.bound.get(action) ?? [];
  }

  defaultsFor(action: Action): readonly string[] {
    return this.defaults.get(action) ?? [];
  }

  /** The action a key or mouse button triggers, or undefined when it is not bound. */
  actionFor(code: string): Action | undefined {
    return this.byCode.get(code);
  }

  /** Actions without a single key or button left, so the UI can warn about them. */
  unbound(): readonly Action[] {
    return this.order.filter((action) => this.codesFor(action).length === 0);
  }

  /**
   * Binds `code` to `action` in slot 0 (primary) or 1 (secondary). Returns the action the code
   * was taken from, or null. Does nothing for a code the game does not bind.
   */
  bind(action: Action, slot: number, code: string): Action | null {
    if (!this.bound.has(action) || !isBindableCode(code)) return null;
    const previous = this.byCode.get(code);
    if (previous === action && this.codesFor(action)[slot] === code) return null;
    if (previous !== undefined) this.removeCode(previous, code);
    const codes = this.bound.get(action) as string[];
    const index = Math.max(0, Math.min(slot, codes.length, BINDINGS_PER_ACTION - 1));
    // The code that was in this slot is gone, so it may not keep triggering the action.
    const replaced = codes[index];
    if (replaced !== undefined) this.byCode.delete(replaced);
    codes[index] = code;
    this.byCode.set(code, action);
    this.revision++;
    return previous === action ? null : (previous ?? null);
  }

  /** Clears one slot of an action (an action may end up without any key). */
  clear(action: Action, slot: number): void {
    const codes = this.bound.get(action);
    const code = codes?.[slot];
    if (!codes || code === undefined) return;
    codes.splice(slot, 1);
    this.byCode.delete(code);
    this.revision++;
  }

  resetToDefaults(): void {
    this.bound.clear();
    this.byCode.clear();
    for (const action of this.order) {
      const codes: string[] = [];
      for (const code of this.defaultsFor(action)) {
        if (!this.byCode.has(code) && codes.length < BINDINGS_PER_ACTION) {
          codes.push(code);
          this.byCode.set(code, action);
        }
      }
      this.bound.set(action, codes);
    }
    this.revision++;
  }

  /** True while nothing was changed, so Settings can hide "back to default". */
  isDefault(): boolean {
    return this.order.every((action) => {
      const codes = this.codesFor(action);
      const defaults = this.defaultsFor(action);
      return codes.length === defaults.length && codes.every((code, i) => code === defaults[i]);
    });
  }

  /** What goes into the save: every action, so a later default change cannot surprise us. */
  toSave(): SavedBindings {
    const out: Record<string, string[]> = {};
    for (const action of this.order) out[action] = [...this.codesFor(action)];
    return out;
  }

  /** Takes over saved bindings; unknown actions and codes are skipped (data can be older). */
  private apply(saved: SavedBindings): void {
    const taken = new Set<string>();
    const wanted = new Map<Action, string[]>();
    for (const [name, codes] of Object.entries(saved)) {
      if (!ACTION_SET.has(name) || !Array.isArray(codes)) continue;
      const action = name as Action;
      if (!this.bound.has(action)) continue;
      const keep: string[] = [];
      for (const code of codes) {
        if (typeof code !== 'string' || !isBindableCode(code)) continue;
        if (taken.has(code) || keep.length >= BINDINGS_PER_ACTION) continue;
        taken.add(code);
        keep.push(code);
      }
      wanted.set(action, keep);
    }
    if (wanted.size === 0) return;
    this.bound.clear();
    this.byCode.clear();
    for (const action of this.order) {
      // An action the save does not mention keeps its default, unless the save took the code.
      const codes = (wanted.get(action) ?? this.defaultsFor(action)).filter(
        (code) => !this.byCode.has(code),
      );
      this.bound.set(action, [...codes]);
      for (const code of codes) this.byCode.set(code, action);
    }
  }

  private removeCode(action: Action, code: string): void {
    const codes = this.bound.get(action);
    if (!codes) return;
    const index = codes.indexOf(code);
    if (index >= 0) codes.splice(index, 1);
    this.byCode.delete(code);
  }
}
