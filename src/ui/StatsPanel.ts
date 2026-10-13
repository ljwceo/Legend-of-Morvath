import type { GameContext } from '../core/GameContext';
import type { PlayerPath, StatDef } from '../data/types';
import { statPreview } from '../systems/StatPreview';
import { canAddPoint, type StatPoints, unspentPoints } from '../systems/Stats';
import { el } from './dom';

/** How the stat list behaves where it is shown. */
export interface StatsEditorOptions {
  points: Readonly<StatPoints>;
  level: number;
  path: PlayerPath | null;
  /**
   * False while you may not spend (in a fight): the buttons are still there but disabled, so
   * the panel never jumps around.
   */
  canSpend: boolean;
  /**
   * True while points may go back in (the character creator, and later a reset at Sultan).
   * In the world a point you spent is spent.
   */
  canRefund: boolean;
  /** Called with the new spread whenever a point moves. */
  onChange(points: StatPoints): void;
}

/** The points left, as a sentence ("3 points left"). */
export function pointsLeftText(
  ctx: GameContext,
  level: number,
  points: Readonly<StatPoints>,
): {
  left: number;
  text: string;
} {
  const file = ctx.data?.stats;
  const t = ctx.i18n.t.bind(ctx.i18n);
  if (!file) return { left: 0, text: '' };
  const left = unspentPoints(file, level, points);
  if (left === 0) return { left, text: t('stats.pointsNone') };
  return { left, text: left === 1 ? t('stats.pointsLeftOne') : t('stats.pointsLeft', { n: left }) };
}

/**
 * The ten stats with a minus and a plus per stat, plus a summary of what the build gives you
 * (HP, mana, damage, ...). Used by the character creator and by the status window, so a build
 * reads the same in both places. Names come from stats.json and stay English in both
 * languages (CLAUDE.md §2.6); the explanation under each one is translated.
 */
export function statsEditor(ctx: GameContext, options: StatsEditorOptions): HTMLElement {
  const file = ctx.data?.stats;
  const player = ctx.data?.player;
  const t = ctx.i18n.t.bind(ctx.i18n);
  const list = el('div', { className: 'ui-stats' });
  if (!file || !player) return list;
  const { points, level } = options;

  const move = (statId: string, delta: number): void => {
    const next: StatPoints = { ...points };
    const now = next[statId] ?? 0;
    const wanted = now + delta;
    if (wanted < 0) return;
    if (delta > 0 && !canAddPoint(file, level, points, statId)) return;
    next[statId] = wanted;
    options.onChange(next);
  };

  const row = (def: StatDef): HTMLElement => {
    const spent = points[def.id] ?? 0;
    const minus = el('button', {
      className: 'ui-stat-step',
      text: '−',
      attrs: {
        type: 'button',
        'aria-label': t('stats.refund', { stat: def.name }),
      },
      onClick: () => move(def.id, -1),
    });
    minus.disabled = !options.canRefund || spent === 0;
    const plus = el('button', {
      className: 'ui-stat-step',
      text: '+',
      attrs: { type: 'button', 'aria-label': t('stats.spend', { stat: def.name }) },
      onClick: () => move(def.id, 1),
    });
    plus.disabled = !options.canSpend || !canAddPoint(file, level, points, def.id);
    const cap = def.softCaps[0]?.fromPoints;
    return el(
      'div',
      { className: 'ui-stat' },
      el(
        'div',
        { className: 'ui-stat-head' },
        el('span', { className: 'ui-stat-name', text: def.name }),
        el('span', { className: 'ui-stat-points', text: String(spent) }),
        el('div', { className: 'ui-stat-steps' }, minus, plus),
      ),
      el('p', { className: 'ui-note ui-stat-desc', text: t(`stats.desc.${def.id}`) }),
      cap !== undefined && spent >= cap
        ? el('p', { className: 'ui-note ui-stat-cap', text: t('stats.softCap', { n: cap }) })
        : null,
    );
  };

  for (const def of file.stats) list.append(row(def));
  return list;
}

/** One line per number a player recognises: HP, mana, damage, what reaches you, ... */
export function statSummary(
  ctx: GameContext,
  points: Readonly<StatPoints>,
  level: number,
  path: PlayerPath | null,
): HTMLElement {
  const file = ctx.data?.stats;
  const player = ctx.data?.player;
  const t = ctx.i18n.t.bind(ctx.i18n);
  const box = el('div', { className: 'ui-stat-summary' });
  if (!file || !player) return box;
  const p = statPreview(player, file, points, path, level, ctx.data?.skills);
  const n = (value: number, digits = 0): string =>
    value.toLocaleString(ctx.i18n.language, { maximumFractionDigits: digits });
  const lines: string[] = [
    t('stats.summary.hp', { n: n(p.maxHp) }),
    t('stats.summary.mana', { n: n(p.maxMana) }),
    t('stats.summary.energy', { n: n(p.maxEnergy) }),
    t('stats.summary.sword', {
      fast: n(p.swordFast),
      combo: n(p.swordCombo),
      heavy: n(p.swordHeavy),
    }),
    t('stats.summary.shard', { n: n(p.shard) }),
    t('stats.summary.carry', { n: n(p.carryKg, 1) }),
  ];
  if (p.spellPercent > 0) lines.push(t('stats.summary.spell', { n: n(p.spellPercent, 1) }));
  if (p.damageTakenPercent > 0) {
    lines.push(t('stats.summary.damageTaken', { n: n(p.damageTakenPercent, 1) }));
  }
  if (p.attackSpeedPercent > 0) {
    lines.push(t('stats.summary.attackSpeed', { n: n(p.attackSpeedPercent, 1) }));
  }
  if (p.critChancePercent > 0) {
    lines.push(
      t('stats.summary.crit', {
        n: n(p.critChancePercent, 1),
        factor: n(p.critFactor, 2),
      }),
    );
  }
  if (p.potionPercent > 0) lines.push(t('stats.summary.potion', { n: n(p.potionPercent, 1) }));
  lines.push(
    t('stats.summary.regen', {
      hp: n(p.hpRegenPerSecond, 2),
      mana: n(p.manaRegenPerSecond, 2),
      energy: n(p.energyRegenPerSecond, 1),
    }),
  );
  box.append(
    el('span', { className: 'ui-label', text: t('stats.summary.title') }),
    el(
      'div',
      { className: 'ui-stat-lines' },
      ...lines.map((line) => el('span', { className: 'ui-stat-line', text: line })),
    ),
  );
  return box;
}

/** "Suggestions" and Random, for the character creator. */
export function statsPresetRow(
  ctx: GameContext,
  onPreset: (presetId: string) => void,
  onRandom: () => void,
  onClear: () => void,
): HTMLElement {
  const file = ctx.data?.stats;
  const t = ctx.i18n.t.bind(ctx.i18n);
  const row = el('div', { className: 'ui-setting' });
  if (!file) return row;
  const chips = el('div', { className: 'ui-chips' });
  for (const preset of file.presets) {
    chips.append(
      el('button', {
        className: 'ui-chip',
        text: preset.name,
        attrs: { type: 'button' },
        onClick: () => onPreset(preset.id),
      }),
    );
  }
  chips.append(
    el('button', {
      className: 'ui-chip',
      text: t('stats.random'),
      attrs: { type: 'button' },
      onClick: () => onRandom(),
    }),
    el('button', {
      className: 'ui-chip',
      text: t('stats.clear'),
      attrs: { type: 'button' },
      onClick: () => onClear(),
    }),
  );
  row.append(el('span', { className: 'ui-label', text: t('stats.suggestions') }), chips);
  return row;
}
