# Personage – Blender-scripts (Fase A)

Bron: `Greyhaven.blend` (staat niet in de repo; Bo heeft hem lokaal), collectie `StartCharacter`.
De scripts draaien zonder venster en **slaan het .blend-bestand nooit op**.

| Bestand | Chat | Wat |
|---|---|---|
| `01_prep_mixamo.py` | 1 | Lijf klaarmaken voor Mixamo → `body_for_mixamo.fbx` |
| `02_import_mixamo.py` | 2 | (komt nog) Mixamo-rig + animaties terug in Blender, cape-botten, export naar `player.glb` |

**Mixamo-licentie:** de bestanden uit Mixamo (en `body_for_mixamo.fbx`) gaan **nooit** in git.
Ze staan in `art-source/` (staat in `.gitignore`) of in een map buiten de repo. Alleen de
uiteindelijke `public/zones/greyhaven/player.glb` gaat in git.

---

## Deel A – `01_prep_mixamo.py` draaien (Chat 1)

Windows (pas de paden aan; Blender 4.x of 5.x):

```bat
cd C:\pad\naar\Legend-of-Morvath
"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe" -b "C:\pad\naar\Greyhaven.blend" --python tools\blender\character\01_prep_mixamo.py
```

Zonder map na `--` komt alles in `art-source\character\` in de repo (wordt niet meegecommit).
Een andere map kan ook: `... --python tools\blender\character\01_prep_mixamo.py -- D:\Morvath\character`.

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
6. Zet alles in één map, bijvoorbeeld:
   ```
   art-source\character\mixamo\body_rigged.fbx
   art-source\character\mixamo\Idle.fbx
   art-source\character\mixamo\Walk.fbx
   ...
   ```
   Daarna: nieuwe chat, *"Lees CLAUDE.md. We doen Fase A, Chat 2."* Chat 2 maakt een script dat
   jij weer lokaal draait (de Mixamo-bestanden komen niet in de repo, dus Claude kan er niet bij).
