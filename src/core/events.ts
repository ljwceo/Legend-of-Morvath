import type { PlayerPath } from '../data/types';
import { EventBus } from './EventBus';

/**
 * All game-wide events and their payloads. Add new events here; listeners stay decoupled.
 * Events named in CLAUDE.md §11 are declared now so later systems share one vocabulary.
 */
export interface GameEvents {
  stateChanged: { from: string | null; to: string };
  zoneEntered: { zoneId: string };
  /** Went through a door into an instance (Master Brink's tower); quests can listen. */
  instanceEntered: { instanceId: string };
  triggerEntered: { triggerId: string };
  placeFirstVisited: { triggerId: string };
  npcTalked: { npcId: string };
  /** The first time the player talks to (or pets) this NPC. */
  npcMet: { npcId: string };
  checkpointSet: { checkpointId: string };
  /** The player's HP reached 0: some gold is lost, they wake up at their checkpoint. */
  playerDied: { goldLost: number };
  /** A monster was defeated by the player (quests listen to this). */
  monsterDefeated: { monsterId: string };
  xpGained: { amount: number };
  levelUp: { level: number };
  /** Points were spent in the status window (fase 3.7); quests can listen later. */
  statsSpent: { level: number };
  /**
   * An egg was handed in (fase 3.9): every point you ever spent came free, `points` of them.
   * Level, path, gear and quests stay as they are.
   */
  statsReset: { npcId: string; eggs: readonly string[]; points: number };
  /** The egg of a mini-boss (or Sultan) was found for the first time (fase 3.9). */
  eggFound: { itemId: string; monsterId: string };
  /** Items (or gold, as item "gold") went into the bag: loot, rewards, purchases. */
  itemsGained: { itemId: string; count: number };
  potionDrunk: { itemId: string };
  /** Bought in a shop (`npcId` = the merchant). */
  itemBought: { itemId: string; count: number; npcId: string };
  questStarted: { questId: string };
  /** Everything of a running quest is done; it can be handed in at the giver. */
  questReady: { questId: string };
  questCompleted: { questId: string };
  /** Said yes twice to a teacher (Your Resolve): the path for the rest of the game. */
  pathChosen: { path: PlayerPath; teacherId: string };
  /** Rested in the bed at a checkpoint: HP and mana are full. */
  playerRested: { checkpointId: string };
  /** The UI language changed; screens rebuild their text. */
  languageChanged: { language: string };
  /** A setting in the save changed (applied by main.ts). */
  settingsChanged: Record<string, never>;
  /** The graphics preset in use changed (Settings, benchmark or auto-downgrade). */
  qualityChanged: { level: 'low' | 'mid' | 'high' };
  /** The game picked (benchmark) or lowered (too slow) the preset itself, with "Auto" on. */
  qualityAutoChosen: { level: 'low' | 'mid' | 'high'; reason: 'benchmark' | 'lowered' };
}

export type GameEventBus = EventBus<GameEvents>;

export function createEventBus(): GameEventBus {
  return new EventBus<GameEvents>();
}
