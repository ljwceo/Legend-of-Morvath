import { describe, expect, it } from 'vitest';
import { itemsFileSchema, playerFileSchema, spellsFileSchema } from '../data/schemas';
import type { ItemDef, ItemsFile, PlayerConfig, SpellsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { knownIncantations } from './Grimoire';
import { cycle, cycleSpellSlot, selectedSpell } from './Loadout';
import {
  createSlotUpgrades,
  eligibleWeapons,
  grantSlotUpgrade,
  grimoireSlots,
  incantationCapacity,
  isPreparableWeapon,
  normalizePrepared,
  normalizeSlotUpgrades,
  preparedAfterEquip,
  preparedIds,
  setPrepared,
  weaponCapacity,
} from './Prepared';
import { EMPTY_SLOT } from './Spellbook';

const items = itemsFileSchema.parse(readPublicJson('data/items.json')) as ItemsFile;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
const byId = new Map<string, ItemDef>(items.items.map((item) => [item.id, item]));
const BASE = player.prepared.mainWeapons;

const bag = [
  { item: 'mage_staff', count: 1 },
  { item: 'old_sword', count: 1 },
  { item: 'health_potion', count: 7 },
  { item: 'goblin_cleaver', count: 1 },
  { item: 'rookie_grimoire', count: 1 },
  { item: 'academy_blade', count: 1 },
];

describe('Prepared (G.5): capacity', () => {
  it('the base is two main weapons; a Weapon Harness Upgrade adds one, each id once', () => {
    const upgrades = createSlotUpgrades();
    expect(weaponCapacity(BASE, upgrades)).toBe(2);
    expect(grantSlotUpgrade(upgrades, 'weaponHarness', 'harness_greenwood')).toBe(true);
    expect(grantSlotUpgrade(upgrades, 'weaponHarness', 'harness_greenwood')).toBe(false);
    expect(grantSlotUpgrade(upgrades, 'weaponHarness', '')).toBe(false);
    expect(weaponCapacity(BASE, upgrades)).toBe(3);
    expect(upgrades.grimoirePages).toEqual([]);
  });

  it('the Rookie Grimoire gives one incantation slot; a Grimoire Page adds one; no Grimoire, none', () => {
    const upgrades = createSlotUpgrades();
    expect(grimoireSlots(bag, byId)).toBe(1);
    expect(incantationCapacity(bag, byId, upgrades)).toBe(1);
    // The shared Academy slot of G.7 is a page with its own id: the same mechanism, once.
    expect(grantSlotUpgrade(upgrades, 'grimoirePages', 'academy_second_slot')).toBe(true);
    expect(grantSlotUpgrade(upgrades, 'grimoirePages', 'academy_second_slot')).toBe(false);
    expect(incantationCapacity(bag, byId, upgrades)).toBe(2);
    expect(incantationCapacity([{ item: 'old_sword', count: 1 }], byId, upgrades)).toBe(0);
    expect(incantationCapacity([{ item: 'rookie_grimoire', count: 0 }], byId, upgrades)).toBe(0);
  });

  it('upgrade ids from a save are kept once and as strings only', () => {
    expect(
      normalizeSlotUpgrades({
        weaponHarness: ['a', 'a', '' as string, 3 as unknown as string],
        grimoirePages: ['p'],
      }),
    ).toEqual({ weaponHarness: ['a'], grimoirePages: ['p'] });
  });
});

describe('Prepared: main weapons', () => {
  it('only owned, non-legacy melee weapons can be prepared: no staff, no potion, no Grimoire', () => {
    expect(eligibleWeapons(bag, byId)).toEqual(['old_sword', 'goblin_cleaver', 'academy_blade']);
    expect(isPreparableWeapon(byId.get('mage_staff'))).toBe(false);
    expect(isPreparableWeapon(byId.get('adept_staff'))).toBe(false);
    expect(isPreparableWeapon(byId.get('health_potion'))).toBe(false);
    expect(isPreparableWeapon(byId.get('rookie_grimoire'))).toBe(false);
    expect(isPreparableWeapon(byId.get('chiefs_greatblade'))).toBe(true);
    expect(isPreparableWeapon(undefined)).toBe(false);
  });

  it('never chosen: the weapon in your hands first, then the bag in order, up to the capacity', () => {
    const eligible = eligibleWeapons(bag, byId);
    expect(normalizePrepared([], eligible, 2, 'goblin_cleaver')).toEqual([
      'goblin_cleaver',
      'old_sword',
    ]);
    expect(normalizePrepared([], eligible, 2, 'mage_staff')).toEqual([
      'old_sword',
      'goblin_cleaver',
    ]);
    expect(normalizePrepared([], eligible, 3)).toEqual(eligible);
    expect(normalizePrepared([], eligible, 4)).toEqual([...eligible, EMPTY_SLOT]);
    expect(normalizePrepared([], [], 2)).toEqual([EMPTY_SLOT, EMPTY_SLOT]);
  });

  it('a chosen list keeps its slots; what you no longer own, a duplicate or a staff falls out', () => {
    const eligible = eligibleWeapons(bag, byId);
    expect(normalizePrepared(['academy_blade', 'old_sword'], eligible, 2)).toEqual([
      'academy_blade',
      'old_sword',
    ]);
    expect(normalizePrepared(['chiefs_greatblade', 'old_sword'], eligible, 2)).toEqual([
      EMPTY_SLOT,
      'old_sword',
    ]);
    expect(normalizePrepared(['old_sword', 'old_sword'], eligible, 2)).toEqual([
      'old_sword',
      EMPTY_SLOT,
    ]);
    expect(normalizePrepared(['mage_staff', EMPTY_SLOT], eligible, 2)).toEqual([
      EMPTY_SLOT,
      EMPTY_SLOT,
    ]);
    // More capacity than stored: the new slot is empty; less: the view shows what fits.
    expect(normalizePrepared(['old_sword', 'academy_blade'], eligible, 3)).toEqual([
      'old_sword',
      'academy_blade',
      EMPTY_SLOT,
    ]);
    expect(normalizePrepared(['old_sword', 'academy_blade'], eligible, 1)).toEqual(['old_sword']);
  });

  it('filling a slot outside a fight moves a weapon that sat elsewhere; a fight refuses', () => {
    const eligible = eligibleWeapons(bag, byId);
    const prepared = ['old_sword', 'goblin_cleaver'];
    expect(setPrepared(prepared, 1, 'academy_blade', eligible, 2, false)).toEqual([
      'old_sword',
      'academy_blade',
    ]);
    expect(setPrepared(prepared, 1, 'old_sword', eligible, 2, false)).toEqual([
      EMPTY_SLOT,
      'old_sword',
    ]);
    expect(setPrepared(prepared, 0, EMPTY_SLOT, eligible, 2, false)).toEqual([
      EMPTY_SLOT,
      'goblin_cleaver',
    ]);
    expect(setPrepared(prepared, 1, 'academy_blade', eligible, 2, true)).toBeNull();
    expect(setPrepared(prepared, 2, 'academy_blade', eligible, 2, false)).toBeNull();
    expect(setPrepared(prepared, 0, 'mage_staff', eligible, 2, false)).toBeNull();
    expect(setPrepared(prepared, 0, 'chiefs_greatblade', eligible, 2, false)).toBeNull();
    expect(prepared).toEqual(['old_sword', 'goblin_cleaver']);
  });

  it('the fight cycles only through the prepared, owned weapons', () => {
    const list = preparedIds(['old_sword', EMPTY_SLOT, 'academy_blade']);
    expect(list).toEqual(['old_sword', 'academy_blade']);
    expect(cycle(list, 'old_sword', 1)).toBe('academy_blade');
    expect(cycle(list, 'academy_blade', 1)).toBe('old_sword');
    // A staff in hand (put on outside the fight) is not in the list: the first prepared comes.
    expect(cycle(list, 'mage_staff', 1)).toBe('old_sword');
    expect(cycle([], 'old_sword', 1)).toBeNull();
  });

  it('putting a weapon on outside a fight keeps it prepared; a staff never enters a slot', () => {
    const eligible = eligibleWeapons(bag, byId);
    // Replaces the slot of the weapon it took over from.
    expect(
      preparedAfterEquip(
        ['old_sword', 'goblin_cleaver'],
        'goblin_cleaver',
        'academy_blade',
        eligible,
        2,
      ),
    ).toEqual(['old_sword', 'academy_blade']);
    // Already prepared: nothing to store.
    expect(
      preparedAfterEquip(
        ['old_sword', 'goblin_cleaver'],
        'old_sword',
        'goblin_cleaver',
        eligible,
        2,
      ),
    ).toBeNull();
    // The previous weapon was not prepared (a staff): the first empty slot, else the first slot.
    expect(
      preparedAfterEquip(['old_sword', EMPTY_SLOT], 'mage_staff', 'academy_blade', eligible, 2),
    ).toEqual(['old_sword', 'academy_blade']);
    expect(
      preparedAfterEquip(
        ['old_sword', 'goblin_cleaver'],
        'mage_staff',
        'academy_blade',
        eligible,
        2,
      ),
    ).toEqual(['academy_blade', 'goblin_cleaver']);
    expect(
      preparedAfterEquip(['old_sword', 'goblin_cleaver'], 'old_sword', 'mage_staff', eligible, 2),
    ).toBeNull();
    expect(preparedAfterEquip([], null, 'old_sword', eligible, 0)).toBeNull();
  });
});

describe('Prepared: incantations', () => {
  const known = knownIncantations(spells, [], [], []);

  it('a new character prepares Push in its one slot, by itself', () => {
    expect(known).toEqual(['push']);
    const prepared = normalizePrepared(
      [],
      known,
      incantationCapacity(bag, byId, createSlotUpgrades()),
    );
    expect(prepared).toEqual(['push']);
    expect(selectedSpell(prepared, 0)).toBe('push');
  });

  it('learning more never adds a slot: known is unlimited, prepared is the capacity', () => {
    const learned = ['push', 'ember', 'tide', 'gale', 'bramble'];
    expect(normalizePrepared([], learned, 1)).toEqual(['push']);
    // A second slot (the Academy's Grimoire Page) lets one more known incantation in.
    expect(normalizePrepared([], learned, 2)).toEqual(['push', 'ember']);
    expect(setPrepared(['push'], 0, 'gale', learned, 1, false)).toEqual(['gale']);
    expect(setPrepared(['push', 'ember'], 1, 'gale', learned, 2, false)).toEqual(['push', 'gale']);
  });

  it('refuses what is not known, not learned, element-locked or without a Grimoire', () => {
    expect(setPrepared(['push'], 0, 'ember', known, 1, false)).toBeNull();
    // Without a Grimoire the capacity is 0: nothing can be prepared, so nothing can be cast.
    expect(normalizePrepared(['push'], known, 0)).toEqual([]);
    expect(setPrepared(['push'], 0, 'push', known, 0, false)).toBeNull();
    expect(selectedSpell([], 0)).toBeNull();
  });

  it('the fight cycles through the prepared slots only', () => {
    const prepared = ['push', EMPTY_SLOT, 'gale'];
    expect(cycleSpellSlot(prepared, 0, 1)).toBe(2);
    expect(cycleSpellSlot(prepared, 2, 1)).toBe(0);
    expect(selectedSpell(prepared, 1)).toBe('push');
  });
});
