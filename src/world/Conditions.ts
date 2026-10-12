import type { Condition, PlayerPath } from '../data/types';

/** What conditions can look at. Grows with later phases (items, seasons, ...). */
export interface ConditionContext {
  level: number;
  completedQuests: ReadonlySet<string>;
  /** Chosen in Your Resolve; missing or null = not chosen yet. */
  path?: PlayerPath | null;
}

/** Evaluates a data-driven condition from triggers.json (e.g. "Sultan defeated and level 5"). */
export function evaluateCondition(condition: Condition, ctx: ConditionContext): boolean {
  switch (condition.type) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'level':
      return ctx.level >= condition.min;
    case 'questCompleted':
      return ctx.completedQuests.has(condition.quest);
    case 'path': {
      const path = ctx.path ?? null;
      if (condition.is === 'none') return path === null;
      if (condition.is === 'any') return path !== null;
      return path === condition.is;
    }
    case 'all':
      return condition.of.every((child) => evaluateCondition(child, ctx));
    case 'any':
      return condition.of.some((child) => evaluateCondition(child, ctx));
  }
}
