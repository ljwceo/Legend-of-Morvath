import type { QuestDef, QuestObjective } from '../data/types';
import type { SaveQuests } from '../save/SaveData';
import { countItem, type ItemStack, removeItem } from './Inventory';

/**
 * Where a quest stands for the player:
 * - locked: its requirements (level, other quests, items) are not met yet,
 * - available: the giver offers it the next time you talk,
 * - active: started, not everything done yet,
 * - ready: everything done, hand it in at the giver,
 * - done: handed in (once only).
 */
export type QuestStatus = 'locked' | 'available' | 'active' | 'ready' | 'done';

/** Counted things that happen in the world (events), matched against objectives. */
export type QuestEventKind = 'talk' | 'kill' | 'boss' | 'buy' | 'rest' | 'visit' | 'path';

/** How far one objective is: `have` of `need` (capped at `need`). */
export interface ObjectiveProgress {
  have: number;
  need: number;
}

type ActiveQuest = SaveQuests['active'][number];

/** What an event means for an objective: its target, or null when the objective does not count it. */
function eventTarget(objective: QuestObjective, kind: QuestEventKind): string | null | undefined {
  if (objective.type !== (kind === 'path' ? 'choosePath' : kind)) return null;
  switch (objective.type) {
    case 'talk':
      return objective.npc;
    case 'kill':
    case 'boss':
      return objective.monster;
    case 'visit':
      return objective.trigger;
    case 'rest':
      // undefined = any checkpoint counts.
      return objective.checkpoint;
    case 'buy':
      return objective.item;
    case 'choosePath':
      // Any path counts (the target is the chosen path).
      return undefined;
    default:
      return null;
  }
}

/** How many an objective needs. */
export function objectiveNeed(objective: QuestObjective): number {
  return 'count' in objective ? objective.count : 1;
}

/**
 * The quest book: quests from quests.json and the player's progress in the save (`quests`,
 * changed in place, so saving needs nothing extra). Pure logic (no DOM, no three.js), tested.
 *
 * Counted objectives (talk, kill, boss, buy, rest, visit) only count after the quest has
 * started. Item objectives (find, deliver) look at the bag, so items you already had count too;
 * delivered items leave the bag when you hand the quest in.
 */
export class QuestBook {
  private readonly byId: ReadonlyMap<string, QuestDef>;
  private readonly completedSet = new Set<string>();

  constructor(
    readonly defs: readonly QuestDef[],
    private readonly save: SaveQuests,
  ) {
    this.byId = new Map(defs.map((def) => [def.id, def]));
    // Quests that no longer exist in the data are forgotten (a data change between versions).
    save.active = save.active.filter((entry) => this.byId.has(entry.id));
    for (const entry of save.active) {
      const def = this.byId.get(entry.id) as QuestDef;
      // Objectives added or removed in the data: keep what fits.
      entry.counts.length = def.objectives.length;
      for (let i = 0; i < entry.counts.length; i++) entry.counts[i] ??= 0;
    }
    for (const id of save.completed) this.completedSet.add(id);
  }

  /** Handed-in quests (for conditions such as "Sultan defeated"). */
  get completed(): ReadonlySet<string> {
    return this.completedSet;
  }

  get(id: string): QuestDef | undefined {
    return this.byId.get(id);
  }

  /** Running quests, in the order they were started. */
  activeDefs(): QuestDef[] {
    return this.save.active.map((entry) => this.byId.get(entry.id) as QuestDef);
  }

  status(id: string, level: number, bag: readonly ItemStack[]): QuestStatus {
    const def = this.byId.get(id);
    if (!def) return 'locked';
    if (this.completedSet.has(id)) return 'done';
    if (this.entry(id)) return this.isReady(def, bag) ? 'ready' : 'active';
    return this.requirementsMet(def, level, bag) ? 'available' : 'locked';
  }

  requirementsMet(def: QuestDef, level: number, bag: readonly ItemStack[]): boolean {
    const r = def.requires;
    if (r.level !== undefined && level < r.level) return false;
    if (r.quests?.some((quest) => !this.completedSet.has(quest))) return false;
    if (r.items?.some((stack) => countItem(bag, stack.item) < stack.count)) return false;
    return true;
  }

  /** Starts a quest. Returns false when it already runs or was handed in. */
  accept(id: string): boolean {
    const def = this.byId.get(id);
    if (!def || this.completedSet.has(id) || this.entry(id)) return false;
    this.save.active.push({ id, counts: def.objectives.map(() => 0) });
    return true;
  }

  /**
   * Something happened in the world (talked to an NPC, defeated a monster, bought an item,
   * rested, walked into a place). Counts it for every running quest that waits for it and
   * returns those quests (in `out`, reused). `source` is the shop's NPC for purchases.
   */
  record(
    kind: QuestEventKind,
    target: string,
    count: number,
    out: QuestDef[],
    source?: string,
  ): QuestDef[] {
    out.length = 0;
    for (const entry of this.save.active) {
      const def = this.byId.get(entry.id) as QuestDef;
      let changed = false;
      for (let i = 0; i < def.objectives.length; i++) {
        const objective = def.objectives[i] as QuestObjective;
        const wanted = eventTarget(objective, kind);
        if (wanted === null || (wanted !== undefined && wanted !== target)) continue;
        // A buy objective can be bound to one shop.
        if (objective.type === 'buy' && objective.npc !== undefined && objective.npc !== source)
          continue;
        const need = objectiveNeed(objective);
        const before = entry.counts[i] ?? 0;
        if (before >= need) continue;
        entry.counts[i] = Math.min(need, before + count);
        changed = true;
      }
      if (changed) out.push(def);
    }
    return out;
  }

  /** How far objective `index` of a quest is (0 of need when it has not started). */
  progress(
    def: QuestDef,
    index: number,
    bag: readonly ItemStack[],
    out: ObjectiveProgress,
  ): ObjectiveProgress {
    const objective = def.objectives[index] as QuestObjective;
    const need = objectiveNeed(objective);
    out.need = need;
    if (objective.type === 'find' || objective.type === 'deliver') {
      out.have = Math.min(need, countItem(bag, objective.item));
    } else {
      out.have = Math.min(need, this.entry(def.id)?.counts[index] ?? 0);
    }
    return out;
  }

  /** Everything done (the quest still has to be handed in). */
  isReady(def: QuestDef, bag: readonly ItemStack[]): boolean {
    const p: ObjectiveProgress = { have: 0, need: 0 };
    for (let i = 0; i < def.objectives.length; i++) {
      this.progress(def, i, bag, p);
      if (p.have < p.need) return false;
    }
    return true;
  }

  /**
   * Hands a ready quest in: delivered items leave the bag, the quest is done. Returns false
   * (and changes nothing) when it is not ready. Rewards are given by the caller.
   */
  complete(id: string, bag: ItemStack[]): boolean {
    const def = this.byId.get(id);
    const entry = this.entry(id);
    if (!def || !entry || !this.isReady(def, bag)) return false;
    for (const objective of def.objectives) {
      if (objective.type === 'deliver') removeItem(bag, objective.item, objective.count);
    }
    this.save.active.splice(this.save.active.indexOf(entry), 1);
    this.save.completed.push(id);
    this.completedSet.add(id);
    return true;
  }

  /**
   * The quest an NPC has for you now, most urgent first: one to hand in, one to offer, one that
   * is running. Null when it has none (it says its normal lines).
   */
  forNpc(
    npcId: string,
    level: number,
    bag: readonly ItemStack[],
  ): { def: QuestDef; status: QuestStatus } | null {
    let available: QuestDef | null = null;
    let active: QuestDef | null = null;
    for (const def of this.defs) {
      if (def.giver !== npcId) continue;
      const status = this.status(def.id, level, bag);
      if (status === 'ready') return { def, status };
      if (status === 'available') available ??= def;
      else if (status === 'active') active ??= def;
    }
    if (available) return { def: available, status: 'available' };
    if (active) return { def: active, status: 'active' };
    return null;
  }

  private entry(id: string): ActiveQuest | undefined {
    return this.save.active.find((entry) => entry.id === id);
  }
}
