# Agentinstructies voor pixel-art in Stadsburg

Deze instructies gelden voor het ontwerpen, wijzigen en beoordelen van de
visuele assets van `carts/nemesis_s`. Ze gelden voor de uitvoerende agent en
voor reviewers. Lees daarnaast de repository-instructies. Actuele expliciete
gebruikersaanwijzingen gaan voor op oudere afspraken en tussenexperimenten.

**Doel:** overtuigende oorspronkelijke MSX1-pixel-art in de richting van Konami,
met leesbare vormen, materiaal, diepte en een samenhangend spelbeeld. Een
geslaagde build, meer pixels of vooruitgang ten opzichte van de vorige versie
bewijzen op zichzelf geen artistieke kwaliteit.

## Referenties en vaste grenzen

1. **Vergelijk met echte spelbeelden.** Gebruik de oorspronkelijke MSX-versies
   van Nemesis 2, Nemesis 3, Salamander en Parodius voor de shootercontext.
   Gebruik passende details uit The Maze of Galious, Shalom / Knightmare III
   en Penguin Adventure voor steen, architectuur en oppervlaktestructuur.
   Kies per probleem vergelijkbaar materiaal, schaal en beeldfunctie. Benoem
   het zichtbare principe dat wordt overgenomen. Remakes, generieke retrobeelden
   en alleen titelnamen zijn onvoldoende als stijlonderbouwing.

2. **Respecteer het beeldcontract.** Werk op 256×192 zichtbare pixels, met het
   bestaande Nemesis 2-HUD onderin en 8×8-achtergrondtegels. Gebruik het
   afgesproken MSX1-palet (15 kleuren plus een transparante kleurindex) en de
   bestaande exacte kleurwaarden van de pipeline.
   SCREEN 2 staat voor achtergrondpatronen maximaal twee kleuren per
   uitgelijnde 8×1-rij toe; dat is geen beperking tot twee kleuren in de hele
   8×8-tegel. Ontwerp de kleurparen bewust. Introduceer geen extra tussenkleuren
   door vervaging, anti-aliasing of interpolatie. Houd de bestaande betekenis
   van zwart en transparantie uit elkaar.

3. **Maak van een werkwijze geen nieuwe gebruikersbeperking.** Bestaande
   kleurtoewijzingen mogen veranderen binnen het palet. Blauwe huizen zijn niet
   heilig; zwart mag deel worden van rood steenmateriaal. Een tijdelijke afspraak
   zoals “alleen rood naar rood wijzigen” is geen blijvende tekenregel.
   Behoudcontroles beschermen de afgesproken functionele grenzen en mogen de
   gevraagde artistieke verbetering niet onmogelijk maken.

4. **Besteed een artronde aan art.** Geef vorm, materiaal, schaal en leesbaarheid
   prioriteit. Start niet zelfstandig een geheugenoptimalisatie, enginewijziging
   of herontwerp van het hele level. Respecteer echte technische grenzen;
   volg voor uitvoering en tests de bestaande projectwerkwijze.

## Tekenregels

5. **Bouw van groot naar klein.** Ontwerp eerst silhouet en aansluiting op de
   omgeving, daarna grote licht- en schaduwvlakken, vervolgens pixelgroepen en
   tenslotte microdetail. Een vlakke massa wordt niet overtuigend door er steeds
   meer stippen op te zetten. Op oorspronkelijke pixelgrootte moeten vorm en
   belangrijkste vlakken herkenbaar blijven.

6. **Zwart is volwaardige materiaalinkt.** Gebruik het voor voegen, putjes,
   groeven, breuken, ondersnijdingen en waar passend grotere schaduwvlakken.
   Voor de beoogde steenbehandeling moet zwart ook binnen het materiaal werken.
   Bepaal omvang en verdeling uit vorm, schaal en referentie; leg geen universeel
   zwartpercentage of vaste clustergrootte vast. “Alleen heel subtiele zwarte
   puntjes” kan even tekortschieten als overal zware zwarte lijnen.

7. **Geef patronen een functie.** Dithering suggereert tussentonen en
   overgangen; arcering beschrijft richting; scheuren scheiden vlakken;
   plaatselijke putjes en inkepingen suggereren ruwheid. Laat de verdeling
   reageren op licht, schaduw, slijtage en materiaalvorm. Eén algemene stiplaag
   over alle assets is onvoldoende. Losse pixels en regelmatige patronen zijn
   toegestaan wanneer hun plaatsing zichtbaar iets bijdraagt.

8. **Onderscheid materialen.** Metselwerk vraagt steenverband, voegen en
   plaatselijke beschadiging; rots vraagt onregelmatige facetten en diepere
   uitsparingen; hout vraagt plankrichting en passende nerf; metaal en glas
   vragen andere randen en lichtvlakken. Rood geschilderd hout en rode baksteen
   krijgen niet automatisch dezelfde textuur. Onderbouw materiaalherkenning ook
   met vorm en contrast.

9. **Verdeel detail en rust.** Laat sommige steenvelden en schaduwpartijen
   aaneengesloten. Concentreer karakteristieke details bij randen, overgangen
   en geselecteerde plekken. Speler, projectielen, vijanden en route moeten
   leesbaar blijven. Rust is geen excuus voor onvoldoende gemodelleerde grote
   vlakken; rijkdom is geen reden om elk vlak even druk te maken.

10. **Teken voor herhaling en aansluiting.** Controleer meerdere herhalingen,
    buurtegels, hoeken, trappen, deurposten, boogstenen en materiaalovergangen.
    Voegen en lichtrichting moeten samenhangend doorlopen. Vermijd onbedoelde
    naden, opvallende stempelherhaling en een zichtbaar 8×8-raster. Een
    regelmatig metselverband mag juist regelmatig zijn.

## Projectafspraken voor Stadsburg

- **Wereld en architectuur:** een moderne Nederlandse grachtenstad in een
  winterse nachtscène. Gebruik herkenbare verhoudingen en details van
  grachtenpanden, gevels, winkels, pakhuizen, kades en bruggen; Utrecht en
  Maastricht zijn bruikbare architectuurreferenties. Straatobjecten moeten
  bij deze wereld passen; voeg geen tonnen als generieke straatvulling toe.
  Lampen en andere objecten staan op een geloofwaardige ondergrond;
  silhouetten krijgen verzorgde aansluitingen.
- **Schaal:** behoud de vastgestelde zesmeterschaal van Kartonion en de actuele
  onderlinge verhoudingen. Gebruik de oorspronkelijke Metalion-afmetingen niet
  opnieuw als automatische maatstaf. Beoordeel huizen, personen, ramen, deuren,
  auto's, vrachtwagens, tankstation, fietsen, bomen, trappen en railings samen.
  Kleine onderdelen moeten ook op spelgrootte als hun bedoelde object lezen.
- **Diepte:** maak voorgrond en achtergrond duidelijk door schaal, kleur,
  contrast en detail. Kleinere achtergrondvoertuigen krijgen een passende
  achtergrondbehandeling. Blauw/zwart blijft een bruikbare basis voor de verre
  nachtstad; zwart binnen een rode voorgrondsteen maakt die steen niet tot
  achtergrond. Houd decor, botsbare geometrie en vrije vliegroute helder.
- **Sneeuw:** laat sneeuw op oppervlakken liggen en de constructie volgen.
  Vermijd een overal even dikke witte lijn en sneeuwkappen die een kanon in
  een “hoedje” veranderen. De draagvorm en het mechaniek blijven herkenbaar.
- **Water:** behoud de geaccepteerde tegel-/patterncycling voor rustige
  grachtbeweging en bewegende lichtweerkaatsing. Reflecties horen ruimtelijk
  bij hun lichtbron en mogen variëren in breedte en patroon.
- **Bomen en animatie:** winterbomen houden een samenhangende stam, takken en
  kroon. Beweging moet als wind lezen; vermijd rubberachtige vervorming.
  Gebruik voor omgevingsanimatie de bestaande tegelgebaseerde aanpak en
  beoordeel de complete cyclus op het bedoelde tempo.
- **Gameplay en levelverloop:** respecteer HUD, botsingsrollen, vijandplaatsing,
  timing en vrije vliegruimte bij een materiaalbewerking. De lange ruimte-intro
  vóór de stad en ruimte-outro erna blijven projectuitgangspunt. Wijzig deze
  aspecten alleen wanneer de opdracht ze omvat. Een zwarte groef in de
  tekening is niet automatisch een gat in de botsbare geometrie.

## Werken en beoordelen

1. **Diagnose vóór uitbreiding:** bekijk de hele scène, kies het grootste
   samenhangende beeldprobleem en werk eerst enkele representatieve gevallen
   uit. Vergelijk die met de referentie voordat dezelfde aanpak breed wordt
   doorgetrokken. Verbeter tijdens deze fase niet alleen losse favoriete assets.
2. **Werk vanuit de echte bronnen:** wijzig de canonieke bewerkbare assets en
   gebruik de bestaande bak-/buildketen. Controleer dat de actieve resources
   overeenkomen met de beoordeelde bronnen en dat verouderde kopieën de
   verpakking niet vervuilen. Voorbeelden moeten de werkelijke game tonen.
3. **Gebruik eerlijke vergelijkingen:** toon vóór/na met dezelfde camera,
   speltoestand, animatiefase en schaal. Beoordeel 1×, een scherpe vergroting
   met nearest-neighbor en relevante beweging. Bekijk de daadwerkelijk
   gewijzigde materiaalfamilies en aansluitingen; alleen mooie uitsneden zijn
   onvoldoende.
4. **Beoordeel drie zaken afzonderlijk:** technische geldigheid, zichtbare
   vooruitgang en aansluiting op het gekozen referentieniveau. Benoem wat
   concreet werkt en wat nog ontbreekt. “Konami-waardig”, een hoog cijfer,
   veel gewijzigde tiles of geslaagde tests vervangen dat oordeel niet.
   Laat bij substantieel werk een tweede beoordelaar dezelfde criteria
   toepassen; een onafhankelijk akkoord maakt onvoldoende onderbouwde
   criteria niet beter.
5. **Lever controleerbaar op:** laat de relevante spelbeelden zien, geef de
   echte testresultaten en beperk de claims tot wat werkelijk is bekeken.
   Maak onderscheid tussen automatisch vergeleken frames en visueel
   geïnspecteerde beelden. Los resterende tekortkomingen binnen de opdracht
   op. Publiceer binnen de verleende opdracht en controleer dat de publicatie
   dezelfde beoordeelde assets bevat.

### Vragen vóór artistiek akkoord

- Zijn silhouet, volume en materiaal op 1× overtuigend en passend bij de referentie?
- Hebben zwart, middentonen, licht en textuur ieder een begrijpelijke functie?
- Werken schaal, diepte, herhaling, aansluitingen en beweging in het spelbeeld?
- Blijven actie en route leesbaar, met behoud van de afgesproken beeldgrenzen?
- Onderbouwen de getoonde beelden het oordeel, inclusief nog zichtbare zwakke plekken?

## Concrete referentieankers

- [The Maze of Galious, oorspronkelijke MSX-versie op Konami's site](https://www.konami.com/games/jp/ja/products/dl_win_majou2_egg/):
  zwarte voegen en putjes in grotere blauwe stenen; rustigere lichte
  voorgrondstenen met duidelijke randen.
- [Shalom / Knightmare III, MSX-berggebied](https://www.mobygames.com/game/18610/shalom-knightmare-iii/screenshots/msx/120282/):
  rode rotsen met zwarte inkepingen en richtinggebonden markeringen.
- [Penguin Adventure, oorspronkelijke MSX-versie op Konami's site](https://www.konami.com/games/jp/ja/products/dl_win_yumetairikuadv_egg/):
  rode grotwanden met aanzienlijke zwarte schaduwvormen en ingesneden randen.
- [Texas Instruments TMS9918A/9928A/9929A Data Manual, sectie 2.4.2](https://computers.baffa.tec.br/pages/datasheet/TMS9918A_TMS9928A_TMS9929A_Video_Display_Processors_Data_Manual_Nov82.pdf):
  oorspronkelijke beschrijving van Graphics II en de kleurparen per patroonrij.
