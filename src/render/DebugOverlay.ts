import type { WebGLRenderer } from 'three';
import type { FixedStep } from '../core/Time';

/** How often the overlay text refreshes. Text updates allocate strings, so keep this low. */
const REFRESH_SECONDS = 0.25;

/** Extra values a scene or system wants to show, e.g. player position (filled in later steps). */
export type DebugLines = Map<string, string>;

/**
 * How much of the overlay is on screen. Debug mode (and the cheat menu) stays on in every view,
 * also when the overlay is hidden.
 */
export const DEBUG_VIEWS = ['large', 'normal', 'small', 'mini', 'hidden'] as const;
export type DebugView = (typeof DEBUG_VIEWS)[number];

/** Scene lines that stay in the small view (the rest only in normal and large). */
const SMALL_VIEW_KEYS = ['zone', 'pos', 'quality', 'doors', 'build'];

/** Remembered per browser: a developer preference, not part of the save. */
const VIEW_STORAGE_KEY = 'morvath.debugView';

/** The view after `view` when cycling with F3 (hidden wraps around to large). */
export function nextDebugView(view: DebugView): DebugView {
  return DEBUG_VIEWS[(DEBUG_VIEWS.indexOf(view) + 1) % DEBUG_VIEWS.length] ?? 'large';
}

/** Whether the scene's own debug lines are on screen in this view (skip building them otherwise). */
export function showsSceneLines(view: DebugView): boolean {
  return view === 'large' || view === 'normal' || view === 'small';
}

/** Scene lines shown in a view, in insertion order. */
export function visibleLineKeys(view: DebugView, keys: Iterable<string>): string[] {
  if (!showsSceneLines(view)) return [];
  const all = [...keys];
  return view === 'small' ? all.filter((key) => SMALL_VIEW_KEYS.includes(key)) : all;
}

/**
 * Below this screen height (CSS pixels) the big view would cover the whole game, so a phone
 * lying down starts small. A tap on the overlay (or F3) still walks through every size.
 */
const SHORT_SCREEN_PX = 560;

export function defaultDebugView(screenHeight: number): DebugView {
  return screenHeight < SHORT_SCREEN_PX ? 'small' : 'large';
}

function loadView(): DebugView {
  const fallback = defaultDebugView(window.innerHeight);
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return (DEBUG_VIEWS as readonly string[]).includes(stored ?? '')
      ? (stored as DebugView)
      : fallback;
  } catch {
    return fallback;
  }
}

function storeView(view: DebugView): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Private mode or blocked storage: the view simply resets next time.
  }
}

interface MemoryInfo {
  usedJSHeapSize: number;
}

/**
 * Developer overlay: fps, frame time, CPU time, draw calls, triangles, GPU resources, simulation
 * counters. Debug mode is switched on in Settings or with `?debug=1`; F3 (or a three-finger tap)
 * switches it on and then cycles the size: large → normal → small → mini (fps only) → hidden.
 * Labels are technical abbreviations for developers and intentionally not translated.
 */
export class DebugOverlay {
  readonly lines: DebugLines = new Map();
  private readonly element: HTMLPreElement;
  private readonly errorElement: HTMLPreElement;
  private enabled = false;
  private viewMode: DebugView = loadView();

  private frames = 0;
  private frameTimeSum = 0;
  private frameTimeMax = 0;
  private cpuTimeSum = 0;
  private elapsed = 0;

  constructor(
    parent: HTMLElement,
    private readonly renderer: WebGLRenderer,
    private readonly time: FixedStep,
    private readonly getStateId: () => string | null,
  ) {
    this.element = document.createElement('pre');
    this.element.className = 'debug-overlay';
    parent.appendChild(this.element);
    this.errorElement = document.createElement('pre');
    this.errorElement.className = 'debug-errors';
    parent.appendChild(this.errorElement);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('touchstart', this.onTouchStart, { passive: true });
    // On a phone there is no F3: tapping the overlay itself shows the next size (and hides it
    // again), so it can never end up in the way of the game.
    this.element.addEventListener('click', this.onOverlayClick);
    this.setEnabled(new URLSearchParams(window.location.search).get('debug') === '1');
  }

  /** Debug mode: debug keys and the cheat menu work, also when the overlay itself is hidden. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Debug mode on and the overlay (in any size) on screen. */
  get isShown(): boolean {
    return this.enabled && this.viewMode !== 'hidden';
  }

  /** Debug mode on and the scene's own lines on screen (worth building them). */
  get showsLines(): boolean {
    return this.enabled && showsSceneLines(this.viewMode);
  }

  /** Debug mode on in a large view: room for extras such as building labels in the world. */
  get isDetailed(): boolean {
    return this.enabled && (this.viewMode === 'large' || this.viewMode === 'normal');
  }

  get view(): DebugView {
    return this.viewMode;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.applyView();
  }

  setView(view: DebugView): void {
    this.viewMode = view;
    storeView(view);
    this.applyView();
  }

  private applyView(): void {
    this.element.style.display = this.isShown ? 'block' : 'none';
    this.element.className = `debug-overlay debug-overlay--${this.viewMode}`;
    this.updateErrorVisibility();
    if (this.isShown) {
      this.reset();
      // Show the new size right away instead of after the next refresh.
      this.element.textContent = this.viewMode === 'mini' ? 'fps …' : 'debug …';
    }
  }

  private readonly onOverlayClick = (event: MouseEvent): void => {
    event.preventDefault();
    this.cycle();
  };

  /** F3 / a tap on the overlay / three-finger tap: debug mode on, or the next size. */
  private cycle(): void {
    if (!this.enabled) this.setEnabled(true);
    else this.setView(nextDebugView(this.viewMode));
  }

  /** Problems to show in red while debug mode is on (data validation, missing texts, ...). */
  setErrors(errors: readonly string[]): void {
    this.errorElement.textContent = errors.join('\n');
    this.updateErrorVisibility();
  }

  private updateErrorVisibility(): void {
    const show = this.isDetailed && this.errorElement.textContent !== '';
    this.errorElement.style.display = show ? 'block' : 'none';
  }

  /**
   * Call once per rendered frame, after rendering.
   * @param frameSeconds real time since the previous frame
   * @param cpuMs time spent in update + render this frame
   */
  frame(frameSeconds: number, cpuMs: number): void {
    if (!this.isShown) return;
    this.frames++;
    this.frameTimeSum += frameSeconds;
    if (frameSeconds > this.frameTimeMax) this.frameTimeMax = frameSeconds;
    this.cpuTimeSum += cpuMs;
    this.elapsed += frameSeconds;
    if (this.elapsed >= REFRESH_SECONDS) {
      this.refresh();
      this.reset();
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('touchstart', this.onTouchStart);
    this.element.removeEventListener('click', this.onOverlayClick);
    this.element.remove();
    this.errorElement.remove();
  }

  private reset(): void {
    this.frames = 0;
    this.frameTimeSum = 0;
    this.frameTimeMax = 0;
    this.cpuTimeSum = 0;
    this.elapsed = 0;
  }

  private refresh(): void {
    const fps = this.frames / this.elapsed;
    const avgMs = (this.frameTimeSum / this.frames) * 1000;
    const maxMs = this.frameTimeMax * 1000;
    const cpuMs = this.cpuTimeSum / this.frames;
    const info = this.renderer.info;
    const size = this.renderer.domElement;
    const memory = (performance as Performance & { memory?: MemoryInfo }).memory;

    if (this.viewMode === 'mini') {
      this.element.textContent = `${fps.toFixed(0)} fps · ${avgMs.toFixed(1)} ms · ${info.render.calls} calls`;
      return;
    }
    if (this.viewMode === 'small') {
      let small = `fps      ${fps.toFixed(0)} (${avgMs.toFixed(1)} ms, max ${maxMs.toFixed(1)})\ncalls    ${info.render.calls}`;
      for (const key of visibleLineKeys('small', this.lines.keys())) {
        small += `\n${key.padEnd(8)} ${this.lines.get(key) ?? ''}`;
      }
      this.element.textContent = small;
      return;
    }

    let text =
      `fps      ${fps.toFixed(0)}\n` +
      `frame    ${avgMs.toFixed(2)} ms (max ${maxMs.toFixed(1)})\n` +
      `cpu      ${cpuMs.toFixed(2)} ms\n` +
      `calls    ${info.render.calls}\n` +
      `tris     ${info.render.triangles}\n` +
      `geo/tex  ${info.memory.geometries} / ${info.memory.textures}\n` +
      (memory ? `heap     ${(memory.usedJSHeapSize / 1048576).toFixed(1)} MB\n` : '') +
      `res      ${size.width}x${size.height} @${this.renderer.getPixelRatio().toFixed(2)}\n` +
      `sim      ${this.time.steps} steps, ${this.time.simTime.toFixed(1)} s` +
      (this.time.droppedSteps > 0 ? `, ${this.time.droppedSteps} dropped` : '') +
      `\nstate    ${this.getStateId() ?? '-'}`;
    for (const [label, value] of this.lines) text += `\n${label.padEnd(8)} ${value}`;
    this.element.textContent = text;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'F3') {
      event.preventDefault();
      this.cycle();
    }
  };

  private readonly onTouchStart = (event: TouchEvent): void => {
    if (event.touches.length === 3) this.cycle();
  };
}
