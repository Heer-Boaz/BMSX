# Openstaande architectuur-slices

Dit bestand is alleen de werkvoorraad. Afgeronde hardwarecontracten horen in
[`architecture.md`](architecture.md); testuitslagen en implementatiegeschiedenis
horen niet in deze lijst.

## Doorlopende performance-audit

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `PERF-RUNTIME-01` | Kies per iteratie één gemeten hot-pathowner en verwijder daar herhaalde decode, conversie, validatie, allocatie of dispatch bij de producer. Dit is een paraplu, geen enkele megaslice. | Analyzers blokkeren nieuwe overtredingen, parity blijft exact en representatieve low-end hardware houdt 50 Hz zonder oplopende backlog. |

## Na de lopende cartlib-slices

| ID | Geobserveerd probleem | Klaar wanneer |
| --- | --- | --- |
| `NEMESIS-DEATH-01` | Player death tijdens vuur met twee options fault in `player.get_vessel_snapshot()` via `update_laser()`. | De normale laser bewaart zijn concrete source-vessel zolang hij expandeert en wordt daarna zelfstandig; een verwijderde option bevriest op zijn laatste positie. De death-boundary verwijdert geen afgevuurde projectielen en de weapon-hot-path bevat geen nil-guard of registrylookup. |
| `NEMESIS-PROJECTILE-01` | Projectielen van een ZakFoe worden nu samen met hun afzender verwijderd, terwijl vergelijkbare vijandprojectielen in Nemesis 2 na vernietiging van de afzender blijven doorvliegen. | ZakFoe bezit alleen spawnadmission. Een afgevuurd projectiel heeft een zelfstandige lifecycle en verdwijnt uitsluitend door zijn eigen impact-, bereik-, room- of disposalgrens. |
| `HOST-INPUT-01` | De terminal sluit niet meer via zijn shortcut; terminal- en IDE-chords lekken `Backspace`/`x` naar de geopende editor en `Backspace` werkt niet meer als gewone terminalinvoer. | Host-controlchords en guest text-input hebben afzonderlijke ownership; press en release worden eenmaal geconsumeerd, toggles werken beide richtingen en gewone editor-/terminaltoetsen blijven intact. De mapping is bruikbaar op een SNES Mini zonder L2/R2. |
| `NEMESIS-PRESENTATION-01` | Story-panelen en title/ship/burst lopen sneller dan Nemesis 2; de geselecteerde een-/tweespeleroptie knippert niet. De cart gebruikt daarnaast nog een update per twee VBlanks. Een te toetsen hypothese is 60 Hz met drie VBlank-waits; dit is nog geen gekozen contract. De intro hoeft zijn milliseconde-timing niet te verliezen, maar voor de overige MSX-presentatie mag de huidige milliseconde-authoring worden vervangen door de oorspronkelijke VBlank-cadence als de ROM dat contract aantoont. | Gameplaypacing, intro-timing en oorspronkelijke MSX-presentatiecadence zijn afzonderlijk gemodelleerd. Story-panelen volgen voor de behouden panelwissels de ROM-timing; title, ship, burst en selection blink volgen de ROM zonder globale rate-hack. Daarna is expliciet vastgesteld of de dubbele-VBlank-gameplayclock nog een machinecontract vervult. |

## Vereist een interactieve backend of fysieke target

| ID | Nog te bewijzen | Vereist |
| --- | --- | --- |
| `HOST-GX-LIVE-01` | IDE, quick menu, F2-terminal, `bare_metal_cart` en `2025` tonen stabiele opeenvolgende frames met correcte input, glyphs en terminalcellen, zonder flashes, zwart beeld of halve commandstreams. | WebGL2 en WebGPU; de terminal ook op GLES2. |
| `GX-READ-01` | GPUREAD wrap, padding, fences, DREQ en zichtbare VRAM-inhoud komen live overeen met de softwarevectoren. | WebGL2, GLES2 en WebGPU. |
| `GX-RASTER-01` | Polygonen, lijnen, clipping, textures, CLUT, mask, blend, dither en stores komen live exact overeen met software en GPUREAD. | WebGL2, GLES2 en WebGPU. |
| `HOST-SUPERVISOR-01` | Select+L opent en sluit de terminal exact eenmaal zonder gameplayinput te lekken. | Echte SNES Mini. |
| `PERF-03` | De op de echte target geselecteerde ARM-fetch-, NV-barrier- of dependency-copyroute rendert exact en houdt 50 Hz zonder backlog. | Windows RetroArch en echte SNES Mini. |
| `PERF-04` | De 16k audio-/presentatiesoak houdt 50 Hz zonder sampleverlies, backlog of periodieke hitch. | Zichtbare frontend en daarna SNES Mini. |
| `SNES-ABI-01` | De tegen de actuele target-root gebouwde core en direct host starten zonder ABI- of loaderfouten. | Actuele SNES Mini-rootdump en hardware. |

## Geparkeerd

| ID | Hervatten wanneer |
| --- | --- |
| `GX-REVISION-OWNER-01` | Meerdere gelijktijdige machines of een behouden backend over machinevervanging een concrete revision-collision kan observeren. |
| `GX-SW-01` | Een profiel op representatieve low-end ARM-hardware een concrete software-rasterizerhotspot aanwijst. |
| `BIOS-TERM-EXT-01` | Er een concrete behoefte is en de command-, call/return- en terminal-output-ABI voor een door firmware geselecteerde developer-cartridge is ontworpen. |

### `GX-CART-LAYOUT-01` — filename-driven cartridge-VRAM-layout

De huidige producergrens blijft voorlopig behouden. Een imagebestand bepaalt met
`@atlas=N` zijn atlaslidmaatschap; de rompacker verwijdert dit suffix uit het
uiteindelijke `imgid`, bouwt de atlas en genereert de fysieke bindings.
Gameplay gebruikt uitsluitend `imgid` en logische sourceregio's. Een
cart-authored fysieke layout aan de ROM-buildgrens is daarmee niet hetzelfde als
fysieke VRAM-coordinaten die naar gameplaycode lekken: zij vervult de rol van
een linker-layout voor beperkt consolegeheugen.

Een vervanging door YAML-lijsten met assets, streams, capacities of semantische
working sets is expliciet verworpen. Die aanpak dupliceert informatie die de
filename-driven importer al bezit en maakt de cartridgeproducer omslachtiger.
Een toekomstige slice moet daarom het bestaande contract veld voor veld
classificeren en alleen verkeerd eigendom of echte duplicatie verwijderen:

- atlaslidmaatschap blijft filename-owned;
- concrete atlasinhoud en afmetingen worden door rompacker en atlasbuilder
  afgeleid;
- de system-VRAM-reservering en GX-alignment zijn machine/tooling-owned en horen
  niet per cartridge te worden herhaald;
- bewuste framebufferplaatsing, slot-aliasing en gelijktijdige residency mogen
  cart-ROM-layoutbeslissingen blijven;
- runtime-uploadmomenten blijven gameplay-owned;
- `gx_texture.upload(imgid)`, logische sourceregio's, `upload_raw` en directe
  raw-GX-programmering blijven beschikbaar.

Verboden oplossingsrichtingen voor deze slice zijn een runtime-VRAM-allocator,
per-frame residencygraphs of stringmatching, een `GameView`, dubbele
filename/YAML-assetregistratie, een legacy-dual-path en readinessguards rond
IMGDEC. Uploadadmission mag de vooraf berekende bestemming publiceren voordat
IMGDEC gereed is; tijdelijk ongeinitialiseerde VRAM is bedoeld hardwaregedrag.

Hervatten wanneer de huidige fysieke layout opnieuw concreet producerwerk
dupliceert of een nieuwe cartridge niet zonder handmatige coordinaten kan worden
gepakt. Begin dan met een live inventaris van `framebuffers`, `reserved`,
`slots`, `groups` en `working_sets`; behoud ieder veld dat een bewuste
cartridge-linkbeslissing vertegenwoordigt.
