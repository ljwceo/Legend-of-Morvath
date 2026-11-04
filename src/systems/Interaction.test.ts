import { describe, expect, it } from 'vitest';
import { interactionTarget } from './Interaction';

describe('interactionTarget', () => {
  it('a pull door never takes over an NPC or the checkpoint bed', () => {
    expect(interactionTarget(true, false, false)).toBe('npc');
    expect(interactionTarget(true, true, false)).toBe('npc');
    expect(interactionTarget(true, false, true)).toBe('npc');
    expect(interactionTarget(true, true, true)).toBe('npc');
    expect(interactionTarget(false, true, false)).toBe('rest');
    expect(interactionTarget(false, true, true)).toBe('rest');
  });

  it('pulls the door only when nothing else is in reach, and does nothing without a target', () => {
    expect(interactionTarget(false, false, true)).toBe('door');
    expect(interactionTarget(false, false, false)).toBeNull();
  });
});
