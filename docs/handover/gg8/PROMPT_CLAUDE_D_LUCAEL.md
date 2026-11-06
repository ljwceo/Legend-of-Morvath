# Startprompt Claude Code — Werkstroom D: Lucael (eigenaar: Bo)

Je werkt aan **Legend of Morvath**, een browser-RPG (Three.js + Vite + TypeScript strict). Je bent de Claude-sessie van **werkstroom D — Lucael**, op **Bo's** computer. Lucas werkt tegelijk aan gameplay (A) en de Greyhaven-wereld (B); Bo werkt ook aan Sultan (C, een aparte sessie). Blijf strikt binnen je eigen werkstroom.

## Lees eerst
1. `CLAUDE.md`: harde eisen, kunststijl, performance op Low/Mid/High. §1 noemt Lucael: een van de twee demi-god necromancers.
2. `HANDOVER_GG8_PARALLEL.md`: §5 en §7. Het staat op de branch `docs/gg8-handover` in `docs/handover/gg8/`.
3. `docs/intro-cinematic-design.md` (waar Lucael voorkomt), `public/data/cutscenes.json` (intro), en de Fase A-stukken in `PLAN.md`/`docs/PROGRESS.md`: A.3 animaties en de upper-body-laag, A.4a/A.4b spring bones en cape-collision. Die laatste zijn bruikbaar voor jas en secondary motion.

## Jouw verantwoordelijkheid
- Lucael: rig, animatieproblemen, **jasclipping**, **secondary motion** (jas, haar, accessoires), en **exportvalidatie** naar de game.
- **Niet:** de intro-gameplay, dialogen of de lore van Lucael (nieuwe lore alleen na overleg met Bo en Lucas); Baelor, tenzij Bo dat vraagt.

## Repository en branch
- Game-repo: `github.com/ljwceo/Legend-of-Morvath`, in Bo's eigen clone. Branch `wsD/<onderwerp>` vanaf een verse `origin/main`.
- Blender-bronnen staan buiten de game-repo.
  - **ONBEKEND:** waar Lucaels `.blend` staat en of er een aparte asset-repository wordt gebruikt. **Vraag het Bo.**

## Bestanden
**Wel** (alleen via een PR, met Bo's akkoord):
- `public/characters/lucael/*` (nieuw);
- de Lucael-clips in `public/data/animations.json`;
- **alleen** de `model` van de actor `lucael` in `public/data/cutscenes.json` (nu `"fight"`);
- scripts in `tools/blender/character/*` alleen na overleg, want gedeeld met de speler en Sultan.

**Niet:**
- de cutscene-tijdlijn en dialogen in `cutscenes.json` (behalve het `model` van de actor);
- `IntroSceneState.ts` en `WorldState.ts` zonder overleg met Lucas;
- `lang/*` (geen nieuwe teksten zonder overleg).

**Nooit:** de Sultan-bestanden (C), Greyhaven-GLB/Blender (B), quests (A), `GG4b/test`, `CLAUDE.md`.

## Actuele status (wat aantoonbaar bekend is)
- **In de game:** Lucael verschijnt in het **intro-gevecht** (paneel 4) als actor `lucael` met het **placeholder**-model `"fight"` (`cutscenes.json`). Er is geen Lucael-GLB in `public/characters/`.
- **Bekende problemen** (genoemd door Lucas): rig- en animatieproblemen, jasclipping, secondary motion, exportvalidatie. **Details ONBEKEND: vraag Bo** welke clips en welke situaties, en maak per probleem een reproductie.
- **Geen commits van Bo** op GitHub sinds **18-10-2026**.
- **Bruikbare bestaande techniek:**
  - spring bones en cape-collision van de speler (Fase A.4a/A.4b, met cheats in F6 voor de cape);
  - de upper-body-laag (A.3d);
  - een dev-only clip-preview voor `player.glb` (commit `00cb6a1`).
- **Nog niet gecontroleerd:** of die techniek per model werkt of alleen voor de speler.

## Eerste concrete taak (inventaris en reproductie, niets wijzigen)
**"Lucael: problemen reproduceren en een exportvalidatieplan maken."**
1. Vraag Bo om het bronbestand. Lees het alleen (geen opslaan) en noteer:
   - het skelet (botten, namen, hiërarchie) en de gewichten van de jas;
   - acties/clips, en shape keys;
   - meshes en polycount, materialen en textures.
2. Maak per probleem (rig, animatie, jasclipping, secondary motion) een **reproductie**: welke clip, welk frame, schermafbeelding. Geef de vermoedelijke oorzaak (gewichten, ontbrekende botten, collision) met bewijs.
3. Vergelijk met de game-pipeline:
   - het exportscript;
   - clipnamen in `animations.json`;
   - of spring bones en cape-collision (A.4) toepasbaar zijn op Lucaels jas, met bestand:regel;
   - het texturebudget per stand.
4. Maak een **exportvalidatieplan**: schaal, botnamen, clips, polycount, texturegrootte, een test in een dev-preview, en fps.
5. Lever een rapport en **wacht op akkoord van Bo**. Wijzig niets.

## Test- en acceptatiecriteria
- **Acceptatie** (later): Lucael in het intro-gevecht zichtbaar met een correcte rig.
  - Geen zichtbare jasclipping in de gebruikte clips.
  - Secondary motion stabiel bij 60 en 120 fps.
  - Geen consolefouten; fps op Low/Mid/High binnen het budget.
  - Een schermafbeelding of korte opname; de sha256 van de GLB en de bron in de PR.
- CI groen. Bo keurt het visueel goed, Lucas de integratie.

## Grenzen aan autonome wijzigingen
- **Blender alleen na een expliciet akkoord van Bo,** op een **kopie** (hash vóór en na).
- Geen wijzigingen aan de intro-tijdlijn, aan gameplay of aan lore.
- Gedeelde scripts en de structuur van `animations.json`: eerst overleggen (raakt C en de speler).

## Rapportageformat (Nederlands)
- Een statusblok: branch, commit, bronbestand + hash.
- Per probleem: reproductie, oorzaak, bewijs, en BEKEND / ONBEKEND.
- Een plan; risico's; één vraag om akkoord.

## Git-regels
- Kleine Engelse commits; auteur `Claude <noreply@anthropic.com>` met de `Co-Authored-By`-regel.
- **Pushen alleen als Bo daar expliciet om vraagt.** PR's als **draft**, één asset-onderwerp; **alleen Lucas merget**.
- `.blend`-bestanden nooit in de game-repo.
- Eén Claude-sessie per worktree of map. De Sultan-sessie (C) werkt in een eigen map.
