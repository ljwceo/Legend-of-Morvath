# Legend of Morvath — overdracht GG.8 en voorbereiding parallelle ontwikkeling (2026-11-06)

> **Update (2026-11-06, later op de dag), met akkoord van Lucas:**
> - `claude/greyhaven-tutorial-p0` is **naar GitHub gepusht**, zonder force; de remote staat exact op `f3f1a45`.
> - Er is **nog geen PR en niets gemerged**.
> - Deze vijf documenten staan op de aparte branch `docs/gg8-handover` (map `docs/handover/gg8/`), vanaf `main`.
> - Waar hieronder "GG.8 staat alleen lokaal" staat, geldt dat dus niet meer. De Blender-bron van export G (`GateWork_GG82a`) staat nog wel **alleen lokaal**.

Dit document is gemaakt op basis van de **actuele Git-stand van vandaag** (`git fetch` om ±16:20). Oude rapporten zijn alleen gebruikt waar ik ze opnieuw tegen de code heb gecontroleerd.

**Voor deze overdracht is niets gewijzigd:** geen code, geen commit, geen push, geen PR, geen Blender. Alleen `git fetch` werd gedraaid; daarbij zijn de PR-koppen #115 en #119 lokaal als `pr/115` en `pr/119` opgehaald.

**Labels** in dit document:

| Label | Betekenis |
|---|---|
| **HANDMATIG** | door Lucas gespeeld en goedgekeurd |
| **GAME-CHECK** | door Claude in de echte game gecontroleerd, meestal in een testprofiel met cheats |
| **AUTO** | unit-tests of simulatie |
| **ONBEKEND** | niet aantoonbaar |

---

## 1. Git- en repositorystatus (actueel)

| Wat | Stand |
|---|---|
| Repository | `github.com/ljwceo/Legend-of-Morvath`, één remote `origin` |
| `origin/main` | `9260afe` (merge van PR #118, 2026-10-19). **Sinds 19 oktober niets nieuws op `main`.** |
| Werkbranch GG.8 | `claude/greyhaven-tutorial-p0`, tip **`f3f1a45`**, schoon. **Alleen lokaal: bestaat niet op GitHub.** |
| GG.8 t.o.v. `main` | **12 commits voor, 0 achter**, lineair (geen merges), 37 bestanden, +5811/−75 |
| GG.8-worktree | `C:\Users\claud\Morvath\GG8_tutorial_p0` (worktree van de hoofdclone) |
| Hoofdclone | `C:\Users\claud\OneDrive\Documenten\Bedrijfskunde WDH\Legend-of-Morvath`, schoon, uitgecheckt op `claude/gallant-lovelace-mz8icm` (= PR #119) |
| `GG4b/test` | `C:\Users\claud\Morvath\GG4b\test`: aparte clone, **losse HEAD** `9260afe`, 22 niet-gecommitte bestanden, geen remote. Alle reparaties daaruit zitten in GG.8 (GG.8.1). **Onaangeroerd laten.** |
| Open PR's | **#119** en **#115**. Alleen deze twee hebben nog een merge-ref; de GitHub-API gaf vanaf deze machine een time-out (504) en `gh` is niet geïnstalleerd. |
| Remote branches | 104, waarvan 58 al in `main`; 46 niet gemerged (oude stappen, klooster-experimenten, auto-runs) |
| Bo op GitHub | 47 commits als "Bo Blokker", **allemaal PR-merges van 14–18 oktober**. **Geen nieuwe commits van Bo sinds 18 oktober.** |
| CI | `.github/workflows/deploy.yml`: `lint`, `format:check`, `typecheck`, `test`, `build` op elke PR; deploy naar Pages alleen vanaf `main` |

### Open PR's, gecontroleerd met `git merge-tree` (proefmerge, niets gewijzigd)

| PR | Branch | Stand | Merge met `main` | Met GG.8 samen |
|---|---|---|---|---|
| **#119** G.5 Flasks (draft) | `claude/gallant-lovelace-mz8icm` @ `d1bfea6` | 8 voor, 0 achter; 40 bestanden; **save v22** | **schoon** | **1 conflict** in `WorldState.ts` → `interact()`: GG.8 voegt een deurtak toe, #119 verplaatst het rusten naar `rest()`. Klein en met de hand op te lossen. |
| **#115** W.1 Morvath V1 (draft) | `claude/elegant-faraday-aiahna` @ `3a64ebb` | 5 voor, **23 achter**; 28 bestanden; save v20 | conflict in `docs/PROGRESS.md` | conflict in `docs/PROGRESS.md`; overlapt ook in `zones.json`, `WorldState.ts`, `schemas.ts`, `DataValidator*`, `lang/*` |

Gedeelde bestanden van GG.8 en #119: `lang/en.json`, `lang/nl.json`, `DataValidator(.test).ts`, `schemas.ts`, `WorldState.ts`, `CheatPanel.ts`. Alleen `WorldState.ts` geeft een echt conflict.

---

## 2. Afgeronde werkzaamheden GG.8.1 t/m GG.8.5.6

| Onderdeel | Commit(s) | Wat | Gevalideerd |
|---|---|---|---|
| **Slime-goud en Just For You** (GG.8.1) | `2b00255` | Green Slime laat 2 goud vallen, zodat Marco's drankjes altijd haalbaar blijven en Defeat Sultan altijd start | HANDMATIG (GG.8.2: "drie P0's geslaagd") + AUTO (`TutorialGold.test.ts`) |
| **Deurinteracties** (GG.8.1) | `208aae8`, `1d80d5a` | Vaste eenrichtings-trekdeuren en dubbele deuren; E trekt een deur open als er geen NPC of bed binnen bereik is | HANDMATIG + AUTO (`Doors*`, `Interaction.test.ts`) |
| **Kloosteruitgang** en Academy-kuil (GG.8.1) | `122d791` | Nieuwe Greyhaven-export **F**: doorgang kloostergang → kerk, kerkportaal als dubbele deur, hek in de tuinmuur, bordes bovenaan de Academy-trap (geen kuil van 0,88 m meer) | HANDMATIG (GG.8.2) + AUTO (`ChurchPortal`, `ChurchCloisterDoor`, `MonasteryGardenGate`) |
| **Academy-trap, gerepareerde normals** (GG.8.2a) | `8ae780e` | Export **G** (`858a806f…`): alleen de 252 vlakken van `GH_Academy_Stairs` omgedraaid (ze stonden binnenstebuiten); 186 van 188 meshes byte-identiek | HANDMATIG ("Academy-trap zichtbaar", GG.8.3a-akkoord) |
| **Sultan-statvenster** (GG.8.3a) | `d92f4ac` | Het herverdeelvenster na Sultans ei sluit met zijn eigen knop zoals met ✕/Escape; geen tweede venster met P | HANDMATIG + AUTO (`RedistributePanel.test.ts`) |
| **Your Resolve** (GG.8.4) | — (alleen audit) | Drie paden (zwaard Garrick, licht Brink, donker Sam), negen examens | Lucas heeft Your Resolve gespeeld (HANDMATIG, zie §3) |
| **F6-scroll** (GG.8.5.1) | `d44907e` | Het cheatmenu houdt zijn scrollpositie | HANDMATIG + AUTO |
| **Monsters Off zonder healing** (GG.8.5.2) | `248349a` | *Monsters attack: Off* maakt monsters vreedzaam maar raakbaar; geen heal-reset meer | HANDMATIG + AUTO (`MonstersOff.test.ts`) |
| **Invincibility** (GG.8.5.3) | `9e9183b` | Centraal in `hurtPlayer`/`hpAfterHit`; alleen in een dev-build of met `?debug=1` | HANDMATIG + AUTO + GAME-CHECK (dev en prod) |
| **Max All Stats / Restore** (GG.8.5.4) | `af65cf4` | Tijdelijke 999-laag; `character.stats` onaangeroerd; de save krijgt nooit meer dan je eigen HP- of manamaximum | HANDMATIG + AUTO + GAME-CHECK |
| **Kill Nearby Enemies** (GG.8.5.5) | `fdb1346` | F6-knop, straal, Include Bosses, sneltoets F8; via de normale defeat-pipeline (splits, waves, beloningen één keer) | HANDMATIG + AUTO + GAME-CHECK |
| **Cheats bij gebiedswissels** (GG.8.5.6) | `f3f1a45` | Alleen `world → world` houdt de cheats; titelscherm, herladen en debug uit zetten alles uit | HANDMATIG + AUTO + GAME-CHECK |

**Automatisch op `f3f1a45` (vandaag):**
- `typecheck`, `lint` en `build` slagen.
- `npm test`: **1320/1320**, of **1319/1320** door de bekende flaky test (§5).
- `format:check` slaagde op de LF-kopie bij de laatste commit.
- Geen secrets, geen lokale instellingen en geen `dist` of `node_modules` in de diff.
- Grootste nieuwe bestand: `greyhaven.glb`, 8,5 MB. Het staat **twee keer** in de geschiedenis (export F en G), samen ±17 MB.

---

## 3. Tutorialstatus

Route: **New Game → Greyhaven → Sultan → Your Resolve → Academy-pad → trainingen → examens → stadspoort**

| Stap | HANDMATIG | AUTO | Niet getest / ONBEKEND | Blokkade |
|---|---|---|---|---|
| New Game, intro, wakker in het klooster | ja (GG.7/GG.8.2) | ja | — | op `main`: **klooster dicht**. Op GG.8 opgelost; nog niet op `main`. |
| Het klooster uit, de stad in, de Academy-trap | ja (GG.8.2, GG.8.3a) | ja | — | idem |
| Just For You → Marco → Defeat Sultan | ja | ja | — | op `main`: goud-softlock mogelijk. Op GG.8 opgelost. |
| **Sultan verslaan** | ja: Lucas versloeg hem en kreeg het ei (vandaar het statvensterprobleem van GG.8.3a) | ja (balans) | eindfilm onderbreken met herladen: zie §4 | — |
| **Your Resolve** | ja: Lucas speelde het | ja (`PathChoice.test.ts`) | — | — |
| **Pad kiezen** | Lucas: "**Nature Path** gekozen" | ja | **Te bevestigen:** in de data bestaan alleen de paden zwaard, licht en donker. "Nature" is een element uit Brinks Crystal Ceremony. Waarschijnlijk dus het lichte pad (Brink) met het Nature-kristal. | — |
| **Slime-training** (drill) | **gestart** door Lucas, niet afgerond | ja (`WaveFight`, `Balance`) | afronden zonder cheats | GG.8.5 heeft een Big Slime-probleem (Monsters Off-heal) opgelost |
| Trainingen tegen de poppen (examen 1 en 3 per pad) | — | ja (`Quests.test.ts`) | **niet handmatig** | aim assist trekt naar de poppen (§4) |
| Examens van de drie paden (9) | — | ja | **geen enkel pad volledig gespeeld** | magiërsexamen 3 is onduidelijk (P1-4) |
| Toren en kelder in en uit | — | ja | GAME-CHECK (GG.8.4, GG.8.5.6) | niet vindbaar zonder marker (P1-3) |
| **Stadspoort → landuitgang → open wereld** | — | ja (trigger en conditie) | — | **P0: fysiek onbereikbaar** (§4) |
| Terug naar Greyhaven vanuit de open wereld | — | — | — | **P1**: je spawnt buiten de muur (§4) |

**Conclusie:** de tutorial is op GG.8 handmatig bewezen **tot en met Your Resolve en de start van de slime-drill**. De rest is alleen automatisch getest of in een GAME-CHECK. Het einde (de stad uit) is **geblokkeerd**.

---

## 4. Openstaande problemen (vandaag gecontroleerd tegen `f3f1a45`)

Sinds de GG.8.4-audit (`d92f4ac`) is er in `public/data`, `public/zones` en de questdata **niets** veranderd. GG.8.5 voegde alleen cheatteksten toe in `lang/`. De gameplayblokkades hieronder gelden dus nog precies zo.

| # | Probleem | Prio | Status vandaag | Bewijs |
|---|---|---|---|---|
| 1 | **Geen fysieke landpoort.** Na het laatste examen zegt de leraar "The city gate is open", maar de stad is lopend niet te verlaten: x komt niet verder dan −1531, de poortstrook ligt op −1525…−1515. | **P0** | **open** | GG.8.4 SIM + schermafbeelding; data ongewijzigd |
| 2 | **Terugkeer naar Greyhaven** zet je op spawn `city_gate` (−1526,4; 44,4), **buiten** de muur. Van daar kom je de stad niet in. | P1 | open | GG.8.4 SIM; `zones.json` ongewijzigd |
| 3 | **Academy-examens niet volledig getest:** 9 examens, 0 handmatig voltooid | P1 | open | §3 |
| 4 | **Aim assist trekt aanvallen naar trainingspoppen.** `assistedHeading` filtert alleen op `hittable`, en poppen zijn hittable. | P1 | **open, bevestigd in code** (`Combat.ts` `assistedHeading`, WS `aim()`) | — |
| 5 | **`common.close`-vertalingsfout:** de melding `missing text "common.close"` op het titelscherm (ook in productie), en de ✕-knop heeft het ruwe label `common.close`. De sleutel bestaat wel in EN en NL; vermoedelijk wordt het label gevraagd vóór de taal geladen is. | P2 | **open** (gezien in GG.8.5.3 en GG.8.5.4) | — |
| 6 | **Sultans eindfilm onderbreken met herladen maakt de overwinning ongedaan:** beloning, quest en ei komen pas in de `done`-callback na de film | P1 | **open, bevestigd** (`BossEncounter.ts` `takeDefeat`) | — |
| 7 | **First Harvest** (Rose, optioneel): vraagt 5 `blossom`, maar geen monster, zone of winkel geeft het | P2 | **open, bevestigd** (data) | — |
| 8 | Na de padkeuze zegt de leraar "Your Entrance Exam will be ready soon…", maar examen 1 staat al klaar | P1 | open | GG.8.4 P1-2 |
| 9 | Toren en kelder niet te vinden (geen marker of label; Brink en Sam onzichtbaar buiten hun instance) | P1 | open | GG.8.4 P1-3 |
| 10 | Magiërsexamen 3: "Hold the cast button" klopt niet (cast = V = Push; de spreuk zit op de rechtermuisknop). Een te zwak opgeladen schot telt stil niet; mana is krap. | P1 | open | GG.8.4 P1-4 |
| 11 | Doodgaan op het veld: wakker in het klooster (±250 m terug), goud kwijt, drill terug naar wave 1 | P1 | open (ontwerpvraag) | GG.8.4 P1-5; in GG.8.5.6 opnieuw gezien: goud naar 0 |
| 12 | Hilda's aanwijzing "north-east city wall" klopt niet met de ligging van de slime yard | P2 | open | eerdere tutorial-audit, N6 |
| 13 | Aankomst in de open wereld op (−1480; 0), precies op de grens Greenwood/Mournfen | P2 | open | GG.8.4 P2 |
| 14 | `Random.test.ts` "roughly uniform" valt soms om door een time-out van 5 s: alleen al 3,1 s; in een volle parallelle run 3 van de laatste 5 keer > 5 s | P2 (teststabiliteit) | open | §5 |

**Opgelost op GG.8, maar nog niet op `main`:**
- klooster dicht (N1) en de goud-softlock (N2);
- de Academy-kuil (N3) en de binnenstebuiten-trap;
- het Sultan-statvenster;
- de Monsters Off-heal.

---

## 5. Technische risico's

| Risico | Ernst | Toelichting |
|---|---|---|
| **GG.8 staat alleen lokaal** | **hoog** | 12 goedgekeurde commits op één schijf, zonder GitHub-back-up |
| **Blender-bron van export G staat alleen lokaal** | **hoog** | De GLB in GG.8 (`858a806f`) komt uit `C:\Users\claud\Morvath\GateWork_GG82a\Greyhaven\Greyhaven.blend` (`7b85391b`). Die bron staat in geen enkele repository. De `Greyhaven.blend` in de werkmap (`df1c6b8c`, 20-10) is **ouder** en niet de bron. |
| GLB-export G (impact) | middel | Exports F en G zijn volledige re-exports. F bevatte ook andere Blender-wijzigingen sinds de vorige export (zie de commitnotities van `122d791`). G verandert alleen de trap. `main` heeft nog de oude `e20e2e6c` (met kuil). |
| #119 G.5 Flasks | middel | Draft, save **v22**. Wacht op een handmatige hertest. 1 conflict met GG.8. Inhoudelijk raakt het rusten, HP, drankjes en de save; dat kruist met Max All Stats (`poolForSave`) en Invincibility. **Na het samenvoegen opnieuw testen.** |
| #115 W.1 Morvath V1 | middel | Draft, 23 commits achter, save **v20** (ouder dan `main` v21). Conflict in `PROGRESS.md`; overlapt GG.8 in `zones.json`, `WorldState.ts`, `schemas.ts`. **Eigenaar en toekomst onduidelijk.** |
| Savecompatibiliteit | middel | `main` en GG.8: v21 (GG.8 verandert het formaat niet). #119 → v22 (migratie). #115 → v20, en moet dus herbasen en migreren. Maar één werkstroom tegelijk mag `SAVE_VERSION` ophogen. |
| Mergeconflicthotspots | middel | `WorldState.ts` (±6000 regels, iedereen), `docs/PROGRESS.md` (elke PR), `lang/*.json`, `zones.json`, `npcs.json` |
| Teststabiliteit | laag-middel | De `Random.test.ts`-time-out kan CI rood maken; dan opnieuw draaien. Voorstel later: minder `expect`s per iteratie of een expliciete time-out (aparte kleine PR). |
| Regeleinden | laag | Windows-checkout (CRLF) tegenover CI (LF): `format:check` altijd op een LF-kopie controleren of na `prettier --write` |
| `CLAUDE.md` §6 | middel | Zegt nog "Claude mag de PR zelf samenvoegen" (2026-10-09). Dat botst met de nieuwe afspraak: **alleen Lucas merget**. Moet aangepast worden (aparte docs-PR, met akkoord). |
| `PLAN.md` / `PROGRESS.md` | laag | GG.8 heeft ze nog niet bijgewerkt (vereist door `CLAUDE.md` §6) |
| **Three.js-pipeline** | — | Blender → `tools/blender/export_web.py` → `public/zones/<zone>/*.glb` + `materials.json`. Speler: `04_export_player.py` (bron `Hero_Start_Player.blend`). Pringle: `tools/blender/pringle`. Sultan is in de game nog **`placeholder:sultan`**. Lucael en Baelor zijn in de intro het **placeholder**-model `fight`. Geen Git LFS, geen `.gitattributes`. |
| **Godot-pipeline** | ONBEKEND | Er is **geen spoor** van Godot in de repository, in de docs of in de lokale mappen. Bevestigen of dit bestaat en waar. |
| **Aparte Blender-repository** | ONBEKEND | Niet gevonden. De Blender-bronnen staan buiten Git: `GateWork_*` bij Lucas, en bij Bo `Sultan_kat.blend` (Pringle) en waarschijnlijk Sultan en Lucael. Bevestigen. |
| Afhankelijkheden met Bo | middel | Een Sultan-mensmodel of Lucael-model in de game raakt `public/characters/`, `npcs.json` (roles), `monsters.json` (`model` van de boss), `animations.json` en `cutscenes.json` (actors). Dat zijn deels dezelfde bestanden als werkstroom A (dialogen en quests in `npcs.json`). |
| Bo's huidige voortgang | ONBEKEND | Geen commits sinds 18-10; de bestanden staan buiten de repo. Status bij Bo opvragen. |

---

## 6. GitHub-back-up en integratie

### Uitgevoerde controles (vandaag)

| Controle | Uitkomst |
|---|---|
| Commitgeschiedenis | 12 commits lineair op `origin/main` `9260afe`; auteur `Claude <noreply@anthropic.com>`, committer BnuyLova; geen merges, geen fixups |
| Grote of ongewenste bestanden | 2× `greyhaven.glb` (8,5 MB elk). De rest is code, data en tests. Ruim onder de GitHub-limiet van 100 MB per bestand. |
| Secrets en lokale instellingen | geen treffers (sleutels, tokens, wachtwoorden, `.env`, `.claude`, `launch.json`, `settings.local`) |
| Tests en build | `typecheck`, `lint` en `build` ok; tests 1320/1320, of 1319 door de flaky time-out |
| Remote | `origin/main` = basis van GG.8; GG.8 bestaat niet op de remote; GG.8 → `main` is een **schone merge** |

### Wat veilig gepusht kan worden

**`claude/greyhaven-tutorial-p0` kan zoals hij is veilig gepusht worden.** Hij is schoon, staat lineair op `main` en bevat geen secrets.

### Voorstel: twee kleine, gestapelde draft-PR's in plaats van één grote

Er wordt niets herschreven; alleen een extra branchnaam op een bestaande commit.

| PR | Branch | Commits | Inhoud |
|---|---|---|---|
| **PR-A** "GG.8: Greyhaven-tutorial speelbaar (klooster, deuren, goud, trap, statvenster)" | nieuwe naam `gg8/tutorial-fixes` op `d92f4ac` | `2b00255`…`d92f4ac` (6) | gameplay en GLB, basis `main` |
| **PR-B** "GG.8.5: debugcheats (F6)" | `claude/greyhaven-tutorial-p0` (tip `f3f1a45`) | `d44907e`…`f3f1a45` (6) | alleen dev/`?debug=1`-cheats; basis `gg8/tutorial-fixes`, na de merge van PR-A automatisch `main` |

- **Draft-PR's zijn verstandig:** CI draait direct, de back-up staat op GitHub, en Lucas reviewt en merget zelf. Beide in het Nederlands volgens `CLAUDE.md` §6: wat, waarom, en hoe testen.
- **Vóór "ready for review":** één kleine docs-commit per PR met `PLAN.md`/`PROGRESS.md` bijgewerkt (vereist door §6). **Niet automatisch;** alleen met akkoord.

### Integratievolgorde

1. **Push** GG.8 (+ de branch `gg8/tutorial-fixes`), open **PR-A en PR-B als draft**, en wacht op een groene CI. *(Akkoord nodig.)*
2. **PR-A mergen** na Lucas' eigen speeltest op de PR-build (New Game → klooster uit → Sultan). Daarmee is `main` weer speelbaar tot Your Resolve.
3. **PR-B mergen** (cheats). Dat is niet gameplaykritisch, maar wel nodig om werkstroom A snel te laten testen.
4. **Docs-PR:** `CLAUDE.md` §6 naar "alleen Lucas merget", en de werkstroomafspraken uit §7 hieronder.
5. **#119 G.5 Flasks:** `main` erin mergen, het ene `interact()`-conflict oplossen (deurtak + `rest()` allebei behouden), dan alle checks en een handmatige test (Flasks, rusten, save v22, samen met de cheats). Pas daarna mergen.
6. **#115:** beslissen (Lucas en Bo). Herbasen op `main` met v22, of parkeren/sluiten. Niet automatisch.
7. **Later, aparte kleine PR:** de `Random.test.ts`-time-out stabiliseren.
8. **Opruimen** van 58 al gemergede remote branches: alleen op verzoek.

---

## 7. Parallelle werkstructuur

### Werkstromen

| Stroom | Eigenaar | Machine | Onderwerpen | Hoofdbestanden (eigenaar) |
|---|---|---|---|---|
| **A — Academy Gameplay** | Lucas | Lucas | drie paden, negen examens, questprogressie, save/load, tutorial voltooien | `public/data/quests.json`, de questdialogen in `npcs.json`, quest-/examenteksten in `lang/*`, `src/systems/Quests*`, `PathChoice*`, `WaveFight*`, `Casting` (examenregels) |
| **B — Greyhaven World** | Lucas | Lucas | fysieke landpoort, Blender-geometrie, collision, stad uit en in, wereldtransities | `Greyhaven.blend` (bron in `GateWork_*`), `public/zones/greyhaven/*.glb`, `zones.json` (spawns, openings, deuren), `triggers.json` (poort), `src/world/*`, travel/instance in `WorldState` |
| **C — Sultan** | Bo | Bo | 3D-model, rigging, gezichtsanimatie, textures, export | Bo's `.blend` (buiten de game-repo), straks `public/characters/sultan/*.glb`, de boss-`model` in `monsters.json`, Sultan-NPC-role in `npcs.json` (**alleen** role/model), `animations.json`, `tools/blender/character` |
| **D — Lucael** | Bo | Bo | rig, animatieproblemen, jasclipping, secondary motion, exportvalidatie | Bo's `.blend`, straks `public/characters/lucael/*.glb`, de actor-`model` in `cutscenes.json`, `animations.json` |

**Maximaal twee actieve technische stromen per persoon:** Lucas A en B, Bo C en D. Lucas doet daarnaast de integratie.

### Branches, worktrees en clones

**Naamgeving** (kort, één onderwerp, uit een verse `origin/main`):

| Werkstroom | Voorbeeld |
|---|---|
| A | `wsA/<onderwerp>`, bijv. `wsA/exam-path-playtest` |
| B | `wsB/<onderwerp>`, bijv. `wsB/land-gate` |
| C | `wsC/<onderwerp>`, bijv. `wsC/sultan-rig-v1` |
| D | `wsD/<onderwerp>`, bijv. `wsD/lucael-coat-clipping` |
| Hotfix | `fix/<onderwerp>` |
| Docs | `docs/<onderwerp>` |

- Een branch leeft **maximaal een week**. Daarna wordt hij gemerged of opnieuw uit `main` gemaakt.

**Lucas (één clone, één worktree per stroom).** Voorbeeld; nog **niet** uitgevoerd:

```
git -C "C:\Users\claud\OneDrive\Documenten\Bedrijfskunde WDH\Legend-of-Morvath" fetch origin
git -C "…\Legend-of-Morvath" worktree add -b wsA/exam-path-playtest C:\Users\claud\Morvath\wsA_academy origin/main
git -C "…\Legend-of-Morvath" worktree add -b wsB/land-gate        C:\Users\claud\Morvath\wsB_greyhaven origin/main
```

- Dev-poorten:
  - A gebruikt 5195, B gebruikt 5196;
  - 5191–5194 zijn al bezet door `gg4b-test`, `gg4b-ref`, `gg8-p0` en `gg8-p0-prod`.
- **Eén Claude-sessie per worktree**, nooit twee in dezelfde map.
- `GG8_tutorial_p0` wordt na de merge van PR-B opgeruimd; `GG4b/test` blijft staan.

**Bo:** een eigen clone op zijn eigen machine, `wsC/*` en `wsD/*` als aparte worktrees of mappen, en één Claude-sessie per stroom.

**Bijwerken:**
- elke ochtend `git fetch` en `main` in je branch mergen (of rebasen zolang de branch niet gedeeld is);
- nooit beginnen vanaf een branch die meer dan 1 dag achterloopt.

### Blender en grote assets

- **Eén eigenaar per `.blend` tegelijk:**
  - `Greyhaven.blend` en `Monastery_*.blend` zijn van B (Lucas);
  - Sultan-, Pringle- en Lucael-bestanden zijn van Bo.
  - Wie aan een bestand van een ander begint, meldt dat eerst ("lock"), bijvoorbeeld als GitHub-issue met label `blend-lock`.
- **Bron veiligstellen:** `.blend`-bestanden horen niet in de game-repo, maar wel op een back-up-locatie. Voorstel: een aparte, private asset-repository met Git LFS, of een gedeelde cloudmap met versienummers.
  - **Eerst bevestigen** of de genoemde aparte Blender-repository bestaat en nog gebruikt wordt (ONBEKEND).
- **GLB's in de game-repo via een PR**, één asset-onderwerp per PR, met:
  - de sha256 van de GLB en van de bron-`.blend`;
  - het exportscript en de exportinstellingen;
  - de grootte vóór en na;
  - een schermafbeelding in de game en de fps op Low/Mid/High (`CLAUDE.md` §5);
  - bij een volledige re-export (zoals F): de lijst van **alle** meegekomen wijzigingen.
- **Data-koppeling apart houden:** de regel in `npcs.json`, `monsters.json` of `cutscenes.json` die een nieuw model aanzet, zit in dezelfde PR als de GLB, maar raakt **geen** dialoog- of questvelden.

### Pull-requestregels

1. **Eén onderwerp per PR.** Geen gameplay en assets door elkaar, tenzij ze echt samen moeten (zoals export F + deuren in `zones.json`).
2. **Draft** totdat CI groen is en de beschrijving af is (wat, waarom, hoe testen op pc met toetsenbord en controller).
3. **Review:**
   - Lucas reviewt en merget **alle** PR's;
   - Bo reviewt PR's die zijn assets of `npcs.json`-roles/`animations.json` raken;
   - Claude merget nooit.
4. **Acceptatie:**
   - gameplay: door een mens gespeeld (route of scenario in de PR);
   - assets: in de game gezien, plus fps;
   - unit-tests alleen zijn niet genoeg.
5. **Max ±400 regels code per PR** (excl. tests en data); grotere werk opsplitsen of stapelen.
6. **`SAVE_VERSION`** mag maar in één open PR tegelijk omhoog; vermeld het bovenaan de PR.
7. **`docs/PROGRESS.md`:** één regel per PR, onderaan de eigen sectie. Conflicten daar lost Lucas bij het mergen op.

### CI

- Bestaand en ongewijzigd: `lint`, `format:check`, `typecheck`, `test`, `build` op elke PR.
- **Voorstel (later, met akkoord):**
  - `Random.test.ts` stabiliseren;
  - een eenvoudige check op GLB-grootte en -hash;
  - branch protection op `main` (PR verplicht, CI verplicht, alleen Lucas merget).

### Mergevolgorde (standaard)

`fix/*` → `wsB/*` (wereld, waar A van afhangt voor het einde) → `wsA/*` → `wsC/*`, `wsD/*` (assets; onafhankelijk zolang ze geen gedeelde data raken) → `docs/*`.

### Mogelijke bestandsconflicten tussen de stromen

| Bestand | A | B | C | D | Afspraak |
|---|---|---|---|---|---|
| `src/scenes/WorldState.ts` | ● | ● | ○ | ○ | grootste hotspot; kleine gerichte wijzigingen, dagelijks `main` mergen |
| `public/data/zones.json` | ○ | ● | | | B is eigenaar; A alleen via B |
| `public/data/triggers.json` | ○ (poortconditie) | ● (poortplek) | | | B eigenaar, A levert de conditie aan |
| `public/data/quests.json` | ● | | | | A |
| `public/data/npcs.json` | ● (dialoog) | ○ (posities) | ● (Sultan-role/model) | | per veldgroep; PR's niet tegelijk |
| `public/data/monsters.json` | ○ (balans) | | ● (`sultan.model`) | | C alleen het `model`-veld |
| `public/data/cutscenes.json` | ○ | | ○ (Sultan-einde) | ● (Lucael-actor) | D eigenaar intro-actor; C eigenaar Sultan-einde |
| `public/data/animations.json` | | | ● | ● | Bo (één persoon, twee stromen) |
| `public/lang/en.json`, `nl.json` | ● | ○ | ○ | ○ | alleen sleutels toevoegen, nooit herordenen |
| `public/zones/greyhaven/*.glb` + `Greyhaven.blend` | | ● | | | B exclusief |
| `public/characters/*` + `tools/blender/character` | | | ● | ● | Bo |
| `src/save/SaveData.ts` | ○ | ○ | | | één `SAVE_VERSION`-ophoging tegelijk |
| `docs/PROGRESS.md`, `PLAN.md` | ● | ● | ● | ● | één regel per PR; Lucas lost op |

● = verwacht te wijzigen, ○ = mogelijk

---

## 8. Tweeweekse productieplanning (voorstel)

**Doelen in volgorde:**
1. De volledige Greyhaven-tutorial speelbaar.
2. De fysieke landpoort.
3. Sultan en Lucael richting productieklare assets.
4. De volgende gameplaylus buiten Greyhaven voorbereiden.

### Week 1

| Dag | Lucas — integratie | Lucas — A (Academy) | Lucas — B (Greyhaven) | Bo — C (Sultan) | Bo — D (Lucael) |
|---|---|---|---|---|---|
| 1 | Push GG.8 + PR-A/PR-B als draft (**akkoord**); back-up van `GateWork_GG82a` | — | — | Status opnemen: welke `.blend`, welke rig, welke problemen (**bevestigen**) | Idem voor Lucael |
| 2 | Speeltest en merge PR-A; worktrees A en B aanmaken | Audit en speelplan: één pad volledig spelen (zonder cheats) | Keuze landpoort (a/b/c uit GG.8.4) met Bo | Rig en gezicht: eerste ronde | Jasclipping reproduceren en documenteren |
| 3–4 | Merge PR-B (cheats) | Pad 1 volledig tot "city gate is open"; problemen loggen | Blender: poortopening en collision (bij optie a) of data (b) | Testexport naar een dev-preview (geen game-PR) | Rig- en animatiefixes |
| 5 | Wekelijkse integratie + `main` bijwerken | Kleine P1-reparaties (P1-2 tekst, P1-3 marker) na akkoord | Export H + speeltest: de stad uit lopen | Export valideren: schaal, botten, clips | Secondary motion: eerste ronde |

**Acceptatie week 1:**
- `main` speelbaar tot Your Resolve, zonder cheats, door Lucas;
- één pad handmatig tot "The city gate is open";
- het landpoortontwerp gekozen;
- de status van Sultan en Lucael schriftelijk bekend.

### Week 2

| Dag | Lucas — integratie | Lucas — A | Lucas — B | Bo — C | Bo — D |
|---|---|---|---|---|---|
| 6–7 | #119 G.5 herbasen en het conflict oplossen; hertest | Paden 2 en 3 (met F6/F8 waar het mag, eindtest zonder) | Landpoort-PR: in de game de stad uit en weer in | GLB-PR voorbereiden (Sultan-NPC + boss-`model`) | Exportvalidatie + intro-integratieplan |
| 8–9 | Merge #119 na hertest | Save/load over de hele route; aim assist versus poppen (P1) | Terugkeer-spawn binnen de muur (P1-1) | PR: Sultan in de game, fps Low/Mid/High | PR (draft): Lucael in de intro |
| 10 | Eindtest | **Volledige run:** New Game → stadspoort → open wereld → terug, zonder cheats | Ondersteunt de eindtest | Review van de feedback | Review van de feedback |

**Acceptatie week 2:**
- een **nieuwe speler** haalt op `main` zonder cheats: New Game → Sultan → Your Resolve → 3 examens van één pad → **de stad uit lopen** → terug naar Greyhaven;
- Sultan-model in de game zichtbaar en geanimeerd, of een duidelijk restpunt;
- Lucael-export gevalideerd.

**Doel 4** (gameplaylus buiten Greyhaven): in week 2 alleen een **plan**, op basis van #115 en de Greenwood-sidequests, en pas na de beslissing over #115.

---

## 9. Resterende risico's en afhankelijkheden

1. **Akkoord voor de push** (GG.8 alleen lokaal) en een **back-up van de Blender-bron** van export G.
2. **Status van Bo:** Sultan, Lucael en de Blender-locatie zijn ONBEKEND sinds 18-10.
3. **#115:** eigenaar en toekomst. #119: handmatige hertest na het samenvoegen met GG.8.
4. **Landpoort:** ontwerpkeuze (Blender-opening tegenover alleen data). Raakt B, en het einde van A.
5. **`CLAUDE.md` §6** past niet bij de nieuwe mergeafspraak.
6. **Hotspots:** `WorldState.ts` en `PROGRESS.md`; de flaky `Random`-test in CI.
7. **Godot-pipeline** en de **aparte Blender-repository:** bestaan ze? (ONBEKEND)
8. **"Nature Path"** van Lucas: welk pad precies, en in welke save?

---

## 10. Eerstvolgende actie voor Lucas

**Geef akkoord om `claude/greyhaven-tutorial-p0` te pushen en de twee gestapelde draft-PR's (PR-A en PR-B) te openen.** Zet daarnaast zelf een back-up van `C:\Users\claud\Morvath\GateWork_GG82a\` op een tweede plek; dat is de enige bron van de huidige Greyhaven-GLB.

Vraag Bo tegelijk om een korte statusregel over Sultan en Lucael: welke bestanden, welke stand, welke blokkades.

---

## 11. Is de repository gereed voor parallelle ontwikkeling?

**Bijna.** Technisch is de basis gezond:
- GG.8 merget schoon op `main`;
- CI bestaat;
- de checks slagen (op één bekende flaky test na);
- geen secrets of ongewenste bestanden;
- het werk is goed op te delen in vier stromen.

**Vóór de start eerst** (± één dag):
1. GG.8 op GitHub en PR-A gemerged, zodat A en B vanaf een speelbare `main` beginnen.
2. De Blender-bron veiliggesteld.
3. De mergeafspraak in `CLAUDE.md` bijgewerkt.
4. De status van Bo opgehaald.

Zonder stap 1 zouden A en B op een `main` werken waar het klooster nog dicht zit.
