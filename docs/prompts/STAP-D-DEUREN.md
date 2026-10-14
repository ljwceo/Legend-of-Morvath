# Prompts voor Stap D – Deuren die meezwaaien

De stap zelf (doel, eisen en D.1 t/m D.4) staat in `PLAN.md` → **Stap D**. Hieronder staat per chat
de prompt die je plakt: één per chat, in deze volgorde, elk ±30 minuten. Open de volgende chat pas
als de pull request van de vorige in `main` zit.

Tussen de chats zelf doen: na chat 2 de aannames over de scharnierkant en de vrije graden in Blender
nakijken (en in `zones.json` aanpassen als ze niet kloppen); na chat 3 met de cheat kijken of niets
van het kozijn meedraait voordat je chat 4 start.

## Chat 1 – D.1 Fysica-module met tests

```
**Invullen**
- Stap: D.1 Fysica-module met tests (lees ook de kop en de eisen van "Stap D" in PLAN.md)
- Extra voor deze keer: niets

**Opdracht**
Je werkt aan Legend of Morvath in de repo `ljwceo/Legend-of-Morvath`.

1. Lees `CLAUDE.md` en uit `PLAN.md` alleen "Stap D" (de kop, de eisen en D.1). Lees `src/systems/Movement.ts` alleen om de stijl van een systeem op de vaste tijdstap over te nemen, en `public/data/player.json` voor de dash-snelheid.
2. Geef een korte samenvatting in het Nederlands: wat je gaat doen (bestanden, volgorde, risico's).
3. **Wacht op mijn OK** voordat je begint.
4. Doe alleen D.1: de module en de tests, nog niets aan de game gekoppeld. Ben je klaar, stop dan.
5. Na de stap: D.1 in `PLAN.md` op `[x]`, één regel in `docs/PROGRESS.md` (sessielog en de tabel "Nu"), commit, push, pull request in gewoon Nederlands, en zeg dat D.2 de volgende is.
```

## Chat 2 – D.2 Data, schema en validator

```
**Invullen**
- Stap: D.2 Data, schema en validator (lees ook de kop en de eisen van "Stap D" in PLAN.md)
- Extra voor deze keer: niets

**Opdracht**
Je werkt aan Legend of Morvath in de repo `ljwceo/Legend-of-Morvath`.

1. Lees `CLAUDE.md` en uit `PLAN.md` alleen "Stap D" (de kop, de eisen en D.2). Lees uit `docs/MONASTERY.md` alleen het blok "In de game (2026-10-14)" over de deuren en de tabel met de deurobjecten, en uit `docs/ARCHITECTURE.md` alleen het stukje over coördinaten in een Blender-zone. Kijk in `src/data/schemas.ts` en `src/data/DataValidator.ts` hoe `openings` nu gevalideerd wordt en doe het net zo.
2. Geef een korte samenvatting in het Nederlands: wat je gaat doen (bestanden, volgorde, risico's), met per deur je aanname over de scharnierkant en de vrije graden.
3. **Wacht op mijn OK** voordat je begint.
4. Doe alleen D.2. Ben je klaar, stop dan.
5. Na de stap: D.2 in `PLAN.md` op `[x]`, één regel in `docs/PROGRESS.md` (sessielog, tabel "Nu", en per deur de aannames voor mij om na te kijken in Blender), commit, push, pull request in gewoon Nederlands, en zeg dat D.3 de volgende is.
```

## Chat 3 – D.3 Deuren knippen en tekenen

```
**Invullen**
- Stap: D.3 Deuren knippen en tekenen (lees ook de kop en de eisen van "Stap D" in PLAN.md)
- Extra voor deze keer: niets

**Opdracht**
Je werkt aan Legend of Morvath in de repo `ljwceo/Legend-of-Morvath`.

1. Lees `CLAUDE.md` en uit `PLAN.md` alleen "Stap D" (de kop, de eisen en D.3). Lees `src/world/scene/SceneZone.ts`, `src/world/scene/SceneFilter.ts` (`filterGeometry`) en in `src/scenes/WorldState.ts` alleen `buildSceneZone`, `render` en het cheatmenu. Lees uit `docs/ARCHITECTURE.md` alleen het stuk over de Blender-zone.
2. Geef een korte samenvatting in het Nederlands: wat je gaat doen (bestanden, volgorde, risico's), en zeg welke maten je voor de dozen gebruikt.
3. **Wacht op mijn OK** voordat je begint.
4. Doe alleen D.3: knippen, tekenen en de cheat, nog geen fysica in de game. Ben je klaar, stop dan.
5. Na de stap: D.3 in `PLAN.md` op `[x]`, één regel in `docs/PROGRESS.md` (sessielog en de tabel "Nu", met de draw calls en de uitslag van mem-check), commit, push, pull request in gewoon Nederlands met hoe ik de cheat op pc en iPhone bekijk, en zeg dat D.4 de volgende is.
```

## Chat 4 – D.4 Koppelen aan de speler

```
**Invullen**
- Stap: D.4 Koppelen aan de speler (lees ook de kop en de eisen van "Stap D" in PLAN.md)
- Extra voor deze keer: niets

**Opdracht**
Je werkt aan Legend of Morvath in de repo `ljwceo/Legend-of-Morvath`.

1. Lees `CLAUDE.md` en uit `PLAN.md` alleen "Stap D" (de kop, de eisen en D.4). Lees `src/systems/HingedBodies.ts` (uit D.1), het deurstuk van `src/world/scene/SceneZone.ts` (uit D.3), en in `src/scenes/WorldState.ts` alleen `update`, `render` en hoe de speler via `SceneZone.moveCircle` beweegt (de substappen en de dash in `src/systems/Movement.ts`). Lees uit `docs/ARCHITECTURE.md` alleen de stukken over de Blender-zone en over beweging.
2. Geef een korte samenvatting in het Nederlands: wat je gaat doen (bestanden, volgorde, risico's), en hoe je de dash-substappen als duwer aanlevert zonder allocaties.
3. **Wacht op mijn OK** voordat je begint.
4. Doe alleen D.4. Meet daarna fps en draw calls op Low, Mid en High in het klooster, voor en na. Ben je klaar, stop dan.
5. Na de stap: D.4 in `PLAN.md` op `[x]` en Stap D op klaar, `docs/ARCHITECTURE.md` bijwerken met een stukje over deuren, één regel in `docs/PROGRESS.md` (sessielog, tabel "Nu" en de meetgetallen), commit, push, pull request in gewoon Nederlands met genummerde stappen om het op pc en iPhone te testen (door alle drie de deuren lopen van beide kanten, dashen tegen een deur, `?fps=30` en `?fps=120`), en zeg welke stap de volgende is.
```
