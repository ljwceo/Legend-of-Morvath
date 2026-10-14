#!/usr/bin/env node
/**
 * Memory endurance check (step 3.10.3): does the game give its GPU memory back?
 *
 * It drives the real game in a headless browser, reads `geo/tex` and `heap` from the debug
 * overlay and reports whether those numbers come back to where they started:
 *
 *   1. walking test  — walks up and down the open world for `--minutes` minutes and teleports
 *                      between Greyhaven, the Greenwood and the Mournfen every minute, while
 *                      chunks keep loading and unloading;
 *   2. instance test — walks into an instance (Master Brink's Tower, Wizard Sam's Cellar) and
 *                      out again `--cycles` times, comparing the numbers before and after.
 *
 * Playwright is not a dependency of the game, so install it when you want to run this:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   node scripts/mem-check.mjs                 # the whole check (~15 minutes)
 *   node scripts/mem-check.mjs --minutes 2     # a shorter walking test
 *   node scripts/mem-check.mjs --only instances
 *   node scripts/mem-check.mjs --only instances --instance sam_cellar --verbose
 *
 * Headless Chromium draws without a graphics card, so its fps means nothing; the number of
 * geometries, textures and the JavaScript heap are the same as on a real machine.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const SAVE_KEY = 'legend-of-morvath.save';
/**
 * How long one key press lasts while walking (ms). A key that goes down and up between two
 * frames is never seen, and this browser draws without a graphics card (about 1 fps in
 * Greyhaven), so a press has to cover several frames.
 */
const STEP_MS = { min: 600, max: 3000, frames: 5 };
/** The debug overlay only shows `geo/tex` on a screen taller than this (DebugOverlay). */
const VIEWPORT = { width: 1024, height: 640 };
/** Camera sensitivity of a fresh save (SaveData.DEFAULT_CAMERA_SENSITIVITY). */
const DEFAULT_SENSITIVITY = 0.7;
/** A sample is "the same as before" within this many geometries / textures. */
const TOLERANCE = 0;

const options = parseArgs(process.argv.slice(2));

/** Places the walking test visits: a zone and two points to walk between. */
const WALK_ROUTE = [
  // Both points stay well inside the zone (Greyhaven starts at x = -1500, and walking in
  // would load the whole city) and out of the deep water that stops the player.
  {
    zone: 'The Greenwood of Aerandir',
    from: { x: -1440, z: -90 },
    to: { x: -1150, z: -330 },
  },
  { zone: 'The Mournfen', from: { x: -1440, z: 90 }, to: { x: -1200, z: 260 } },
  {
    zone: 'The Greenwood of Aerandir',
    from: { x: -1420, z: -250 },
    to: { x: -1150, z: -90 },
  },
  // Greyhaven is a Blender scene instead of chunks: going in and out is what has to give its
  // memory back there, so this leg only visits (walking it costs minutes without a graphics card).
  { zone: 'Greyhaven', visitOnly: true },
];

/**
 * The instances the test walks in and out of, with the spots from zones.json: where the game
 * puts you when you come out (`outside`, the instance's `exit.to`, looking the same way), the
 * door that takes you in (`door`) and the way out on the inside (`exit`). The first sample is
 * taken there, looking that way, so it compares with the samples after every time out: the
 * renderer counts a geometry or texture from the first frame it is drawn in, so what is in
 * view decides the numbers.
 */
const INSTANCES = [
  {
    id: 'brink_tower',
    outside: { x: -1692.13, y: 22.5, z: -104.63, headingDegrees: 45 },
    door: { x: -1694.25, z: -106.75 },
    exit: { x: -1693.12, z: -105.62 },
  },
  {
    id: 'sam_cellar',
    outside: { x: -1647.7, y: 23, z: -62.8, headingDegrees: 180 },
    door: { x: -1647.7, z: -58 },
    exit: { x: -1647.7, z: -60.1 },
  },
];

function parseArgs(argv) {
  const out = {
    url: '',
    minutes: 10,
    cycles: 5,
    quality: 'low',
    only: 'all',
    instance: '',
    out: path.join('.', 'mem-check'),
    headed: false,
    verbose: false,
  };
  const numbers = new Set(['--minutes', '--cycles']);
  const names = {
    '--url': 'url',
    '--minutes': 'minutes',
    '--cycles': 'cycles',
    '--quality': 'quality',
    '--only': 'only',
    '--instance': 'instance',
    '--out': 'out',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--headed') {
      out.headed = true;
    } else if (arg === '--verbose') {
      out.verbose = true;
    } else if (names[arg]) {
      const value = argv[i + 1];
      out[names[arg]] = numbers.has(arg) ? Number(value) : value;
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
      // A CommonJS package shows up as its `default` export.
      return module.default ?? module;
    } catch {
      console.error(
        'Playwright is missing. Install it first:\n  npm i -D playwright && npx playwright install chromium',
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
    const child = spawn(process.execPath, [vite, '--port', '5179', '--strictPort'], {
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
  const text = typeof line === 'string' ? line : JSON.stringify(line);
  console.log(text);
  log.push(text);
}

/** The debug overlay as a map: "geo/tex" -> "63 / 2", "pos" -> "…". */
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

/** One measurement: geometries, textures, heap, where the player is. */
async function sample(page) {
  const lines = await overlay(page);
  const [geo, tex] = (lines.get('geo/tex') ?? '').split('/').map((part) => Number(part.trim()));
  const heap = Number((lines.get('heap') ?? '').replace(' MB', ''));
  const pos = (lines.get('pos') ?? '').split('·')[0]?.split(',').map(Number) ?? [];
  const frameMs = Number(/^([\d.]+) ms/.exec(lines.get('frame') ?? '')?.[1]);
  return {
    geo: Number.isFinite(geo) ? geo : -1,
    tex: Number.isFinite(tex) ? tex : -1,
    heapMb: Number.isFinite(heap) ? heap : -1,
    fps: Number(lines.get('fps') ?? -1),
    frameMs: Number.isFinite(frameMs) ? frameMs : -1,
    x: pos[0] ?? NaN,
    z: pos[2] ?? NaN,
    zone: (lines.get('zone') ?? '').split('·')[0]?.trim() ?? '',
    state: lines.get('state') ?? '',
    chunks: lines.get('chunks') ?? '',
    // The chunks line ends with the graphics preset in use ("… · low").
    preset: (lines.get('chunks') ?? '').split('·').at(-1)?.trim() ?? '',
    // Simulation steps so far: they stand still while a zone loads, so they tell a quiet
    // game apart from a frozen one.
    steps: Number(/^(\d+) steps/.exec(lines.get('sim') ?? '')?.[1] ?? -1),
    // The way the character faces, in radians. Right after arriving somewhere the camera
    // stands behind him, so this is also where W walks.
    heading: (Number(/heading (-?\d+)/.exec(lines.get('pos') ?? '')?.[1] ?? NaN) * Math.PI) / 180,
    // Where the camera looks (radians): W walks that way.
    yaw: (Number(/yaw (-?\d+)/.exec(lines.get('camera') ?? '')?.[1] ?? NaN) * Math.PI) / 180,
  };
}

/**
 * Waits until geometries and textures stop changing: the world (or the instance) is loaded and
 * everything that had to go has gone.
 */
async function settled(page, { seconds = 90, quiet = 3, inWorld = true } = {}) {
  const deadline = Date.now() + seconds * 1000;
  let last = null;
  let same = 0;
  let latest = null;
  while (Date.now() < deadline) {
    const now = await sample(page);
    latest = now;
    // A Blender-built zone shows a loading screen; the numbers stand still while it is up.
    const loading = (await page.locator('.ui-zone-loading').count()) > 0;
    const ready =
      !loading &&
      now.geo > 0 &&
      (!inWorld || (now.state === 'world' && Number.isFinite(now.x) && now.chunks !== ''));
    // Numbers that stand still while nothing is drawn (a zone being built, a teleport) are the
    // old numbers, not settled ones: only samples with new simulation steps count. Without a
    // graphics card a frame can take a second, so a sample without them says nothing either way.
    if (last !== null && now.steps > last.steps) {
      if (now.geo === last.geo && now.tex === last.tex && now.state === last.state) same++;
      else same = 0;
      last = now;
      if (same >= quiet && ready) return now;
    } else if (last === null) {
      last = now;
    }
    await page.waitForTimeout(500);
  }
  say(`warning: nothing settled after ${seconds} s (state ${latest?.state})`);
  return latest;
}

const click = (page, name) => page.getByRole('button', { name, exact: true }).first().click();

/** How long to hold a key, so that a slow browser sees it for a few frames. */
function pressMs(frameMs) {
  const wanted = (frameMs > 0 ? frameMs : 16) * STEP_MS.frames;
  return Math.round(Math.min(STEP_MS.max, Math.max(STEP_MS.min, wanted)));
}

/**
 * Patches the save and opens the game again with it. The game saves by itself when the page
 * goes away (AutoSave on `pagehide`), which would write the old world right back over the
 * patch, so the page is closed first and the patch runs in the new page before the game starts.
 * Returns the new page; the old one is gone.
 */
async function reopenWith(page, fields) {
  await page.close();
  const next = await page.context().newPage();
  watchForProblems(next);
  if (fields) {
    await next.addInitScript(
      ([key, patch]) => {
        const save = JSON.parse(window.localStorage.getItem(key) ?? 'null');
        if (!save) return;
        for (const [group, values] of Object.entries(patch)) {
          if (Array.isArray(values)) {
            save[group] = [...new Set([...(save[group] ?? []), ...values])];
          } else if (values && typeof values === 'object') {
            save[group] = { ...save[group], ...values };
          } else {
            save[group] = values;
          }
        }
        window.localStorage.setItem(key, JSON.stringify(save));
      },
      [SAVE_KEY, fields],
    );
  }
  await next.goto(gameUrl, { waitUntil: 'domcontentloaded' });
  return next;
}

const readSave = (page, key = SAVE_KEY) =>
  page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? 'null'), key);

/** Which instance the save says we are in, null in the open world. */
const currentInstance = async (page) => (await readSave(page))?.world.instance ?? null;

/**
 * Language choice, the graphics preset, New Game, a character and skipping the intro: in the
 * world once, on the preset the run asks for (never the benchmark's choice).
 */
async function createCharacter(page) {
  await click(page, 'English');
  // The language choice makes the save; the preset goes in before the world is ever built.
  const next = await reopenWith(page, {
    settings: { debug: true, quality: options.quality, autoQuality: options.quality },
  });
  await click(next, 'New Game');
  await next.locator('input[type="text"]').first().fill('Memcheck');
  await click(next, 'Next: your stats');
  await click(next, 'Begin your journey');
  await click(next, 'Skip');
  const now = await settled(next);
  say(
    `in the world: ${now.zone} · geo/tex ${now.geo}/${now.tex} · heap ${now.heapMb} MB · ` +
      `${now.fps} fps · ${now.preset}`,
  );
  return { page: next, sample: now };
}

/** Opens the game again with a patched save and presses Continue: back in the world. */
async function continueGame(page, fields) {
  const next = await reopenWith(page, fields);
  await next
    .getByRole('button', { name: 'Continue', exact: true })
    .first()
    .click({ timeout: 60_000 });
  return { page: next, sample: await settled(next) };
}

/**
 * Clicks chips in the cheat menu (F6), one at a time: a teleport rebuilds the world and closes
 * the menu, so it is opened again for every chip.
 */
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

/**
 * Walks to (x, z) with the keys, like a player. The camera decides which way W walks, so the
 * direction of every key press is measured and corrected: that keeps working when the camera
 * turns along while walking sideways.
 */
async function walkTo(page, target, { tolerance = 1.2, seconds = 60, until = null } = {}) {
  const start = await sample(page);
  // Right after arriving the camera stands behind the character, so his heading is where W
  // walks; every press after this measures the camera again.
  let yaw = start.heading;
  const deadline = Date.now() + seconds * 1000;
  let best = Math.hypot(target.x - start.x, target.z - start.z);
  let stalled = 0;
  while (Date.now() < deadline) {
    if (until && (await until())) return { reached: true, distance: 0 };
    const before = await sample(page);
    const dx = target.x - before.x;
    const dz = target.z - before.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= tolerance) return { reached: true, distance };
    // Which keys walk that way? Without a measured camera yaw, try straight ahead first.
    let keys = ['KeyW'];
    let intent = { forward: 1, right: 0 };
    if (Number.isFinite(yaw)) {
      // Forward is (sin yaw, cos yaw) and right of it is (-cos yaw, sin yaw), the same as
      // `moveDirection` in src/systems/Movement.ts.
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
    const movedX = after.x - before.x;
    const movedZ = after.z - before.z;
    const moved = Math.hypot(movedX, movedZ);
    if (moved > 0.3) {
      // The keys asked for this direction in camera space; the player moved that way in the
      // world, so the difference between the two angles is where the camera looks. A wall
      // pushes the player sideways, which would say the camera turned right round, so a jump
      // of more than a quarter turn is a wall and not the camera: keep what we had and keep
      // pushing. (Only walking sideways turns the camera, and only a little.)
      const worldAngle = Math.atan2(movedX, movedZ);
      const localAngle = Math.atan2(-intent.right, intent.forward);
      const measured = worldAngle - localAngle;
      const turn = Math.atan2(Math.sin(measured - yaw), Math.cos(measured - yaw));
      if (!Number.isFinite(yaw) || Math.abs(turn) < Math.PI / 4) yaw = measured;
    }
    const left = Math.hypot(target.x - after.x, target.z - after.z);
    if (options.verbose) {
      say(
        `    walk → ${target.x},${target.z}: ${keys.join('+').padEnd(9)} ` +
          `${before.x.toFixed(1)},${before.z.toFixed(1)} → ${after.x.toFixed(1)},${after.z.toFixed(1)}` +
          ` (${moved.toFixed(1)} m, ${left.toFixed(1)} m left, yaw ${Math.round((yaw * 180) / Math.PI)}°)`,
      );
    }
    if (left < best - 0.3) {
      best = left;
      stalled = 0;
    } else {
      stalled++;
    }
    // Stuck against a wall or a fence: try sideways for a moment.
    if (stalled >= 6) {
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(500);
      await page.keyboard.up('KeyD');
      stalled = 0;
      yaw = NaN;
    }
  }
  const now = await sample(page);
  return { reached: false, distance: Math.hypot(target.x - now.x, target.z - now.z) };
}

/** The shortest way round from `from` to `to`, in radians (-π … π). */
const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * How far one pixel of mouse movement turns the camera (radians, signed), learned while
 * playing. The game says `rotateRadiansPerPixelMouse` (player.json) times the camera
 * sensitivity of the save, but what a browser really delivers differs (pointer lock or not,
 * coalesced moves, the direction), so every turn is measured and the estimate corrected.
 */
let radiansPerPixel = 0.005 * DEFAULT_SENSITIVITY;
/** The first turn is this small, so that whatever the real rate is, it stays well under a half turn. */
const CALIBRATION_PX = 100;
/** A turn is asked for in pieces of at most this much (expected), so a wrong estimate never wraps. */
const MAX_TURN = (2 * Math.PI) / 3;
let calibrated = false;

/**
 * A spot on the canvas where a drag reaches the game: the debug overlay sits in the middle of
 * the screen and swallows the mouse, so the drag starts to the right of it (the surface keeps
 * the pointer once it has it, wherever the mouse goes after that).
 */
async function dragSpot(page) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) return null;
  const candidates = [
    [0.75, 0.7],
    [0.8, 0.5],
    [0.5, 0.85],
    [0.5, 0.5],
  ];
  for (const [fx, fy] of candidates) {
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    const covered = await page.evaluate(
      ([px, py]) => document.elementFromPoint(px, py)?.closest('.debug-overlay') !== null,
      [x, y],
    );
    if (!covered) return { x, y };
  }
  return { x: box.x + box.width * 0.75, y: box.y + box.height * 0.7 };
}

/**
 * Turns the camera like a mouse: a drag with the right button (a left click would capture the
 * mouse, and that capture does not survive the next door, after which the game ignores plain
 * moves). In strokes that stay inside the window, since a move outside it is lost. Returns the
 * pixels dragged.
 */
async function dragLook(page, radians) {
  const spot = await dragSpot(page);
  if (!spot) return 0;
  const total = Math.round(radians / radiansPerPixel);
  let left = total;
  while (left !== 0) {
    const stroke = Math.max(-200, Math.min(200, left));
    left -= stroke;
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(spot.x + stroke, spot.y, { steps: 4 });
    await page.mouse.up({ button: 'right' });
  }
  return total;
}

/** The debug overlay refreshes this often (DEBUG_REFRESH_MS in WorldState). */
const OVERLAY_MS = 250;

/**
 * Turns the camera until it looks towards `want` (radians), reading its yaw back from the
 * debug overlay after every drag: the first drag is small and calibrates how far a pixel
 * turns in this browser, every drag after that corrects the estimate. Returns the error left.
 */
async function aimCamera(page, want, frameMs) {
  let error = NaN;
  for (let attempt = 0; attempt < 8; attempt++) {
    const yaw = (await sample(page)).yaw;
    if (!Number.isFinite(yaw)) return NaN;
    error = angleTo(yaw, want);
    if (Math.abs(error) < 0.12) return error;
    let px;
    if (calibrated) {
      px = await dragLook(page, Math.max(-MAX_TURN, Math.min(MAX_TURN, error)));
    } else {
      px = Math.sign(error) * CALIBRATION_PX;
      await dragLook(page, px * radiansPerPixel);
    }
    // The camera turns on the next frame, and the overlay shows it a moment later.
    await page.waitForTimeout(Math.max(frameMs > 0 ? frameMs * 2 : 100, OVERLAY_MS + 100));
    const turned = angleTo(yaw, (await sample(page)).yaw);
    if (px !== 0 && Math.abs(turned) > 0.02) {
      const rate = turned / px;
      if (Math.abs(rate) > 0.0005 && Math.abs(rate) < 0.05) {
        radiansPerPixel = rate;
        calibrated = true;
      }
    }
    if (options.verbose) {
      say(
        `    aim: yaw ${Math.round((yaw * 180) / Math.PI)}° → want ${Math.round((want * 180) / Math.PI)}°, ` +
          `dragged ${px} px, turned ${Math.round((turned * 180) / Math.PI)}°, rate ${radiansPerPixel.toFixed(4)}`,
      );
    }
  }
  return error;
}

/**
 * Walks through a door the way a player does: turn the camera towards it (reading the camera
 * back from the debug overlay), then walk forward. Walking forward leaves the camera where it
 * is, while walking backwards slowly swings it round (`strafeFollowDegreesPerSecond`) until
 * "back" is a curve — which is why this always aims first.
 */
async function walkThroughDoor(page, { target, expect, seconds = 120 }) {
  const reached = async () => (await currentInstance(page)) === expect;
  const deadline = Date.now() + seconds * 1000;
  let stuck = 0;
  while (Date.now() < deadline) {
    if (await reached()) return true;
    const before = await sample(page);
    const want = Math.atan2(target.x - before.x, target.z - before.z);
    const error = await aimCamera(page, want, before.frameMs);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(pressMs(before.frameMs));
    await page.keyboard.up('KeyW');
    const after = await sample(page);
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    if (options.verbose) {
      say(
        `    door → ${target.x},${target.z}: ` +
          `${before.x.toFixed(1)},${before.z.toFixed(1)} → ${after.x.toFixed(1)},${after.z.toFixed(1)}` +
          ` (${moved.toFixed(1)} m, aim off ${Math.round((error * 180) / Math.PI)}°)`,
      );
    }
    // Wedged against the door frame: a step sideways, then straight on again.
    if (Number.isFinite(moved) && moved < 0.1) stuck++;
    else stuck = 0;
    if (stuck >= 3) {
      await page.keyboard.down('KeyA');
      await page.waitForTimeout(pressMs(before.frameMs));
      await page.keyboard.up('KeyA');
      stuck = 0;
    }
  }
  return reached();
}

async function walkingTest(page, minutes) {
  say(`\n== walking test (${minutes} min, quality ${options.quality}) ==`);
  const samples = [];
  const start = Date.now();
  const end = start + minutes * 60_000;
  let leg = 0;
  while (Date.now() < end) {
    const route = WALK_ROUTE[leg % WALK_ROUTE.length];
    leg++;
    await cheatPanel(page, [route.zone]);
    const arrived = await settled(page);
    // The walking speed is set on the player, and a teleport builds a new one: ask for the
    // cheat after arriving, never before.
    if (!route.visitOnly) await cheatPanel(page, ['25×']);
    samples.push({
      at: Math.round((Date.now() - start) / 1000),
      ...arrived,
      what: `in ${route.zone}`,
    });
    say(
      `${String(samples.at(-1).at).padStart(4)} s  ${route.zone.slice(0, 16).padEnd(17)}` +
        `geo ${arrived.geo} · tex ${arrived.tex} · heap ${arrived.heapMb} MB · ${arrived.fps} fps`,
    );
    if (route.visitOnly) continue;
    // Up and down between two points while the minute lasts: chunks load and unload.
    const legEnd = Math.min(end, Date.now() + 60_000);
    let there = true;
    while (Date.now() < legEnd) {
      const goal = there ? route.to : route.from;
      there = !there;
      const walked = await walkTo(page, goal, {
        // At 25× speed one key press covers tens of metres, so "there" is a wide circle:
        // this leg is about loading and unloading chunks, not about standing on a spot.
        tolerance: 40,
        seconds: Math.max(5, (legEnd - Date.now()) / 1000),
      });
      const now = await sample(page);
      samples.push({
        at: Math.round((Date.now() - start) / 1000),
        ...now,
        what: `walked to ${goal.x},${goal.z}${walked.reached ? '' : ' (not reached)'}`,
      });
      say(
        `${String(samples.at(-1).at).padStart(4)} s  walk ${now.x.toFixed(0)},${now.z.toFixed(0)}`.padEnd(
          23,
        ) + `geo ${now.geo} · tex ${now.tex} · heap ${now.heapMb} MB · ${now.fps} fps`,
      );
    }
  }
  return samples;
}

async function instanceTest(startPage, cycles) {
  say(`\n== instance test (${cycles}× in and out) ==`);
  const results = [];
  let page = startPage;
  // Opening the game again forgets the cheats, so the player walks the last few metres to the
  // door at normal speed and never overshoots it.
  const chosen = INSTANCES.filter((entry) => !options.instance || entry.id === options.instance);
  for (const instance of chosen) {
    // Put the player just outside the door, with the cutscene marked as seen so that the first
    // time in does not stop for Master Brink's explanation.
    const spot = instance.outside;
    const opened = await continueGame(page, {
      world: {
        zone: 'greyhaven',
        instance: null,
        position: { x: spot.x, y: spot.y, z: spot.z },
        heading: (spot.headingDegrees * Math.PI) / 180,
      },
      seenCutscenes: [instance.id],
    });
    page = opened.page;
    const outside = opened.sample;
    say(
      `${instance.id}: outside the door · geo ${outside.geo} · tex ${outside.tex} · ` +
        `heap ${outside.heapMb} MB · ${outside.zone} ${outside.preset}`,
    );
    const baseline = { geo: outside.geo, tex: outside.tex };
    for (let i = 1; i <= cycles; i++) {
      const wentIn = await walkThroughDoor(page, { target: instance.door, expect: instance.id });
      const inside = await settled(page);
      const wentOut = wentIn
        ? await walkThroughDoor(page, { target: instance.exit, expect: null })
        : false;
      const back = await settled(page);
      results.push({
        instance: instance.id,
        cycle: i,
        wentIn,
        wentOut,
        inside: { geo: inside.geo, tex: inside.tex, heapMb: inside.heapMb },
        after: { geo: back.geo, tex: back.tex, heapMb: back.heapMb },
        baseline,
      });
      say(
        `  ${instance.id} ${i}/${cycles}: in geo ${inside.geo}/tex ${inside.tex}` +
          ` → out geo ${back.geo}/tex ${back.tex} (start ${baseline.geo}/${baseline.tex})` +
          ` · heap ${back.heapMb} MB` +
          (wentIn && wentOut ? '' : ` · PROBLEM: in=${wentIn} out=${wentOut}`),
      );
    }
  }
  return { results, page };
}

const playwright = await loadPlaywright();
const server = options.url ? { url: options.url, stop: () => {} } : await startServer();
const browser = await playwright.chromium.launch({
  headless: !options.headed,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: VIEWPORT });
const gameUrl = `${server.url}${server.url.includes('?') ? '&' : '?'}debug=1`;
say(`game: ${gameUrl}`);

let page = await context.newPage();
watchForProblems(page);
await page.goto(gameUrl, { waitUntil: 'domcontentloaded' });
const created = await createCharacter(page);
page = created.page;
const first = created.sample;
say(`start values: geo ${first.geo} · tex ${first.tex} · heap ${first.heapMb} MB (${first.zone})`);

const walk = options.only === 'instances' ? [] : await walkingTest(page, options.minutes);
const instanceRun =
  options.only === 'walk' ? { results: [] } : await instanceTest(page, options.cycles);
const instances = instanceRun.results;

say('\n== result ==');
if (walk.length > 0) {
  const geo = walk.map((s) => s.geo);
  const tex = walk.map((s) => s.tex);
  const heap = walk.map((s) => s.heapMb);
  say(
    `walking test: geometries ${Math.min(...geo)}–${Math.max(...geo)}, textures ${Math.min(...tex)}–${Math.max(...tex)}, heap ${Math.min(...heap).toFixed(1)}–${Math.max(...heap).toFixed(1)} MB over ${walk.length} samples`,
  );
  // Growth that never comes down again is the thing to catch: compare the last third's
  // lowest values with the first third's lowest values per zone.
  const perZone = new Map();
  for (const s of walk) {
    const list = perZone.get(s.zone) ?? [];
    list.push(s);
    perZone.set(s.zone, list);
  }
  for (const [zone, list] of perZone) {
    const geos = list.map((s) => s.geo);
    say(
      `  ${zone.padEnd(12)} ${list.length} samples · geometries ${Math.min(...geos)}–${Math.max(...geos)} · first ${geos[0]} last ${geos.at(-1)}`,
    );
  }
}
let failed = problems.length > 0;
for (const r of instances) {
  const ok =
    r.wentIn &&
    r.wentOut &&
    Math.abs(r.after.geo - r.baseline.geo) <= TOLERANCE &&
    Math.abs(r.after.tex - r.baseline.tex) <= TOLERANCE;
  if (!ok) failed = true;
  say(
    `${ok ? 'ok  ' : 'FAIL'} ${r.instance} ${r.cycle}: back to geo ${r.after.geo}/tex ${r.after.tex}, started at ${r.baseline.geo}/${r.baseline.tex}`,
  );
}
if (problems.length > 0) say(`${problems.length} console problem(s): see above`);

await mkdir(options.out, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(
  path.join(options.out, `mem-check-${stamp}.json`),
  JSON.stringify({ options, walk, instances, problems }, null, 2),
);
await writeFile(path.join(options.out, `mem-check-${stamp}.log`), `${log.join('\n')}\n`);
say(`written to ${options.out}`);

await browser.close();
server.stop();
process.exit(failed ? 1 : 0);
