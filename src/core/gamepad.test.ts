import { describe, expect, it } from 'vitest';
import type { ControlsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { type Action, Bindings } from './Bindings';
import {
  closingButtons,
  isBindablePadCode,
  isPadCode,
  PAD_START,
  PadBridge,
  PadHub,
  type PadLike,
  type PadList,
  PadTracker,
  padCode,
  padIndex,
} from './gamepad';

const file = readPublicJson('data/controls.json') as ControlsFile;
const cfg = file.gamepad;
const STEP = 1 / 60;

/** A fake controller: buttons by index, four axes. */
function pad(
  down: number[] = [],
  axes: number[] = [0, 0, 0, 0],
  triggers: Record<number, number> = {},
): PadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: down.includes(i) || i in triggers,
    value: triggers[i] ?? (down.includes(i) ? 1 : 0),
  }));
  return { connected: true, buttons, axes };
}

function fresh(saved?: Record<string, string[]>): Bindings {
  const bindings = new Bindings();
  bindings.configure(file, saved);
  return bindings;
}

describe('controller button codes', () => {
  it('maps Pad0-Pad16 to numbers and back without making strings in the loop', () => {
    expect(padIndex('Pad0')).toBe(0);
    expect(padIndex('Pad16')).toBe(16);
    expect(padIndex('Pad17')).toBe(-1);
    expect(padIndex('Pad07')).toBe(-1);
    expect(padIndex('KeyW')).toBe(-1);
    expect(padCode(5)).toBe('Pad5');
    expect(padCode(5)).toBe(padCode(5));
    expect(isPadCode('Pad9')).toBe(true);
  });

  it('keeps Start (pause) and Home out of the bindable buttons', () => {
    expect(isBindablePadCode('Pad0')).toBe(true);
    expect(isBindablePadCode('Pad15')).toBe(true);
    expect(isBindablePadCode(padCode(PAD_START))).toBe(false);
    expect(isBindablePadCode('Pad16')).toBe(false);
  });
});

describe('PadTracker', () => {
  it('reports a press once and the release once', () => {
    const t = new PadTracker();
    t.update([pad([0])], STEP, cfg);
    expect(t.risen).toBe(1);
    expect(t.down).toBe(1);
    t.update([pad([0])], STEP, cfg);
    expect(t.risen).toBe(0);
    expect(t.down).toBe(1);
    t.update([pad([])], STEP, cfg);
    expect(t.fallen).toBe(1);
    expect(t.down).toBe(0);
  });

  it('counts a trigger by its value, not by the early "pressed" flag', () => {
    const t = new PadTracker();
    t.update([pad([], [0, 0, 0, 0], { 7: cfg.triggerThreshold - 0.2 })], STEP, cfg);
    expect(t.down & (1 << 7)).toBe(0);
    t.update([pad([], [0, 0, 0, 0], { 7: cfg.triggerThreshold + 0.1 })], STEP, cfg);
    expect(t.down & (1 << 7)).not.toBe(0);
    expect(t.risen & (1 << 7)).not.toBe(0);
  });

  it('applies the dead zone to both sticks and flips the left stick so up is positive', () => {
    const t = new PadTracker();
    t.update([pad([], [0.1, -0.1, 0.1, 0.1])], STEP, cfg);
    expect([t.moveX, t.moveY, t.lookX, t.lookY]).toEqual([0, 0, 0, 0]);
    t.update([pad([], [0, -1, 1, 0])], STEP, cfg);
    expect(t.moveY).toBeCloseTo(1);
    expect(t.lookX).toBeCloseTo(1);
  });

  it('switches controller only on real input, never on stick noise below the dead zone', () => {
    const t = new PadTracker();
    t.update([pad(), pad()], STEP, cfg);
    expect(t.activeIndex).toBe(0);
    // Pad 1 jitters a little: no takeover.
    t.update([pad(), pad([], [0.05, 0.02, 0, 0])], STEP, cfg);
    expect(t.activeIndex).toBe(0);
    // Pad 1 presses a button: it takes over and that press counts.
    t.update([pad(), pad([3])], STEP, cfg);
    expect(t.activeIndex).toBe(1);
    expect(t.risen).toBe(1 << 3);
  });

  it('does not flip back to a pad that merely keeps a button held', () => {
    const t = new PadTracker();
    t.update([pad([0]), pad()], STEP, cfg);
    t.update([pad([0]), pad([1])], STEP, cfg);
    expect(t.activeIndex).toBe(1);
    t.update([pad([0]), pad([1])], STEP, cfg);
    expect(t.activeIndex).toBe(1);
  });

  it('lets go of everything the moment the controller vanishes, with no phantom input', () => {
    const t = new PadTracker();
    t.update([pad([5], [0, -1, 0, 0])], STEP, cfg);
    t.update([null], STEP, cfg);
    expect(t.down).toBe(0);
    expect(t.fallen).toBe(1 << 5);
    expect(t.moveY).toBe(0);
    t.update([null], STEP, cfg);
    expect(t.fallen).toBe(0);
  });

  it('stays present through one empty list and recovers without a new event', () => {
    const t = new PadTracker();
    t.update([pad()], STEP, cfg);
    t.update([], STEP, cfg);
    expect(t.present).toBe(true);
    t.update([pad([0])], STEP, cfg);
    expect(t.present).toBe(true);
    expect(t.activeIndex).toBe(0);
  });

  it('forgets a controller after lostSeconds, measured in seconds and not in frames', () => {
    const slow = new PadTracker();
    slow.update([pad()], STEP, cfg);
    // At 30 fps just over half a second is 16 frames; at 120 fps it takes 61.
    for (let i = 0; i < 16; i++) slow.update([], STEP * 2, cfg);
    expect(slow.present).toBe(false);
    const fast = new PadTracker();
    fast.update([pad()], STEP, cfg);
    for (let i = 0; i < 30; i++) fast.update([], 1 / 120, cfg);
    expect(fast.present).toBe(true);
    for (let i = 0; i < 40; i++) fast.update([], 1 / 120, cfg); // 70 frames in all
    expect(fast.present).toBe(false);
  });

  it('does not count a button held through a missed read as a new press', () => {
    const t = new PadTracker();
    t.update([pad([2])], STEP, cfg);
    t.update([null], STEP, cfg);
    t.update([pad([2])], STEP, cfg);
    expect(t.risen).toBe(0);
    // Let go and press again: that is a real press.
    t.update([pad([])], STEP, cfg);
    t.update([pad([2])], STEP, cfg);
    expect(t.risen).toBe(1 << 2);
  });

  it('keeps present while one of two controllers is unplugged', () => {
    const t = new PadTracker();
    t.update([pad(), pad()], STEP, cfg);
    t.update([null, pad()], STEP, cfg);
    expect(t.present).toBe(true);
    // The other one takes over on a press.
    t.update([null, pad([0])], STEP, cfg);
    expect(t.activeIndex).toBe(1);
    expect(t.risen).toBe(1);
  });
});

describe('PadHub', () => {
  function hubWith(list: () => PadList): PadHub {
    const hub = new PadHub(list, null);
    hub.configure(cfg);
    return hub;
  }

  it('finds a controller that was connected before anyone listened, without an event', () => {
    let calls = 0;
    const hub = hubWith(() => {
      calls++;
      return [pad([0])];
    });
    const seen: number[] = [];
    hub.subscribe((frame) => seen.push(frame.risen));
    hub.beginFrame(STEP);
    expect(seen).toEqual([1]);
    expect(calls).toBe(1);
  });

  it('reads the list once per frame, and only now and then while no controller is known', () => {
    let calls = 0;
    const hub = hubWith(() => {
      calls++;
      return [];
    });
    hub.beginFrame(STEP); // first frame looks at once
    expect(calls).toBe(1);
    for (let i = 0; i < 30; i++) hub.beginFrame(STEP);
    expect(calls).toBe(1);
    for (let i = 0; i < 40; i++) hub.beginFrame(STEP);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(calls).toBeLessThanOrEqual(3);

    let padCalls = 0;
    const withPad = hubWith(() => {
      padCalls++;
      return [pad()];
    });
    for (let i = 0; i < 10; i++) withPad.beginFrame(STEP);
    expect(padCalls).toBe(10);
  });

  it('turns the camera by seconds, so 60 and 120 fps give the same angle', () => {
    const turned = (fps: number): number => {
      const hub = hubWith(() => [pad([], [0, 0, 1, 0])]);
      let yaw = 0;
      hub.subscribe((frame) => {
        yaw += frame.lookX * cfg.lookRadiansPerSecond * frame.seconds;
      });
      for (let i = 0; i < fps; i++) hub.beginFrame(1 / fps);
      return yaw;
    };
    expect(turned(120)).toBeCloseTo(turned(60), 6);
  });

  it('lets the controls panel capture a press so nobody else sees it', () => {
    const hub = hubWith(() => [pad([1])]);
    const caught: number[] = [];
    const seen: number[] = [];
    hub.capture = (risen) => caught.push(risen);
    hub.subscribe((frame) => seen.push(frame.risen));
    hub.beginFrame(STEP);
    expect(caught).toEqual([2]);
    expect(seen).toEqual([0]);
  });
});

describe('buttons to actions', () => {
  function rig(saved?: Record<string, string[]>) {
    const bindings = fresh(saved);
    const events: string[] = [];
    const bridge = new PadBridge(bindings, {
      press: (action: Action) => events.push(`press ${action}`),
      release: (action: Action) => events.push(`release ${action}`),
      pause: () => events.push('pause'),
    });
    return { bindings, bridge, events };
  }

  it('presses the default action of each button and releases it again', () => {
    const { bridge, events } = rig();
    const hub = new PadHub(() => [pad([0, 5])], null);
    hub.configure(cfg);
    hub.subscribe((f) => bridge.onFrame(f));
    hub.beginFrame(STEP);
    expect(events).toEqual(['press dash', 'press attack']);
  });

  it('has the standard layout: A dashes, RB attacks, RT heavy, R3 locks on, Back opens the bag', () => {
    const b = fresh();
    expect(b.actionForPad(0)).toBe('dash');
    expect(b.actionForPad(5)).toBe('attack');
    expect(b.actionForPad(7)).toBe('heavy');
    expect(b.actionForPad(11)).toBe('lock');
    expect(b.actionForPad(10)).toBe(undefined);
    expect(b.actionForPad(8)).toBe('bag');
    expect(b.actionForPad(PAD_START)).toBe(undefined);
  });

  it('Start pauses and cannot be rebound, so a controller can always open the menu', () => {
    const { bindings, bridge, events } = rig();
    expect(bindings.bind('dash', 1, 'Pad9')).toBe(null);
    expect(bindings.padCodesFor('dash')).toEqual(['Pad0']);
    const hub = new PadHub(() => [pad([PAD_START])], null);
    hub.configure(cfg);
    hub.subscribe((f) => bridge.onFrame(f));
    hub.beginFrame(STEP);
    expect(events).toEqual(['pause']);
  });

  it('releases an action when its button comes up or the controller vanishes', () => {
    const { bridge, events } = rig();
    const tracker = new PadTracker();
    const frame = (list: PadList): void => {
      tracker.update(list, STEP, cfg);
      bridge.onFrame({
        down: tracker.down,
        risen: tracker.risen,
        fallen: tracker.fallen,
        moveX: 0,
        moveY: 0,
        lookX: 0,
        lookY: 0,
        realInput: false,
        seconds: STEP,
        take: () => undefined,
      });
    };
    frame([pad([5])]);
    frame([null]);
    expect(events).toEqual(['press attack', 'release attack']);
  });

  it('a button that opens and closes a panel does not open it again in the same press', () => {
    // Frame order of the game: Overlays first (closes the bag), then Input (the game).
    const bindings = fresh();
    const hub = new PadHub(() => [pad([8])], null);
    hub.configure(cfg);
    const events: string[] = [];
    const bridge = new PadBridge(bindings, {
      press: (action) => events.push(`press ${action}`),
      release: () => undefined,
      pause: () => undefined,
    });
    let open = true;
    // "Input.releaseAll()" as the bag's resume callback runs it: it marks held buttons.
    const releaseAll = (): void => bridge.ignoreHeld(hub.down);
    hub.subscribe((frame) => {
      if (!open) return;
      const bit = closingButtons(frame.risen, bindings, ['bag']);
      if (bit === 0) return;
      frame.take(bit);
      open = false;
      releaseAll();
    });
    hub.subscribe((frame) => bridge.onFrame(frame));
    hub.beginFrame(STEP);
    expect(open).toBe(false);
    expect(events).toEqual([]);
    // Still held next frame: nothing. Let go and press again: the bag opens as usual.
    hub.beginFrame(STEP);
    expect(events).toEqual([]);
  });

  it('ignores a button held at releaseAll until it was let go, then counts the next press', () => {
    const bindings = fresh();
    const events: string[] = [];
    const bridge = new PadBridge(bindings, {
      press: (action) => events.push(`press ${action}`),
      release: () => undefined,
      pause: () => undefined,
    });
    const frame = (down: number, risen: number): void =>
      bridge.onFrame({
        down,
        risen,
        fallen: 0,
        moveX: 0,
        moveY: 0,
        lookX: 0,
        lookY: 0,
        realInput: false,
        seconds: STEP,
        take: () => undefined,
      });
    bridge.ignoreHeld(1 << 8);
    frame(1 << 8, 1 << 8); // still the same physical press: ignored
    frame(0, 0); // let go
    frame(1 << 8, 1 << 8); // a new press
    expect(events).toEqual(['press bag']);
  });
});

describe('closing panels with a controller', () => {
  it('B closes any panel, Start closes like Escape, and the opening button closes its own panel', () => {
    const b = fresh();
    expect(closingButtons(1 << 1, b, undefined)).toBe(1 << 1);
    expect(closingButtons(1 << PAD_START, b, undefined)).toBe(1 << PAD_START);
    expect(closingButtons(1 << 8, b, ['bag'])).toBe(1 << 8);
    expect(closingButtons(1 << 8, b, ['status'])).toBe(0);
    expect(closingButtons(1 << 5, b, ['bag'])).toBe(0);
  });
});

describe('controller bindings in Bindings', () => {
  it('starts on the defaults from controls.json', () => {
    const b = fresh();
    expect([...b.padCodesFor('lock')]).toEqual(['Pad11']);
    expect(b.isDefault()).toBe(true);
  });

  it('binds, steals and clears controller buttons without touching the keyboard', () => {
    const b = fresh();
    expect(b.bind('potion', 1, 'Pad0')).toBe('dash');
    expect([...b.padCodesFor('dash')]).toEqual([]);
    expect(b.actionForPad(0)).toBe('potion');
    expect([...b.codesFor('dash')]).toEqual(['Space']);
    b.clearPad('potion', 0);
    expect(b.actionForPad(3)).toBe(undefined);
    expect(b.isDefault()).toBe(false);
  });

  it('gives actions that are not in an older save their default button', () => {
    // A save from before controllers existed: keyboard entries only.
    const b = fresh({ dash: ['KeyM'] });
    expect([...b.codesFor('dash')]).toEqual(['KeyM']);
    expect([...b.padCodesFor('dash')]).toEqual(['Pad0']);
    expect(b.actionForPad(5)).toBe('attack');
    // A save that mentions only some controller actions keeps defaults for the others.
    const some = fresh({ 'pad:dash': ['Pad2'] });
    expect([...some.padCodesFor('dash')]).toEqual(['Pad2']);
    expect([...some.padCodesFor('attack')]).toEqual(['Pad5']);
    // Pad2 was taken from interact by the save.
    expect([...some.padCodesFor('interact')]).toEqual([]);
  });

  it('keeps every controller slot empty after clearing them all and reloading', () => {
    const b = fresh();
    for (const action of b.actions) {
      while (b.padCodesFor(action).length > 0) b.clearPad(action, 0);
    }
    const saved = JSON.parse(JSON.stringify(b.toSave())) as Record<string, string[]>;
    const reloaded = fresh(saved);
    for (const action of reloaded.actions) expect([...reloaded.padCodesFor(action)]).toEqual([]);
    for (let i = 0; i < 17; i++) expect(reloaded.actionForPad(i)).toBe(undefined);
    // The keyboard is untouched.
    expect(reloaded.actionFor('KeyW')).toBe('moveForward');
  });

  it('round-trips changed controller buttons through the save', () => {
    const b = fresh();
    b.bind('dash', 0, 'Pad1');
    const reloaded = fresh(JSON.parse(JSON.stringify(b.toSave())) as Record<string, string[]>);
    expect(reloaded.actionForPad(1)).toBe('dash');
    expect(reloaded.actionForPad(0)).toBe(undefined);
  });

  it('skips Start, Home and unknown buttons in a save', () => {
    const b = fresh({ 'pad:dash': ['Pad9', 'Pad16', 'Pad99', 'Pad4'] });
    expect([...b.padCodesFor('dash')]).toEqual(['Pad4']);
  });

  it('names controller buttons in the texts after the last input came from a controller', () => {
    const b = fresh();
    expect(b.padHints).toBe(false);
    const before = b.version;
    b.setPadHints(true);
    expect(b.version).toBe(before + 1);
    b.setPadHints(true);
    expect(b.version).toBe(before + 1);
  });
});
