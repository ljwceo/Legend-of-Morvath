import { type Bindings, isMouseCode } from '../core/Bindings';
import { padIndex } from '../core/gamepad';
import type { I18n, TextParams } from '../i18n/I18n';

/**
 * Readable names for keys and mouse buttons. Letters and digits speak for themselves ("W", "7"),
 * everything with a name of its own (Space, Tab, the arrows, the mouse buttons) comes from the
 * language files as `key.<code>`, so "Spatie" and "Space" are both possible.
 */
export function keyLabel(code: string, t: I18n['t']): string {
  if (code === '') return '—';
  const pad = padIndex(code);
  if (pad >= 0) return t(`pad.${pad}`);
  if (isMouseCode(code)) return t(`key.${code.toLowerCase()}`);
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1] as string;
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit)
    return code.startsWith('Numpad') ? `${t('key.numpad')} ${digit[1]}` : (digit[1] as string);
  const named = t(`key.${code}`);
  // No text for this key: show the browser's own code, which is still readable (e.g. "Backquote").
  return named === `key.${code}` ? code : named;
}

/** "W / ↑", the keys of an action as one line for a hint or a tooltip. */
export function keysLabel(codes: readonly string[], t: I18n['t']): string {
  if (codes.length === 0) return '—';
  return codes.map((code) => keyLabel(code, t)).join(' / ');
}

/**
 * The keys of every action as text parameters, so any text can name the key the player really
 * uses: `{keyInteract}`, `{keyDash}`, `{keyAttack}`, ... (the action id with a capital letter).
 * main.ts hands these to I18n as default parameters. The result is cached per language and per
 * change to the bindings, so a text that is drawn often costs nothing.
 */
export function keyParams(bindings: Bindings, i18n: I18n): TextParams {
  if (
    cache !== null &&
    cache.version === bindings.version &&
    cache.language === i18n.language &&
    cache.bindings === bindings
  ) {
    return cache.params;
  }
  const params: Record<string, string> = {};
  // The labels themselves are texts ("Spatie", "Linkermuisknop"); ask for them without the
  // default parameters we are building here.
  const label = (code: string): string => keyLabel(code, (key) => i18n.plain(key));
  for (const action of bindings.actions) {
    const codes = bindings.codesFor(action);
    const name = `key${action.charAt(0).toUpperCase()}${action.slice(1)}`;
    // After the last input came from a controller, texts name its button (A, RB, ...).
    const pad = bindings.padHints ? bindings.padCodesFor(action)[0] : undefined;
    const first = pad ?? codes[0];
    params[name] = first === undefined ? '—' : label(first);
  }
  cache = { bindings, version: bindings.version, language: i18n.language, params };
  return params;
}

let cache: {
  bindings: Bindings;
  version: number;
  language: string;
  params: TextParams;
} | null = null;
