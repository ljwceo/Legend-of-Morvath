/**
 * Keeping the scroll position while a screen or panel is rebuilt.
 *
 * Panels are built again from scratch whenever something changes (a stat point, the language,
 * a setting). Without this the list would jump back to the top every time, which on a phone
 * looks like being thrown back to the top of the page (Bo, 2026-10-12).
 */

/** How far each scrollable element was scrolled, in the order they appear in the tree. */
export type ScrollState = readonly number[];

/** Every element that can scroll, depth first, so the order is the same before and after. */
function scrollables(root: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  const visit = (element: HTMLElement): void => {
    if (element.scrollHeight > element.clientHeight + 1 || element.scrollTop > 0) {
      found.push(element);
    }
    for (const child of element.children) {
      if (child instanceof HTMLElement) visit(child);
    }
  };
  visit(root);
  return found;
}

/** Reads how far everything inside `root` (and `root` itself) is scrolled. */
export function readScroll(root: HTMLElement | null): ScrollState {
  if (!root) return [];
  return scrollables(root).map((element) => element.scrollTop);
}

/**
 * Puts the scroll positions back after a rebuild. The new tree is matched by position, so a
 * panel that rebuilt into the same shape keeps its place; a different shape simply keeps what
 * fits and ignores the rest.
 */
export function restoreScroll(root: HTMLElement | null, state: ScrollState): void {
  if (!root || state.length === 0) return;
  const now = scrollables(root);
  for (let i = 0; i < now.length && i < state.length; i++) {
    const element = now[i];
    const wanted = state[i];
    if (element && wanted !== undefined && wanted > 0) element.scrollTop = wanted;
  }
}

/**
 * Stops a tapped button from dragging the panel to the top. A browser scrolls a control it
 * just focused into view, and on a phone that looks like being thrown back to the top of the
 * page (Bo, 2026-10-12). We remember the scroll positions the moment the finger goes down and
 * put them back the moment the button gets the focus (on a touch screen that is a tap later,
 * so it cannot be done on a timer).
 *
 * Text fields are left alone on purpose: there the jump to the field is what you want, so the
 * on-screen keyboard does not cover what you are typing.
 *
 * @returns a function that stops listening again.
 */
export function keepScrollOnFocus(root: HTMLElement): () => void {
  let snapshot: ScrollState = [];
  const isButton = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement && target.closest('button') !== null;
  const onPointerDown = (event: Event): void => {
    if (isButton(event.target)) snapshot = readScroll(root);
  };
  const onFocusIn = (event: Event): void => {
    if (!isButton(event.target) || snapshot.length === 0) return;
    const state = snapshot;
    restoreScroll(root, state);
    // A browser that scrolls smoothly is still busy; put it back once more next frame.
    requestAnimationFrame(() => restoreScroll(root, state));
  };
  root.addEventListener('pointerdown', onPointerDown, true);
  root.addEventListener('focusin', onFocusIn, true);
  return () => {
    root.removeEventListener('pointerdown', onPointerDown, true);
    root.removeEventListener('focusin', onFocusIn, true);
  };
}
