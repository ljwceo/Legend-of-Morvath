#!/usr/bin/env node
/**
 * Intro check (step C.4a): does the filmed intro run from the first shot to the Monastery?
 *
 * It drives the real game in a headless browser through a fresh profile: English → New Game →
 * a name → the stats → Begin your journey, and then watches the intro scene go through its
 * three segments — the opening film (every shot id of `.ui-cine[data-shot]` is logged as it
 * changes), the playable fight (`.ui-fight`: it fires all four abilities on their default keys,
 * and checks each big one did something: the icicle from the start reaches a brother, the
 * explosion next to them touches both, the thunder flashes the screen per bolt), the film
 * after it — until the debug overlay says the save is in Greyhaven. It reports the shot ids
 * seen, the overlay's numbers during each segment (draw calls `calls`, `tris`, `geo/tex` as
 * first → last sample, `heap`) and once the world's geo/tex stand still, and the damage texts
 * the fight showed, and fails on any console error.
 *
 * Playwright is not a dependency of the game, so install it when you want to run this:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   node scripts/intro-check.mjs                 # the whole intro, film → fight → film → world
 *   node scripts/intro-check.mjs --skip          # hold Escape in the first film: the world follows at once
 *   node scripts/intro-check.mjs --quality high  # on one graphics preset: low, mid or high
 *
 * `--quality` works the way mem-check.mjs sets the preset: right after the language choice
 * (which makes the save) and before New Game, the page is opened again with the save patched —
 * `settings.quality` and `settings.autoQuality` set to the preset — so the intro and the world
 * run on it from their first frame. Without it the save stays on `auto`. The world's numbers
 * after a full run against those after `--skip` on the same preset show what the intro left
 * behind. Other options: `--url <game url>` (no own vite), `--headed`, `--chromium <path>` (a
 * Chromium to use instead of Playwright's own; /opt/pw-browsers/chromium is picked up by itself).
 *
 * Headless Chromium draws without a graphics card, so its fps means nothing (draw calls,
 * triangles, geometries, textures and the heap are the same as on a real machine); the fixed
 * step catches up at most 0.25 s per frame, so a slow frame makes the intro take longer, not
 * break.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

/** Tall enough for the overlay's large view (`tris`, `geo/tex`, `heap`: DebugOverlay). */
const VIEWPORT = { width: 1280, height: 720 };
/** A Chromium that is installed on the machine (the sandbox's), used when nothing else is named. */
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium';
/** Where the game keeps its save (SaveManager.SAVE_KEY). */
const SAVE_KEY = 'legend-of-morvath.save';
/** The graphics presets (quality.json). */
const QUALITY_LEVELS = ['low', 'mid', 'high'];
/**
 * The world has arrived once geo/tex stayed the same for this many looks (at `POLL_MS * 2`)
 * while the game's clock moved: numbers that stand still while nothing is drawn are old ones.
 */
const SETTLE_SAMPLES = 5;
/**
 * Hold Escape for this many game seconds to skip: the ring fills in `holdToSkipSeconds` (1 s)
 * of the fixed step, and without a graphics card a frame can take a while, so the hold is
 * measured on the game's own clock (the `sim` line), up to `SKIP_HOLD_MAX_MS` of wall time.
 */
const SKIP_HOLD_S = 1.5;
const SKIP_HOLD_MAX_MS = 10_000;
/**
 * The fight, step by step: the abilities' default keys (controls.json) — the sword's hit (left
 * mouse), thunder (Q), the explosion (right mouse) and the icicle (Tab) — and what each big one
 * must show within `VERIFY_S` of the game's clock. From the start the brothers stand 9 m ahead,
 * 11° to either side: the icicle must snap to one (a "0" or "Dodged!" text). The walk (`WALK_S`
 * on the game's clock, 4 m/s: to about 3 m past the middle, right between the brothers, even
 * after one dodged 3 m aside) puts both within the explosion's 4.5 m: two texts. The thunder
 * puts `ui-fight-storm` on the overlay for its strikes and `ui-fight-strike` per bolt. The
 * presses after that make no promise: by then the script may have frozen the player.
 */
const WALK_S = 2;
const WALK_MAX_MS = 20_000;
const PRESS_GAP_MS = 700;
const VERIFY_S = 1.5;
const VERIFY_MAX_MS = 10_000;
const FIGHT_PLAN = [
  { press: 'icicle', key: 'Tab', expect: { texts: 1 } },
  { walk: true },
  { press: 'explosion', key: 'right', expect: { texts: 2 } },
  { press: 'thunder', key: 'KeyQ', expect: { storm: true } },
  { press: 'strike', key: 'left' },
  { press: 'icicle', key: 'Tab' },
  { press: 'explosion', key: 'right' },
  { press: 'strike', key: 'left' },
  { press: 'thunder', key: 'KeyQ' },
  { press: 'icicle', key: 'Tab' },
];
/** How often (ms) the page is looked at while the intro plays. */
const POLL_MS = 150;
/** Seconds each segment may take before the check gives up (slow headless frames included). */
const SEGMENT_TIMEOUT_S = { film: 180, fight: 300, world: 240 };

const options = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = { url: '', headed: false, skip: false, chromium: '', quality: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--headed') out.headed = true;
    else if (arg === '--skip') out.skip = true;
    else if (arg === '--url' || arg === '--chromium' || arg === '--quality') {
      out[arg.slice(2)] = argv[i + 1] ?? '';
      i++;
    } else {
      console.error(`unknown option ${arg}`);
      process.exit(2);
    }
  }
  if (out.quality && !QUALITY_LEVELS.includes(out.quality)) {
    console.error(`--quality takes one of ${QUALITY_LEVELS.join(', ')}, not "${out.quality}"`);
    process.exit(2);
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
/** The texts the fight floats over a brother: a hit shows "0", a dodge `boss.dodged` (en.json). */
const HIT_TEXT = '0';
const DODGED_TEXT = JSON.parse(readFileSync(path.join(ROOT, 'public/lang/en.json'), 'utf8')).boss
  .dodged;

/**
 * Starts `vite` and waits for the address it prints (including the base path), on whatever
 * free port vite picks. Vite is run directly (not through `npx`, which leaves vite running
 * when it is stopped itself).
 */
function startServer() {
  return new Promise((resolve, reject) => {
    const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    const child = spawn(process.execPath, [vite], {
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
 * Counts, inside the page, how often the fight's overlay gains its thunder classes: the storm
 * (`ui-fight-storm`, on for the strikes) and the flash per bolt (`ui-fight-strike`, 0.1 s —
 * too short to be sure of catching by polling, so a MutationObserver counts it).
 */
async function watchOverlay(page) {
  await page.evaluate(() => {
    const counts = { storm: 0, strike: 0 };
    window.__introCheckFlashes = counts;
    const overlay = document.querySelector('.ui-fight-overlay');
    if (!overlay) return;
    let had = new Set(overlay.classList);
    new MutationObserver(() => {
      const now = new Set(overlay.classList);
      if (now.has('ui-fight-storm') && !had.has('ui-fight-storm')) counts.storm++;
      if (now.has('ui-fight-strike') && !had.has('ui-fight-strike')) counts.strike++;
      had = now;
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  });
}

/**
 * What the page shows right now: the shot of a playing film (or null), whether the fight's
 * UI is up, the damage texts on screen (by their slot in the pool), the thunder flashes
 * counted so far and the debug overlay's lines: `calls`, `tris`, `geo/tex` (as `geo` and
 * `tex`), `heap` (MB; -1 when a line is missing), `quality`, `state` and `save`.
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
    const damage = [];
    document.querySelectorAll('.ui-damage').forEach((element, index) => {
      if (element instanceof HTMLElement && !element.hidden) {
        damage.push([index, element.textContent ?? '']);
      }
    });
    const flashes = window.__introCheckFlashes ?? { storm: 0, strike: 0 };
    const number = (text) => {
      const value = Number(text);
      return Number.isFinite(value) ? value : -1;
    };
    const [geo, tex] = (lines.get('geo/tex') ?? '').split('/');
    return {
      shot: cine instanceof HTMLElement ? (cine.dataset.shot ?? '') : null,
      fight: fight instanceof HTMLElement && !fight.hidden,
      damage,
      storms: flashes.storm,
      strikes: flashes.strike,
      calls: Number(lines.get('calls') ?? -1),
      tris: number(lines.get('tris')),
      geo: number(geo?.trim() || NaN),
      tex: number(tex?.trim() || NaN),
      heap: number((lines.get('heap') ?? '').replace(' MB', '') || NaN),
      quality: lines.get('quality') ?? '',
      state: lines.get('state') ?? '',
      save: lines.get('save') ?? '',
      // Seconds of the fixed step so far ("123 steps, 2.1 s"): the game's own clock.
      sim: Number(/, ([\d.]+) s/.exec(lines.get('sim') ?? '')?.[1] ?? NaN),
      loading: document.querySelector('.ui-zone-loading') !== null,
    };
  });
}

/**
 * The damage texts that appeared, counted once each: a pooled slot that shows a text it did not
 * show at the last look is a new number (the pool is 24 deep and a number lives 0.9 s, so a
 * slot is never reused with the same text between two looks).
 */
class DamageTexts {
  /** Slot index -> the text it shows now. */
  showing = new Map();
  /** Text -> how often it appeared. */
  counts = new Map();
  add(slots) {
    const visible = new Set();
    for (const [index, text] of slots) {
      visible.add(index);
      if (this.showing.get(index) === text) continue;
      this.showing.set(index, text);
      this.counts.set(text, (this.counts.get(text) ?? 0) + 1);
    }
    for (const index of [...this.showing.keys()])
      if (!visible.has(index)) this.showing.delete(index);
  }
  count(text) {
    return this.counts.get(text) ?? 0;
  }
  /** The texts a brother shows when an ability reaches him: a hit's "0" or a dodge's. */
  get contacts() {
    return this.count(HIT_TEXT) + this.count(DODGED_TEXT);
  }
  toString() {
    const parts = [...this.counts].map(([text, n]) => `"${text}"×${n}`);
    return parts.length > 0 ? parts.join(', ') : 'none';
  }
}

/** The lowest and highest of a number, for the report. */
class Range {
  min = Infinity;
  max = -Infinity;
  add(value) {
    if (!Number.isFinite(value) || value < 0) return;
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
  }
  toString(digits = 0) {
    if (this.min === Infinity) return '-';
    const low = this.min.toFixed(digits);
    const high = this.max.toFixed(digits);
    return low === high ? low : `${low}–${high}`;
  }
}

/**
 * The overlay's numbers seen during one segment: the ranges of the draw calls, triangles,
 * geometries, textures and heap, and geo/tex of the first and the last look (a segment that
 * ends above where it began kept something).
 */
class Stats {
  calls = new Range();
  tris = new Range();
  geo = new Range();
  tex = new Range();
  heap = new Range();
  first = '';
  last = '';
  add(now) {
    // Nothing drawn yet (a loading screen, the overlay before its first refresh): no sample.
    if (!(now.calls > 0)) return;
    this.calls.add(now.calls);
    this.tris.add(now.tris);
    this.geo.add(now.geo);
    this.tex.add(now.tex);
    this.heap.add(now.heap);
    if (now.geo < 0) return;
    const geoTex = `${now.geo}/${now.tex}`;
    if (!this.first) this.first = geoTex;
    this.last = geoTex;
  }
  toString() {
    return (
      `calls ${this.calls} · tris ${this.tris} · geo/tex ${this.first || '-'} → ${this.last || '-'}` +
      ` (geo ${this.geo}, tex ${this.tex}) · heap ${this.heap.toString(1)} MB`
    );
  }
}

const click = (page, name) => page.getByRole('button', { name, exact: true }).first().click();

/**
 * Patches the save and opens the game again with it (the same as mem-check.mjs). The game
 * saves by itself when the page goes away (AutoSave on `pagehide`), which would write the old
 * settings right back over the patch, so the page is closed first and the patch runs in the
 * new page before the game starts. Returns the new page; the old one is gone.
 */
async function reopenWith(page, fields) {
  await page.close();
  const next = await page.context().newPage();
  watchForProblems(next);
  await next.addInitScript(
    ([key, patch]) => {
      const save = JSON.parse(window.localStorage.getItem(key) ?? 'null');
      if (!save) return;
      for (const [group, values] of Object.entries(patch)) {
        save[group] = values && typeof values === 'object' ? { ...save[group], ...values } : values;
      }
      window.localStorage.setItem(key, JSON.stringify(save));
    },
    [SAVE_KEY, fields],
  );
  await next.goto(gameUrl, { waitUntil: 'domcontentloaded' });
  return next;
}

/**
 * Through the language choice and the creator into the intro (a fresh profile every run).
 * With `--quality`, the save the language choice made gets the preset before New Game.
 * Returns the page the game is on (a new one after the patch).
 */
async function startNewGame(page) {
  await click(page, 'English');
  if (options.quality) {
    page = await reopenWith(page, {
      settings: { quality: options.quality, autoQuality: options.quality },
    });
  }
  await click(page, 'New Game');
  await page.locator('input[type="text"]').first().fill('Introcheck');
  await click(page, 'Next: your stats');
  await click(page, 'Begin your journey');
  return page;
}

/**
 * Follows a film: logs every shot id as it changes and returns the ids seen once the film is
 * gone (or `until(now)` says the segment is over). Fails when no shot ever appears.
 */
async function watchFilm(page, label, until) {
  const shots = [];
  const stats = new Stats();
  const deadline = Date.now() + SEGMENT_TIMEOUT_S.film * 1000;
  let seen = false;
  while (Date.now() < deadline) {
    const now = await look(page);
    if (now.shot !== null && now.shot !== '') {
      seen = true;
      stats.add(now);
      if (shots.at(-1) !== now.shot) {
        shots.push(now.shot);
        say(
          `  ${label}: shot "${now.shot}" (calls ${now.calls}, tris ${now.tris}, geo/tex ${now.geo}/${now.tex}, state ${now.state})`,
        );
      }
    } else if (seen || until(now)) {
      return { shots, stats };
    }
    await page.waitForTimeout(POLL_MS);
  }
  fail(`${label}: timed out after ${SEGMENT_TIMEOUT_S.film} s (shots so far: ${shots.join(', ')})`);
  return { shots, stats };
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

/** Presses one ability's default key: a mouse button on the canvas, or a key. */
async function pressAbility(page, key) {
  if (key === 'left' || key === 'right') {
    const spot = await clickSpot(page);
    await page.mouse.click(spot.x, spot.y, { button: key });
  } else {
    await page.keyboard.press(key);
  }
}

/**
 * What a press promised (`FIGHT_PLAN[].expect`) against what the page showed since: the damage
 * texts a brother floated, and the thunder's overlay classes.
 */
function checkPress(step, before, now, damage) {
  const texts = damage.contacts - before.contacts;
  const storms = now.storms - before.storms;
  const strikes = now.strikes - before.strikes;
  const seen = `${texts} text(s), ${storms} storm(s), ${strikes} bolt flash(es)`;
  const wanted = step.expect;
  const ok =
    (wanted.texts === undefined || texts >= wanted.texts) &&
    (!wanted.storm || (storms >= 1 && strikes >= 1));
  if (ok) say(`  fight: ${step.press} showed ${seen}`);
  else fail(`${step.press} (${step.key}) showed ${seen}, wanted ${JSON.stringify(wanted)}`);
}

/**
 * The fight: a first click captures the mouse, then `FIGHT_PLAN` runs: the player fires the
 * abilities on their keys (one every `PRESS_GAP_MS`, each promise checked after `VERIFY_S` of
 * the game's clock) and walks up to the brothers in between (W, timed on the game's clock),
 * while the damage texts that appear are counted; then it waits for the film after the fight.
 * Returns the overlay's numbers and the damage texts seen.
 */
async function playFight(page) {
  const stats = new Stats();
  const damage = new DamageTexts();
  const deadline = Date.now() + SEGMENT_TIMEOUT_S.fight * 1000;
  let phase = 'capture';
  let walkStartSim = NaN;
  let walkStartWall = 0;
  let stepIndex = 0;
  let lastPress = 0;
  /** The press being verified: the counts before it, and when it was pressed. */
  let verifying = null;
  const letGo = () => page.keyboard.up('KeyW').catch(() => undefined);
  while (Date.now() < deadline) {
    const now = await look(page);
    if (now.shot !== null) {
      await letGo();
      return { stats, damage, ended: true };
    }
    if (!now.fight) {
      if (now.state !== 'introScene') {
        await letGo();
        fail(`the fight ended in state "${now.state}" without a second film`);
        return { stats, damage, ended: false };
      }
    } else {
      stats.add(now);
      damage.add(now.damage);
      if (phase === 'capture') {
        await watchOverlay(page);
        const spot = await clickSpot(page);
        await page.mouse.click(spot.x, spot.y);
        phase = 'plan';
      } else if (verifying) {
        if (now.sim - verifying.sim >= VERIFY_S || Date.now() - verifying.wall > VERIFY_MAX_MS) {
          checkPress(verifying.step, verifying.before, now, damage);
          verifying = null;
        }
      } else if (phase === 'plan') {
        const step = FIGHT_PLAN[stepIndex];
        if (!step) {
          phase = 'wait';
        } else if (step.walk) {
          if (Number.isNaN(walkStartSim)) {
            walkStartSim = now.sim;
            walkStartWall = Date.now();
            await page.keyboard.down('KeyW');
          } else if (now.sim - walkStartSim >= WALK_S || Date.now() - walkStartWall > WALK_MAX_MS) {
            await letGo();
            say(`  fight: walked ${(now.sim - walkStartSim).toFixed(1)} s towards the brothers`);
            stepIndex++;
          }
        } else if (Date.now() - lastPress > PRESS_GAP_MS) {
          const before = { contacts: damage.contacts, storms: now.storms, strikes: now.strikes };
          await pressAbility(page, step.key);
          lastPress = Date.now();
          say(`  fight: ${step.press} (${step.key})`);
          if (step.expect) verifying = { step, before, sim: now.sim, wall: Date.now() };
          stepIndex++;
        }
      }
    }
    await page.waitForTimeout(POLL_MS);
  }
  await letGo();
  fail(`the fight did not end within ${SEGMENT_TIMEOUT_S.fight} s`);
  return { stats, damage, ended: false };
}

/** One look's numbers on one line, for the report. */
const numbers = (now) =>
  `calls ${now.calls} · tris ${now.tris} · geo/tex ${now.geo}/${now.tex} · heap ${now.heap} MB`;

/**
 * Waits for the world: the save line names Greyhaven and the loading screen is gone, and then
 * geo/tex stand still for `SETTLE_SAMPLES` looks while the game's clock runs. Those settled
 * numbers (against a `--skip` run on the same preset) show what the intro left behind; when
 * they never settle in time that is reported, not failed. Returns the last look, or null when
 * the world did not come.
 */
async function waitForWorld(page, label) {
  const deadline = Date.now() + SEGMENT_TIMEOUT_S.world * 1000;
  let last = null;
  let same = 0;
  let arrived = false;
  while (Date.now() < deadline) {
    const now = await look(page);
    if (!arrived && now.save.includes('greyhaven') && now.state === 'world' && !now.loading) {
      arrived = true;
      say(`  ${label}: in the world (${now.save}; ${numbers(now)})`);
    } else if (arrived && last !== null && now.sim > last.sim && now.calls > 0) {
      same = now.geo === last.geo && now.tex === last.tex ? same + 1 : 0;
      if (same >= SETTLE_SAMPLES) {
        say(`  ${label}: world settled · ${numbers(now)} · quality ${now.quality}`);
        return now;
      }
    }
    last = now;
    await page.waitForTimeout(POLL_MS * 2);
  }
  if (arrived) {
    say(`  ${label}: the world's geo/tex kept changing; last ${numbers(last)}`);
    return last;
  }
  fail(`${label}: the world did not follow (state "${last?.state}", save "${last?.save}")`);
  return null;
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
  const first = await waitForFilm(page);
  if (!first) return null;
  say(`  quality: ${first.quality} · first look ${numbers(first)}`);
  const film1 = await watchFilm(page, 'film 1', (now) => now.fight);
  say(`film 1: ${film1.shots.length} shots [${film1.shots.join(', ')}] · ${film1.stats}`);
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
  say(
    `fight: ${fight.ended ? 'ended' : 'not ended'} · ${fight.stats} · damage texts ${fight.damage}`,
  );
  if (fight.damage.contacts === 0) {
    fail(
      `the fight showed no "${HIT_TEXT}" and no "${DODGED_TEXT}" (did the abilities reach the brothers?)`,
    );
  }

  const film2 = await watchFilm(page, 'film 2', (now) => now.state !== 'introScene');
  say(`film 2: ${film2.shots.length} shots [${film2.shots.join(', ')}] · ${film2.stats}`);
  if (film2.shots.length === 0) fail('film 2 showed no shots');

  const world = await waitForWorld(page, 'after the intro');
  return { film1, fight, film2, world };
}

async function skipRun(page) {
  say('== skip in the first film ==');
  const first = await waitForFilm(page);
  if (!first) return null;
  say(`  quality: ${first.quality}`);
  say(`  film 1: shot "${first.shot}" (${numbers(first)}); holding Escape ${SKIP_HOLD_S} s`);
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
  const world = await waitForWorld(page, 'after the skip');
  return { world };
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

let page = await context.newPage();
watchForProblems(page);
await page.goto(gameUrl, { waitUntil: 'domcontentloaded' });
page = await startNewGame(page);
const started = Date.now();
let run = null;
try {
  run = options.skip ? await skipRun(page) : await fullRun(page);
} catch (error) {
  fail(`unexpected: ${error instanceof Error ? error.message : String(error)}`);
}

say(`\n== numbers (quality ${options.quality || 'auto'}${options.skip ? ', skipped' : ''}) ==`);
for (const [label, stats] of [
  ['film 1', run?.film1?.stats],
  ['fight', run?.fight?.stats],
  ['film 2', run?.film2?.stats],
]) {
  if (stats) say(`${label.padEnd(8)} ${stats}`);
}
if (run?.world) say(`${'world'.padEnd(8)} ${numbers(run.world)}`);

say('\n== result ==');
say(`took ${Math.round((Date.now() - started) / 1000)} s`);
if (problems.length > 0) fail(`${problems.length} console problem(s): see above`);
else say('no console errors');
say(failures.length === 0 ? 'ok' : `${failures.length} failure(s)`);

await browser.close();
server.stop();
process.exit(failures.length === 0 ? 0 : 1);
