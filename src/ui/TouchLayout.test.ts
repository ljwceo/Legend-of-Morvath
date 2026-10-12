import { describe, expect, it } from 'vitest';
import {
  clampPoint,
  clampSize,
  defaultLayout,
  dividerFraction,
  joystickZone,
  pixelsToPoint,
  placeButton,
  pointToPixels,
  readTouchSettings,
  TOUCH_BUTTONS,
  type TouchConfig,
} from './TouchLayout';

/** A phone lying down, and the numbers from player.json. */
const stage = { width: 844, height: 390 };
const cfg: TouchConfig = {
  sizeMin: 0.7,
  sizeMax: 1.6,
  dividerFraction: 0.45,
  joystickZoneTopFraction: 0.5,
  buttons: [
    { id: 'attack', x: 0.912, y: 0.79 },
    { id: 'heavy', x: 0.795, y: 0.8 },
    { id: 'dash', x: 0.912, y: 0.536 },
    { id: 'potion', x: 0.795, y: 0.536 },
    { id: 'lock', x: 0.684, y: 0.8 },
  ],
};

describe('the on-screen buttons', () => {
  it('starts every button at its place from player.json', () => {
    const layout = defaultLayout(cfg);
    expect(Object.keys(layout).sort()).toEqual([...TOUCH_BUTTONS].sort());
    expect(layout.attack).toEqual({ x: 0.912, y: 0.79 });
  });

  it('keeps the size inside the slider range', () => {
    expect(clampSize(cfg, 1)).toBe(1);
    expect(clampSize(cfg, 5)).toBe(1.6);
    expect(clampSize(cfg, 0.1)).toBe(0.7);
    expect(clampSize(cfg, Number.NaN)).toBe(1);
  });

  it('never lets a button into the walking half (the divider)', () => {
    const point = clampPoint({ x: 0.1, y: 0.8 }, 82, stage, cfg);
    // The whole button stays out: its centre is half a button past the line.
    expect(point.x).toBeCloseTo(0.45 + 41 / 844, 5);
    expect(point.x * stage.width - 41).toBeGreaterThanOrEqual(0.45 * stage.width);
  });

  it('keeps the whole button on the screen', () => {
    const far = clampPoint({ x: 2, y: 2 }, 92, stage, cfg);
    expect(far.x * stage.width + 46).toBeCloseTo(stage.width, 5);
    expect(far.y * stage.height + 46).toBeCloseTo(stage.height, 5);
    const high = clampPoint({ x: 0.9, y: -1 }, 92, stage, cfg);
    expect(high.y * stage.height - 46).toBeCloseTo(0, 5);
  });

  it('puts a tiny screen in the middle of the button half instead of nowhere', () => {
    const point = clampPoint({ x: 0.9, y: 0.8 }, 400, { width: 300, height: 200 }, cfg);
    expect(point.x).toBeCloseTo((0.45 + 1) / 2, 5);
    expect(point.y).toBe(0.5);
  });

  it('mirrors the whole picture for a left-handed player', () => {
    const point = { x: 0.9, y: 0.8 };
    const right = pointToPixels(point, 92, stage, false);
    const left = pointToPixels(point, 92, stage, true);
    expect(right.left).toBe(Math.round(0.9 * 844 - 46));
    expect(left.left).toBe(Math.round(0.1 * 844 - 46));
    expect(left.top).toBe(right.top);
  });

  it('reads a dragged place back to the same point, mirrored or not', () => {
    for (const mirrored of [false, true]) {
      const point = { x: 0.8, y: 0.7 };
      const pixels = pointToPixels(point, 82, stage, mirrored);
      const back = pixelsToPoint(pixels.left, pixels.top, 82, stage, mirrored);
      expect(back.x).toBeCloseTo(point.x, 2);
      expect(back.y).toBeCloseTo(point.y, 2);
    }
  });

  it('walks on the left by default and on the right when mirrored', () => {
    expect(joystickZone(cfg, false)).toEqual({ xMin: 0, xMax: 0.45, yMin: 0.5 });
    expect(joystickZone(cfg, true)).toEqual({ xMin: 0.55, xMax: 1, yMin: 0.5 });
    expect(dividerFraction(cfg, false)).toBe(0.45);
    expect(dividerFraction(cfg, true)).toBeCloseTo(0.55, 5);
  });

  it('uses the place the player dragged a button to, and the default for the rest', () => {
    const settings = {
      size: 1,
      mirrored: false,
      layout: { attack: { x: 0.6, y: 0.3 } },
    };
    expect(placeButton('attack', settings, 82, stage, cfg)).toEqual({ x: 0.6, y: 0.3 });
    expect(placeButton('dash', settings, 82, stage, cfg).x).toBeCloseTo(0.912, 5);
  });

  it('throws away nonsense from the save', () => {
    const settings = readTouchSettings(
      {
        touchControls: {
          size: 99,
          mirrored: true,
          layout: { attack: { x: 0.6, y: 0.3 }, nonsense: { x: 0.1, y: 0.1 } },
        },
      },
      cfg,
    );
    expect(settings.size).toBe(1.6);
    expect(settings.mirrored).toBe(true);
    expect(settings.layout).toEqual({ attack: { x: 0.6, y: 0.3 } });
  });

  it('falls back to the defaults without a save', () => {
    const settings = readTouchSettings(undefined, cfg);
    expect(settings).toEqual({ size: 1, mirrored: false, layout: {} });
  });
});
