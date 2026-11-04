/** What interact (E or a tap on the icon) does: talk to / pet an NPC, rest, or pull a door open. */
export type InteractionTarget = 'npc' | 'rest' | 'door' | null;

/**
 * The one thing interact does now, given what is in reach. NPCs come first, then the checkpoint
 * bed, and a pull door only when neither is there: a door never takes their interaction over.
 */
export function interactionTarget(
  npc: boolean,
  checkpoint: boolean,
  door: boolean,
): InteractionTarget {
  if (npc) return 'npc';
  if (checkpoint) return 'rest';
  return door ? 'door' : null;
}
