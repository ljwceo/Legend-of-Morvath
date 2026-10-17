#!/usr/bin/env node
/**
 * Combat controls check (2026-10-17): the bag in a fight, quick switching and the HUD cross,
 * in the real game in a headless browser. A fake controller (standard mapping) is put in
 * `navigator.getGamepads`, so the controller part runs without a real one.
 *
 *   1. out of a fight, with an Adept Staff, two fire spells, a sword and potions in the bag:
 *      the wheel picks the spell, Ctrl + wheel zooms, 3 picks the quick item, 1 the weapon;
 *   2. a cast keeps its spell when D-pad up picks another one meanwhile, and a weapon switch
 *      asked for during the cast waits until the cast is over;
 *   3. in the fight with Sultan: Back on the controller does not open the bag; I does, the
 *      fight goes on behind it (no pause), a click in the bag does not attack, moving the
 *      mouse does not turn the camera, and closing it gives the game back.
 *
 *   npm i --no-save playwright   (or the one in /opt/node-tools)
 *   node scripts/combat-controls-check.mjs [--url <game url>] [--headed] [--shots <folder>]
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
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : ROOT;

/** Standard mapping: X = 2, RT = 7, Back = 8, D-pad up = 12, D-pad left = 14. */
const PAD = { x: 2, rt: 7, back: 8, up: 12, left: 14 };

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
    const child = spawn(process.execPath, [vite, '--port', '5182', '--strictPort'], {
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
const waitLine = (page, key, pattern, seconds = 20) =>
  waitFor(page, (l) => pattern.test(l.get(key) ?? ''), seconds);

/** A key held long enough for a slow headless frame to see it. */
async function tap(page, key, ms = 800) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(400);
}

const pad = (page, button, down) =>
  page.evaluate(([b, d]) => window.__setPad(b, d), [button, down]);
async function padTap(page, button) {
  await pad(page, button, true);
  await page.waitForTimeout(1000);
  await pad(page, button, false);
  await page.waitForTimeout(800);
}

/** A spot where the playing field itself is under the mouse (set once in the world). */
let playPoint = [VIEWPORT.width / 2, VIEWPORT.height / 2];
async function wheel(page, deltaY, ctrl = false) {
  await page.mouse.move(playPoint[0], playPoint[1]);
  if (ctrl) await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(1200);
  if (ctrl) await page.keyboard.up('Control');
}

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

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  say(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
};
/** Checks a debug line, waiting a while: a headless frame can take most of a second. */
async function expectLine(page, name, key, pattern, seconds = 10) {
  const found = await waitLine(page, key, pattern, seconds);
  check(name, !!found, await line(page, key));
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
// A controller nobody holds: the check presses its buttons with window.__setPad.
await context.addInitScript(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const fake = {
    id: 'Fake pad (STANDARD GAMEPAD)',
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons,
    timestamp: 0,
  };
  window.__setPad = (i, down) => {
    buttons[i] = { pressed: down, touched: down, value: down ? 1 : 0 };
    fake.timestamp = performance.now();
  };
  navigator.getGamepads = () => [fake, null, null, null];
});
let page = await context.newPage();
watch(page);
await page.goto(gameUrl, { waitUntil: 'domcontentloaded' });
await click(page, 'English');
page = await reopenWith(page, { settings: { debug: true, quality: 'low', autoQuality: 'low' } });
await click(page, 'New Game');
await page.locator('input[type="text"]').first().fill('Switcher');
await click(page, 'Next: your stats');
await click(page, 'Begin your journey');
await page.locator('.ui-cine').first().waitFor({ state: 'attached', timeout: 180_000 });
await page.waitForTimeout(3000);
await page.keyboard.down('Escape');
await waitFor(page, (l) => !/introScene/.test(l.get('state') ?? ''), 30);
await page.keyboard.up('Escape');
await waitFor(page, (l) => /world/.test(l.get('state') ?? '') && (l.get('chunks') ?? '') !== '');
say('in the world');
// Let the game write its save once, then give the character a mage's kit.
await page.waitForTimeout(2000);
const save = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SAVE_KEY);
page = await reopenWith(page, {
  character: {
    ...save.character,
    equipment: { ...save.character.equipment, weapon: 'adept_staff' },
    inventory: [
      ...save.character.inventory.filter((s) => !/potion/.test(s.item)),
      { item: 'adept_staff', count: 1 },
      { item: 'old_sword', count: 1 },
      { item: 'health_potion', count: 3 },
      { item: 'mana_potion', count: 2 },
    ],
    crystal: 'fire',
    spells: ['fireball', 'ember_burst'],
    spellLoadout: ['fireball', 'ember_burst'],
  },
});
await click(page, 'Continue');
const start = await waitLine(page, 'loadout', /weapon adept_staff/, 120);
say(`loadout: ${start?.get('loadout')}`);
// The wheel goes to whatever is under the mouse: find a spot on the playing field itself
// (the large debug overlay covers the middle of a small window).
playPoint = await page.evaluate(() => {
  for (let y = 0.9; y > 0.3; y -= 0.1) {
    for (let x = 0.9; x > 0.1; x -= 0.1) {
      const px = Math.round(window.innerWidth * x);
      const py = Math.round(window.innerHeight * y);
      if (document.elementFromPoint(px, py)?.classList.contains('ui-world-input')) return [px, py];
    }
  }
  return [window.innerWidth / 2, window.innerHeight / 2];
});
say(`wheel at ${playPoint.join(', ')}`);
check(
  'a staff with two spells',
  /spell fireball \(slot 0\)/.test(start?.get('loadout') ?? ''),
  start?.get('loadout') ?? 'no loadout line',
);

// 1. Out of a fight.
await wheel(page, -120);
await expectLine(page, 'wheel up: next spell', 'loadout', /spell ember_burst/);
await wheel(page, 120);
await expectLine(page, 'wheel down: previous spell', 'loadout', /spell fireball/);
const dist = async () => /dist ([\d.]+) m/.exec(await line(page, 'camera'))?.[1] ?? '';
const distBefore = await dist();
await wheel(page, 300, true);
await waitFor(page, (l) => !(l.get('camera') ?? '').includes(`dist ${distBefore} m`), 10);
const distAfter = await dist();
check(
  'Ctrl + wheel zooms and keeps the spell',
  distBefore !== distAfter && /spell fireball/.test(await line(page, 'loadout')),
  `dist ${distBefore} → ${distAfter}`,
);
await tap(page, 'Digit3');
await expectLine(page, '3: next quick item', 'loadout', /item mana_potion/);
await tap(page, 'Digit1');
const sword = await waitLine(page, 'loadout', /weapon old_sword/, 5);
check('1: next weapon (the sword)', !!sword, await line(page, 'loadout'));
await tap(page, 'Digit1');
await waitLine(page, 'loadout', /weapon adept_staff/, 5);
const cross = await page.evaluate(() =>
  [...document.querySelectorAll('.ui-loadout-cell')].map((c) => c.textContent),
);
check(
  'the HUD cross shows spell, weapon, off hand and item',
  cross.length === 4,
  cross.join(' | '),
);

// The cross shows for a moment after a switch: a picture of it, for the eye.
await tap(page, 'Digit3', 300);
// The debug text would cover the HUD: hidden for the picture only.
await page.addStyleTag({ content: '.debug-overlay, .debug-errors { visibility: hidden; }' });
await page.screenshot({ path: path.join(shots, 'combat-controls-hud.png') });
await page.evaluate(() => document.head.lastElementChild?.remove());
say(`screenshot: ${path.join(shots, 'combat-controls-hud.png')}`);

// 2. A cast keeps its spell; a weapon switch waits for the cast.
await pad(page, PAD.rt, true);
const casting = await waitLine(page, 'loadout', /casting fireball/, 10);
check('RT charges the selected spell', !!casting, await line(page, 'combat'));
await padTap(page, PAD.up);
await pad(page, PAD.rt, true);
const mid = await line(page, 'loadout');
check(
  'D-pad up picks the next spell, the cast keeps its own',
  /spell ember_burst.*casting fireball/.test(mid),
  mid,
);
await padTap(page, PAD.left);
const waiting = await line(page, 'loadout');
check('D-pad left during the cast waits', /weapon adept_staff → old_sword/.test(waiting), waiting);
await pad(page, PAD.rt, false);
const switched = await waitLine(page, 'loadout', /weapon old_sword(?! →)/, 10);
check('the switch happens once the cast is over', !!switched, await line(page, 'loadout'));
await padTap(page, PAD.left);
await waitLine(page, 'loadout', /weapon adept_staff/, 5);

// 3. The fight with Sultan.
await page.keyboard.press('F6');
const panel = page.locator('.ui-panel.ui-cheats');
await panel.waitFor({ state: 'visible', timeout: 15_000 });
await panel.getByRole('button', { name: 'Fight Sultan', exact: true }).first().click();
if (await panel.isVisible()) await page.keyboard.press('F6');
await page.waitForTimeout(2000);
if ((await page.locator('.ui-cine').count()) > 0) {
  await page.keyboard.down('Escape');
  await page
    .waitForFunction(() => !document.querySelector('.ui-cine'), null, { timeout: 60_000 })
    .catch(() => {});
  await page.keyboard.up('Escape');
}
const fighting = await waitLine(page, 'combat', /in fight/, 150);
check('in the fight', !!fighting, await line(page, 'combat'));

await padTap(page, PAD.back);
const bagByPad = await page.locator('.ui-bag').count();
const padMessage = await page
  .waitForFunction(
    () => /controller/.test(document.querySelector('.ui-hud-message')?.textContent ?? ''),
    null,
    { timeout: 20_000 },
  )
  .then(() => true)
  .catch(() => false);
check(
  'Back on a controller does not open the bag in a fight, and says why',
  bagByPad === 0 && padMessage,
  await page.evaluate(() => document.querySelector('.ui-hud-message')?.textContent ?? ''),
);
await tap(page, 'KeyI', 200);
const open = await waitLine(page, 'loadout', /menu open, fight goes on/, 10);
check('I opens the bag in a fight without pausing', !!open, await line(page, 'loadout'));
check(
  'the mouse is free for the bag',
  /mouse free/.test(await line(page, 'loadout')),
  await line(page, 'loadout'),
);
check(
  'the bag says the fight goes on',
  (await page.locator('.ui-bag .ui-note-warn').count()) > 0,
  '',
);
const enemiesBefore = await line(page, 'enemies');
const yawBefore = /yaw (-?\d+)°/.exec(await line(page, 'camera'))?.[1];
const box = await page.locator('.ui-bag').boundingBox();
if (box) {
  await page.mouse.click(box.x + box.width / 2, box.y + 12);
  await page.mouse.move(box.x + 20, box.y + 40, { steps: 8 });
}
await page.waitForTimeout(1500);
const combat = await line(page, 'combat');
check('a click in the bag does not attack', !/casting shard/.test(combat), combat);
const yawAfter = /yaw (-?\d+)°/.exec(await line(page, 'camera'))?.[1];
check(
  'moving the mouse does not turn the camera',
  yawBefore === yawAfter,
  `${yawBefore}° → ${yawAfter}°`,
);
const enemiesAfter = await line(page, 'enemies');
check('the fight goes on behind the bag', enemiesBefore !== enemiesAfter, enemiesAfter);
check('the bag is still open', (await page.locator('.ui-bag').count()) === 1, '');
await tap(page, 'KeyI', 200);
const closed = await waitLine(page, 'loadout', /menu closed/, 5);
check(
  'I closes the bag again',
  !!closed && (await page.locator('.ui-bag').count()) === 0,
  await line(page, 'loadout'),
);
say(`after closing: ${await line(page, 'loadout')} (headless Chromium may refuse pointer lock)`);
await padTap(page, PAD.x);
say(`X (quick item) in the fight: ${await line(page, 'combat')}`);

await browser.close();
server?.stop();
if (problems.length) say(`console problems: ${problems.join(' | ')}`);
const passed = results.filter(Boolean).length;
say(`${passed}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
