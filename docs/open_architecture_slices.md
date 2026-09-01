# Openstaande architectuur-slices

Dit bestand is alleen de werkvoorraad. Afgeronde hardwarecontracten horen in
[`architecture.md`](architecture.md); testuitslagen en implementatiegeschiedenis
horen niet in deze lijst.

## Overnamepunt

Begin een nieuwe slice altijd met `git status --short --branch`, de recente
`git log` en de live owners. Deze lijst is een werkhypothese, geen toestemming
om een beschreven oplossing mechanisch te bouwen.

De huidige inputgrenzen zijn:

- ICU bezit uitsluitend de rauwe keyboard-, pointer-, pad- en outputregisters.
  Action maps, repeats, consumptie, shortcuts en device-assignment horen daar
  niet in;
- de browserhost bezit fysieke devices en expliciete toewijzing aan player
  1--4. De onscreen gamepad neemt als gewoon device aan diezelfde toewijzing
  deel;
- de TypeScript-host bezit per playerport één retained controlremap. Quick menu
  en shortcuts blijven de onbewerkte genormaliseerde devicecontrols lezen;
  alleen het gepubliceerde ICU-padsnapshot gebruikt de remap;
- libretro ontvangt reeds genormaliseerde logische frontendports. Iedere
  geconfigureerde JOYPAD-port kan de quick menu, terminal en onscreen keyboard
  besturen; pad 0 heeft geen speciale overlayrol meer;
- het onscreen keyboard is een host-owned virtuele keyboardbron naast het
  fysieke keyboard. Het is geen ICU-feature en geen guest-eventinjector;
- de SNES Mini-build gebruikt GCC 10/C++17. BLua32-f64-woorden worden centraal
  little-endian gelezen en geschreven; targetcode mag niet opnieuw afhankelijk
  worden van C++20 `std::bit_cast`.

De verborgen hold-Start-assignmentflow is geen open herstelpunt. Browserdevices
worden zichtbaar via de quick menu toegewezen; bij libretro blijft fysieke
controller-naar-port-toewijzing eigendom van de frontend.

De huidige machine-, BIOS- en cartlibgrenzen zijn:

- de machine bezit cart-waarneembare woorden: CPU, RAM/ROM, MMIO, DMA, IRQ,
  GX/GP0/GP1, PCRTC, GTE/GTE+, GEO, ICU, APU en IMGDEC. Hostcode presenteert
  en embedt; zij is geen cart-API;
- `machine/bios` is de system-ROM. Na cartridge-handoff via `CP0.EXEC` is de
  cart de user-mode eigenaar van zijn eigen IRQ-vector. Maskable IRQs gaan naar
  het `irqFunctionAddress` van het actieve execution-image; synchrone faults en
  NMI blijven op het BIOS-`exception()`-adres en daarmee op de supervisor
  monitor;
- `cartlib` is first-party cart-ROM-engine, geen firmware. De rompacker bundelt
  `./cartlib` als cart-library root. BIOS-Lua doet geen `require('cartlib/...')`.
  Bare-metal carts mogen de engine weglaten en GP0/GP1/GTE/DMA/IRQ zelf
  programmeren;
- cartlib mag een volledige Unreal-/Godot-achtige runtime zijn: world, spaces,
  components, compiled tick-schedule, input-actions, FSM, behaviour trees,
  timelines, AEM en overlap-events. Dat is cart-middleware op MMIO, geen reden
  om gameplay in BIOS of in de host te tillen;
- ICU blijft het rauwe registerfile. Action maps, edges, consume en repeat
  blijven cartlib. Device-assignment blijft host;
- GEO `overlap2d_pass` is machinecommando. `cartlib/collision` staged descriptor-
  en instancerecords in RAM, wacht op `IRQ_GEO_DONE`/`IRQ_GEO_ERROR`, en mag
  daarna gameplay-events emitten. Die events zijn geen tweede collision-ABI;
- `cartlib/gx/vram.lua` consumeert de gepubliceerde BIOS-export
  `gpu/system_vram_region`. Carts krijgen geen BIOS-bronboom als linkercontext;
  zij mogen wel de vaste public function vector aanroepen;
- één cart heeft één world (`require('cartlib/world/world')`). Spaces zijn
  wederzijds uitsluitende world-partities, geen renderlayers en geen tweede
  machine;
- de machine heeft twee fysieke sockets (0 en 1), één cartridge-aperture en
  execution domains `-1 | 0 | 1`. Er is geen slot 2. Hosts kunnen slot 1 al
  admitten (`?slot1=`, `--slot1`, libretro `dualcart`); dat is media, geen
  Studio-product;
- de TypeScript-IDE is VS Code-chrome (`ide/editor`, `ide/workbench`,
  `ide/language`) plus Hot Resume. [`OverlayRenderer`](../ide/runtime/overlay_renderer.ts)
  en `LAYER_2D_IDE` tekenen na PCRTC-merge, quantize en CRT. Dat is host-UI,
  geen cart-waarneembare viewport;
- PCRTC circuit1/circuit2 mergen VRAM-rectangles in de beam, vóór host overlay.
  BIOS-monitor programmeert circuit2 al via `gx_gpu.prepare_supervisor`. Een
  Unreal-achtige viewport is die tweede scanout, niet de IDE-overlay;
- Hot Resume is IDE-only Live Coding van ingestoken images. Het is geen PIE,
  geen tweede world en geen tweede `Runtime`.

De huidige IDE- en debuggergrenzen zijn:

- de runtime source registry bezit de exacte Lua-bronnen die bij de geladen
  system- en cartridge-images horen. Gegenereerde modules, waaronder
  `bmsx/assets.lua`, zijn gewone geregistreerde source records;
- de semantische workspace resolveert navigatie vanuit lexicale declaraties,
  module-exports, teruggegeven module-instanties en statische Lua-class-
  inheritance. Zij verzint geen bron voor dynamische runtimewaarden;
- dynamische membernavigatie gebruikt per immutable programmasnapshot één lazy,
  monotone demand-graph boven de behouden semantische records per bestand. De
  workspace kopieert die records bij een edit niet eerst naar een tweede
  workspacebrede value-flowrepresentatie; identity- en demandindices ontstaan
  pas wanneer een query ze nodig heeft. Root- en memberindices vormen de
  directe selectielaag; volledige value-source-indices ontstaan pas wanneer
  alias- of dynamische callerresolutie ze daadwerkelijk vraagt. Exact gebonden
  calls en later bewezen dynamische calltargets worden daarna als gewone graph
  edges behouden voor volgende features op dezelfde snapshot. De binder
  behoudt de receiverprojectie van gewone Lua-methoden, zodat de identity-index
  een `self:`-call rechtstreeks tegen de gedeclareerde receiver kan binden
  voordat een demand-graph nodig is.
  Alleen gevraagde Lua-roots, calls, contexten en heap-effects worden
  gematerialiseerd; de taallaag kent geen cartlib-, firmware- of
  frameworktypen. Member-source- en effectvragen blijven monotone
  `(value, name)`-worklists: een nieuw bewezen graph-edge erft bestaande
  vragen eenmaal, in plaats van bij iedere query dezelfde bereikbare graph
  opnieuw af te lopen. Letterlijke table-keys behouden hun concrete
  value-identiteit. De keyvariabele van een numeric of generic `for` gebruikt
  daarentegen het generieke runtime-indexdomein: writes landen in de bestaande
  elementprojectie en reads omvatten zowel die projectie als concrete
  tablevelden. Dit is een Lua-taalregel en geen framework- of
  identifierheuristiek;
- Lua-instanties behouden prototype-inheritance en concrete allocation-sites
  als afzonderlijke graphrelaties. Een `setmetatable`-factory kan daardoor
  velden publiceren die tijdens constructie op de teruggegeven waarde worden
  geschreven, zonder die velden aan een siblingprototype toe te kennen. Een
  abstracte waarde behoudt iedere mogelijke prototypebasis als monotone edge;
  een later ontdekte basis overschrijft een eerdere basis niet en kan de
  fixed-pointsolver daardoor niet tussen twee geldige alternatieven laten
  oscilleren. Een memberquery gebruikt eerst retained en lexicale summaries,
  daarna de relevante allocation-site en pas bij een resterende miss
  contextuele heap-effects en hun callers. Parameters die een heap-effect
  doorgeven aan een volgende call vormen retained call summaries. De
  actual-naar-formalprojectie volgt ook functionwaarden die in een tableveld
  als callargument worden doorgegeven. Alleen een bewezen statische of tijdens
  de graphsolve geobserveerde calltarget mag zo'n aggregateveld aan de formele
  parameter koppelen; geobserveerde targets beperken latere dynamische
  alternatieven niet. De
  query-worklist bezoekt callers breadth-first en materialiseert hun
  contextkandidaten afzonderlijk; zij stopt zodra de gevraagde declaratie is
  bewezen. De per-call mode blijft retained, zodat een latere query de nog niet
  bezochte kandidaten kan vervolgen zonder siblingcallsites samen te voegen of
  de workspacecallgraph eager af te lopen. Wanneer ook die concrete contexten
  missen, mag de query de expliciete metatable van reeds behouden identity-,
  call-argument-, value- en projection-alternatieven openen. Onbewezen
  candidate-argumenthints zijn daarvan uitgesloten: zij mogen geen
  heap-effecten materialiseren;
- de editor materialiseert per benodigde bufferversie alleen de ene immutable
  source snapshot die lexer en parser consumeren. De parser haalt een authored
  regel pas uit die source wanneer hij daadwerkelijk een syntaxfout formatteert;
  volledige line-arrays horen alleen bij expliciete UI-queries die regeltekst
  tonen, zoals het references-resultaat, en niet bij semantiek of diagnostics;
- call hierarchy gebruikt dezelfde vlakke providergrens als volwassen language
  services: de semantische frontend levert directe incoming- en outgoing-calls;
  richting, expansie en de twee viewcaches blijven eigendom van het editormodel
  en de workbench. Het model vraagt pas bij het uitklappen om de volgende laag.
  De file-semantiek markeert call-references en hun owning function tijdens de
  oorspronkelijke AST-traversal; providers matchen references niet opnieuw
  tegen alle call-expressions en zoeken owning scopes niet achteraf terug.
  Alle callsites uit een opgevraagde functiebody worden als een batch tegen een
  gedeelde retained value-graph opgelost. Een provider mag niet per callsite de
  interactieve single-reference-resolver opnieuw laten materialiseren.
  Er wordt geen recursieve depth-begrensde boom vooraf opgebouwd; node-identiteit
  bevat het ouderpad zodat dezelfde caller in verschillende takken onafhankelijk
  kan worden uitgeklapt;
- signature help begint bij de parenthesized argument-list die de parser al
  bezit, inclusief uitsluitend de komma's van die lijst. De language provider
  kiest daaruit de binnenste call en de actieve parameter, resolveert callable
  kandidaten via dezelfde workspace-resolver als navigatie en projecteert de
  gewone Lua-regels voor colon- en dot-calls. De editor scant daarvoor geen
  huidige regel, telt geen haakjes of komma's opnieuw en kent geen builtin-
  uitzonderingspad. Incomplete calls blijven tijdens parser-recovery echte
  callsites; de renderer consumeert alleen het providerresultaat en behoudt zijn
  gemeten layout zolang hint, fontmeting en beschikbare breedte gelijk blijven;
- semantic hover en debugger-evaluatie zijn afzonderlijke language features.
  Hover begint bij dezelfde retained occurrence en workspace-resolver als
  definition en signature help; een geexporteerde functionwaarde volgt de
  gedeelde demand-graph en wordt niet als naamloos table-field gepresenteerd.
  De evaluatable-expressionprovider levert uitsluitend een door de binder
  behouden statisch Lua-pad. De editor composeert dat resultaat eventueel met
  de waarde uit de stilstaande guest en verzint bij een runtime-miss geen
  statische debuggerwaarde. Regel-scans, cartlibkennis en debuggerstate horen
  niet in beide providers. De hover-controller behoudt ook negatieve resultaten
  op documentversie, semantic snapshot en execution point; een onveranderde
  Alt-hover mag daardoor niet iedere hostframe opnieuw analyseren, inspecteren
  of tekst wrappen;
- Back en Forward bewaren editorlocaties op het moment dat een navigatiecommando
  vertrekt. Een cartridge-entry opent cartridgebron en niet eerst de BIOS-entry;
- stackframes en statement-stepping gebruiken de toolingmetadata van de geladen
  ROM. De compiler behoudt de stabiele linkeridentiteit en de uit Lua-syntax
  afgeleide functienaam als afzonderlijke records; de debugger ontleedt geen
  linker-ID om een gebruikersnaam te verzinnen. Functies die tijdens runtime in
  RAM zijn gecompileerd hebben geen ROM-function index en worden daarom met hun
  fysieke adres getoond.

### Doelgrenzen voor Lua- en BLua-sematiek

De semantische laag volgt het productiepatroon van TypeScript en LuaLS: een
langlevend programma behoudt ongewijzigde syntax- en file-records, terwijl
featurevragen alleen de semantiek materialiseren die zij nodig hebben. Dit is
een ownershipcontract, geen toestemming om de huidige bestanden cosmetisch te
splitsen.

| Laag | Eigenaar | Retained representatie | Mag niet bezitten |
| --- | --- | --- | --- |
| Brontekst | editorbuffer of runtime source registry | precies één immutable tekstsnapshot per benodigde versie | AST's, symbols of feature-resultaten |
| Syntax | lexer, parser en parsecache | tokens en één generieke Lua/BLua-AST per sourceversie | workspacebinding, cartlibkennis of editorstate |
| File-semantiek | binder over één AST | declaraties, scopes, occurrences, callable facts en generieke value-flowfacts | cross-file targets, navigatiekeuzes of UI-boomnodes |
| Programmasnapshot | semantische workspace | geordende immutable file-records; ongewijzigde records behouden hun identiteit | tweede kopieën van filegraphs of feature-specifieke caches |
| Resolutie | workspace symbol resolver en retained demand-graph | symboltargets, bewezen call-edges en op aanvraag opgeloste value-identiteiten voor precies één immutable snapshot | mutatie van file-records, editorbuffers of frameworkregels |
| Language features | definition-, references-, rename-, hover-, evaluatable-expression-, signature-help- en call-hierarchyproviders | vlakke, gesorteerde protocolresultaten | opnieuw parsen, opnieuw binden of eigen semantische heuristiek |
| Editor/workbench | sessie- en viewmodels | selectie, expansie, navigatiehistorie, gerenderde items en compositie met feitelijke debuggerwaarden | Lua-resolutie of runtimewaarde-inferentie |

Daaruit volgen deze harde migratiegates:

- een syntactische occurrence wordt eenmaal door de file-semantiek beschreven.
  Read/write/call-rol, receiverwaarde en de omvattende declaratie zijn generieke
  taalfeiten; een featureprovider mag achteraf geen AST's kruisen om die feiten
  opnieuw af te leiden;
- iedere semantic feature resolveert via hetzelfde immutable programma en
  dezelfde resolver. De legacy single-file `LuaSemanticModel.lookup*`-route mag
  niet naast een afwijkende workspace-route blijven groeien;
- afwezigheid wordt op de producergrens waarheidsgetrouw getypeerd. Geen
  `null`/`undefined`-normalisatie, non-null assertions of fallbackketens om een
  intern contract dat eigenlijk ongeldig is alsnog door te laten lopen;
- cross-file valueflow blijft query-demanded. Een edit mag geen volledige
  workspacegraph kopieren en een UI-feature mag geen eager recursieve boom
  materialiseren;
- prototype- en metatable-effecten door een factorycall volgen uitsluitend de
  bewezen call-edge in diens concrete functioncontext. Hun aliasalternatieven
  hebben een afzonderlijke monotone dependency-worklist; een metatable-effect
  mag zichzelf niet opnieuw activeren en een query opent geen globale
  same-name- of caller-scan;
- callcontexts worden geinterned op immutable syntactische callsites en
  parameterprovenance, niet op mutable valuegraph-projecties. Recursieve flow
  convergeert daardoor naar een bestaande context in plaats van steeds nieuwe
  contexts te klonen;
- een unresolved methodreceiver mag zijn callargumenten uitsluitend als
  queryhint aan een named candidate leveren. Zo'n hint materialiseert geen
  heap-effecten en kan dus geen same-name lifecycle of writes publiceren;
- cartlib-, firmware-, prefab-, component- en andere frameworkbegrippen zijn
  verboden in lexer, parser, binder, programmasnapshot en resolver. Eventuele
  producttooling boven de language service mag een eigen expliciete adapter
  bezitten;
- een grotere interne verbouwing mag tijdelijk ongecompileerd in de worktree
  staan, maar niet als repositorycommit. Iedere commit behoudt een bouwbare,
  toetsbare grens; als een eerlijke grens niet kleiner kan, wordt de commit
  groter in plaats van gevuld met tijdelijke facades of compatibiliteitslagen.

Nieuwe IDE-features beginnen aan de providergrens boven het retained semantic
project; zij voegen geen tweede model, runtime semantic cache of afwijkende
positie-resolver toe. Het opsplitsen van `model.ts` is alleen gerechtvaardigd
wanneer een ownergrens of een gemeten bottleneck daar aanleiding toe geeft; een
cosmetische move zou slechts dezelfde verantwoordelijkheden verplaatsen.

De herhaalbare profiler voor lexer-, parser-, file-semantiek-, index- en
querytijd staat in `scripts/dev/profile_lua_semantics.ts`. Hij gebruikt echte
sourcebomen en bewijst tijdens iedere edit dat een onafhankelijk file-record
zijn identiteit behoudt. Gebruik hem als meting, niet als een timingtest met een
hostafhankelijke drempel:

```sh
npx tsx --tsconfig tsconfig.base.json \
  scripts/dev/profile_lua_semantics.ts \
  carts/pietious/player/player.lua cartlib carts/pietious

npx tsx --tsconfig tsconfig.base.json \
  scripts/dev/profile_lua_semantics.ts \
  --incoming carts/nemesis_s/player/player.lua:1223:15 \
  cartlib/world/world.lua cartlib machine/bios carts/nemesis_s

npx tsx --tsconfig tsconfig.base.json \
  scripts/dev/profile_lua_semantics.ts \
  --outgoing cartlib/world/world.lua:684:22 \
  carts/nemesis_s/cart.lua cartlib machine/bios carts/nemesis_s

npx tsx --tsconfig tsconfig.base.json \
  scripts/dev/profile_lua_semantics.ts \
  --hover carts/2025/combat.lua:475:43 \
  carts/2025/combat.lua cartlib machine/bios carts/2025

npx tsx --tsconfig tsconfig.base.json \
  scripts/dev/profile_lua_semantics.ts \
  --hover cartlib/actioneffects/actioneffect_component.lua:10:35 \
  cartlib/actioneffects/actioneffect_component.lua \
  cartlib machine/bios carts/nemesis_s

npx tsx --tsconfig tsconfig.base.json \
  scripts/dev/profile_lua_semantics.ts \
  --hover carts/nemesis_s/player/player.lua:239:8 \
  carts/nemesis_s/player/player.lua \
  cartlib machine/bios carts/nemesis_s
```

De voorlaatste query is de generieke co-attached-objectcase die eerder meer dan
een minuut de host blokkeerde. Op de gemeten 228-file snapshot resolveert zij
koud in ongeveer 0,35 s en warm in ongeveer 0,03 ms; de target is
`fsm_component:bind_state_path`. De laatste query bewijst de door een gewone
functieparameter doorgegeven receiver en diens metatable-effect zonder globale
named-effectscan: `owner:add_component` resolveert koud in ongeveer 0,10 s en
warm in ongeveer 0,03 ms naar `world_object:add_component`. Dit is
performance-evidence, geen draagbare timingdrempel.

## Studio-product: resterend host-contract

De guest-viewport en het uitbreidingsbord zijn afgerond machine-/cartlibcontract
in [`architecture.md`](architecture.md). Beide fysieke sockets blijven gelijk:
de BIOS-bootbare game kan in socket 0 of 1 zitten en de niet-uitvoerbare Studio-
boardmedia zit in de andere socket. De actieve gamecart bedient het board; het
board bezit geen tweede Lua-world of executable.

```text
SYSTEM_ROM     BIOS boot, monitor, public function vector
GAME CART      bestaande cartlib-world; framebuffer in PCRTC circuit2
STUDIO BOARD   board-RAM descriptor/commands + mailbox; beide sockets geldig
GUEST STUDIO   pick/edit + GP0-gizmos in transparante circuit1-page
TS Studio      workbench, language service, Hot Resume, media-admission
PCRTC          circuit2-underlay + circuit1-source-alpha, daarna host chrome
```

| ID | Eindtoestand | Klaar wanneer |
| --- | --- | --- |
| `STUDIO-HOST-CHROME-01` | TypeScript Studio ontdekt de raw `53545544h`-board-id in een van de twee ingestoken media en leest de vaste board-RAM-records uit [`contrib/studio/protocol.ts`](../ide/workbench/contrib/studio/protocol.ts). De host houdt één retained snapshot met de guest-handles, tokens, raw flags en `f32`-woorden; een reader accepteert alleen twee gelijke even seqlock-revisies. Outliner en details zijn views op die snapshot, geen `world._objects`, Lua-reflectie of CPU-heap-DTO. Outliner-selectie en property-edits schrijven de vaste 16-word command record, publiceren de sequence als mailbox-DATA en stroben de mailbox-IRQ; de bekende game-socket wordt daarna geselecteerd. Play/Edit schrijft alleen `SET_GAMEPLAY_RUNNING`; Edit laat machine-, frame-, scanout- en Studio-guestwerk draaien. `OverlayRenderer` / `LAYER_2D_IDE` blijven tabs, problems, find, debugger, outliner en details ná de beam; alle scene-gizmos blijven GP0-pixels in circuit1. Possess/eject gebruikt de bestaande host-shortcut en retained ICU-padremap, niet een gizmo-action-map. De language service blijft framework-onwetend en Hot Resume blijft dezelfde live heap reviseren. | Een browser-IDE-headless scenario start de echte dual-cart-runtime, ziet dezelfde descriptorselectie in guest-viewport en outliner, klikt een tree-item en ziet het guest-selected-handle terug, wijzigt positie/visible/enabled/gameplay via de mailbox en ziet de volgende even descriptorrevision. `IDE-LIVE-01` blijft de interactieve chrome-gate. Geen derde socket, tweede Runtime, host scene graph, OverlayRenderer-gizmo, Lua-RPC of compatibility reader. |

Play-in-editor blijft geparkeerd als `STUDIO-PIE-RUNTIME-01`. Zolang Stop geen
onaangeraakte editor-scene hoeft terug te zetten, is Studio edit-in-place op één
Machine en één Runtime.

## Validatiebasis voor inputwerk

Een inputslice is pas overdraagbaar wanneer de relevante subset hiervan groen
is en ieder interactief restant in de tabel verderop blijft staan:

```sh
npx tsx --tsconfig tsconfig.base.json --test \
  --import ./tests/lua/test_setup.ts \
  tests/lua/host_input_routing.test.ts \
  tests/lua/input_manager.test.ts
cmake --build build-cpp-tests --target \
  bmsx_libretro_host_shortcuts_tests \
  bmsx_libretro_save_state_tests -j2
ctest --test-dir build-cpp-tests --output-on-failure \
  -R 'bmsx_libretro_(host_shortcuts|save_state)_tests'
npm run audit:core-parity
npm run audit:architecture-boundaries -- --summary-only
npm run build:platform:libretro-snesmini:debug
```

De laatste opdracht is de GCC-10 cross-build, ABI-check en QEMU-smoke. Zij
vervangt de hieronder genoemde fysieke SNES Mini-validatie niet.

## Doorlopende performance-audit

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `PERF-RUNTIME-01` | Kies per iteratie één gemeten hot-pathowner en verwijder daar herhaalde decode, conversie, validatie, allocatie of dispatch bij de producer. Dit is een paraplu, geen enkele megaslice. Cartlib-producers (visual rebuild/sort, GEO-overlap event-fanout, compiled tick-schedule) horen hier alleen wanneer een cartbudget hen als hotspot aanwijst; verzin geen tweede renderer of ECS-rewrite. | Analyzers blokkeren nieuwe overtredingen, parity blijft exact en representatieve low-end hardware houdt 50 Hz zonder oplopende backlog. |

Houd throughput en fysieke pacing als twee afzonderlijke metingen. De
`profile:libretro-particle-benchmark-offscreen-wsl`-opdracht eindigt op de
particle-scene en draait zonder throttle of audio; zij meet hoeveel werk de
emulator en GLES2-route kunnen verwerken, niet of een frontend vloeiend paced.
De `profile:libretro-gx-dependency-soak-offscreen-wsl`-opdracht draait juist
gepaced en lang genoeg om oplopende GX-afhankelijkheidsbacklog te zien; zij is
geen vervanger voor een zichtbare frontend of de fysieke target.

## Vereist een interactieve backend of fysieke target

| ID | Nog te bewijzen | Vereist |
| --- | --- | --- |
| `HOST-GX-LIVE-01` | IDE, quick menu, BIOS-terminal, `bare_metal_cart` en `2025` tonen stabiele opeenvolgende frames met correcte input, glyphs en terminalcellen, zonder flashes, zwart beeld of halve commandstreams. | WebGL2 en WebGPU; de terminal ook op GLES2. |
| `GX-READ-01` | GPUREAD wrap, padding, fences, DREQ en zichtbare VRAM-inhoud komen live overeen met de softwarevectoren. | WebGL2, GLES2 en WebGPU. |
| `GX-RASTER-01` | Polygonen, lijnen, clipping, textures, CLUT, mask, blend, dither en stores komen live exact overeen met software en GPUREAD. | WebGL2, GLES2 en WebGPU. |
| `GX-CART-RESIDENCY-LIVE-01` | Doorloop atlaswissels in `2024`, `2025`, `nemesis_s` en `pietious`; framebufferpages, vaste system-VRAM, palette-CLUTs en hergebruikte cart-atlassen mogen elkaar niet zichtbaar beschadigen. | WebGL2 en GLES2; daarna echte SNES Mini. |
| `HOST-OSK-LIVE-01` | Touch en iedere toegewezen/aangesloten controller openen en besturen quick menu en onscreen keyboard. Shift, Backspace, Delete, spatie, Enter, cursor, Home/End en lowercase/uppercase labels werken; sluiten lekt geen chord of letter naar cart, terminal of IDE. Browser-portremaps werken voor fysieke en onscreen devices zonder quick-menu-/shortcutcontrols mee te remappen. Cheat-/sealtekst kan zonder fysiek keyboard worden ingevoerd. | iPhone/browser en echte SNES Mini. |
| `HOST-SUPERVISOR-01` | Select+L opent en sluit de terminal vanaf iedere aangesloten frontendport exact eenmaal zonder gameplayinput te lekken. | Echte SNES Mini. |
| `IDE-LIVE-01` | Tijdens een cartridge-run opent de IDE de cartridge-entry; Back en Forward keren terug naar de exacte cursorlocatie; Go to Definition navigeert door cart-, cartlib-, gegenereerde en statisch geerfde Lua-symbolen; Hover toont resolved declarations en alleen waar mogelijk de echte suspended guestwaarde; Signature Help volgt nested, multiline en nog incomplete user-/module-/builtin-calls; Call Hierarchy wisselt lazy tussen incoming en outgoing; faults tonen authored context voor anonieme functies; Step Into, Over en Out blijven correct voor fysieke en inline frames. | Browser Studio op WebGL2. |
| `PERF-03` | De op de echte target geselecteerde ARM-fetch-, NV-barrier- of dependency-copyroute rendert exact en houdt 50 Hz zonder backlog. | Windows RetroArch en echte SNES Mini. |
| `PERF-04` | De 16k audio-/presentatiesoak houdt 50 Hz zonder sampleverlies, backlog of periodieke hitch. | Zichtbare frontend en daarna SNES Mini. |
| `SNES-ABI-01` | De door de GCC-10 cross-build en QEMU-smoke geaccepteerde core start tegen de actuele target-root en frontend zonder ABI-, loader- of GLES2-fouten. | Actuele SNES Mini-rootdump en hardware. |

## Geparkeerd

| ID | Hervatten wanneer |
| --- | --- |
| `GX-REVISION-OWNER-01` | Meerdere gelijktijdige machines of een behouden backend over machinevervanging een concrete revision-collision kan observeren. |
| `GX-SW-01` | Een profiel op representatieve low-end ARM-hardware een concrete software-rasterizerhotspot aanwijst. |
| `BIOS-TERM-EXT-01` | Er een concrete behoefte is en de command-, call/return- en terminal-output-ABI voor een door firmware geselecteerde developer-cartridge is ontworpen. |
| `BIOS-IRQ-SCAN-01` | BIOS [`kernel/interrupts.lua`](../machine/bios/kernel/interrupts.lua) loopt `pairs(handlers)` en ackt na de scan. Hervat wanneer BIOS meer unmasked sources krijgt dan boot-DMA plus VBlank; til de cartlib-dispatcher niet voor cosmetische consistentie naar firmware. |
| `CARTLIB-VISUAL-SORT-01` | [`cartlib/world/world.lua`](../cartlib/world/world.lua) kopieert actieve visuals en sorteert na een depth/revision-wijziging. Hervat alleen wanneer een cart-visualbudget die producer als hotspot meet; geen tweede draw-path op gevoel. |
| `CARTLIB-WORLD-SINGLETON-01` | Eén executable image heeft één cartlib-world. Twee ingestoken carts mogen ieder hun eigen image-singleton hebben; dat is geen PIE. Hervat alleen wanneer één ROM twee gelijktijdige worlds nodig heeft. |
| `STUDIO-PIE-RUNTIME-01` | Stop moet een onaangeraakte editor-scene herstellen nadat Play die scene heeft gemuteerd. Bouw dan uitsluitend in TypeScript Studio een tweede `Runtime` met dezelfde twee media en eigen VRAM/APU; nooit in libretro, cartlib of een derde socket. Tot die productvraag blijft Studio edit-in-place. |
