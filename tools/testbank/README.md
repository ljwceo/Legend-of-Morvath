# Morning test bench

After a night of the night builder (the `auto-dev` branch), Bo wants one page in the morning
where he can try the new features without starting the game (Bo, 2026-10-16). This folder
builds that page.

- `main.ts` mounts the **real** panels, rules, data (`public/data/`) and texts (`public/lang/`)
  of the new steps. Only the world around them is faked: a small session object and the world
  rules copied from `src/scenes/WorldState.ts` (for example `buy`, `upgradeItem`).
- Left: buttons to set up a situation (gold, items, level, in combat, language EN/NL, ...).
  Right: the real panel on the game's own stage, using `src/ui/ui.css`.
  Below the buttons: "Wat het spel zou opslaan" — the save fields the steps touch.
- Controls on the bench are in Dutch (it is a tool for Bo and Lucas); the panels use the game's
  own language files.

## Each morning

1. Replace the contents of `main.ts` with the features of last night's steps (keep the
   structure: fake session → real I18n/Overlays → copied world rules → panels → bench → state).
   Things that only exist in the 3D world (cinematics, models, movement) cannot be shown here:
   list them on the page as "alleen in het spel te zien".
2. `npm run testbank` → `tools/testbank/out/testbank.html` (one file, no other assets).
3. Click through it headless (Playwright, Chromium at `/opt/pw-browsers/chromium` with
   `--headless=new`) and make sure there are no console errors.
4. Publish that file as the artifact "Morvath Testbank" (the same link every morning).

`tools/testbank/` is a throwaway harness: it is not linted or type-checked and never imported
by the game.
