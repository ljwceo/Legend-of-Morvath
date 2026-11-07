import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../core/GameContext';
import type { StatPoints } from '../../systems/Stats';
import type { StatsEditorOptions } from '../StatsPanel';

// GG.8.5 step 4: while Max All Stats (debug) is on, the status window shows the 999 the game
// counts with, says clearly that they are a temporary debug layer, keeps "points left" your own,
// and spends nothing (so the 999 can never become your own points). The tests run without a DOM:
// `el()` records what it was asked to show, and the stat list records what it was given.

/** Every text the window shows, with its class names. */
const shown: { className: string; text: string }[] = [];
/** What the stat list, the summary and "points left" were given. */
let editor: StatsEditorOptions | null = null;
let summaryPoints: Readonly<StatPoints> | null = null;
let leftPoints: Readonly<StatPoints> | null = null;

vi.mock('../dom', () => ({
  el: (_tag: string, props?: { className?: string; text?: string }) => {
    if (props?.text) shown.push({ className: props.className ?? '', text: props.text });
    return {};
  },
}));

vi.mock('../StatsPanel', () => ({
  pointsLeftText: (_ctx: unknown, _level: number, points: Readonly<StatPoints>) => {
    leftPoints = points;
    return { text: 'left', left: 3 };
  },
  statSummary: (_ctx: unknown, points: Readonly<StatPoints>) => {
    summaryPoints = points;
    return null;
  },
  statsEditor: (_ctx: unknown, options: StatsEditorOptions) => {
    editor = options;
    return null;
  },
}));

const { statusPanel } = await import('./StatusPanel');

const OWN: StatPoints = { hp: 10, defense: 5, power: 6, regen: 3, dexterity: 2 };
const MAXED: StatPoints = { hp: 999, defense: 999, power: 999, regen: 999, dexterity: 999 };

function open(debug: Readonly<StatPoints> | null, inFight = false) {
  const spent: StatPoints[] = [];
  const ctx = {
    i18n: { t: (key: string) => key, language: 'en' },
    session: { progress: { level: 10 }, character: { stats: { ...OWN } }, path: 'sword' },
    data: null,
  } as unknown as GameContext;
  const panel = statusPanel(
    ctx,
    {
      spend: (points) => spent.push(points),
      canSpend: () => !inFight,
      debugStats: () => debug,
      xpLine: () => 'Level 10',
    },
    () => undefined,
  );
  panel.build();
  return { spent, ctx };
}

beforeEach(() => {
  shown.length = 0;
  editor = null;
  summaryPoints = null;
  leftPoints = null;
});

describe('Status window with Max All Stats (GG.8.5 step 4)', () => {
  it('shows the 999 the game counts with, and says it is a temporary debug layer', () => {
    open(MAXED);
    expect(
      shown.some((s) => s.text === 'status.debugStats' && s.className.includes('ui-note-warn')),
    ).toBe(true);
    expect(editor?.points).toEqual(MAXED);
    expect(summaryPoints).toEqual(MAXED);
  });

  it('"points left" stays your own, and spending is off, so the 999 never become yours', () => {
    const { spent, ctx } = open(MAXED);
    expect(leftPoints).toEqual(OWN);
    expect(editor?.canSpend).toBe(false);
    expect(editor?.canRefund).toBe(false);
    // Not the "in a fight" warning: that is not why spending is off.
    expect(shown.some((s) => s.text === 'status.inCombat')).toBe(false);
    expect(spent).toEqual([]);
    expect(ctx.session?.character?.stats).toEqual(OWN);
  });

  it('switched off (Restore Stats): your own points, no debug line, spending as always', () => {
    open(null);
    expect(shown.some((s) => s.text === 'status.debugStats')).toBe(false);
    expect(editor?.points).toEqual(OWN);
    expect(summaryPoints).toEqual(OWN);
    expect(leftPoints).toEqual(OWN);
    expect(editor?.canSpend).toBe(true);
    editor?.onChange({ ...OWN, luck: 1 });
  });

  it('in a fight without the cheat: the normal "not while fighting" note, nothing else', () => {
    open(null, true);
    expect(editor?.canSpend).toBe(false);
    expect(shown.some((s) => s.text === 'status.inCombat')).toBe(true);
    expect(shown.some((s) => s.text === 'status.debugStats')).toBe(false);
  });
});
