#!/usr/bin/env node
/**
 * Lock-on check (step S.10): does a press on the lock button pick an enemy in view, and
 * not one behind you?
 *
 * It drives the real game in a headless browser (fresh profile, Skip the intro) and reads the
 * debug line `lock`:
 *   1. slimes: the save is patched to stand near the slime trail in the Greenwood; the check
 *      waits for "in range" to be above 0, presses Tab and expects a slime as target. Then it
 *      lets go, turns the camera half a circle with the right mouse button and presses Tab:
 *      the slime is behind you now, so there must be no target;
 *   2. Sultan: the cheat menu (F6) starts the boss fight; Tab must pick `sultan`, also while
 *      he is guarded (that was the bug: a guarded boss was "not hittable", so never a target).
 *
 *   npm i --no-save playwright
 *   node scripts/lock-check.mjs [--url <game url>] [--headed]
 *
 * Headless Chromium draws without a graphics card, so a frame can take a second: key presses
 * are held long enough to be seen.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const SAVE_KEY = 'legend-of-morvath.save';
const VIEWPORT = { width: 1024, height: 640 };
const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const headed = args.includes('--headed');
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : '';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const require = createRequire(import.meta.url);
    const m = await import(
      require.resolve('playwright', { paths: ['/opt/node-tools/node_modules'] })
    );
    return m.default ?? m;
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

const say = (t) => console.log(t);
const problems = [];
const watch = (page) => {
  page.on('pageerror', (e) => problems.push(e.message));
};
const click = (page, name) =>
  page.getByRole('button', { name, exact: true }).first().click({ timeout: 120_000 });

async function lines(page) {
  const text = await page.evaluate(
    () => document.querySelector('.debug-overlay')?.textContent ?? '',
  );
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = /^(\S+)\s+(.*)$/.exec(line);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}
const lockLine = async (page) => (await lines(page)).get('lock') ?? '';

async function tap(page, key, ms = 700) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(500);
}

async function reopenWith(page, patch) {
  await page.close();
  const next = await page.context().newPage();
  watch(next);
  await next.addInitScript(
    ([key, p]) => {
      const save = JSON.parse(window.localStorage.getItem(key) ?? 'null');
      if (!save) return;
      for (const [group, values] of Object.entries(p)) {
        save[group] =
          values && typeof values === 'object' && !Array.isArray(values)
            ? { ...save[group], ...values }
            : values;
      }
      window.localStorage.setItem(key, JSON.stringify(save));
    },
    [SAVE_KEY, patch],
  );
  await next.goto(gameUrl, { waitUntil: 'domcontentloaded' });
  return next;
}

async function waitFor(page, test, seconds = 90) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const l = await lines(page);
    if (test(l)) return l;
    await page.waitForTimeout(500);
  }
  return null;
}

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  say(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
};

const { chromium } = await loadPlaywright();
const server = urlArg ? null : await startServer();
const gameUrl = `${urlArg || server.url}${(urlArg || server.url).includes('?') ? '&' : '?'}debug=1`;
const browser = await chromium.launch({
  headless: !headed,
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: VIEWPORT });
let page = await context.newPage();
watch(page);
await page.goto(gameUrl, { waitUntil: 'domcontentloaded' });
await click(page, 'English');
page = await reopenWith(page, { settings: { debug: true, quality: 'low', autoQuality: 'low' } });
await click(page, 'New Game');
await page.locator('input[type="text"]').first().fill('Locker');
await click(page, 'Next: your stats');
await click(page, 'Begin your journey');
await page.locator('.ui-cine').first().waitFor({ state: 'attached', timeout: 180_000 });
await page.waitForTimeout(3000);
// Hold Escape in the first film: the world follows at once.
await page.keyboard.down('Escape');
await waitFor(page, (l) => !/introScene/.test(l.get('state') ?? ''), 30);
await page.keyboard.up('Escape');
await waitFor(page, (l) => /world/.test(l.get('state') ?? '') && (l.get('chunks') ?? '') !== '');
say('in the world');

// 1. Sultan (in Greyhaven, where the boss lives).
await page.keyboard.press('F6');
const panel = page.locator('.ui-panel.ui-cheats');
await panel.waitFor({ state: 'visible', timeout: 15_000 });
await panel
  .getByRole('button', { name: 'Fight Sultan', exact: true })
  .first()
  .click({ timeout: 120_000 });
if (await panel.isVisible()) await page.keyboard.press('F6');
// The fight may open with a film (first time): hold Escape until it is gone.
{
  await page.waitForTimeout(2000);
  if ((await page.locator('.ui-cine').count()) > 0) {
    await page.keyboard.down('Escape');
    await page
      .waitForFunction(() => !document.querySelector('.ui-cine'), null, { timeout: 60_000 })
      .catch(() => {});
    await page.keyboard.up('Escape');
  }
}
await waitFor(page, (l) => /nearest sultan/i.test(l.get('enemies') ?? ''), 150);
await page.waitForTimeout(3000);
let sultan = '';
for (let i = 0; i < 6 && !/sultan/.test(sultan); i++) {
  await tap(page, 'Tab');
  sultan = await lockLine(page);
  if (/sultan/.test(sultan)) break;
  if (!sultan.startsWith('none')) await tap(page, 'Tab');
}
if (!/sultan/.test(sultan)) say([...(await lines(page))].map(([k, v]) => `${k} ${v}`).join('\n'));
check('Tab locks on Sultan', /sultan/.test(sultan), sultan);

// 2. Slimes in the Greenwood.
page = await reopenWith(page, {
  world: {
    zone: 'greenwood',
    position: { x: -1340, y: 0, z: -150 },
    heading: Math.PI,
    checkpoint: null,
  },
});
await page
  .getByRole('button', { name: 'Continue', exact: true })
  .first()
  .click({ timeout: 60_000 });
const near = await waitFor(page, (l) => /in range [1-9]/.test(l.get('lock') ?? ''), 120);
say(`lock line near the slimes: ${near?.get('lock')}`);
if (!near) say([...(await lines(page))].map(([k, v]) => `${k} ${v}`).join('\n'));
if (!near) {
  check('slimes found', false, 'no slime in range (was the spawn moved?)');
} else {
  // Make sure the camera looks at the slime: try Tab, and turn the camera in steps if not.
  let picked = '';
  for (let turn = 0; turn < 12 && !picked; turn++) {
    await tap(page, 'Tab');
    const l = await lockLine(page);
    if (!l.startsWith('none')) picked = l;
    else {
      await page.mouse.move(500, 300);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(560, 300, { steps: 5 });
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(400);
    }
  }
  check('Tab locks on a slime in view', /slime/.test(picked), picked || 'nothing picked');
  if (picked) {
    await tap(page, 'Tab'); // let go
    const idle = await lockLine(page);
    check('second Tab lets go', idle.startsWith('none'), idle);
  }
}

// 3. Behind you: stand just south of the meadow and face away from it, so every slime in range
// is behind the camera (the camera starts behind the character, looking where he faces).
page = await reopenWith(page, {
  world: {
    zone: 'greenwood',
    position: { x: -1340, y: 0, z: -176 },
    heading: Math.PI,
    checkpoint: null,
  },
});
await page
  .getByRole('button', { name: 'Continue', exact: true })
  .first()
  .click({ timeout: 60_000 });
const back = await waitFor(page, (l) => /in range [1-9]/.test(l.get('lock') ?? ''), 120);
if (!back) {
  check('slimes behind found', false, 'no slime in range');
} else {
  const before = back.get('lock') ?? '';
  await tap(page, 'Tab');
  const after = await lockLine(page);
  say(`behind: ${before} | after Tab: ${after}`);
  const inView = /(\d+) in view/.exec(before)?.[1];
  check('slimes are all behind the camera', inView === '0', before);
  check('Tab does not lock on an enemy behind you', after.startsWith('none'), after);
}

await browser.close();
server?.stop();
if (problems.length) say(`console problems: ${problems.join(' | ')}`);
process.exit(results.every(Boolean) && results.length >= 4 ? 0 : 1);
