import { describe, expect, it } from 'vitest';
import {
  DEBUG_VIEWS,
  defaultDebugView,
  type DebugView,
  nextDebugView,
  showsSceneLines,
  visibleLineKeys,
} from './DebugOverlay';

describe('debug overlay views', () => {
  it('starts small on a phone lying down, big on a monitor', () => {
    // A phone lying down is about 390 px tall: the big view would cover the whole game.
    expect(defaultDebugView(390)).toBe('small');
    expect(defaultDebugView(430)).toBe('small');
    expect(defaultDebugView(760)).toBe('large');
    expect(defaultDebugView(1080)).toBe('large');
  });

  it('F3 cycles large → normal → small → mini → hidden → large', () => {
    let view: DebugView = 'large';
    const seen: DebugView[] = [view];
    for (let i = 0; i < DEBUG_VIEWS.length; i++) {
      view = nextDebugView(view);
      seen.push(view);
    }
    expect(seen).toEqual(['large', 'normal', 'small', 'mini', 'hidden', 'large']);
  });

  it('builds scene lines only when they are on screen', () => {
    expect(showsSceneLines('large')).toBe(true);
    expect(showsSceneLines('small')).toBe(true);
    expect(showsSceneLines('mini')).toBe(false);
    expect(showsSceneLines('hidden')).toBe(false);
  });

  it('the small view keeps only zone, position and quality', () => {
    const keys = ['lang', 'pos', 'zone', 'chunks', 'quality', 'enemies'];
    expect(visibleLineKeys('small', keys)).toEqual(['pos', 'zone', 'quality']);
    expect(visibleLineKeys('normal', keys)).toEqual(keys);
    expect(visibleLineKeys('hidden', keys)).toEqual([]);
  });
});
