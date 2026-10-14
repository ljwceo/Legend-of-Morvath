# Pringle – animaties maken en aanpassen

Bron: `Sultan_kat.blend` (staat niet in de repo; Bo heeft hem lokaal in `Pictures\Sultanp-Pringle`).
Het script `pringle_animations.py` maakt **alle** animaties van Pringle opnieuw uit een paar getallen,
bakt ze, en exporteert `pringle.glb`. Kopieer die daarna naar `public/characters/pringle/pringle.glb`.

| Clip | Wat | In de game |
|---|---|---|
| `Idle` | staan, ademen, rondkijken, oor-trekje | stilstaan |
| `Walk` | rustig lopen (staart omhoog, schouderbladen rollen mee) | slenteren (`strollSpeed`) |
| `Run` | galop | meelopen met de speler (`speed`) |
| `Pet_Headbutt` | gaat zitten, kopje omhoog tegen je hand, staart recht omhoog | aaien (1e keer) |
| `Pet_Roll` | gaat liggen, rolt op zijn rug, pootjes in de lucht, staat op | aaien (2e keer) |
| `Pet_Blink` | zit rustig, langzaam knikje ("kattenkus"), staart om de pootjes | aaien (3e keer) |

Bij elke aai komt de volgende aai-animatie (1, 2, 3, 1, ...). Zolang die speelt blijft Pringle zitten
(`settings.petHoldSeconds` in `npcs.json`, nu 3,6 s = de langste clip).

## Zelf aanpassen

1. Open `Sultan_kat.blend` → tabblad **Scripting** → **Open** → `pringle_animations.py`.
2. Verander getallen bovenaan in `WALK`, `RUN`, `IDLE` of `PET` (elk getal heeft uitleg erachter). Voorbeelden:
   - **Rustiger lopen:** `WALK["seconds"]` hoger (langzamer tempo) of `stride` lager (kleinere pasjes).
   - **Pootjes hoger optillen:** `lift`. **Minder "sluipend":** `body_drop` lager.
   - **Galop minder wild:** `RUN["spine_flex"]` en `paw_flex` lager.
3. **Run Script.** Het script print per clip hoeveel mm de pootjes hun plek missen (moet ±0 zijn; anders
   `stride` iets kleiner of `body_drop` iets groter) en **op welke snelheid de voeten niet glijden**.
4. Zet die twee snelheden in `public/data/npcs.json` → `roles` → `companion` → `animated`
   (`walkSpeed`, `runSpeed`). Pringles eigen loopsnelheid staat bij `npcs` → `pringle` → `follow`
   (`strollSpeed` = slenteren, `speed` = meelopen).
5. Kopieer `export\pringle.glb` naar `public/characters/pringle/pringle.glb` en sla de .blend op als je
   de nieuwe clips wilt houden.

Liever niet zelf? Zeg in een chat met de Blender-koppeling wat er anders moet ("pootjes hoger",
"galop rustiger"); Claude past de getallen aan en draait het script.

**Let op:** de clips worden opnieuw gemaakt; handmatige wijzigingen in de acties `Kat_*` gaan dan verloren.
Wil je met de hand animeren (Dope Sheet / Graph Editor), doe dat dan ná het script en draai het niet opnieuw.
Ogen dicht (knipperen) kan niet: de ogen zijn geschilderd in de texture, er zijn geen oogleden.
