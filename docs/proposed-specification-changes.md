# BMSX — voorgestelde specificatiewijzigingen

Dit document bundelt de productwijzigingen die uit het fysieke consoleontwerp
volgen of daarbij worden overwogen. Het is een **voorstel**, geen vervanging
van de bestaande specificatie. De huidige programmeerbare contracten staan in
[Book I](book1/console.md), [Book II](book1/cpu.md) en
[Book III](book3/cartridge.md); de voorgestelde constructie staat in
[Book IV](book4/index.md). Afwijkingen zijn pas definitieve productregels als
ze in de betrokken handleidingen en implementaties zijn uitgewerkt.

**Status:** de gebruiker heeft de richtingen voor meer-cyclus-DMA,
werkafhankelijke GEO- en CPU-timing en fysiek begrensde video goedgekeurd. Ook is
gekozen voor mono als standaardbron en onafhankelijke linker-/rechtervolumes
per stem, en voor één fysiek budget voor de volledige taalruntime wanneer een
fysieke uitvoering wordt gekozen. Op 18 november 2026 is gekozen om die
taalruntime als records in het publieke hoofd-RAM te plaatsen; zie
[de taalheap in hoofd-RAM](#sec-proposal-language-heap). De vorm van die CPU-uitvoering wordt opnieuw
beoordeeld: BLua32 is een programmeerarchitectuur en hoeft niet als een volledig
hardwired taalruntime te worden opgevat. De precieze programmeringsinterface en numerieke grenzen hieronder
zijn nog niet vastgesteld. Er is geen specifieke stemlimiet, IRQ-tijd of
voedingsstroom goedgekeurd.

## Plaats van dit document

Het doel is één samenhangend consoleontwerp met een fysiek realistisch
hardwarecontract en een efficiënte emulator. De bestaande Books I–III en de
TypeScript- en C++-runtimes beschrijven het uitgangspunt, niet het bewijs dat
de huidige timing, capaciteit of garanties fysiek haalbaar zijn. Een voorstel
wordt dus niet afgewezen omdat het van die bestaande afspraken afwijkt.
Een eenvoudiger, PSX-achtiger contract mag de huidige organisatie vervangen.
Dit betreft het hele document, niet alleen IMGDEC en DMA.

De fysieke analyses helpen die nieuwe afspraken kiezen. Een nog niet
gekwalificeerde schakeling bewijst niet dat iedere uitvoering van een functie
onmogelijk is; omgekeerd bewijst een functionele emulator geen haalbaar
moederbord. Elektrische en mechanische kwalificatie blijven afzonderlijk nodig.

Realistische guesttiming en efficiënte hostuitvoering zijn beide vereist.
Een nieuwe instructieduur volgt uit de gekozen machine, niet uitsluitend uit
de snelheid van één emulatorhost. Een grotere theoretische bandbreedte bewijst
evenmin dat ROM-streaming samen met tekenen, gamecode en geluid werkelijk
realtime werkt. De prestatie-intentie voor normaal BLua-gebruik uit
[CPU-uitvoering](#sec-proposal-cpu-execution) blijft daarbij behouden.

Een nieuw ROM- of apparaatdataformaat moet eveneens uit het gekozen
hardwarecontract volgen, niet uit een goedkoper pad op de SNES Mini of een
andere emulatorhost. De packer mag bronmateriaal omzetten naar het echte
apparaatformaat; hostspecifieke caches, voorberekende decodertoestand en
uitvoeringsversnellingen horen niet daarom in de cartridgegegevens terecht
te komen. Een formaatwijziging blijft mogelijk wanneer de hardwarefunctie en
haar kosten die zelfstandig rechtvaardigen. Alleen vaststellen dat de PSX of
N64 ook blokken gebruikt, onderbouwt geen specifieke BMSX-blokindeling of timing.

Concrete wijzigingen worden samen verwerkt in de publieke handleidingen,
beide runtimes en de betrokken BIOS-, cartridge- en testproducenten. Behoud
van oude versies of savestates is geen ontwerpvoorwaarde; een migratie- of
compatibiliteitslaag is niet vereist. De bestaande registerwerking blijft
tot die gezamenlijke wijziging wel het beschreven huidige gedrag, niet een
reden om een onrealistische afspraak te behouden. De goedgekeurde richtingen
in het overzicht blijven uitgangspunt; nog niet gekozen numerieke grenzen
worden hiermee niet stilzwijgend vastgesteld.

## Ontwerpbesluit: eenvoud vóór behoud van het bestaande model

De PSX en N64 zijn referenties voor de benodigde mechanismen, niet alleen
voor een gewenst prestatieniveau. Een ingewikkelder BMSX-contract vereist een
concrete functie die de meerkosten rechtvaardigt. Zonder zo'n reden wordt het
contract vereenvoudigd, ook wanneer bestaande software, registerinterfaces,
tests of constructiekandidaten daardoor moeten veranderen. De onderstaande
uitwerkingsstudies leggen dus geen behoudsplicht op voor de huidige details.

Voor IMGDEC en DMA betekent dit **blokverwerking als uitgangspunt**, niet een
groter decode-quantum boven op dezelfde fijnmazige planning. De kern is een
begrensd invoer-/uitvoerblok, bulktransport en afzonderlijke zichtbare
voltooiing. Per-woordbuscycli in de fysieke datapath vereisen niet automatisch
een openbaar voortgangspunt of een emulator-event per woord. De gekozen
blokgrenzen moeten wel bepalen wanneer data, BUSY, resultaat en IRQ zichtbaar
zijn en wanneer een gedeelde bus niet voor ander werk beschikbaar is.

Dit sluit aan bij de afzonderlijke decode- en copy-outfase in
[DuckStations MDEC](https://github.com/stenzek/duckstation/blob/master/src/core/mdec.cpp),
de bulkoverdracht in
[MAMEs PSX-MDEC](https://github.com/mamedev/mame/blob/master/src/devices/cpu/psx/mdec.cpp)
en het gescheiden datatransport en voltooiingsinterrupt in
[Mupen64Plus' PI-controller](https://github.com/mupen64plus/mupen64plus-core/blob/master/src/device/rcp/pi/pi_controller.c).
Hun concrete timing en emulatiebenaderingen zijn geen automatisch bewijs van
fysiek BMSX-busgedrag. Wel vervalt de aanname dat BMSX iedere bestaande kleine
FIFO-publicatie, willekeurige I/O-naar-I/O-route of registerinterleaving moet
blijven ondersteunen. Vaste apparaat-eindpunten en RAM als overdrachtsbuffer
zijn volwaardige eenvoudiger alternatieven. GPU-pakketopbouw hoeft evenmin
een taak van de beelddecompressor te blijven.

Dezelfde toets geldt voor GEO/GTE, beeldcircuits, audio, input, cartridges en
supervisorcontexten. Er wordt niet steeds extra opslag, arbitrage of een
bijzondere geheugentoegang ontworpen om een bestaande mogelijkheid koste wat
kost te redden. Een functie beperken of verwijderen is een geldig resultaat;
alleen een ander opslagformaat kiezen of hetzelfde gedrag verplaatsen naar een
nieuwe laag is nog geen vereenvoudiging van het hardwarecontract.

De concrete vereenvoudiging van het apparatenmodel betreft **IMGDEC, DMA en
APU**. Dat is geen opdracht om alle overige hardware opnieuw te ontwerpen. De
overige voorstellen hieronder behouden hun afzonderlijke inhoud en besluitstatus.

IMGDEC is uitgewerkt als een verliesloze woorddecoder zonder GPU-pakketopbouw
of kennis van textures en palettes. De programmeerinterface, blokpublicatie en
stroomcodering staan uitsluitend in de [IMGDEC-handleiding](book1/imgdec.md).
DMA gebruikt vaste apparaatpaden, een BUSY-beveiligde registerfile en
begrensde bursts met gedeeld busbezit. Het actuele contract staat in de
[DMA-handleiding](book1/dma.md); onafhankelijke verzoekselectoren en
willekeurige interne I/O-eindpunten zijn vervallen. De APU-interface zelf is
nog niet vervangen.

Ook automatische coherentie tussen VRAM-writes en texture-/CLUT-lezingen is
**geen behoudseis**. Opdrachten op volgorde uitvoeren vereist niet dat de
texturelezer iedere eerdere VRAM-write zonder expliciete handeling ziet.
Een begrensde texturecache met invalidatie of afzonderlijk geladen
texturegeheugen zijn alternatieven. Referenties zijn
[DuckStations cache-clear-opdracht](https://github.com/stenzek/duckstation/blob/73c4055ad047c0c93f8143a767205330c8dfaf1a/src/core/gpu.cpp#L2793-L2801)
en [libdragons expliciete TMEM-loads](https://github.com/DragonMinded/libdragon/blob/e356bf3f56f7afbf7e5246329562f145965cfdfc/include/rdpq_tex.h#L80-L111).
Die modellen zijn niet onderling gelijk: cachemissers kunnen data ophalen,
terwijl expliciet texturegeheugen door laadopdrachten wordt gevuld. De keuze
moet capaciteit, vullen, vervangen en zichtbaarheid bepalen; toevallig oude
data in een hosttexture is geen hardwarecontract. Er is nog geen van beide
gekozen. Blending, mask-checks, copies, scanout en CPU-readback hebben eigen
lees-/schrijfafhankelijkheden, die niet door deze keuze vervallen. Het huidige
contract in [de GPU-handleiding](book1/gpu.md#sec-memory-shared-gpu-storage-and-display-publication)
blijft beschreven totdat manuals, runtimes en opdrachtproducenten gezamenlijk
zijn aangepast.

VRAM-uitlezing moet daarbij afzonderlijk van host-snapshots worden beoordeeld.
De PSX heeft zelf een VRAM-leespad; dat laat ook
[DuckStations GPU-implementatie](https://github.com/stenzek/duckstation/blob/master/src/core/gpu.cpp)
zien. Eén geordende leesoverdracht met wachttijd is iets anders dan twee
gelijktijdig behouden volledige readback-resultaten voor cartridge en
supervisor. Behoud van die dubbele snapshots is geen eis meer. Evenmin
rechtvaardigen rewind of emulator-savestates een extra fysieke geheugenbank.
Omgekeerd bewijst een dure GPU-naar-CPU-readback op één host niet dat iedere
VRAM-leesfunctie uit de console moet verdwijnen.

## Overzicht en besluitstatus

| Onderwerp | Richting | Wat nog niet vaststaat |
|---|---|---|
| DMA | Vaste routes en begrensde bursts uitgewerkt in Book I | Fysieke integratie en kwalificatie |
| IMGDEC | Ruwe verliesloze blokdecoder uitgewerkt in Book I | Fysieke integratie en kwalificatie |
| GEO | Werk- en geheugenafhankelijke intervallen voor alle opdrachten uitgewerkt in Book I | Fysieke integratie en kwalificatie |
| GTE | Gedeeld fysiek rekenpad onderzoeken | Voltooiingstijd van gewone commando's en zichtbare wachttijd; niet goedgekeurd |
| Video | Fysiek begrensde uitvoer goedgekeurd | Exacte bemonstering, sync en gekwalificeerde grenzen |
| GPU-uitvoeringstijd | Geheugenplanning en zichtbare commandovoltooiing verenigen | Fysieke architectuur of mogelijke timingwijziging; niet goedgekeurd |
| GPU-texturecoherentie | Automatische zichtbaarheid van iedere VRAM-write is geen behoudseis | Texturecache of expliciete textureopslag, capaciteit en laad-/invalidatieregels |
| GPU-readback | Eenvoudig geordend leespad beoordelen; dubbele context-snapshots niet verplicht | Functieomvang, wachttijd en afhandeling bij contextovername |
| CPU-timing | Vaste nominale werkklassen met expliciete volumekosten als proef, met C++-/assemblyachtige prestatie-intentie voor normaal BLua-gebruik | Spelvalidatie en beoordeling van de proef; fysieke CPU en kwalificatie blijven afzonderlijk |
| CPU-taalopslag | De taalheap wordt records in het publieke hoofd-RAM van 4 MiB, inclusief constantenpools, globals, frames en beheer; de GEO-scratchreservering vervalt ([§12](#sec-proposal-language-heap)) | O1–O7 besloten; fasen 1–3 uitgevoerd |
| APU-bron en stereoplaatsing | Mono als standaard; onafhankelijke niveaus links en rechts | Programmeringsinterface, representatie en compatibiliteit |
| APU-belasting | Garantie op basis van werkelijk haalbare belasting onderzoeken | Garantiedomein, eventuele stemlimiet en gedrag bij bereiken daarvan |
| APU-broncontrole | Bestandsgroottecontrole vervangen door fysiek busgedrag onderzoeken | Exacte adres-, lege-kaart-, BADP- en foutregels en compatibiliteit |
| APU-supervisorhold | Stemtoestand behouden; sampletransfers blijven afzonderlijk | Teller tijdens hold verschilt tussen Book I en emulator; DAC-uitvoer is open |
| Cartridge-IRQ en DREQ | Fysiek uitvoerbare signalering onderzoeken | Keuze van het IRQ-contract en elektrische timing |
| Pointer | Gedrag bij een lege beeldextent onderzoeken | Of en hoe de nul-extent openbaar wordt gespecificeerd |
| Pad- en accessoireprotocol | Fysieke seriële aansluiting uitgewerkt als voorstel | Openbare interface, moment van uitvoer en verhouding tot het inputcontract |
| Fysieke cartridge-interface | Aansluiting en bus uitgewerkt als voorstel | Openbare elektrische, mechanische en timingvoorwaarden |
| Constructie en kwalificatie | Passieve koeling; originele pinouts behouden waar overeengekomen | Onder meer voeding, componentgrenzen en connectorpassing |

De goedkeuring van een **richting** legt niet automatisch de genoemde
voorbeeldwaarden of een nieuwe registerinterface vast. Omgekeerd zijn open
constructiepunten niet vanzelf wijzigingen van het programmeercontract. Dit
overzicht is de centrale lijst voor de voorgestelde wijzigingen. Nog niet
vastgestelde voorstellen wijzigen de boeken en emulator niet automatisch;
een vastgesteld contract wordt samen in handleidingen en runtimes verwerkt. De volledige bewaarde uitvoeringsstudies
staan achter de dertien hoofdonderwerpen in de bijlage.

## 1. DMA: fysieke voortgang en voltooiing

De vastgestelde programmeerinterface staat in de [DMA-specificatie](book1/dma.md).
De constructiekandidaat staat bij de [fysieke DMA-volgorde](book4/hardware.md#physical-dma-sequencing).
De eerdere kandidaat met willekeurige I/O-eindpunten, aparte verzoekselectoren,
configureerbare bloklengtes en overschrijfbare BUSY-registers is vervallen.
GPU-pakketten mogen over bursts doorlopen; pakketuitlijning is geen
transportvoorwaarde. De fysieke schakeling en elektrische timing moeten nog
worden geïntegreerd en gekwalificeerd. Dat is geen reden om de geschrapte
registerinterleavings terug te brengen.

## 2. GEO: werk- en geheugenafhankelijke timing

De werk- en geheugenafhankelijke uitvoering van XFORM2, SAT2 en OVERLAP2D
staat in de [GEO-specificatie](book1/geo.md#sec-geo-work-budget-and-timing).
De eigen commandoreferenties leggen bronbemonstering, werktoerekening,
betaling vóór publicatie en het afbreken van onvoltooid werk vast. De vaste
recordrate is vervallen; deze programmeerregels zijn geen open alternatieven
meer. Registerwoorden, gegevensformaten, fouten en voortgang worden
uitsluitend in die handleiding gespecificeerd.

De tarieven gebruiken de BMSX-rekenklok en woordpaden. Het zijn gekozen
producttarieven, geen gemeten of overgenomen PlayStation-latenties. Zij
kwalificeren de doorvoer van de voorgestelde fysieke engine niet.

**Fysieke integratie.** De GEO-verzoekproducer is nog niet op de volledige
CORE-geheugenroute aangesloten. Die producer moet de raw-geheugenroute voor
GEO kiezen, ook voor de samenvatting. Het bestaande onderscheid met gewone
gemapte toegang verleent GEO geen nieuw I/O-pad. De volledige engine moet
nog worden geïntegreerd en gekwalificeerd; de vastgelegde programmeertiming
bewijst niet dat een fysieke uitvoering haar haalt.

### GTE: voltooiing van normale commando's

De [GTE-specificatie](book1/gte.md#sec-gte-completion-and-throughput) laat de
resultaten van een normaal commando beschikbaar zijn wanneer de COMMAND-write
voltooit. De nominale `CYCLES`-waarde is geen wachttijd; een directe store
heeft twee CPU-basisklokken. PLUS kan daarnaast onafhankelijk een opdracht
uitvoeren en publiceert VMAD3 na vijf systeemklokken.

Een fysieke kandidaat hergebruikt de normale rekenpaden over meerdere stappen
en rondt de write pas af nadat de resultaten klaarstaan; PLUS behoudt zijn
afzonderlijke pad. Daarmee blijft de resultaatvolgorde bedoeld, maar de
verstreken tijd van de write kan veranderen. Book I noemt zowel de gewone
basiskosten en eventuele device-waits als het ontbreken van een normale
GTE-busy-wacht. Of deze fysieke wachttijd daarmee verenigbaar is, moet samen
met de emulator en gelijktijdige toegang worden vastgesteld. Een mogelijke
wijziging van zichtbare timing is **nog niet goedgekeurd**; er is geen nieuwe
limiet of commandolatentie gekozen. De gedeelde paden zijn evenmin bewijs dat
de huidige tijdseis onmogelijk is. Zie [de GTE-organisatie](book4/hardware.md#sec-physical-gte-command-path).

### GPU: uitvoeringstijd en lokaal geheugen

Book I geeft een lokale copy van 3 × 5 zestienbitwoorden een uitvoeringsduur
van 15 systeemcycli vanaf de start van het commando. De onderzochte
[geheugenplanner](../hardware/rtl/gfx_memory_scheduler.sv) draait op 54 MHz,
reserveert per 64 klokken maximaal 14 aaneengesloten slots voor rendererwerk
en gebruikt twee slots per 32-bit schrijfoperatie. Vijftien systeemcycli
beslaan ongeveer 23,92 van die geheugenklokken; zelfs een ruim geteld venster
van 25 klokken bevat hoogstens 14 renderer-slots.

Als de copy zijn vijftien verschillende doelwoorden na commandostart binnen
die tijd rechtstreeks in het gedeelde SRAM moet schrijven, zijn ook bij ideaal
gepaarde woorden minstens acht 32-bit schrijfacties nodig. De planner kan in
dat venster hoogstens zeven van zulke writes afhandelen, nog zonder de
bronreads. Deze kandidaat met directe SRAM-publicatie draagt die vaste
voltooiingstijd dus niet. De scheduler bevat geen complete renderer; een
andere planning, extra parallelisme of een correct doorgestuurde schrijfbuffer
kan de grens veranderen en moet ook de zichtbaarheid voor latere GPU- en
displaylezingen behouden. Dit is geen bewijs dat alle fysieke uitvoeringen
onmogelijk zijn. Er is **geen GPU-timingwijziging goedgekeurd** en geen nieuwe
voltooiingsregel of snelheidslimiet vastgesteld.

Een alternatieve architectuurrichting combineert tijdige scanoutreserveringen
met dynamische toewijzing van vrije slots en een begrensde schrijfbuffer.
Die buffer moet eerdere writes doorgeven aan latere GPU- en displaylezingen;
een overlappende copy moet de voorgeschreven lees-/schrijfvolgorde behouden.
Een GP0-IRQ-marker is geen displayfence en verplicht op zichzelf niet tot het
legen van de buffer. Zo'n buffer vangt pieken op, maar lost een structureel
tekort aan geheugencycli niet op. Een snellere schrijfcyclus, extra parallel
geheugen of een andere fysieke timing kan nodig blijken; geen daarvan is hier
gekozen of bewezen. De [geheugenorganisatie](book4/hardware.md#sec-physical-gfx-memory-schedule)
beschrijft de voorgestelde richting.

Een concrete verbredingsoptie is vier 256K × 16-geheugens parallel te
gebruiken als één 64-bit datapad. Dat blijft 2 MiB logisch videogeheugen,
maar vervangt de huidige twee 512K × 16-geheugens en hun 32-bit datapad.
De grotere overdracht kan bij geschikte uitlijning de druk op het geheugen
verminderen; hij bewijst niet dat overlappende copies, beide beeldcircuits
en andere workloads hun huidige timing halen. Deze variant vraagt een andere
ASIC-pinindeling of interface en een bijpassende print en planner. De huidige
print en geheugenkandidaat zijn hiervoor niet aangepast.

Voor verdere fysieke uitwerking is 64-bit SRAM met flexibele planning de
concreetste onderzochte richting zonder de GPU-specificatie te verlagen. Het
is nog geen vastgestelde productkeuze: de toegangsvolgorde, prestaties en
fysieke inpassing zijn niet bewezen. Verbreding alleen verhelpt de starre
slotverdeling niet; de planner moet eveneens worden aangepast.

Een mogelijke aansluiting behoudt de bestaande 32-bit snapshotbank: de
64-bit hoofdbank gebruikt 18 woordadreslijnen, de snapshotbank 19. U2 houdt
daarvoor A18 beschikbaar en selecteert per geheugentoegang één bank; de
laagste 32 datalijnen worden gedeeld. Een volledig 64-bit bronwoord kan dan
waar nodig in twee 32-bit snapshotwrites worden opgeslagen. De controller
moet de adresomrekening, byte-enables, pixelvolgorde en oneven eindstukken
verzorgen. Dit maakt de snapshotbank niet tot een onafhankelijke tweede
geheugenpoort en bewijst geen timing of complete implementatie.

Voor dit voorstel bepaalt de GPU of PCRTC eerst het bestaande 20-bit
zestienbit-woordadres `W`, inclusief zijn eigen adressering en omloop. De vier
videogeheugens krijgen daarna hetzelfde fysieke woordadres `W >> 2`:

| `W & 3` | Videogeheugen | Databits | Actieve byte-enablegroep |
|---:|---|---|---|
| 0 | 0 | 15–0 | 1–0 |
| 1 | 1 | 31–16 | 3–2 |
| 2 | 2 | 47–32 | 5–4 |
| 3 | 3 | 63–48 | 7–6 |

Binnen ieder zestienbitwoord staat de lage byte eerst. Een afzonderlijke
woordwrite activeert alleen de twee bijbehorende actieve-lage byte-enables;
de overige geheugens blijven onveranderd. Voor een snapshot met context `c`
en resultaatindex `i` kan de 32-bit bank `(c << 18) | (i >> 1)` als adres
gebruiken; `i & 1` kiest het lage of hoge zestienbitdeel. `c = 0` en `c = 1`
geven de afzonderlijke cartridge- en supervisorhelften. De resultaatindex loopt
over rijen heen door zonder opvulling na een oneven rij; hij is niet het
VRAM-adres. Een oneven laatste resultaat krijgt bij uitlezing een nul in het
ongebruikte hoge deel, ongeacht de oude inhoud van dat deel in de snapshotbank.

Deze aansluitingskeuze verandert de bestaande GPU- of PCRTC-adresformules niet.
Een toegang die fysiek een 64-bit woordgrens overschrijdt, kan meerdere
geheugenbeurten vereisen. Bij een overlappende copy blijft de voorgeschreven
volgorde tussen elke bronread en bestemmingwrite gelden.

Het afzonderlijke [KiCad-deelschema](../hardware/ecad/gfx_wide_vram/GFX_WIDE_VRAM.kicad_sch)
legt deze vier SRAM-aansluitingen vast met de gecontroleerde Micron-pinnummers.
De U2-zijde bestaat uit signaallabels, niet uit vastgelegde ASIC-pinnen. De
snapshotbank, ontkoppeling, timing en volledige printintegratie ontbreken;
het deelschema vervangt het huidige moederbordschema niet.

Een afzonderlijke [gecombineerde schemakandidaat](../hardware/ecad/gfx_vram_snapshot/GFX_VRAM_SNAPSHOT.kicad_sch)
voegt kopieën van de bestaande snapshotbank en haar ondersteuningsblad toe.
De lage datalijnen, adreslijnen en gemeenschappelijke besturing zijn gedeeld;
de twee banken behouden afzonderlijke chipselects. De ontkoppeling en
besturingspull-ups voor de nieuwe VRAM-bank, de U2-pintoewijzing en
bankselectielogica, timing en printintegratie zijn nog niet uitgewerkt.
Deze partiële aansluiting bewijst geen elektrische of timingkwalificatie en
wijzigt het oorspronkelijke moederbord niet.

![Functionele organisatie van de voorgestelde 64-bit videobank en de gedeelde 32-bit snapshotbank.](book4/figures/gfx-wide-vram-snapshot-data-proposal.svg)

Dit is geen geheugenorganisatie die pas bij moderne consoles denkbaar werd:
Micron beschreef in zijn [SRAM-databoek van 1993](https://device.report/m/78d1e0932ff677fc0bf36080f8a6c2fb131f8db3612f0649add4a79b5e554bf9)
een 3,3V-geheugen van 256K × 16. Die vermelding is als *advance* gemarkeerd;
zij bewijst geen beschikbaarheid, prijs of BMSX-timing in 1993. Bij behoud van
de huidige parallelle aansluiting en 32-bit snapshotbank zijn voor de bredere
hoofdbank 32 extra datalijnen en vier extra byte-enable-lijnen nodig. U2 heeft
in de huidige kandidaat slechts één reservepin. Een nieuwe pin- en
behuizingsindeling is dus nodig; de huidige plaatsing en behuizingspassing
kunnen niet automatisch worden overgenomen.

Voor een voorlopig pinplan blijven de bestaande lage 32 datalijnen en vier
byte-enables gedeeld met de snapshotbank; de hoofdbank krijgt daarnaast 32
datalijnen en vier byte-enables. De adreslijnen blijven beschikbaar voor beide
banken, inclusief A18 voor de snapshot. Bij een denkbeeldige 304-pins QFP zijn
er 76 posities per zijde. De huidige geheugeninterface gebruikt 59 pennen en
de verbreding brengt dat op 95; die groep moet dus over minstens twee zijden
worden verdeeld. Systeem-, video-, input- en kloksignalen blijven afzonderlijke
groepen. Dit is een functionele verdeling, geen definitieve pintoewijzing of
garantie voor voedingspennen, fanout of koeling.

Een globale ruimteverkenning voor een hypothetische U2-body van 40 × 40 mm op
de huidige middenpositie geeft geen overlap met de bestaande bovenzijdige
footprint-omgrenzingen zonder tekst. Het eerste cartridgesocket begint in die
projectie wel op ongeveer 2,8 mm van de body. Een groter gereserveerd vlak
raakt andere footprints; de aansluitpennen, onderzijde, koeler en productiepassing zijn in
deze eenvoudige controle niet aangetoond. Dit is geen keuze voor een concrete
chipbehuizing en geen bewijs dat de kast of print groter moet worden.

De bestaande vlakke koelplaat dekt deze denkbeeldige grotere U2-body in
bovenaanzicht niet volledig. Dat betekent niet automatisch dat de koeling
tekortschiet: de werkelijke chipwarmte en het benodigde contactoppervlak zijn
niet bekend. Bij een keuze voor die body moeten het contact en de plaatsing van
de passieve plaat opnieuw worden bekeken; een ventilator volgt hier niet uit.

Voor de twee extra geheugens raakt één onderzochte globale bovenzijdereservering
naast de huidige videogeheugens bestaande voedingsonderdelen. De overeenkomstige
projectie aan de onderzijde is een
mogelijke onderzoekslocatie, maar afstand tot het deck en invloed van de
voeding zijn daarin niet vastgesteld. Een andere plaatsing of verplaatsing van
supportonderdelen blijft mogelijk; dit is nog geen componentenplaatsing.

Een eerste globale indeling behoudt twee geheugenposities aan de bovenzijde en
reserveert twee plaatsen aan de onderzijde. In die specifieke proef raakt één
onderste reservering de doorgangspad van meetpunt TP4; het meetpunt moet dan
worden verplaatst. De gebruikte 14 × 24 mm-rechthoeken zijn globale
ruimteclaims, geen fabrikantfootprints. Het huidige model geeft 7 mm tussen
het printondervlak en de vlakke bovenzijde van het deck. De oorspronkelijke
[Micron-maattekening uit 1993](https://ftpmirror.your.org/pub/misc/bitsavers/components/micron/_dataBooks/1993_Micron_SRAM_Data_Book.pdf),
pagina 7-21, geeft voor het 54-pins TSOP-pakket maximaal 1,20 mm hoogte vanaf
het montagevlak, maximaal 22,33 mm bodylengte en 11,86 mm pootspan. Deze
onderdeelmaten passen binnen de globale 14 × 24 mm-reservering, maar zijn geen
printfootprint met soldeerpads. De eenvoudige hoogtemaatvergelijking laat dan
nominaal circa 5,8 mm over, vóór soldeer, isolatie en toleranties. Dat is geen volledige
passingscontrole. De onderzijde ligt bovendien tegenover de voeding; warmte,
interferentie en de werkelijke montage blijven open. De bestaande print is
niet gewijzigd.

![Globale boven- en onderzijdeprojectie van de brede videogeheugenoptie.](book4/figures/gfx-64bit-memory-placement-proposal.svg)


De volgende vergelijking plaatst de onderzochte variant naast de bestaande
constructiekandidaat. Zij kiest geen definitieve geheugenarchitectuur en
vervangt de bestaande print en de bijbehorende afbeeldingen niet.

| Onderdeel | Bestaande constructiekandidaat | Onderzochte brede variant |
|---|---|---|
| Vier hoofdchips en externe aansluitingen | CORE, GFX, APU en firmwarebrug; twee cartridges, vier pads, keyboard, SCART en DC | Zelfde functionele indeling; INPUT blijft een voorstel in GFX |
| GFX-behuizing | 208 pennen in de bestaande kandidaat | Grotere of anders ingedeelde interface nodig; 304 pennen is slechts een rekenvoorbeeld |
| Videogeheugen | 2 × 512K × 16; 32-bit, 2 MiB | 4 × 256K × 16; 64-bit, 2 MiB |
| Snapshotgeheugen | Voorgestelde 32-bitbank U152/U153, 2 MiB | Dezelfde bank; deelt de lage datalijnen en krijgt afzonderlijke selectie |
| Passieve koeling en plaatsing | Bestaande voorgestelde spreidplaat en printindeling | Aansluiting van de koeler en de plaatsing opnieuw te beoordelen; geen ventilator voorgesteld |

![Kwalitatieve samenhang van de brede videogeheugenvariant met de vier chips, kast en aansluitingen.](book4/figures/gfx-wide-four-chip-context-proposal.svg)

Dit is een functionele groepering, geen tekening op schaal. Eén eerder
onderzochte mogelijkheid plaatst twee videogeheugens boven en twee onder de
print; de projectie hierboven toont ook het bestaande TP4-conflict. De figuur
bewijst geen vrije ruimte, definitieve pinindeling, montage, koeling of
GPU-timing. Een fysiek moederbord voor deze variant is nog niet uitgewerkt.

Voor de GFX-aansluitingen is een logische groepering mogelijk met systeem en
interrupts aan de kant van U1, geheugen aan de zijde van de geheugens, video
richting de video-onderdelen en input richting de frontaansluitingen. In één
304-pins rekenvoorbeeld vullen de geheugen- en videozijde samen met de huidige
voedingsaansluitingen al hun beschikbare posities. Vrije posities aan andere
zijden bewijzen dus niet dat daar voldoende extra voeding of signaalscheiding
kan worden geplaatst. De daadwerkelijke pinvolgorde en footprint blijven open.

Een andere historische richting is afzonderlijke displaytoegang. Sony's
[PlayStation-hardwarehandleiding](https://psx.arthus.net/sdk/Psy-Q/DOCS/Devrefs/Hardware.pdf)
beschrijft een dual-port framebuffer voor gelijktijdig tekenen en weergeven.
Ook Microns [VRAM-databoek uit 1993](https://www.bitsavers.org/components/micron/_dataBooks/1993_Micron_Specialty_DRAM_Data_Book.pdf)
beschrijft geheugen met een willekeurige DRAM-poort en een afzonderlijke
seriële displaypoort. Dat is een ontwerpreferentie, geen bewijs dat dit
specifieke geheugen de twee onafhankelijk programmeerbare BMSX-beeldcircuits,
hun formaten of de vereiste GPU-timing ondersteunt. Een eventuele overstap
verandert bovendien de fysieke geheugeninterface en moet eerst als geheel
worden uitgewerkt.

De onderzochte MT42C4256 uit dat databoek heeft één seriële uitleespoort;
zijn gesplitste seriële register biedt geen twee onafhankelijk adresseerbare
displaypoorten. Voor BMSX zijn daarom aanvullende organisatie en buffering
nodig als beide beeldcircuits tegelijk verschillende gebieden lezen. De
samengestelde uitvoer moet ook de volgorde en zichtbaarheid van GPU-writes
behouden. Dit is een grens van dit geheugenvoorbeeld, niet van alle mogelijke
VRAM-architecturen.

Een mogelijke hybride behoudt één logisch 2 MiB-geheugen: de seriële poort
levert bruikbare aaneengesloten stroken voor één beeldbron, terwijl de andere
beeldbron en overige GPU-toegang via de willekeurige poort met eigen buffers
worden gepland. Niet alle ondersteunde beeldformaten hebben aaneengesloten
rijen; de seriële route kan dus niet zonder meer voor elke instelling worden
gebruikt. Geheugenverversing, bronwisselingen, samenloop en zichtbaarheid van
writes zijn daarmee nog niet opgelost. Dit is geen geselecteerde nieuwe
printopbouw of garantie voor de bestaande GPU- en displaytiming.

## 3. Video: logische instellingen en fysieke uitvoer

**Huidig contract.** De [PCRTC-specificatie](book1/pcrtc.md) definieert
logische beam- en pixelinstellingen zonder bijbehorende fysieke uitvoerlimiet.

**Goedgekeurde richting.** Behoud de volledige programmeerbare registerwoorden,
maar geef een expliciete fysieke weergavebaseline. In het huidige constructie-
voorstel klokt de DAC op **13,5 miljoen samples per seconde**. Een
instelling met snellere logische veranderingen kan daardoor meerdere logische
pixels tussen twee fysieke samples laten vallen. Dat is zichtbare
onderbemonstering, geen verborgen registerclamp en geen zwarte fallback. De
**54 MHz** van het lokale videogeheugen is een andere klok dan de DAC-sampleklok.
[Video-ontwerp](book4/hardware.md#video-signal-generation).

**Voorstel voor de programmeerbare uitvoer.** Gebruik de bestaande 625-lijnen-/
50-veldenreferentie als een beoogd RGB-uitvoervoorbeeld. Bij
13,5 MHz duurt een lijn 864 fysieke samples; daarvan zijn er in dit voorbeeld
702 voor het actieve interval en 162 voor synchronisatie en porches. Twee
geïnterlinieerde velden vormen één frame. Dit zijn aantallen fysieke
uitvoersamples, geen nieuwe framebufferbreedte of beperking van de
registervelden. Het voorbeeld moet door software worden ingesteld: de huidige
resetbeam heeft 628 halflijnen en selecteert dit profiel niet automatisch.

**Bestaand opstartbeeld.** Naast dit geïnterlinieerde voorbeeld moet de fysieke
video-uitgang ook het bestaande BIOS-opstartbeeld kunnen weergeven: 320 × 240,
niet-geïnterlinieerd, met de huidige PAL-achtige timinginstelling. Deze 320 × 240
betreft de logische beeldinhoud en is niet het totale aantal DAC-samples. De
BIOS-preset gebruikt de huidige resetwaarden voor de verticale timing: 628
halflijnen van nominaal 32 µs, oftewel 314 lijnen en circa 49,76 beelden per
seconde. Een lijn bevat bij 13,5 MHz nominaal 864 uitgangssamples. In het
320-pixelvenster liggen logische pixelstap en nominale sample-afstand gelijk:
de DAC-samplefrequentie vormt op zichzelf dus geen obstakel voor één sample per
beeldpixel in dit venster. Dit is een eenvoudige toets van de bestaande
registerinstelling, geen nieuwe modus of wijziging van BIOS, registers of
emulator.

**Kandidaat voor de opstartsynchronisatie.** Voor de stabiele opstartinstelling
kan de fysieke syncgenerator de bestaande verticale blanking gebruiken:
halflijnen 576–627 van de 628. Een concreet voorstel plaatst vijf korte
voorpulsen in halflijnen 580–584, vijf brede syncpulsen in 585–589 en vijf
korte napulsen in 590–594. Bij 432 samples per halflijn zijn de korte pulsen
32 samples laag en de brede pulsen 368 samples laag; de rest van de halflijn
staat op het hogere referentieniveau. Buiten deze reeks loopt de voorgestelde
gewone lijnsync door. RGB blijft tijdens de verticale blanking afgedekt.

Dit voorbeeld gebruikt dezelfde pulsbreedten als het afzonderlijke
625-halflijnenprofiel, maar behoudt de 628 halflijnen en de niet-geïnterlinieerde
opstart van de BIOS. Het verandert geen registerwoorden en claimt geen
PAL-conformiteit of televisiecompatibiliteit. Halflijn 585 is het logische
VSINT-landmerk, geen bewezen gelijktijdige fysieke uitgangsflank: overdracht
tussen klokdomeinen en de uitvoerpipeline zijn nog niet geïntegreerd. De
vertaalslag voor andere programmeerbare instellingen blijft open.

Als de horizontale velden van de BIOS-preset op dezelfde manier naar fysieke
sync en blanking worden vertaald als in het 625-halflijnenvoorbeeld, levert
dat nominaal circa 0,89 µs front porch en 10,44 µs totale horizontale blanking,
tegenover respectievelijk 1,56 µs en 12 µs in dat voorbeeld. Deze vergelijking
is afhankelijk van die **voorgestelde vertaling**: Book I schrijft die
analoge interpretatie niet zelfstandig voor. Zij bewijst niet dat een
televisie de opstartmodus niet kan weergeven. De sync- en blankingmapping voor
de opstart en voor andere programmeerbare waarden blijft een voorstel; er is
geen verborgen registeraanpassing of nieuwe beperking gekozen.

**Kandidaat voor horizontale uitvoer.** Voor een lopende, gelatchte timing kan
GFX de fysieke lijnfase rechtstreeks vergelijken met de geprogrammeerde
velden: eerst een syncinterval ter lengte van HS, daarna de achterporch HBP,
en aan het einde van de lijn de voorporch HFP. De tussenliggende ruimte is het
horizontale actieve interval. De vergelijking gebruikt de oorspronkelijke fase,
niet een op de pixelstap afgeronde positie. Een beeldvenster buiten het actieve
interval wordt op de fysieke uitgang door blanking afgedekt; de registerwoorden
en logische beam worden niet aangepast. Ook nulvelden volgen deze vergelijking
zonder een speciale BIOS-modus of verborgen clamp.

Voor de bestaande BIOS-waarden bevat het actieve interval nominaal de samples
129–851; het 320-pixelvenster gebruikt samples 170–489. Dit maakt de bedoelde
horizontale organisatie concreet, maar kiest nog geen volledige videoregel.
Onder meer stilstaande of opnieuw gestarte timing, de gelatchte beeldstatus,
verticale pulsen, synchronisatie tussen klokdomeinen en de ontvangen analoge
golfvorm moeten afzonderlijk worden uitgewerkt. Deze kandidaat is niet
geïmplementeerd of als televisiecompatibel gekwalificeerd.

Deze uitkomst bewijst geen PAL-conformiteit of compatibiliteit met een
televisie. De daadwerkelijke SCART-synchronisatie, horizontale en verticale
pulsvorm, fase, klokdomeinoverdracht en aansluiting van de fysieke scanout
zijn nog niet als complete keten aangetoond. Een eventuele wijziging van de
bestaande opstarttiming blijft een aparte productkeuze.

Een cartridge kan zijn bestaande twee leesvensters, framebufferformaten en
registerwoorden blijven gebruiken. De gewenste afbeelding wordt echter pas
één-op-één zichtbaar als de relatie tussen logische pixels en die fysieke
samples, de synchronisatie en de geheugendienst voor die configuratie zijn
uitgewerkt. Een waarde boven de fysieke samplecapaciteit wordt niet op een
ander registerwoord afgerond en geeft niet automatisch zwart; voor zo'n
configuratie is exacte uitvoer op een beeldscherm nog niet gegarandeerd. De
keuze hoe herhaalde of tussen samples vallende logische posities worden
weergegeven moet deel van de uiteindelijke productspecificatie worden en mag
niet stilzwijgend van een emulatorafbeelding worden afgeleid.

**Nog uit te werken.** Beschrijf exact hoe logische beam, sync en pixels op het
fysieke samplemoment worden afgebeeld, inclusief extreme programmeerbare
waarden. Breng emulator en handleiding op die regel; kwalificeer beamgenerator,
PLL, klokovergangen, DAC en analoge uitgang. De 13,5 MHz is de gekozen
constructiebaseline, geen bewijs dat alle programmeerbare modi fysiek
volledig worden weergegeven.

De twee fysieke oscillatoren zijn onafhankelijk; een alleen uit de systeemklok
afgeleide nominale pixelstroom loopt daarom niet vanzelf gelijk met de echte
DAC-klok. De onderzochte kandidaat laat de daadwerkelijke videoklok de
sampleaanvragen bepalen en koppelt beampositie, displaytoestand en systeem-FIELD
met coherente buffers. Het precieze waarnemingsmoment en een vaste uitvoerlatentie
zijn nog niet gekozen. PCRTC-stores mogen volgens het huidige contract niet op
PCRTC-ready wachten; blokkeren bij een volle overdrachtsbuffer zou dus een
afzonderlijke productwijziging zijn, geen reeds goedgekeurde videobegrenzing.

Het [scanoutvoorstel](book4/hardware.md#proposed-scanout-organisation) verbindt
die toestand aan twee onafhankelijke leeskanalen, de gezamenlijke VRAM-scheduler,
compositie en de fysieke uitgang. Het maakt onderscheid tussen de direct
herstartende live beam en de bij VBlank overgenomen displaybank. FIELD komt van
de live systeemtoestand. De buffers bewaren de relatie tussen een geheugenwoord
en de bijbehorende displaytoestand; de precieze verhouding tot gelijktijdige
GPU-schrijfacties is nog niet vastgesteld. Dit is een architectuurvoorstel, geen
nieuwe garantie voor latency, bandbreedte of gedrag bij een gemiste pixeldeadline.

## 4. APU: mono standaard en stereoplaatsing

**Huidig contract.** De [APU](book1/apu.md) heeft zestien slots en een stereo
uitgang op 44,1 kHz. Mono en stereo PCM/BADP zijn allebei al ondersteund;
`SOURCE_CHANNELS = 1` betekent mono en `2` stereo. Een mono- of stereobron
gebruikt één slot. De stagingwaarde van `SOURCE_CHANNELS` reset nu naar `0`.
Een stem heeft één gemeenschappelijke `GAIN_Q12`; er is geen onafhankelijke
linker-/rechterregeling.

**Goedgekeurde richting.** Maak mono de standaard voor de bron en behoud
stereo als mogelijkheid. Voeg per stem afzonderlijke regelingen toe voor de
bijdrage links en rechts, zodat een monobron in het stereobeeld geplaatst kan
worden. De stereo-einduitgang blijft bestaan. Voorkom dat een bestaande
volumewijziging of fade een eerder gekozen plaatsing onbedoeld wist.

**Functionele voorkeursopzet.** Behoud de zestien programmeerbare slots en
laat een monobron én een expliciet ingestelde stereobron elk één slot gebruiken.
De standaard broninstelling is één kanaal; twee kanalen kiezen een stereobron.
Standaard begint een nieuwe stem gecentreerd met beide kanaalniveaus op één;
een PLAY kan in plaats daarvan de ingestelde stagingniveaus overnemen. De
bestaande gemeenschappelijke gain blijft de sterkte en fade bepalen; een
wijziging daarvan verandert de ingestelde links-/rechtsverdeling niet.

Een PLAY neemt de gekozen bron- en niveau-instellingen samen over wanneer de
bronbinding slaagt; een mislukte PLAY laat de vorige stem intact. Een latere
niveauwijziging verandert de verdeling voor volgende uitvoerframes zonder de
bron opnieuw te starten. Bij mono ontvangt elk uitgangskanaal dezelfde bron;
bij een stereobron regelt het linkerniveau links en het rechterniveau rechts,
zonder de kanalen onderling te mengen. Ook de blokgolfgenerator levert één
monosignaal aan deze twee niveaupaden, zonder samplebron te binden of de
kanaalkeuze voor zijn golfvorm te gebruiken. De afzonderlijke filtergeschiedenissen
blijven bestaan.

Gecentreerd betekent in dit voorstel voor beide niveaus een factor één: er
wordt geen automatische −3 dB-correctie of andere equal-power-panwet toegepast.
Een monostem op unity/unity heeft daarmee dezelfde bijdrage per uitgangskanaal
als onder het huidige gemeenschappelijke-gaincontract; de totale mix kan nog
steeds verzadigen. Dit beschrijft de voorgestelde niveauregeling, geen nieuw
reeds beschikbaar register.

![Voorgestelde plaatsing van een mono- of stereostem.](book4/figures/apu-channel-placement-proposal.svg)

Dit is een samenhangend voorstel, geen reeds toegevoegde registerinterface.
De onderstaande adressering en teruglezing zijn één concrete kandidaat; het
gedrag voor expliciet geschreven kanaalwoorden anders dan één of twee en de
nieuwe savestate-representatie blijven afzonderlijk te bepalen. Behoud de
bestaande stereo- en slotfunctionaliteit; stel hier geen nieuwe limiet voor
gelijktijdige stemmen vast.

**Historische toets.** De PlayStation-SPU gebruikt 24 gelijktijdige
ADPCM-stemmen uit 512 KiB lokaal samplegeheugen en heeft per stem aparte
linker- en rechtervolumeregelingen; de stereo-einduitgang maakt de afzonderlijke
stem dus niet zelf stereo. De fabrikant beschrijft ook DMA naar dat lokale
geheugen tijdens geluidsweergave. Zie het
[PlayStation Hardware Reference, Sound System](https://psx.arthus.net/sdk/Psy-Q/DOCS/Devrefs/Hardware.pdf)
en de [MAME SPU-implementatie](https://github.com/mamedev/mame/blob/master/src/devices/sound/spu.cpp).
Dit ondersteunt mono als gebruikelijk uitgangspunt met stereoplaatsing, maar
bewijst geen aantal stemmen of timinggarantie voor de BMSX. De bestaande
BMSX-stereobron blijft in dit voorstel mogelijk en gebruikt in de
voorkeursopzet één logisch slot. Het gedrag van andere kanaalwoorden en de
latere fysieke uitvoering zijn daarmee nog niet vastgesteld.

**Ontwerprichting vanuit de geluidsarchitectuur.** Een stem is in de eerste
plaats een mono samplepad met een eigen afspeelpositie; de mixer verdeelt de
uitkomst met afzonderlijke volumefactoren over links en rechts. Dat levert al
stereoplaatsing op en is niet hetzelfde als een stereosample. De SNES-DSP
verwerkt eveneens een stemuitkomst afzonderlijk voor beide mengkanalen; zie de
[MAME-implementatie van de SNES-DSP](https://github.com/mamedev/mame/blob/master/src/devices/sound/s_dsp.cpp).
Dit is een ontwerpvergelijking, geen bewijs dat de BMSX dezelfde codec,
interpolatie of timing moet gebruiken.

Een stereosample bevat twee onafhankelijke samplepaden. De voorkeursrichting
behoudt de bestaande BMSX-programmeerfunctie van één logisch slot en verwerkt
beide paden met gedeelde besturing en afzonderlijke decoderstatus; een andere
mogelijkheid laat twee programmeerbare monostemmen samenwerken.
Dat laatste zou de slotbezetting en synchronisatie voor bestaande programma's
veranderen. Werk de voorkeursrichting samen met de volledige software-interface,
lus- en startregels uit. De haalbare fysieke belasting en implementatiekosten
worden later getoetst, niet afgeleid uit het aantal bits van de voorlopige
decoder. Een monostem telt als
één bronpad; hoeveel parallelle bronpaden iedere combinatie gegarandeerd kan
gebruiken, is nog niet bewezen. De gebruiker heeft stereo als mogelijkheid
behouden; verwijder die functie niet stilzwijgend.

De eerdere vraag suggereerde dat iedere extra kanaalwaarde noodzakelijk een
eigen fysieke decodertoestand vereist. Dat volgt niet zonder meer: als een
definitief contract alleen bepaalde kanalen uitvoert, kunnen ongebruikte
kanalen mogelijk worden overgeslagen, mits hun layout en alle waarneembare
effecten correct worden gevolgd. Omgekeerd is daarmee geen correct gedrag van
de huidige implementaties voor meer dan twee kanalen aangetoond. De huidige
BADP-lus schrijft alle niet-eerste kanalen achtereenvolgens naar rechts, terwijl
beide runtime-decoders slechts twee toestandsplaatsen hebben. Dit wijkt af van
de PCM-beschrijving waarin kanaal 1 rechts levert; C++-toegang voorbij die twee
plaatsen heeft geen gedefinieerde uitkomst. Een historische vergelijking
bepaalt daarom niet vanzelf wat registerwaarden 0 of hoger dan 2 moeten doen.
Een wijzigingsvoorstel moet die volledige registersemantiek expliciet kiezen,
inclusief reset, readback, adresberekening en compatibiliteit, zonder een
verborgen afkapping tot twee bits.

**Woorddecodering als mogelijke productkeuze.** Eén kandidaat bewaart de
volledige 32-bit woorden voor staging, commando-opname en slotreadback, maar
definieert de volgende fysieke functies van hun bits:

| Woord | Gedecodeerd bit | Functie bij 0 | Functie bij 1 |
|---|---:|---|---|
| `SOURCE_CHANNELS` | 1 | Eén bronkanaal, verdeeld over links en rechts | Twee bronkanalen, links en rechts |
| `GENERATOR_KIND` | 0 | Samplebron, inclusief bronbinding | Blokgolf, zonder samplebronbinding |

De overige bits blijven bij schrijven, opname en readback behouden, maar
selecteren in deze kandidaat geen extra kanalen of generatoren. PCM gebruikt
de geselecteerde één- of tweekanaalsframebreedte; BADP gebruikt dezelfde
kanaalkeuze voor blokheaders, nibblevolgorde en decoderstatus. Dit is een
expliciete wijziging van de formaat- en registerbetekenis, geen onzichtbare
afkapping van het opgeslagen woord. Voorbeelden: `SOURCE_CHANNELS` van `0`
en `1` selecteren mono, `2` en `3` selecteren stereo; `FFFFFFFFH` selecteert
stereo terwijl het volledige woord leesbaar blijft. Een `GENERATOR_KIND` van
`2` selecteert de samplebron en een waarde van `3` de blokgolf. De stagingreset
en het stagingherstel na elk niet-nulcommando, ook een onbekend commando,
gebruiken respectievelijk `1` en `0` als standaardwoorden. `CMD=NONE` laat de
staging ongemoeid. De bestaande opnamevolgorde blijft uitgangspunt.

Een geselecteerde-slotwrite naar een van deze bronwoorden blijft een live
bronvervanging bij een actieve of gepauzeerde stem. Ook als alleen een niet
voor de selectie gebruikt bit verandert, wordt het ruwe woord eerst opgeslagen
en wordt daarna opnieuw gebonden met de actuele cartridgeselectie. Dit kan de
BADP-toestand opnieuw initialiseren of een bronfout geven. Bij een mislukte
live binding blijft het geschreven woord behouden en wordt de stem gestopt;
een mislukte PLAY laat daarentegen de bestaande stem intact. De ongebruikte
selectiebits zijn dus niet hetzelfde als een write zonder neveneffecten.

De stagingdefault `SOURCE_CHANNELS=1` is afzonderlijk van de live slotbank.
Reset en slot-clear zetten het ruwe slotwoord op `0`; dat woord selecteert in
deze kandidaat mono, maar activeert een inactief slot niet. De stagingwaarde
wordt pas bij een geslaagde PLAY in de stem opgenomen.

Deze bitindeling is **niet vastgesteld**. Zij verandert de huidige
PCM-adresberekening en BADP-layout voor kanaalwoorden buiten `1` en `2`.
Ook verandert zij bij generatorwoorden buiten `0` en `1` de huidige regel
dat niet-nulwaarden bronbinding overslaan, terwijl daarvoor geen golfvorm is
vastgelegd. Beoordeel bestaande cartridges en beide runtime-eigenaars voordat
een definitieve woordindeling wordt gekozen; Books I–III en de emulator blijven
tot dan ongewijzigd. Een andere expliciete woordindeling blijft mogelijk.

**Concreet ontwerpvoorstel, nog niet vastgesteld.**

- Zet de stagingreset voor `SOURCE_CHANNELS` op `1`; een programma kan nog
  steeds expliciet `2` schrijven. Leg ook het gedrag na een commando vast.
- Behoud `GAIN_Q12` als gezamenlijke sterkte en fade-regeling. Bewaar daarnaast
  twee onafhankelijke kanaalfactoren per stem, met voor beide een standaard van
  1, zodat bestaande gecentreerde weergave behouden blijft.
- Een mogelijke compacte representatie is één woord met twee signed 16-bit
  Q2.14-factoren; `40004000H` betekent links en rechts 1. Eerst wordt de
  kanaalfactor met de actuele mastergain gecombineerd met rekenkundige
  rechtsverschuiving; vervolgens wordt per kanaal het product opgeteld en na
  de som volgens de bestaande Q12-regel verschoven en begrensd. Deze
  voorstelling, afronding en de betekenis van alle bitpatronen moeten nog
  definitief worden gekozen. Een berekende kanaalgain heeft tot **34 signed
  bits** nodig; stilzwijgend terugknippen naar 32 bits is niet toegestaan.
- Deze kandidaat laat ook negatieve factoren en versterking boven 1 toe;
  die eigenschappen volgen niet vanzelf uit de keuze voor links/rechts-volume.
  Bij een stereobron beïnvloedt de linkerfactor het linkerkanaal en de
  rechterfactor het rechterkanaal; het voorstel mengt ze niet onderling.
- Behoud afzonderlijke linker-/rechterfilterhistorie. Een monobron leidt niet
  noodzakelijk tot gelijke samples na een eerdere live-bron- of filterwijziging.

De voorgestelde kanaalberekening is inmiddels als afzonderlijk fysiek
mengdatapad getest, inclusief een monobron die alleen links wordt weergegeven.
Dat bevestigt nog geen registerinterface, volledige fadeverwerking of
gerealiseerd silicium; de bestaande openbare regels blijven tot de gezamenlijke
wijziging van kracht.

**Concrete interfacekandidaat, nog niet vastgesteld.** De bestaande staging- en
geselecteerde registerblokken zijn vol. Een mogelijke uitbreiding voegt twee
woordregisters toe aan het einde van de huidige I/O-apertuur, zonder bestaande
APU-woorden te verplaatsen:

| Adres | Register | Toegang en functie |
|---|---|---|
| `08010440H` | `CHANNEL_LEVEL_LR` | Lezen/schrijven: niveaus voor het volgende vastgelegde commando |
| `08010444H` | `SLOT_CHANNEL_LEVEL_LR` | Lezen/schrijven: niveaus van de met staging `SLOT` gekozen stem |

Beide registers bevatten één volledig 32-bit woord. Bits 15:0 zijn het
linkerniveau en bits 31:16 het rechterniveau, elk een signed Q2.14-factor. Alle
bitpatronen hebben rechtstreeks hun signed betekenis: `40004000H` is links en
rechts unity, `00004000H` uitsluitend links unity en `40000000H` uitsluitend
rechts unity. `4000C000H` keert links de polariteit om en laat rechts op unity.
Er is geen saturatie of herinterpretatie bij het schrijven; negatieve factoren
keren de polariteit om en representabele factoren groter dan één versterken.

De stagingwaarde wordt `40004000H` bij reset en na iedere CMD-write die de
bestaande stagingdefaults herstelt, ook na een onbekend niet-nulcommando. CMD
`NONE` laat staging ongemoeid. Een geldig niet-nulcommando legt het nieuwe
stagingwoord tegelijk met de andere stagingwoorden vast. Alleen een geslaagde
PLAY installeert die vastgelegde niveaus in het geselecteerde slot; een mislukte
PLAY laat het oude slot onveranderd. STOP, PAUSE, RESUME en SET_SLOT_GAIN
gebruiken het vastgelegde niveauwoord niet. Ook `SOURCE_CHANNELS` krijgt als
stagingdefault `00000001H` bij reset en dezelfde stagingherstelmomenten.

Het gekozen-slotregister leest en schrijft de volledige niveaus van het slot
dat door de lage vier bits van het bestaande stagingregister `SLOT` wordt
gekozen. Een geselecteerde write verwerkt eerst de outputframes tot en met de
toegangscyclus, zoals de bestaande live-slotwrites; de nieuwe niveaus gelden
voor volgende frames. Een write in een inactief slot activeert het niet. De
write start geen nieuwe bronbinding en verandert cursor, lus, filterhistorie of
lopende fade niet. Reset en onmiddellijk STOP wissen de live slotbank, inclusief
dit woord, naar nul; stagingdefaults zijn daarvan gescheiden.

Voor iedere linker- en rechterfactor wordt de actuele signed `GAIN_Q12`, ook
tijdens een fade, ermee vermenigvuldigd en rekenkundig 14 bits naar rechts
verschoven. De resulterende signed gain heeft maximaal 34 bits; de bestaande
mengregel vermenigvuldigt hem met de gefilterde sample, telt alle bijdragen
per kanaal op, verschuift de som 12 bits rekenkundig en verzadigt alleen het
uiteindelijke 16-bit uitgangssample. Bij unity/unity is het resultaat identiek
aan de huidige mengregel, ook voor negatieve gain en tijdens een fade.

**Zichtbare compatibiliteitswijziging.** Deze adressen zijn nu geen registers:
ze bereiken onderliggend hoofd-RAM binnen de gereserveerde 256 KiB. De kandidaat
vergroot de gedecodeerde I/O-apertuur van `[08000000H, 08010440H)` tot
`[08000000H, 08010448H)`. Daardoor veranderen mapped CPU-/DMA-toegangen en de
regels voor transfers over de apertuurgrens; bijvoorbeeld wordt de tweede
woordtoegang van een F64 bij `0801043CH` voortaan het stagingregister in plaats
van RAM. GEO's ruwe RAM-toegang onder I/O blijft afzonderlijk en ongewijzigd.
De geheugenkaart, breedte-/uitlijnregels en fault-/volgordesemantiek moeten met
de twee nieuwe registers samen worden uitgewerkt. De keuze is niet vastgesteld;
een nieuw CMD binnen de bestaande apertuur zou in plaats daarvan het gedrag
van onbekende commando's veranderen en vereist een andere readbackoplossing.

**Alternatief binnen de bestaande apertuur.** De woorden `08000204H` en
`08000208H` liggen direct na het huidige APU-blok en buiten andere
apparaatregisters. De apertuurgrens zou daarmee ongewijzigd blijven. Het zijn
echter geen vrije adressen: Book I kent beide woorden behouden I/O-opslag toe,
met gedefinieerde lees-, schrijf- en resetwerking. Herbestemming zou het
aantal van die woorden van 16.385 naar 16.383 verlagen en die werking voor
beide adressen vervangen door APU-registergedrag. Ook aangrenzende F64- en
DMA-toegangen moeten met de nieuwe registerregels worden getoetst. GEO's
afzonderlijke toegang tot het onderliggende RAM blijft behouden. De decoder
en fysieke routering zouden moeten wijzigen, evenals beide runtimes en de
handleiding. Dit alternatief voorkomt de verschoven apertuurgrens, maar is
evenmin automatisch compatibel of vastgesteld; cartridges kunnen deze
behouden woorden gebruiken.

De mono-stagingdefault verandert programma's die `SOURCE_CHANNELS` niet
schrijven; bestaande expliciet geprogrammeerde mono-/stereobronnen behouden bij
unity/unity hun bestaande mix. De volledige 32-bit SOURCE_CHANNELS-woorden
anders dan één of twee worden niet stilzwijgend afgeknipt of heringevuld: hun
PCM- en BADP-betekenis en fouten zijn nog een expliciete open productkeuze.
De nieuwe savestate-representatie moet staging-, queued- en live-niveaus
volledig vastleggen, inclusief inactieve-slotreadback. Oude savestates hoeven
niet te worden gemigreerd; er wordt geen legacydecoder of runtimefallback
voorgeschreven.

**Implementatie-impact.** Werk de twee runtime-eigenaars, commando-opslag,
slotbanken, geselecteerde writes, fade, savestates, adresdecode, fysiek
rekendatapad en [Book I](book1/apu.md) gezamenlijk bij. Controleer oude
programma's, reset- en commandovolgorde, extremen en geheugenranden. De
resetwijziging kan met name programma's beïnvloeden die `SOURCE_CHANNELS` niet
schrijven en nu anders falen. Werk de betrokken cartridgeproducenten bij en
toets de nieuwe states op herstel en cross-runtime replay. De stereofunctie
wordt niet verwijderd.

## 5. APU: eventuele belasting- en timinggrenzen

**Supervisorhold en sampleteller: bestaande tegenstrijdigheid.** Book I
beschrijft bij supervisorservice stilstaande stemposities en toestaan van
voltooiing van een reeds aanvaarde sampletransfer. De APU-specificatie zegt
daarnaast dat SAMPLE_SEQUENCE eenmaal per 768 systeemcycli loopt. Zowel de
TypeScript- als de C++-eigenaar stopt echter tijdens supervisorhold de
voortgang vóór de tellerverhoging; bij loslaten blijft de eerder bewaarde
fractionele samplefase in gebruik. Dit verschil is nog niet opgelost. Een
fysieke DAC behoudt zijn seriële klok, maar de uitgangswaarde en eventuele
gewenste overgang tijdens hold zijn niet door deze vergelijking vastgesteld.
Kies en specificeer de teller- en uitvoerregels expliciet vóór implementatie;
er is hier geen specwijziging of stille vervangwaarde vastgesteld.

**Status: open; geen stemlimiet vastgesteld.** De zestien programmeerbare
slots zijn niet hetzelfde als een bewezen garantie dat iedere combinatie van
zestien bronnen, snelheden, filters, loops en uploads fysiek elke uitvoerperiode
haalt. Een mogelijke limiet op gelijktijdig spelende stemmen zou zichtbaar
moeten zijn, inclusief wat PLAY doet wanneer die limiet is bereikt; er mag
geen stille stemvervanging of verborgen vertraging worden ingevoerd.

Een stemlimiet alléén lost niet elk geval op. De huidige analyse bevat een
voorwaardelijk voorbeeld waarbij achterwaarts zoeken binnen een lang
mono-BADP-blok, zonder bewaarde decoderstatus of payloadprefix en met seriële
SRAM-lezingen, al voor één stem langer dan een uitvoerperiode vraagt. Een
andere cache-, voorbereidings- of parallelle architectuur kan anders uitkomen;
dit is geen bewijs dat één monostem onmogelijk is. Een cartridge kan bovendien
READY onbepaald uitstellen, zodat niet iedere externe bron een onvoorwaardelijke
tijdgarantie kan krijgen.

**Externe bronnen en uitvoergrens.** Het voorgestelde fysieke cartridgeprotocol
laat READY onbeperkt uitblijven; Book III legt hiervoor nog geen elektrische
maximumwachttijd vast. Stel twee kaarten leveren bij de eerstvolgende benodigde
sample verschillende waarden, maar beide maken die pas ná de uitvoergrens
beschikbaar. De APU heeft vóór die grens dezelfde informatie over beide kaarten
en kan dan niet voor beide de juiste verschillende sample uitvoeren. Extra
FIFO-capaciteit of minder stemmen neemt die informatiegrens niet weg. Dit is
geen bewijs dat lokale bronnen of normale cartridges onbruikbaar zijn.

Een historisch passende voorkeursrichting is lokaal samplegeheugen voor de
gegarandeerde playbackbasis, met behoud van directe ROM-bronnen als afzonderlijk
te kwalificeren mogelijkheid. Hun garantie vereist afspraken over tijdige
gegevens, arbitrage, voorbereiding en het zichtbare gedrag bij een gemiste
deadline. Een ruwe dubbelbuffer voor volgende blokken is een kandidaat, maar
mag niet vooruitlopen op een veranderlijke kaartmapping alsof de ROM-inhoud
altijd onveranderlijk is. Book III verbiedt ROM-writes, maar legt niet vast dat
iedere kaart haar ROM-mapping tijdens playback constant houdt. Geen van deze
aanvullende voorwaarden of een nieuwe PLAY-latentie is vastgesteld.

**Mono en stereo zijn niet alleen een kwestie van bronkanalen.** In één
gemeten klasse gebruiken acht stereoslots en zestien monoslots allebei zestien
bronkanalen, maar hun piek is respectievelijk 32 en 48 lokale woordlezingen.
Met een gekozen worstcase van 39 uploadwoorden zijn dat 575 en 687 van de
768 geheugenklokken, vóór een complete reken- en besturingsplanning. Extra
slotstatus, filters en loops tellen mee; een garantie van acht stereoslots
bewijst dus niet automatisch een garantie van zestien monoslots. Dit is een
werkbelasting voor het ontwerp, geen nieuwe stemlimiet.

**Kanaalveld en adresberekening: nog open.** Het bestaande kanaalveld is een
volledig 32-bit woord, terwijl de huidige fysieke BADP-decoder bij binding
slechts twee bits ontvangt. Een waarde zoals 5 kan daardoor als 1 binnenkomen.
De gedragstests voor gemengde PCM/BADP-stemmen dekken mono en stereo, niet de
overige representabele kanaalwoorden. Bovendien is de fysieke PCM-adresrekening
32-bit, terwijl de bestaande runtime-eigenaars bij grote metadata geen bewezen
gezamenlijke grens- en wikkelregel hebben. Stel eerst de bedoelde behandeling
vast en werk de complete eigenaars op elkaar af; er is hier geen clamp, nieuwe
waardegrens of stilzwijgende productspecificatie gekozen.

**Generatorwoord: nog open.** De bestaande handleiding laat ook andere
niet-nulwaarden dan `1` de bronbinding overslaan, maar kent daaraan geen
golfvorm toe. In beide huidige software-eigenaars selecteert alleen `1` de
blokgolf; andere niet-nulwaarden komen bij PCM-lezingen terecht terwijl geen
bronbytes zijn gebonden. Daarvoor is geen gemeenschappelijk fysiek resultaat
aangetoond. Definieer het gedrag van het volledige registerwoord en werk de
eigenaars daarop af, zonder stilzwijgende clamp, verborgen stilte of reeds
gekozen specificatiewijziging.

**Beperkte uitvoeringsvoorbeelden.** In een bestaande proef verwerken zes
actieve slots (elk mono en stereo voor PCM8, PCM16 en BADP) 48 frames op halve
bronsnelheid met korte lussen en vijf actieve filters. De onderzochte cursor-,
decoder- en mixerketen gebruikt maximaal 273 van 768 systeemklokken per getest
frame; het woordgeheugen is daarbij een testpartner met wachttijden, niet het
volledige SRAM-pad. Een tweede proef voert twee frames met twee PCM16-/BADP-
stemmen door het samplegeheugen, een SRAM-model en de I²S-uitgang, met een
sample-upload ertussen. De geteste mixen worden binnen hun seriële grenzen
geaccepteerd, met maximaal 139 klokken tot mixacceptatie; binding en
initialisatie zijn door de proef voorbereid. Dit zijn beperkte voorbeelden,
geen garantie voor een aantal stemmen, koude starts, alle lussen of langdurige
belasting. De grenzen en aannames blijven bepalend voor de interpretatie.

**Nog te bepalen:** het garantiedomein, bronopslag, toegestane belasting,
voorbereiding/PLAY-timing en het effect van loops, reverse, filters en uploads.
Geen specifieke limiet of latentie wordt nu opgelegd. Zie de
[APU-geheugenanalyse](book4/hardware.md#sec-physical-apu-memory-envelope).

**Cartridgeselectie bij directe ROM-weergave.** De passieve vierchipprint
verbindt U4 met de gedeelde SYS-bus en met U1 voor busaanvraag en -toekenning.
U1 beheert `SELECT`; er is geen afzonderlijke geselecteerde-socketlijn naar U4.
Book I vereist de selectie bij uitvoering van PLAY, niet bij het vullen van de
commandowachtrij, en opnieuw bij een live wijziging van de bronvelden. De
gecombineerde uitvoering die die selectie op U4 beschikbaar maakt, is nog niet
af. Een actieve stem en een reeds begonnen ROM-verzoek behouden hun eerder
gebonden socket wanneer software later `SELECT` wijzigt.

Een **uitvoeringsvoorstel** gebruikt de bestaande SYS-verbinding om U4 een
interne kopie van selectiebit 0 te geven. U1 en U4 ordenen iedere
`SELECT`-write met een voorbereiding en bevestigde overdracht: U4 houdt nieuwe
selectie-afhankelijke bindingsacties aan zolang een nieuwe selectie wordt
gesynchroniseerd; U1 maakt de nieuwe registerwaarde zichtbaar en U4 neemt
vervolgens de nieuwe kopie over voordat zulke acties verdergaan. Een actie die
vóór deze overdracht wordt toegelaten gebruikt de oude selectie; een actie die
erna wordt toegelaten gebruikt de nieuwe. Dat vereist een expliciete
commit-/bevestigingsafspraak tussen beide chips en een geselecteerde SYS-eigenaar,
niet alleen een gewone kopie die later toevallig aankomt. Het volledige
`SELECT`-woord blijft bij U1 behouden; de aparte U4-kopie is geen extra
publiek register.

Een wachtende PLAY blijft in de bestaande commandovolgorde; bij de werkelijke
uitvoering gebruikt hij de dan geldende kopie. Een live source-write wordt pas
geaccepteerd wanneer zijn selectie op dezelfde manier kan worden vastgelegd.
Reeds gebonden stemmen en aanvaarde ROM-verzoeken houden hun eerdere socket.
Een langdurig wachtende SYS- of cartridgeoverdracht kan een selectie-update
ophouden; het voorstel verzint geen timeout of teruggedraaide write. Na een
gemeenschappelijke reset beginnen beide selecties op socket 0; een afzonderlijke
reset of onderbreking van één chip vraagt nog een synchronisatieafspraak.

De exacte fysieke transportcodering, clocksynchronisatie, gelijktijdige
commitvolgorde en tijdgevolgen voor CPU-, DMA- en APU-verkeer zijn nog niet
uitgewerkt. Deze overdracht is dus een **voorgestelde integratie**, geen bewijs
dat de bestaande schakeling of RTL de regel al realiseert. Als de extra
wachttijd met de huidige publieke uitvoerings- of devicevolgorde botst, moet dat
apart worden vastgesteld; Books I–III en beide emulators blijven ongewijzigd.

**Broncontrole: voorstel voor eenvoudiger fysiek gedrag.** Book I vereist nu
dat de bron binnen de werkelijk geïnstalleerde bytes van het firmwarebeeld of
de gekozen cartridge-ROM valt; anders volgt `SOURCE_RANGE`. De huidige
emulator controleert dat tegen de lengte van zijn beeldbuffers. Een fysieke
ROM-bus kent de lengte van het oorspronkelijke bestand echter niet automatisch.
De kaartbus geeft die lengte niet door; uit nuldata is de lengte niet af te
leiden. Het is niet aangetoond dat deze regel historisch uit de emulator is
ontstaan, maar het huidige contract vereist wel extra, nog niet aanwezige
hardware om de bestandsgrootte te kennen.

Dit is iets anders dan een adresvenster of de vaste omvang van het eigen
samplegeheugen: die grenzen zijn eigenschappen van de console en kunnen wel
door zijn adresdecoder worden bepaald. `SOURCE_BYTES` is bovendien een door
software opgegeven bronlengte, geen door de cartridge gemelde capaciteit.
Ook een aanwezigheidsbit identificeert de ROM-capaciteit niet. Een afwezige
kaart en een aanwezige kaart met nulbytes zijn op basis van leesdata alleen
niet van elkaar te onderscheiden.

Een concreet **voorstel**, nog niet vastgesteld, is om bij de binding de
volgende adresvensters te gebruiken, niet de lengte van een ROM-bestand:

| Bron | Halfopen byteadresbereik |
|---|---|
| Systeem-ROM | `[00000000H, 01000000H)` |
| Geselecteerde cartridge-ROM | `[10000000H, 30000000H)` |
| Lokaal sample-RAM | `[40000000H, 40080000H)` |

`SOURCE_BYTES` blijft een door het programma opgegeven, niet-nul lengte: de
hele bron moet binnen één venster passen. De eindberekening mag niet op 32 bits
terugwikkelen; er is geen nieuwe uitlijningseis. Bij een ongeldige binding
blijft `SOURCE_RANGE` het bestaande foutpad gebruiken: een mislukte PLAY laat
de vorige stem intact, terwijl een mislukte live bronwijziging het geschreven
woord behoudt en de stem deactiveert. De generator blijft van samplebinding
vrijgesteld. De cartridgekeuze wordt bij binding vastgelegd en verandert niet
mee met een latere SELECT-write.

Een passende ROM-bron bindt onder dit voorstel ook als de kaart afwezig is of
de gevraagde locatie niet is bevolkt. Die locaties leveren de buswaarde uit
Books I en III: nul voor de oningevulde systeem-ROM of cartridge-ROM. Dat is
geen door de APU ingevoerde stilte: bij PCM8 decodeert byte `00H` bijvoorbeeld
als −32768. Andere ROM- en BADP-gegevens gaan ongewijzigd naar de decoder.
Een bron die de grens van zijn venster overschrijdt bindt niet, ook niet als
een ander venster daar begint. Dit verandert dus zichtbaar de huidige
`SOURCE_RANGE`-regel voor lege of kortere ROMs.

**Gevolg voor BADP.** Een lege socket levert onder dit voorstel wel nuldata,
maar daarmee is niet bewezen dat die bytes een afspeelbare BADP-bron vormen.
Een volledig nulblok heeft `BLOCK_FRAMES = 0` en `BLOCK_BYTES = 0`. Bij een
niet-lege bronframebeschrijving kunnen de huidige TypeScript- en C++-decoders
in hun zoeklus dan steeds hetzelfde blok blijven laden zonder voortgang. Dit
volgt uit broninspectie; er is geen hangtest uitgevoerd. Het huidige
bestandsgroottecontract kan een PLAY voor een lege socket eerder afwijzen, maar
een bindbaar nulgevuld gebied kan dit probleem eveneens bevatten. De ruimere
ROM-binding en het gedrag van zulke BADP-blokken moeten daarom samen worden
vastgesteld en in beide uitvoeringen overeenkomen. Er is hier geen stilzwijgende
blokklem, vervangende sample of nieuwe foutcode gekozen.

**Kandidaat: begrensde decoderstappen zonder nieuwe formaatfout.** De fysieke
BADP-engine verwerkt het zoeken als afzonderlijke geheugenverzoeken en
rekenstappen in plaats van een ononderbreekbare hostlus. Een blok draagt zijn
ruwe `BLOCK_FRAMES` en `BLOCK_BYTES`: een blok met beide woorden nul verplaatst
het zoekadres en het aantal gevonden frames niet. Voor een gevraagde frame die
nog niet is gevonden, vraagt de engine dan opnieuw hetzelfde blok op. Een stabiel
nulgevuld brongebied levert zo geen voltooid decoderresultaat op. De nulwaarden
worden niet als eindmarkering, geldige sample, fout of verzoek om een andere
bron behandeld. Een veranderlijke bron mag bij een volgende leesactie andere
bytes leveren; een eenmalig gelezen nulblok vastzetten en herhaalde buslezingen
weglaten zou dat gedrag veranderen.

De sequencer kan tussen deze stappen andere aanvragen toelaten; dat bewijst
niet dat bij een niet-afrondend verzoek nog complete uitvoerframes verschijnen
of dat een bepaalde voicebelasting wordt gegarandeerd. Een wachtende of trage
kaart heeft geen foutantwoord gegeven en krijgt geen verzonnen timeout. Een
werkelijk foutantwoord blijft afzonderlijk: daarvoor is hieronder
`SOURCE_ACCESS` als kandidaat beschreven. Voor een gewone niet-geluste bron
eindigt een stem uitsluitend volgens de bestaande cursor-/framegrens, niet
omdat het blok nul is; de engine schakelt een ingestelde lus ook niet uit.
Precies wanneer PLAY zichtbaar wordt, welk uitvoergedrag het product bij een
wachtende decoder moet bieden en hoe extreme lusposities worden behandeld, blijven product-
en schedulerkeuzes. De beschreven sequencer is geen aanspraak dat de huidige
emulator, RTL of publieke specificatie dit al uitvoert.

**Seriële uitvoer tijdens ontbrekende voortgang: fysieke kandidaat.** De
onderzochte uitvoer gebruikt een stereoregister dat alleen verandert wanneer
een volledig mixresultaat wordt geaccepteerd. De I²S-zender klokt op iedere
uitvoerrand de aanwezige registerwoorden in, onafhankelijk van de oorzaak van
het al dan niet ontbreken van een nieuw mixresultaat. Als het register bij
opvolgende randbemonsteringen ongewijzigd is, worden dezelfde linker- en
rechterwoorden opnieuw verzonden. Een mixresultaat dat precies op een
uitvoerrand wordt geaccepteerd, vervangt het register ná de waarde die de
zender op die rand inlaadt; die nieuwe woorden zijn pas beschikbaar voor een
latere uitvoerrand. Dit volgt uit de onderzochte register- en zendlogica, niet
uit een door de decoder toegevoegde stilte, timeout of foutcode.

Een niet-afrondende decoderzoekactie of een wachtende externe leesactie kan
zo de eerdere gemixte waarde hoorbaar laten aanhouden. Dat is een mogelijk
hoorbaar verschil met de huidige programmeerbeschrijving, niet een garantie
voor ongestoorde playback of een vastgestelde productregel. De afzonderlijke
sampleklok kan blijven lopen terwijl de berekening wacht; voortgang van
stemcursors, commando's, eindmeldingen en eventueel achterstallige frames is
daarmee niet vastgesteld. In de huidige woordroute bezet één onbeantwoord
extern verzoek ook de gedeelde playbackroute. Bovendien kan een eenmaal op SYS
toegelaten cartridgeverzoek de gedeelde bus vasthouden zolang READY uitblijft;
andere SYS-verzoeken kunnen dan niet onafhankelijk worden gegarandeerd. Het
huidige model telt uitstaande framegrenzen en heeft eindige momentopslag; een
onbegrensde wachtduur levert geen bewezen herstel of garantie op. De keuze van
productgedrag bij gemiste deadlines en de uiteindelijke stem- en
commandovolgorde blijft open. Er is geen timeout, frameverliesregel of nieuwe
registerinterface vastgesteld.

Book III beschrijft voor afwezige en onbevolkte cartridge-ROM-locaties nu een
nulwaarde; die regel moet fysiek worden gerealiseerd, niet simpelweg worden
angenomen.
De huidige fysieke ontwerpvoorstellen laten een lege socket door de
cartridgebrug met nul beantwoorden; de voorbeeldkaart geeft nul buiten haar
eigen ROM. De firmwareflash wordt bij programmering met nul gevuld en de
console geeft zelf nul terug voor het resterende firmwarevenster. Andere
kaarten moeten hun nulgedrag zelf waarmaken. Dit zijn ontwerp- en
modelresultaten, geen metingen aan gebouwde hardware.
Dit voorstel verandert het huidige `SOURCE_RANGE`-gedrag en kan verkeerd
geadresseerde samples als data laten horen in plaats van de PLAY te weigeren.
Deze concrete bindregels en hun compatibiliteitsgevolgen moeten nog worden
vastgesteld; ze wijzigen de huidige Books I–III en emulator niet. Ook bij dit
voorstel begrenst `SOURCE_BYTES` de latere decoderlezingen niet automatisch:
die volgen de volledige bron- en formaatwoorden. Wat een latere lezing buiten
het gekozen bronvenster doet, en hoe een daadwerkelijke busfout of wachttijd
doorwerkt naar de stem, blijft een afzonderlijke open productkeuze. Die
gevallen zijn niet stilzwijgend afgeknipt, omgeleid of als stilte vastgelegd.
De huidige emulator gebruikt rechtstreeks host-byteviews en moet bij een
eventuele wijziging dus eveneens de gekozen bussemantiek implementeren.
Er is geen metadata-EEPROM of cartridgecapaciteitsprotocol
gekozen. Zie [APU-bronbinding](book1/apu.md),
[cartridgeleesregels](book3/cartridge.md) en
[fysieke ROM-toegang](book4/hardware.md#physical-rom-read-profile).

**Mogelijke behandeling van een echte leesfout.** Een afzonderlijke kandidaat
laat `SOURCE_RANGE` uitsluitend de mislukte binding melden. Als een later
uitgevoerd bronverzoek daadwerkelijk een busfout terugkrijgt, stopt de APU
alleen de betrokken stem en bewaart zij de ruwe slotwoorden en eerder
uitgevoerde effecten. De foutieve respons wordt niet als sampledata gebruikt.
Een nieuwe APU-fout `SOURCE_ACCESS`, bijvoorbeeld code `00000103H`, meldt het
feitelijke foutadres via de bestaande first-faultregistratie. Een eerder niet
bevestigde APU-fout blijft dus staan. Deze bronfout levert geen `SLOT_ENDED`,
geen nieuwe APU-interrupt en geen CPU-busexceptie; andere stemmen blijven
afzonderlijk actief. Zodra de fout is verwerkt, draagt de gestopte stem niet
meer aan volgende uitvoerframes bij. Dat is een zichtbare foutafhandeling,
geen vervangende sample of terugdraaiing van eerder werk.

Dit is een **nieuw voorstel**, geen huidig Book I-contract. Het bepaalt niet
welke externe adressen een fout opleveren: de gekozen bus en de adresdecoder
moeten die respons leveren. Een kaart die READY nog niet geeft, heeft niet
automatisch een fout gemeld; zonder afzonderlijke timeoutregel kan die toestand
aanhouden. Ook de adreswikkeling, het gedrag buiten het oorspronkelijke
bronvenster en het frame dat op data wacht blijven afzonderlijke keuzes. Geen
van die gevallen krijgt hier stilzwijgend nuldata, een timeout of een clamp.

Als historische context leest [MAME's PlayStation-SPU](https://github.com/mamedev/mame/blob/master/src/devices/sound/spu.cpp)
uit eigen sample-RAM, dat afzonderlijk met DMA wordt gevuld. Dat model legt
geen foutregel voor een directe BMSX-cartridge-ROM-bron op. MAME's
[NES-cartridgemodel](https://github.com/mamedev/mame/blob/master/src/devices/bus/nes/nes_slot.cpp)
illustreert een andere buswaarde bij een afwezige kaart; voor BMSX blijft de
in Book III beschreven nulwaarde leidend zolang die regel niet wordt gewijzigd.

## 6. Cartridge-IRQ en DMA-verzoeklijnen

**Status: open keuze.** Book III legt een lokaal cartridgeverzoek en een
onafhankelijke centrale pending-bit vast; de centrale ACK kan worden gegeven
terwijl de kaartlijn nog actief is. Het huidige fysieke ontvangermodel mist
sommige snelle herhalingen. Een onderzochte gewone synchronizer herkent die
herhaling, maar kan korte pulsen missen. Digitale testpulsen en gekozen
klokfasen zijn geen gekwalificeerde pad- of pulstijden.

Mogelijke richtingen zijn: het bestaande flank/ACK-gedrag behouden met
onderbouwde fysieke actieve/inactieve tijden en grensgedrag, of een
niveaugestuurde interface met bijpassende software-afhandeling. De laatste zou
het zichtbare ACK-gedrag veranderen. Ook DREQ is een afzonderlijk
niveau-signaal en heeft eigen elektrische en timingvoorwaarden nodig. Er is
nog geen keuze, numerieke pulsduur of emulatorwijziging vastgesteld.
[Huidige kaartinterface](book4/hardware.md#cartridge-interrupt-and-request-inputs).

**Flankgestuurde kandidaat met fysieke ingangstijden.** Behoud het bestaande
onderscheid tussen de kaartlatch en de centrale pending-bit, inclusief het
wissen door centrale ACK terwijl de kaartlijn nog actief is. De ontvangende
ASIC synchroniseert de ingang en zet het centrale bit bij een waargenomen
actieve flank. Een mogelijke elektrische interface-eis is dat IRQ aan de
ontvangeringang zowel in de inactieve als in de actieve toestand minstens twee
ontvangerklokperioden geldig blijft. Bij een nominale 33,8688 MHz bedraagt dat
ongeveer 59,1 ns per toestand. Dit is een **ontwerpvoorstel**, geen huidige
cartridgespecificatie of reeds gekwalificeerde ASIC-grens. Een werkelijke eis
moet de ontvangerdrempels, toegestane flanken, kloktoleranties, setup/hold en
metastabiliteit van het gekozen ontwerp omvatten. Kortere pulsen zijn niet
gegarandeerd te worden gezien en meerdere gebeurtenissen kunnen samenvallen
in de ene pending-bit. Ook de vertraging tussen de fysieke flank en centrale
FLAGS, de ACK-race en de banktoewijzing bij contextwissel moeten expliciet
worden gekozen; een centrale ACK tijdens een nog onderweg zijnde flank kan tot
andere zichtbare volgorde leiden dan een onmiddellijk softwaremodel.

Een digitale proef met de centrale IRQ-bank zag beide socketflanken bij 32
invoerfasen elk, met twee volledige klokperioden hoog en laag, en toonde dat
centrale ACK een vastgehouden actieve lijn kan wissen. Een afzonderlijke proef
met de echte referentiekaart en cartridgebus doorliep 72 transacties met deze
ontvanger; de gemeten 767,676 ns tussen de twee geteste mailboxveranderingen
is geen ondergrens voor andere kaarten of toegangspatronen. De proeven bewijzen
geen analoge timing of verwerking van gebeurtenissen tijdens iedere mogelijke
ACK- of contextwissel. Dit alternatief beperkt de fysieke ingangstiming maar
wijzigt de kern van het bestaande ACK-contract niet. Ter vergelijking schrijft
[AMD AXI INTC PG099](https://docs.amd.com/api/khub/documents/ESm7csywkGnmDhvqT3ZVDw/content)
voor asynchrone flankbronnen twee inactieve en twee actieve ontvangerklokken
voor; dat is een onafhankelijk ontwerpvoorbeeld, geen BMSX-kwalificatie.

**Niveaugestuurde kandidaat.** Laat een kaart haar IRQ-lijn actief houden tot
de kaart zelf is bevestigd. Synchroniseer dat niveau naar CORE en laat een
actief gesynchroniseerd niveau de centrale socketbit zetten of gezet houden;
MASK bepaalt alleen de aflevering. Een mogelijke synchrone regel per socket is
`pending_next = (pending AND NOT central_ack) OR active_level`, waarbij zetten
voorrang heeft op gelijktijdig wissen. Na lokale ACK moet de deassertie ook
de synchronizer hebben bereikt voordat een centrale ACK het bit blijvend kan
wissen. Software behandelt het lokale verzoek, bevestigt het lokaal en
bevestigt vervolgens centraal; als de centrale vlag weer actief is, controleert
de handler opnieuw. Een nieuw, afzonderlijk door de kaart vastgehouden verzoek
dat na lokale bevestiging ontstaat, kan zo opnieuw als niveau of centrale
pending zichtbaar worden, mits het de synchronizer bereikt voordat het wordt
bevestigd. Het bit telt geen afzonderlijke gebeurtenissen; samenvallende
lokale trigger en ACK vereisen ook een expliciete kaartregel.

De kandidaat bewaakt beide socketlijnen onafhankelijk van de gewone
cartridgeselectie. Die selectie bepaalt wel welke kaart de software aanspreekt
voor een lokale mailboxbevestiging. Voor één socket geeft de voorgestelde
centrale regel de volgende volgorde; de kolom *niveau* is het al
gesynchroniseerde niveau, niet noodzakelijk de ogenblikkelijke kaartpin:

| Stap | Niveau | Centrale pending na de stap |
|---|---:|---:|
| Verzoek bereikt de ontvanger | Actief | 1 |
| Centrale ACK terwijl het niveau actief is | Actief | 1 |
| Lokale ACK, vóórdat de vrijgave de ontvanger bereikt | Actief | 1 |
| Vrijgave bereikt de ontvanger | Inactief | 1 |
| Centrale ACK na de ontvangen vrijgave | Inactief | 0 |

Dit voorbeeld telt geen gebeurtenissen en veronderstelt geen tweede verzoek.
Het onderscheid tussen kaart- en controllerreset blijft belangrijk: een
cartridgecontroller-reset wist het lokale kaartverzoek maar bevestigt de
centrale pending-bit niet. Een mogelijke centrale-resetregel wist de IRQ-bank
en zijn MASK; als een kaartniveau na reset nog actief is en de ontvanger
bereikt, zet het de pending-bit opnieuw. De aanvankelijke MASK van nul
verhindert dan aflevering totdat software die bron inschakelt.

Een mogelijke supervisorregel behoudt de gebruikers-FLAGS en MASK, begint de
supervisorbank leeg en laat een aanhoudend kaartniveau de actieve
supervisorbank zetten. Bij terugkeer worden de gebruikerswoorden hersteld
zonder oude supervisorflags te mengen. Een al bewaarde gebruikersvlag kan
daardoor na lokale afhandeling in de supervisor opnieuw aandacht vragen; dat
is geen tweede getelde gebeurtenis. De toewijzing van een gebeurtenis precies
tijdens contextwisseling en de prioriteit van gelijktijdige lokale trigger en
ACK blijven nog te kiezen. DREQ blijft een onafhankelijke niveaulijn.

Dit is een **voorstel tot contractwijziging**: anders dan in Book III kan een
centrale ACK de socketbit niet blijvend wissen terwijl het gesynchroniseerde
kaartniveau actief is. De reset- en supervisorregels hierboven zijn mogelijke
keuzes, geen al vastgestelde wijzigingen. Een kaart mag de lijn niet
kort pulsen en verwachten dat een synchroon systeem de puls altijd ziet; de
bron moet zijn verzoek vasthouden tot lokale bevestiging. Exacte padniveaus,
inputtiming, metastabiliteit en resetvrijgave blijven te kwalificeren.

Een gerichte RTL-proef koppelt deze niveaukandidaat aan de bestaande centrale
IRQ-bank. Met een door de proef vastgehouden ingang blijft de vlag gezet bij
centrale ACK; na loslaten en synchronisatie kan centrale ACK haar wissen. De
proef toont ook dat een korte puls tussen twee bemonsteringen verloren kan
gaan. Bij een niveau dat tijdens supervisorintrede actief blijft, krijgt de
supervisorbank eveneens een pending-bit terwijl de eerdere gebruikersvlag
bewaard blijft. Dat laatste is een concrete consequentie van de huidige
banktoewijzing, geen reeds goedgekeurde productregel. De kaart zelf is in deze
proef niet aangesloten en de test levert geen elektrische timinggarantie.

Een tweede proef sluit dezelfde niveauontvanger wél aan op de referentiekaart,
de cartridgebus en de centrale IRQ-bank. Daarin blijft de centrale vlag gezet
zolang het echte kaartverzoek actief is; lokale kaart-ACK gevolgd door centrale
ACK wist de vlag en een volgend kaartverzoek wordt opnieuw ontvangen. Ook de
bestaande flankvariant blijft in zijn eigen proef werken. Dit ondersteunt de
niveauvariant als praktische voorkeursrichting, maar kiest haar nog niet als
productspecificatie en bewijst geen timing voor willekeurige cartridges.

Als historisch vergelijking laat [MAME's SNES-model](https://github.com/mamedev/mame/blob/master/src/mame/nintendo/snes.cpp)
het cartridgeniveau met andere IRQ-bronnen naar de processor samenvoegen;
[MAME's PlayStation-IRQ-controller](https://github.com/mamedev/mame/blob/master/src/devices/cpu/psx/irq.cpp)
heeft daarnaast een centraal pending-/maskermodel. Die voorbeelden maken een
niveauvaste kaartlijn en centrale toestand plausibel, maar schrijven BMSX's
ACK-regel niet voor en bewijzen geen elektrische pulstijden. Met name leidt
MAME's PS1-pendingmodel niet op zichzelf af dat een actief niveau na centrale
ACK opnieuw wordt gezet; de voorgestelde BMSX-regel is een eigen keuze.

## 7. Pointer bij een leeg beeld

**Status: verduidelijking onderzoeken.** Book I beschrijft standaard
pointercoördinaten binnen de beeldextent, maar specificeert niet uitdrukkelijk
een extent van nul. De [fysieke pointerformule](book4/pads.md#display-context-and-standard-pointer-mapping)
levert bij extent nul het woord `FFFF0000H` (−1 pixel). Toets die uitbreiding
tegen de bedoelde software- en accessoirecontracten voordat zij als publieke
regel wordt vastgelegd. Er is geen besluit om nul automatisch te vervangen door
een positieve extent of de vorige positie vast te houden.

## 8. Pad- en accessoireprotocol

**Status: fysieke interface voorgesteld; openbaar contract nog te toetsen.**
Het [BMSX-PAD-voorstel](book4/pads.md) beschrijft vier parallelle seriële
aansluitingen, frames van 64 bytes per richting met CRC en een nominale
bitsnelheid van 250 kbit/s. Het legt ook vast hoe een pointer uit de
ontvangen gegevens wordt gekozen en hoe de laatst geldig ontvangen gegevens
behouden blijven na een mislukte uitwisseling. Deze fysieke aansluiting is
nog niet zonder meer een vastgesteld openbaar accessoirecontract.

De vier fysieke aansluitingen leveren vier onafhankelijke accessoirelinks.
Bij vier losse pads is er daarom geen vrije poort voor een losse pointer. Het
[pad-en-pointeradaptervoorstel](book4/pads.md#sec-physical-pad-link) zou beide
apparaten via één link combineren, zonder de logische inputrecords te wijzigen.
De functionele opzet geeft padverzoeken rechtstreeks door en verzamelt de
pointergegevens afzonderlijk. De schakeling, belasting en leveringsgrenzen zijn
nog niet uitgewerkt of gekwalificeerd.
Of deze voorziening bij de console wordt geleverd is geen vastgestelde productregel.

**Functionele richting voor de fantasyconsole.** Behoud het bestaande logische
INPUT-contract: de geaccepteerde APPLY-write geeft direct een verzoek door met
de op dat moment gekozen poort, intensiteit en duur. Een verzoek met nul
intensiteit of nul duur vraagt onmiddellijk om stoppen. OUTPUT_CTRL leest na
de write nul en is geen voltooiingssignaal; er is geen publieke busy- of
voltooiingsstatus. INPUT RESET verstuurt niet zelf een stopverzoek.

Dit beschrijft het aanbieden van het verzoek, niet dat een fysieke motor zonder
voortplantingsvertraging reageert. De seriële frameoverdracht blijft een
uitvoeringsvoorstel. Voor echte hardware moeten de tijd tussen de write en
frameacceptatie, eventuele wachttijd van de write en het gedrag bij gebrekkige
overdracht nog met het logische contract worden verenigd. Er wordt hier geen
nieuwe maximale vertraging of fysieke ontvangstgarantie aangenomen.

**Nog uit te werken.** Toets pinnen, elektrische en timinggrenzen, protocol,
pointerselectie en ouderdom van input aan het [inputcontract](book1/input.md)
en leg vast wat een accessoireontwikkelaar mag verwachten. Een APPLY wordt in
het fysieke voorstel op een framegrens meegenomen en bereikt het accessoire
na overdracht van het frame. Book I beschrijft dispatch bij de APPLY-write en
een onmiddellijk stopverzoek. Werk uit hoe die beschrijvingen zich tot elkaar
verhouden en welke vertraging zichtbaar en aanvaardbaar is; wijzig het
contract niet stilzwijgend.

**Volgorde van VBlank en INPUT.** Book I vereist eerst de displaylatch, dan
de gewapende inputpublicatie en daarna de centrale VBlank-IRQ. De huidige
constructie verdeelt de GFX-gebeurtenis rechtstreeks naar twee onafhankelijke
ontvangers voor INPUT en CORE. Dat toont de vereiste volgorde niet aan; de
bestaande afzonderlijke pintests bewijzen geen volledige keten. Ook kan een
ARM- of RESET-write tussen de oorspronkelijke gebeurtenis en ontvangst bij INPUT
vallen. Een voorstel ordent de gebeurtenis en die writes bij één logische
eigenaar en geeft de IRQ pas vrij na de bijbehorende verwerking. Een enkele
terugmelding na INPUT is op zichzelf niet voldoende om ook de writevolgorde te
bewijzen. Bepaal nog hoe de live input op het juiste moment wordt vastgelegd,
hoe gebeurtenisoverdracht en reset samenwerken en welke fysieke verbindingen
daarvoor nodig zijn. Het oorspronkelijke schema behoudt de huidige aansluitingen;
een afzonderlijke kandidaat verplaatst de INPUT-pinnen, maar implementeert de
nieuwe interne logica nog niet. Meerdere VBlank-entries tussen waarnemingen
passen niet vanzelf in één toggle. De huidige TypeScript- en C++-eigenaars
tellen meerdere overschreden grenzen, maar geven per service-aanroep één
VBlank-begin door. De blootgestelde fysieke voortelling mag dus niet zonder
nadere contracttoets automatisch als evenveel afzonderlijke INPUT-captures
worden behandeld. Een oude VBlank kan ook samenvallen met een PCRTC-reset;
de volgorde tussen die gebeurtenis, resetdisplay, INPUT en IRQ is nog niet
vastgesteld. De bestaande vectors voor deze hardwaregrens roepen de beamservice
expliciet vóór en na iedere timingwrite aan. Ze tonen daarmee niet automatisch
de volgorde tijdens de echte atomaire CPU-instructie: de runtime kan een oude
deadline pas na de instructie bedienen, terwijl de write de beam al heeft
herstart en opnieuw ingepland. Een gerichte Runtime/MMIO-proef met handmatig
op de deadline geplaatste scheduler bevestigt dat dit verschil waarneembaar
kan zijn: service vóór een timingwrite gaf INPUT_STATUS=1 en IRQ_FLAGS=4;
dezelfde write vóór service gaf beide nul. Een afzonderlijke gerichte proef met
een echte BLua-CPU-store bevestigt dat dit verschil in de TypeScript-runtime
bereikbaar is: een twee-cycli-store die de deadline overschrijdt liet INPUT en
IRQ op nul; dezelfde store na service behield de eerder gepubliceerde waarden.
De gastcode wapende INPUT en schreef zelf het timingregister; de tussentijdse
inactieve periode werd door de test vooruitgezet. Dit karakteriseert het
huidige gedrag, niet de gewenste productregel. De overeenkomstige C++-eigenaars
zijn op bronvolgorde onderzocht, niet in deze proef uitgevoerd. Er is geen
nieuwe snelheidslimiet of verliesregel gekozen.

**Concrete vier-chipkandidaat.** Plaats de INPUT-registerbank en de
toetsenbord- en padbesturing in U2, bij de PCRTC-gebeurteniseigenaar. U7
houdt de firmware-ROM-interface. U2 kan dan VBlank, INPUT ARM/RESET en de
snapshot in één systeemklokdomein ordenen voordat de gebeurtenis naar de
centrale IRQ gaat. Dit verandert op zichzelf geen externe connectoren of
INPUT-adressen. In de oorspronkelijke netlijst heeft U2 19 niet-aangesloten
reservepinnen; de te verplaatsen interface gebruikt 18 signalen. De INPUT- en
passieve kandidaten wijzen die signalen toe en laten U2.174 als reserve. De verdeling
is een architectuurkandidaat. Een afzonderlijk schema en ongerouteerde print
leggen de voorgestelde pinaansluitingen vast; ze bewijzen de interne logica,
elektrische werking of fysieke timing nog niet.
De voorkeursrichting voor die overdracht is een synchrone set op de bestaande
U2–CORE-verbinding. Die gebruikt de gemeenschappelijke systeemreferentie,
maar vereist bewezen pin- en kloktiming; de huidige toggle-ontvanger blijft
vooralsnog ongewijzigd. Bijzonder snelle gebeurtenissen, gelijktijdige ACK en
reset moeten nog worden verenigd met het publieke contract.
Het voorkeursontwerp behoudt één eigenaar per functie: U2 bevat PCRTC, de
ontvangers en INPUT-snapshot; U1 bevat de centrale interruptvlaggen en SYSTEM;
U7 bedient de firmware-ROM. De supervisorroute blijft afzonderlijk van de
VBlank-IRQ. U2 ordent displaylatch, eventueel gewapende snapshot en daarna
IRQ-aanvraag, ook wanneer geen snapshot is gewapend. De gecombineerde RTL en
de precieze behandeling van gelijktijdige writes/reset blijven open; de
bedoelde systeemvolgorde is geen uitspraak over een nog niet bewezen pin- of
klokrandtiming. U2 moet GPU, PCRTC en INPUT als afzonderlijk geselecteerde
eindpunten op dezelfde SYS-pinnen verbinden; het GPU-buseindpunt en de
volledige geordende VBlank-naar-IRQ-keten ontbreken nog in het hardwaremodel.
Het GPU-eindpunt moet het bestaande onderscheid tussen GP0 en GP1, CPU- en
DMA-ingress, het DMA-blokeindstrobe en de GPUREAD-eigenaar behouden. Acceptatie
van een woord is niet gelijk aan voltooide tekening of readback. Dit is de
bestaande functionele grens, geen nieuwe publieke timing of bandbreedtegarantie;
de [GFX-bustoegang](book4/hardware.md#sec-physical-gfx-gpu-system-access)
beschrijft de voorgestelde fysieke organisatie.
Zie [de integratiekandidaat](book4/hardware.md#sec-gfx-input-integration-candidate).

Een [concrete kandidaat voor de U2-pintoewijzing](book4/hardware.md#sec-gfx-input-integration-candidate)
combineert de verplaatste INPUT-signalen met de snapshotselectie. Deze
aansluitingen staan in de afzonderlijke INPUT-en-geheugenkandidaat, niet in
het oorspronkelijke schema. Fysieke fanout is niet aangetoond; externe
connectoren behouden hun bestaande pinout.

**Monitorbediening zonder extra consoleknop.** De huidige fysieke constructie
heeft wel een afzonderlijke supervisoringang en een intern testpunt, maar geen
normale gebruikersbediening voor die ingang. Book I laat INPUT het logische
supervisorverzoek onafhankelijk van ARM bij VBlank bemonsteren; Home en
Touchpad zijn gewone gamepadbits en worden nu niet automatisch omgezet in
zo'n verzoek. Een voorstel is om een accessoire zelf een afzonderlijk
verzoekniveau te laten aangeven, bijvoorbeeld bij een door het accessoire
gekozen toetsencombinatie. Dat vereist geen extra MONITOR-knop op de console.

Ook zonder aangesloten pad biedt het losse toetsenbord een bedieningsroute
in het referentieontwerp. De gekozen combinatie is `Ctrl+Alt+F12`: houd op
hetzelfde toetsenbord een van beide Ctrl-toetsen, een van beide Alt-toetsen en
F12 tegelijk ingedrukt. De INPUT-logica leidt een afzonderlijk verzoekniveau af uit
de live toetsenbordtoestand, niet uit een door ARM gemaakte snapshot. De
toetsen blijven als gewone toetsen zichtbaar voor het programma; een spel kan
die combinatie dus ook zelf verwerken. De oorspronkelijke toetsenbordindeling
bevat deze toetsen en de voorgestelde Set-2-decoder herkent hun codes.

De voorgestelde toetsenbordmatrix en firmware moeten deze specifieke
combinatie gelijktijdig kunnen herkennen. Dat is nog niet aangetoond en vereist
geen algemene garantie op volledige rollover. Ook de functietoets Fn uit de
oude tekening is voor deze kandidaat niet nodig. De INPUT-RTL combineert de
live toetsen met de aparte supervisoringang; een gerichte proef via de U7-pinnen
bevestigt dit pad voor beide zijden van de modificatietoetsen. De gecombineerde
U2-INPUT/GFX-integratie, aansluiting op SYSTEM en de gelijktijdige toetsmelding
van een werkelijk toetsenbord zijn daarmee nog niet aangetoond.

De onderzochte PS/2-ontvanger accepteert scan-code set 2 zonder zelf
toetsenbordcommando's te sturen. In de oudere U7-proef wist fysieke reset ook
de vastgehouden toetsstatus, terwijl een aangesloten toetsenbord mogelijk geen
nieuwe make-code stuurt voor een toets die ingedrukt blijft. Een mogelijke
U2-uitvoering houdt de verworven toetsstatus tijdens een systeemreset vast,
terwijl de softwarezichtbare snapshot wel wordt gereset. Koude start,
toetsenbordverlies en gedeeltelijk ontvangen frames moeten daarbij afzonderlijk
worden uitgewerkt. Dit is geen vastgesteld resetcontract en de U2-uitvoering
is nog niet geïmplementeerd.

![Voorgestelde toetsenbord- en padbronnen naast de bestaande supervisorroute.](book4/figures/supervisor-sources-proposal.svg)

Een mogelijke protocoluitbreiding gebruikt bit 0 van reply-byte 60, dat in het
huidige 64-byte versie-1-antwoord gereserveerd en nul is. Een volledige,
geldige reply werkt het vastgehouden verzoekniveau van die poort bij; een
ongeldige of onvolledige reply laat het vorige niveau behouden, net als de
overige vastgehouden invoergegevens. De INPUT-controller combineert de vier
verzoekniveaus met de toetsenbordkandidaat en de afzonderlijke externe
supervisorbron en biedt het resultaat aan de bestaande VBlank-randdetectie aan.
Dat is U2 in de vierchipkandidaat en U7 in de oorspronkelijke indeling. De aanvraag is
onafhankelijk van ARM; de gewone
gamepadbits blijven beschikbaar voor het spel. Een overgang naar actief kan
zowel monitorintrede als een later vertrek aanvragen volgens de bestaande
SYSTEM-toestand. Zolang een bron actief blijft, ontstaat niet steeds een nieuwe
opgaande flank. Voor herbewapening moet het gecombineerde niveau inactief
zijn **op een bemonsterde VBlank**; een korte vrijgave en hernieuwde aanvraag
tussen twee VBlanks levert geen nieuwe waargenomen flank. Een korte aanvraag
die niet op een VBlank wordt waargenomen, heeft geen gegarandeerd effect.
Reset van de gedeelde INPUT-registers wist niet vanzelf de afzonderlijke laatst
geldige accessoirereply. Een actief verzoek kan daarom na loskoppelen actief
blijven zolang geen geldig antwoord de bit wist; cold reset wist de held bank.

Dit is een **protocol- en INPUT-ontwerpvoorstel**, niet de bestaande versie-1-
implementatie. Een oudere, volgens de huidige vorm nul invullende accessoire
geeft geen verzoek; bestaande apparaten die het gereserveerde bit toch zetten
kunnen ander gedrag krijgen. De bediening op de accessoire, fout- en
loskoppelgedrag en de overgang tussen oude en nieuwe implementaties moeten nog
worden vastgesteld. De huidige Books I–III en emulator worden hiermee niet
stilzwijgend gewijzigd.

## 9. Fysieke cartridge-interface

**Status: aanvulling op het publieke contract voorgesteld.** Book III
beschrijft de logische cartridgevensters en toegang, maar niet deze volledige
fysieke aansluiting. Het [constructievoorstel](book4/connectors.md#sec-physical-cartridges)
gebruikt 62 contacten, 3,3 V-signalen, een gemultiplexte adres-/databus,
afzonderlijke READY-signalen en mechanische sleuteling. Dit is niet hetzelfde
als een reeds vastgestelde openbare cartridgepinout.

**Nog uit te werken.** Leg contacttoewijzing, mechanische passing, toegestane
spanningen en stromen, READY- en bustiming en de voorwaarden voor plaatsen en
verwijderen vast en kwalificeer ze. Toets ook de consequenties van wachttijd
en IRQ uit de andere onderdelen van dit document. De aangepaste EDAC-boring
is op zichzelf een constructieaanpassing, geen softwarecontractwijziging.

## 10. Open constructie- en kwalificatiepunten

Deze punten kunnen later tot een productspecificatie leiden, maar zijn nu
**geen vastgestelde specificatieverlaging**:

- **Voeding en accessoires:** beide cartridgevoedingen en de pad- en
  keyboardvoedingen delen momenteel de hoofdrails. Afzonderlijke beveiliging
  is een kandidaat; de toegestane takstromen, opstartgedrag en bescherming
  tegen terugvoeding zijn nog niet gekozen of gekwalificeerd.
- **Passieve koeling:** geen ventilator. Werkelijke component- en
  aanraakgrenzen zijn leidend; 50 °C interne lucht is geen zelfstandige
  productspecificatie. Naast het eerder getekende vinnenprofiel is een lagere
  passieve spreidplaat als alternatief uitgewerkt; geen van beide vormen is
  als minimaal noodzakelijk aangetoond. Vermogen en temperaturen moeten nog
  fysiek worden gekwalificeerd.
- **Connectoren en assemblage:** de goedgekeurde EDAC-contactboringen zijn een
  constructieaanpassing met behoud van contactcentra en pinout. SCART-levering,
  connectorpassing, kabelmontage en het opgebouwde analoge pad blijven te
  verifiëren.
- **Diagnostische uitvoer:** de interne lijnbuffer heeft een byte-interface;
  de fysieke uitvoerroute en geheugenmacro zijn nog niet gekozen.

**Voorkeursrichting bij een externe voedingsfout.** Een ontwerpvariant kan
cartridge-, pad- en keyboardvoedingen van stroombegrenzing en foutdetectie
voorzien. Wanneer zo'n detector een fout meldt, houdt een afzonderlijke
beveiligingsvergrendeling de console in reset en schakelt zij beide hoofdrails
uit. De vergrendeling blijft actief zolang de besturingsvoeding aanwezig is;
zij is geen softwarestatus of nieuwe interrupt. Het systeem blijft dus niet
met één uitgeschakelde cartridgevoeding verder werken en doet geen beroep op
selectieve isolatie van de gedeelde cartridgebus. Dit is een voorstel voor een
nieuw voedingsontwerp, **niet** de werking van de huidige print.

Voor herstel schakelt de gebruiker POWER uit, koppelt de externe voeding los
en verhelpt de oorzaak. Daarna kan de voeding opnieuw worden aangesloten en
POWER worden ingeschakeld; de bestaande resetbewaking houdt de processor vast
terwijl de hoofdrails opkomen. Bij een blijvende fout moet de nieuwe beveiliging
opnieuw uitschakelen, zonder zelfstandig voortdurend te herstarten. De
beveiligingsvergrendeling is afhankelijk van de besturingsvoeding: een fout
in de bestaande ingangsschakelaar kan ook die voeding uitschakelen. De
initialisatie bij terugkeer van die voeding en de precieze herbewapening zijn
nog te ontwerpen; een spanningsloze latch mag niet als blijvend geheugen
worden verondersteld.

Dit groepsgedrag bewijst op zichzelf geen veilige uitschakeling. Een
stroombegrenzende schakelaar kan de spanning al verlagen voordat zijn
vertraagde foutmelding verschijnt; ook bij het wegvallen en terugkomen van
voedingen kunnen gedeelde signaal- en pull-uppaden terugvoeden. De concrete
schakeling moet daarom het gedrag van reset, drivers, beide voedingsrails en
signaalpinnen tijdens die overgangen aantoonbaar beheersen. De bestaande
[onderzoekskandidaat voor takbeveiliging](#sec-proposal-branch-protection)
noemt een mogelijke component en zijn beperkingen. Takstromen,
inschakelgedrag, foutdrempels en adaptercapaciteit zijn nog niet gekozen;
deze richting legt geen grenswaarde, beschikbaar hardwaregedrag of wijziging
van Books I–III of de emulator vast.

**Metalen dek en systeemmassa.** Het aluminium dek draagt de print en het
passieve koelprofiel. De hoofdprint wordt op G10-afstandhouders gemonteerd;
de bijbehorende bevestigingsgaten zijn niet-gemetalliseerd. In de bestaande
schema's is geen expliciete aansluiting van het dek op `GND` aangewezen. Dit
bewijst niet dat het gemonteerde metaal overal elektrisch geïsoleerd is:
bevestigingsmiddelen, connectorbehuizingen en het cartridgeframe kunnen
onbedoeld contact maken.

Een constructievoorstel is een afzonderlijke, herkenbare verbinding van het
dek met systeemmassa, nabij de voedingsretour en achteraansluitingen. Bepaal
daarbij ook het contact met connectorbehuizingen en frame, zodat werkstromen
niet op toevallige metaalcontacten worden gebaseerd. De verbinding is een
signaal-/chassisreferentie, **geen veiligheidsaarde**: de gespecificeerde externe
9 V-adapter is geïsoleerd en levert geen aardleiding aan de console. Waar nodig
kan later binnenafscherming worden onderzocht zonder extra buitenroosters of
een ventilator voor te schrijven. Noch een grondverbinding, noch de bestaande
plaat bewijst EMC-prestaties; de aansluiting en mogelijke gevolgen voor
storingen, aanraking en foutgedrag zijn nog niet uitgewerkt of in het schema
opgenomen.

**Diagnostiek via de interne serviceaansluiting.** De voorgestelde route
gebruikt de bestaande scanverbinding op J302, zonder een extra buitenpoort.
In CORE geeft de SYSTEM-uitvoereigenaar alleen volledig gepubliceerde UTF-8-
bytes door aan een private scanoperatie. De serviceapparatuur leest eerst een
beschikbare byte en bevestigt die vervolgens; pas de door CORE ontvangen
bevestiging neemt de byte uit de gedeelde 8192-bytebuffer. Een gedeeltelijke
regel is niet zichtbaar. Als er geen instrument leest, blijven gepubliceerde
bytes in de buffer en gelden de bestaande overflowregels. `PRINT_CHAR` en
`PRINT_FLUSH` blijven de bestaande registers; er wordt geen nieuwe
softwarezichtbare status of verplicht aangesloten instrument ingevoerd.

Deze route is een fysieke uitvoeringskandidaat, niet een gerealiseerde
verbinding. De scanlogica moet de onafhankelijke scan- en systeemklokken en
bevestigingen ordelijk verbinden; een scanreset mag de SYSTEM-buffer niet
wissen. Een console-reset wist die buffer volgens Book I. Een onderbreking
rond een verzonden bevestiging laat voor de externe ontvanger zonder verdere
afspraken onduidelijk of de byte al is verbruikt. De scaninstructie, reset- en
herstartvolgorde, geheugenmacro en de integratie met de bestaande byte-interface
moeten nog worden uitgewerkt. Zie [diagnostic line storage](book4/hardware.md#diagnostic-line-storage).

Het ontwerp heeft nog geen volledig aangesloten en gekwalificeerde ASICs,
geen gefabriceerde en doorgemeten console en de print is niet volledig gerouteerd.
Een gerichte RTL- of rekentoets is geen vervanging voor die kwalificatie.

## 11. CPU: werkelijke uitvoering en systeemklok {#sec-proposal-cpu-execution}

**Status: nominaal werkklassenmodel als proef gekozen; de fysieke CPU blijft
ongekwalificeerd.** De eerste proef houdt één vaste instructietabel aan, met
expliciete toeslagen voor waardeplaatsing, opslaginitialisatie, groei, tekst en
getelde woordtransfers. Zij voegt geen cache-, bus- of geheugenmisserstatemachine
toe. Dit is een beredeneerde schatting van relatieve werkklassen, niet een
claim dat iedere instructie op nog niet gekozen silicium precies zo lang duurt.
De keuze mag worden beproefd zonder eerst een volledige CPU of sluitende
cacheorganisatie te bouwen. Hostmetingen beoordelen de uitvoerbaarheid en het
spelgedrag; zij bepalen niet hoeveel cycles een operatie kost.

| Werkklasse | Nominale basisprijs, inclusief één cycle instructieaanvoer | Motivering van de proefkeuze |
|---|---:|---|
| Eenvoudige register-, optel-, aftrek- en vermenigvuldigoperaties | 2 | Korte, gespecialiseerde datapaden blijven goedkoop. |
| Namespace en upvalue lezen / schrijven | 3 / 4 | Indirecte waardetoegang, zonder toeslag voor moduleherkomst. |
| Tabel lezen / schrijven | 4 / 5 | Sleutel-/slotselectie, actuele waarde en schrijven krijgen meer ruimte dan een registerkopie, niet de kosten van een naïeve Lua-interpreter. |
| `SELF` | 5 | Veldtoegang met behoud van de oorspronkelijke receiver. |
| `NEWT` | 4 | Objectadmissie en vaste metadata; capaciteitinitialisatie en latere groei blijven afzonderlijk. |
| `CLOSURE` | 8 | Een allowance voor zes gelezen functierecordwoorden en binding; upvaluedescriptors blijven afzonderlijk. |
| `CALL` / `RET` | 6 / 6 | Gebonden functiedoel, registervenster en controlestack; daadwerkelijke waardeplaatsing en capture-sluiting blijven afzonderlijk. |
| `LEN` | 3 | Afzonderlijke nominale lengteklasse; geen nieuwe toeslag per tabelgrensprobe. |
| `DIV` / `FLOORDIV` / `MOD` | 32 / 33 / 34 | Lange rekenklasse, met respectievelijk floor- of rest/tekenwerk. Geen letterlijke software-algoritmetelling voor ieder bitpatroon. |
| `POW` | 128 | Complexe scalaire rekenklasse, viermaal de nominale deelklasse; geen prijs van één vermenigvuldiging. |

De bestaande niet-genoemde basisprijzen blijven gelijk. De toeslag van een
getelde store wordt één cycle per werkelijk opgegeven 32-bit woord, dus
`3 + C` na geslaagde readiness-preflight in plaats van `3 + ceil(C/4)`.
De bestaande route voert die woorden synchroon en geordend uit; er is geen
vier-woorden-breed CPU-storepad of uitgestelde bandbreedteschuld beschreven.
Eén woord per cycle is een optimistische nominale servicekeuze, niet een
kwalificatie van de DRAM-controller. De readiness-volgorde, de eenmalige charge
bij hervatten en de volledige sequentietoeslag bij een latere gedeeltelijke
busfout veranderen niet.

Dit volgt de praktische organisatie van vaste instructiegewichten met
specifieke werk- en wachttijdtermen. Bijvoorbeeld
[Dolphins opcode-eigenaar](https://github.com/dolphin-emu/dolphin/blob/ce74dde6e8bd765817360422c0ac04cd717b9c3a/Source/Core/Core/PowerPC/PPCTables.cpp#L415-L444)
onderscheidt korte FP-operaties en een lange deling;
[MAMEs FPU-eigenaar](https://github.com/mamedev/mame/blob/04124dc058df0cb6be13f7de9709c7a14252f9b8/src/devices/cpu/m68000/m68kfpu.cpp#L1988-L2262)
gebruikt afzonderlijke vaste rest- en transcendentale klassen. Hun numerieke
prijzen en ISA's zijn geen BMSX-hardwarebewijs en worden niet als tabel
gekopieerd. `MOD 34` en `POW 128` zijn BMSX-proefkeuzes. Ook goedkope speciale
operanden betalen hun gewone opcodeprijs; caches, aliassen en host-JIT-keuzes
veranderen die niet. Gewone hash-/metatabelketens en lengteprobes blijven in
hun nominale klasse; deze proef claimt daarvoor geen worst-case bovengrens.

De [instructiereferentie](book1/cpu.md#sec-cpu-cycle-accounting-and-execution-boundaries)
bezit de volledige uitvoeringsregels en actuele prijzen. Die bepalen de
verhouding tussen instructievoortgang en waarneembare device-events. De
onveranderde systeemklok is 33,8688 MHz. Regressies moeten daarom zowel
instructiegrenzen en foutvolgorde als echte spellen controleren; een hogere
charge mag werk over meer frames verdelen, maar geen gastwerk laten verdwijnen.

De onderzochte kandidaat deelt een binaire64-rekeneenheid tussen CPU en GEO.
In een gerichte corpusproef duurde een geaccepteerde deling daarin maximaal 72
klokken tot het resultaat; die proef is geen maximum voor alle bitpatronen en
omvat niet het complete CPU-pad. De kandidaat toont dus geen overeenstemming
met de vroegere basisprijs van twee cycles voor een deling, inclusief de vaste
cycle voor instructieaanvoer, en kwalificeert evenmin de nu overgenomen
nominale charge van 32 cycles. Dit is geen bewijs dat iedere andere mogelijke
fysieke architectuur onmogelijk is.

**Prestatie-intentie van BLua32.** De oorspronkelijke lage charges zijn bewust
gekozen om normaal programmeerwerk te benaderen zoals dat op vergelijkbare
hardware met C++ of assembly wordt uitgevoerd, niet om de overhead van een
naïeve Lua-interpreter voor te schrijven. Tabellen zijn een fundamenteel
onderdeel van de taal en hebben daarom bewust lage toegangs- en bouwkosten;
een realistisch timingvoorstel moet die ontwerpintentie voor gewone workloads
meewegen in plaats van voor iedere tabeloperatie automatisch de kosten van een
algemene software-hashtabel op te leggen. Dat doel is geen belofte dat ieder
BLua-programma evenveel cycli gebruikt als willekeurige C++- of assemblycode.

De gebruiker bedoelt bovendien dat modules voor de cyclekosten niet als gewone
tabellen moeten worden behandeld. Book II maakt daarbij een relevant
onderscheid: `module<const>` is een statisch opgeloste naamruimte, zonder
runtime-moduletabel; een gewone module kan juist wel een veranderlijke tabel
als waarde exporteren. Toegang tot zo'n waarde behoudt de voorgeschreven
tabelsemantiek, inclusief veranderlijke velden. In de huidige instructietabel
kosten `GETT`, `GETI` en `GETFIELD` vier basiscycles en hun schrijfvarianten vijf,
inclusief de vaste cycle voor instructieaanvoer;
een dynamische tabeltoegang heeft die instructiekosten ook als de tabel uit een
module komt. Er is geen afzonderlijke moduletabeltoeslag. Hoe de gewenste
modulekosten en de bestaande veranderlijke modulewaarden samenkomen in fysieke
timing moet nog worden uitgewerkt; het is geen vrijbrief om veranderlijke
modulevelden statisch vast te zetten.

De uitvoeringslaag kan daarom geschikte compilatie- of decoderoptimalisaties,
compacte representaties en gespecialiseerde tabel- en naamtoegang combineren
met de conventionele processor. Zulke keuzes moeten de dynamische waarden,
aliassen, metatabelgedrag, uitzonderingen en waarneembare geheugen- en
devicevolgorde behouden; ze hoeven geen nieuw publiek bestandsformaat of een
verplichte C++-toolchain te introduceren. Benodigde hardware, ruimte, prestaties
én timing voor elke workload zijn nog niet aangetoond.

**Kandidaat voor efficiënte veldtoegang.** Een statische `module<const>`-export
wordt bij compilatie gekoppeld aan zijn constante of functiedoel en vraagt geen
runtime-moduletabel. Voor een gewone module-export die daadwerkelijk een
veranderlijke gasttabel is, gebruikt de uitvoeringslaag dezelfde veldtoegang als
voor iedere andere gasttabel. Zij brengt geen extra kosten in rekening op basis
van de herkomst van de waarde. Zo behouden verschillende aliases dezelfde
identiteit en zien zij elkaars mutaties.

Een mogelijke snelle veldroute bewaart per uitgevoerde instructielocatie een
private hint naar een tabelslot. Bij een toegang vergelijkt de tabeleigenaar de
werkelijke representatie en sleutel van dat slot met de aangeboden gastsleutel;
alleen een overeenkomende, aanwezige eigen entry levert direct zijn **huidige**
waarde. Is dat slot na verwijderen, herverdelen of hergebruik anders, dan
volgt de gewone tabelopzoeking met de bestaande metatabel- en foutregels. Een
write blijft een mutatie bij de tabeleigenaar, inclusief lengte, collectie en
eventuele gevolgen voor andere aliases. Een slot zonder eigen waarde kan een
overgeërfde waarde zichtbaar maken en wordt daarom niet als vaste uitkomst
vastgezet. De hint is geen publieke objectidentiteit, geen vastgelegde module-
of cartridge-ABI en geen excuus om mutabele modulevelden in te vriezen.

Dit is een concrete uitvoeringsrichting, geen bewijs dat iedere toegang binnen
de vaste basisprijs van vier cycles past. Wisselende sleutels, metatabelketens
en allocatie kunnen meer werk vragen; er is geen vaste kostengarantie voor alle
representabele invoer. De huidige instructieprijs is gelijk voor een dynamische
tabel die via een module is verkregen en dezelfde tabel via een andere alias;
de guestwaarde draagt geen afzonderlijke moduleherkomst. Als de bedoelde regel
zou zijn dat precies dezelfde tabeltoegang via een modulealias een andere prijs
krijgt dan via een gewone alias, vraagt dat een afzonderlijke productkeuze over
hoe die herkomst machinezichtbaar blijft. Die keuze wordt hier niet gemaakt.
Een vergelijkbare afzonderlijke slothint voor constant-genaamde toegang wordt
gebruikt in de [Luau-uitvoeringskern](https://github.com/luau-lang/luau/blob/master/VM/src/lvmexecute.cpp);
dit is een organisatievoorbeeld, geen bewijs voor BMSX-prestaties of een keuze
voor Luau-semantiek.

**Fysieke kwalificatie, los van het nominale proefmodel.** De bestaande RTL is een
uitvoeringskandidaat die mag worden herzien, geen norm waaraan de nieuwe CPU
of geheugencontroller moet blijven voldoen. De huidige gesloten-paginaroute
publiceert een DRAM-resultaat na negen klokken en kan iedere tien klokken een
verzoek accepteren. Dat zijn eigenschappen van die controller, niet de
minimumlatentie van de geheugenchips. De onderzochte
[ISSI IS41LV16100-50, Rev. L](https://www.mouser.com/catalog/specsheets/issi_IS41C16100.pdf#page=1)
ondersteunt EDO-paginatoegang: de minimale kolomcyclus binnen een open rij is
20 ns, tegenover 84 ns voor een nieuwe random-accesscyclus. De opgegeven
50 ns RAS-, 25 ns kolomadres- en 13 ns CAS-toegangstijden zijn maximale
datageldigheidsvertragingen waarvoor de controller moet budgetteren. Zij zijn
geen minimale instructieduren. Kolomsturing, capture, precharge, refresh,
bankwisseling, arbitrage en fysieke marges blijven nodig; paginamodus geeft
niet vanzelf één woord per systeemklok.

Goedkope lokale taaloperaties zijn evenmin alleen een softwarehypothese.
Suns [picoJava-II-programmeerhandboek, Appendix A](https://picojava-ii.github.io/docs/pj2-prog-ref.pdf#page=487)
geeft typisch voor opgeloste `getfield_quick` één klok en voor de
twee-woordvariant twee klokken bij directe objectreferenties, cachetreffers en
zonder stalls of exceptions.
Dat ontwerp heeft onder meer een 64-woord-stackcache met meerdere lees- en
schrijfpoorten en configureerbare instructie- en datacaches; de
[standaardconfiguratie](https://picojava-ii.github.io/docs/html/build-rtl.html)
heeft van beide 16 KiB. Een directe load-use-afhankelijkheid voegt een klok
toe; `invokestatic_quick` kost elf klokken. Deze getallen kwalificeren geen
BMSX-prijzen: Java-resolutie,
objectrepresentatie en framebeheer verschillen. Ze laten wel zien waarom
zowel de lokale resources als de volledige uitvoeringsroute moeten worden
begroot, niet alleen de externe geheugentoegang of de spronginstructie.

De volgende begroting blijft nodig voor fysieke kwalificatie zonder eerst een
volledige processor te bouwen. Zij blokkeert het nominale proefmodel niet:

| Pad | Begroting voor fysieke kwalificatie |
|---|---|
| Instructieaanvoer en rekenwerk | Fetchbreedte, decoder, beschikbare operandpoorten, resultaatpoorten, afhankelijkheden en de gekozen rekeneenheid; refill en meer-cyclusrekenwerk afzonderlijk. |
| Geheugenwoord en 64-bit waarde | Werkelijke busbreedte, lokale treffer of externe service, volgorde van deeltransfers, pagina- en bankwisseling, refresh en mededinging. |
| Eigen tabelveld | Geldige huidige sleutel en aanwezigheid, waardeopslag en eventuele vorm- of slothint; het trefferpad én de werkelijk benodigde misserroute. Een vaste offset verkort de adresberekening, niet de externe geheugentransactie. |
| Gebonden `CALL` en `RET` | Residente closuregegevens, actieve waardeslots, controlestack, framewisseling en PC/domeinwisseling; spills en bestaande plaatsings- en capturevolumes afzonderlijk. CALL gebruikt de gegevens van het gedeelde functieprototype ([§12.7](#sec-proposal-language-heap)). |
| Constructie, groei en tekst | Opslagadmissie, de werkelijk gelezen of geschreven waardeslots of tekst, en hun geheugenservice; geen ongefundeerde toeslag voor het gebruik van Lua of een modulealias. |

Lokale opslag moet een gekozen capaciteit, poortorganisatie en gedrag bij
missers of verdringing hebben; de volledige taalheap wordt niet stilzwijgend
snelle SRAM. Als een cache de waarneembare instructieduur bepaalt, behoren
zijn timingrelevante inhoud, vervanging en invalidatie tot het machinegedrag,
niet tot vrijblijvende host-JIT-hints. Onafhankelijke werkzaamheden mogen
overlappen waar de gekozen resources dat daadwerkelijk toelaten.

Een toekomstige fysieke uitwerking mag andere interne treffer- en misserkosten
of een gewijzigde uitvoeringsroute gebruiken. Een timingmodel dat die kosten
zichtbaar maakt vraagt een afzonderlijk productbesluit; het nominale proefmodel
voegt ze niet impliciet toe. Fysieke acceptatie vereist een sluitend
resourceschema, niet overeenstemming met de proefgetallen of Cortex-A7-hosttijd.
Tot die begroting is gesloten, is er geen fysiek haalbaarheidsbewijs voor alle
prijzen en evenmin een universele ondergrens van dertig klokken voor iedere
tabeltoegang.

**Afzonderlijke fysieke vervolgrichting.** De systeemklok blijft 33,8688 MHz.
Een toekomstig fysiek timingmodel kan dezelfde BLua32-instructies en waarden
realiseren terwijl hun
voortgang volgt de feitelijk benodigde instructieophaling, uitvoering,
rekenstappen, geheugenservice en eventuele wachttijd. Onafhankelijk of
parallel verrichte werkzaamheden worden daarbij niet automatisch als losse
vaste kosten bij elkaar opgeteld. De bestaande nominale tabellen zijn voor
deze kandidaat niet langer een garantie van verstreken tijd; exacte minimale
of maximale instructieduren en doorvoer zijn hier niet vastgesteld.

1. **Instructie en zichtbaarheid.** Een gastinstructie wordt volgens haar
   bestaande breedte gedecodeerd, inclusief een eventuele `WIDE`-prefix, en
   behoudt haar bestaande waarde-, PC- en exceptionregels. De interne native
   stappen zijn geen afzonderlijke BLua32-instructies. Resultaten en
   registerwijzigingen worden zichtbaar volgens de instructieregels; een
   meerwoordige geheugenhandeling blijft geordend en wordt niet ineens
   atomair.
2. **Geheugen en wachten.** Toegang duurt tot de betreffende geheugen- of
   apparaattransactie is afgehandeld. Arbitrage, vernieuwing en een niet-gereed
   apparaat kunnen tijd kosten. Een op gereedheid geblokkeerde store voert geen
   write uit terwijl hij wacht; de passende ready-gebeurtenis hervat de
   bewaarde operatie volgens de bestaande
   [CPU-grenzen](book1/cpu.md#sec-cpu-additional-work-and-waiting), niet een nieuw
   opgehaalde instructie. Er wordt geen
   automatische timeout, busfout of terugdraaiing van eerdere effecten
   toegevoegd. Bij een meerwoordtoegang behouden een fout en eerder uitgevoerde
   woorden hun bestaande volgorde en gevolgen.
3. **Devices en interrupts.** Systeemtijd en deviceklokken lopen door tijdens
   CPU-rekenwerk, buswachttijd en `HALT`; een DMA- of GEO-opdracht heeft zijn
   eigen voortgang. IRQ-bronnen kunnen ondertussen pending worden. De CPU
   accepteert interrupts op de bestaande toegestane guest-grenzen, met de
   bestaande maskering en NMI-/supervisorregels. NMI heeft voorrang; er is geen
   afzonderlijke prioriteitsvolgorde tussen IRQ-bronnen. Dit voorstel verzint
   geen vaste request-naar-handlerlatentie en onderbreekt niet zomaar een
   gedeeltelijk uitgevoerde instructie.
4. **Relatie met andere timing.** De eerder goedgekeurde meer-cyclus-DMA- en
   GEO-richtingen en de fysieke video-output blijven afzonderlijke
   devicecontracten. CPU, devices en de gedeelde bus moeten hun werkelijke
   onderlinge volgorde behouden; een nominale instructiecharge creëert geen
   extra busbandbreedte of voltooiing van apparaatwerk.

Deze fysieke vervolgrichting is geen gemeten prestatie van een PS1-klasse CPU
of voltooide interpretatie-implementatie en wordt niet stilzwijgend door het
nominale proefmodel ingevoerd. De proef verandert wel de genoemde charges
gezamenlijk in Book II en beide uitvoeringen. Programma's die op oude
charge-afstanden vertrouwen kunnen andere timing en interleavings zien; de
bestaande instructie-, fout-, readiness- en IRQ-grenzen blijven gelden.
Verdere fysieke contracten vragen hun eigen uitwerking en besluit.

## 12. CPU: de taalheap in hoofd-RAM {#sec-proposal-language-heap}

**Status: richting gekozen op 18 november 2026 (B1–B9, O1–O7). Fasen 1–3
zijn uitgevoerd. De vaste GEO-scratchreservering is verwijderd; de taalwaarden
verhuizen pas vanaf fase 4 naar het heapgebied. Zie 12.14.**

Tabellen, closures, captured-variable-cellen, threads met hun frames, strings,
constantenpools, globals en het beheer van de taalruntime worden records in
het publieke hoofd-RAM. Een referentiewaarde draagt het gastadres van haar
record. Er is dan geen afzonderlijk taalbudget naast het RAM meer, en geen
hostobjectgraaf als tweede machinetoestand. De bezette bytes van een object
zijn de bytes die zijn record werkelijk in RAM inneemt. Savestate en rewind
worden daarmee in eindvorm een geheugenkopie plus processortoestand.

Dit besluit de open uitvoeringsvraag van de eerder goedgekeurde budgetrichting:
globals, frames en beheer tellen mee in één fysiek budget, en het publiek
adresseerbare hoofdgeheugen blijft **4 MiB**. Dat budget is nu dat RAM zelf.
De onderzochte private DRAM-bank is daarmee niet langer de referentiekandidaat
voor de taaltoestand. Zie [Runtimecapaciteit](#sec-proposal-runtime-capacity)
en [Book IV, Runtime memory](book4/hardware.md#sec-core-private-memory).

De BLua32-processor blijft het zichtbare uitvoeringsmodel. Een native
interpreter, een hybride of gespecialiseerde logica blijven mogelijke
realisaties. Hun **werkgegevens** staan nu in het publieke RAM. Voor hun
**programmacode** blijft een afgeschermde native programmageheugenroute nodig;
zie [Native programmageheugen](#sec-proposal-native-program-storage). Die vraag
staat los van dit voorstel.

### 12.1 Gekozen richting, bevestigingen en reviewbesluiten

| | Keuze | Precedent |
|---|---|---|
| B1 | De heap loopt van het einde van de statische opslag tot het einde van RAM. De CPU legt de vloer vast bij reset en EXEC (12.2) | PSX `InitHeap` na de BSS; MicroPython `gc_init(start, end)`; PPSSPP reserveert een ELF-bereik vóór het schrijven |
| B2 | Geen bescherming. Ruwe stores en DMA mogen records overschrijven; dat is een gastfout met deterministische gevolgen. Recordtoegangen worden per toegang gespiegeld (12.4) | RAM-spiegeling door onvolledige adresdecodering (PSX); mGBA kiest eerst de regio en past dan het bankmasker toe |
| B3 | Het adres is de hash van een objectsleutel; `hashId` vervalt | Lua 5.4 `ltable.c` hasht objectsleutels op pointer |
| B4 | Frames worden records in het stackblok van hun thread | Lua 5.4 `luaE_extendCI` |
| B5 | Niet-verplaatsende allocator met size classes | Lua, MicroPython |
| B6 | Allocatie en GC blijven een machinefunctie; het snelle allocatiepad zit inline in de JIT. De cyclustarieven worden per bewerking vastgelegd (O2, 12.6) | De GC in de VM; Luau scheidt markeer- en veegwerk |
| B7 | Stringconstanten zijn ROM-records met een interntabel in ROM. Alle strings blijven geïnterneerd: eerst RAM, dan ROM (12.9) | NodeMCU Lua Flash Store: eerst `strt`, dan `ROstrt` |
| B8 | De RAM-basis staat in een vast register; het spiegelmasker is een immediate | Dolphin, PPSSPP, DuckStation |
| B9 | TS gebruikt één `ArrayBuffer` met getypeerde views, zonder wrappers | v86, jsnes |

**Bevestigd door de gebruiker:**

- **Het hoofd-RAM blijft 4 MiB** als uitgangspunt. De taalheap valt
  binnen dat RAM; `K` hangt af van de statische opslag van het actieve beeld
  (12.11).
- **De `pairs`-volgorde mag veranderen.** [`next`](book1/bios-base.md#sec-bios-base-traversal-argument-selection-globals-and-output)
  belooft nu al alleen "array slots in ascending order, followed by live hash
  slots, according to the Table's current storage". Een andere hashverdeling
  wijzigt dat contract niet. Opgenomen demotijdlijnen die op de volgorde van
  objectsleutels leunen, worden opnieuw opgenomen.

**Akkoord na review.** Vier aanvullingen op B1–B9 zijn aanvaard:

- de CPU zet de vloer, met pagina-uitgifte van boven naar beneden;
- recordtoegangen worden per toegang gespiegeld;
- internering zoekt eerst in RAM;
- bit 31 van een cartridgestringreferentie kiest de socket.

De beslissingen O1–O7 staan in [12.12](#sec-proposal-language-heap-decisions).

### 12.2 Het heapgebied

**Gebied.** De taalheap is `[vloer, 08400000H)`. De bovenste 16 KiB,
`[083FC000H, 08400000H)`, is het **runtimebeheergebied**: allocatorpagina's,
size-class-lijsten, GC-toestand, de interntabelreferentie en de referenties
naar de globalbanken. Het beheergebied ligt op een vast adres, zodat de JIT
GC-velden als vaste offset vanaf het RAM-basisregister kan lezen. De capaciteit
`K` is `083FC000H − vloer`. Dat is de waarde die `collectgarbage('capacity')`
rapporteert en die de drempelformule gebruikt.

**Vloer.** De vloer is het einde van de statische opslag van het geactiveerde
programmabeeld, naar boven afgerond op 4 KiB:
`max(DATA-run-adres + DATA-lengte, BSS-adres + BSS-lengte)`. De CPU leest die
velden (`44H`–`50H` van de programmaheader) bij reset en bij EXEC. Die velden
zijn nu beschrijvend en worden dan gelezen.

**Waarom de CPU de vloer zet.** Het opstartverloop laat zien dat de vloer al
vóór de eerste BIOS-instructie moet bestaan:

| Moment | Wat alloceert | Geldende vloer |
|---|---|---|
| Reset | Hoofdthread met stackblok en eerste frame (B4); globalbanken | Einde system-BSS, door de CPU uit de systeemheader gelezen |
| Activering van het systeembeeld | Constantenpool en globaltoewijzing van het systeembeeld | Idem |
| System-DATA/BSS en module-init | `require('base')`, `table`, `string`, compiler, terminal enzovoort | Idem |
| Opstartlus | Tijdelijke strings en tabellen van het opstartscherm | Idem |
| EXEC naar de cartridge | Constantenpool en globaltoewijzing van het cartridgebeeld | **Einde cartridge-BSS**, door EXEC uit het doelbeeld gelezen |
| Cartridge-startup | DATA kopiëren, BSS wissen, module-init, entry | Idem |

EXEC behoudt de globalbanken en de BIOS-bindingen. Globals en andere levende
objecten overleven dus de overdracht, en de cartridge wist daarna haar BSS.
Pagina's worden daarom **van boven naar beneden** uitgegeven, hoogste vrije
pagina eerst. BIOS-objecten liggen dan hoog in RAM, ver boven de cartridge-BSS.

**Grensgeval.** Overlapt de statische opslag van het nieuwe beeld een bezette
heappagina, dan gaat het zo:

1. EXEC voert eerst een volledige collectie uit.
2. Ligt er daarna nog een bezette pagina onder de nieuwe vloer, dan wijst EXEC
   de overdracht af met een hard halt, zoals bij een ongeldig startuprecord.

De afwijzing valt vóór de eerste instructie van het nieuwe beeld. Er is dan nog
geen byte van zijn DATA of BSS geschreven. PPSSPP doet hetzelfde bij het laden
van een ELF op een vast adres: eerst het hele bereik reserveren, daarna pas de
segmenten schrijven. Bij de huidige beelden gebeurt dit alleen als de BIOS bij
de overdracht vrijwel het hele heapgebied bezet houdt.

**Elke EXEC-route.** EXEC zet de vloer zelf, dus elke EXEC-route valt onder
dezelfde regel: de BIOS-overdracht, EXEC tussen cartridgebeelden en een
herhaalde startup. Een verlaagde vloer is altijd toegestaan. De statische
opslag van het vorige beeld wordt dan heapruimte.

**Plaatsing van cartridgeopslag.** [Memory](book1/memory.md#sec-memory-reserved-and-cartridge-storage-in-main-ram)
staat nu elke ongereserveerde plaatsing van cartridge-DATA/BSS toe. Met deze
regel is de heap alles boven het hoogste statische byte. Een plaatsing hoog in
RAM is dus nog steeds geldig, maar laat weinig heap over. De compacte indeling
blijft de aanbevolen vorm.

**Uitvoerbaar RAM blijft (O1).** Instructies mogen uit het hele geïnstalleerde
hoofd-RAM buiten de I/O-apertuur blijven komen, ook uit het heapgebied.
Recordschrijfacties melden hun gewijzigde bereik aan dezelfde
RAM-schrijfwatches als gewone stores, voor zover ze eerder gedecodeerde code
kunnen raken. Een aaneengesloten reeks, zoals een kopie of rehash, geeft één
melding, net als bij DMA.

De kosten zijn één bytelezing en een vertakking per recordstore of per reeks.
Dat is hetzelfde pad als de bestaande `STORE_MEM`-controle. DuckStation
invalideert vertaalde code op dezelfde manier wanneer een bewaakte RAM-pagina
wordt beschreven.

### 12.3 De GEO-scratchreservering vervalt

**Uitgevoerd in fase 3.** De vaste reservering van 512 KiB op
`[08040000H, 080C0000H)` is verwijderd. GEO krijgt bron- en doeladressen van het
programma ([GEO](book1/geo.md)). Geen apparaat en geen runtime-eigenaar hangt
aan dat vaste adres. De oude gebruikers zijn hieronder verantwoord:

| Gebruiker | Voor fase 3 | Na fase 3 |
|---|---|---|
| `cartlib/collision/collision_2d.lua` | Vast adres `08040000H` en 512 KiB voor instances, resultaten en samenvatting | De cartridge reserveert de buffer in haar eigen BSS en geeft adres en capaciteit aan `cartlib` |
| `carts/bare_metal_cart/cart.lua` | Gebruikt `08040000H` als textuurbuffer en `08044000H`–`08046FFFH` voor scherf-, deeltjes- en hoektabellen | Eigen BSS-buffers |
| Linker (`DYNAMIC_RAM_BASE`) | System-DATA begint op `080C0000H` | System-DATA begint direct na de I/O-reservering, op `08040000H` |
| `LuaHeap` (`BASE_RAM_USED_SIZE = GEO_SCRATCH_SIZE`) | Capaciteit `ramBytes − 512 KiB` = 3,5 MiB | Tijdens de infrastructuurfase expliciet vast op 3,5 MiB; vanaf de tabelfase `K` |

**Omvang van de buffer.** De grootste post is de lijst met mogelijke
contactresultaten. Bij 64 colliders kost ruimte voor alle 2.016 mogelijke
contacten, met 36 bytes per resultaat, 70,875 KiB. Met 64 instances en de
samenvatting erbij is de hele buffer 72,39 KiB. Een spel kan een kleinere resultaatbuffer opgeven. GEO meldt
`RESULT_CAPACITY` zodra een daadwerkelijke treffer niet meer past.

Een aparte GEO-RAM is voor de huidige opdrachten niet nodig. De Seibu-COP uit
*Raiden II* leest in MAME posities en hitboxen uit de adresruimte van het spel
en houdt alleen de twee onderzochte objecten lokaal bij. BMSX heeft ook al
lokale rekenbuffers: de polygon- en clippingarrays van `OVERLAP2D` beslaan in
C++ samen 6 KiB.

**Gevolg voor `K`.** Het heapgebied groeit met 512 KiB, min de GEO-buffer die
de cartridge zelf declareert, gerekend met de op pagina’s afgeronde
heapvloer. De nieuwe waarden staan in 12.11.

### 12.4 Adressering en spiegeling

**Referenties.** Een Table-, Closure-, Thread- of String-waarde draagt in haar
32-bit payload het adres van haar record. Een RAM-record heeft een adres in
`08000000H`–`083FFFFFH`. ROM-strings staan in 12.9. Captured-variable-cellen
zijn geen taalwaarden; ze worden alleen vanuit closures en threads gerefereerd.
Dit vervangt de huidige referentie, die op pointerbreedte kiest: een
hostpointer op 32-bit native hosts zoals ARM32, een directory-index op bredere
hosts. TS en C++ geven de nieuwe referentie dezelfde betekenis.

**Bereik.** Een recordtoegang blijft binnen de RAM-bank. Ze wordt **niet**
begrensd tot haar allocatie: daarvoor zou de grootte van de allocatie nodig
zijn, en B2 kiest bewust geen bescherming. Een corrupte referentie of index
leest of schrijft dus andere RAM-bytes, niet buiten RAM.

**Breedte en adresberekening.** Recordtoegangen zijn 1 of 4 bytes breed.
Voor een toegang op byteadres `A`, dat is record plus veldoffset of blok plus
index:

| Breedte | RAM-offset | Gevolg |
|---|---|---|
| 4 bytes | `A AND 003FFFFCH` | Uitgelijnd; overschrijdt nooit het einde van RAM |
| 1 byte | `A AND 003FFFFFH` | |

Een bewerking over meer woorden, zoals een kopie, een rehash of een
stackverschuiving, rekent elk woord apart zo uit. De regel geldt voor kopvelden,
geïndexeerde slots, ketenlinks en allocatorbeheer, dus niet alleen voor de
eerste dereferentie van een object.

Eén masker per object volstaat niet. Een corrupte array- of hashcapaciteit
levert indices op die voorbij de buffer reiken. De uitlijning zit in het masker
omdat een TS-`Uint32Array`-index de laagste bits al wegvalt, terwijl een
C++-load op ARMv7 ongeuitlijnd zou lezen. Zonder uitlijning in het masker zou
een corrupte referentie op de twee hosts verschillend uitpakken.

**Geen bus.** Recordtoegangen gaan rechtstreeks naar de RAM-opslag, niet over
de gemapte bus:

- Ze raken geen I/O-decoder. Een gemaskeerde offset onder `00010440H` leest de
  RAM-bytes onder de registerapertuur, niet de registers.
- Ze geven geen busfout.
- Ze lopen niet via DMA-arbitrage.

Schrijfacties melden zich wel bij de RAM-schrijfwatches (O1, 12.2). Hun kosten
zitten in de bestaande instructie- en collectiekosten.

**De bus blijft ongespiegeld.** Voor gewone loads, stores en DMA blijft gelden
wat [Memory](book1/memory.md#sec-memory-reserved-and-cartridge-storage-in-main-ram)
zegt: `[08400000H, 10000000H)` is geen spiegel van het geïnstalleerde RAM. De
spiegeling is een eigenschap van het recordpad van de CPU. Zie het als een
interne adreseenheid die alleen de lage 22 adresbits aanstuurt.

**Uitvoering in de hosts.** TS en C++ moeten bitgelijk gedrag geven.

- **TS** gebruikt per toegang `ram32[(A & 0x3FFFFC) >>> 2]` en
  `ram8[A & 0x3FFFFF]`.
- **C++** maskeert per toegang. Een snelle controle vooraf mag ook, mits ze alle
  volgende adressen met hun volledige breedte dekt: gemaskeerd begin plus de
  omvang van alle volgende toegangen ≤ 4 MiB, anders terug naar maskering per
  toegang. BMSX doet dat al voor aaneengesloten DMA-transfers.
- **Kosten ten opzichte van nu:**
  - x86-64 en AArch64: één `and` per veld bovenop de basis-plus-indexload.
  - ARMv7: `add`, `ubfx` en `ldr` met geschaalde index, tegenover één
    `ldr [obj, #off]` nu.
  - Met de controle vooraf schatten we voor het snelle pad één extra
    ARMv7-instructie per object. Dat is een schatting, nog geen meting.

**JIT-ABI (B8).** De RAM-basis staat in een vast sljit-register (S4) waar de
woordcache daardoor geen register verliest: op x86-64 en AArch64. Op ARMv7 zou
een vast register de cache van vier naar drie woordregisters brengen. Een
meting op de SNES Mini gaf daar ongeveer 2 tot 5 % meer CPU-tijd per frame.
ARMv7 laadt de basis daarom per RAM-toegang uit het al vastgezette
`state`-register. Eén helper (`emitRamAddress`) kiest tussen de twee vormen.
`LOAD_MEM` en `STORE_MEM` zijn de eerste gebruikers; recordtoegangen gebruiken
vanaf de tabelfase dezelfde helper.

### 12.5 Records

Alle velden zijn u32 little-endian, tenzij anders vermeld. Records zijn op
8 bytes uitgelijnd. Elk zelfstandig object begint met een **kopwoord**:

- byte 0: soort;
- byte 1: GC-markering;
- byte 2: vlaggen;
- byte 3: soortafhankelijk.

Een vrij slot heeft soort 0 en draagt in zijn tweede woord de volgende vrije
plaats. Eigen blokken van een object (onderdelen, stack, buckets, pools)
hebben geen kopwoord. Ze liggen in pagina's die het paginabeheer als "eigen
blok" markeert. De sweep slaat die pagina's over, en de eigenaar geeft zijn
blok vrij.

De indelingen hieronder zijn het voorstel. Elke migratiefase legt ze definitief
vast met haar representatietabel. Ze worden **geen publieke
programmeerinterface**: de handleidingen publiceren het gebied, de
spiegelregel en de bezette bytes, en verklaren de inhoud van het heapgebied
runtime-eigendom met een gereserveerde indeling.

| Object | Indeling | Bezette bytes |
|---|---|---|
| Table | Kop van 32 bytes: kopwoord, grijze link, metatable, onderdelenblok, arraycapaciteit `A`, hashcapaciteit `H`, lengtehint, `hashFree`. Onderdelenblok: `A + 2H` payloadwoorden, `H` ketenwoorden en `A + 2H` tagbytes | `32 + S(5A + 14H)`; het blok vervalt bij `A = H = 0` |
| Closure (O5) | Kopwoord (byte 3 = `U`; vlaggen met domein), grijze link, adres van het functieprototype, daarna `U` celreferenties | `S(12 + 4U)` |
| Captured-variable-cel | Kopwoord (open/gesloten, tag van de gesloten waarde); payloadwoord bij gesloten, of stackindex bij open; thread-referentie bij open; volgende open cel | `16` |
| Thread | Kop van 64 bytes: status, grijze link, resumer, entry, stackblok, capaciteit `V`, stacktop, framegegevens, fout, kop van de open cellen. Stackblok: `V` woorden, `V` tagbytes en het framegebied | `64 + S(stackblok)`; framerecords in de fase van threads en frames |
| String | Kopwoord (vlag ROM), hash, bytelengte `n`, volgende in de bucket, daarna `n` bytes | RAM: `S(16 + n)`. ROM: 0 |
| Interntabel | Blok van `B` bucketwoorden (macht van twee) | `S(4B)` |
| Constantenpool per geactiveerd beeld (O6) | `C` waardeslots: `C` payloadwoorden en `C` tagbytes | `S(5C)` |
| Globaltoewijzing per geactiveerd beeld (O6) | `N` slotnummers voor de naamindices van het beeld | `S(4N)` |
| Globalbank, systeem en gewoon (O6) | Blok met `G` waardeslots, plus een naam-naar-slot-index | `S(5G)` plus de index |

**Grijze link.** Het woord dat `hashId` vrijmaakt (B3), wordt de opdringerige
grijze link van tabellen, closures en threads. Strings en cellen worden zonder
grijze lijst gemarkeerd: een string is een blad, en een cel markeert direct haar
waarde. Er is dus geen begrensde markeerstack met een overloopregel nodig.

**Size classes (B5).** `S(n)` is de toegewezen blokgrootte van een aanvraag van
`n` bytes:

| Aanvraag `n` | Afgerond op een veelvoud van |
|---|---|
| 1–64 | 8 |
| 65–2048 | `2^(⌈log2 n⌉ − 3)`, dus vier klassen per verdubbeling: 80, 96, 112, 128, 160, … |
| > 2048 | 4096: een reeks hele pagina's |

Dat geeft hooguit 25% interne verspilling, gemiddeld ruim 10%. Kleine klassen
krijgen pagina's van 4 KiB met slots van één klasse. Grote aanvragen krijgen de
hoogste passende reeks vrije pagina's. Vrije lijsten en paginabeheer staan in
RAM, in het beheergebied.

**Determinisme.** B3 maakt de allocatievolgorde waarneembaar via `next`. De
keuze van pagina en slot moet daarom in TS en C++ bitgelijk zijn, met alle
allocatortoestand in RAM. Dat is een implementatiecontract tussen de runtimes,
geen handleidingregel.

### 12.6 Bezetting, collectiecycli en geheugenfout (O2)

**Bezetting.** Toelating en `collectgarbage('count')` gebruiken de werkelijk
toegewezen blokgrootte `S(n)` van alle allocaties. Daaronder vallen eigen
blokken en nog niet geveegde onbereikbare objecten. Vrije slots in
gedeeltelijk gebruikte pagina's en het beheergebied tellen niet mee.

**Collectiecycli per bewerking.** Het huidige tarief `ceil(occupied bytes / 4)`
vervalt voor scannen en vegen. Met afgeronde blokgroottes zou alleen de padding
de GC al trager maken. De tarieven volgen nu het werk zelf:

| Werk | Voorstel |
|---|---|
| Een object markeren en scannen | De kopwoorden van het record plus 1 per onderzocht waardeslot of referentie. Table: `8 + A + 2H`. Closure: `3 + U`. Cel: `4`. Thread: `16` plus de onderzochte stackslots en framewoorden |
| Een string of een object zonder inhoud markeren | `1` |
| Een pagina vegen | `1` per bezocht blok, bezet of vrij; een paginareeks telt als één blok. Vrijgeven kost niets extra; dat is allocatorbeheer |
| Eén interntabelbucket onderzoeken | `1`, zoals nu één stringdirectoryslot |
| Zwakke tabel: één convergentiepass, of entries wissen | `A + 2H` per tabel |
| Constant- en globalwortels | Ongewijzigd: `2C + 3(S + G)` per pass |

De staptarget van 4.096 werkcycli, het allocatietegoed `max(256, floor(W/16))`
en de ondeelbaarheidsregels blijven. Deze tarieven moeten in TS en C++ dezelfde
gasttijd geven. De rij voor het verkleinen van een threadstack wordt in de fase
van threads en frames herzien. Luau maakt hetzelfde onderscheid tussen
markeerwerk per object en veegwerk per bezocht blok.

**Toelating.** Een aanvraag slaagt als er een vrij slot van haar klasse is, of
een vrije pagina of paginareeks binnen `[vloer, 083FC000H)`. Lukt dat niet,
dan volgt de bestaande noodroute: de actieve cyclus afmaken, één verse
volledige cyclus, opnieuw proberen, en anders de Lua-geheugenfout met
`OUT_OF_MEMORY` als die niet wordt afgehandeld. **Nieuw:** door versnippering
kan een aanvraag mislukken terwijl `count` kleiner is dan `K`. De handleiding
moet dat zeggen.

**Drempelformule.** Die blijft ongewijzigd, met `K` uit 12.2. `K` hangt nu af
van de statische opslag van het geactiveerde beeld.

**Corrupte records.** Allocator en collector moeten op corrupte records
begrensd blijven: geen eindeloze lus en geen toegang buiten de hostbuffer. Het
gevolg is fout maar deterministisch, en op alle hosts gelijk. Het mechanisme,
bijvoorbeeld een begrenzing per cyclus van het aantal grijze-lijststappen,
wordt in de fase van het GC-beheer vastgelegd.

### 12.7 Closures en functieprototypes (O5)

**Besluit: het closuremodel van Lua.** Een closure verwijst naar een gedeeld
functieprototype en bindt haar eigen upvalue-cellen volgens de lexicale scope.
Het prototype is het bestaande functierecord. `CALL` gebruikt de gegevens van
dat prototype: codeadres, parameters, maxStack en vlaggen. De omvang van een
closure volgt uit haar indeling: `S(12 + 4U)`. Dat is vóór afronding vier bytes
minder dan de huidige charge `16 + 4U`. De `4U` zijn de verwijzingen naar
upvalue-cellen. Twee closures die dezelfde variabele vangen, verwijzen naar
dezelfde afzonderlijk gealloceerde cel.

**Stabiel prototype, geen emulatorcache.** Een gepubliceerd prototype blijft
stabiel zolang closures het gebruiken. Wie een *nog gebruikt* record
tussentijds overschrijft, krijgt geen garantie over het doel, de framegrootte
of de captures van bestaande closures. Dat ligt in lijn met de vaste `Proto` in
Lua.

Een cache van gedecodeerde prototypegegevens is daarentegen alleen een
eigenschap van de emulator. Een schrijfmelding mag die cache ongeldig maken. Het
concrete geval is `load`: zodra een oud codeblok vrij is, kan de BIOS-arena
hetzelfde RAM-adres voor een nieuwe functie gebruiken. De volgende constructie
ziet dan het nieuwe prototype. Daarvoor volstaat de algemene melding van het
werkelijk geschreven RAM-bereik aan de schrijfwatches (O1). Voor records in ROM
speelt dit niet. Hot Resume blijft de expliciete bewerking die levende closures
aan een nieuwe revisie koppelt.

Waar de garantie vandaan kwam:

- Op 9 november verwachtte een test dat een bestaande closure na zo'n write de
  nieuwe functie uitvoerde.
- Op 12 november draaide `fe38862cd` die verwachting om, zodat het native
  aanroeppad de bij `CLOSURE` vastgelegde gegevens kon gebruiken.
- In `carts` en `cartlib` is statisch geen afhankelijkheid gevonden.

| Onderdeel | Uitwerking |
|---|---|
| Runtime en JIT | Closures van dezelfde functiedefinitie delen één stabiel prototype. De JIT mag prototypegegevens per aanroepplek inbouwen; voor een prototype in RAM vervalt die code via de schrijfwatches |
| Toolchain en BIOS-`load` | Het bestaande functierecord is het prototype. Er is geen nieuw ROM-formaat of nieuwe instructie nodig. De BIOS-linker vult het RAM-blok vóór de eerste closure wordt gemaakt, en een levende closure houdt dat blok al in leven. Een nieuwe functiedefinitie krijgt een nieuw prototype |
| Studio en Hot Resume | Studio herschrijft nu afzonderlijke functievelden in levende ROM-closures. Voortaan koppelt de expliciete revisieovergang de betrokken closures aan het nieuwe prototype, met behoud van hun identiteit en captures. Actieve frames gaan via de bestaande relocatie |
| Tests en snapshots | De assertions die een uitkomst eisen na het overschrijven van een levend record (`tests/lua/cpu_compiled_calls.test.ts`) worden vervangen. Dekking voor `CALL`/`RET`, stackgroei, gedeelde captures, `load` en Hot Resume blijft. Snapshot en restore herstellen gedeelde prototypes en cellen als gedeelde objecten |

In §11 verandert de rij "Gebonden `CALL` en `RET`" mee: CALL leest de gegevens
van het gedeelde prototype. Het tarief van `CLOSURE` wordt in de fase van
closures herzien.

### 12.8 Constantenpools en globals in gast-RAM (O6)

**Besluit.** Gast-RAM wordt de opslag die de CPU daadwerkelijk gebruikt. Nu
decodeert C++ bij beeldactivatie de constanten naar een hostvector en
registreert het namen in twee machinebrede globalbanken. Die
uitvoeringsgegevens verhuizen naar gast-RAM. De gewone allocatie telt hun
ruimte één keer mee. Een aparte boekhoudkundige heffing op host-arrays vervalt.

| Gegeven | Eigenaar en opslag |
|---|---|
| Oorspronkelijke constantrecords, namen en ROM-stringtekst | Blijven in het ROM-beeld. Een verwijzing naar een ROM-string kost in de gedecodeerde pool alleen de ruimte van het slot |
| Gedecodeerde constanten en de koppeling van naamindices aan globale slots | Per geactiveerd programmabeeld in gast-RAM |
| Gewone globals en systeemglobals | Hun actuele waarden staan in twee afzonderlijke banken in gast-RAM. Bij EXEC behoudt een bestaande naam binnen dezelfde bank zijn waarde |
| Compilatie, symbolen en revisiegegevens | Studio mag eigen pools en indices in hostgeheugen houden. Bij inspectie of wijziging van een live global leest of schrijft Studio het echte gastslot. Bij Hot Resume installeert de runtime de nieuwe uitvoeringspool en koppelt de nieuwe naamindices aan de bestaande globale waarden |

De slots bevatten gastreferenties: recordadressen voor tabellen, closures en
threads. Numbers houden de geldende semantiek: Integer is int32 en Float is
binary32. De review noemde binary64, maar sinds de int32/float32-merge op
master geldt dat niet meer.

Interpreter, JIT en GC gebruiken dezelfde RAM-opslag. Bouwt de JIT een
constante in native code in, dan vernieuwt vervanging van de pool, bijvoorbeeld
bij Hot Resume, ook de code die ervan afhangt.

### 12.9 ROM-strings en internering (B7, O3)

**Recordvorm in ROM.** Een ROM-stringrecord heeft dezelfde indeling als een
RAM-stringrecord, met de ROM-vlag gezet: kopwoord, hash, bytelengte, volgende
record in dezelfde bucket, bytes. De hash is **FNV-1a-32** over de bytes. De
linker berekent hem, en de CPU berekent hem voor nieuwe strings. Hij is dus een
publiek formaatgegeven.

**Wat er in het programmabeeld verandert:**

| Onderdeel | Nu | Voorstel |
|---|---|---|
| Header `30H`/`34H` | Stringadres en stringbytes, beschrijvend | ROM-stringtabel: bucketadres en aantal buckets (macht van twee), door de CPU gelezen. Bucket = `hash AND (aantal − 1)` |
| Constante, tag 4 | Tekstadres op `04H` en lengte op `08H` | Adres van het stringrecord op `04H`; `08H` ongebruikt |
| Naamrecord | 8 bytes: tekstadres en lengte | 4 bytes: adres van het stringrecord |
| UTF-8-controle bij activering | Ongeldige reeksen laten de activering mislukken | Vervalt samen met de goedgekeurde [byte-strings](#sec-proposal-byte-strings). De fase van strings en die wijziging horen bij elkaar |

**Internering: eerst RAM, dan ROM.** Een nieuwe bytereeks krijgt als identiteit,
in deze volgorde:

1. de RAM-string met dezelfde bytes;
2. anders het ROM-record in de systeem-ROM-tabel;
3. anders het ROM-record in de tabellen van geactiveerde cartridgebeelden, in
   volgorde van activering;
4. anders een nieuw RAM-record.

Bij activering lost een beeld zijn stringconstanten en globale namen via
dezelfde regel op, naar zijn constantenpool en globaltoewijzing in RAM.

Dit is ook de volgorde van NodeMCU. Die zoekt een nieuwe korte string eerst in
`strt` (RAM) en dan in `ROstrt`, en voegt alleen een onopgeloste string aan
`strt` toe. Het voorwerk noemde dit ten onrechte "ROM eerst".

Met ROM eerst zou de identiteit breken zodra er na RAM-strings een nieuw beeld
wordt geactiveerd. Voorbeeld: de BIOS maakt vóór EXEC `tostring(1)`, dus een
RAM-string `"1"`, en de cartridge heeft een constante `"1"`. Met RAM eerst
ontstaat na activering nooit meer een RAM-record voor bytes die in een
geactiveerde ROM-tabel staan. Een eerder RAM-record blijft zolang iets ernaar
verwijst, ook de constantenpool die het oploste. Zo heeft gelijke levende
inhoud één identiteit, ook over EXEC en tussen sockets.

**Toets.** Een BIOS-tabel met sleutel `"1"` geeft dezelfde waarde terug wanneer
de cartridge haar eigen constante `"1"` als sleutel gebruikt.

**Socketbinding van cartridgestrings.** Cartridgeadressen zijn in beide sockets
gelijk ([Cartridge](book3/cartridge.md#sec-cartridge-selection-and-execution)).
Een String-payload met alleen een ROM-adres is dus dubbelzinnig. Bij een record
in de cartridge-ROM van socket 1 is daarom bit 31 van de referentie gezet. Het
cartridge-ROM-venster `10000000H`–`2FFFFFFFH` gebruikt dat bit nooit. openMSX
heeft een vergelijkbaar precedent: zijn slotgerichte leesfunctie combineert een
adres met primaire en secundaire slotbits.

Het recordpad kiest eerst de regio en past dan het masker van die regio toe:

- payload `< 08000000H` uit system-ROM;
- payload in het RAM-venster uit RAM, gemaskeerd;
- anders uit cartridge-ROM, in socket `payload >> 31`, op adres
  `payload AND 7FFFFFFFH`.

Dat volgt de bestaande regel dat een closure die aan een cartridgedomein
gebonden is, in die socket uitvoert. Bytes buiten geïnstalleerde ROM lezen als
nul. Het recordpad leest nooit I/O, MMIO of cartridge-RAM.

Wordt een kaart verwijderd of verwisseld, dan leest een record in die socket de
nieuwe inhoud of nullen. De tekst is dan fout, maar deterministisch.
Gelijkheid verandert niet, want die gaat op identiteit. Houd de kaart dus
geplaatst zolang haar strings in gebruik zijn.

**Gemeten omvang** (constanten en namen, unieke teksten):

| Beeld | Unieke strings | Tekstbytes | Als RAM-records `S(16 + n)` |
|---|---:|---:|---:|
| Systeem-ROM | 338 | 4.657 | n.v.t. |
| `nemesis_s.rom` | 1.738 | 36.719 | 71.160 bytes |
| `pietious.rom` | 1.743 | 37.209 | 71.880 bytes |

De winst van ROM-records zit vooral in de cartridge: ongeveer 70 KiB per spel.

**Hash van tabelsleutels.** String-sleutels hashen op identiteit, net als
objectsleutels. De huidige C++-`scalarValueHash` doet dat al met het `StringId`.
Een tabelopzoeking dereferenceert de string dus niet. Alleen
stringbewerkingen lezen het record, met de regiokeuze hierboven, in trage paden
en builtins.

### 12.10 De rol van de BIOS bij allocatie en collectie

- **Uitvoering.** Allocatie en collectie zijn CPU-functies (B6). De BIOS bevat
  geen allocator of collector voor taalwaarden.
- **Interface.** De publieke interface blijft
  [`collectgarbage`](book1/bios-base.md#sec-bios-base-collectgarbage) over de
  primitief `vm_collect_garbage`. `'count'` rapporteert de toegewezen
  blokgroottes (12.6). `'capacity'` rapporteert `K`. Beide gaan over het
  heapgebied in hoofd-RAM. De zin "This does not include addressable RAM or
  VRAM" wordt omgekeerd: de capaciteit is een deel van het hoofd-RAM. Een nieuw
  register of een nieuwe BIOS-functie is niet nodig.
- **Opstart.** De BIOS hoeft bij de overdracht niets extra te doen. EXEC
  verhoogt de vloer en collecteert alleen als een bezette pagina in de weg zit.
  De levende BIOS-objecten blijven bovenin staan, want de heap is
  niet-verplaatsend.
- **Geheugenfout.** De tekst `Out of memory.` en de trap `OUT_OF_MEMORY` blijven.
  De oorzaak wordt: geen vrij slot of paginareeks in het heapgebied na
  collectie.
- **Grootste vaste verbruiker.** De BIOS-BSS meet 285.888 bytes. Daarvan is
  256 KiB de codearena van de runtimecompiler (`runtime_code_arena` in
  `compiler/arena.lua`). Als de heap krap blijkt, is die arena een hefboom. Dit
  voorstel wijzigt haar niet.

### 12.11 Capaciteit bij 4 MiB

**Uitgevoerd in fase 3.** De onderstaande waarden komen uit de herbouwde
programmaheaders. De I/O-reservering is 256 KiB; system-DATA/BSS loopt van
`08040000H` tot `08085CC4H` (exclusief einde). De CPU rondt het einde van
de statische opslag naar boven af op 4 KiB. `K` is de ruimte vanaf die vloer
tot `083FC000H`, exclusief het beheergebied van 16 KiB. Debug- en release-ROM
hebben per beeld dezelfde statische indeling.

| Beeld | Einde statische opslag (exclusief) | Heapvloer | `K` in bytes |
|---|---:|---:|---:|
| system/bmsx-bios | `08085CC4H` | `08086000H` | 3.629.056 |
| nemesis_s | `080ADD5CH` | `080AE000H` | 3.465.216 |
| pietious | `080A9D5CH` | `080AA000H` | 3.481.600 |
| cartlib_test | `08091CDCH` | `08092000H` | 3.579.904 |
| bare_metal_cart | `080B0150H` | `080B1000H` | 3.452.928 |
| studio_test | `08089CD8H` | `0808A000H` | 3.612.672 |

Ter vergelijking:

- het vroegere losse budget was 3,5 MiB;
- de hoogste gemeten opstartcharge is 1.478.842 bytes voor Nemesis en
  1.048.400 bytes voor Starcatch (zie de bijlage);
- de Pietious-heap telde bij de rewindmeting 22,8k objecten.

**Vanaf fase 4** gebruikt `LuaHeap` bovenstaande fysieke ruimte als limiet
voor toelating en de collectiedrempel. De omzetting van de opslag zelf is
een afzonderlijke stap; deze cijfers zijn capaciteit, geen meting van bezetting.

**Meting.** De gameplaypiek wordt gemeten met de nieuwe boekhouding zodra die
beschikbaar is, vanaf de tabelfase. De keuze voor 4 MiB wacht daar niet op.

### 12.12 Beslissingen {#sec-proposal-language-heap-decisions}

Alle beslissingen zijn op 18 november 2026 na de review genomen.

| | Vraag | Besluit |
|---|---|---|
| O1 | Instructies uit het heapgebied | **Uitvoerbaar hoofd-RAM blijft.** Recordwrites melden hun gewijzigde bereik aan de RAM-schrijfwatches; een aaneengesloten reeks geeft één melding. Een nieuwe zichtbare `InstructionBusError` alleen om een controle bij tabelstores te besparen, is onvoldoende reden (12.2) |
| O2 | Bezetting en GC-cycli | **Toelating en `count` gebruiken de toegewezen blokgrootte. GC-cycli worden per bewerking geprijsd:** markeren per onderzocht slot, vegen per bezocht blok (12.6) |
| O3 | Cartridgestrings | **ROM-records, internering eerst RAM, bit 31 kiest de socket.** Dat geldt ook voor ROM-constanten en globale namen (12.9) |
| O4 | Wie zet de vloer bij EXEC | **De CPU**, bij reset en EXEC, met pagina-uitgifte van boven naar beneden. EXEC wijst een overdracht af vóór de startup als statische opslag een levende pagina overlapt (12.2) |
| O5 | Closurebinding | **Het model van Lua:** gedeeld prototype, eigen cellen. De garantie over herschrijven vervalt (12.7) |
| O6 | Constantenpools en globals | **In gast-RAM**, als de opslag die de CPU werkelijk gebruikt (12.8) |
| O7 | Handleidingen | **Per fase, samen met beide runtimes** (12.13) |

### 12.13 Hoofdstukken die mee veranderen

Per fase leggen de handleidingen vast wat een cartridgebouwer moet weten:

- wie de GEO-buffers reserveert;
- wat `count` rapporteert;
- welke toestand EXEC behoudt;
- welke closure- en capturesemantiek geldt;
- wanneer een bewerking faalt.

Offsets van runtime-eigen records blijven in dit voorstel.

| Handleiding | Sectie | Wijziging | Fase |
|---|---|---|---|
| `book1/console.md` | Resourcetabel en inleiding | Het hoofd-RAM bevat ook de taalheap | Infrastructuur |
| `book1/memory.md` | Reserved and cartridge storage in main RAM | De reserveringstabel krijgt het heapgebied en het beheergebied, en de GEO-reservering vervalt. De zin "Neither … defines a free arena …" vervalt. De vloerregel komt erbij, en wat die betekent voor andere plaatsingen. De zin over geen spiegel blijft en geldt voor de bus | Infrastructuur, GEO |
| `book1/memory.md` | Addressed buffers and program storage | GEO-buffers horen in de statische opslag van de cartridge; gevolg van schrijven in het heapgebied | GEO |
| `book1/geo.md` | Launching and observing a job | Buffers komen uit de cartridge, niet uit een systeemreservering; dimensionering van de resultaatbuffer met `RESULT_CAPACITY` | GEO |
| `book1/cpu.md` | Resourcetabel (taalbudget van 3,5 MiB) | Wordt: het heapgebied in hoofd-RAM | Tabellen (`K` wordt de capaciteit) |
| `book1/cpu.md` | Language allocation and lifetime | Allocaties hebben een RAM-adres. Spiegeling per toegang; recordinhoud gereserveerd; schrijven door het programma is een programmafout | Tabellen |
| `book1/cpu.md` | Collection work charge | Bezetting volgens size classes; tarieven per bewerking (O2); `K` in de drempelformule; versnippering bij toelating; de framezin | Per objectsoort, met haar fase |
| `book1/cpu.md` | Closures and captured variables | Gedeeld prototype; geen garantie bij herschrijven van een levend record | Closures |
| `book1/cpu.md` | Reset, hard halt, EXEC en Execution domains | Reset en EXEC zetten de vloer; EXEC wijst af bij overlap; socketbinding van cartridgestrings | Infrastructuur, strings |
| `book1/blua-programs.md` | Language execution storage and byte RAM; Values are not byte buffers | Taalwaarden hebben records in RAM, maar hun indeling is geen programmeerinterface. Kopiëren behoudt identiteit | Tabellen |
| `book1/program-images.md` | BLua32 executable image | De velden `44H`–`50H` worden gelezen (vloer), later ook `30H`/`34H` (stringtabel) | Infrastructuur, strings |
| `book1/program-images.md` | Constant and name records | Tag 4 en het naamrecord verwijzen naar stringrecords; recordindeling, ROM-stringtabel en FNV-1a erbij; samen met de byte-strings | Strings |
| `book1/program-images.md` | Function and upvalue records | "Rewriting a record changes the data bound by a later construction" vervalt; het record is het gedeelde prototype | Closures |
| `book1/program-images.md` | Reset and cartridge startup; State at cartridge entry | De vloer bij reset en EXEC; BIOS-objecten bovenin; afwijzing bij overlap | Infrastructuur |
| `book1/coroutines.md` | Opslag van threads | Framerecords in het stackblok; de betekenis van `Out of memory.` blijft | Threads en frames |
| `book1/bios-base.md` | Overzichtstabel; Allocation-pool management | `count`/`capacity` over het heapgebied in hoofd-RAM | Tabellen |
| `book3/cartridge.md` | Selection and execution | Strings uit cartridge-ROM blijven aan hun socket gebonden | Strings |
| `book4/hardware.md` | Runtime memory; Native-processor execution candidate | De private DRAM-bank vervalt als referentie; werkgegevens staan in het publieke RAM | Infrastructuur |
| Dit document | §11 (`CALL`/`RET`, `CLOSURE`), overzichtstabel, bijlagen | Bijwerken naar deze richting | Steeds bij de betrokken fase |

`dma.md` en `imgdec.md` hoeven niet te veranderen. Hun RAM-bestemmingen liggen
al "outside reserved storage". Het heapgebied valt onder die regel zodra
`memory.md` het als gereserveerde opslag noemt.

### 12.14 Fasering

1. **Dit voorstel.** De handleidingen veranderen per fase, samen met de runtimes
   (O7).
2. **Infrastructuur.**
   - De vloer, met afwijzing bij overlap, en het beheergebied.
   - De allocator met size classes, in TS en C++ gespiegeld en bitgelijk.
   - Het RAM-basisregister in de JIT-ABI, met `LOAD_MEM`/`STORE_MEM` als
     eerste gebruiker.
   - Eén `ArrayBuffer` met `Uint8Array`- en `Uint32Array`-views in TS.
   - De meldregel voor recordwrites aan de schrijfwatches (O1).
   - `LuaHeap` expliciet op 3,5 MiB, los van `BASE_RAM_USED_SIZE`.

   Vóór de gespiegelde edits komen de representatietabel en de hete
   callsites.
3. **GEO-reservering weg — uitgevoerd.** Geheugenkaart, linker, `cartlib`,
   de bare-metal-demo en de handleidingen gebruiken programma-eigen buffers.
   `K` is opnieuw bepaald uit de gebouwde ROM’s (12.11).
4. **Tabellen.** `K` is de capaciteit. De payload-, tag- en hashvlakken
   staan samen in één toegewezen RAM-blok; hun bezetting gebruikt size
   classes. De tabelkop staat ook in RAM. Markeren en weak passes rekenen
   waardeslots, niet de afgeronde bytebezetting; de sweep bezoekt objectblokken
   op allocatorpagina’s. De adresidentiteit van tabelwaarden volgt nog.
   Meet daarna de gameplaypiek met de nieuwe boekhouding.
5. **Closures en captured-variable-cellen**, met de prototypes (O5).
6. **Strings**, samen met de byte-strings.
7. **Threads en frames.**
8. **GC-beheer, globalbanken en constantenpools in RAM** (O6). Daarna vervalt de
   graafcapture.
9. **Rewind** met dirty pages via de bestaande RAM-schrijfwatches.


## 13. Lua-compatibele byte-strings {#sec-proposal-byte-strings}

**Richting goedgekeurd; nog niet in de runtimes verwerkt.** Vervang het
codepoint-gebaseerde String-contract door Lua-byte-strings. De huidige
[String-referentie](book1/bios-string.md) beschrijft nog het bestaande gedrag;
alleen het invoerbereik van `string.char` wijzigen voltooit deze overgang niet.

Een String moet alle bytewaarden kunnen bewaren, inclusief nul en bytevolgorden
die geen geldige UTF-8 vormen. `string.char` bouwt bytes; lengte, `string.byte`,
substringposities en de overige String-bewerkingen volgen dezelfde byte-eenheid.
UTF-8-interpretatie is een afzonderlijke tekstbewerking, met functies zoals
`utf8.char`. De [Lua String-implementatie](https://github.com/lua/lua/blob/v5.4.8/lstrlib.c)
en [UTF-8-bibliotheek](https://github.com/lua/lua/blob/v5.4.8/lutf8lib.c) zijn de
referenties voor die scheiding.

Werk deze wijziging samen uit in literals en compiler, BIOS, TS/C++-waarden en
String-bewerkingen, ROM-/save-state-codecs en de tekstconsumenten in cartridges
en tooling. Ook vergelijking, hashing en tabelsleutels moeten dezelfde bytes
blijven onderscheiden. Decodering voor weergave mag ongeldige bytevolgorden niet
stilzwijgend in de onderliggende gastwaarde vervangen. De concrete interne
opslag volgt uit die gedeelde semantiek, niet uit de tekstrepresentatie van één
host. Oude program images en saves hoeven niet compatibel te blijven.

## Bijlage: bewaarde ontwerpstudies

De volgende onderzochte uitvoeringen en berekeningen zijn geen vastgestelde
productspecificaties. Zij blijven beschikbaar voor de latere fysieke uitwerking.

### Takbeveiliging: onderzochte kandidaat {#sec-proposal-branch-protection}

De volgende bewaarde analyse beschrijft een niet-gemonteerde kandidaat,
geen vastgestelde productregel of beschikbare beveiliging.


A distribution revision can place one current-limited switch in each supply
path: one on each voltage to each cartridge socket, one on each of the two
J300 supplies, and one on the J301 supply. This gives seven separately sensed
branches. The J300 switches would protect their harness conductors but still
feed four common pad-port supplies on the front board. Individual pad-port
isolation would require separate front-board branches. None of these switches
is fitted in the present board.

For a coherent fault response, the proposed revision reports a sustained
branch fault to a common latch on the control supply VCTRL3V3 that inhibits
both main converters through an enable-logic stage. U64 has a push-pull output;
the latch must not be wired directly against it. The existing rail supervisor
then asserts reset as its
monitored rails fall; an immediate or simultaneous reset is not implied. The
control supply holds the fault after the switched rails fall. Disconnecting
the adapter clears the latch after the supply has discharged; the fault must
be corrected before reconnecting. This avoids
claiming continued operation with only one rail of a cartridge or accessory
available. It is a proposed mainboard change, not behavior supplied by the
present circuit. The latch, detection and signal paths still need design;
the switch's delayed FAULT indication alone does not prevent transient
back-powering. In particular, the common latch must not assume that an
unpowered branch switch drives a valid FAULT level: input isolation and
power-on reset still need to be specified. The existing illustrative
combined-load calculation remains a scenario, not an adapter rating or
permitted per-port current.

The TPS2553-1 is a candidate latch-off switch for these 3.3 V and 5 V paths.
Its input operating range is 2.5–6.5 V. An external resistor sets its current
threshold. On a sustained overload it limits current and then latches off;
recovery requires the enable to be toggled or the supply cycled. The switch
also reports a fault, and has overtemperature and reverse-voltage protection.
Its fault indication and latch do not make the other voltage of a dual-supply
cartridge or accessory safe automatically. The design must specify the behavior
of both supplies and all connected signal pins during startup, branch faults,
and restart, including any current through signal protection structures.

The two cartridge sockets also share the 16 CAD lines and eight control
outputs. Each socket has its own select and five return signals. READY, IRQ
and PRESENT each have a 10 kΩ pull-up to the shared V3V3; the two DREQ lines
have pull-downs to ground. The common U51 transceiver cannot isolate only one
socket. Switching off a socket's supplies alone therefore does not isolate its
signal pins or the pull-ups, and the other supply may still be active. Ground
remains connected.

The keyboard's PS/2 clock and data also have 4.7 kΩ pull-ups R461 and R463
to the common V5 rail, through the Q300/Q301 level-shifting circuits. A
switch in the J301.3 supply lead alone would leave those pull-ups powered.
A branch revision could instead feed J301.3 and both 5 V pull-ups from the
same protected output, but the 3.3 V sides of the level shifters can still
provide a signal-pin current path. Such a revision is not fitted, and its
off-state behavior and branch limits remain to be established.

Book III does not promise hot insertion or continued operation of one socket
during a fault on the other. If selective socket shutdown is adopted, both
supplies and all signal and bias paths need a coordinated isolation design;
a common shutdown is another possibility. For example, a dual-supply
[SN74LVC16T245](https://www.ti.com/lit/ds/symlink/sn74lvc16t245.pdf) has
16 bidirectional lines and high-impedance ports when either supply is at
ground. It is not a complete socket isolator: control and return lines, rail
ramps, enables, bus timing and fault recovery require separate design. Neither
strategy is fitted by the present circuit.

The TPS2553-1's FAULT indication is deglitched for 5–10 ms for an
overcurrent condition. Its current limiter can already have reduced the
affected output voltage during that interval. Using FAULT alone to disable
shared signal drivers therefore does not establish protection against
back-powering before that indication. Signal isolation or fault sequencing
must be assessed with the actual rail and pin waveforms.

The following examples show why a resistor value cannot be selected from a
nominal load alone. They use the manufacturer's specified device limits at the
stated exact resistances, before resistor tolerance, wiring losses and system
temperature are included. They are not BMSX current ratings:

| Current-setting resistor | Specified current-limit interval | Consequence |
|---|---:|---|
| 49.9 kΩ | 0.475–0.565 A | A 0.50 A continuous load is not guaranteed below the minimum threshold. |
| 20 kΩ | 1.200–1.375 A | A 1.00 A load is below the minimum threshold in this device screen; the branch still needs a 1.375 A protection and thermal assessment. |

For the SOT-23 package, the specified on-resistance is at most 135 mΩ over
the specified junction-temperature range. At 1 A this corresponds to up to
135 mV switch drop and 135 mW switch dissipation, excluding the supply,
connectors and conductors. Startup charging current, temporary short-circuit
peaks, the remaining voltage at each load and the heat flow through the actual
board must also be evaluated. The allowable loads and startup behavior of the
cards and accessories must be defined before assigning settings or selecting
the switch. See the [TPS2552/TPS2553 data sheet](https://www.ti.com/lit/ds/symlink/tps2553.pdf).

### Kabelbevestiging: onderzochte kandidaat

One uninstalled L-bracket proposal uses a rear frame mounting position and a
short sideways offset in the straight part of the receiving trunk. Its nominal
gap to an inserted cartridge is 2.0 mm in the nominal model, before tolerances. The
full fastener, tie passage, individual wire bends, mounting loads and cover
removal have not been qualified; this bracket is not part of the current
assembled design.

### Voedingsrail: bewaarde belastings- en foutanalyses

#### Inductor current and heating

The selected inductors are L1 IHLP3232DZER2R2M11 and L2
IHLP3232DZER3R3M11. For continuous conduction, their current ripple depends
on input and output voltage, inductance and switching frequency. At 9 V input,
6 A output, the calculated rail setpoints and a 500 kHz switching assumption,
the triangular-current estimate is:

| Rail | Inductance used | Ripple, peak-to-peak | Peak current | RMS current |
|---|---:|---:|---:|---:|
| V3V3 | 2.2 µH | 1.904 A | 6.952 A | 6.025 A |
| V3V3 | 1.76 µH | 2.380 A | 7.190 A | 6.039 A |
| V5 | 3.3 µH | 1.347 A | 6.674 A | 6.013 A |
| V5 | 2.64 µH | 1.684 A | 6.842 A | 6.020 A |

The lower inductance values illustrate the manufacturer's −20% no-load
100 kHz tolerance as a sensitivity; they are not guaranteed inductance at
working current. The assumed switching frequency is not a guaranteed frequency
limit. Each rail is considered separately: the shared input does not guarantee
that both can deliver 6 A simultaneously.

Vishay specifies, at 25°C, typical currents of 10.2 A for a 20% inductance
decrease and 14.5 A for an approximately 40°C temperature rise for L1. For L2
the corresponding typical currents are 9.7 A and 10.5 A. These are typical DC
characteristics, not worst-case operating limits or proof of adequate cooling.
Using the calculated RMS currents with the maximum 25°C DC resistances gives
approximately 0.34 W in L1 and 0.54 W in L2 in this example. These figures omit
increased winding resistance at operating temperature and AC/core losses.

The converter limits **valley** current; its specified interval is 6.3–8.6 A,
not a limit on the current peak. As a sensitivity only, adding the nominal-L
ripple above to an 8.6 A valley gives peaks of approximately 10.50 A in L1
and 9.95 A in L2. These exceed the respective typical 20%-inductance-reduction
currents. The estimate neither predicts the actual protection waveform nor
proves a fault: inductance, ripple, switching and temperature change during
overcurrent. Check current limiting, hot inductance and temperatures on the
assembled design. Measure the inductor part temperature and keep it within the
manufacturer's stated limit. See the [IHLP-3232DZ-11 data sheet](https://www.vishay.com/docs/34313/ihlp3232dz-11.pdf).

For an alternative with greater typical current before inductance falls, Vishay
lists IHLP3232DZER2R2M01 and IHLP3232DZER3R3M01 in its high-saturation series.
These use the same stated nominal inductances and 3232DZ body and recommended
pad geometry. Their 25°C typical currents for a 20% inductance decrease are
23 A and 20 A respectively, but their maximum 25°C DC resistances are higher:
13.7 mΩ and 17.7 mΩ. At the example currents above, the estimated winding
losses become approximately 0.50 W and 0.64 W, compared with 0.34 W and
0.54 W for the fitted parts. The −01 figures are typical characteristics, not
guaranteed fault-current limits; increased winding resistance, core losses,
loaded inductance and heat must also be considered. The fitted −11 parts remain
the reference until supplier, control-loop, overcurrent, mounting and assembled
thermal performance of an alternative are verified. [IHLP-3232DZ-01 data sheet](https://www.vishay.com/docs/34316/ihlp-3232dz-01.pdf).

#### Reference and divider error

The converter's 0.591–0.609 V feedback interval is specified at a 5 V output,
continuous mode and −40°C to +150°C junction temperature. Applying it to the
fitted divider ratios and their 0.1% initial resistor tolerances gives this
reference-error calculation:

| Rail | Calculated low | Calculated high |
|---|---:|---:|
| V3V3 | 3.2629 V | 3.3733 V |
| V5 | 4.9085 V | 5.0758 V |

This is not a full rail-voltage guarantee. In particular, using the reference
interval for the V3V3 divider does not independently qualify its 3.3 V operating
point. Resistor temperature drift, feedback bias, regulation, ripple and
distribution losses are not included. Compare measured pin voltages, rather
than these divider calculations alone, with each receiving device's limits.

#### Capacitor loading

The fitted capacitors directly between V3V3 and ground total 100.33 µF nominal.
Counting every capacitor with a terminal on V3V3 gives 100.43 µF, but that
includes C523, 0.1 µF between V3V3 and VDAC_COMP. That compensation connection
is not another grounded decoupling capacitor. The capacitors directly between
V5 and ground total 55.3 µF nominal.

These are nominal component-value sums, not effective output capacitance.
DC bias, tolerance, temperature and ESR, together with attached cartridge and
peripheral capacitance, remain to be established for the connected load.
The converter's recommended 20–100 µF effective output-capacitance range is not
an absolute rating; comparing a nominal sum with it does not establish
control-loop stability or instability.

For a net current deficit, before additional converter current arrives,
the ideal capacitor contribution is

\[
\Delta V=\frac{\Delta I\,\Delta t}{C_{\mathrm{eff}}}.
\]

A diagnostic 1 A deficit for 10 µs gives 0.0997 V on V3V3 and 0.1808 V on V5
using the nominal sums; halving effective capacitance doubles those values.
These are sensitivities, not assigned ASIC loads, permitted ripple or predicted
converter response. ESR, ESL and wiring add separate voltage changes.

#### Shared input loading

The two converters share the protected input. Their individual 6 A component
ratings do not guarantee simultaneous 6 A operation on both rails. At the
nominal rail setpoints, that combination would deliver 49.86 W.

For a reference calculation, take 9 V at RAW9 and 3.960 A, the protected-switch
minimum breaker threshold at the published 750 Ω test point. Let η represent
aggregate RAW9-to-main-rail efficiency, including input-path, control-supply
and converter consumption. The conditional sharing boundary is

\[
3.318\,I_{3V3}+4.992\,I_5
\leq \eta\,(9.0)(3.960)\ \mathrm{W},
\]

with currents expressed in amperes. At \(I_{3V3}=6\ \mathrm{A}\), the remaining
5 V current at that boundary is:

| Aggregate efficiency scenario, η | I5 at the sharing boundary |
|---|---:|
| 0.80 | 1.724 A |
| 0.85 | 2.081 A |
| 0.90 | 2.438 A |
| 0.95 | 2.794 A |

These efficiencies are sensitivity scenarios, not measurements or guaranteed
ratings. The 750 Ω device test point does not include the fitted programming
resistor's tolerance. Actual ASIC and attached-load consumption, adapter and
cable performance, converter response and closed-case temperatures still
require qualification; the calculation establishes no continuous console load
rating. Converter and protected-switch limits are given in the
[TPS56637](https://www.ti.com/lit/ds/symlink/tps56637.pdf) and
[TPS25947](https://www.ti.com/lit/ds/symlink/tps25947.pdf) data sheets.

The fuse is a separate consideration from U62's breaker threshold. For the
same 9 V input and efficiency scenarios, substituting F60's 3.75 A
continuous-design reference at 25°C gives 33.75 W before losses, or
\(\eta\,33.75\ \mathrm{W}\) at the two main rails. At
\(I_{3V3}=6\ \mathrm{A}\), the corresponding 5 V currents are:

| Aggregate efficiency scenario, η | I5 at the fuse design reference |
|---|---:|
| 0.80 | 1.421 A |
| 0.85 | 1.759 A |
| 0.90 | 2.097 A |
| 0.95 | 2.435 A |

This comparison illustrates the 25°C fuse-selection reference; it does not
replace the U62 table or guarantee operation at any of these combinations.
Additional fuse temperature rerating, actual efficiencies, sustained and
transient loads, adapter capability and conductor temperatures remain relevant.

#### Connected-console planning example

The following is one **illustrative simultaneous load**, not an allowance for
any port or a measurement of a BMSX. It gives the physical design a concrete
load to consider without assuming that the two converter ratings can be added.

| Assumed load | 3.3 V current | 5 V current |
|---|---:|---:|
| Internal console | 3.00 A | 0.30 A |
| Each of two cartridges | 0.25 A | 0.10 A |
| Each of four pads | 0.05 A | 0.10 A |
| Keyboard | — | 0.10 A |
| **Total** | **3.70 A** | **1.00 A** |

At the nominal 3.318 V and 4.992 V setpoints this is 17.27 W at the two
rails. With 80% assumed aggregate efficiency it corresponds to about 21.59 W,
or 2.40 A at a nominal 9 V input. This arithmetic is below the preceding
25°C fuse-design reference, but does not establish an electrical or thermal
rating. In particular, the internal consumption, cartridge and accessory
currents, converter efficiency and transient loads are assumptions. Cartridge
power can be dissipated near the slots and inside the enclosure; the pads and
keyboard dissipate their power outside it.
The actual circuit has no separate port current limits. This example neither
sets such limits nor guarantees that the components, wiring or passive cooler
can sustain the load. The 9 V / 4.45 A adapter family discussed in the retained
adapter screen is a possible supply starting point, not a fitted or validated
adapter; its standard plug is not the selected locking plug.

### Private geheugenbanken: onderzochte belasting

Sinds de keuze voor [de taalheap in hoofd-RAM](#sec-proposal-language-heap)
is een private bank geen referentiekandidaat meer voor de taaltoestand. De
studie blijft bewaard.

An additional private bank of 4 MiB is one investigated option, not a fitted
component or a requirement. It would add two memory devices and separate bank
selection and output-enable signals, as well as loading and power demand. A
larger option with two private banks totalling 8 MiB has also been studied.
Neither proves that every
program under the existing logical contract fits. The existing PCB, main-memory
map and component list have not been changed to install either option.

#### Candidate private-memory load

The currently fitted main-memory bank has two IS41LV16100-50 devices. Adding
one private 4 MiB bank would add two more; it is an option, not a fitted part
of the design. ISSI specifies a maximum average supply current of 160 mA per
device for its -50 random-access and CBR tests at minimum cycle time, with
outputs open. The following sums use those test figures and the nominal
3.318 V converter setpoint, not measured console consumption:

| Organisation | Devices | Sum of specified test currents | Corresponding arithmetic power |
|---|---:|---:|---:|
| Fitted public bank only | 2 | 0.32 A | 1.06 W |
| Public plus one candidate private bank | 4 | 0.64 A | 2.12 W |
| Public plus two candidate private banks | 6 | 0.96 A | 3.19 W |

The two-bank controller candidate accesses one bank at a time and refreshes
both together; actual device duty and output loading are not the data-sheet
test conditions. These sums are neither instantaneous peak currents nor
system thermal measurements. They exclude CORE drivers, converters, other
parts and external loads, and do not demonstrate available regulator or
cooling margin. The [ISSI data sheet](https://www.mouser.com/catalog/specsheets/issi_IS41C16100.pdf#page=6)
also makes clear that the currents depend on cycle rate.


### Native programmageheugen: onderzochte kandidaat {#sec-proposal-native-program-storage}

De volgende Engelstalige constructienotitie bewaart de onderzochte optie; het
is geen vastgesteld onderdeel of prestatiegarantie.

If CORE uses a native interpreter, it needs a native program store as well as
the runtime data store. On reset, the native execution block starts that
interpreter; it establishes the BLua32 execution state and reads the installed
BLua32 BIOS image through U7. The interpreter maintains the guest instruction
position, values and exception/interrupt state while the surrounding engines
continue to operate. Native execution addresses and guest addresses are
distinct.

The native program store is not allocated in the present schematic. It may be
internal to CORE or supplied by a private access path to shared or separate
storage. Its size, implementation and internal native boot sequence remain to
be selected; the guest-visible BLua32 reset and startup sequence remains as
defined in Book II. The U33 image and
its zero-filled remainder are guest-visible system ROM, so replacing bytes in
that remainder with native interpreter code would change guest reads. A private
code path cannot be inferred from the existing U33 connection; a shared physical
flash would require private access and guest-side zero masking. This software
execution option does not establish the performance or event timing of the
published BLua32 instruction model.

One external-store candidate adds a second x16 flash device alongside U33.
Both devices share the address and data conductors and use separate active-low
chip selects; their output enables are held low and their write enables remain
inactive. U7 terminal 120 selects the guest ROM and terminal 119, currently
used for U33 output enable, selects the private code device. The U7 control
logic must release one device before selecting the other. Its native-code
request is distinct from a guest system-ROM read; only the native execution
owner may issue that request. Normal guest accesses retain the existing U33
image, zero tail and fault behavior.

This arrangement is a proposed board and U7 revision, not a fitted second
flash. Device placement, extra loading, reset and boot sequencing, source
isolation and timing remain to be established. In particular, the native CPU
implementation and any instruction cache are not selected; sharing this
70 ns flash path does not establish that an interpreter meets the published
BLua32 instruction costs.

![Proposed shared-bus guest and native program stores.](book4/figures/native-program-store.svg){#fig-core-native-program-store}

### Runtimecapaciteit en onderzochte belasting {#sec-proposal-runtime-capacity}

De metingen hieronder blijven bruikbaar. De private DRAM-bank en de verdeling
van haar pool zijn sinds [de taalheap in hoofd-RAM](#sec-proposal-language-heap)
geen referentiekandidaat meer: de taaltoestand staat in het publieke RAM.

Een gerichte inventaris van bestaande beeldbestanden helpt de keuze afwegen,
maar meet geen draaiende programma's. De onderzochte BIOS met `nemesis_s.rom`
heeft samen 814 gewone en 108 systeem-globals, en 4.435 unieke naam- en
constantstrings. Met `pietious.debug.rom` zijn er 4.984 unieke strings. Een
grens van 4.096 voor *alle* stringidentiteiten zou die laatste combinatie dus
niet dekken; eenzelfde getal voor alleen globals is een andere grens. De
inventaris, beeldhashes en het reproduceerbare hulpmiddel horen bij de
engineering-oplevering. Live heap, tijdelijke pieken, diepe frames en behoud
van compatibiliteit zijn hiermee niet vastgesteld.

Als eerste uitvoeringstoets zijn daarnaast BIOS met `nemesis_s.rom` en BIOS
met `starcatch.debug.rom` elk 120 beeldgrenzen zonder invoer door de bestaande
headless runtime uitgevoerd. De hoogste op die grenzen waargenomen huidige
heapcharges waren respectievelijk 1.467.098 en 984.617 bytes; beide cartridges
waren tijdens de steekproef actief. Dit zijn softwarecharges, geen fysieke
byteaantallen en geen maxima tijdens gameplay of tussen beeldgrenzen. Met name
globals, niet-gechargeerde metadata, tijdelijke groei en GC moeten voor de
nieuwe totale begroting nog apart worden meegerekend.

Een aanvullende observatie na iedere succesvolle reservering in dezelfde
120 beeldperioden vindt hogere logische charges: 1.478.842 bytes voor Nemesis
en 1.048.400 bytes voor Starcatch. Ook deze proef gebruikt geen controllerinvoer
en meet geen fysieke opslag; wijzigingen buiten `reserve` en pieken binnen
collectie zijn niet afzonderlijk bemonsterd. Het blijft een beperkte
opstartsteekproef, geen garantie voor gameplay of voor een bepaalde poolgrootte.

Eén mogelijke fysieke inrichting is een extra private DRAM-bank van 4 MiB
naast de ongewijzigde 4 MiB publieke RAM. Dit is een constructiekandidaat,
geen reeds vastgestelde totale capaciteit of bewijs dat alle onderzochte games
passen. De exacte OOM- en opstartregels moeten nog worden uitgewerkt.
Deze bank is ook de [werkende referentiekandidaat](book4/hardware.md#sec-core-private-memory)
voor de native processor, niet een al aangebrachte printwijziging.
De bestaande CORE-geheugenroute is inmiddels als twee-bankenkandidaat
uitgebreid: een interne CPU/VM-tag kiest de private bank en publieke CPU-,
DMA- en GEO-adressen blijven op de publieke bank. De kandidaat gebruikt nu per
bank een aparte output-enable. Een aangepast geheugenmodel laat oude EDO-data
bij lage CAS behouden; een proef met opzettelijk gedeelde output-enable toont
buscontensie, terwijl de aparte aansturing in de gerichte simulatie slaagt.
Dit is geen fysieke signaalintegriteits- of volledige timingkwalificatie. De
echte VM-allocator en tagbron, extra chips en printverbindingen zijn nog niet
gerealiseerd.
Voor een latere print-ECO zijn de nu onverbonden U1-aansluitingen 50 en 101
onderzocht als respectievelijk private RAS en output-enable. Dit is geen
toegewezen pinout; plaatsing en elektrische belasting zijn niet gekwalificeerd.

Voor die kandidaat wordt de fysieke pool één keer verdeeld over disjuncte
blokken: waardeslots, globals en naamindices, dynamische objecten en strings,
frames en continuations, beeldidentiteiten, allocatormetadata, handle- en
hashstructuren en werkruimte voor collectie en herstructurering. De fysieke
grootte van ieder blok omvat ook zijn headers en uitlijning; wanneer bij groei
oud en nieuw tegelijk bestaan tellen beide mee zolang zij bestaan. Vaste,
afzonderlijk benoemde CPU-registers hoeven geen poolruimte te gebruiken.
Systeem- en cartridgecontexten delen de pool en blijven beide bereikbaar
volgens hun bestaande levensduurregels. De bestaande runtime probeert bij
ontoereikende capaciteit eerst collectie en meldt daarna, als de aanvraag nog
steeds niet past, een Lua-geheugenfout; als die niet wordt afgehandeld volgt
de bestaande `OUT_OF_MEMORY`-trap. Behoud die foutweg als uitgangspunt voor
het nieuwe budget, zonder te suggereren dat eerdere effecten worden teruggedraaid.
De precieze capaciteit en het gedrag wanneer al tijdens reset of beeldactivatie
onvoldoende ruimte beschikbaar is, vereisen nog een concreet contract. Met name
zijn het geheugen voor gelijktijdig aanwezige oude en nieuwe beeldtoestand en
een uitvoerbare opstartfoutmelding nog niet aangetoond.

Bij een [niet-verplaatsende pool](book4/hardware.md#sec-runtime-pool-and-collection)
kan een grote aanvraag
falen door versnippering, ook als het totaal aan vrije bytes groter is dan de
aanvraag. Een productspecificatie moet daarom méér vastleggen dan alleen een
aantal bytes: de zichtbare allocatie- en foutregels, de uitvoering van een
geheugenfout bij beschermde aanroepen en coroutines, en het gedrag bij een
tekort tijdens opstarten of beeldwissel moeten uitvoerbaar zijn. De bestaande
functie- en collectieregels voor zwakke tabellen blijven uitgangspunt; ook de
gevolgen van collectorwerk voor tijd en interrupts zijn nog niet vastgesteld.
Dit is een onderzoekskandidaat, geen keuze om automatisch eerder fouten te
geven of de huidige foutafhandeling te wijzigen.

Ter illustratie van de nieuwe telling: de `nemesis_s`-momentopname bevatte
7.080 tabellen, 5.096 arrayplaatsen en 30.853 hashplaatsen. Een voorbeeld-
organisatie met 48 bytes per tabeldescriptor, 8 bytes per arrayplaats en
20 bytes per hashplaats vraagt hiervoor samen **997.668 bytes**, exclusief
blokheaders, globals, andere objecten, strings, frames, handles en tijdelijke
groei. De 48-byte descriptor is een ontwerpaanname, geen meting van het
uiteindelijke silicium. Dit voorbeeld bewijst niet dat de 4-MiB-pool volstaat.

### Frame-start reservation for APPLY

An output APPLY can arrive while the pad sequencer is transmitting its current
frame or observing the minimum SELECT-high gap. Holding SYS DATA throughout
that interval would also prevent the APU from fetching ROM. CORE therefore
reserves the next frame-start opportunity before presenting an untimed APPLY.

| HEADER BE_N | Transport operation | DATA result |
|---|---|---|
| `FH` | Ordinary access | Register or memory data |
| `EH` | Reserve/query the next pad frame | Conservative number of system clocks until ready; zero means ready is held |
| `DH` | Cancel the frame reservation | Zero |

Reserve/query and cancel are complete, aligned, full-word reads of
`0800011CH`, the OUTPUT_CTRL address. They do not execute its architectural
read or write operation. An invalid reserve/cancel form or unsupported HEADER
operation at the selected INPUT endpoint returns UNMAPPED without changing an
INPUT register. Their RESPONSE uses the same full 32-bit fault word as an
ordinary access.

On reserve/query DATA acceptance, U7 prevents the next automatic POLL from
starting. The active frame and its minimum high gap finish normally. A query
accepted at an already idle boundary holds that boundary too; an automatic
POLL cannot consume it on the same clock. A busy result includes a conservative
two-clock allowance beyond the sequencer's remaining-count value. The longest
reported interval is 77627 system clocks, about 2.292 ms.

CORE retains the original logical write, releases SYS and counts the returned
interval locally. It queries again after that deadline rather than repeatedly
polling the bus. Once the result is zero, the frame-start opportunity remains
reserved until the ordinary APPLY write, cancellation or hardware reset.
The actual APPLY is sent once with HEADER `FH`. Only its DATA acknowledgement
captures PORT, intensity and duration and starts the frame. Neither query nor
reservation freezes those operands or queues an output command.

The query and cancellation packets each use a 16-clock DATA allowance. A
failed query is followed by one explicit cancellation packet before the
logical request completes with its fault or timeout. Cancellation is release
of an uncommitted frame reservation, not retry or rollback of an accepted
write. If cancellation also fails, release of the reservation is not assured;
hardware reset clears it. A timed diagnostic APPLY bypasses reservation and
uses its direct DATA deadline. The pad framing and minimum interframe gap are
unchanged in either case.


### DC-leiding: onderzochte uitvoering

For the selected 0.50 mm² wire, measure the insulation diameter and choose the
corresponding production process:

| Measured insulation diameter | Contact and tool | Strip length | Conductor crimp height | Minimum pull force |
|---|---|---:|---:|---:|
| 2.10–2.30 mm | 39-00-0039 loose, 63819-0900 hand tool, 20–24 AWG profile | 3.00–3.30 mm | 0.83–0.93 mm, reference | 58.7 N |
| Over 2.30–2.50 mm | 39-00-0038 reel, 63902-4900 applicator in a compatible press | 3.00–3.50 mm | 0.95–1.04 mm, guideline | 58.7 N |

The tool's insulation-diameter ranges are manufacturer recommendations for
crimp selection, not proof of an accepted assembly. Inspect and qualify both
conductor and insulation crimps, perform the pull test without insulation-grip
contribution, and verify retention. Leave each wire relaxed behind its contact
so the contact can float in its cavity. The
[housing drawing](https://www.molex.com/content/dam/molex/molex-dot-com/products/automated/en-us/salesdrawingpdf/555/5557/039012025_sd.pdf),
[hand-tool specification](https://www.molex.com/content/dam/molex/molex-dot-com/products/automated/en-us/applicationtoolingspecificationpdf/638/63819/ATS-638190900-001.pdf)
and [applicator specification](https://www.molex.com/content/dam/molex/molex-dot-com/products/automated/en-us/applicationtoolingspecificationpdf/639/63902/ATS-639024900-001.pdf)
give the mating, tooling and inspection conditions.

One checked DC lead arrangement uses LAPP H05V-K 0.50 mm² stranded PVC wire:
article 4510041, red, for RAW9 and
4510011, black, for its return. The specified insulation diameter is
2.10–2.50 mm. Fixed-installation bends require at least four wire diameters:
use a minimum 10 mm radius for the installed route at the maximum diameter.
The smaller allowance for careful bending is not the installed-route limit.
Form the two leads separately in their supports without loading the contacts.
The [LAPP product data](https://products.lappgroup.com/online-catalogue/power-and-control-cables/control-cabinet-single-cores/various-applications/h05v-k.html)
give the dimensional and installation conditions.

For this LAPP wire, install at 5°C or above and keep its conductor within the specified
fixed-installation range, −40°C to +70°C. The bare-copper class-5 conductor's
maximum resistance is 39 Ω/km at 20°C, according to
[LAPP's conductor table](https://camunacavi.lappgroup.com/fileadmin/DAM/Lapp_Camunacavi/catalog_pages_1_17/T11_Conductor_resistances_and_strand_structure.pdf).
Calculate loom drop and heating from the actual cut lengths and operating
current. These wire properties do not assign a new continuous console-current
rating.

The corresponding two proposed free-lead routes use tilted spatial loops with no centreline radius
below 10 mm. This keeps the lower supply lead clear of the neighbouring
header instead of forcing it along the board at pin height. The nominal
contact axes are Z14.9 for J61.1 and Z19.1 for J61.2, separated by 4.2 mm.
The drawing's complete-mated height is a roof dimension, not a wire axis.

![DC free-lead centreline projections, selected wire and R10 service loops.](book4/figures/dc-harness-routing.svg){#fig-dc-harness-routing}

For the nominal seated mate, X67.475 is the rear plane of the cable housing.
It is derived from the [Molex header drawing](https://www.molex.com/content/dam/molex/molex-dot-com/products/automated/en-us/salesdrawingpdf/556/5569/039300020_sd.pdf):
the header back at X43.975 and the 23.50 mm reference length from that face
to the cable-housing rear. The drawing gives a 13.80 mm reference mated height
above the PCB, or Z25.4 on the mainboard. These are nominal reference dimensions,
not guaranteed tolerance limits or dimensions of the crimp and wire insulation.
The [two-contact housing drawing](https://datasheet.octopart.com/39-01-2060-Molex-datasheet-14711155.pdf)
also gives a nominal 19.6 mm housing length and 5.4 mm width. Together with the
13.8 mm mated-height reference, these nominal dimensions fit the reserved J61
assembly space. This comparison is not a complete housing profile or tolerance
stack; verify the actual connector and lead clearance during assembly.
Confirm the fitted mate and relaxed lead dressing before fixing the loom's cut
lengths. The modelled free
leads are 71.03 mm and 64.96 mm between their stated reference points. Contact
engagement, jack termination, insulation and final assembly slack are separate
cut-length allowances. Insulating abrasion sleeves protect the passages through
the G10 carrier; they are not adhesive pull-load anchors.
