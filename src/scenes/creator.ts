import type { Random } from '../core/Random';
import type { AppearanceFile, PlayerConfig } from '../data/types';
import type { SaveCharacter } from '../save/SaveData';

/** The look of a character: one id per option list in appearance.json. */
export type Appearance = SaveCharacter['appearance'];

type NameRules = AppearanceFile['name'];
type Hairstyle = AppearanceFile['hairstyles'][number];

export type NameCheck = { ok: true; name: string } | { ok: false; reason: 'empty' | 'invalid' };

/** Counts characters the way a player does (an emoji or "é" is one, not two UTF-16 units). */
function characters(text: string): string[] {
  return Array.from(text);
}

/** The name pattern from appearance.json, with Unicode support (`\p{L}` = any letter). */
export function namePattern(rules: NameRules): RegExp {
  return new RegExp(rules.pattern, 'u');
}

/**
 * Cleans what the player typed: drops every character the name pattern does not allow
 * (spaces, punctuation, emoji) and cuts it to the maximum length. Used while typing, so an
 * invalid name can never even appear in the field.
 */
export function sanitizeName(raw: string, rules: NameRules): string {
  const pattern = namePattern(rules);
  return characters(raw)
    .filter((char) => pattern.test(char))
    .slice(0, rules.maxLength)
    .join('');
}

/** Checks a finished name: not empty, not too long, only allowed characters. */
export function checkName(raw: string, rules: NameRules): NameCheck {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, reason: 'empty' };
  if (characters(name).length > rules.maxLength || !namePattern(rules).test(name)) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, name };
}

/** The hairstyles that belong to a body type, in data order. */
export function hairstylesFor(data: AppearanceFile, bodyType: string): Hairstyle[] {
  return data.hairstyles.filter((style) => style.bodyType === bodyType);
}

/**
 * Switches the body type and keeps the hairstyle as close as possible: the style with the same
 * label (ponytail stays ponytail), otherwise the style at the same position in the list.
 */
export function withBodyType(
  appearance: Appearance,
  data: AppearanceFile,
  bodyType: string,
): Appearance {
  if (appearance.bodyType === bodyType) return appearance;
  const styles = hairstylesFor(data, bodyType);
  const first = styles[0];
  if (!first) return appearance;
  const oldStyles = hairstylesFor(data, appearance.bodyType);
  const oldIndex = oldStyles.findIndex((style) => style.id === appearance.hairstyle);
  const oldLabel = oldStyles[oldIndex]?.label;
  const hairstyle = styles.find((style) => style.label === oldLabel) ?? styles[oldIndex] ?? first;
  return { ...appearance, bodyType, hairstyle: hairstyle.id };
}

/**
 * Makes any (possibly outdated) appearance valid against the current data: unknown ids fall
 * back to the defaults, and a hairstyle that does not fit the body type is replaced.
 */
export function normalizeAppearance(
  appearance: Partial<Appearance> | null | undefined,
  data: AppearanceFile,
): Appearance {
  const d = data.defaults;
  const pick = (value: string | undefined, list: readonly { id: string }[], fallback: string) =>
    value !== undefined && list.some((entry) => entry.id === value) ? value : fallback;
  const bodyType = pick(appearance?.bodyType, data.bodyTypes, d.bodyType);
  const styles = hairstylesFor(data, bodyType);
  const hairstyle = pick(appearance?.hairstyle, styles, styles[0]?.id ?? d.hairstyle);
  return {
    bodyType,
    hairstyle,
    hairColor: pick(appearance?.hairColor, data.hairColors, d.hairColor),
    skinTone: pick(appearance?.skinTone, data.skinTones, d.skinTone),
    mantleColor: pick(appearance?.mantleColor, data.mantleColors, d.mantleColor),
  };
}

/** The Random button: every option at random, always a hairstyle that fits the body type. */
export function randomAppearance(data: AppearanceFile, random: Random): Appearance {
  const bodyType = random.pick(data.bodyTypes).id;
  return {
    bodyType,
    hairstyle: random.pick(hairstylesFor(data, bodyType)).id,
    hairColor: random.pick(data.hairColors).id,
    skinTone: random.pick(data.skinTones).id,
    mantleColor: random.pick(data.mantleColors).id,
  };
}

/**
 * The finished character for the save: name, look, the points you spread over the ten stats,
 * and the start gold, items and equipment from player.json (an old sword and a travel mantle;
 * the mantle takes the chosen color).
 */
export function createCharacter(
  name: string,
  appearance: Appearance,
  player: PlayerConfig,
  stats: Readonly<Record<string, number>> = {},
): SaveCharacter {
  const start = player.start;
  return {
    name,
    appearance: { ...appearance },
    gold: start.gold,
    inventory: start.items.map((entry) => ({ ...entry })),
    equipment: { ...start.equipment },
    pack: [],
    stats: { ...stats },
    spells: [],
    crystal: null,
  };
}
