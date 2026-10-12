import type { Condition, NpcDef, PlayerPath, TeachDef } from '../data/types';
import { type ConditionContext, evaluateCondition } from '../world/Conditions';

/**
 * Main quest Your Resolve: Sir Garrick, Master Brink and Wizard Sam each ask "Will you train
 * under me?". Pure logic (no DOM), tested; the conversation itself is in WorldState.
 */

/** The teacher's offer when it stands now (`teaches.when` holds), otherwise null. */
export function teacherOffer(
  def: NpcDef,
  conditions: Readonly<Record<string, Condition>>,
  ctx: ConditionContext,
): TeachDef | null {
  const teaches = def.teaches;
  if (!teaches) return null;
  const when = conditions[teaches.when];
  return when && evaluateCondition(when, ctx) ? teaches : null;
}

/** Sets the path once: false (and nothing changes) when one was already chosen. */
export function choosePath(save: { path: PlayerPath | null }, path: PlayerPath): boolean {
  if (save.path !== null) return false;
  save.path = path;
  return true;
}
