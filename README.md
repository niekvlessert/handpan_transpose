# Handpan Transposer

Importeer een melodie, kies de noten van je handpan en oefen met oplichtende toonvelden. De app zoekt transposities waarbij elke toonhoogte, inclusief octaaf, op de handpan beschikbaar is.

Onder **Handpan** zie je voor de gekozen melodie per model welke verschuivingen passen. De app kiest de verschuiving met de minste ontbrekende aanslagen, waarbij elke herhaling meetelt. Bij gelijke aantallen geeft de app voorrang aan minder verschillende ontbrekende toonhoogtes en daarna aan de kleinste verschuiving. Onder **Transpositie** kun je een andere verschuiving kiezen en zien hoe vaak elke ontbrekende toonhoogte voorkomt. Bij afspelen blijven ook die noten hoorbaar en zie je ze onder **Zonder toonveld**.

Met **Ontbrekende noten dempen** hoor je alleen de aanslagen die je op de gekozen handpan kunt spelen. De timing en de telling per ontbrekende noot blijven zichtbaar.

Kies onder de tijdlijn **Begin** en **Einde** om een stuk te oefenen. De app berekent de transposities opnieuw voor de noten die in dat fragment klinken. De afspeelknop stopt bij het einde van het fragment. Met **Hele spoor** zet je de selectie terug.

## Muziek invoeren

- **MIDI** is de aanbevolen route. Exporteer de hoofdmelodie uit een sequencer of notatieprogramma als `.mid` (Standard MIDI File type 0 of 1 met PPQ). Klik bij een melodisch spoor op **Luister** om het vanaf de eerste noot te horen, in het oorspronkelijke tempo en op de oorspronkelijke toonhoogte. Selecteer het bolletje bij het spoor om daarop te oefenen. MIDI-kanaal 10 (drums) wordt overgeslagen.
- **Typ noten** werkt voor een kort fragment. Bijvoorbeeld `D4 F4:0.5 A4:2 - E4+G4`. Een ongenummerde noot duurt één tel, `:0.5` geeft een halve tel, `-` is een rust en `+` vormt een akkoord.
- Met alleen een opname of link naar *Children* kun je de hoofdmelodie eerst uitschrijven of naar MIDI transcriberen. Controleer de octaven en verwijder eventuele begeleiding uit het melodische spoor.

Voor een eigen handpan geef je de ding als eerste op. De virtuele velden volgen daarna de ingevoerde volgorde rond de ding, afwisselend aan beide kanten. Het timbre wordt gesynthetiseerd in de browser. MIDI-bestanden blijven lokaal op je apparaat.

## Lokaal openen

Start vanuit deze map `python3 -m http.server 8000 --directory site` en open [localhost:8000](http://localhost:8000).

## GitHub Pages

Kies bij **Settings → Pages → Build and deployment → Source** de optie **GitHub Actions**. Push daarna de standaardbranch met `git push -u origin main`. De workflow `.github/workflows/ci.yml` publiceert `site/` op [niekvlessert.github.io/handpan_transpose/](https://niekvlessert.github.io/handpan_transpose/). Je kunt de workflow ook vanaf de standaardbranch handmatig starten.
