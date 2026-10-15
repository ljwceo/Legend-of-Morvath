#!/usr/bin/env node
/**
 * Intro check (step C.4a): does the filmed intro run from the first shot to the Monastery?
 *
 * It drives the real game in a headless browser through a fresh profile: English → New Game →
 * a name → the stats → Begin your journey, and then watches the intro scene go through its
 * three segments — the opening film (every shot id of `.ui-cine[data-shot]` is logged as it
 * changes), the playable fight (`.ui-fight`, with a few attacks clicked in), the film after it
 * — until the debug overlay says the save is in Greyhaven. It reports the shot ids seen, the
 * draw calls (`calls` in the overlay) during each segment, and fails on any console error.
 *
 * Playwright is not a dependency of the game, so install it when you want to run this:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   node scripts/intro-check.mjs          # the whole intro, film → fight → film → world
 *   node scripts/intro-check.mjs --skip   # hold Escape in the first film: the world follows at once
 *
 * Other options: `--url <game url>` (no own vite), `--headed`, `--chromium <path>` (a Chromium
 * to use instead of Playwright's own; /opt/pw-browsers/chromium is picked up by itself).
 *
 * Headless Chromium draws without a graphics card, so its fps means nothing; the fixed step
 * catches up at most 0.25 s per frame, so a slow frame makes the intro take longer, not break.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const VIEWPORT = { width: 1280, height: 720 };
/** A Chromium that is installed on the machine (the sandbox's), used when nothing else is named. */
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium';
/**
 * Hold Escape for this many game seconds to skip: the ring fills in `holdToSkipSeconds` (1 s)
 * of the fixed step, and without a graphics card a frame can take a while, so the hold is
 * measured on the game's own clock (the `sim` line), up to `SKIP_HOLD_MAX_MS` of wall time.
 */
const SKIP_HOLD_S = 1.5;
const SKIP_HOLD_MAX_MS = 10_000;
/** How often (ms) the page is looked at while the intro plays. */
const POLL_MS = 150;
/** Seconds each segment may take before the check gives up (slow headless frames included). */
const SEGMENT_TIMEOUT_S = { film: 180, fight: 300, world: 240 };

const options = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = { url: '', headed: false, skip: false, chromium: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--headed') out.headed = true;
    else if (arg === '--skip') out.skip = true;
    else if (arg === '--url' || arg === '--chromium') {
      out[arg.slice(2)] = argv[i + 1] ?? '';
      i++;
    } else {
      console.error(`unknown option ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    try {
      // Fall back to a Playwright that is installed next to node (CI images, sandboxes).
      const require = createRequire(import.meta.url);
      const module = await import(
        require.resolve('playwright', { paths: ['/opt/node-tools/node_modules'] })
      );
      return module.default ?? module;
    } catch {
      console.error(
        'Playwright is missing. Install it first:\n  npm i --no-save playwright && npx playwright install chromium',
      );
      process.exit(2);
    }
  }
}

/** The project (this script lives in its `scripts/` folder). */
const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Starts `vite` and waits for the address it prints (including the base path). Vite is run
 * directly (not through `npx`, which leaves vite running when it is stopped itself).
 */
function startServer() {
  return new Promise((resolve, reject) => {
    const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    const child = spawn(process.execPath, [vite, '--port', '5180', '--strictPort'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let text = '';
    const onData = (chunk) => {
      text += String(chunk);
      const match = /(http:\/\/localhost:\d+\/[^\s]*)/.exec(text);
      if (match) resolve({ url: match[1], stop: () => child.kill('SIGTERM') });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`vite stopped (${code})\n${text}`)));
    setTimeout(() => reject(new Error(`vite did not start\n${text}`)), 60_000);
  });
}

const problems = [];
const failures = [];

/** Collects errors from the page, so a run that looked fine but logged errors still fails. */
function watchForProblems(page) {
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`);
    say(`[pageerror] ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    problems.push(`console: ${message.text()}`);
    say(`[console] ${message.text()}`);
  });
}

function say(line) {
  console.log(typeof line === 'string' ? line : JSON.stringify(line));
}

function fail(line) {
  failures.push(line);
  say(`FAIL ${line}`);
}

/**
 * What the page shows right now: the shot of a playing film (or null), whether the fight's
 * UI is up, and the debug overlay's `calls`, `state` and `save` lines.
 */
async function look(page) {
  return page.evaluate(() => {
    const cine = document.querySelector('.ui-cine');
    const fight = document.querySelector('.ui-fight');
    const lines = new Map();
    for (const line of (document.querySelector('.debug-overlay')?.textContent ?? '').split('\n')) {
      const match = /^(\S+)\s+(.*)$/.exec(line);
      if (match) lines.set(match[1], match[2].trim());
    }
    return {
      shot: cine instanceof HTMLElement ? (cine.dataset.shot ?? '') : null,
      fight: fight instanceof HTMLElement && !fight.hidden,
      calls: Number(lines.get('calls') ?? -1),
      state: lines.get('state') ?? '',
      save: lines.get('save') ?? '',
      // Seconds of the fixed step so far ("123 steps, 2.1 s"): the game's own clock.
      sim: Number(/, ([\d.]+) s/.exec(lines.get('sim') ?? '')?.[1] ?? NaN),
      loading: document.querySelector('.ui-zone-loading') !== null,
    };
  });
}

/** Draw calls seen during one segment: the range, for the report. */
class Calls {
  min = Infinity;
  max = -Infinity;
  add(calls) {
    if (!(calls > 0)) return;
    this.min = Math.min(this.min, calls);
    this.max = Math.max(this.max, calls);
  }
  toString() {
    return this.min === Infinity
      ? '-'
      : this.min === this.max
        ? `${this.min}`
        : `${this.min}–${this.max}`;
  }
}

const click = (page, name) => page.getByRole('button', { name, exact: true }).first().click();

/** Through the language choice and the creator into the intro (a fresh profile every run). */
async function startNewGame(page) {
  await click(page, 'English');
  await click(page, 'New Game');
  await page.locator('input[type="text"]').first().fill('Introcheck');
  await click(page, 'Next: your stats');
  await click(page, 'Begin your journey');
}

/**
 * Follows a film: logs every shot id as it changes and returns the ids seen once the film is
 * gone (or `until(now)` says the segment is over). Fails when no shot ever appears.
 */
async function watchFilm(page, label, until) {
  const shots = [];
  const calls = new Calls();
  const deadline = Date.now() + SEGMENT_TIMEOUT_S.film * 1000;
  let seen = false;
  while (Date.now() < deadline) {
    const now = await look(page);
    if (now.shot !== null && now.shot !== '') {
      seen = true;
      calls.add(now.calls);
      if (shots.at(-1) !== now.shot) {
        shots.push(now.shot);
        say(`  ${label}: shot "${now.shot}" (calls ${now.calls}, state ${now.state})`);
      }
    } else if (seen || until(now)) {
      return { shots, calls };
    }
    await page.waitForTimeout(POLL_MS);
  }
  fail(`${label}: timed out after ${SEGMENT_TIMEOUT_S.film} s (shots so far: ${shots.join(', ')})`);
  return { shots, calls };
}

/**
 * A spot on the canvas that reaches the game's input surface, not the debug overlay (which
 * sits over part of the picture and swallows clicks).
 */
async function clickSpot(page) {
  for (const [fx, fy] of [
    [0.8, 0.6],
    [0.75, 0.75],
    [0.5, 0.85],
  ]) {
    const x = VIEWPORT.width * fx;
    const y = VIEWPORT.height * fy;
    const onSurface = await page.evaluate(
      ([px, py]) => document.elementFromPoint(px, py)?.closest('.ui-world-input') !== null,
      [x, y],
    );
    if (onSurface) return { x, y };
  }
  return { x: VIEWPORT.width * 0.8, y: VIEWPORT.height * 0.6 };
}

/**
 * The fight: clicks attack a few times (the first click captures the mouse, the next ones
 * swing the sword) and waits for the film after it. Returns the draw calls seen.
 */
async function playFight(page) {
  const calls = new Calls();
  const deadline = Date.now() + SEGMENT_TIMEOUT_S.fight * 1000;
  let clicks = 0;
  let lastClick = 0;
  while (Date.now() < deadline) {
    const now = await look(page);
    if (now.shot !== null) return { calls, ended: true };
    if (!now.fight) {
      if (now.state !== 'introScene') {
        fail(`the fight ended in state "${now.state}" without a second film`);
        return { calls, ended: false };
      }
    } else {
      calls.add(now.calls);
      if (clicks < 6 && Date.now() - lastClick > 700) {
        const spot = await clickSpot(page);
        await page.mouse.click(spot.x, spot.y);
        clicks++;
        lastClick = Date.now();
      }
    }
    await page.waitForTimeout(POLL_MS);
  }
  fail(`the fight did not end within ${SEGMENT_TIMEOUT_S.fight} s`);
  return { calls, ended: false };
}

/** Waits for the world: the save line names Greyhaven and the loading screen is gone. */
async function waitForWorld(page, label) {
  const deadline = Date.now() + SEGMENT_TIMEOUT_S.world * 1000;
  let last = null;
  while (Date.now() < deadline) {
    const now = await look(page);
    last = now;
    if (now.save.includes('greyhaven') && now.state === 'world' && !now.loading) {
      say(`  ${label}: in the world (${now.save}; calls ${now.calls})`);
      return true;
    }
    await page.waitForTimeout(POLL_MS * 2);
  }
  fail(`${label}: the world did not follow (state "${last?.state}", save "${last?.save}")`);
  return false;
}

/** Waits until the first film is on screen (the intro scene has started). */
async function waitForFilm(page) {
  const deadline = Date.now() + SEGMENT_TIMEOUT_S.film * 1000;
  while (Date.now() < deadline) {
    const now = await look(page);
    if (now.shot) return now;
    await page.waitForTimeout(POLL_MS);
  }
  fail('the intro film never appeared (.ui-cine[data-shot])');
  return null;
}

async function fullRun(page) {
  say('== the whole intro ==');
  if (!(await waitForFilm(page))) return;
  const film1 = await watchFilm(page, 'film 1', (now) => now.fight);
  say(`film 1: ${film1.shots.length} shots [${film1.shots.join(', ')}] · calls ${film1.calls}`);
  if (film1.shots.length === 0) fail('film 1 showed no shots');

  // The fight's UI comes up when the film is gone.
  const fightUp = await page
    .locator('.ui-fight:not([hidden])')
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!fightUp) fail('the fight UI (.ui-fight) did not appear after the first film');
  else say('  fight: .ui-fight is up');
  const fight = await playFight(page);
  say(`fight: ${fight.ended ? 'ended' : 'not ended'} · calls ${fight.calls}`);

  const film2 = await watchFilm(page, 'film 2', (now) => now.state !== 'introScene');
  say(`film 2: ${film2.shots.length} shots [${film2.shots.join(', ')}] · calls ${film2.calls}`);
  if (film2.shots.length === 0) fail('film 2 showed no shots');

  await waitForWorld(page, 'after the intro');
  return { film1, fight, film2 };
}

async function skipRun(page) {
  say('== skip in the first film ==');
  const first = await waitForFilm(page);
  if (!first) return;
  say(`  film 1: shot "${first.shot}" (calls ${first.calls}); holding Escape ${SKIP_HOLD_S} s`);
  await page.keyboard.down('Escape');
  const holdStart = Date.now();
  while (Date.now() - holdStart < SKIP_HOLD_MAX_MS) {
    const now = await look(page);
    if (now.shot === null || now.sim - first.sim >= SKIP_HOLD_S) break;
    await page.waitForTimeout(POLL_MS / 2);
  }
  await page.keyboard.up('Escape');
  say(`  held for ${Date.now() - holdStart} ms of wall time`);
  // At once: the scene is gone within a few frames, and the fight never shows.
  const left = await page
    .waitForFunction(
      () => {
        const lines = document.querySelector('.debug-overlay')?.textContent ?? '';
        return /^state\s+(?!introScene)\S+/m.test(lines) && !document.querySelector('.ui-cine');
      },
      null,
      { timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!left) fail('the intro scene did not end right after the hold');
  else say('  skipped: the intro scene is gone');
  const fightShown = await page.locator('.ui-fight:not([hidden])').count();
  if (fightShown > 0) fail('the fight UI showed after skipping');
  await waitForWorld(page, 'after the skip');
}

const playwright = await loadPlaywright();
const server = options.url ? { url: options.url, stop: () => {} } : await startServer();
const executablePath =
  options.chromium || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined);
const browser = await playwright.chromium.launch({
  headless: !options.headed,
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: VIEWPORT });
const gameUrl = `${server.url}${server.url.includes('?') ? '&' : '?'}debug=1`;
say(`game: ${gameUrl}`);

const page = await context.newPage();
watchForProblems(page);
await page.goto(gameUrl, { waitUntil: 'domcontentloaded' });
await startNewGame(page);
const started = Date.now();
try {
  if (options.skip) await skipRun(page);
  else await fullRun(page);
} catch (error) {
  fail(`unexpected: ${error instanceof Error ? error.message : String(error)}`);
}

say('\n== result ==');
say(`took ${Math.round((Date.now() - started) / 1000)} s`);
if (problems.length > 0) fail(`${problems.length} console problem(s): see above`);
else say('no console errors');
say(failures.length === 0 ? 'ok' : `${failures.length} failure(s)`);

await browser.close();
server.stop();
process.exit(failures.length === 0 ? 0 : 1);
