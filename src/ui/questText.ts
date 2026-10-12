import type { GameData, QuestDef, QuestObjective } from '../data/types';
import type { ItemStack } from '../systems/Inventory';
import { type ObjectiveProgress, type QuestBook } from '../systems/Quests';
import type { ChecklistRow } from './Dialog';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** A running quest for the bag: its name (English, from data) and its objectives. */
export interface QuestSummary {
  name: string;
  rows: ChecklistRow[];
}

/**
 * Turns quest objectives into translated rows ("Bring Slime Gel to Hilda Ironhand 2/3").
 * Names of NPCs, items and monsters come from the data and stay English (CLAUDE.md §2.6).
 */
export class QuestTexts {
  private readonly npcNames: ReadonlyMap<string, string>;
  private readonly itemNames: ReadonlyMap<string, string>;
  private readonly monsterNames: ReadonlyMap<string, string>;
  private readonly p: ObjectiveProgress = { have: 0, need: 0 };

  constructor(
    data: GameData,
    private readonly t: Translate,
  ) {
    this.npcNames = new Map(data.npcs.npcs.map((npc) => [npc.id, npc.name]));
    this.itemNames = new Map(data.items.items.map((item) => [item.id, item.name]));
    this.monsterNames = new Map(
      data.monsters.monsters.map((monster) => [monster.id, monster.name]),
    );
  }

  npcName(id: string | undefined): string {
    return id === undefined ? '' : (this.npcNames.get(id) ?? id);
  }

  itemName(id: string): string {
    return this.itemNames.get(id) ?? id;
  }

  /** One row per objective of a quest. */
  rows(book: QuestBook, def: QuestDef, bag: readonly ItemStack[]): ChecklistRow[] {
    return def.objectives.map((objective, i) => {
      const p = book.progress(def, i, bag, this.p);
      return { text: this.objective(objective, p), done: p.have >= p.need };
    });
  }

  /** Only the objectives that are not done yet (for a short HUD message). */
  firstOpenRow(book: QuestBook, def: QuestDef, bag: readonly ItemStack[]): string {
    const rows = this.rows(book, def, bag);
    return (rows.find((row) => !row.done) ?? rows[rows.length - 1])?.text ?? '';
  }

  /** All running quests with their objectives (for the bag). */
  summaries(book: QuestBook, bag: readonly ItemStack[]): QuestSummary[] {
    return book.activeDefs().map((def) => ({ name: def.name, rows: this.rows(book, def, bag) }));
  }

  private objective(objective: QuestObjective, p: ObjectiveProgress): string {
    const { t } = this;
    const counts = { have: p.have, need: p.need };
    switch (objective.type) {
      case 'talk':
        return t('quest.ui.objective.talk', { npc: this.npcName(objective.npc) });
      case 'find':
        return t('quest.ui.objective.find', { item: this.itemName(objective.item), ...counts });
      case 'deliver':
        return t('quest.ui.objective.deliver', {
          item: this.itemName(objective.item),
          npc: this.npcName(objective.npc),
          ...counts,
        });
      case 'kill':
        return t('quest.ui.objective.kill', {
          monster: this.monsterNames.get(objective.monster) ?? objective.monster,
          ...counts,
        });
      case 'boss':
        return t('quest.ui.objective.boss', {
          monster: this.monsterNames.get(objective.monster) ?? objective.monster,
        });
      case 'buy':
        return t('quest.ui.objective.buy', { item: this.itemName(objective.item), ...counts });
      case 'rest':
      case 'visit':
      case 'choosePath':
        return t(objective.text);
    }
  }
}
