#!/usr/bin/env node
/**
 * Flasks and prepared loadout check (fase G.5): the real game in a headless browser. It plays
 * a new game, skips the intro, and then checks:
 *
 *   1. a new game saves version 22 with 1 Flask charge (the Health Flask, full); entering the
 *      world fills the never-chosen prepared sets once (the Old Sword, Push) and keeps them;
 *   2. with HP down, Q drinks the Health Flask: one charge gone, written to the save at once;
 *      a reload keeps the empty Flask (loading never refills);
 *   3. E at the checkpoint (the bed) rests: HP and the Flask are full again, the rest panel
 *      opens, and moving a charge to the Mana Flask gives 0 / 2 that persists after closing;
 *   4. the bag outside a fight has no Drink button and marks an old potion as legacy;
 *   5. a second weapon prepared in slot 2: 1 cycles between the two prepared main weapons, V
 *      casts Push from the prepared slot;
 *   6. a save of version 21 with 7 Health Potions and 3 Mana Potions migrates to version 22
 *      with the potions exactly as they were, the Flasks full once, and the original kept
 *      under `<save key>.backup.v21`; a second load changes nothing more.
 *
 *   npm i --no-save playwright   (or the one in /opt/node-tools)
 *   node scripts/g5-check.mjs [--url <game url>] [--headed]
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const SAVE_KEY = 'legend-of-morvath.save';
const BACKUP_KEY = `${SAVE_KEY}.backup.v21`;
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
    const child = spawn(process.execPath, [vite, '--port', '5185', '--strictPort'], {
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
/**
 * A button in a panel over the world, pressed through the DOM: the pointer lock the world
 * held a moment ago makes Playwright's own hit test unreliable right after a panel opens.
 */
const press = (page, name) =>
  page
    .getByRole('button', { name, exact: true })
    .first()
    .evaluate((button) => button.click());

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
const flasksOf = (save) => JSON.stringify(save?.character?.flasks ?? null);

/** Reopens the game with these parts of the save replaced (deep for `character`). */
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

async function inWorld(page) {
  return waitFor(page, (l) => /world/.test(l.get('state') ?? '') && (l.get('chunks') ?? '') !== '');
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
  await page.locator('input[type="text"]').first().fill('Flasker');
  await click(page, 'Next: your stats');
  await click(page, 'Begin your journey');
  await page.locator('.ui-cine').first().waitFor({ state: 'attached', timeout: 180_000 });
  await page.waitForTimeout(3000);
  await page.keyboard.down('Escape');
  await waitFor(page, (l) => !/introScene/.test(l.get('state') ?? ''), 30);
  await page.keyboard.up('Escape');
  await inWorld(page);
  say('in the world');
  await page.waitForTimeout(2000);
  const fresh = JSON.parse(await stored(page, SAVE_KEY));
  check('a new game saves version 22', fresh.version === 22, `version ${fresh.version}`);
  check(
    'a new character has 1 Flask charge (Health), full; the world filled the sets once',
    flasksOf(fresh) ===
      '{"capacity":1,"health":1,"mana":0,"healthLeft":1,"manaLeft":0,"discoveries":[]}' &&
      JSON.stringify(fresh.character.prepared) ===
        '{"weapons":["old_sword",""],"incantations":["push"]}' &&
      JSON.stringify(fresh.character.slotUpgrades) === '{"weaponHarness":[],"grimoirePages":[]}',
    `${flasksOf(fresh)} prepared ${JSON.stringify(fresh.character.prepared)}`,
  );
  const loadoutLine = await waitFor(
    page,
    (l) => /incantation push/.test(l.get('loadout') ?? ''),
    10,
  );
  check(
    'Push is the prepared incantation, the Health Flask the quick item',
    !!loadoutLine && /flask health H 1\/1 M 0\/0/.test(loadoutLine.get('loadout') ?? ''),
    loadoutLine?.get('loadout') ?? 'no loadout line',
  );

  // 2. Hurt: Q drinks the Health Flask; the charge is gone and stays gone after a reload.
  page = await reopenWith(page, { progress: { ...fresh.progress, hp: 10 } });
  await click(page, 'Continue');
  await inWorld(page);
  await page.waitForTimeout(1500);
  await page.mouse.click(VIEWPORT.width * 0.8, VIEWPORT.height * 0.85);
  await page.keyboard.press('KeyQ');
  const drunk = await waitFor(page, (l) => /H 0\/1/.test(l.get('loadout') ?? ''), 10);
  check('Q drinks the Health Flask: one charge gone', !!drunk, drunk?.get('loadout') ?? '?');
  await page.waitForTimeout(800);
  const afterDrink = JSON.parse(await stored(page, SAVE_KEY));
  check(
    'the spent charge is in the save at once (capacity and split unchanged)',
    afterDrink.character.flasks.healthLeft === 0 &&
      afterDrink.character.flasks.capacity === 1 &&
      afterDrink.character.flasks.health === 1,
    flasksOf(afterDrink),
  );
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(1200);
  const twice = JSON.parse(await stored(page, SAVE_KEY));
  check(
    'an empty Flask cannot be used again (no negative charge, no effect)',
    twice.character.flasks.healthLeft === 0,
    flasksOf(twice),
  );
  page = await reopenWith(page, {});
  await click(page, 'Continue');
  await inWorld(page);
  const stillEmpty = await waitFor(page, (l) => /H 0\/1/.test(l.get('loadout') ?? ''), 10);
  check(
    'a reload keeps the empty Flask: loading never refills',
    !!stillEmpty,
    stillEmpty?.get('loadout') ?? '?',
  );

  // 3. Rest at the bed: everything full, the rest panel opens, the split can change.
  await page.waitForTimeout(1000);
  await page.mouse.click(VIEWPORT.width * 0.8, VIEWPORT.height * 0.85);
  await page.keyboard.press('KeyE');
  const restPanel = page.getByRole('dialog', { name: 'Resting' });
  await restPanel.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  check(
    'E at the checkpoint opens the rest panel',
    (await restPanel.count()) > 0,
    'dialog "Resting"',
  );
  const rested = JSON.parse(await stored(page, SAVE_KEY));
  check(
    'resting refills the charge (1 / 0) and HP',
    rested.character.flasks.healthLeft === 1 &&
      rested.character.flasks.manaLeft === 0 &&
      (rested.progress.hp === null || rested.progress.hp >= 50),
    `${flasksOf(rested)} hp ${rested.progress.hp}`,
  );
  await press(page, 'One Mana Flask charge more');
  await page.waitForTimeout(300);
  const split = page.locator('.ui-rest-count');
  const counts = await split.allTextContents();
  check(
    'moving the charge to the Mana Flask gives 0 / 0 and 1 / 1 while resting',
    counts.join('|') === '0 / 0|1 / 1',
    counts.join('|'),
  );
  await press(page, 'Close');
  await page.waitForTimeout(500);
  const afterRest = JSON.parse(await stored(page, SAVE_KEY));
  check(
    'the new split (0 Health / 1 Mana, full) is saved when the panel closes',
    flasksOf(afterRest) ===
      '{"capacity":1,"health":0,"mana":1,"healthLeft":0,"manaLeft":1,"discoveries":[]}',
    flasksOf(afterRest),
  );

  // 4. The bag outside a fight: no Drink, legacy potions marked; 5. two prepared weapons.
  page = await reopenWith(page, {
    character: {
      ...afterRest.character,
      inventory: [
        ...afterRest.character.inventory,
        { item: 'health_potion', count: 2 },
        { item: 'goblin_cleaver', count: 1 },
      ],
      // Prepared in slot 2 (the Loadout panel does this in play; a found weapon never
      // prepares itself once the set is the player's).
      prepared: { weapons: ['old_sword', 'goblin_cleaver'], incantations: ['push'] },
    },
  });
  await click(page, 'Continue');
  await inWorld(page);
  await page.waitForTimeout(1000);
  await page.keyboard.press('KeyI');
  await page.getByRole('dialog').first().waitFor({ state: 'attached', timeout: 10_000 });
  const drinkButtons = await page.getByRole('button', { name: /^Drink/ }).count();
  const useButtons = await page.getByRole('button', { name: /^Use/ }).count();
  const legacyMarks = await page.locator('.ui-bag-legacy').count();
  check(
    'the bag has no Drink or Use button outside a fight and marks the old potion as legacy',
    drinkButtons === 0 && useButtons === 0 && legacyMarks === 1,
    `drink ${drinkButtons} use ${useButtons} legacy ${legacyMarks}`,
  );
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(500);
  await page.mouse.click(VIEWPORT.width * 0.8, VIEWPORT.height * 0.85);
  await page.keyboard.press('Digit1');
  const cleaver = await waitFor(
    page,
    (l) => /weapon goblin_cleaver/.test(l.get('loadout') ?? ''),
    10,
  );
  check('1 switches to the second prepared weapon', !!cleaver, cleaver?.get('loadout') ?? '?');
  await page.keyboard.press('Digit1');
  const back = await waitFor(page, (l) => /weapon old_sword/.test(l.get('loadout') ?? ''), 10);
  check(
    '1 again comes back to the Old Sword (slot 1: the weapon in hand)',
    !!back,
    back?.get('loadout') ?? '?',
  );
  await page.keyboard.press('KeyV');
  const casting = await waitFor(
    page,
    (l) => /grimoire (casting|cd|lockout)/.test(l.get('energy') ?? ''),
    10,
  );
  check('V casts Push from the prepared slot', !!casting, casting?.get('energy') ?? '?');
  await page.waitForTimeout(800);
  const withCleaver = JSON.parse(await stored(page, SAVE_KEY));
  check(
    'the potions in the bag are untouched by all of this',
    count(withCleaver.character.inventory, 'health_potion') === 2,
    JSON.stringify(withCleaver.character.inventory),
  );

  // 6. A version 21 save (G.4) with potions: migrated once, potions exact, backup kept.
  const { flasks, prepared, slotUpgrades, ...oldCharacter } = withCleaver.character;
  void flasks;
  void prepared;
  void slotUpgrades;
  const v21 = {
    version: 21,
    character: {
      ...oldCharacter,
      inventory: [
        ...oldCharacter.inventory.filter(
          (s) => !['health_potion', 'goblin_cleaver'].includes(s.item),
        ),
        { item: 'health_potion', count: 7 },
        { item: 'mana_potion', count: 3 },
      ],
      pack: [{ item: 'greater_health_potion', count: 2 }],
    },
  };
  page = await reopenWith(page, v21);
  await click(page, 'Continue');
  await inWorld(page);
  await page.waitForTimeout(1500);
  const migrated = JSON.parse(await stored(page, SAVE_KEY));
  check(
    'the version 21 save is written as version 22',
    migrated.version === 22,
    `version ${migrated.version}`,
  );
  check(
    'the potions stay exactly: 7 Health, 3 Mana in the bag, 2 Greater Health on the pack animal',
    count(migrated.character.inventory, 'health_potion') === 7 &&
      count(migrated.character.inventory, 'mana_potion') === 3 &&
      count(migrated.character.pack, 'greater_health_potion') === 2,
    `${JSON.stringify(migrated.character.inventory)} pack ${JSON.stringify(migrated.character.pack)}`,
  );
  check(
    'the Flasks arrive full once (1, Health); the world filled the sets deterministically',
    flasksOf(migrated) ===
      '{"capacity":1,"health":1,"mana":0,"healthLeft":1,"manaLeft":0,"discoveries":[]}' &&
      JSON.stringify(migrated.character.prepared) ===
        '{"weapons":["old_sword",""],"incantations":["push"]}' &&
      JSON.stringify(migrated.character.slotUpgrades) === '{"weaponHarness":[],"grimoirePages":[]}',
    `${flasksOf(migrated)} prepared ${JSON.stringify(migrated.character.prepared)}`,
  );
  const backup = await stored(page, BACKUP_KEY);
  const backupSave = backup ? JSON.parse(backup) : null;
  check(
    'the original is kept as a backup under .backup.v21 (version 21, no Flasks)',
    backupSave?.version === 21 && backupSave?.character?.flasks === undefined,
    backup ? `${backup.length} chars` : 'no backup',
  );
  page = await reopenWith(page, {});
  await click(page, 'Continue');
  await inWorld(page);
  await page.waitForTimeout(1500);
  const again = JSON.parse(await stored(page, SAVE_KEY));
  check(
    'a second load changes nothing more (version 22, the same potions, the same Flasks)',
    again.version === 22 &&
      count(again.character.inventory, 'health_potion') === 7 &&
      flasksOf(again) === flasksOf(migrated),
    flasksOf(again),
  );
  check('the backup is untouched', (await stored(page, BACKUP_KEY)) === backup, BACKUP_KEY);

  // 7. The three Greenwood quests finished before the reward existed: one charge each, once.
  const QUESTS = ['blade_in_the_woods', 'sparks_in_the_greenwood', 'shadows_in_the_greenwood'];
  page = await reopenWith(page, {
    quests: { active: [], completed: [...again.quests.completed, ...QUESTS] },
    character: { ...again.character, flasks: { ...again.character.flasks, healthLeft: 0 } },
  });
  await click(page, 'Continue');
  await inWorld(page);
  await page.waitForTimeout(1500);
  const entitled = JSON.parse(await stored(page, SAVE_KEY));
  check(
    'quests finished earlier give 3 permanent charges on entering the world (4 in all), still empty',
    entitled.character.flasks.capacity === 4 &&
      entitled.character.flasks.health === 4 &&
      entitled.character.flasks.healthLeft === 0 &&
      JSON.stringify(entitled.character.flasks.discoveries) ===
        JSON.stringify(QUESTS.map((id) => `quest:${id}`)),
    flasksOf(entitled),
  );
  page = await reopenWith(page, {});
  await click(page, 'Continue');
  await inWorld(page);
  await page.waitForTimeout(1500);
  const entitledAgain = JSON.parse(await stored(page, SAVE_KEY));
  check(
    'entering the world again grants nothing more (still 4, the same three discoveries)',
    flasksOf(entitledAgain) === flasksOf(entitled),
    flasksOf(entitledAgain),
  );
} finally {
  await browser.close();
  server?.stop();
}

check('no errors in the page', problems.length === 0, problems.join(' | ') || 'none');
const passed = results.filter(Boolean).length;
say(`${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
