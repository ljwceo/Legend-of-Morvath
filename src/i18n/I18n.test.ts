import { describe, expect, it, vi } from 'vitest';
import { readPublicJson } from '../test/loadPublic';
import {
  detectLanguage,
  flattenStrings,
  format,
  I18n,
  LANGUAGES,
  placeholders,
  type Language,
} from './I18n';

const en = { title: { newGame: 'New Game', hello: 'Hello {name}' }, only: { en: 'English only' } };
const nl = { title: { newGame: 'Nieuw spel', hello: 'Hallo {name}' } };

describe('I18n', () => {
  it('translates with parameters', () => {
    const i18n = new I18n();
    i18n.setStrings('nl', nl, en);
    expect(i18n.t('title.newGame')).toBe('Nieuw spel');
    expect(i18n.t('title.hello', { name: 'Bo' })).toBe('Hallo Bo');
  });

  it('falls back to English, then to the key, and reports each missing key once', () => {
    const i18n = new I18n();
    i18n.setStrings('nl', nl, en);
    const onMissing = vi.fn();
    i18n.onMissing = onMissing;
    expect(i18n.t('only.en')).toBe('English only');
    expect(i18n.t('only.en')).toBe('English only');
    expect(i18n.t('does.not.exist')).toBe('does.not.exist');
    expect(onMissing).toHaveBeenCalledTimes(2);
    expect(onMissing).toHaveBeenCalledWith('only.en', 'nl');
  });

  it('loads languages through the fetcher', async () => {
    const files: Record<string, unknown> = { en, nl };
    const i18n = new I18n(async (url) => files[/lang\/(\w+)\.json$/.exec(url)?.[1] ?? '']);
    await i18n.setLanguage('nl');
    expect(i18n.language).toBe('nl');
    expect(i18n.t('title.newGame')).toBe('Nieuw spel');
    expect(i18n.keys.has('only.en')).toBe(true);
    await i18n.setLanguage('en');
    expect(i18n.t('title.newGame')).toBe('New Game');
  });
});

describe('helpers', () => {
  it('flattens nested objects into dot keys', () => {
    expect([...flattenStrings(en).keys()]).toEqual(['title.newGame', 'title.hello', 'only.en']);
    expect(() => flattenStrings({ a: 5 })).toThrow();
  });

  it('formats placeholders and leaves unknown ones alone', () => {
    expect(format('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    expect(placeholders('{b} {a} {b}')).toEqual(['a', 'b', 'b']);
  });

  it('detects the browser language', () => {
    expect(detectLanguage('nl-NL')).toBe('nl');
    expect(detectLanguage('nl-BE')).toBe('nl');
    expect(detectLanguage('de-DE')).toBe('en');
    expect(detectLanguage(undefined)).toBe('en');
  });
});

describe('language files in public/lang', () => {
  const files = new Map<Language, Map<string, string>>(
    LANGUAGES.map((language) => [
      language,
      flattenStrings(readPublicJson(`lang/${language}.json`)),
    ]),
  );
  const english = files.get('en') ?? new Map<string, string>();

  for (const language of LANGUAGES) {
    const strings = files.get(language) ?? new Map<string, string>();

    it(`${language}.json has exactly the same keys as en.json`, () => {
      expect([...strings.keys()].sort()).toEqual([...english.keys()].sort());
    });

    it(`${language}.json uses the same {placeholders} as en.json`, () => {
      for (const [key, text] of strings) {
        expect({ key, placeholders: placeholders(text) }).toEqual({
          key,
          placeholders: placeholders(english.get(key) ?? ''),
        });
      }
    });

    it(`${language}.json has no empty texts`, () => {
      for (const [key, text] of strings)
        expect({ key, text: text.trim() }).not.toEqual({ key, text: '' });
    });

    /**
     * Fase 3.6: every key of the game itself can be changed in Settings, so no text may name
     * one; a hint uses {keyDash} and friends instead. Exempt: the names under `key.`, the debug
     * keys (F3, F4, F6), and the intro and cutscene panels, which always continue on Space or
     * Enter because they are not part of the action mapping.
     */
    it(`${language}.json names no key of its own (use {keyDash} and friends)`, () => {
      const exempt = new Set([
        'cheats.debugViewNote',
        'intro.tapToContinue',
        'cutscene.tapToContinue',
      ]);
      // Case sensitive, so "with a newer version" is not read as the key "A".
      const singleKey = /\b(?:press(?:ing)?|druk op|toets|key) [A-Z]\b/;
      const namedKey =
        /\b(?:WASD|Tab|Spatie|Space(?:bar)?|linkermuisknop|rechtermuisknop|left mouse|right mouse|middle mouse|middelste muisknop)\b/i;
      for (const [key, text] of strings) {
        if (key.startsWith('key.') || exempt.has(key)) continue;
        const names = singleKey.test(text) || namedKey.test(text);
        expect({ key, names }).toEqual({ key, names: false });
      }
    });
  }
});
