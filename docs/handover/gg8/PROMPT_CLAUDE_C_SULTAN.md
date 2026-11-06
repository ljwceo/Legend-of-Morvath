# Startprompt Claude Code — Werkstroom C: Sultan (eigenaar: Bo)

Je werkt aan **Legend of Morvath**, een browser-RPG (Three.js + Vite + TypeScript strict). Je bent de Claude-sessie van **werkstroom C — Sultan**, op **Bo's** computer. Lucas werkt tegelijk aan gameplay (A) en de Greyhaven-wereld (B); Bo werkt ook aan Lucael (D, een aparte sessie). Blijf strikt binnen je eigen werkstroom.

## Lees eerst
1. `CLAUDE.md`: harde eisen, kunststijl (`docs/art-style`), kleuren uit tokens, performance op Low/Mid/High.
2. `HANDOVER_GG8_PARALLEL.md`: §5 (pipeline en afhankelijkheden) en §7 (werkafspraken, conflictkaart). Het staat op de branch `docs/gg8-handover` in `docs/handover/gg8/`.
3. In `docs/PROGRESS.md`: de stukken over Pringle (`Sultan_kat.blend`) en de character-pipeline. In `PLAN.md`: stap 2.6 (Sultan) en Fase A (A.0–A.4: player-export, animaties, spring bones).

## Jouw verantwoordelijkheid
- Sultan in **mensvorm**: het 3D-model, rigging, gezichtsanimatie, textures en de export naar de game.
- **Niet:** Sultans gevecht, zijn AI, balans, quests of dialogen (dat zijn gameplay-werkstromen van Lucas). Pringle, de kat, alleen als dat rig gedeeld wordt; eerst melden.

## Repository en branch
- Game-repo: `github.com/ljwceo/Legend-of-Morvath`, in Bo's eigen clone (het pad weet Bo). Branch `wsC/<onderwerp>` vanaf een verse `origin/main`.
- Blender-bronnen staan **buiten** de game-repo.
  - **ONBEKEND:** waar Bo's Sultan-`.blend` staat, of er een aparte Blender- of asset-repository is, en of die nog gebruikt wordt. **Vraag het Bo en noteer het in je eerste rapport.**

## Bestanden
**Wel** (alleen via een PR, met Bo's akkoord):
- `public/characters/sultan/*` (nieuw);
- `tools/blender/character/*` (scripts), als een gedeeld script echt moet veranderen: meld dat dan, want het raakt ook de speler en Lucael;
- `public/data/animations.json` (de Sultan-clips);
- **alleen** het `model`-veld van de boss `sultan` in `public/data/monsters.json` (nu `"placeholder:sultan"`) en **alleen** de role/model-regel van de Sultan-NPC in `public/data/npcs.json`.

**Niet:**
- `BossAI.ts`, `BossEncounter.ts`, de Sultan-balans in `monsters.json` (HP, schade, aanvallen);
- quests, dialogen en `lang/*`, behalve een nieuwe naamsleutel na overleg;
- `WorldState.ts` zonder overleg met Lucas.

**Nooit:** Greyhaven-GLB/Blender (B), Lucael-bestanden (D), `GG4b/test`, `CLAUDE.md`. Geen nieuwe lore.

## Actuele status (wat aantoonbaar bekend is)
- **In de game:** Sultan is als boss een **placeholder** (`monsters.json` → `model: "placeholder:sultan"`); `public/characters/` bevat alleen `pringle.glb`. Na het gevecht staat Sultan als NPC bij de poort, ook als placeholder (`PROGRESS.md`: "blijft de placeholder tot het mensmodel klaar is").
- **Pringle** (de kat, later Sultan) komt uit Bo's `Sultan_kat.blend` (buiten de repo): 35 botten, de clips Idle, Walk en Run.
- **Geen commits van Bo** op GitHub sinds **18-10-2026**.
- **ONBEKEND:** de huidige stand van het mensmodel, de rig, het gezicht, de textures, de exportproblemen. **Niet invullen of raden: vragen.**
- **Pipeline (code):**
  - `tools/blender/character/` en `04_export_player.py` (speler);
  - `tools/blender/pringle/`;
  - een dev-only previewpagina voor `player.glb` (commit `00cb6a1`);
  - geanimeerde NPC's via `npcs.json` → `roles` → `animated` + een `.glb` (`PLAN.md`:146);
  - toon-shading en `materials.json`.

## Eerste concrete taak (inventaris, niets wijzigen)
**"Sultan: statusopname en exportplan."**
1. Vraag Bo welke `.blend` de bron is en waar hij staat. Lees die alleen (geen opslaan) en noteer: objecten, mesh/polycount, skelet (botnamen, aantal), shape keys/gezicht, materialen en textures (resolutie), acties/clips.
2. Vergelijk met wat de game verwacht. Kijk naar Pringle en de speler: botnamen, schaal, clipnamen in `animations.json`, het exportscript, `materials.json`, en het texturebudget per stand.
3. Maak een **exportplan**: welk script, welke instellingen, welke validatie (schaal, botten, clips, polycount, texturegrootte, fps-impact). Plus hoe de placeholder straks wordt vervangen: welke regels in `monsters.json` en `npcs.json`.
4. Lever een rapport en **wacht op akkoord van Bo**. Wijzig niets in Blender of in de repo.

## Test- en acceptatiecriteria
- **Acceptatie in de game** (later): Sultan zichtbaar als boss en als NPC, met de clips die de AI vraagt.
  - Geen consolefouten.
  - fps op Low/Mid/High gelijk of beter dan de placeholder, of een besproken budget.
  - Een schermafbeelding.
  - De sha256 van de GLB en de bron in de PR.
- Unit-tests en de DataValidator slagen. De volledige CI is groen (`format:check` op een LF-kopie).
- Bo keurt het visueel goed; Lucas keurt de integratie goed.

## Grenzen aan autonome wijzigingen
- **Blender alleen na een expliciet akkoord van Bo** op een concreet plan, op een **kopie** van het bronbestand (hash vóór en na).
- Geen wijzigingen aan Sultans gedrag of balans.
- Een gedeeld script of `animations.json`-structuur aanpassen: eerst overleggen. Dat raakt de speler en Lucael.

## Rapportageformat (Nederlands)
- Een statusblok: branch, commit, bronbestand + hash.
- Een inventaristabel, met per punt BEKEND / ONBEKEND.
- Een plan; risico's (bestanden die met A of D botsen); een vraag om akkoord.

## Git-regels
- Kleine Engelse commits; auteur `Claude <noreply@anthropic.com>` met de `Co-Authored-By`-regel.
- **Pushen alleen als Bo daar expliciet om vraagt.** PR's altijd als **draft** naar `main`, één asset-onderwerp per PR; **alleen Lucas merget**.
- `.blend`-bestanden nooit in de game-repo. Een GLB alleen samen met de minimale data-regel die hem aanzet.
- Eén Claude-sessie per worktree of map. De Lucael-sessie (D) werkt in een eigen map.
