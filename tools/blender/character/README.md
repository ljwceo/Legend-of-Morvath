# Personage – Blender-scripts (Fase A)

Bron: `Hero_Start_Rigged.blend` (sinds A.0, 2026-10-15; staat niet in de repo, Bo heeft hem lokaal), collectie `StartCharacter` met het lijf `Body` (materialen `Skin`, `Tunic`). Het oude `Greyhaven.blend`-poppetje van losse stukken werkt in het script nog steeds.
De scripts draaien zonder venster en **slaan het .blend-bestand nooit op**.

| Bestand | Chat | Wat |
|---|---|---|
| `01_prep_mixamo.py` | 1 | Lijf klaarmaken voor Mixamo → `body_for_mixamo.fbx` |
| `02_import_mixamo.py` | 2 | (komt nog) Mixamo-rig + animaties terug in Blender, cape-botten, export naar `player.glb` |

**Mixamo-licentie:** de bestanden uit Mixamo (en `body_for_mixamo.fbx`) gaan **nooit** in git.
Ze staan in de map `Mixamo` naast `Greyhaven.blend` (buiten de repo) of in `art-source/` (in `.gitignore`). Alleen de
uiteindelijke `public/zones/greyhaven/player.glb` gaat in git.

---

## Eerst: het echte personage maken (besluit 2026-10-13)

Het huidige poppetje is van losse cilinders en bolletjes. Bo maakt eerst de looks; daarna draait
`01_prep_mixamo.py` op het nieuwe model. Zo werkt Mixamo er straks goed mee:
- Het **lijf als één geheel** (armen, benen, romp, hoofd aan elkaar), in de collectie `StartCharacter`.
- **Armen schuin naar beneden** (A-pose), handen een stukje van het lijf.
- **Extra ringen (loop cuts) bij ellebogen, knieën, schouders en heupen.**
- **Hoed, haar, cape en zwaard als losse delen** (die komen in Chat 2 aan het skelet).
- Materiaalnamen houden: `Skin`, `Hair`, `Cloak_Navy`, `Hat_Navy`, `Gold_Trim` (de character creator kleurt die), en `Outline` voor de omlijning.
- Maximaal ±30.000 driehoeken in totaal.

Klaar (A.0): het nieuwe lijf heet `Body` en het script herkent dat. Alleen als er geen `Body` is, zoekt hij nog de oude stukken (`Torso`, `Arm_L`, ...).

---

## Deel A – `01_prep_mixamo.py` draaien (Chat 1)

**In Blender (makkelijkst):**
1. Open `Greyhaven.blend` in Blender zoals altijd.
2. Klik bovenin op het tabblad **Scripting**.
3. Klik in het tekstvak op **New**.
4. Open op GitHub `tools/blender/character/01_prep_mixamo.py`, klik rechtsboven op **Copy raw file**
   (het icoontje met de twee blaadjes) en plak het in Blender (Ctrl+V).
5. Klik op **▶** (Run Script). Na een paar seconden is hij klaar.
6. Naast `Greyhaven.blend` staat nu een map **`Mixamo`** met `body_for_mixamo.fbx`.

Het script verandert niets aan je scène. Opslaan hoeft niet, maar het kan ook geen kwaad.
Gaat er iets mis? Kijk in *Window → Toggle System Console* of stuur `Mixamo\log_prep.txt`.

**Zonder venster (voor wie dat wil):**
`blender -b Greyhaven.blend --python tools/blender/character/01_prep_mixamo.py -- <uitvoermap>`

Wat het script doet:
- Kopieert de lijfstukken (Torso, Neck, Head, Shoulder_L/R, Arm_L/R, Hand_L/R, Belt, Leg_L/R,
  Boot_L/R) en voegt ze samen tot één mesh `Body`. Haar, hoed, cape, kraag en zwaard blijven
  eruit (die komen in Chat 2 terug). De zwarte omlijning (`Outline`) ook.
- Snijdt extra ringen in de armen, benen, romp en nek, zodat ellebogen, knieën en rug kunnen buigen.
- Zet de armen in een A-pose (45° naar buiten, rond de schouder).
- Draait het lijf met het gezicht naar Blender −Y (de voorkant voor Mixamo), voeten op 0, in het midden.

Wat eruit komt (in de uitvoermap):
- `body_for_mixamo.fbx` – dit upload je naar Mixamo.
- `prep_info.json` – wat er gedraaid en verschoven is (Chat 2 gebruikt dit om alles weer recht te zetten).
- `log_prep.txt` – maten, aantal driehoeken, materialen. Bij een fout staat hier waar het misging.

Controle (optioneel): open een leeg Blender, *File → Import → FBX*, kies `body_for_mixamo.fbx`.
Je ziet één poppetje zonder hoed/haar/cape, armen schuin naar beneden, voeten op de grond.

---

## Deel B – Mixamo (Bo, met de hand)

1. Ga naar [mixamo.com](https://www.mixamo.com) en log in (gratis Adobe-account).
2. **Upload Character** → kies `body_for_mixamo.fbx`.
   - Staat het poppetje met zijn rug naar je toe of ligt het? Draai het in de eerste stap met
     de draai-knoppen tot je het van voren ziet, en klik dan *Next*.
3. **Auto-Rigger:** sleep de bolletjes naar kin, polsen, ellebogen, knieën en kruis.
   - *Skeleton LOD*: **No Fingers** (de handen zijn bolletjes, vingers zijn niet nodig).
   - Klik *Next* en kijk in de preview of de armen en benen netjes buigen (geen rare uitrekkingen).
     Dat is meteen de Definition of Done van Chat 1: lukt dit, laat het weten.
4. **Gerigd poppetje downloaden:** zonder animatie (*T-Pose*), *Format: FBX Binary*,
   *Skin: With Skin*. Sla op als **`body_rigged.fbx`**.
5. **Animaties downloaden**, met jouw poppetje geselecteerd (dan passen ze op jouw skelet):
   - Vink **In Place** aan als die optie er is.
   - Zet *Character Arm-Space* iets hoger (±55–65) als de armen door het lijf gaan.
   - Download: *Format: FBX Binary*, **Skin: Without Skin**, *Frames per Second: 30*,
     *Keyframe Reduction: none*.
   - Sla elk bestand op met **precies de clipnaam** hieronder (bijv. `Slash_1.fbx`).

| Clipnaam (bestandsnaam) | Zoek in Mixamo bijvoorbeeld |
|---|---|
| `Idle` | Idle, Breathing Idle |
| `Walk` | Walking |
| `Run` | Running |
| `Sprint` | Fast Run |
| `Jump_Start` | Jumping Up |
| `Jump_Air` | Falling Idle |
| `Land` | Falling To Landing |
| `Dash` | Dodging / Running Slide (kort stuk, wordt ±0,2 s) |
| `Dash_Recover` | Run To Stop |
| `Slash_1`, `Slash_2`, `Slash_3` | Sword And Shield Slash, Sword And Shield Attack (3 verschillende) |
| `Heavy_Windup` + `Heavy_Strike` | Standing Melee Attack Downward, Great Sword Slash (mag één bestand zijn: `Heavy.fbx`, Chat 2 knipt hem) |
| `Cast_Gather` | Standing 1H Cast Spell, Magic Spell Casting (het opladen) |
| `Cast_Release` | Standing 1H Magic Attack |
| `Hit` | Standing React Small From Front, Hit Reaction |
| `Death` | Standing Death Backward, Dying |
| `Interact` | Button Pushing, Picking Up |

   Kies gerust op gevoel; Chat 2 kan clips inkorten, knippen en de horizontale beweging eruit halen.
6. Zet alles in de map `Mixamo` naast `Greyhaven.blend`, bijvoorbeeld:
   ```
   Mixamo\body_rigged.fbx
   Mixamo\Idle.fbx
   Mixamo\Walk.fbx
   ...
   ```
   Daarna: nieuwe chat, *"Lees CLAUDE.md. We doen Fase A, Chat 2."* Chat 2 maakt een script dat
   jij weer lokaal draait (de Mixamo-bestanden komen niet in de repo, dus Claude kan er niet bij).
