## De game starten

**Online (pc en iPhone):** <https://ljwceo.github.io/Legend-of-Morvath/>
Elke keer dat er iets in `main` komt, bouwt GitHub de game opnieuw en zet hem online (tabblad *Actions* → "Check and deploy"). Dat duurt ongeveer 1–2 minuten.

**Lokaal op de pc** (eenmalig [Node.js](https://nodejs.org/) 22 of nieuwer installeren):
1. Open een terminal in de map van deze repo.
2. `npm install` (alleen de eerste keer, of als `package.json` veranderd is).
3. `npm run dev` en open <http://localhost:5173/Legend-of-Morvath/>.

**Lokaal op de iPhone:** zorg dat iPhone en pc op hetzelfde wifi-netwerk zitten. Na `npm run dev` staat in de terminal een regel `Network: http://192.168.x.x:5173/Legend-of-Morvath/`. Typ dat adres in Safari op je iPhone.

**Debug en testen**
| Wat | Hoe |
|---|---|
| Debug-overlay (fps, draw calls, …) | F3, tik met drie vingers op de iPhone, of zet `?debug=1` achter het adres |
| Framerate beperken (test of 30/60/120 fps even snel loopt) | zet `?fps=30` achter het adres (combineren: `?debug=1&fps=30`) |
| Cheatmenu (snelheid, vliegen, teleport, seizoen, dag en nacht, save-code, fps meten) | F6 of de knop **Cheats** rechtsboven (alleen in debugmodus) |
| Dag en nacht testen (fase en resterende tijd, springen naar dag/schemer/nacht, tijd 10× of 60× sneller) | Cheatmenu → **Dag en nacht** (in debugmodus ook het testspawngebied met slimes buiten de oostmuur van Greyhaven) |

**Fps meten per grafische stand (voor de tabel in `docs/PROGRESS.md`)**
1. Open de game (online of lokaal), zet de debugmodus aan (Settings → Debug, of F3 / drie vingers).
2. Kies in Settings een stand: **Low**, daarna **Mid**, daarna **High**.
3. Ga naar Greyhaven (Market Square, veel gebouwen) of het bos (Cheats → Teleport → The Greenwood of Aerandir).
4. Cheats → **Meet 20 s**, en loop 20 seconden gewoon rond (ook dashen en de camera draaien).
5. Lees de regel `measure` in de debug-overlay, bijv. `mid · avg 60.0 fps · 1% low 55.1 · worst 24.0 ms · calls 70 · 2532x1170`. Stuur die regel per stand door (op de pc staat hij ook in de console, F12).
   - **avg** = gemiddelde fps (doel: 60, of 120 op High op een 120 Hz-scherm).
   - **1% low** = de traagste 1% van de frames; ver onder 60 betekent haperen.
   - **worst** = de langste frame in ms; boven ±50 ms zie je een duidelijke hapering.
6. Na afloop weer **Auto** kiezen in Settings.

**Geheugen nameten (duurtest)**

`scripts/mem-check.mjs` speelt de game zelf in een testbrowser en kijkt of het geheugen steeds terugkomt: eerst 10 minuten heen en weer lopen door de open wereld (met teleports tussen Greenwood, Mournfen en Greyhaven), daarna 5× een instance in en uit (de toren van Master Brink en de kelder van Wizard Sam). Playwright hoort niet bij de game zelf, dus installeer het alleen als je dit wilt draaien:

1. `npm i --no-save playwright && npx playwright install chromium` (eenmalig, ±150 MB; `--no-save` houdt `package.json` schoon).
2. `node scripts/mem-check.mjs` — duurt ±15 minuten. Snelle proef: `node scripts/mem-check.mjs --minutes 2 --cycles 1`. Draait de dev-server al? Dan `--url http://localhost:5173/Legend-of-Morvath/`.
3. De uitslag staat in de terminal en in de map `mem-check/` (een `.log` om te lezen en een `.json` met alle metingen).

Wat je wilt zien: na elke instance staan `geo` en `tex` weer precies op hun beginwaarde, en in de open wereld schommelen ze tussen een vaste onder- en bovengrens in plaats van op te lopen. De testbrowser tekent zonder videokaart (±1 fps in Greyhaven), dus de fps in deze test zegt niets — daarvoor is **Meet 20 s** hierboven.

**Handige commando's**
| Commando | Wat |
|---|---|
| `npm run dev` | Ontwikkelserver (ook bereikbaar op je lokale netwerk) |
| `npm run build` | Typecheck + bouwen naar `dist/` |
| `npm run preview` | De gebouwde versie uit `dist/` bekijken |
| `npm test` | Tests (Vitest) |
| `npm run lint` | Code controleren (ESLint) |
| `npm run format` | Code netjes opmaken (Prettier) |

---

## PerfTest openen (losse testscène)

Een aparte testpagina om te meten hoe snel de game kan lopen. Hij staat los van het echte spel, in de map [`experiments/perftest/`](experiments/perftest/).

**Op de pc (lokaal):**
1. Open een terminal in de map van deze repo.
2. Typ `python3 -m http.server 8000` (of `npx serve .`) en druk op Enter.
3. Ga in je browser naar <http://localhost:8000/experiments/perftest/>.

Dubbelklikken op `index.html` werkt níet: de browser mag dan de kleurenlijst niet inladen.

**Online en op de iPhone:** open `https://ljwceo.github.io/Legend-of-Morvath/experiments/perftest/`. De build kopieert de PerfTest mee naar GitHub Pages.

**Bediening**
| Wat | Pc | iPhone |
|---|---|---|
| Debug-overlay aan, daarna grootte wisselen (Groot → Normaal → Klein → Alleen fps → Verborgen) | F3 | tik met drie vingers |
| Lopen | WASD of pijltjes | sleep met één vinger |
| Aantal vijanden (0–300) en projectielen (0–500) | schuifregelaars rechtsonder | idem |
| Zone B laden op de achtergrond | L of de knop | de knop |
| Framerate beperken (test 60 vs 120 Hz) | zet `?fps=30` achter het adres | idem |

De resultaten van de laadtest staan in de overlay en in de console (F12). De "tick"-controlegetallen in de overlay moeten op elk scherm (60 of 120 Hz, of met `?fps=30`) hetzelfde zijn, zolang je de schuifregelaars en toetsen niet aanraakt.

---

# journey-gaym
hoi ik ben lucas
en ik ben Blokker, Bo Blokker
omeeeeega

---

## Legend of Morvath

Co-op progressie-RPG in 3D voor de browser, gemaakt door Bo en Lucas.

| Bestand | Wat |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Master prompt: instructies voor Claude (bron van waarheid) |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Waar we zijn, plan per fase, besluiten |
| [`docs/START-PROMPT.md`](docs/START-PROMPT.md) | Prompt om in elke nieuwe chat te plakken |
| [`docs/art-style/`](docs/art-style/README.md) | Stijlgids: kleuren, licht, UI, AI-prompts |
| [`experiments/`](experiments/) | Oude test-code (PerfTest) |
| [`docs/archive/`](docs/archive/) | Oude plannen van Arcane Oath (2D): master prompt, spelgids, fase-tracker, plan van Lucas |
| [Spelconcept (Google Docs)](https://docs.google.com/document/d/10Yi8_lYVsLEa_WpR76Exs0ecsY9mXxTk5a6SC4sSKUk/edit) | Verhaal, gebieden, skills, gear, NPC's, stats en vijanden |

**Sessie starten:** plak de prompt uit [`docs/START-PROMPT.md`](docs/START-PROMPT.md) in Claude Code en vul de fase en taak in.
