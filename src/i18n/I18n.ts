import { fetchJson, publicUrl, type JsonFetcher } from '../data/DataLoader';

/** Languages the game ships with. English is always the fallback. */
export const LANGUAGES = ['en', 'nl'] as const;
export type Language = (typeof LANGUAGES)[number];
export const FALLBACK_LANGUAGE: Language = 'en';

export type TextParams = Readonly<Record<string, string | number>>;

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Picks the best supported language for a browser locale such as "nl-NL". */
export function detectLanguage(locale: string | undefined): Language {
  const code = locale?.slice(0, 2).toLowerCase();
  return isLanguage(code) ? code : FALLBACK_LANGUAGE;
}

/**
 * Flattens nested language JSON into dot keys: `{ title: { newGame: "New Game" } }` becomes
 * `title.newGame`. Non-string leaves are reported as errors.
 */
export function flattenStrings(
  json: unknown,
  prefix = '',
  out: Map<string, string> = new Map(),
): Map<string, string> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(`Language data at "${prefix || '(root)'}" must be an object`);
  }
  for (const [key, value] of Object.entries(json)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else flattenStrings(value, path, out);
  }
  return out;
}

/** Placeholder names in a string, e.g. "Hello {name}" → ["name"]. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string).sort();
}

export function format(text: string, params?: TextParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Translations. `t('title.newGame')` looks in the current language, then English, then returns
 * the key itself, so a missing text never breaks the game. Missing keys are reported once.
 */
export class I18n {
  private current = new Map<string, string>();
  private fallback = new Map<string, string>();
  private readonly reported = new Set<string>();
  private lang: Language = FALLBACK_LANGUAGE;

  /** Called once per missing key; main.ts shows these in debug mode. */
  onMissing: ((key: string, language: Language) => void) | null = null;
  /**
   * Parameters every text may use without being passed them, for things that are the same
   * everywhere: main.ts fills in the keys the player bound ({keyInteract}, {keyDash}, ...), so
   * a hint always names the key they actually use. Explicit parameters win.
   */
  defaultParams: (() => TextParams) | null = null;

  constructor(private readonly fetcher: JsonFetcher = fetchJson) {}

  get language(): Language {
    return this.lang;
  }

  /** All keys of the fallback language (en.json), e.g. for validating text keys in data. */
  get keys(): ReadonlySet<string> {
    return new Set(this.fallback.keys());
  }

  /** Loads English (once) and the requested language. */
  async setLanguage(language: Language): Promise<void> {
    if (this.fallback.size === 0) {
      this.fallback = flattenStrings(
        await this.fetcher(publicUrl(`lang/${FALLBACK_LANGUAGE}.json`)),
      );
    }
    this.current =
      language === FALLBACK_LANGUAGE
        ? this.fallback
        : flattenStrings(await this.fetcher(publicUrl(`lang/${language}.json`)));
    this.lang = language;
    this.reported.clear();
  }

  /** Sets strings directly (tests, or preloaded data). */
  setStrings(language: Language, strings: unknown, fallbackStrings?: unknown): void {
    if (fallbackStrings !== undefined) this.fallback = flattenStrings(fallbackStrings);
    this.current = flattenStrings(strings);
    if (language === FALLBACK_LANGUAGE && fallbackStrings === undefined)
      this.fallback = this.current;
    this.lang = language;
    this.reported.clear();
  }

  /** The text as it stands, without default parameters (used to build those parameters). */
  plain(key: string): string {
    return this.current.get(key) ?? this.fallback.get(key) ?? key;
  }

  has(key: string): boolean {
    return this.current.has(key) || this.fallback.has(key);
  }

  t(key: string, params?: TextParams): string {
    let text = this.current.get(key);
    if (text === undefined) {
      this.report(key);
      text = this.fallback.get(key) ?? key;
    }
    if (!text.includes('{')) return text;
    const defaults = this.defaultParams?.();
    if (!defaults) return format(text, params);
    return format(text, params ? { ...defaults, ...params } : defaults);
  }

  private report(key: string): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.onMissing?.(key, this.lang);
  }
}
