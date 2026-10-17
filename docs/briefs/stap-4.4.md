# Brief stap 4.4: Kristallen

Bron concept: gerichte grep op het lokaal opgeslagen concept (alleen relevante stukken). Niet volledig gelezen.

## 1. Wat het concept zegt

- Elementen: Water, Fire, Nature, Wind en Dark, via kristallen op je staf. Je staf werkt alleen met een kristal.
- Start: Master Brink (mage, normale magie) geeft een **Wizard Crystal** met willekeurig element (Water, Fire, Nature of Wind). Wizard Sam (duistere magie) geeft een **Dark Crystal**. Dit gebeurt in de **Crystal Ceremony** aan het eind van de Entrance Exam (cutscene, leraar zet kristal op je staf). Het kristal licht op in de kleur van het element.
- Neutrale staf: de eerste Mage Staff heeft geen element.
- **Mergen:** vind je een kristal van een element dat je al hebt, dan merge je ze tot een **groter kristal**; spells van dat element worden sterker. Een groter kristal past alleen op een **grotere staf**. Geldt ook voor Dark Crystals. Twee dezelfde kristallen krijgen is bewust zeldzaam.
- **Kristalgroottes:** Small, Medium, Large, Grand (namen en volgorde staan in het concept; exacte getallen niet gevonden).
- **Nieuw element:** heb je al een staf met kristal, dan vind je heel soms een kristal van een nieuw element. Voor een nieuw element heb je een tweede staf nodig (gevonden of gekocht). Wisselen buiten gevechten.
- **Opnieuw renderen bij Sam:** Wizard Sam rendert een Wizard Crystal opnieuw met zwarte magie. Altijd ander element, maar 1 op 3 kans dat het kristal breekt. Korte cutscene.
- **Nature Crystal:** in het bos een heel kleine kans om te vinden. Kristallen zijn zeldzaam.
- **Spells:** je leert losse spells voor het element van je kristal; levelen door gebruik (bijv. 50x Fireball: extra Burn of meer schade). Staf heeft spellslots: 1 (eerste staf), 2 (zeldzaam), 3 (episch/legendarisch). Max 3 slots.
- Concept noemt ook: kristal en staf in items.json, spells in spells.json (element, keren gebruiken per level, effect per level). Dit is de bedoelde datastructuur.

## 2. Wat al in de data/code bestaat

- `public/data/items.json` regel 25: `crystalSizes: ["small","medium","large","grand"]`.
- `public/data/items.json` regels 658-679: `mage_staff` (damageBonus 0, spellSlots 1, maxCrystalSize small) en `adept_staff` (damageBonus 2, spellSlots 2, maxCrystalSize small).
- `public/data/items.json` regels 681-703: `wizard_crystal` (rare, elementen water/fire/nature/wind, size small) en `dark_crystal` (rare, element dark, size small).
- `public/data/items.json` regels 786, 866: `crystal_shard` en `frozen_crystal` zonder crystal-blok (grondstoffen).
- `public/data/player.json` regels 244-259: per klasse `crystal` (`wizard_crystal` / `dark_crystal`) en `ceremony` (`crystal_ceremony_light` / `crystal_ceremony_dark`).
- `public/data/cutscenes.json` regels 1827 en 1978: de twee crystal-ceremonies, tekstkeys `cutscene.crystal_ceremony.1-4`.
- `public/data/seasons.json` regels 4, 24: `crystal_shard` altijd te vinden; `frozen_crystal` seizoensgebonden.
- `public/data/zones.json` regels 321-324: alleen ambient-clips `AC_Crystal_*`.
- Geen merge-regels, geen schade-per-grootte, geen spells.json gevonden in de gelezen delen.

## 3. Niet in het concept, dus de kleinste veilige keuze

- Merge: twee kristallen van hetzelfde element en dezelfde grootte geven één kristal van de volgende grootte (small -> medium -> large -> grand). Staaf-limiet via `maxCrystalSize`.
- Schade: bonus per grootte als data in `items.json` (voorstel small +1, medium +2, large +4, grand +8), op de staf, opgeteld bij `damageBonus`.
- Spell: het effect van een gemergd kristal geldt voor de spells van dat element; schade-getal zichtbaar in spelbeschrijving en damage-popup.
- Zichtbaar: staf-model of kleur verandert per grootte, of alleen HUD-label (kleinste keuze: HUD-label + popup).
- Teksten: nieuwe strings in `public/lang/en.json` en `nl.json`, geen hardcoded tekst.
- Breken bij Sam en Nature Crystal-drop: buiten scope van deze stap, niet bouwen.

## 4. Echte open vragen voor Bo/Lucas

- Geen. De kleinste veilige keuze hierboven is genoeg om de stap te bouwen. Exacte bonus per grootte en welke spells precies geraakt worden: zie punt 3, later te bevestigen.

Brief klaar
