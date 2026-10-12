import type { GameContext } from '../../core/GameContext';
import { button, el, segmented } from '../dom';
import type { Panel } from '../Overlays';
import {
  clampPoint,
  clampSize,
  dividerFraction,
  pixelsToPoint,
  placeButton,
  pointToPixels,
  readTouchSettings,
  type StageSize,
  TOUCH_BUTTONS,
  type TouchButtonId,
  type TouchConfig,
  type TouchPoint,
} from '../TouchLayout';
import { bindT } from './ConfirmPanel';

/** Diameters if the style sheet cannot be read (the same fallbacks as TouchControls). */
const FALLBACK_SIZE_PX = 82;
const FALLBACK_BIG_PX = 92;

/**
 * Settings -> Buttons on the screen: drag every on-screen button where you want it, set one
 * size for all of them and swap the two halves for a left-handed player (like Brawl Stars;
 * Bo, 2026-10-12).
 *
 * The dashed line is the divider: the walking thumb stays on one side and the buttons on the
 * other, so they can never end up on top of each other. The real buttons are hidden while this
 * is open (ui.css), so what you drag is what you get. Every change is saved at once.
 */
export function touchLayoutPanel(ctx: GameContext): Panel {
  let observer: ResizeObserver | null = null;

  const config = (): TouchConfig | null => ctx.data?.player.controls.touch ?? null;

  const save = (
    apply: (draft: { size: number; mirrored: boolean; layout: Record<string, TouchPoint> }) => void,
  ): void => {
    const settings = ctx.session?.settings;
    if (!settings) return;
    apply(settings.touchControls);
    ctx.persist();
    ctx.events.emit('settingsChanged', {});
  };

  return {
    onClose: () => {
      observer?.disconnect();
      observer = null;
    },
    build: () => {
      const { t } = bindT(ctx);
      const cfg = config();
      const root = el('div', { className: 'ui-touch-editor' });
      if (!cfg) return root;
      const style = window.getComputedStyle(document.documentElement);
      const basePx = readPx(style.getPropertyValue('--touch-size'), FALLBACK_SIZE_PX);
      const bigPx = readPx(style.getPropertyValue('--touch-size-big'), FALLBACK_BIG_PX);
      const stored = readTouchSettings(ctx.session?.settings, cfg);
      // A working copy: dragging and the slider change this one live, and every change is
      // written to the save right away.
      const settings = {
        size: stored.size,
        mirrored: stored.mirrored,
        layout: { ...stored.layout } as Record<string, TouchPoint>,
      };
      const diameter = (id: TouchButtonId): number =>
        Math.round((id === 'attack' ? bigPx : basePx) * clampSize(cfg, settings.size));

      const divider = el('div', { className: 'ui-touch-editor-divider' });
      const walkSide = el('span', {
        className: 'ui-touch-editor-side',
        text: t('touch.walkHalf'),
      });
      const buttonSide = el('span', {
        className: 'ui-touch-editor-side',
        text: t('touch.buttonHalf'),
      });

      const ghosts = new Map<TouchButtonId, HTMLElement>();
      /**
       * The playing field. While the panel is still being built it is not in the document yet,
       * so fall back to the size Stage wrote into the CSS variables: that way the buttons are
       * drawn in the right place straight away instead of jumping there one frame later.
       */
      const stage = (): StageSize => {
        if (root.clientWidth > 0 && root.clientHeight > 0) {
          return { width: root.clientWidth, height: root.clientHeight };
        }
        return {
          width: readPx(style.getPropertyValue('--stage-width'), 0),
          height: readPx(style.getPropertyValue('--stage-height'), 0),
        };
      };

      /** Draws the divider, the half labels and every button where it belongs. */
      const place = (): void => {
        const box = stage();
        if (box.width <= 0 || box.height <= 0) return;
        const line = dividerFraction(cfg, settings.mirrored);
        divider.style.left = `${Math.round(line * box.width)}px`;
        const walkCentre = settings.mirrored ? (1 + line) / 2 : line / 2;
        walkSide.style.left = `${Math.round(walkCentre * box.width)}px`;
        buttonSide.style.left = `${Math.round((settings.mirrored ? line / 2 : (1 + line) / 2) * box.width)}px`;
        for (const id of TOUCH_BUTTONS) {
          const ghost = ghosts.get(id);
          if (!ghost) continue;
          const size = diameter(id);
          const point = placeButton(id, settings, size, box, cfg);
          const { left, top } = pointToPixels(point, size, box, settings.mirrored);
          ghost.style.width = ghost.style.height = `${size}px`;
          ghost.style.left = `${left}px`;
          ghost.style.top = `${top}px`;
        }
      };

      /** Dragging one button: the whole button stays on its own half of the divider. */
      const dragger = (id: TouchButtonId, ghost: HTMLElement): void => {
        let pointer: number | null = null;
        let grabX = 0;
        let grabY = 0;
        ghost.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          if (pointer !== null) return;
          pointer = event.pointerId;
          ghost.setPointerCapture(event.pointerId);
          ghost.classList.add('ui-touch-ghost-dragging');
          const rect = ghost.getBoundingClientRect();
          grabX = event.clientX - rect.left;
          grabY = event.clientY - rect.top;
        });
        ghost.addEventListener('pointermove', (event) => {
          if (event.pointerId !== pointer) return;
          const box = stage();
          const area = root.getBoundingClientRect();
          const size = diameter(id);
          const left = event.clientX - area.left - grabX;
          const top = event.clientY - area.top - grabY;
          const wanted = pixelsToPoint(left, top, size, box, settings.mirrored);
          const point = clampPoint(wanted, size, box, cfg);
          settings.layout[id] = point;
          const pixels = pointToPixels(point, size, box, settings.mirrored);
          ghost.style.left = `${pixels.left}px`;
          ghost.style.top = `${pixels.top}px`;
        });
        const stop = (event: PointerEvent): void => {
          if (event.pointerId !== pointer) return;
          pointer = null;
          ghost.classList.remove('ui-touch-ghost-dragging');
          const point = settings.layout[id];
          if (point) save((draft) => (draft.layout[id] = { x: point.x, y: point.y }));
        };
        ghost.addEventListener('pointerup', stop);
        ghost.addEventListener('pointercancel', stop);
      };

      /** The draggable copies, one per button. */
      for (const id of TOUCH_BUTTONS) {
        const ghost = el('div', {
          className: 'ui-touch-ghost',
          text: t(`controls.${id}`),
          attrs: { role: 'button', 'aria-label': t(`controls.${id}`) },
        });
        ghosts.set(id, ghost);
        dragger(id, ghost);
      }

      // The size slider: live while dragging, written to the save when you let go.
      const sizeValue = el('span', {
        className: 'ui-slider-value',
        text: percent(settings.size),
      });
      const slider = el('input', {
        className: 'ui-slider',
        attrs: {
          type: 'range',
          min: String(Math.round(cfg.sizeMin * 100)),
          max: String(Math.round(cfg.sizeMax * 100)),
          step: '5',
          value: String(Math.round(settings.size * 100)),
          'aria-label': t('touch.size'),
        },
      });
      slider.addEventListener('input', () => {
        settings.size = clampSize(cfg, Number(slider.value) / 100);
        sizeValue.textContent = percent(settings.size);
        place();
      });
      slider.addEventListener('change', () => {
        const size = clampSize(cfg, Number(slider.value) / 100);
        save((draft) => (draft.size = size));
      });

      const sides = segmented(
        [
          { value: 'right', label: t('touch.sideRight') },
          { value: 'left', label: t('touch.sideLeft') },
        ] as const,
        settings.mirrored ? 'left' : 'right',
        (value) => {
          save((draft) => (draft.mirrored = value === 'left'));
          ctx.overlays.refreshTop();
        },
      );

      const reset = button(t('touch.reset'), () => {
        save((draft) => {
          draft.size = 1;
          draft.layout = {};
        });
        ctx.overlays.refreshTop();
      });

      const bar = el(
        'div',
        { className: 'ui-touch-editor-bar' },
        el('span', { className: 'ui-label', text: t('touch.size') }),
        el('div', { className: 'ui-slider-row' }, slider, sizeValue),
        el('span', { className: 'ui-label', text: t('touch.side') }),
        sides,
        reset,
        button(t('touch.done'), () => ctx.overlays.close(), true),
      );

      root.append(divider, walkSide, buttonSide, ...ghosts.values(), bar);
      root.append(el('p', { className: 'ui-note ui-touch-editor-hint', text: t('touch.drag') }));
      // The panel is built before it is in the document (so it has no size yet): draw the
      // buttons on the next frame, and again whenever the playing field changes size.
      observer?.disconnect();
      observer = new ResizeObserver(() => place());
      observer.observe(root);
      place();
      requestAnimationFrame(() => place());
      return root;
    },
  };

  function percent(value: number): string {
    return `${Math.round(value * 100)}%`;
  }
}

/** "82px" -> 82; anything else falls back. */
function readPx(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
