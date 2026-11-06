import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../core/GameContext';
import type { Input } from '../core/Input';
import { Cheats } from '../systems/Cheats';
import type { CheatPanelHandlers } from './CheatPanel';

// GG.8.5 step 1: the cheat menu (F6) must keep its scroll position when a cheat is used. It used
// to build a whole new panel for every click, and the panel is what scrolls, so the list jumped
// back to the top. These tests run without a browser: a tiny stand-in for the DOM is enough for
// the real `el()` helper and the real CheatPanel (layout and real scrolling are checked in the
// browser).

/** A minimal element: children, attributes, click handlers, focus and a scroll position. */
class FakeElement {
  readonly tagName: string;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  className = '';
  textContent = '';
  hidden = false;
  value = '';
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  focusOptions: FocusOptions | undefined;
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((f) => f !== fn),
    );
  }
  click(): void {
    for (const fn of this.listeners.get('click') ?? []) fn({ target: this });
  }
  append(...nodes: (FakeElement | string)[]): void {
    for (const node of nodes) {
      if (typeof node === 'string') {
        this.textContent += node;
        continue;
      }
      node.parent?.removeChild(node);
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  removeChild(node: FakeElement): void {
    this.children = this.children.filter((child) => child !== node);
    node.parent = null;
  }
  remove(): void {
    this.parent?.removeChild(this);
  }
  replaceWith(node: FakeElement): void {
    const parent = this.parent;
    if (!parent) return;
    const at = parent.children.indexOf(this);
    node.parent?.removeChild(node);
    parent.children.splice(at, 1, node);
    node.parent = parent;
    this.parent = null;
  }
  contains(node: unknown): boolean {
    for (let n = node as FakeElement | null; n; n = n.parent) if (n === this) return true;
    return false;
  }
  focus(options?: FocusOptions): void {
    this.focusOptions = options;
    fakeDocument.activeElement = this;
  }
  select(): void {}
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const tests = selector.split(',').map((part) => part.trim());
    const found: FakeElement[] = [];
    const visit = (element: FakeElement): void => {
      for (const child of element.children) {
        if (tests.some((test) => child.matches(test))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  matches(test: string): boolean {
    if (test.startsWith('.')) return this.className.split(' ').includes(test.slice(1));
    if (test.startsWith('[') && test.endsWith(']')) return this.hasAttribute(test.slice(1, -1));
    return this.tagName === test.toUpperCase();
  }
}

const fakeDocument = {
  activeElement: null as FakeElement | null,
  createElement: (tag: string) => new FakeElement(tag),
};
vi.stubGlobal('document', fakeDocument);
vi.stubGlobal('HTMLElement', FakeElement);
vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
vi.stubGlobal('requestAnimationFrame', (fn: () => void) => fn());

const { CheatPanel } = await import('./CheatPanel');

const handlers: CheatPanelHandlers = {
  teleport: () => {},
  changed: () => {},
  exportSave: () => 'CODE-'.repeat(40),
  importSave: () => false,
  rerunBenchmark: () => {},
  nightMonsters: () => 0,
  grant: () => {},
  bossFight: () => {},
  skipBoss: () => {},
  bossEnding: () => {},
  spells: () => [],
  spell: () => null,
  setSpell: () => {},
  path: () => null,
  setPath: () => {},
  skipExams: () => {},
  eggs: () => ({ found: 0, total: 3 }),
  giveEgg: () => {},
  forgetEggs: () => {},
  clips: () => [],
  clip: () => null,
  setClip: () => {},
  cape: () => null,
  setCape: () => {},
};

function makePanel() {
  let view = 'normal';
  const ctx = {
    i18n: { t: (key: string) => key },
    debug: {
      get view() {
        return view;
      },
      setView: (next: string) => {
        view = next;
      },
    },
    quality: { debugLine: () => 'quality' },
    perfText: () => 'perf',
    perf: { start: () => {} },
    seasons: null,
    data: null,
    dayNight: null,
  } as unknown as GameContext;
  const input = { usedTouch: false, press: () => {}, release: () => {} } as unknown as Input;
  const cheats = new Cheats();
  const menu = new CheatPanel(
    ctx,
    cheats,
    [{ id: 'greyhaven', name: 'Greyhaven' }],
    input,
    handlers,
  );
  menu.setDebugVisible(true);
  const root = menu.root as unknown as FakeElement;
  /** The open panel (the element that scrolls), or null. */
  const panel = (): FakeElement | null => root.querySelector('.ui-cheats');
  /** The control with this text, inside the section with this title (as a player finds it). */
  const control = (section: string, text: string): FakeElement => {
    const open = panel();
    if (!open) throw new Error('menu is closed');
    const box = open
      .querySelectorAll('.ui-cheats-section')
      .find((s) => s.children[0]?.textContent === section);
    const found = box?.querySelectorAll('button, textarea').find((c) => c.textContent === text);
    if (!found) throw new Error(`no control "${text}" in ${section}`);
    return found;
  };
  return { menu, cheats, panel, control };
}

beforeEach(() => {
  fakeDocument.activeElement = null;
});

describe('F6 cheat menu keeps its place (GG.8.5 step 1)', () => {
  it('a cheat changes the content, but the panel that scrolls stays the same element', () => {
    const { menu, cheats, panel, control } = makePanel();
    menu.toggle();
    const scroller = panel();
    expect(scroller).not.toBeNull();
    if (!scroller) return;
    scroller.scrollTop = 640;
    const before = control('cheats.speed', '5×');
    before.click();
    expect(cheats.speed).toBe(5);
    expect(panel()).toBe(scroller);
    expect(scroller.scrollTop).toBe(640);
    // The content really was rebuilt: a new chip, now marked active.
    const after = control('cheats.speed', '5×');
    expect(after).not.toBe(before);
    expect(after.getAttribute('aria-pressed')).toBe('true');
  });

  it('a toggle (on/off) keeps the place too, also when it adds a line', () => {
    const { menu, cheats, panel, control } = makePanel();
    menu.toggle();
    const scroller = panel();
    if (!scroller) throw new Error('closed');
    scroller.scrollTop = 300;
    control('cheats.fly', 'cheats.on').click();
    expect(cheats.fly).toBe(true);
    expect(panel()).toBe(scroller);
    expect(scroller.scrollTop).toBe(300);
    control('cheats.monsters', 'cheats.off').click();
    expect(cheats.monsters).toBe(false);
    expect(panel()).toBe(scroller);
    expect(scroller.scrollTop).toBe(300);
  });

  it('many cheats quickly one after the other: never back to the top', () => {
    const { menu, cheats, panel, control } = makePanel();
    menu.toggle();
    const scroller = panel();
    if (!scroller) throw new Error('closed');
    scroller.scrollTop = 900;
    const clicks: [string, string][] = [
      ['cheats.speed', '2×'],
      ['cheats.speed', '10×'],
      ['cheats.chunkLines', 'cheats.on'],
      ['cheats.doors', '45°'],
      ['cheats.doors', 'cheats.off'],
      ['cheats.debugView', 'cheats.debugView_large'],
      ['cheats.aim', '2×'],
      ['cheats.save', 'cheats.saveExport'],
      ['cheats.save', 'cheats.saveExport'],
      ['cheats.speed', '1×'],
    ];
    for (const [section, text] of clicks) {
      control(section, text).click();
      expect(panel()).toBe(scroller);
      expect(scroller.scrollTop).toBe(900);
    }
    expect(cheats.speed).toBe(1);
    expect(cheats.chunkLines).toBe(true);
  });

  it('closing and opening again starts at the top, in a new panel', () => {
    const { menu, panel } = makePanel();
    menu.toggle();
    const first = panel();
    if (!first) throw new Error('closed');
    first.scrollTop = 500;
    menu.toggle();
    expect(panel()).toBeNull();
    menu.toggle();
    const second = panel();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second?.scrollTop).toBe(0);
  });

  it('the control you used keeps the focus (keyboard), without scrolling to it', () => {
    const { menu, panel, control } = makePanel();
    menu.toggle();
    const used = control('cheats.speed', '25×');
    used.focus();
    used.click();
    const now = fakeDocument.activeElement;
    expect(now).not.toBe(used);
    expect(now?.getAttribute('data-cheat-key')).toBe(used.getAttribute('data-cheat-key'));
    expect(now?.focusOptions).toEqual({ preventScroll: true });
    expect(panel()?.contains(now)).toBe(true);
  });

  it('the save code box keeps its own scroll when something else changes', () => {
    const { menu, control, panel } = makePanel();
    menu.toggle();
    control('cheats.save', 'cheats.saveExport').click();
    const box = panel()?.querySelector('textarea');
    if (!box) throw new Error('no code box');
    box.scrollTop = 42;
    control('cheats.speed', '2×').click();
    const next = panel()?.querySelector('textarea');
    expect(next).not.toBe(box);
    expect(next?.scrollTop).toBe(42);
  });

  it('every control of the menu has a key of its own', () => {
    const { menu, panel } = makePanel();
    menu.toggle();
    const keys = (panel()?.querySelectorAll('[data-cheat-key]') ?? []).map((c) =>
      c.getAttribute('data-cheat-key'),
    );
    const buttons = panel()?.querySelectorAll('button') ?? [];
    expect(keys.length).toBe(buttons.length);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
