# Startprompt Claude Code — Werkstroom A: Academy Gameplay (eigenaar: Lucas)

Je werkt aan **Legend of Morvath**, een browser-RPG (Three.js + Vite + TypeScript strict). Je bent de Claude-sessie van **werkstroom A — Academy Gameplay**. Er draaien tegelijk andere sessies voor B (Greyhaven-wereld), C (Sultan) en D (Lucael). Blijf strikt binnen je eigen werkstroom.

## Lees eerst
1. `CLAUDE.md` in de repository: harde eisen, conventies, data-gedreven werken, teksten in `public/lang`.
2. Het overdrachtsrapport `HANDOVER_GG8_PARALLEL.md`: §3 tutorialstatus, §4 open problemen en §7 werkafspraken. Het staat op de branch `docs/gg8-handover` in `docs/handover/gg8/`.
3. Alleen de stukken van `docs/PROGRESS.md` en `PLAN.md` die je nodig hebt.

## Jouw verantwoordelijkheid
- De drie Academy-paden: zwaard (Sir Garrick, trainingsveld), licht (Master Brink, toren) en donker (Wizard Sam, kelder).
- De negen Entrance Exams: drie per pad.
- Questprogressie vanaf Your Resolve tot "The city gate is open".
- Save/load over die hele route.
- Tutorial voltooien: alles **tot** de stadspoort. De poort zelf en de landuitgang zijn van werkstroom B.

## Repository en branch
- Repo: `github.com/ljwceo/Legend-of-Morvath`. Werk in je eigen worktree, bijvoorbeeld `C:\Users\claud\Morvath\wsA_academy`. Lucas maakt die aan en noemt het exacte pad.
- Branch: `wsA/<onderwerp>`, gemaakt vanaf een **verse `origin/main`**, en pas **nadat** PR-A van GG.8 gemerged is.
  - **Controleer vóór je begint** dat `origin/main` de commits `2b00255` t/m `d92f4ac` bevat (`git log origin/main --oneline | head`). Zo niet: stop en meld het.
- Dev-server: een eigen poort (voorstel 5195) via `.claude/launch.json`. Nooit de poorten 5191–5194.

## Bestanden
**Wel** (jouw eigendom):
- `public/data/quests.json`;
- de dialoog- en questvelden van leraren en NPC's in `public/data/npcs.json`;
- quest- en examenteksten in `public/lang/en.json` en `nl.json` (alleen sleutels **toevoegen**);
- `src/systems/Quests*`, `PathChoice*`, `WaveFight*`;
- de examenregels in `Casting.ts`;
- de quest- en examenkoppeling in `src/scenes/WorldState.ts`;
- tests in `src/**`.

**Niet zonder overleg:**
- `zones.json`, `triggers.json` (de poortplek), `src/world/*` en de travel/instance-code in `WorldState`: werkstroom **B**;
- `src/save/SaveData.ts` / `SAVE_VERSION`: één ophoging tegelijk in de hele repo; eerst melden.
- Balanswaarden (`monsters.json`, `player.json`, `stats.json`): alleen met akkoord.

**Nooit:**
- `public/zones/**/*.glb`, Blender-bestanden;
- `public/characters/*`, `animations.json`, de Sultan- en Lucael-velden in `npcs.json`, `monsters.json` en `cutscenes.json`: werkstromen C en D, Bo;
- `GG4b/test`, de map `GG8_tutorial_p0`;
- `CLAUDE.md` (alleen via een aparte docs-PR met akkoord).
- Geen nieuwe lore zonder overleg.

## Actuele status
**Handmatig** (Lucas):
- Your Resolve gespeeld en een pad gekozen. Lucas noemt het het **"Nature Path"**. In de data bestaan alleen de paden zwaard, licht en donker; "Nature" is een kristal uit Brinks Crystal Ceremony. **Vraag Lucas welk pad en welke save.**
- De slime-training (drill) gestart, maar niet afgerond.

**Automatisch:** `PathChoice.test.ts`, `Quests.test.ts`, `WaveFight.test.ts`, `Balance.test.ts` en `Triggers.test.ts` dekken de logica.

**Niet bewezen:**
- de koppeling in `WorldState` (dialogen, grants, Crystal Ceremony, treffers tellen, drill starten);
- alle negen examens in de echte game.

**Bekende problemen in jouw stroom** (rapport §4):
- **Aim assist** trekt aanvallen naar trainingspoppen: `assistedHeading` filtert alleen op `hittable`.
- **P1-2:** de leraar zegt "Your Entrance Exam will be ready soon", maar het examen staat al klaar.
- **P1-3:** toren en kelder zijn niet te vinden (geen marker).
- **P1-4:** magiërsexamen 3 noemt de verkeerde knop (cast = V = Push; de spreuk zit op de rechtermuisknop), een te zwak opgeladen schot telt stil niet, en mana is krap.
- **P1-5:** doodgaan op het veld kost een lange weg terug, al je goud, en de drill begint opnieuw. Dat is een ontwerpvraag.
- **Sultans eindfilm:** herladen tijdens de film maakt de overwinning ongedaan (`BossEncounter.takeDefeat`). Overleg eerst: het raakt Sultan.
- **First Harvest:** vraagt `blossom`, maar die is nergens te krijgen (optioneel, ontwerpkeuze).

**Hulpmiddelen** (dev-build of `?debug=1`): F6-cheats. Invincibility, Max All Stats, Kill Nearby Enemies (F8) en Monsters Off blijven aan bij gebiedswissels.

## Eerste concrete taak (alleen onderzoek, geen code)
**"Bewijs één volledig pad in de echte game, van Your Resolve tot 'The city gate is open'."**
1. Stel met Lucas vast welk pad en welke save.
2. Maak een **read-only audit** van de koppeling in `WorldState` voor dat pad: dialoog → accept → grant → (ceremony) → tellen → drill → inleveren. Noem bestand en regel.
3. Maak een **speelplan**:
   - één run **met** cheats, om snel de route te vinden;
   - één eindrun **zonder** cheats, als acceptatie.
4. Speel het **zelf** in de ingebouwde browser, in een eigen testprofiel. Raak nooit Lucas' save aan; maak eerst een export.
   - Log elke blokkade met reproductie en prioriteit P0/P1/P2.
5. Lever een rapport en **wacht op akkoord** voordat je iets repareert.

## Test- en acceptatiecriteria
- **Unit-tests zijn niet genoeg.** Acceptatie betekent: Lucas speelt het pad zonder cheats tot "The city gate is open", en herladen onderweg kost geen voortgang.
- Per reparatie:
  - een regressietest die aantoonbaar **faalt op de oude code**;
  - `npm run typecheck`, `lint`, `format:check` (op een LF-kopie, zoals CI), `test` en `build` slagen;
  - getest in de echte game.
- Geen nieuwe consolefouten; de performance blijft gelijk (`CLAUDE.md` §5).

## Grenzen aan autonome wijzigingen
- **Eerst een plan, dan wachten op akkoord** (`CLAUDE.md` §5). Eén stap per sessie.
- Geen wijzigingen aan balans, Sultan, Lucael, Blender, GLB, de save-versie of andermans bestanden zonder expliciet akkoord.
- Twijfel over het concept? Vraag het; maak geen grote keuze zelf.

## Rapportageformat (Nederlands)
- Een kort statusblok: branch, commit, wat wel en niet gedaan.
- Een tabel met bevindingen: probleem, bewijs (bestand:regel, test of schermafbeelding), prioriteit, label (HANDMATIG / GAME-CHECK / AUTO / ONBEKEND).
- Gewijzigde bestanden; testresultaten (ook de proef op de oude code); risico's.
- Handmatige testinstructies voor Lucas.
- Sluit af met één concrete vraag om akkoord.

## Git-regels
- Kleine commits in het Engels, één onderwerp per commit; auteur `Claude <noreply@anthropic.com>` en de `Co-Authored-By`-regel.
- **Geen push, PR of merge zonder expliciet akkoord van Lucas.**
  - PR's altijd als **draft**, één onderwerp, Nederlandse beschrijving (wat, waarom, hoe testen).
  - **Alleen Lucas merget.**
- Elke ochtend `git fetch` en `main` bijwerken. Nooit werken vanaf een branch die verouderd is.
- Eén Claude-sessie per worktree. Werk nooit in de worktree van B.
- Raak `docs/PROGRESS.md` alleen aan met één regel onderaan, als het een PR wordt.
