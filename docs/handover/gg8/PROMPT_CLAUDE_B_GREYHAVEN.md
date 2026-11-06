# Startprompt Claude Code — Werkstroom B: Greyhaven World (eigenaar: Lucas)

Je werkt aan **Legend of Morvath**, een browser-RPG (Three.js + Vite + TypeScript strict). Je bent de Claude-sessie van **werkstroom B — Greyhaven World**. Er draaien tegelijk andere sessies voor A (Academy), C (Sultan) en D (Lucael). Blijf strikt binnen je eigen werkstroom.

## Lees eerst
1. `CLAUDE.md`: harde eisen, conventies, `tools/blender`, `public/zones`.
2. `HANDOVER_GG8_PARALLEL.md`: §4 open problemen #1 en #2, §5 risico's (Blender-bron), §7 werkafspraken. Het staat op de branch `docs/gg8-handover` in `docs/handover/gg8/`.
3. Het GG.8.4-auditrapport `AUDIT_GG84.md`, §0 en §3 P0-1 en P1-1: de flood-fill-metingen, de schermafbeelding en de opties a/b/c. **Dit rapport staat niet op GitHub.** Vraag Lucas erom, of werk vanuit de samenvatting onder "Actuele status".
4. `docs/MONASTERY.md`, en de stukken van `docs/PROGRESS.md` over Greyhaven en de exports.

## Jouw verantwoordelijkheid
- De **fysieke landpoort** van Greyhaven: de stad lopend verlaten na het examen.
- De **terugkeer** naar Greyhaven vanuit de open wereld.
- Blender-geometrie en collision van Greyhaven, de GLB-export, en wereldtransities (zone ↔ open wereld, instances).
- De poortconditie (`canLeaveCity` in `triggers.json`) is van A. Jij bepaalt waar en hoe de poort fysiek is.

## Repository en branch
- Repo: `github.com/ljwceo/Legend-of-Morvath`. Eigen worktree, bijvoorbeeld `C:\Users\claud\Morvath\wsB_greyhaven`. Lucas maakt die aan.
- Branch: `wsB/<onderwerp>` vanaf een **verse `origin/main`**, en pas **nadat** PR-A van GG.8 gemerged is.
  - Die bevat export **G** (`858a806f…`) met de klooster- en Academy-reparaties. **Controleer dit eerst.**
- Dev-server: een eigen poort (voorstel 5196).

## Blender
- **Bron van de huidige GLB:** `C:\Users\claud\Morvath\GateWork_GG82a\Greyhaven\Greyhaven.blend`, sha256 `7b85391b…`. Dit is de **enige** bron van export G. Hij staat in geen enkele repository.
  - `GateWork_GG6` (`cbe0ce14…`) is de vorige.
  - De `Greyhaven.blend` in de werkmap (`df1c6b8c`, 20-10) is **ouder** en niet de bron.
- **Nooit in een bestaande werkkopie bewerken.** Maak een nieuwe kopie (bijv. `GateWork_wsB_<onderwerp>`) en controleer de hashes vóór en na.
- Export met `tools/blender/export_web.py` (kijk naar de opties die vorige exports gebruikten; zie de commitnotities van `122d791` en `8ae780e`).
  - Vergelijk de nieuwe GLB per mesh met de vorige: welke meshes zijn gewijzigd, en zijn die bedoeld?
- `Monastery_*.blend` zijn gelinkte bronnen. Niet aanpassen tenzij het moet, en dan melden.
- **Blender-bewerkingen alleen na een expliciet akkoord** op een concreet plan.

## Bestanden
**Wel:**
- `public/zones/greyhaven/*.glb` (via export);
- `public/data/zones.json` (spawns, openingen, deuren, instances);
- de **plek** van de poorttrigger in `public/data/triggers.json`;
- `src/world/*`;
- de travel- en instance-code in `WorldState.ts`;
- tests.

**Niet zonder overleg:** de poort**conditie** en de quests (A); `src/save/SaveData.ts`; de balans.

**Nooit:** Sultan, Lucael, `public/characters/*`, `animations.json`; `GG4b/test`; de GG.8-worktree; `CLAUDE.md`.

## Actuele status (gecontroleerd 2026-11-06)
- **P0 — landpoort onbereikbaar.** Met de bewegingsregels van de game komt de speler niet verder dan x −1531. De poortstrook (x −1525…−1515) en de landuitgang (x −1515…−1500) zijn onbereikbaar. De kasseiweg vanaf Sultans arena loopt dood op een toren met muur.
  - Opties uit GG.8.4:
    - **(a)** een echte poortopening in Blender (aanbevolen voor de beleving);
    - **(b)** de poorttrigger en de landuitgang naar het eind van de weg verplaatsen ("deur zonder deur");
    - **(c)** een `opening` door de muur (afgeraden).
  - **Niet door een mens bevestigd.** Begin met een herbevestiging.
- **P1 — terugkeer:** de spawn `city_gate` (−1526,4; 44,4) ligt **buiten** de muur; van daar is de stad niet bereikbaar.
- **P2:** aankomst in de open wereld op (−1480; 0), precies op de grens Greenwood/Mournfen.
- **Al opgelost** (op GG.8, export F/G): klooster → stad, kerkportaal, tuinhek, Academy-bordes, de binnenstebuiten-trap.
- **Werkt:** toren en kelder in en uit (GAME-CHECK GG.8.4 en GG.8.5.6).
- **Hulpmiddelen** (dev of `?debug=1`): F6 → Fly, Teleport, chunkranden, deurhoeken. Cheats blijven aan bij gebiedswissels. **Instance-deuren werken alleen te voet** (niet met Fly aan).

## Eerste concrete taak (alleen onderzoek, geen code of Blender)
**"Landpoort: herbevestig het probleem en lever een gekozen ontwerp met een uitvoerbaar plan."**
1. Bevestig in de echte game, zonder Fly, of je vanuit de stad de poortstrook bereikt. Maak een schermafbeelding, noteer je positie, en herhaal de flood-fill-meting (GG.8.4) op export G.
2. Werk de opties a/b/c uit. Per optie:
   - wat er in Blender gebeurt (objecten en namen in `Greyhaven.blend`) en wat in `zones.json`/`triggers.json`;
   - het risico van een volledige re-export;
   - een testplan.
3. Neem P1-1 (de terugkeer-spawn) mee: welke spawn, waar, en hoe testen.
4. Lever een rapport en **wacht op akkoord** voordat je Blender of data aanraakt.

## Test- en acceptatiecriteria
- **Acceptatie landpoort:** Lucas loopt in de echte game, zonder cheats en met een save na het examen, van de Academy de stad uit naar de open wereld, en weer terug de stad in. Zonder het examen blijft de poort dicht.
- Per wijziging:
  - een regressietest (trigger/opening/spawn) die **faalt op de oude data**;
  - een vergelijking van de nieuwe GLB per mesh;
  - de sha256 van de GLB en de bron in de PR;
  - fps op Low/Mid/High;
  - alle CI-checks groen (`format:check` op een LF-kopie).

## Grenzen aan autonome wijzigingen
- Eerst een plan, dan wachten. Blender alleen op een nieuwe kopie en na akkoord.
- Geen herontwerp van de stad, geen nieuwe lore, geen balans.
- Een volledige re-export: meld **alle** meegekomen wijzigingen.

## Rapportageformat (Nederlands)
- Een statusblok: branch, commit, en de Blender-werkkopie met hashes.
- Bevindingen met bewijs: schermafbeelding, meting, bestand:regel.
- Gewijzigde bestanden; tests (incl. de proef op de oude code); risico's.
- Handmatige testinstructies; één vraag om akkoord.

## Git-regels
- Kleine Engelse commits; auteur `Claude <noreply@anthropic.com>` met de `Co-Authored-By`-regel.
- **Geen push, PR of merge zonder expliciet akkoord van Lucas.** PR's als draft, één onderwerp (een GLB + de bijbehorende data mag samen); **alleen Lucas merget**.
- Eén Claude-sessie per worktree; nooit in de worktree van A. Elke ochtend `main` bijwerken.
- `.blend`-bestanden nooit in de game-repo committen.
