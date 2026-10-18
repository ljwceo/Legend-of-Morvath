#!/usr/bin/env node
/**
 * Common combat base check (fase G.2): mana and the guard for every build, in the real game in
 * a headless browser. It plays a new game, skips the intro and then reopens the save twice:
 *
 *   1. as a sword fighter from before G.2 (path sword, 0 mana saved, a sword in hand): the mana
 *      bar is there, mana starts at 0 and comes back by itself, and holding block raises the
 *      guard (it costs its energy and halves the walking speed);
 *   2. as a light mage with a staff in hand: holding block raises the guard as well.
 *
 * The guard is read from the debug lines `energy` and `load` (walk speed), so nothing extra
 * has to be shown on screen. Fps in the headless browser means nothing (software rendering).
 *
 *   npm i --no-save playwright   (or the one in /opt/node-tools)
 *   node scripts/g2-check.mjs [--url <game url>] [--headed]
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
    const child = spawn(process.execPath, [vite, '--port', '5183', '--strictPort'], {
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
const watch = (page) => page.on('pageerror', (e) => problems.push(e.message));
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
const line = async (page, key) => (await lines(page)).get(key) ?? '';

async function waitFor(page, test, seconds = 90) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const l = await lines(page);
    if (test(l)) return l;
    await page.waitForTimeout(300);
  }
  return null;
}

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  say(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
};

const number = (text, pattern) => Number(pattern.exec(text)?.[1] ?? NaN);
const mana = (l) => number(l.get('combat') ?? '', /mana (\d+)/);
const energy = (l) => number(l.get('energy') ?? '', /^(\d+)/);
const walk = (l) => number(l.get('load') ?? '', /walk ([\d.]+) m\/s/);

/** Reopens the game with these parts of the save replaced, and presses Continue. */
async function reopenWith(page, patch) {
  await page.close();
  const next = await page.context().newPage();
  watch(next);
  await next.addInitScript(
    ([key, p]) => {
      // Only once: a reload later must not undo what the game saved meanwhile.
      if (window.sessionStorage.getItem('patched')) return;
      window.sessionStorage.setItem('patched', '1');
      const save = JSON.parse(window.localStorage.getItem(key) ?? 'null');
      if (!save) return;
      Object.assign(save, p);
      window.localStorage.setItem(key, JSON.stringify(save));
    },
    [SAVE_KEY, patch],
  );
  await next.goto(gameUrl, { waitUntil: 'domcontentloaded' });
  return next;
}

/** Holds block (R) and reads energy and walk speed before and while it is held. */
async function guardTest(page, label) {
  await page.mouse.click(VIEWPORT.width * 0.8, VIEWPORT.height * 0.85);
  const rested = await waitFor(page, (l) => energy(l) >= 100 && walk(l) > 0, 20);
  const before = { energy: rested ? energy(rested) : NaN, walk: rested ? walk(rested) : NaN };
  await page.keyboard.down('KeyR');
  const up = await waitFor(page, (l) => walk(l) < before.walk * 0.75, 15);
  await page.waitForTimeout(1500);
  const held = await lines(page);
  await page.keyboard.up('KeyR');
  check(
    `${label}: holding block raises the guard (walk speed halves)`,
    !!up && Math.abs(walk(held) / before.walk - 0.5) < 0.02,
    `walk ${before.walk} → ${walk(held)} m/s`,
  );
  check(
    `${label}: the raise costs its energy and the guard keeps it from refilling`,
    energy(held) === before.energy - 5,
    `energy ${before.energy} → ${energy(held)}`,
  );
  const down = await waitFor(page, (l) => walk(l) > before.walk * 0.9, 15);
  check(`${label}: letting go lowers the guard`, !!down, `walk ${down ? walk(down) : '?'} m/s`);
}

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
try {
  await page.goto(gameUrl, { waitUntil: 'domcontentloaded' });
  await click(page, 'English');
  page = await reopenWith(page, {});
  await click(page, 'New Game');
  await page.locator('input[type="text"]').first().fill('Guardian');
  await click(page, 'Next: your stats');
  await click(page, 'Begin your journey');
  await page.locator('.ui-cine').first().waitFor({ state: 'attached', timeout: 180_000 });
  await page.waitForTimeout(3000);
  await page.keyboard.down('Escape');
  await waitFor(page, (l) => !/introScene/.test(l.get('state') ?? ''), 30);
  await page.keyboard.up('Escape');
  await waitFor(page, (l) => /world/.test(l.get('state') ?? '') && (l.get('chunks') ?? '') !== '');
  say('in the world');
  await page.waitForTimeout(2000);
  const save = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SAVE_KEY);
  const settings = { ...save.settings, debug: true, quality: 'low', autoQuality: 'low' };

  // 1. A sword fighter saved before G.2: path sword, 0 mana, the Old Sword in hand.
  page = await reopenWith(page, {
    settings,
    path: 'sword',
    progress: { ...save.progress, mana: 0 },
    character: {
      ...save.character,
      equipment: { ...save.character.equipment, weapon: 'old_sword' },
      crystal: null,
    },
  });
  await click(page, 'Continue');
  const start = await waitFor(page, (l) => /weapon old_sword/.test(l.get('loadout') ?? ''), 120);
  check('the old sword save loads (save version unchanged)', !!start, await line(page, 'combat'));
  const barHidden = await page.evaluate(
    () => document.querySelector('.ui-hud-bar-mana')?.hidden ?? true,
  );
  check('a sword fighter has a mana bar', !barHidden, `hidden ${barHidden}`);
  const first = start ? mana(start) : NaN;
  const later = await waitFor(page, (l) => mana(l) >= first + 2, 60);
  check(
    'mana starts empty and comes back by itself',
    first <= 1 && !!later,
    `mana ${first} → ${later ? mana(later) : '?'}`,
  );
  await guardTest(page, 'sword');

  // 2. A light mage with the Mage Staff in hand.
  const now = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SAVE_KEY);
  page = await reopenWith(page, {
    path: 'light',
    character: {
      ...now.character,
      inventory: [...now.character.inventory, { item: 'mage_staff', count: 1 }],
      equipment: { ...now.character.equipment, weapon: 'mage_staff' },
      crystal: 'wizard_crystal',
    },
  });
  await click(page, 'Continue');
  const staff = await waitFor(page, (l) => /weapon mage_staff/.test(l.get('loadout') ?? ''), 120);
  check('the staff save loads', !!staff, await line(page, 'combat'));
  await guardTest(page, 'staff');
} finally {
  await browser.close();
  server?.stop();
}

check('no errors in the page', problems.length === 0, problems.join(' | ') || 'none');
const passed = results.filter(Boolean).length;
say(`${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
