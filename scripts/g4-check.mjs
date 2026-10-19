#!/usr/bin/env node
/**
 * Grimoire save migration check (fase G.4): an old save in the real game, in a headless
 * browser. It plays a new game, skips the intro, and then reopens the save as the game wrote
 * it before G.4 (version 20, no `elements` / `incantations`, a light mage with the Mage Staff
 * in hand and no sword at all). Then it checks that:
 *
 *   1. the save loads, migrated to version 21: the Old Sword is in hand, the staff, the crystal
 *      and the spells stay in the bag, the Rookie Grimoire joined it, the crystal's element is
 *      unlocked for good, and the original is kept once under `<save key>.backup.v20`;
 *   2. the Grimoire is ready (debug line `energy` → `grimoire ready`) and V prepares Push;
 *   3. a reload afterwards changes nothing more: version 21 again, the same bag, the backup as
 *      it was.
 *
 *   npm i --no-save playwright   (or the one in /opt/node-tools)
 *   node scripts/g4-check.mjs [--url <game url>] [--headed]
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const SAVE_KEY = 'legend-of-morvath.save';
const BACKUP_KEY = `${SAVE_KEY}.backup.v20`;
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
    const child = spawn(process.execPath, [vite, '--port', '5184', '--strictPort'], {
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

const stored = (page, key) => page.evaluate((k) => window.localStorage.getItem(k), key);
const count = (stacks, item) =>
  (stacks ?? []).reduce((n, s) => (s.item === item ? n + s.count : n), 0);

/** Reopens the game with these parts of the save replaced, and presses Continue. */
async function reopenWith(page, patch) {
  await page.close();
  const next = await page.context().newPage();
  watch(next);
  await next.addInitScript(
    ([key, p]) => {
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
  await page.locator('input[type="text"]').first().fill('Oldtimer');
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
  const save = JSON.parse(await stored(page, SAVE_KEY));
  check('a new game saves version 21', save.version === 21, `version ${save.version}`);

  // A light mage from before G.4: version 20, no G.4 fields, the staff in hand, no sword.
  const { elements, incantations, ...oldCharacter } = save.character;
  void elements;
  void incantations;
  const v20 = {
    version: 20,
    path: 'light',
    settings: { ...save.settings, debug: true, quality: 'low', autoQuality: 'low' },
    character: {
      ...oldCharacter,
      inventory: [
        ...save.character.inventory.filter(
          (s) => !['old_sword', 'rookie_grimoire'].includes(s.item),
        ),
        { item: 'mage_staff', count: 1 },
        { item: 'wizard_crystal', count: 1 },
      ],
      equipment: { ...save.character.equipment, weapon: 'mage_staff' },
      crystal: 'fire',
      spells: ['fireball'],
      spellLoadout: ['fireball'],
    },
  };
  page = await reopenWith(page, v20);
  await click(page, 'Continue');
  const start = await waitFor(page, (l) => /weapon old_sword/.test(l.get('loadout') ?? ''), 120);
  check(
    'the old staff save loads with the Old Sword in hand',
    !!start,
    start?.get('loadout') ?? 'no loadout line',
  );
  // Boot stores the migrated save at once (the backup is made first); give it a moment.
  await waitFor(page, () => false, 1.5);
  const migrated = JSON.parse(await stored(page, SAVE_KEY));
  const bag = migrated.character?.inventory;
  check(
    'the save is written as version 21',
    migrated.version === 21,
    `version ${migrated.version}`,
  );
  check(
    'the staff, the crystal and the spell stay; the Grimoire joined the bag; one Old Sword',
    count(bag, 'mage_staff') === 1 &&
      count(bag, 'wizard_crystal') === 1 &&
      count(bag, 'rookie_grimoire') === 1 &&
      count(bag, 'old_sword') === 1 &&
      migrated.character?.spells?.[0] === 'fireball',
    JSON.stringify(bag),
  );
  check(
    "the crystal's element is unlocked for good, nothing is learned by itself",
    JSON.stringify(migrated.character?.elements) === '["fire"]' &&
      JSON.stringify(migrated.character?.incantations) === '[]',
    `elements ${JSON.stringify(migrated.character?.elements)} incantations ${JSON.stringify(migrated.character?.incantations)}`,
  );
  const backup = await stored(page, BACKUP_KEY);
  const backupSave = backup ? JSON.parse(backup) : null;
  check(
    'the original save is kept as a backup (version 20, the staff still in hand)',
    backupSave?.version === 20 && backupSave?.character?.equipment?.weapon === 'mage_staff',
    backup ? `${backup.length} chars` : 'no backup',
  );

  // The Grimoire: ready, and V prepares Push.
  const ready = await waitFor(page, (l) => /grimoire ready/.test(l.get('energy') ?? ''), 30);
  check(
    'the Grimoire is ready without the temporary access of G.3',
    !!ready,
    ready?.get('energy') ?? '?',
  );
  await page.mouse.click(VIEWPORT.width * 0.8, VIEWPORT.height * 0.85);
  await page.keyboard.press('KeyV');
  const casting = await waitFor(
    page,
    (l) => /grimoire (casting|cd|lockout)/.test(l.get('energy') ?? ''),
    10,
  );
  check('V casts Push from the Grimoire', !!casting, casting?.get('energy') ?? '?');

  // A reload: nothing changes any more, the backup stays what it was.
  page = await reopenWith(page, {});
  await click(page, 'Continue');
  const again = await waitFor(page, (l) => /weapon old_sword/.test(l.get('loadout') ?? ''), 120);
  await page.waitForTimeout(1500);
  const reloaded = JSON.parse(await stored(page, SAVE_KEY));
  check(
    'a second load migrates nothing more (still one Grimoire, one Old Sword, version 21)',
    !!again &&
      reloaded.version === 21 &&
      count(reloaded.character?.inventory, 'rookie_grimoire') === 1 &&
      count(reloaded.character?.inventory, 'old_sword') === 1,
    JSON.stringify(reloaded.character?.inventory),
  );
  check('the backup is untouched', (await stored(page, BACKUP_KEY)) === backup, BACKUP_KEY);
} finally {
  await browser.close();
  server?.stop();
}

check('no errors in the page', problems.length === 0, problems.join(' | ') || 'none');
const passed = results.filter(Boolean).length;
say(`${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
