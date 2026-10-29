# BMSX A04 - los toetsenbord en externe voeding

## Vastgelegde ontwerpkeuze

Het toetsenbord heeft 83 toetsen, verdeeld over zes rijen met een nominale hartafstand van 19,05 mm. Het veld is 16 toetsbreedtes (304,8 mm) breed; de twee ABS-schalen meten 350 × 155 mm. De lokale kastdikte is 24 mm, de toetsbovenkant ligt op 31 mm. De complete module staat 3 graden achterover op zes rubberen wigvoeten. Daarmee komt de hoogste toets circa 40 mm boven het tafelvlak. Deze maten zijn ontwerpkeuzes, geen aan een bestaand product ontleende toleranties.

De indeling is compacte ANSI QWERTY met Escape, F1-F12, Ctrl, Alt, Tab, Backspace, Enter, Home/End, Insert/Delete, Page Up/Down en vier losse pijltjestoetsen. Het numerieke blok vervalt om de breedte te beperken. Een Fn-toets biedt ruimte voor aanvullende functies; de concrete Fn-laag is nog firmwarewerk. Een terminal heeft zo directe toegang tot de gebruikelijke tekst-, navigatie- en bedieningstoetsen zonder dat de console groter wordt.

De vrije kabel is in het CAD-model werkelijk 2.000 mm lang, gemeten langs de hartlijn tussen de kabeluitgang van de trekontlasting en de plug. De kabel is in een losse slinger gelegd om hem samen met de behuizing te kunnen bekijken. De kleinste getekende bochtradius is 25 mm bij 4 mm buitendiameter. De lengte komt uit de BRep-randen; het betreft geen optisch geschaalde of afgekorte illustratie. Een detailaanzicht kan een deel van de bestaande kabel verbergen.

## Tastmechaniek en interne opbouw

Van onder naar boven bestaat het toetsenveld uit een stalen steunplaat van 0,8 mm, PET-isolatie van 0,125 mm, twee bedrukte PET-contactfilms van elk 0,125 mm met een tussenlaag van 0,10 mm, een siliconen domemat met een basisdikte van 0,8 mm, een ABS-geleideframe en afzonderlijke holle ABS-toetskappen. De kappen hebben een nominale wand van 1,2 mm. In CAD zijn de holle domes en kleine ontluchtingskanalen aanwezig. De 3,5 mm toetsweg is een ontwerptarget; de kracht-wegcurve moet met proefmatten worden vastgesteld.

Het frame heeft ronde geleidingen met 4,8 mm boring, een 4,4 mm plunjer en 7 mm geleidelengte. Een gesplitste retouraanslag houdt iedere kap in het frame. De nominale radiale speling is 0,20 mm; dat is nog geen worst-case tolerantieberekening. De veerweg, wrijving, klik-/snapvervorming en matrijslossing zijn niet gekwalificeerd. Grote toetsen hebben een afzonderlijke route voor een stabilisatiedraad van 1,2 mm. De precieze kunststof clips, draaduiteinden en beweegbare lagering daarvan moeten nog in de productie-uitwerking worden gesloten.

Zes M2,5 schroeven verbinden het geleideframe en de steunplaat met de onderbak; aparte hard stops voorkomen dat de contactfilms de klemlast dragen. Vier ribben onder de stalen plaat ondersteunen tikbelastingen. Zes andere schroeven sluiten de twee kastdelen. Een 54 × 24 × 1 mm controllerprint ligt onder de achterzijde van de steunplaat en is met vier M2-bevestigingen geplaatst. Het flexibele membraaneinde loopt door een eigen venster in het staal naar een connector op die print. De getekende flexvorm is een geometrische route; de geleidende patronen, minimale buigradius en connectorselectie zijn nog niet vrijgegeven.

Deze bouwmethode is historisch verdedigbaar. Een octrooi van David A. Bruner, oorspronkelijk toegewezen aan Lexmark en gepubliceerd op 7 december 1993 bespreekt bestaande toetsen met rubberdome, plunjer en glijlager; het benoemt 3,5-4,0 mm als gebruikelijke volledige toetsweg van desktoptoetsenborden. BMSX gebruikt dat als periodebewijs voor de constructiefamilie, niet als toestemming om de prestaties of levensduur van een ander toetsenbord over te nemen. Bron: US5268545A, achtergrond en figuur 1, https://patents.google.com/patent/US5268545A/en .

## Kabel, aansluiting en elektronica

De kabel verlaat het toetsenbord aan de achterzijde, centraal op x = 175 mm. Een captive hals ligt in de kastnaad; een afzonderlijke tweeschroefs klem grijpt de buitenmantel vast voordat de aders bij de print komen. Een kabeltrek komt daardoor mechanisch in de onderbak terecht. De getekende klem en steunen moeten nog met een gekozen kabelmateriaal en trek-/buigproef worden getest.

De aansluiting is PS/2 via mini-DIN-6, met 5 V, massa en open-collector klok/data. Pin 1 is DATA, 3 massa, 4 +5 V en 5 CLOCK; 2 en 6 blijven vrij. Dit is een bewuste fysieke interfacekeuze. De 3,3 V console-I/O heeft een afzonderlijke niveauaanpassing. Er is een vermogensreservering van maximaal 80 mA bij 5 V voor het toetsenbord. De elektrische A04-specificatie bevat de verdere voedings- en ESD-keuzes.

Een 8 × 11 matrix biedt 88 posities voor 83 toetsen en vraagt 19 scanlijnen. Een maskergeprogrammeerde controller in een 44-pins behuizingsklasse heeft daarvoor voldoende gereserveerde I/O naast klok/data, oscillator en voeding. Er is nog geen specifiek fabrikantonderdeel of werkend scanprogramma gekozen. De membraanmatrix heeft niet automatisch volledige rollover. De firmware moet spooktoetsen onderdrukken; de fysieke matrixindeling moet belangrijke terminalcombinaties onafhankelijk houden. Een claim als '83-key rollover' hoort daarom niet bij dit ontwerp.

## Materialen en fabricage

Kast en toetsgeleidingen: spuitgegoten ABS, nominale hoofdwand 2,4 mm. De onderbak heeft gekoppelde schroefbossen en ribben; ribbasis circa de halve hoofdwand. Toetskappen: ABS, donkere functietoetsen en lichtere alfanumerieke toetsen, met een blauwe Enter-toets als verwijzing naar de consolebediening. De opdruk wordt na het vormen aangebracht, bijvoorbeeld tampodruk met passende slijtvaste deklaag; de CAD bevat geen verheven letters. Domemat: siliconenrubber, voorlopig 50 Shore A als startpunt voor proefmatten. Films: PET met gezeefdrukte contactbanen. Steunplaat: verzinkt laagkoolstofstaal.

Dit zijn nominale productgeometrieën. Vormlossing, uiteindelijke krimpcompensatie, uitwerperposities, aanspuitpunten, textuur en de toleranties van geleidingen moeten in het matrijsontwerp worden vastgelegd. De CAD houdt onderdelen uit elkaar, maar vervangt deze productie-engineering niet. De scheidingsnaad en schroefmontage maken reinigen en vervangen van de mat en controllerkaart mogelijk.

## Externe voeding

De console krijgt een gereguleerde externe voeding van 9 V DC, 3 A, maximaal 105 × 60 × 42 mm. De DC-stekker is 5,5/2,1 mm, midden positief. De twee meter lange laagspanningskabel krijgt twee soepele koperen aders van elk 0,75 mm²; de elektrische analyse onderbouwt de spanningsval. In het adapter-CAD staan behuizing, naad, voeten, etiketvlak, kabeluitgang en een plek voor de apparaataansluiting. De lange DC-kabel is hier alleen als 100 mm aanloop getekend; de volledige 2 m is een expliciete inkoopeis.

De adapter is een inkoopmodule. Het model verklaart geen netspanningsschakeling, isolatieafstand, EMC, temperatuur of keurmerk als bewezen. Er staan bewust geen fictieve goedkeuringslogo's op het etiket. Bij selectie moet de leverancier 9 V/3 A-regeling, toepasselijke elektrische veiligheid, thermische grenzen en connector-/kabelgegevens aantonen. De afmetingsklasse is een ontwerpallocatie, geen claim dat een specifiek 1995-model precies deze maat had.

## Montagevolgorde

1. Zet de controllerprint op de vier onderbaksteunen en bevestig de kabeladers aan de juiste connector.
2. Plaats kabelhals en mantel onder de afzonderlijke kabelklem; zet de klem vast voordat de kabel elektrisch wordt getest.
3. Leg de stalen plaat op ribben en steunbossen; voer het membraaneinde door het daarvoor uitgespaarde venster.
4. Plaats isolatie, contactfilms, tussenlaag en domemat op hun uitlijnpunten; sluit het flexeinde aan.
5. Monteer geleideframe, toetsen en stabilisatoren als vooraf gecontroleerde toetsmodule. Zet de zes moduleschroeven op hun hard stops vast.
6. Sluit de bovenkap met de zes kastschroeven. Plaats voeten; controleer vervolgens iedere toets, combinaties, LED-/hostcommando's en kabeltrekontlasting.

## Verificatiegrens

De releasebestanden bevatten per onderdeel geldige BRep-volumes, STEP-herimport en een afzonderlijke mechanische controle. Die bewijzen alleen wat in de genoemde controle expliciet staat. De hardware bevat nog geen vrijgegeven toetsenbord-PCB, membraanbanen of productietooling. Toetsgevoel, vastlopen bij excentrisch drukken, de lange toetsstabilisatoren, vouwradius, trekontlasting en levensduur moeten op prototypes worden gecontroleerd.
