import { describe, expect, it } from 'vitest';
import { Bindings } from '../core/Bindings';
import type { ControlsFile } from '../data/types';
import { I18n } from '../i18n/I18n';
import { readPublicJson } from '../test/loadPublic';
import { keyLabel, keyParams, keysLabel } from './keyLabels';

const file = readPublicJson('data/controls.json') as ControlsFile;
const en = readPublicJson('lang/en.json');
const nl = readPublicJson('lang/nl.json');

function setup(language: 'en' | 'nl' = 'en'): { bindings: Bindings; i18n: I18n } {
  const i18n = new I18n();
  i18n.setStrings(language, language === 'en' ? en : nl, en);
  const bindings = new Bindings();
  bindings.configure(file);
  return { bindings, i18n };
}

describe('key labels', () => {
  it('shows letters and digits as themselves and named keys in the chosen language', () => {
    const { i18n } = setup('nl');
    const t = (key: string): string => i18n.t(key);
    expect(keyLabel('KeyW', t)).toBe('W');
    expect(keyLabel('Digit7', t)).toBe('7');
    expect(keyLabel('Space', t)).toBe('Spatie');
    expect(keyLabel('ArrowUp', t)).toBe('↑');
    expect(keyLabel('Mouse0', t)).toBe('Linkermuisknop');
    expect(keyLabel('Mouse2', t)).toBe('Rechtermuisknop');
    expect(keyLabel('', t)).toBe('—');
    expect(keysLabel(['KeyW', 'ArrowUp'], t)).toBe('W / ↑');
  });

  it('falls back to the browser code for a key without a text', () => {
    const { i18n } = setup();
    expect(keyLabel('IntlBackslash', (key) => i18n.t(key))).toBe('IntlBackslash');
  });
});

describe('key parameters for texts', () => {
  it('gives every action its first key, so a hint can name it', () => {
    const { bindings, i18n } = setup();
    const params = keyParams(bindings, i18n) as Record<string, string>;
    expect(params.keyInteract).toBe('E');
    expect(params.keyDash).toBe('Space');
    expect(params.keyAttack).toBe('Left mouse');
    expect(params.keyMoveForward).toBe('W');
  });

  it('follows a rebinding and the language, through I18n default parameters', () => {
    const { bindings, i18n } = setup('nl');
    i18n.defaultParams = () => keyParams(bindings, i18n);
    expect(i18n.t('quest.just_for_you.complete.1')).toContain('Q');
    bindings.bind('potion', 0, 'KeyP');
    expect(i18n.t('quest.just_for_you.complete.1')).toContain('P');
    expect(i18n.t('cheats.flyHintKeys')).toContain('Spatie');
  });

  it('shows a dash for an action without a key', () => {
    const { bindings, i18n } = setup();
    bindings.clear('potion', 0);
    const params = keyParams(bindings, i18n) as Record<string, string>;
    expect(params.keyPotion).toBe('—');
  });
});

describe('controller button labels', () => {
  it('has a label in both languages for every button the player can see or bind', () => {
    for (const language of ['en', 'nl'] as const) {
      const { i18n } = setup(language);
      const t = (key: string): string => i18n.plain(key);
      for (let i = 0; i < 17; i++) {
        const label = keyLabel(`Pad${i}`, t);
        expect(label, `${language} Pad${i}`).not.toBe('');
        expect(label, `${language} Pad${i}`).not.toBe(`pad.${i}`);
        expect(label, `${language} Pad${i}`).not.toBe(`Pad${i}`);
      }
    }
  });

  it('names the controller button in {keyDash} once the last input was a controller', () => {
    const { bindings, i18n } = setup();
    expect(keyParams(bindings, i18n).keyDash).toBe('Space');
    bindings.setPadHints(true);
    expect(keyParams(bindings, i18n).keyDash).toBe('A');
    // The D-pad picks the spell (the left stick walks), so walking keeps its key.
    expect(keyParams(bindings, i18n).keySpellNext).toBe('D-pad ↑');
    expect(keyParams(bindings, i18n).keyMoveForward).toBe('W');
    bindings.setPadHints(false);
    expect(keyParams(bindings, i18n).keyDash).toBe('Space');
    expect(keyParams(bindings, i18n).keySpellNext).toBe('Wheel up');
  });
});
