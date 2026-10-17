import type { GameContext } from '../../core/GameContext';
import { EMPTY_SLOT, normalizeLoadout } from '../../systems/Spellbook';
import { button, el } from '../dom';
import type { Panel } from '../Overlays';
import { bindT } from './ConfirmPanel';
import { type CrystalSummary, crystalLine } from './crystalText';

/** What the spellbook needs from the world (the world keeps the rules). */
export interface SpellbookHandlers {
  /** How many spell slots the equipped staff has; 0 for a sword or no weapon. */
  slots(): number;
  /** Puts a spell (or '' for nothing) in a slot; the world refuses it in a fight. */
  choose(slot: number, spellId: string): void;
  /** The known spells that fit your crystal's element. */
  usable(): string[];
  /** True in a fight: you can look, but not change. */
  locked(): boolean;
  /** The crystal in the staff (its size changes your damage and spells), or null. */
  crystal(): CrystalSummary | null;
}

/**
 * The spellbook (step 4.3): one row per slot of your staff, each with the spells you know to
 * pick from. Changing is only possible outside a fight. The first filled slot is the spell the
 * cast button fires.
 */
export function spellbookPanel(
  ctx: GameContext,
  handlers: SpellbookHandlers,
  onClose: () => void,
): Panel {
  return {
    build: () => {
      const { t } = bindT(ctx);
      const character = ctx.session?.character;
      const defs = ctx.data?.spells.spells ?? [];
      const known = handlers.usable();
      const slots = handlers.slots();
      const locked = handlers.locked();
      const loadout = normalizeLoadout(character?.spellLoadout ?? [], known, slots);
      const root = el(
        'div',
        {
          className: 'ui-panel ui-menu ui-spellbook',
          attrs: { role: 'dialog', 'aria-label': t('spellbook.title') },
        },
        el('h2', { className: 'ui-heading', text: t('spellbook.title') }),
      );
      const crystal = handlers.crystal();
      if (crystal) root.append(el('p', { className: 'ui-note', text: crystalLine(t, crystal) }));
      const note = (key: string): HTMLElement => el('p', { className: 'ui-note', text: t(key) });
      if (slots === 0) root.append(note('spellbook.noStaff'));
      else if (known.length === 0) root.append(note('spellbook.noSpells'));
      else {
        for (let i = 0; i < slots; i++) {
          const row = el('div', { className: 'ui-spellbook-slot' });
          row.append(el('p', { className: 'ui-note', text: t('spellbook.slot', { n: i + 1 }) }));
          const options = [EMPTY_SLOT, ...known];
          for (const id of options) {
            const label =
              id === EMPTY_SLOT
                ? t('spellbook.empty')
                : (defs.find((s) => s.id === id)?.name ?? id);
            const b = button(label, () => handlers.choose(i, id), loadout[i] === id);
            b.disabled = locked;
            b.setAttribute('aria-pressed', String(loadout[i] === id));
            row.append(b);
          }
          root.append(row);
        }
        root.append(note(locked ? 'spellbook.inCombat' : 'spellbook.hint'));
      }
      root.append(button(t('common.close'), () => ctx.overlays.close()));
      return root;
    },
    onClose,
  };
}
