#!/usr/bin/env node
/**
 * Morvath check (step W.1): does the Morvath prototype load and play in the real game?
 *
 * Drives the game in a headless browser: makes a character (so Greyhaven still has to load),
 * teleports to Morvath with the cheat menu (F6), walks the primary route from the pass past the
 * chapel and the crossing to the gate of the Black Citadel, and at every stop reads the debug
 * overlay (draw calls, triangles, chunks, zone) and takes a screenshot. Console errors fail it.
 *
 * Playwright is not a dependency of the game, so install it when you want to run this:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   node scripts/morvath-check.mjs                   # preset mid
 *   node scripts/morvath-check.mjs --quality high --out docs/checks/morvath
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/morvath-check.mjs   # own Chromium
 *
 * Headless Chromium draws without a graphics card, so fps means nothing here; draw calls,
 * triangles, chunks and what the screenshots show are the same as on a real machine.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const SAVE_KEY = 'legend-of-morvath.save';
const VIEWPORT = { width: 1280, height: 720 };
const STEP_MS = { min: 600, max: 3000, frames: 5 };
const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * The primary route (zones.json / triggers.json), with the place each stop should have found and
 * the zone id the debug overlay should show there.
 */
const ROUTE = [
  { name: 'pass', x: 1250, z: -2, place: 'morvath_threshold' },
  { name: 'chapel', x: 1335, z: -50, place: 'fallen_chapel' },
  { name: 'crossing', x: 1465, z: 28, place: 'blight_crossing' },
  { name: 'road_east', x: 1620, z: 2 },
  {
    name: 'citadel_gate',
    x: 1766,
    z: 0,
    place: 'citadel_gate',
    zone: 'black_citadel',
  },
];

const options = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = {
    quality: 'mid',
    out: path.join(ROOT, 'docs', 'checks', 'morvath'),
    headed: false,
    url: '',
    speed: '2×',
  };
  const names = { '--quality': 'quality', '--out': 'out', '--url': 'url', '--speed': 'speed' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--headed') out.headed = true;
    else if (names[arg]) out[names[arg]] = argv[++i];
    else {
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
      const require = createRequire(import.meta.url);
      const module = await import(
        require.resolve('playwright', { paths: ['/opt/node-tools/node_modules'] })
      );
      return module.default ?? module;
    } catch {
      console.error(
        'Playwright is missing: npm i --no-save playwright && npx playwright install chromium',
      );
      process.exit(2);
    }
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    const child = spawn(process.execPath, [vite, '--port', '5181', '--strictPort'], {
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

const log = [];
const problems = [];
function say(line) {
  console.log(line);
  log.push(line);
}
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

async function overlay(page) {
  const text = await page.evaluate(
    () => document.querySelector('.debug-overlay')?.textContent ?? '',
  );
  const lines = new Map();
  for (const line of text.split('\n')) {
    const match = /^(\S+)\s+(.*)$/.exec(line);
    if (match) lines.set(match[1], match[2].trim());
  }
  return lines;
}

async function sample(page) {
  const lines = await overlay(page);
  const pos = (lines.get('pos') ?? '').split('·')[0]?.split(',').map(Number) ?? [];
  const frameMs = Number(/^([\d.]+) ms/.exec(lines.get('frame') ?? '')?.[1]);
  return {
    calls: Number(lines.get('calls') ?? -1),
    tris: Number(lines.get('tris') ?? -1),
    frameMs: Number.isFinite(frameMs) ? frameMs : -1,
    x: pos[0] ?? NaN,
    y: pos[1] ?? NaN,
    z: pos[2] ?? NaN,
    zone: (lines.get('zone') ?? '').split('·')[0]?.trim() ?? '',
    zoneLine: lines.get('zone') ?? '',
    state: lines.get('state') ?? '',
    chunks: lines.get('chunks') ?? '',
    preset: (lines.get('chunks') ?? '').split('·').at(-1)?.trim() ?? '',
    steps: Number(/^(\d+) steps/.exec(lines.get('sim') ?? '')?.[1] ?? -1),
    heading: (Number(/heading (-?\d+)/.exec(lines.get('pos') ?? '')?.[1] ?? NaN) * Math.PI) / 180,
    daynight: lines.get('daynight') ?? '',
    geoTex: lines.get('geo/tex') ?? '',
  };
}

/** Waits until the world is up and the chunks around the player have loaded. */
async function settled(page, { seconds = 120, quiet = 3 } = {}) {
  const deadline = Date.now() + seconds * 1000;
  let last = null;
  let same = 0;
  let latest = null;
  while (Date.now() < deadline) {
    const now = await sample(page);
    latest = now;
    const loading = (await page.locator('.ui-zone-loading').count()) > 0;
    const ready =
      !loading &&
      now.state === 'world' &&
      Number.isFinite(now.x) &&
      now.chunks !== '' &&
      !/loading [1-9]/.test(now.chunks);
    if (last !== null && now.steps > last.steps) {
      if (now.chunks === last.chunks) same++;
      else same = 0;
      last = now;
      if (same >= quiet && ready) return now;
    } else if (last === null) {
      last = now;
    }
    await page.waitForTimeout(500);
  }
  say(
    `warning: nothing settled after ${seconds} s (state ${latest?.state}, chunks ${latest?.chunks})`,
  );
  return latest;
}

const click = (page, name) => page.getByRole('button', { name, exact: true }).first().click();
const pressMs = (frameMs) =>
  Math.round(
    Math.min(STEP_MS.max, Math.max(STEP_MS.min, (frameMs > 0 ? frameMs : 16) * STEP_MS.frames)),
  );

async function reopenWith(page, fields) {
  await page.close();
  const next = await page.context().newPage();
  watchForProblems(next);
  if (fields) {
    await next.addInitScript(
      ([key, patch]) => {
        const save = JSON.parse(window.localStorage.getItem(key) ?? 'null');
        if (!save) return;
        for (const [group, values] of Object.entries(patch))
          save[group] = { ...save[group], ...values };
        window.localStorage.setItem(key, JSON.stringify(save));
      },
      [SAVE_KEY, fields],
    );
  }
  await next.goto(gameUrl, { waitUntil: 'domcontentloaded' });
  return next;
}
const readSave = (page) =>
  page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? 'null'), SAVE_KEY);

async function createCharacter(page) {
  await click(page, 'English');
  const next = await reopenWith(page, {
    settings: { debug: true, quality: options.quality, autoQuality: options.quality },
  });
  await click(next, 'New Game');
  await next.locator('input[type="text"]').first().fill('Morvathcheck');
  await click(next, 'Next: your stats');
  await click(next, 'Begin your journey');
  await skipIntro(next);
  const now = await settled(next);
  say(`in the world: ${now.zone} · ${now.calls} calls · ${now.tris} tris · ${now.chunks}`);
  return { page: next, sample: now };
}

/** Simulation seconds so far (the debug overlay's `sim` line), NaN before the game runs. */
async function simSeconds(page) {
  const lines = await overlay(page);
  return Number(/, ([\d.]+) s/.exec(lines.get('sim') ?? '')?.[1] ?? NaN);
}

/**
 * The intro is a film (step C.4a): holding Escape for a game second skips it. Without a graphics
 * card a frame can take a while, so the hold is measured on the game's own clock, as in
 * intro-check.mjs.
 */
async function skipIntro(page) {
  await page.locator('.ui-cine').first().waitFor({ state: 'attached', timeout: 120_000 });
  let startSim = NaN;
  while (!Number.isFinite(startSim)) {
    startSim = await simSeconds(page);
    if (!Number.isFinite(startSim)) await page.waitForTimeout(250);
  }
  await page.keyboard.down('Escape');
  const holdStart = Date.now();
  while (Date.now() - holdStart < 15_000) {
    const now = await simSeconds(page);
    const gone = (await page.locator('.ui-cine').count()) === 0;
    if (gone || now - startSim >= 1.5) break;
    await page.waitForTimeout(100);
  }
  await page.keyboard.up('Escape');
  await page
    .waitForFunction(() => !document.querySelector('.ui-cine'), null, { timeout: 30_000 })
    .catch(() => say('warning: the intro film did not go away after holding Escape'));
}

async function cheatPanel(page, chips) {
  const panel = page.locator('.ui-panel.ui-cheats');
  for (const chip of chips) {
    if (!(await panel.isVisible())) {
      await page.keyboard.press('F6');
      await panel.waitFor({ state: 'visible', timeout: 15_000 });
    }
    await panel.getByRole('button', { name: chip, exact: true }).first().click();
  }
  if (await panel.isVisible()) await page.keyboard.press('F6');
}

/** Walks to (x, z) with the keys, like a player (same approach as mem-check.mjs). */
async function walkTo(page, target, { tolerance = 5, seconds = 90 } = {}) {
  const start = await sample(page);
  let yaw = start.heading;
  const deadline = Date.now() + seconds * 1000;
  let best = Math.hypot(target.x - start.x, target.z - start.z);
  let stalled = 0;
  let lowest = start.y;
  while (Date.now() < deadline) {
    const before = await sample(page);
    const dx = target.x - before.x;
    const dz = target.z - before.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= tolerance) return { reached: true, distance, lowest };
    let keys = ['KeyW'];
    let intent = { forward: 1, right: 0 };
    if (Number.isFinite(yaw)) {
      const forward = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / distance;
      const right = (-dx * Math.cos(yaw) + dz * Math.sin(yaw)) / distance;
      keys = [];
      intent = { forward: 0, right: 0 };
      if (forward > 0.38) {
        keys.push('KeyW');
        intent.forward = 1;
      } else if (forward < -0.38) {
        keys.push('KeyS');
        intent.forward = -1;
      }
      if (right > 0.38) {
        keys.push('KeyD');
        intent.right = 1;
      } else if (right < -0.38) {
        keys.push('KeyA');
        intent.right = -1;
      }
      if (keys.length === 0) {
        keys = ['KeyW'];
        intent.forward = 1;
      }
    }
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(pressMs(before.frameMs));
    for (const key of keys) await page.keyboard.up(key);
    const after = await sample(page);
    if (Number.isFinite(after.y)) lowest = Math.min(lowest, after.y);
    const movedX = after.x - before.x;
    const movedZ = after.z - before.z;
    const moved = Math.hypot(movedX, movedZ);
    if (moved > 0.3) {
      const worldAngle = Math.atan2(movedX, movedZ);
      const localAngle = Math.atan2(-intent.right, intent.forward);
      const measured = worldAngle - localAngle;
      const turn = Math.atan2(Math.sin(measured - yaw), Math.cos(measured - yaw));
      if (!Number.isFinite(yaw) || Math.abs(turn) < Math.PI / 4) yaw = measured;
    }
    const left = Math.hypot(target.x - after.x, target.z - after.z);
    if (left < best - 0.3) {
      best = left;
      stalled = 0;
    } else stalled++;
    if (stalled >= 6) {
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(500);
      await page.keyboard.up('KeyD');
      stalled = 0;
      yaw = NaN;
    }
  }
  const now = await sample(page);
  return { reached: false, distance: Math.hypot(target.x - now.x, target.z - now.z), lowest };
}

// ------------------------------------------------------------------------------------ run

const playwright = await loadPlaywright();
const server = options.url ? { url: options.url, stop: () => {} } : await startServer();
const browser = await playwright.chromium.launch({
  headless: !options.headed,
  // A Chromium installed next to node (CI images, sandboxes) instead of Playwright's own.
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: VIEWPORT });
const gameUrl = `${server.url}${server.url.includes('?') ? '&' : '?'}debug=1`;
say(`game: ${gameUrl} · quality ${options.quality}`);
await mkdir(options.out, { recursive: true });
/**
 * A screenshot without the debug overlay in front of the world: F3 cycles the overlay's size
 * (large → normal → small → mini → hidden), so it is pressed until the overlay is gone and
 * afterwards until the large view (the one `sample` reads) is back.
 */
async function shot(page, name) {
  const overlayBox = page.locator('.debug-overlay');
  for (let i = 0; i < 6 && (await overlayBox.isVisible()); i++) await page.keyboard.press('F3');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(options.out, `${options.quality}-${name}.png`) });
  for (let i = 0; i < 6; i++) {
    const lines = await overlay(page);
    if (lines.has('calls') && lines.has('chunks')) break;
    await page.keyboard.press('F3');
    await page.waitForTimeout(300);
  }
}

let page = await context.newPage();
watchForProblems(page);
await page.goto(gameUrl, { waitUntil: 'domcontentloaded' });
const created = await createCharacter(page);
page = created.page;
const greyhaven = created.sample;
const results = { options, greyhaven, stops: [], problems };
let failed = false;

// Teleport to Morvath: the first spawn point of the zone is the western pass.
await cheatPanel(page, ['Morvath']);
let now = await settled(page);
// Hide the debug overlay for the screenshots (F3 cycles its size; the smallest is hidden).
say(
  `in Morvath: ${now.zoneLine} · ${now.calls} calls · ${now.tris} tris · ${now.chunks} · ${now.daynight}`,
);
if (now.zone !== 'morvath') {
  failed = true;
  say(`PROBLEM: expected to stand in Morvath, not "${now.zone}"`);
}
await page.waitForTimeout(3500); // let the fixed look and fog settle
await shot(page, '0-pass-arrival');
await cheatPanel(page, [options.speed]);

for (const [i, stop] of ROUTE.entries()) {
  const walked = await walkTo(page, stop, { seconds: 150 });
  await page.waitForTimeout(1500);
  now = await sample(page);
  const save = await readSave(page);
  const visited = save?.visitedPlaces ?? [];
  const placeOk = !stop.place || visited.includes(stop.place);
  const zoneOk = !stop.zone || now.zone === stop.zone;
  const ok = walked.reached && placeOk && zoneOk;
  if (!ok) failed = true;
  results.stops.push({
    ...stop,
    reached: walked.reached,
    distance: walked.distance,
    lowestY: walked.lowest,
    placeOk,
    zoneOk,
    calls: now.calls,
    tris: now.tris,
    chunks: now.chunks,
    x: now.x,
    y: now.y,
    z: now.z,
  });
  say(
    `${ok ? 'ok  ' : 'FAIL'} ${stop.name.padEnd(13)} at ${now.x.toFixed(0)}, ${now.y.toFixed(1)}, ${now.z.toFixed(0)}` +
      ` · ${now.calls} calls · ${now.tris} tris · ${now.chunks}` +
      (stop.place ? ` · place ${stop.place} ${placeOk ? 'found' : 'MISSING'}` : '') +
      (walked.reached ? '' : ` · NOT REACHED (${walked.distance.toFixed(1)} m left)`),
  );
  await shot(page, `${i + 1}-${stop.name}`);
}

if (problems.length > 0) {
  failed = true;
  say(`${problems.length} console problem(s): see above`);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(
  path.join(options.out, `morvath-check-${options.quality}-${stamp}.json`),
  JSON.stringify(results, null, 2),
);
await writeFile(
  path.join(options.out, `morvath-check-${options.quality}-${stamp}.log`),
  `${log.join('\n')}\n`,
);
say(`${failed ? 'FAILED' : 'passed'} · written to ${options.out}`);
await browser.close();
server.stop();
process.exit(failed ? 1 : 0);
