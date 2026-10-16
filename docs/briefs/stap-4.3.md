# Brief stap 4.3: Spellboek

## 1. Wat het concept zegt
- Spells komen via je staf. Een staf heeft maximaal **3 spellslots**; je eerste Mage Staff heeft **1**, een zeldzame **2**, een epische of legendarische **3**.
- Welke spells je in de slots zet, kies je zelf uit de spells die je geleerd hebt voor het element van je kristal.
- Wisselen van staf (en dus van spell-set) kan **alleen buiten gevechten**.
- Element-takken werken alleen met een staf met een kristal van dat element. Punten blijven staan bij wisselen van wapen.
- Spells per element uit concept: Fire (Fireball), Water (Water Bolt), Nature (Thorn Shot), Wind (Wind Slice), Dark (Shadow Bolt). Die staan al in `spells.json`.
- Grimoire (3 extra slots voor geüpgradede/gemergede spells, max 6 totaal) staat in het concept maar valt buiten deze stap.
- Bouwfase 4 noemt "smederij/markt/spellboek" als geheel; het concept beschrijft geen aparte spellboek-schermindeling.

## 2. Wat al in data/code bestaat
- `public/data/spells.json`: 5 spells (fireball, water_bolt, thorn_shot, wind_slice, shadow_bolt), `maxSpellSlots: 3`, elementen met kleurnamen, powerCurves.
- `public/data/items.json` regel ~661: één staf met `"spellSlots": 1`. Dat is de enige staf-entry die ik zag; andere zeldzaamheden staan er niet met slots.
- `src/data/schemas.ts` regel 1181: `spellSlots: optional(intRange(0, 3))`. Het schema is er al.
- `src/scenes/WorldState.ts` regel ~3005-3030: de staf heeft `spells` (Map) en `spell` (één spell). Het "carried" spell is de eerste bekende spell, dus **er is nog geen keuze per slot**. Kleur van shots komt uit spells.json.
- `src/scenes/WorldState.ts` regel ~2857: het kristal voegt het spell-id toe aan `character.spells` (lijst geleerde spells).
- `src/save/SaveData.ts`: bevat spell-gegevens van het personage; ik heb niet gecontroleerd of er al een veld voor gekozen spells per staf is.
- Er is geen spellboek-UI en geen taalkey voor spellboek in `public/lang/nl.json` (grep leeg).

## 3. Niet in het concept, dus de kleinste veilige keuze
- Opslag van de keuze: `character.spellLoadout: string[]` (spell-ids per slot, lengte = slots van de staf) in de save, met een migratie-stap in `src/save/SaveManager`. Eén regel per slot.
- Eén spell per slot, geen dubbele spell in dezelfde staf: validatie in DataValidator.
- Staf wisselen en spellboek openen alleen als er geen gevecht loopt (bestaande gevechtsstatus gebruiken).
- Bij een staf met minder slots dan de loadout: overtollige slots worden leeggemaakt, geen verlies van geleerde spells.
- Alleen de 5 bestaande spells tonen; nieuwe spells alleen als data in spells.json.
- UI-teksten (spellboek, slot, leeg) in `en.json` en `nl.json`; namen blijven Engels.
- Meer slots dan 1 op de eerste staf: de Mage Staff in items.json moet op 1 blijven. Zeldzame staven krijgen 2 in data.

## 4. Echte open vragen voor Bo/Lucas
Geen. De stap kan zonder antwoord worden gebouwd. Het concept geeft genoeg: slots per staf, zelfkeuze uit geleerde spells, wisselen buiten gevecht. De kleine keuzes staan in deel 3.

## Let op (eerlijkheid over leesbudget)
- Het spelconcept is 810.000 tekens. Ik heb het één keer opgehaald; de volledige tekst is opgeslagen in `/root/.claude/projects/-home-claude-legend-of-morvath/91aeb92e-216f-5485-a353-89ac707b94e1/tool-results/mcp-Google_Docs-read_doc-1792123398648.txt`. Daarin heb ik alleen met grep gezocht op staf/spreuk/slot/spellboek; ik heb het niet volledig gelezen.
- Aan repo-bestanden heb ik ongeveer 6 bronnen gelezen of doorzocht, met grep-zoekopdrachten. Ik heb geen bestand volledig gelezen.

Brief klaar
