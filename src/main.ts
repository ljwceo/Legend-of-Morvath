import { Bindings } from './core/Bindings';
import { createEventBus } from './core/events';
import type { GameContext } from './core/GameContext';
import { GameLoop } from './core/GameLoop';
import { LazyState } from './core/LazyState';
import { StateMachine } from './core/StateMachine';
import { I18n } from './i18n/I18n';
import { keyParams } from './ui/keyLabels';
import { DebugOverlay } from './render/DebugOverlay';
import { PerfProbe, type PerfResult } from './render/PerfProbe';
import { QualityManager } from './render/QualityManager';
import { Renderer } from './render/Renderer';
import { AutoSave } from './save/AutoSave';
import { browserStorage, SaveManager } from './save/SaveManager';
import { BootState } from './scenes/BootState';
import { frameCapFor, type StateId } from './scenes/flow';
import { IntroState } from './scenes/IntroState';
import { LanguageSelectState } from './scenes/LanguageSelectState';
import { TitleState } from './scenes/TitleState';
import { el } from './ui/dom';
import { Overlays } from './ui/Overlays';
import './style.css';
import './ui/ui.css';

const container = document.getElementById('app');
if (!container) {
  throw new Error('Missing #app element');
}

const params = new URLSearchParams(window.location.search);
const events = createEventBus();
const renderer = new Renderer(container);
const ui = el('div', { className: 'ui-layer' });
container.append(ui);

const states = new StateMachine<StateId>((from, to) => events.emit('stateChanged', { from, to }));

let debug: DebugOverlay | null = null;
let quality: QualityManager | null = null;
const perf = new PerfProbe();
let perfLine = '';
const loop = new GameLoop({
  update: (dt) => states.update(dt),
  render: (alpha, frameSeconds) => {
    const start = performance.now();
    states.render(alpha, frameSeconds);
    // During the benchmark the frame waits for the GPU, so its time is the real cost.
    if (quality?.benchmarking) renderer.waitForGpu();
    const workMs = loop.updateMs + performance.now() - start;
    debug?.frame(frameSeconds, workMs);
    quality?.frame(frameSeconds, workMs);
    const measured = perf.frame(frameSeconds);
    if (measured) onMeasured(measured);
  },
});
debug = new DebugOverlay(container, renderer.three, loop.time, () => states.id);
const debugOverlay = debug;

/** Problems shown in red in debug mode; logged to the console in every build. */
const debugErrors: string[] = [];
function showInDebug(message: string): void {
  debugErrors.push(message);
  debugOverlay.setErrors(debugErrors);
}

const i18n = new I18n();
i18n.onMissing = (key, language) => {
  const message = `missing text "${key}" (${language})`;
  console.warn(message);
  showInDebug(message);
};
const saves = new SaveManager(browserStorage());
const bindings = new Bindings();
// Any text may name the key the player bound: "{keyInteract}" becomes E, or whatever they chose.
i18n.defaultParams = () => keyParams(bindings, i18n);

// `?fps=30` caps the frame rate, to check that the game runs equally fast at any fps.
const fpsParam = Number(params.get('fps'));
const debugParam = params.get('debug') === '1';

quality = new QualityManager({
  renderer,
  events,
  getFile: () => ctx.data?.quality ?? null,
  getSettings: () => ctx.session?.settings ?? null,
  persist: () => ctx.persist(),
  getFrameCap: () => loop.frameCap,
});
const qualityManager = quality;

const ctx: GameContext = {
  renderer,
  events,
  loop,
  i18n,
  saves,
  bindings,
  debug: debugOverlay,
  quality: qualityManager,
  perf,
  perfText: () =>
    perf.running ? `measuring… ${Math.ceil(perf.remaining)} s` : perfLine || 'not measured yet',
  ui,
  overlays: new Overlays(ui, events),
  params,
  data: null,
  seasons: null,
  dayNight: null,
  session: null,
  introPanel: 0,
  goto: (state) => states.change(state),
  persist: () => (ctx.session ? saves.write(ctx.session) : false),
  reportProblem: (message) => {
    console.error(message);
    showInDebug(message);
  },
};

// The creator and the world are separate downloads (smaller first load); they are preloaded
// from the title screen, so entering them normally needs no waiting.
const createState = new LazyState(
  () => import('./scenes/CharacterCreateState').then((m) => new m.CharacterCreateState(ctx)),
  ctx.reportProblem,
);
const worldState = new LazyState(
  () => import('./scenes/WorldState').then((m) => new m.WorldState(ctx)),
  ctx.reportProblem,
);
const introFightState = new LazyState(
  () => import('./scenes/IntroFightState').then((m) => new m.IntroFightState(ctx)),
  ctx.reportProblem,
);
events.on('stateChanged', ({ to }) => {
  // The data is there after Boot, the save after the language choice: (re)apply the preset.
  applySettings();
  if (to === 'title') {
    void worldState.preload();
    void createState.preload();
    void introFightState.preload();
  }
});

states
  .register('boot', new BootState(ctx))
  .register('language', new LanguageSelectState(ctx))
  .register('title', new TitleState(ctx))
  .register('create', createState)
  .register('intro', new IntroState(ctx))
  .register('introFight', introFightState)
  .register('world', worldState);

// Saved settings that take effect right away.
function applySettings(): void {
  const settings = ctx.session?.settings;
  qualityManager.apply();
  // "Auto" fps follows the preset's target (Low/Mid 60, High 120).
  const target = qualityManager.preset?.fpsTarget ?? 0;
  loop.frameCap = frameCapFor(settings?.fpsCap ?? 'auto', fpsParam, target);
}
events.on('settingsChanged', () => {
  applySettings();
  const settings = ctx.session?.settings;
  if (settings && !debugParam) debugOverlay.setEnabled(settings.debug);
});
events.on('qualityChanged', () => {
  loop.frameCap = frameCapFor(
    ctx.session?.settings.fpsCap ?? 'auto',
    fpsParam,
    qualityManager.preset?.fpsTarget ?? 0,
  );
});

events.on('languageChanged', ({ language }) => {
  document.documentElement.lang = language;
});

new AutoSave(saves, events, () => ctx.session);

/** A finished fps measurement: one line to copy into the fps table (debug overlay + console). */
function onMeasured(result: PerfResult): void {
  const canvas = renderer.three.domElement;
  perfLine =
    `${qualityManager.preset?.id ?? '-'} · avg ${result.fps.toFixed(1)} fps · ` +
    `1% low ${result.low1Fps.toFixed(1)} · worst ${result.worstMs.toFixed(1)} ms · ` +
    `calls ${renderer.three.info.render.calls} · ${canvas.width}x${canvas.height}`;
  console.info(`[measure] ${perfLine}`);
  updateDebugLines();
}

// Debug lines: language, season, save. Text allocates, so refresh on a slow timer.
function updateDebugLines(): void {
  const lines = debugOverlay.lines;
  lines.set('lang', i18n.language);
  const seasons = ctx.seasons;
  if (seasons) {
    const ms = seasons.msUntilNext();
    const days = Math.floor(ms / 86_400_000);
    const hours = Math.floor((ms % 86_400_000) / 3_600_000);
    lines.set(
      'season',
      `${i18n.t(seasons.current().label)}${seasons.override ? ' (forced, F4)' : ''} · ` +
        i18n.t('season.nextIn', { days, hours }),
    );
  }
  const save = ctx.session;
  lines.set(
    'save',
    save
      ? `v${save.version}, ${save.world.zone ?? 'no zone'}, ${Math.floor(save.playTimeSeconds)} s`
      : 'none',
  );
  lines.set('quality', `${qualityManager.debugLine()} · cap ${loop.frameCap || 'none'}`);
  lines.set('measure', ctx.perfText());
}
window.setInterval(updateDebugLines, 1000);

window.addEventListener('keydown', (event) => {
  if (event.code === 'F4' && debugOverlay.isEnabled && ctx.seasons) {
    event.preventDefault();
    ctx.seasons.cycleOverride();
    updateDebugLines();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loop.resetClock();
});

states.change('boot');
states.applyPending();
loop.start();
