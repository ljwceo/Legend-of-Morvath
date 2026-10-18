import type { PerkDef, PlayerConfig, PlayerPath, SkillsFile, StatsFile } from '../data/types';
import { clampStatEffects, type StatEffects } from './Stats';

/**
 * What your path gives you (fase 3.8). Your pad is chosen in *Your Resolve* and from then on
 * it is simply part of you: a sword fighter hits harder and carries the three perks of his path;
 * a mage keeps his power curve (spells.json). Every path has mana (fase G.2).
 *
 * Everything is data: `player.json` → `paths` says what a path does and which perks from
 * `skills.json` come with it. Pure logic (no DOM, no Three.js), so the world and the balance
 * tests read the same numbers.
 */

/** What a path does beyond the stats; `perks` are the perk definitions it hands you. */
export interface PathBonus {
  perks: readonly PerkDef[];
}

const NO_PERKS: readonly PerkDef[] = [];

/** The perks a path gives you, in the order they are listed in player.json. */
export function pathPerks(
  player: PlayerConfig,
  skills: SkillsFile,
  path: PlayerPath | null,
): readonly PerkDef[] {
  if (!path) return NO_PERKS;
  const wanted = player.paths[path]?.perks ?? [];
  if (wanted.length === 0) return NO_PERKS;
  const out: PerkDef[] = [];
  for (const id of wanted) {
    const perk = skills.perks.find((entry) => entry.id === id);
    if (perk) out.push(perk);
  }
  return out;
}

/**
 * Adds the path and its perks on top of what the stat points give (`out`, changed in place and
 * returned). The ceilings in stats.json still hold, so a perk cannot push a stat past its cap.
 * A perk whose `stat` this version does not know yet is skipped (it does nothing until the
 * skill tree of fase 4 uses it).
 */
export function applyPath(
  player: PlayerConfig,
  skills: SkillsFile,
  stats: StatsFile,
  path: PlayerPath | null,
  out: StatEffects,
): PathBonus {
  const bonus = path ? player.paths[path] : undefined;
  if (bonus?.normalAttackPercent) out.normalAttackPercent += bonus.normalAttackPercent;
  if (bonus?.spellPercent) out.spellPercent += bonus.spellPercent;
  const perks = pathPerks(player, skills, path);
  for (const perk of perks) {
    switch (perk.stat) {
      case 'maxHpPercent':
        out.maxHpPercent += perk.value;
        break;
      case 'damageTakenReductionPercent':
        // Defense is negative in the totals (less damage taken), so a reduction subtracts.
        out.damageTakenPercent -= perk.value;
        break;
      case 'attackSpeedPercent':
        out.attackSpeedPercent += perk.value;
        break;
      case 'moveSpeedPercent':
        out.moveSpeedPercent += perk.value;
        break;
      default:
        // hpOnKillPercent and anything the skill tree adds later: not used yet.
        break;
    }
  }
  clampStatEffects(stats, out);
  return { perks };
}
