import type { GameContext } from '../../core/GameContext';
import type { FlaskState } from '../../systems/Flasks';
import { EMPTY_SLOT } from '../../systems/Spellbook';
import { button, el } from '../dom';
import type { Panel } from '../Overlays';
import { itemNameEl } from './BagPanel';
import { bindT } from './ConfirmPanel';

/** One prepared set as the panel shows it: the slots, what fits in them, and where the capacity comes from. */
export interface PreparedView {
  /** One entry per slot (`EMPTY_SLOT` for an empty one), already made to fit. */
  prepared: readonly string[];
  /** The ids that may go in a slot (owned, preparable weapons; known incantations). */
  eligible: readonly string[];
  capacity: number;
  /** The base part of the capacity (player.json, or the Grimoire's own slots). */
  base: number;
  /** The permanent upgrades counted in (Weapon Harness Upgrades, Grimoire Pages). */
  upgrades: number;
}

/** What the loadout panel needs from the world (the world keeps the rules). */
export interface LoadoutHandlers {
  /** True in a fight: you can look, but not change. */
  locked(): boolean;
  weapons(): PreparedView;
  /** Puts a weapon (or `EMPTY_SLOT`) in a slot; the world refuses it in a fight. */
  setWeapon(slot: number, itemId: string): void;
  /** `capacity` 0 means no Grimoire in the bag. */
  incantations(): PreparedView;
  setIncantation(slot: number, incantationId: string): void;
  flasks(): FlaskState;
}

/**
 * The loadout (G.5): which main weapons and which incantations are prepared, so a fight can
 * switch between them. One row per slot with everything that fits to pick from, like the
 * spellbook of step 4.3; the capacity line says where the slots come from. Changing is only
 * possible outside a fight; the Flasks are shown, their split changes at a checkpoint rest.
 * Reached from the pause menu and from the bag; the game pauses while it is open.
 */
export function loadoutPanel(
  ctx: GameContext,
  handlers: LoadoutHandlers,
  onClose: () => void,
): Panel {
  return {
    build: () => {
      const { t } = bindT(ctx);
      const data = ctx.data;
      const items = new Map(data?.items.items.map((item) => [item.id, item]) ?? []);
      const incantationDefs = data?.spells.incantations ?? [];
      const locked = handlers.locked();
      const root = el(
        'div',
        {
          className: 'ui-panel ui-menu ui-loadout-panel',
          attrs: { role: 'dialog', 'aria-label': t('loadout.title') },
        },
        el('h2', { className: 'ui-heading', text: t('loadout.title') }),
        el('p', { className: 'ui-note', text: t('loadout.hint') }),
      );
      const note = (text: string): HTMLElement => el('p', { className: 'ui-note', text });
      const rows = (
        view: PreparedView,
        label: (id: string) => HTMLElement | string,
        choose: (slot: number, id: string) => void,
      ): void => {
        for (let i = 0; i < view.capacity; i++) {
          const row = el('div', { className: 'ui-spellbook-slot' });
          row.append(el('p', { className: 'ui-note', text: t('loadout.slot', { n: i + 1 }) }));
          for (const id of [EMPTY_SLOT, ...view.eligible]) {
            const active = view.prepared[i] === id;
            const b = button('', () => choose(i, id), active);
            const content = id === EMPTY_SLOT ? t('loadout.empty') : label(id);
            if (typeof content === 'string') b.textContent = content;
            else b.append(content);
            b.disabled = locked;
            b.setAttribute('aria-pressed', String(active));
            row.append(b);
          }
          root.append(row);
        }
      };

      const weapons = handlers.weapons();
      root.append(el('h3', { className: 'ui-bag-subheading', text: t('loadout.weapons') }));
      root.append(
        note(
          t('loadout.weaponCapacity', {
            n: weapons.capacity,
            base: weapons.base,
            upgrades: weapons.upgrades,
          }),
        ),
      );
      if (weapons.eligible.length === 0) root.append(note(t('loadout.noWeapons')));
      else {
        rows(
          weapons,
          (id) => itemNameEl(ctx, items.get(id), id),
          (slot, id) => handlers.setWeapon(slot, id),
        );
      }

      const incantations = handlers.incantations();
      root.append(el('h3', { className: 'ui-bag-subheading', text: t('loadout.incantations') }));
      if (incantations.capacity === 0) root.append(note(t('loadout.noGrimoire')));
      else {
        root.append(
          note(
            t('loadout.incantationCapacity', {
              n: incantations.capacity,
              base: incantations.base,
              upgrades: incantations.upgrades,
            }),
          ),
        );
        if (incantations.eligible.length === 0) root.append(note(t('loadout.noIncantations')));
        else {
          rows(
            incantations,
            (id) => incantationDefs.find((entry) => entry.id === id)?.name ?? id,
            (slot, id) => handlers.setIncantation(slot, id),
          );
        }
      }

      const flasks = handlers.flasks();
      root.append(el('h3', { className: 'ui-bag-subheading', text: t('bag.flasks') }));
      root.append(
        note(
          t('loadout.flasks', {
            health: flasks.health,
            mana: flasks.mana,
            capacity: flasks.capacity,
            healthLeft: flasks.healthLeft,
            manaLeft: flasks.manaLeft,
          }),
        ),
      );
      if (locked)
        root.append(el('p', { className: 'ui-note ui-note-warn', text: t('loadout.inCombat') }));
      root.append(button(t('common.close'), () => ctx.overlays.close()));
      return root;
    },
    onClose,
  };
}
