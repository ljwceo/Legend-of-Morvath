// Test bench for group S (Souls-like combat), branch auto/souls (tools/testbank/README.md).
// Built steps: S.2 (gamepad), S.3 (stamina), S.4 (roll), S.4b (gold marker), S.5a/b (attack phases/cues), S.6 (poise), S.7 (guard). Earlier panels (Forge, shops, spellbook) stay on the bench.
// The panels, rules, data and texts are the real ones; only the world around them is faked,
// copied from WorldState (buy, sell, upgradeItem, chooseSpell, applyWeapon, learnSpells).
import '../../docs/art-style/tokens.css';
import '../../src/ui/ui.css';
import './bench.css';

import itemsJson from '../../public/data/items.json';
import npcsJson from '../../public/data/npcs.json';
import spellsJson from '../../public/data/spells.json';
import controlsJson from '../../public/data/controls.json';
import playerJson from '../../public/data/player.json';
import en from '../../public/lang/en.json';
import nl from '../../public/lang/nl.json';

import { Bindings } from '../../src/core/Bindings';
import { Input } from '../../src/core/Input';
import { labPanel } from './lab';
import { sultanPanel } from './sultan';
import { PadHub, padCode } from '../../src/core/gamepad';
import { keyLabel, keyParams } from '../../src/ui/keyLabels';
import { controlsPanel } from '../../src/ui/menus/ControlsPanel';
import { I18n } from '../../src/i18n/I18n';
import { Overlays, type Panel } from '../../src/ui/Overlays';
import { forgePanel } from '../../src/ui/menus/ForgePanel';
import { shopPanel, type BuyResult, type SellResult } from '../../src/ui/menus/ShopPanel';
import { spellbookPanel } from '../../src/ui/menus/SpellbookPanel';
import {
  addUpgradeStats,
  applyUpgrade,
  effectiveDamageBonus,
  type UpgradeResult,
} from '../../src/systems/Forge';
import { changeStock, sellPrice, stockLeft, type ShopEntry } from '../../src/systems/Shops';
import {
  activeSpell,
  normalizeLoadout,
  setSlot,
  spellsToLearn,
  usableSpells,
} from '../../src/systems/Spellbook';
import { addItem, countItem, removeItem } from '../../src/systems/Inventory';

type Item = (typeof itemsJson.items)[number] & Record<string, any>;
const items = new Map<string, Item>(itemsJson.items.map((i: any) => [i.id, i]));
const npcs: any[] = (npcsJson as any).npcs ?? npcsJson;
const marco = npcs.find((n) => n.id === 'marco');
const hilda = npcs.find((n) => n.id === 'hilda');
const spellDefs: any[] = (spellsJson as any).spells;
const elements: string[] = (spellsJson as any).elements.map((e: any) => e.id);

// ----------------------------------------------------------------- state (a fake save)

function freshSession() {
  return {
    playTimeSeconds: 0,
    settings: { debug: true, keybindings: {} as Record<string, string[]> },
    shopStock: {} as Record<string, { left: number; at: number }>,
    level: 1,
    inCombat: false,
    character: {
      gold: 300,
      crystal: 'fire' as string | null,
      spells: ['fireball'],
      spellLoadout: [] as string[],
      upgrades: {} as Record<string, number>,
      equipment: { weapon: 'mage_staff' as string | null },
      inventory: [
        { item: 'mage_staff', count: 1 },
        { item: 'old_sword', count: 1 },
        { item: 'travel_mantle', count: 1 },
        { item: 'slime_gel', count: 3 },
        { item: 'health_potion', count: 2 },
      ],
    },
  };
}
let session = freshSession();

// ----------------------------------------------------------------- the real I18n and Overlays

const i18n = new I18n(async () => ({}));
i18n.setStrings('en', en);
const listeners: Record<string, (() => void)[]> = {};
const events = {
  on: (name: string, fn: () => void) => (listeners[name] ??= []).push(fn),
  emit: (name: string) => listeners[name]?.forEach((fn) => fn()),
};

// S.2: the real Bindings, and a real PadHub reading navigator.getGamepads().
const bindings = new Bindings();
bindings.configure(controlsJson as any, null);
i18n.defaultParams = () => keyParams(bindings, i18n);
const pads = new PadHub();
pads.configure((controlsJson as any).gamepad);
const stage = document.getElementById('app') as HTMLElement;
const overlays = new Overlays(stage, events as any, i18n, bindings, pads);
const ctx: any = {
  i18n,
  overlays,
  bindings,
  pads,
  events,
  data: { items: itemsJson, spells: spellsJson },
  get session() {
    return session;
  },
  persist: () => {},
};

// ----------------------------------------------------------------- copied world rules

function staffSlots(): number {
  const def = items.get(session.character.equipment.weapon ?? '');
  return def?.weapon?.kind === 'staff' ? (def.weapon.spellSlots ?? 0) : 0;
}
function usableKnown(): string[] {
  const c = session.character;
  return usableSpells(c.spells, spellDefs, c.crystal);
}
function learnSpells(): void {
  const c = session.character;
  for (const id of spellsToLearn(c.spells, spellDefs, c.crystal, session.level)) c.spells.push(id);
}
/** WorldState.applyWeapon: the staff decides how many slots count. */
function applyWeapon(): void {
  learnSpells();
  const slots = staffSlots();
  if (slots > 0) {
    session.character.spellLoadout = normalizeLoadout(
      session.character.spellLoadout,
      usableKnown(),
      slots,
    );
  }
}

function buy(entry: ShopEntry): BuyResult {
  const c = session.character;
  const left = stockLeft(entry, session.shopStock, 'marco', session.playTimeSeconds);
  if (left !== null && left < 1) return 'soldOut';
  if (c.gold < entry.price) return 'notEnough';
  changeStock(entry, session.shopStock, 'marco', session.playTimeSeconds, 1);
  c.gold -= entry.price;
  addItem(c.inventory, entry.item, 1);
  refresh();
  return 'bought';
}
function sell(entry: ShopEntry): SellResult {
  const c = session.character;
  const copies = countItem(c.inventory, entry.item);
  if (c.equipment.weapon === entry.item && copies <= 1) return 'none';
  if (!removeItem(c.inventory, entry.item, 1)) return 'none';
  c.gold += sellPrice(entry, marco.shop);
  changeStock(entry, session.shopStock, 'marco', session.playTimeSeconds, -1);
  refresh();
  return 'sold';
}
function upgradeItem(itemId: string): UpgradeResult | 'inCombat' {
  if (session.inCombat) return 'inCombat';
  const result = applyUpgrade(items.get(itemId) as any, session.character);
  refresh();
  return result;
}
function chooseSpell(slot: number, spellId: string): void {
  const c = session.character;
  const next = setSlot(
    c.spellLoadout,
    slot,
    spellId,
    usableKnown(),
    staffSlots(),
    session.inCombat,
  );
  if (!next) {
    say(i18n.t('spellbook.inCombat'));
    return;
  }
  c.spellLoadout = next;
  applyWeapon();
  overlays.refreshTop();
  refresh();
}

// ----------------------------------------------------------------- S.2: controller test

const pc: any = (playerJson as any).controls ?? {};
const inputSurface = document.createElement('div');
const input = new Input(
  inputSurface,
  {
    joystickRadiusPx: pc.joystickRadiusPx ?? 56,
    joystickDeadZone: pc.joystickDeadZone ?? 0.12,
    rotateRadiansPerPixelMouse: 0.003,
    rotateRadiansPerPixelTouch: 0.004,
    zoomStepPerWheelNotch: 0.1,
    joystickZoneWidth: 0.45,
    joystickZoneTop: 0.5,
  },
  bindings,
  pads,
);
input.attach();
const lookTotal = { yaw: 0, pitch: 0, zoom: 1 };
const lookTmp = { yaw: 0, pitch: 0, zoom: 1 };
const moveTmp = { x: 0, y: 0 };
let pauseCount = 0;
input.onPausePressed = () => {
  pauseCount++;
};

/** Why the Gamepad API cannot be used here, or '' when it can. */
function padApiProblem(): string {
  if (typeof navigator.getGamepads !== 'function') return 'api';
  try {
    navigator.getGamepads();
  } catch {
    return 'blocked';
  }
  const policy: any = (document as any).featurePolicy ?? (document as any).permissionsPolicy;
  if (policy?.allowsFeature && !policy.allowsFeature('gamepad')) return 'blocked';
  return '';
}

let padUpdate: (() => void) | null = null;
let lastFrame = performance.now();
function frame(now: number): void {
  const seconds = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  pads.beginFrame(seconds);
  input.consumeLook(lookTmp);
  lookTotal.yaw += lookTmp.yaw;
  lookTotal.pitch += lookTmp.pitch;
  padUpdate?.();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const ACTION_ORDER = bindings.actions;
const actionName = (a: string) => i18n.t(`controls.action.${a}`);

function stickBox(label: string): { root: HTMLElement; dot: HTMLElement; text: HTMLElement } {
  const dot = h('div', { className: 'pt-dot' });
  const text = h('div', { className: 'pt-num' }, '0.00 / 0.00');
  const root = h(
    'div',
    { className: 'pt-stick' },
    h('div', { className: 'pt-ring' }, dot),
    h('div', { className: 'pt-cap' }, label),
    text,
  );
  return { root, dot, text };
}

function padTestPanel(): Panel {
  return {
    closeActions: [],
    build() {
      const problem = padApiProblem();
      const left = stickBox('Linker stick (lopen)');
      const right = stickBox('Rechter stick (camera)');
      const info = h('p', { className: 'pt-status', role: 'status' }, '');
      const cells: { el: HTMLElement; index: number; act: HTMLElement }[] = [];
      const grid = h('div', { className: 'pt-grid' });
      for (let i = 0; i < 16; i++) {
        const act = h('span', { className: 'pt-act' }, '');
        const el = h(
          'div',
          { className: 'pt-btn', 'data-pad': String(i) },
          h('b', {}, i18n.t(`pad.${i}`)),
          act,
        );
        cells.push({ el, index: i, act });
        grid.append(el);
      }
      const actionRows = new Map<string, HTMLElement>();
      const actionList = h('div', { className: 'pt-actions' });
      for (const a of ACTION_ORDER) {
        if (bindings.isDebugOnly(a)) continue;
        const chip = h('span', { className: 'pt-chip', 'data-action': a }, actionName(a));
        actionRows.set(a, chip);
        actionList.append(chip);
      }
      const look = h('div', { className: 'pt-num' }, '');
      const pause = h('div', { className: 'pt-num' }, '');

      const tableRows = ACTION_ORDER.filter((a) => !bindings.isDebugOnly(a)).map((a) => {
        const keys = bindings.codesFor(a).map((c) => keyLabel(c, i18n.t.bind(i18n)));
        const padKeys = bindings.padCodesFor(a).map((c) => keyLabel(c, i18n.t.bind(i18n)));
        return h(
          'tr',
          {},
          h('td', {}, actionName(a)),
          h('td', {}, keys.join(' / ') || '—'),
          h('td', {}, padKeys.join(' / ') || '— (linker stick)'),
        );
      });
      const gp: any = (controlsJson as any).gamepad;

      padUpdate = () => {
        if (!root.isConnected) {
          padUpdate = null;
          return;
        }
        const down = pads.down;
        for (const c of cells) {
          c.el.classList.toggle('pt-on', (down & (1 << c.index)) !== 0);
          const action = bindings.actionForPad(c.index);
          const text = action ? actionName(action) : '—';
          if (c.act.textContent !== text) c.act.textContent = text;
        }
        for (const [a, chip] of actionRows)
          chip.classList.toggle('pt-on', input.isPressed(a as any));
        const mv = input.getMoveVector(moveTmp);
        const place = (box: typeof left, x: number, y: number) => {
          box.dot.style.transform = `translate(${x * 34}px, ${-y * 34}px)`;
          box.text.textContent = `${x.toFixed(2)} / ${y.toFixed(2)}`;
        };
        place(left, mv.x, mv.y);
        place(right, pads.lookX, -pads.lookY);
        look.textContent = `Camera gedraaid: yaw ${lookTotal.yaw.toFixed(2)} rad, pitch ${lookTotal.pitch.toFixed(2)} rad`;
        pause.textContent = `Start (pauze) ingedrukt: ${pauseCount}×`;
        const msg = pads.present
          ? 'Controller gevonden. Druk op knoppen en beweeg de sticks.'
          : 'Nog geen controller gezien. Sluit er een aan (of koppel via Bluetooth) en druk op een knop.';
        if (info.textContent !== msg && !problem) info.textContent = msg;
      };

      const warn = problem
        ? h(
            'p',
            { className: 'pt-warn', role: 'alert' },
            'De Gamepad API werkt niet in dit venster (het artifact-frame blokkeert hem). ' +
              'Open tools/testbank/out/testbank.html lokaal om te testen. De mapping hieronder staat er wel gewoon.',
          )
        : null;

      const root = h(
        'div',
        { className: 'ui-panel pt-panel', role: 'dialog' },
        h('h2', { className: 'ui-heading' }, 'Controllertest'),
        h(
          'p',
          { className: 'ui-note' },
          'Dit is de echte gamepadlaag van het spel (PadHub + Input + Bindings). Wat hier oplicht, doet het ook in het spel.',
        ),
        warn,
        info,
        h('div', { className: 'pt-sticks' }, left.root, right.root),
        h('h3', {}, 'Knoppen'),
        grid,
        h('h3', {}, 'Acties die het spel nu ziet'),
        actionList,
        look,
        pause,
        h(
          'p',
          { className: 'ui-note' },
          `Getallen uit controls.json: dode zone ${gp.deadZone}, trekker telt vanaf ${gp.triggerThreshold}, camera ${gp.lookRadiansPerSecond} rad/s bij vol uitslaan. Start pauzeert altijd en is niet bindbaar.`,
        ),
        h('h3', {}, 'Mapping (uit controls.json en je eigen keuzes)'),
        h(
          'table',
          { className: 'pt-table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', {}, 'Actie'),
              h('th', {}, 'Toets / muis'),
              h('th', {}, 'Controller'),
            ),
          ),
          h('tbody', {}, ...tableRows),
        ),
        h(
          'p',
          { className: 'ui-note' },
          'Andere knop? Open "Besturing (Settings)" links, klik op een controller-vakje en druk op een knop.',
        ),
        h(
          'button',
          { type: 'button', className: 'ui-button', onclick: () => overlays.close() },
          i18n.t('common.close'),
        ),
      );
      return root;
    },
    onClose() {
      padUpdate = null;
    },
  };
}

// ----------------------------------------------------------------- opening the panels

type PanelId = 'forge' | 'shop' | 'spellbook' | 'controls' | 'padtest' | 'lab' | 'sultan';
const labFields: Record<string, unknown> = {};
let openPanel: PanelId | null = null;
function open(which: PanelId): void {
  overlays.closeAll();
  say('');
  openPanel = which;
  const closed = () => {
    openPanel = null;
    renderBench();
  };
  if (which === 'controls') overlays.open(controlsPanel(ctx));
  if (which === 'padtest') overlays.open(padTestPanel());
  if (which === 'sultan')
    overlays.open(sultanPanel(h as any, (f) => (Object.assign(labFields, f), renderBench())));
  if (which === 'lab')
    overlays.open(
      labPanel({
        h: h as any,
        getGold: () => session.character.gold,
        setGold: (n) => {
          session.character.gold = n;
        },
        close: () => overlays.close(),
        onState: (f) => {
          Object.assign(labFields, f);
          renderBench();
        },
      }),
    );
  if (which === 'forge')
    overlays.open(forgePanel(ctx, hilda?.name ?? 'Hilda', upgradeItem, closed));
  if (which === 'shop') {
    overlays.open(
      shopPanel(
        ctx,
        marco.name,
        marco.shop,
        buy,
        sell,
        (entry) => stockLeft(entry, session.shopStock, 'marco', session.playTimeSeconds),
        closed,
      ),
    );
  }
  if (which === 'spellbook') {
    learnSpells();
    overlays.open(
      spellbookPanel(
        ctx,
        {
          slots: staffSlots,
          usable: usableKnown,
          locked: () => session.inCombat,
          choose: chooseSpell,
        },
        closed,
      ),
    );
  }
  renderBench();
}

// ----------------------------------------------------------------- the bench (left column)

const bench = document.getElementById('bench') as HTMLElement;
const state = document.getElementById('state') as HTMLElement;
let lastMessage = '';
function say(text: string): void {
  lastMessage = text;
}
function refresh(): void {
  overlays.refreshTop();
  renderBench();
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, any> = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'className') e.className = v;
    else if (v !== false && v !== undefined) e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null) e.append(c);
  return e;
}
const btn = (label: string, fn: () => void, active = false) =>
  h('button', { type: 'button', className: active ? 'b-btn b-on' : 'b-btn', onclick: fn }, label);
const group = (title: string, ...rows: (Node | null)[]) =>
  h('section', { className: 'b-group' }, h('h3', {}, title), ...rows);
const row = (...c: (Node | string | null)[]) => h('div', { className: 'b-row' }, ...c);

function name(id: string | null): string {
  return id ? (items.get(id)?.name ?? spellDefs.find((s) => s.id === id)?.name ?? id) : '—';
}

function renderBench(): void {
  const c = session.character;
  const weapons = c.inventory.filter((s) => items.get(s.item)?.weapon).map((s) => s.item);
  const mins = Math.floor(session.playTimeSeconds / 60);

  bench.replaceChildren(
    group(
      'Open een scherm',
      row(
        btn('Forge (Hilda)', () => open('forge'), openPanel === 'forge'),
        btn('Winkel (Marco)', () => open('shop'), openPanel === 'shop'),
        btn('Spellboek', () => open('spellbook'), openPanel === 'spellbook'),
      ),
    ),
    group(
      'Stappen S.3 t/m S.8 – Souls-like gevecht',
      row(
        btn('Gevechtslab', () => open('lab'), openPanel === 'lab'),
        btn('Sultan-lab (S.8)', () => open('sultan'), openPanel === 'sultan'),
      ),
      h(
        'p',
        { className: 'b-hint' },
        'Rol, blok en parry, stamina, poise, aanvalsfases en gold bij je lijk met de echte regels en data. 60 Hz naast 120 Hz.',
      ),
    ),
    group(
      'Stap S.2 – Gamepad',
      row(
        btn('Controllertest', () => open('padtest'), openPanel === 'padtest'),
        btn('Besturing (Settings)', () => open('controls'), openPanel === 'controls'),
      ),
      row(
        btn(
          'Standaard knoppen terug',
          () => (bindings.resetToDefaults(), saveBindings(), refresh()),
        ),
      ),
      h(
        'p',
        { className: 'b-hint' },
        'Controllertest werkt alleen met een echte controller; zonder zie je de mapping als tabel.',
      ),
    ),
    group(
      'Taal',
      row(
        btn('English', () => setLang('en'), i18n.language === 'en'),
        btn('Nederlands', () => setLang('nl'), i18n.language === 'nl'),
      ),
    ),
    group(
      'Spullen',
      row(
        btn('+100 Gold', () => ((c.gold += 100), refresh())),
        btn('Gold op 0', () => ((c.gold = 0), refresh())),
        btn('+1 Slime Gel', () => (addItem(c.inventory, 'slime_gel', 1), refresh())),
      ),
    ),
    group(
      'Wapen in je hand',
      row(
        ...weapons.map((id) =>
          btn(
            `${name(id)}${items.get(id)?.weapon?.spellSlots ? ` (${items.get(id)!.weapon.spellSlots} slot)` : ''}`,
            () => ((c.equipment.weapon = id), applyWeapon(), refresh()),
            c.equipment.weapon === id,
          ),
        ),
      ),
      h('p', { className: 'b-hint' }, 'De Adept Staff (2 slots) koop je bij Marco.'),
    ),
    group(
      'Kristal in je staf',
      row(
        btn('geen', () => setCrystal(null), c.crystal === null),
        ...elements.map((e) => btn(e, () => setCrystal(e), c.crystal === e)),
      ),
    ),
    group(
      `Level ${session.level}`,
      row(
        btn('−1', () => setLevel(session.level - 1)),
        btn('+1', () => setLevel(session.level + 1)),
        btn('Level 5', () => setLevel(5)),
      ),
      h('p', { className: 'b-hint' }, 'Vanaf level 5 leer je de tweede spell van je element.'),
    ),
    group(
      `Speeltijd ${mins} min`,
      row(
        btn('+10 min', () => ((session.playTimeSeconds += 600), refresh())),
        btn('+30 min', () => ((session.playTimeSeconds += 1800), refresh())),
      ),
      h('p', { className: 'b-hint' }, 'Marco vult 1 stuk gear aan per 10 min, de staf per 30 min.'),
    ),
    group(
      'Gevecht',
      row(
        btn(
          session.inCombat ? 'In gevecht' : 'Buiten gevecht',
          () => ((session.inCombat = !session.inCombat), refresh()),
          session.inCombat,
        ),
      ),
      h('p', { className: 'b-hint' }, 'In gevecht mag upgraden en spells wisselen niet.'),
    ),
    group('', row(btn('Alles terug naar begin', reset))),
    h('p', { className: 'b-msg', role: 'status' }, lastMessage),
  );

  // What the game would save, plus what follows from it.
  const weaponDef = items.get(c.equipment.weapon ?? '');
  const gear = { hp: 0, mana: 0, damagePercent: 0, damageReductionPercent: 0, moveSpeedPercent: 0 };
  for (const [id, level] of Object.entries(c.upgrades)) {
    const def = items.get(id);
    if (def && !def.weapon) addUpgradeStats(def as any, level, gear);
  }
  const lines: [string, string][] = [
    ['Gold', String(c.gold)],
    ['Tas', c.inventory.map((s) => `${name(s.item)} ×${s.count}`).join(', ')],
    ['Wapen', name(c.equipment.weapon)],
    [
      'Schade-bonus wapen',
      weaponDef?.weapon ? `+${effectiveDamageBonus(weaponDef as any, c.upgrades)}` : '—',
    ],
    ['Gear-bonus (Forge)', `+${gear.hp} hp, +${gear.damageReductionPercent}% reductie`],
    ['Geleerde spells', c.spells.map(name).join(', ') || '—'],
    [
      'Controller (pad:…)',
      bindings.actions
        .filter((a) => !bindings.isDebugOnly(a))
        .map((a) => `${a}=${bindings.padCodesFor(a).join('+') || '—'}`)
        .join(', '),
    ],
    ['Spell op cast-knop', staffSlots() > 0 ? name(activeSpell(c.spellLoadout)) : '— (geen staf)'],
  ];
  state.replaceChildren(
    h('h3', {}, 'Per stap: proberen en zien (pc en controller)'),
    h(
      'ul',
      {},
      h(
        'li',
        {},
        h('strong', {}, 'S.2 Gamepad'),
        ' — Proberen: ',
        'Controllertest openen en een echte controller aansluiten; Besturing (Settings) openen.',
        ' Zien: ',
        'Sticks en knoppen bewegen live met hun actie; de mapping klopt met controls.json. Zonder controller: de tabel.',
      ),
      h(
        'li',
        {},
        h('strong', {}, 'S.3 Stamina'),
        ' — Proberen: ',
        'Gevechtslab: slaan tot de energie op is.',
        ' Zien: ',
        'Kosten per actie uit player.json; bij 0 uitgeput, herstel pas na de pauze.',
      ),
      h(
        'li',
        {},
        h('strong', {}, 'S.4 Rol met onkwetsbare frames'),
        ' — Proberen: ',
        'Gevechtslab: rol vlak voor een aanval; kijk naar de scan 60 versus 120 Hz.',
        ' Zien: ',
        'Een aanval binnen het venster mist, erbuiten raakt; 60 en 120 Hz gelijk.',
      ),
      h(
        'li',
        {},
        h('strong', {}, 'S.4b Gold bij je lijk'),
        ' — Proberen: ',
        'Gevechtslab, kaart: Sterf, loop erheen; sterf nog eens voor je het ophaalt.',
        ' Zien: ',
        "Gold ligt op de plek van je dood, ophalen geeft het terug, een tweede dood vervangt de markering; zie goldMarker onder 'Wat het spel zou opslaan'.",
      ),
      h(
        'li',
        {},
        h('strong', {}, 'S.5a/b Aanvalsfases en aankondiging'),
        ' — Proberen: ',
        'Gevechtslab: kies Green Slime of Goblin en start een aanval.',
        ' Zien: ',
        'Aankondiging, raakvenster en herstel op de tijdlijn met de duur uit data; schade valt alleen in het raakvenster.',
      ),
      h(
        'li',
        {},
        h('strong', {}, 'S.6 Poise en stagger'),
        ' — Proberen: ',
        'Gevechtslab: zware en kritieke slagen, schuif het gedragen gewicht.',
        ' Zien: ',
        'De vijand wankelt als zijn poise breekt; meer gewicht geeft jou meer poise.',
      ),
      h(
        'li',
        {},
        h('strong', {}, 'S.7 Blokkeren en parry'),
        ' — Proberen: ',
        'Gevechtslab: houd blok vast (R) en laat een aanval komen.',
        ' Zien: ',
        'Goed getimed: parry (alles afgevangen, vijand wankelt); anders blok met 30% schade en energiekosten; bij 0 energie breekt het blok.',
      ),
      h(
        'li',
        {},
        h('strong', {}, 'S.8 Sultan'),
        ' — Proberen: ',
        'Sultan-lab: speler staat stil, speler rolt weg, kwaad aan/uit.',
        ' Zien: ',
        'Alle vier de aanvallen raken alleen in hun raakvenster; een rollende speler krijgt 0 schade; 60 en 120 Hz geven dezelfde aanvallen.',
      ),
    ),
    h('h3', {}, 'Alleen in het spel te zien'),
    h(
      'ul',
      {},
      h(
        'li',
        {},
        'S.2: lopen, camera draaien, lock-on, slaan en rollen met een echte controller in de 3D-wereld: start het spel (npm run dev of GitHub Pages) en pak je controller.',
      ),
      h(
        'li',
        {},
        'S.2: de knophints in teksten (A, RB, …) die verschijnen nadat je een controller gebruikt hebt: in het spel zelf, bij gesprekken en tips.',
      ),
      h('li', {}, 'S.2: Start = pauze in de wereld; hier telt de Controllertest hem alleen.'),
      h(
        'li',
        {},
        'S.4: het echte rollen (afstand, richting volgt lock-on, camera) en de onkwetsbaarheid zelf zie je pas in de wereld; het Gevechtslab toont alleen het venster.',
      ),
      h(
        'li',
        {},
        'S.4b: de gouden markering als toon-object op de plek waar je viel, en het wakker worden na je dood: in de wereld (sterf en loop terug).',
      ),
      h(
        'li',
        {},
        'S.5a/S.5b: de echte aankondiging-cues op de grond (schijf, lijn, gebied) bij Green Slime en Goblin in de wereld; hier alleen een schetsje met dezelfde duur.',
      ),
      h(
        'li',
        {},
        'S.6: de wankel-animatie van vijanden en de poise-balk van de HUD (verschijnt bij minder dan vol): in de wereld.',
      ),
      h(
        'li',
        {},
        'S.7: het blokken zelf (toets R / L3), animatie en geluid: in de wereld; er is nog geen guard-animatie of HUD-indicator.',
      ),
      h(
        'li',
        {},
        'S.8: Sultan zelf (model, de sprong, de run, de rode lijn en de cues op de grond) en of hij eerlijk en leesbaar voelt: de bosgevechtsarena in het spel (poort bij de Greenwood). S.9 is nog niet gebouwd.',
      ),
    ),
    h('h3', {}, 'Wat het spel zou opslaan'),
    h('dl', {}, ...lines.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h(
      'pre',
      {},
      JSON.stringify(
        {
          'settings.keybindings': session.settings.keybindings,
          goldMarker: (labFields as any).goldMarker ?? null,
          sultanLab: (labFields as any).sultanLab ?? null,
          'character.upgrades': c.upgrades,
          'character.spellLoadout': c.spellLoadout,
          shopStock: session.shopStock,
        },
        null,
        2,
      ),
    ),
  );
}

function saveBindings(): void {
  session.settings.keybindings = bindings.toSave() as Record<string, string[]>;
}
function setLang(lang: 'en' | 'nl'): void {
  i18n.setStrings(lang, lang === 'en' ? en : nl, en);
  events.emit('languageChanged');
  renderBench();
}
function setCrystal(element: string | null): void {
  const c = session.character;
  c.crystal = element;
  // The Crystal Ceremony gives the element's first spell (the one without learnLevel).
  const first = spellDefs.find((s) => s.element === element && s.learnLevel === undefined);
  if (first && !c.spells.includes(first.id)) c.spells.push(first.id);
  applyWeapon();
  refresh();
}
function setLevel(level: number): void {
  session.level = Math.max(1, Math.min(30, level));
  applyWeapon();
  refresh();
}
function reset(): void {
  const lang = i18n.language;
  session = freshSession();
  bindings.resetToDefaults();
  applyWeapon();
  setLang(lang as 'en' | 'nl');
  if (openPanel) open(openPanel);
  else refresh();
}

applyWeapon();
open('forge');
