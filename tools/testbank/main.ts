// Morning test bench (tools/testbank/README.md). Tonight: steps 4.1 (Forge), 4.2 (shops) and 4.3 (spellbook).
// The panels, rules, data and texts are the real ones; only the world around them is faked,
// copied from WorldState (buy, sell, upgradeItem, chooseSpell, applyWeapon, learnSpells).
import '../../docs/art-style/tokens.css';
import '../../src/ui/ui.css';
import './bench.css';

import itemsJson from '../../public/data/items.json';
import npcsJson from '../../public/data/npcs.json';
import spellsJson from '../../public/data/spells.json';
import en from '../../public/lang/en.json';
import nl from '../../public/lang/nl.json';

import { I18n } from '../../src/i18n/I18n';
import { Overlays } from '../../src/ui/Overlays';
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

const stage = document.getElementById('app') as HTMLElement;
const overlays = new Overlays(stage, events as any, i18n);
const ctx: any = {
  i18n,
  overlays,
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

// ----------------------------------------------------------------- opening the panels

let openPanel: 'forge' | 'shop' | 'spellbook' | null = null;
function open(which: 'forge' | 'shop' | 'spellbook'): void {
  overlays.closeAll();
  say('');
  openPanel = which;
  const closed = () => {
    openPanel = null;
    renderBench();
  };
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
    ['Spell op cast-knop', staffSlots() > 0 ? name(activeSpell(c.spellLoadout)) : '— (geen staf)'],
  ];
  state.replaceChildren(
    h('h3', {}, 'Wat het spel zou opslaan'),
    h('dl', {}, ...lines.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h(
      'pre',
      {},
      JSON.stringify(
        {
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
  applyWeapon();
  setLang(lang as 'en' | 'nl');
  if (openPanel) open(openPanel);
  else refresh();
}

applyWeapon();
open('forge');
