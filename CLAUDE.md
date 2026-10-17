# Legend of Morvath – projectregels voor Claude Code

**Het actuele plan staat in `PLAN.md`. Lees dat alleen als de opdracht erom vraagt.**

Geschiedenis, besluiten en meetresultaten: `docs/PROGRESS.md` (lees alleen het stukje dat je nodig hebt).
Techniek: `docs/ARCHITECTURE.md`. Stijlgids: `docs/art-style/README.md`. Klooster: `docs/MONASTERY.md`.
De volledige oude master prompt staat in `docs/archive/CLAUDE-master-prompt-2026-10-13.md`.

---

## 1. Wat we bouwen

**Legend of Morvath** is een co-op progressie-RPG in de browser, gemaakt door Bo en Lucas. Je bent een
rondtrekkende strijder met een melee-wapen en een Grimoire op het continent Eryndor; je build kan meer
richting melee of meer richting magie gaan, en je keuze van leraar is een eerste specialisatie, geen
vaste klasse (`PLAN.md` → Fase G). Twee demi-god necromancers, Lucael en
Baelor, verspreiden corruptie en hoe verder je naar het oosten trekt, hoe sterker het kwaad. De wereld
speel je solo, samen vechten alleen in raids (later, via PeerJS en een kamercode). De wereld is volledig
3D (Three.js) met de camera over de schouder, zoals Genshin Impact.

Het gevecht wordt **souls-like** (stamina, rol met onkwetsbare frames, aankondiging per aanval, parry en
poise; de besluiten staan in `PLAN.md` → Fase S). Het spel is gemaakt voor **pc en console (controller)**:
de telefoon wordt niet meer ondersteund. Magie staat centraal en spelen met veel magie is lastiger te
beheersen dan brute force; een build die vooral op melee leunt is de toegankelijke keuze.

Het volledige spelconcept staat in Google Docs: "Legend of Morvath – spelconcept"
(id `10Yi8_lYVsLEa_WpR76Exs0ecsY9mXxTk5a6SC4sSKUk`). Lees het via de Google Drive-connector, en alleen
de delen die je voor je taak nodig hebt. Lukt dat niet, vraag Bo of Lucas om de tekst.

## 2. Harde eisen (gelden altijd, in elke fase)

1. **Altijd vloeiend:** minimaal 60 fps, 120 fps op schermen die dat kunnen (pc Chrome; de telefoon wordt niet meer ondersteund, besluit S-5).
2. **Fps-onafhankelijke logica:** spellogica op een **vaste tijdstap** (60 Hz) met accumulator, rendering
   interpoleert. Nooit snelheden per frame, altijd per seconde.
3. **Gameplay is op elke grafische stand gelijk:** Low, Mid en High verschillen alleen in uiterlijk,
   nooit in snelheid, bereik, hitboxes of wat je van vijanden kunt zien.
4. **Geen allocaties in de game loop:** hergebruik vectoren en matrices, pooling voor alles wat vaak
   verschijnt (projectielen, effecten, damage-getallen, vijanden).
5. **Data buiten de code:** alle content en balansgetallen in JSON in `public/data/`. Een nieuwe NPC,
   item, vijand of zone is alleen data, geen code.
6. **Alle tekst in taalbestanden:** `public/lang/en.json` en `nl.json`, geen enkele UI-string hardcoded.
   Namen (personages, plekken, items, skills, quests) blijven in beide talen Engels. Teksten noemen nooit
   zelf een toets: gebruik `{keyInteract}`, `{keyDash}`, … zodat de ingestelde toets verschijnt.
7. **Alleen gratis diensten:** GitHub Pages, PeerJS, localStorage. Geen betaalde backend, geen accounts.
8. **Debugmodus:** `?debug=1`, F3 of drie vingers. Toont fps, frametijd, draw calls, triangles, geheugen,
   chunks, zones, positie, grafische stand, seizoen, en een cheatmenu (F6) met teleport.
9. **Niet verder bouwen dan de huidige stap.** Wel de basis zo maken dat latere stappen erop passen.

## 3. Tech stack

- **Three.js** (WebGLRenderer) + **Vite** + **TypeScript** (strict). Build naar `dist/`, deploy via
  GitHub Actions naar GitHub Pages (let op de juiste `base` in `vite.config.ts`).
- **zod** voor de data-schema's; de TypeScript-types komen uit dezelfde schema's.
- Web Workers voor zwaar werk (terreingeneratie, grote chunks). Eigen simpele collision (spatial hash),
  geen physics-engine. **PeerJS** pas vanaf de co-op fase, netwerkcode los van de spelwereld.
- Kleuren in code komen uit `docs/art-style/tokens.json` via `src/render/palette.ts`. Nooit losse hexcodes.
- Commando's: `npm run dev` (met `--host`, zo open je het ook op de telefoon), `npm run lint`,
  `npm run format`, `npm run typecheck`, `npm test`, `npm run build`.

## 4. Projectstructuur

```
/public/data      zones, npcs, quests, items, monsters, player, appearance, quality, spells,
                  skills, stats, combos, seasons, cutscenes, triggers, controls, instances, animations
/public/lang      en.json, nl.json
/public/zones     Blender-exports (o.a. greyhaven/)
/public/characters Geanimeerde modellen (o.a. pringle/pringle.glb)
/src/core         GameLoop, FixedStep, EventBus, StateMachine, Input, Bindings, Random
/src/render       Renderer, QualityManager, CameraRig, DebugOverlay, toon/, cinematic/, Pools
/src/world        WorldStreamer, Zone, Chunk, Terrain, FloatingOrigin, SpatialHash, Colliders,
                  Triggers, Checkpoints, scene/
/src/workers      terrain.worker.ts
/src/entities     Entity/Component, Player, Npc, Enemy, Companion, PlaceholderFactory
/src/systems      Movement, Collision, Interaction, Combat, Enemies, Gear, Quests, …
/src/data         DataLoader, DataValidator, schemas.ts
/src/i18n         I18n
/src/save         SaveManager (versies + migraties)
/src/services     SeasonService
/src/ui           HUD, menus, Dialog, TouchControls, CharacterCreator, Overlays
/src/scenes       Boot, LanguageSelect, CharacterCreate, Title, Intro, World, IntroFight
/docs             PROGRESS.md, ARCHITECTURE.md, MONASTERY.md, art-style/, archive/
/tools/blender    export- en character-scripts
/experiments      oude test-code (niets uit verwijderen zonder te melden)
```

## 5. Conventies

- **Code, bestandsnamen, variabelen, commentaar en commits in het Engels. Uitleg aan Bo en Lucas in het
  Nederlands.**
- **Eén stap per sessie.** Ben je klaar, stop dan, ook als er tijd over is.
- Schrijf eerst een kort plan (bestanden, volgorde, risico's) en **wacht op akkoord** voordat je begint.
- **Kleine commits** met duidelijke berichten, per afgerond onderdeel.
- **Performance controleren** na elk groot onderdeel (fps, draw calls, geheugen in debug) op alle drie de
  grafische standen. Wordt iets trager: eerst oplossen.
- **Tests** (Vitest) voor alle pure logica: formules, data-validatie, save-migraties, streaming-beslissingen,
  seizoen, quality-keuze, mapping. Plus de taal-key-check en de DataValidator.
- **Vraag het Bo en Lucas** als iets uit het concept onduidelijk is of botst met een harde eis, in plaats
  van zelf een grote keuze te maken.
- **Tijdelijke namen** (zie Notities in `PLAN.md`) staan alleen in data, nooit in code. Gebruik je er een,
  meld dan dat de naam nog niet definitief is.
- Nieuwe wensen en besluiten gaan naar `PLAN.md` (als stap of in Notities) en `docs/PROGRESS.md`, niet
  in dit bestand.

## 6. Werken met GitHub

Bo en Lucas werken samen in deze repo, dus niets komt direct in `main`.

- Per stap een eigen branch, daar werken en committen.
- Klaar? Branch pushen en een pull request openen, in gewoon Nederlands: wat er veranderd is, waarom, en
  hoe je het test op pc (toetsenbord en controller).
- Claude mag de pull request zelf samenvoegen in `main` als de stap af is en de game zonder fouten start
  (afgesproken 2026-10-09). Bo of Lucas kan een pull request altijd bekijken of tegenhouden.
- Verandert er iets aan het concept, de stijlgids of een eerdere beslissing? Zet dat bovenaan in de
  pull request en in `docs/PROGRESS.md` → Besluiten.
- Werk na elke stap `PLAN.md` bij (status van de stap) en zet één regel in `docs/PROGRESS.md`.
