import { describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../core/GameContext';
import type { GameEventBus } from '../../core/events';

// GG.8.3a: Sultan's stat window (the egg reset) must leave the overlay stack when its own button
// is pressed, like every other panel. Its Done button used to call the world's `resume` directly:
// the game ran again and caught the mouse while the window stayed on the stack, so it could not
// be closed any more and the status key stacked a second window on top. The tests run without a
// DOM, so the DOM helpers are replaced by plain objects; the panel and the real Overlays stack
// stay as they are.

/** The click handler of every button that was built, by its (untranslated) label. */
const clicks = new Map<string, () => void>();

vi.mock('../dom', () => {
  const node = (): Record<string, unknown> => ({
    hidden: false,
    append: () => undefined,
    remove: () => undefined,
    replaceWith: () => undefined,
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: () => undefined,
  });
  return {
    el: () => node(),
    button: (label: string, onClick: () => void) => {
      clicks.set(label, onClick);
      return node();
    },
  };
});

// The stat list itself is not what is tested here.
vi.mock('../StatsPanel', () => ({
  pointsLeftText: () => ({ text: '', left: 0 }),
  statSummary: () => null,
  statsEditor: () => null,
  statsPresetRow: () => null,
}));

const { Overlays } = await import('../Overlays');
const { redistributePanel } = await import('./RedistributePanel');

const DONE = 'stats.reset.done';

function setup() {
  vi.stubGlobal('window', { addEventListener: () => undefined });
  clicks.clear();
  const layer = { append: () => undefined } as unknown as HTMLElement;
  const events = { on: () => undefined } as unknown as GameEventBus;
  const overlays = new Overlays(layer, events);
  const ctx = {
    overlays,
    i18n: { t: (key: string) => key },
    session: { progress: { level: 3 }, character: { stats: {} }, path: null },
  } as unknown as GameContext;
  /** Whether a window was still on the stack each time the game resumed. */
  const openWhenResumed: boolean[] = [];
  /** What WorldState.openMenu passes as `resume`: the game runs again and catches the mouse. */
  const resume = vi.fn(() => openWhenResumed.push(overlays.isOpen));
  const handlers = {
    change: () => undefined,
    preset: () => undefined,
    random: () => undefined,
    clear: () => undefined,
    xpLine: () => '',
  };
  overlays.open(redistributePanel(ctx, handlers, resume));
  return { overlays, resume, openWhenResumed };
}

describe("GG.8.3a Sultan's stat window (egg reset)", () => {
  it('closing with ✕ or Escape takes it off the stack and resumes the game once', () => {
    const { overlays, resume } = setup();
    overlays.close();
    expect(overlays.isOpen).toBe(false);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('its own Done button takes it off the stack too, and resumes the game once', () => {
    const { overlays, resume } = setup();
    const done = clicks.get(DONE);
    expect(done).toBeDefined();
    expect(resume).not.toHaveBeenCalled();
    done?.();
    expect(overlays.isOpen).toBe(false);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('the game resumes (and catches the mouse) only once the window is gone', () => {
    const { openWhenResumed } = setup();
    clicks.get(DONE)?.();
    expect(openWhenResumed).toEqual([false]);
  });

  it('a double click on Done resumes only once', () => {
    const { overlays, resume } = setup();
    const done = clicks.get(DONE);
    done?.();
    done?.();
    expect(overlays.isOpen).toBe(false);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('after Done, a window opened next (the status key) is the only one, and closes to nothing', () => {
    const { overlays } = setup();
    clicks.get(DONE)?.();
    // The game runs again, so the status key opens the status window as the only panel.
    overlays.open({ build: () => ({}) as HTMLElement });
    overlays.close();
    expect(overlays.isOpen).toBe(false);
  });
});
