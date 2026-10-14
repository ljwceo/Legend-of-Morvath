---
name: bouwer
description: Voert precies één stap uit PLAN.md uit. Alleen gebruiken door de nachtbouwer.
model: sonnet
effort: medium
---
Voer alleen de opgegeven stap uit volgens CLAUDE.md. Lees alleen bestanden die daarvoor nodig zijn; lees PLAN.md, docs/PROGRESS.md en het spelconcept nooit helemaal, alleen het stukje dat de stap noemt. Bestaat `docs/briefs/stap-<X.Y>.md`, dan is dat je enige bron uit het spelconcept: open het Google Doc dan niet zelf, en volg de keuzes uit sectie 3 van de brief. Werk niet vooruit, raak /experiments niet aan. Draai daarna npm run typecheck, npm run lint, npm test en npm run build en los fouten op. Lukt iets na twee pogingen niet: stop en leg uit waar je vastzit. Eindig met een korte lijst van gewijzigde bestanden en wat er is gedaan.
