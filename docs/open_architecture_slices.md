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
- cartlib bezit de bestaande game-runtimeconcepten: world, spaces, components,
  compiled tick-schedule, input-actions, FSM, behaviour trees, timelines, AEM
  en overlap-events. Dat is cart-middleware op MMIO, geen product-UI en geen
  reden om gameplay in BIOS of in de host te tillen;
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
  admitten (`?slot1=`, `--slot1`, libretro `dualcart`). Beide sockets kunnen
  een plain ROM of een kaart met concrete expansion-devices dragen; geen
  socket heeft een Studio-rol;
- de TypeScript-IDE is VS Code-chrome (`ide/editor`, `ide/workbench`,
  `ide/language`) plus Hot Resume. [`OverlayRenderer`](../ide/runtime/overlay_renderer.ts)
  en `LAYER_2D_IDE` tekenen na PCRTC-merge, quantize en CRT. Dat is host-UI,
  geen cart-waarneembare viewport;
- PCRTC circuit1/circuit2 mergen VRAM-rectangles in de beam, vóór host overlay.
  BIOS-monitor programmeert circuit2 al via `gx_gpu.prepare_supervisor`. Dat is
  een generieke machinecapability en nog geen gekozen Studio-viewport;
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

## Overdraagbare document- en guest-owner slices

Deze rijen raken geen silicon-semantics. Zij mogen landen zonder interactieve
backend of SNES Mini. Iedere slice begint bij de live owners; deze tabel is
geen bouwrecept.

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `DOC-MACHINE-CLOCK-01` | Productkopie noemt dezelfde CPU-klok en reset-owner als de geïnstalleerde `PSX_MACHINE_SPEC` en PCRTC. `README.md` beweert nu 50 MHz; `docs/architecture.md` en `machine/{ts,cpp}/spec/bmsx/model.*` zeggen 33.8688 MHz (`44100 × 768`). | README, architecture.md en de model-spec noemen dezelfde Hz, dezelfde GX-reset 320×240 PAL, en PCRTC als beam-owner. 50 MHz verdwijnt als machinefeit. |
| `DOC-CARTLIB-OWNER-01` | Het architecture-contract en de packagegrens noemen cartlib niet, terwijl README dat wel doet. De runtime-vocabulaire heeft `machine`/`bios`/`host`/`mode`/`Studio`, geen cart-ROM-engine. De zin dat cartbuilds geen BIOS-modules ontvangen botst met de public export `gpu/system_vram_region`. | `docs/architecture.md` noemt cartlib als cart-ROM-engine in vocabulaire en packagegrens; BIOS blijft system-ROM; de public BIOS-function vector is de enige toegestane BIOS-aanroep vanuit cart/cartlib; architecture.md wordt in dezelfde slice bijgewerkt. |
| `BIOS-ENTRY-01` | Live BIOS-entry is [`machine/bios/main.lua`](../machine/bios/main.lua) (boot, `load`, cartridge-handoff). Repo-root [`main.lua`](../main.lua) is een stale sibling zonder `lua_compiler.load` en met `print ("test")`. De architecture-zin „root `main.lua`” is daardoor dubbelzinnig. | Eén BIOS-entry-owner; de stale rootkopie is weg of niet langer een tweede programma; architecture.md wijst naar `machine/bios/main.lua`. |
| `GUEST-GX-RESET-01` | BIOS [`gpu/gpu.lua`](../machine/bios/gpu/gpu.lua) en cartlib [`gx/display.lua`](../cartlib/gx/display.lua) programmeren dezelfde PCRTC/GP1-resetwoorden met lokale magie. Machine-resetlatches leven in `gpu_pcrtc`/`gpu_display`. Twee callers mogen blijven; twee handboeken niet. | De gepubliceerde presetwoorden staan één keer in het hardwarecontract of de gespiegelde spec; BIOS-boot en cartlib-presets zijn callers; geen gedeelde Lua-module over BIOS en cartlib; cartlib verdwijnt niet in `SYSTEM_ROM`. |

## Cartridge-expansie vóór Studio

De expansielaag is zelfstandig machinewerk. Studio is slechts één mogelijke
latere gebruiker en bepaalt geen socketrol, board-id, capability-bit of
mailbox-ABI. Beide fysieke sockets mogen een gewone game-ROM of een kaart met
concrete extra hardware bevatten. De live machine-eigenaren en de professionele
slot/card-modellen van openMSX, MAME en ares blijven de toetssteen; deze tabel is
geen toestemming voor een generieke device-facade.

| ID | Eindtoestand | Klaar wanneer |
| --- | --- | --- |
| `CART-DEVICE-COMPOSITION-01` | Eén gedeelde cartridgebus met twee nullable fysieke sockets. Het pakketmanifest bevat een verplichte geordende `hardware`-lijst met uitsluitend concrete geïmplementeerde componenten (`rom`, `ram`, `mailbox`); de pakketheader bevat alleen layout- en entrymetadata. ROM is optioneel: zonder `rom` blijven pakketbytes host-side en drijft de kaart nul in het ROM-window. Een source-free hardwarekaart is een normaal pakket met nul BLua32-entrywoorden, niet een afgeleide bootable-cartfixture; BLua32-image/vectorwoorden zonder ROM worden door producer en admission geweigerd. De producer krijgt `system|cart` expliciet en scant alleen de resource-roots van dat product; padspelling bepaalt geen ownership. De producthost vertaalt het manifest één keer naar directe installed media; geen manifest-DTO bereikt de machine. `CartridgeController` bezit selectie, socketstatus en fysieke IRQ/DREQ-routering. Iedere `CartridgeCard` bezit haar optionele ROM/RAM, concrete devices, mapped-page keys/write-watches en mutable state. Er zijn geen boardwoorden, inventoryregisters, capabilitymasks, lege-media-met-`present`, bootable-vlag, manifeststrings in de hot path of compatibiliteitslezers. | TS en C++ hebben dezelfde representatie; beide sockets kunnen onafhankelijk ROM, RAM en mailbox combineren; lege sockets leveren nul en hebben `null`/`optional` state; aanwezige ROM/RAM blijven direct page-bindbaar; de normale producer bouwt een echte source-free RAM/mailbox-cart zonder ROM-chip of BIOS-imports en ontdekt dezelfde bronset ook buiten de BMSX-worktree zonder BIOS-assets mee te pakken; mailbox-edge, DREQ, DMA chip-select override, reset en save/restore zijn gespiegeld getest; echte dual-cartconformance bewijst in beide runtimes dat de ROM-loze pakketheader niet bus-visible is. |
| `CART-CLOCKED-DEVICE-01` | **Geparkeerd tot er een echte kaart bestaat.** De eerste 3D-math-, video- of andere clocked expansion krijgt een concreet card-owned device, registerdecode, schedulerbudget, IRQ/DREQ en save-state. Pas die echte datapath bepaalt de gedeelde abstractie. Geen lege `Accelerator`, `tick()`-facade of generieke property bag vooraf. | Een gekozen kaart en softwarecontract bestaan; de implementatie volgt een passende productie-emulatorreferentie en houdt de controller bij fysieke selectie en signaalroutering, zonder nieuw socketnummer, capability-inventory of executable namespace. |

Een toekomstige VRAM-kaart is dus geen speciale Studio-socket. Zij wordt een
concrete kaartcomponent met haar eigen decode en toestand, precies zoals RAM en
de mailbox dat nu zijn. Of die component via het cartridge-MMIO-window, DMA of
een ander werkelijk hardwarecontract met GX samenwerkt, wordt pas beslist bij
die device-slice; dit document verzint die datapath niet vooraf.

## Studio: source-backed scenes en gedrag, plus deterministische scenario's

De eerdere `STUDIO-GUEST-VIEWPORT-01` en `STUDIO-HOST-CHROME-01` zijn verworpen.
Zij begonnen bij een Unreal/Unity-achtig beeld, reserveerden socket 1 en schreven
al een scene-, pick-, gizmo- en pauseprotocol voordat de authoringproblemen en
runtime-eigenaren waren onderzocht. Geen onderdeel van dat protocol is nog een
bouwcontract. Ook `STUDIO-PIE-RUNTIME-01` blijft verworpen: het geaccepteerde
scenecontract gebruikt de bestaande ene Runtime en geen productrequirement
rechtvaardigt nu een tweede.

Het productcontract voor `STUDIO-FUNCTIONAL-DESIGN-01` staat in
[`studio_functional_design.md`](studio_functional_design.md). De bouwroute
behoudt de reeds gebouwde source-lens en het Scenario Lab, maar zet scene-
authoring nu vóór een editable behaviorpane. Scene, BT en FSM zijn structured
Lua; AEM blijft een gerechtvaardigd schema-owned cooked asset omdat zijn
runtimeconsument een andere representatie gebruikt. Source- en visual-view
delen hetzelfde textmodel, dezelfde undo/save-lifecycle en dezelfde Hot-
Resume-route. Een afgeleide projectie of trace wordt nooit stilzwijgend het
editable model. Studio bezit cartlib en `World` niet, maar mag hun echte scene-
instances via hun publieke mutatiegrenzen bewerken. Libretro blijft speler/core.
Geen van deze keuzes maakt Studio tot machine- of cartridge-expansie-eigenaar.

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `STUDIO-FUNCTIONAL-DESIGN-01` | Ontwerp vanuit de echte authoring- en testtaken van de bestaande games en cartlib, na onderzoek van volwassen productievoorbeelden en de live BMSX-representaties. Kies productvolgorde, inspectiemodel, authored representatie, correspondence-scope en productsurfaces zonder een transport of ABI vooruit te ontwerpen. | **Geaccepteerd en gecorrigeerd:** A + C eerst, daarna echte visual authoring. De live Lua-definities en Hot Resume maken een tweede typed behaviorresource ongeschikt: visual authoring wordt een source-backed Lua-view. Stop-and-inspect blijft de eerste debuggerworkflow; per-node runtimecorrespondence valt buiten de eerste lens en libretro blijft speler/core. Het eisenmodel, de workflows, resolutie-/inputgrenzen en owner-matrix staan in `studio_functional_design.md`. |
| `STUDIO-LUA-BEHAVIOR-AUTHORING-DESIGN-01` | Kies de authored representatie vóór een editable graph en toets haar aan de live BT-, FSM-, ActionEffect-, Lua-editor- en Hot-Resume-owners. | **Geaccepteerd:** gewone cart-Lua blijft canoniek. Een visual editor is een tweede view op hetzelfde retained `EditorTextModel` en schrijft minimale, language-owned source-edits. Dynamische constructies worden niet uitgevoerd of genormaliseerd om een edit af te dwingen. Stackframes en debugranges blijven debuggercorrespondentie; structurele runtime-node-identiteit wordt afzonderlijk bewezen. Geen JSONC-behaviorresource, rompacker-cooker, cartlib-decoder/bindingmanifest, tweede graphdatabase of machine-/TOC-type. De VS Code- en Roslyn-referenties en grenzen staan in `studio_functional_design.md` en `ide/ARCHITECTURE.md`. |
| `STUDIO-SCENE-AUTHORING-DESIGN-01` | Ontwerp vóór runtime of UI de scene-representatie en editworldgrens tegen Godot `SceneState`/Scene Tree, Unity Prefab/Hierarchy, Defold collections/properties, VS Code/Roslyn source-editing, Flecs structural deferral en de live BMSX `prefab`/`World`/`Space`/`Registry`/Hot-Resume-/presentationowners. | **Geaccepteerd:** [`studio_scene_authoring_design.md`](studio_scene_authoring_design.md) legt de representatieladder, prefabpropertygrens, phased construction, structural batch, tombstones, source-edits, suspended guestbinding, presentationregion, visual picking, 384x288-layout en verplichte slicevolgorde vast. De overige rijen hieronder zijn niet geïmplementeerd. |
| `CARTLIB-WORLD-CONSTRUCTION-PHASES-01` | Splits de monolithische `World:spawn` package-intern in object/default/metatable/runtime-id-allocation, final-map/reference/propertyinput, initialize, world/space/component/constructor, position/spawn/activation en Registry/Space/view-publication. Scene shells krijgen nieuwe runtime-ids in authored order; hun scene-local `member_id` wordt niet `WorldObject.id`. Defaults en options blijven zoals live `spawn` vóór `definition.initialize` zichtbaar. Ordinary `spawn` blijft de publieke single-objectoperatie en gebruikt dezelfde fasen zonder tijdelijke batch of extra hot-pathallocatie. | Bestaande world/cartlibtests bewijzen identieke pre-initialize optionvalues, single-spawn callback-, component-, activation-, deferred-admission- en cancellationvolgorde. Een nieuwe multi-objecttest legt alle objecttables, member-ids en runtime-ids vóór reference/propertyconstructie vast zonder een half-built object in Registry, Space of systemviews te publiceren. Geen scene-API, openbare half-built objectfactory, wrapper rond `spawn` of parallel lifecycle. |
| `CARTLIB-WORLD-STRUCTURAL-BATCH-01` | Geef `World` één concrete barrier-owned batch voor een verzameling removes, member replacements, additions en retained mutations. Terminale removal/deregistration komt vóór replacementadmission; ieder replacementobject heeft een nieuwe Registry-id terwijl SceneInstance dezelfde member-id behoudt. Meerdere instanceplannen binnen één open barrier delen één batch: eerste enqueue bepaalt instanceorder en een volgende registratie coalescet alleen haar pending plan naar de nieuwste revision. Na de globale removefase publiceren additions in batch- en authored order; setters/references en lifecycle-enqueued normale mutations worden volledig gedraind voordat enige betrokken instancerevision zichtbaar wordt. | Tests bewijzen terminal-old-before-new replacement zonder identityreuse, meerdere additive-sceneplannen als één atomair zichtbare barrier, coalescing met stabiele queuepositie, geen partial membership tussen system groups, deterministische callbackvolgorde, nested lifecyclemutations en directe versus deferred commit via dezelfde operatie. De batch is niet rollbackbaar en scene code krijgt geen tweede algemene commandbuffer of eigen barrier. |
| `CARTLIB-SCENE-DEFINITION-01` | Bouw pas op die World-primitieven `scene_library.register/load/unload` en een retained `SceneInstance`. Een scene is ordered structured Lua met scene-local authored `member_id`, prefab `definition_id`, bestaande guest `space_id` en cartlib integer-pixel-X/Y plus integer-depth-Z; haar membership blijft los van `Space`. World produceert afzonderlijke terminale runtime-ids. `World` bewaart loaded instances package-intern en ieder authored object zijn ene directe membercorrespondence. Expliciet aangeroepen cart-`<init>`-registratie vervangt definitions en coalescet per open barrier naar de nieuwste revision. | Tests en een echte fixturecart bewijzen authored order, gescheiden member-/Registry-identiteit, load/unload, additive scenes met gelijke lokale member-ids, retain/add/remove/replace, nieuwe runtime-id bij replacement, `World:clear`, `clear_space`/gameplay-disposal als tombstone, exacte machine save/restore van instance/tombstone/pending state en Hot Resume zonder reset van retained runtime state. Alleen explicit reload of twee afzonderlijk geregistreerde remove/add-revisions respawnt een tombstone. Disposal meldt rechtstreeks aan de concrete instance; geen lifecycle-observerregistry, eventsubscription, Registry-key, nested/multi-instance scene, YAML/cooker/ROM-type, Studio-module, hostwijziging of raw worldscan. |
| `CARTLIB-SCENE-PROPERTIES-01` | Laat `prefab.lua` per authorable sceneproperty onder haar source-/constructorkey een cold record publiceren met directe `'number' | 'boolean' | 'string' | 'asset_id' | 'object_reference'`-representatie en expliciet `'construction' | 'mutable'`-beleid. Iedere non-reference descriptor gebruikt de direct gerepresenteerde `PrefabDefinition.defaults[key]`; absence in scene betekent geen override. Mutable records bevatten concrete getter/setter-function values, geen naamlookup. Een guest number blijft direct en krijgt hier geen hostfloat-/fixed-pointconversie. Resolveer verplichte forward/cyclic references binnen dezelfde scene tegen de definitieve membermap vóór constructors; gewone open `world:spawn`-options blijven buiten het schema. | Tests bewijzen initial default/overrideconstructie, add/change/remove override, in-place mutable updates, objectreplacement voor construction-only wijzigingen en references naar retained/new/replaced peers. Override-removal herstelt de actuele prefabdefault; twee opeenvolgende revisions zonder override passen een gewijzigde default niet impliciet toe. Een ongewijzigde reference naar een gameplay-tombstone behoudt runtimestate; construction/rebinding naar zo'n ontbrekende target fault zonder respawn/proxy. Alleen gepubliceerde descriptorfields komen in construction/reconcile; onbekende fields falen aan de cold definitiongrens. Geen `nil`/optional/weak-reference in deze eerste representatie, descriptorbuilder/DSL, cross-scene loadorder, algemene propertybag, reflection, deep equality/clone/serializer, arbitrary table/closurevalue of directe objectfieldwrite. |
| `NEMESIS-ROOT-SCENE-01` | Migreer na de cartlib-slices uitsluitend de vier statische `new_game()`-spawns in `carts/nemesis_s/cart.lua` naar `scenes/root.scene.lua`: local members `intro`, `story`, `title`, `director`, bestaande definition exports, Spaces, positions en order. Registreer na de prefabdefinitions; behoud `world:clear()` en laad daarna die scene. | De echte headless cart, presentatiecapture, gameover/new-game clear/load, save/restore en Hot Resume zijn groen. De sourceprojectie kan later deze productiescene openen. Director/stage/enemy/effect-spawns en hun open optiontables blijven gewone gameplaycode. Geen Studio/cartlib-debugmodule, fake inspectorfields, generated-id als authored correspondence of test-only ROM als productbewijs. |
| `IDE-LUA-SYNTAX-EDIT-01` | Voeg bij de generieke Lua-language-owner sourcebewerkingen toe voor literal replacement en insert/remove/reorder van table fields/entries. Zij gebruiken bestaande syntaxranges en source om indentation, separators, whitespace en comments te behouden en leveren uitsluitend `EditorTextEdit`-records aan het bestaande textmodel. | Tests met inline/multiline tables, trailing separators en comments bewijzen minimale ranges en exacte behoud van onaangeraakte bytes; één editbatch is één model-undo-element. Dynamische/onvolledige syntax levert geen geraden edit. Geen scene-/BT-/FSM-type in parser/binder, feature-local formatter/helper, whole-document serializer of parallelle undo-owner. |
| `IDE-SCENE-SOURCE-PROJECTION-01` | Bouw boven generieke Lua syntax/symbolfacts een Studio-contribution die statisch bewijsbare scene registrations, literal records en prefabdescriptors per `EditorTextModel.version` projecteert. Rows behouden authored order/member-id en exacte ranges; fieldvalues mogen literal of bewezen immutable module/local bindings zijn. Niet-statische Lua blijft canonical en opent als code. | De echte Nemesis-rootscene resolveert haar vier member-ids en bestaande definition exports zonder Lua uit te voeren. Source edits, undo/redo/revert, externe modelchanges en resource rename actualiseren één retained projectie. Common fields en bewezen prefabproperties produceren de generieke minimale edits; add/remove/reorder zijn één documentactie. Geen tweede graphdatabase, runtime-table als authored waarheid, cartlibtypen in generieke taalservices of parsing/formatting in draw/input. |
| `HOST-PRESENTATION-REGION-01` | Scheid in de gespiegeld gedeelde TS/C++ renderowners PCRTC-contentextent, content-sized history/quantize/CRT resources, een retained integer content-source-rect, host-surfaceextent en een retained game-destinationrect. De paneviewstate kiest source/destination; `VideoPresenter` bezit de toegepaste geometrie, nearest present en exacte inverse edge/rounding mapping. Declareer contentpipeline, presentwriter, workbench en menu als expliciet geordende resource/backbufferwriters. Publiceer vóór de diff de TS/C++-representatietabel en alle present/resize/pointer/capture hot-pathcallers. | Fullscreen met full-content source blijft byte-/pixelgelijk; non-fullscreen of zoomed gameoutput samplet de gekozen source nearest en clipt in de destinationrect terwijl host chrome erbuiten tekent. Headless/software, WebGL2, WebGPU en C++ GLES2/pariteitstests bewijzen output, resize, held frames, CRT history, capture en inverse mapping. Geen `alwaysExecute`, impliciete default-framebufferdependency, zwarte crop, Studio-camera in de renderer of per-frame geometryallocatie. |
| `CARTLIB-VISUAL-SPATIAL-QUERY-01` | Voeg bij `visual_component` een optionele owner-gebonden boundsquery toe die dezelfde retained state als `draw` consumeert. Sprite/surface bezitten hun bounds; custom visuals opt-in expliciet. `World` pickt alleen draw-submittable visuals vanuit zijn bestaande depth/sequence-gesorteerde render-view in omgekeerde volgorde; een `SceneInstance` filtert via retained membership en geeft per member de union van zijn pickable visuals. | Tests bewijzen draw/bounds-pariteit voor offsets, region, scale, flip, z/order, object-/componentvisibility en overlappende/multiple visuals; custom visuals zonder bounds zijn niet pickable. Query gebruikt reusable scratch en bouwt geen lijst/snapshot; gewone update/renderpaden krijgen geen scenebranch of boundswerk. Geen hostduplicatie van cart drawmath, collider-/object-size-fallback of fictieve camera. |
| `BLUA32-TOOLING-MODULE-ROOT-01` | Laat compiler/linker vóór scene-runtimebinding de reeds producer-owned dynamic module-rootbindingen als `(module path, global slot name)` in de private `Blua32SymbolsImage` opnemen en laat `RuntimeSourceState` ze per exact execution domain indexeren. Een generieke toolinglookup leest via die binding de echte guest rootvalue; const/static modules hebben geen runtime root. | Compiler/linker/symbolcodec- en Hot-Resume-tests bewijzen ordinary dynamic roots, afwezigheid voor const/static modules, domeinisolatie en vervanging tegelijk met de geïnstalleerde symbols. Geen machine-/ROM-header-/cartlib-ABI, runtime `require`, IDE-import van slotsanitizing, geraden global, heapscan, cross-domainfallback of per-call indexbouw. |
| `IDE-TEXT-HISTORY-PROJECTION-01` | Laat `EditorTextModel.pushEditOperations` zijn bestaande stabiele `EditorUndoRecord` retourneren en laat undo/redo-events diezelfde record plus direction publiceren. Change-driven secondary views mogen eigen ephemeral projectiestate aan een record koppelen; het model bewaart geen callback, domainvalue of featuretype en blijft enige history-stackowner. | Modeltests bewijzen dezelfde recordidentity over edit→undo→redo, history branches, save-stateidentity en events naar meerdere views. Een scene-previewtest associeert alleen een expliciet succesvol gepreviewde command en past haar directe before/after values op undo/redo toe; code-edits, externe changes, revert en een beëindigde runtime-epoch voeren geen guestactie uit. Geen tweede undo stack, diff-inference, callback in `EditorUndoRecord`, scene-import in `ide/editor`, per-frame historyscan of silent Hot Resume. |
| `IDE-SCENE-RUNTIME-BINDING-01` | Bouw één exacte `ide/runtime/scene_editing`-binding via de producer-owned dynamic module-rootrecord naar `scene_library.instance` en de vaste `SceneInstance`-operaties voor tombstone/revisions, position, mutable descriptorproperty en spatial query terwijl de CPU suspended is. `SceneInstance:object` blijft uitsluitend een directe guest/cartlib-API en wordt niet als raw objecttable aan de workbench gepubliceerd. De instance, niet de host, dispatcht mutable propertyget/set naar de prefabdescriptor; construction-only values worden geen live property. `SuspendedGuestSession` bezit centrale materialisatie van stringarguments via de CPU-`StringPool` en directe scalar guestvalues plus retained call-argumentscratch; de binding bezit operations en argumentvolgorde. | Integratietests bewijzen loaded/live/tombstone/unloaded correspondence, position/property preview, structural reconcile aan de echte World-barrier en guestfault/sourceframebehoud in dezelfde Runtime. Geen generic call-by-string/RPC, geraden globalslot, raw objecttable in een contribution, directe classmethoddispatch, host Lua-tableconstructie, raw memberwrite, heap/worldscan, gameplay-pauseprotocol of tweede Runtime. |
| `STUDIO-SCENE-EDITOR-01` | Bouw als laatste de browser-workbenchcontribution tegen de echte Nemesis-rootscene: game-view primair; tiny-font outliner/details als compacte drawers/panels; retained selectie/collapse/layout en game-view zoom/pan; centrale commands/menu/actionbar; host `OverlayRenderer` voor chrome/gizmos. Commands schrijven canonical Lua; alleen mutable ownerfields previewen direct, terwijl structurele/constructie-edits via de bestaande expliciete Hot Resume lopen. | Op 384x288 blijven game-view en controls bruikbaar met keyboard/controller/pointer. Add/remove/reorder/transform/property, undo/redo/save/revert, Hot Resume, applied/unapplied correspondence, tombstones en code/visual wissel blijven één document/scene; picking gebruikt de visual query en pointermapping voor draw-submittable members in de daadwerkelijk actieve Space. Inactieve members blijven via outliner/details authorable maar krijgen geen fictieve bounds. `IDE-LIVE-01` plus fault-gated screenshots van de echte cart bewijzen het product. Geen implicit active-spacewissel, hardcoded helptekst als bediening, vaste driekolomslayout, ander font, guest editorcart/PCRTC circuit2, OverlayRenderer als modelowner, host-schaduwwereld, per-frame scan/allocatie, slotrol of PIE. |
| `IDE-TEXT-DOCUMENT-OWNER-01` | Maak het bestaande editor-textmodel werkelijk resource-owned voordat een tweede view kan editen. Een retained documentmodel per `(domain,path)` bezit PieceTree-buffer, monotone versie, saved-state-identiteit, runtime-applied versie en undo/redo. Code- en toekomstige visual-editorinputs bezitten alleen viewstate en delen datzelfde model. Programmatic structured edits richten zich op een documentmodel, worden als één undo-element toegepast en publiceren dezelfde change event als typen, undo, redo en revert. | **Geïmplementeerd:** `EditorTextModelService` bewaart één model per resource; de single code-editorwidget attach't een model plus input-owned viewstate zonder documentkopie. Model-edit, undo, redo, save en revert publiceren één lifecycle; saved-state-identiteit blijft correct na een same-depth history branch en een edit tijdens een asynchrone save blijft dirty. Autosave bewaart dirty modelinhoud los van code-viewmetadata; rename, Hot Resume en de behavior-index lezen resource-models direct, terwijl diagnostics en navigation het model van hun code-input lezen zonder active-tabkopie. De owner- en productiereferenties staan in `ide/ARCHITECTURE.md`. Geen facade rond `editorDocumentState`, parallelle undo stack, mode-switch op optionele DTO-velden of volledige documentreplace voor een property-edit. |
| `IDE-RESOURCE-EDITOR-RESOLVER-01` | Leg editorselectie vóór de eerste custom visual input bij een workbenchresolver. Een resource behoudt haar machine-/toolchain-type; onafhankelijke editorcontributions selecteren op dat type of een source-suffix en bezitten hun eigen inputopening. Een expliciet editor-id kan later bron- en visual view voor dezelfde resource kiezen. | **Geïmplementeerd:** navigatie kent geen Lua/AEM/viewerbranch meer. De ingebouwde text-editor- en resource-viewercontributions worden eenmaal bij workbenchconstructie gecomponeerd; de resolver kiest specifiek vóór de expliciete wildcard-viewer. Een concrete contribution kan een bronresource selecteren zonder `editorKind` of Studio-metadata op `RuntimeResource`, ROM TOC of machine; een toekomstige behavior-view wordt expliciet voor hetzelfde Lua-resource gekozen. De gedeelde textselectie staat niet langer in de code-tab-owner. Geen extension-marketplace-, priority-, configuration- of dynamische registryfacade zolang BMSX die productfuncties niet heeft. |
| `IDE-SOURCE-DATA-CATALOG-01` | Laat de runtime-sourceowner gewone source-backed dataresources indexeren zonder editorclassificatie. Lua blijft uit haar source registry komen; `data` en `aem` komen uit de ROM-index en behouden hun echte assettype. De actieve domain bepaalt welke dataresources zichtbaar zijn, terwijl alle geïnstalleerde domains onder hun `(domain,path)` vindbaar blijven. | **Geïmplementeerd:** de vroegere AEM-only arrays zijn dataresourcecatalogi. Daardoor blijven gewone source-backed data-assets vindbaar zonder domeinkennis in machine, TOC of sourceowner. Compiler-`code`, source-loze payloads en andere niet-geselecteerde assetklassen worden niet als textdocument verzonnen. De editorresolver, niet de catalogus, kiest later de visual input. Tests bewijzen system-/slotisolatie en behoud van de producer-owned `data`-representatie. |
| `IDE-EDITOR-INPUT-RESOLUTION-01` | Splits editorinput-resolutie van activatie voordat een custom visual input wordt toegevoegd. De gekozen contribution maakt of hergebruikt de concrete retained input; resource-navigation activeert uitsluitend het resultaat. Workspace-recovery herstelt dirty inputs via dezelfde resolver, hydrateert daarna het resource-owned textmodel en laat inputspecifieke viewstate bij de betreffende inputowner. | **Geïmplementeerd:** de resolver voert de gekozen inputfactory uit en geeft de concrete input terug. Lua, AEM en de generieke viewer bezitten hun eigen inputconstructie; navigatie bezit de enige activatie in de resource-openroute. Dirty recovery forceert geen code-tab meer en leest het gedeelde model niet via `CodeTabContext`; een testcontribution bewijst herstel van een structured textmodel achter een non-code input. Code-cursor- en scrollstate blijven afzonderlijk code-inputmetadata. Geen verborgen code-input, tweede documentbuffer, activatie tijdens recovery, editorbranch in workspacecode of generieke inputfacade. |
| `IDE-EDITOR-INPUT-OWNER-01` | Vervang vóór save/revert voor custom editors de structurele tab-DTO's door concrete retained editorinputs. Een kleine abstracte common base bezit alleen inputidentiteit en presentatie; expliciete read-only- en working-copy-subclasses bezitten de dirty-capability zonder optioneel modelveld. Iedere contribution bezit haar eigen concrete model/viewreferentie. Dirty chrome vraagt het inputcontract en classificeert geen inputkind. | **Geïmplementeerd:** code-, resource-viewer-, Behavior-Lens- en Scenario-Lab-inputs zijn contribution-owned objecten die over paneactivaties behouden blijven. De working-copy-input leest rechtstreeks het gedeelde `EditorTextModel`; read-only inputs blijven niet-dirty. De exhaustive built-in union blijft alleen de statische productcompositie. Tabmeting en -rendering roepen `input.isDirty()` zonder code-tabbranch of actieve-widgetstate aan. Geen generieke inputregistry, capabilities-bitmap, save-no-op, optioneel working-copyveld of per-frame inputallocatie. |
| `IDE-WORKING-COPY-SAVE-01` | Verplaats save vóór een custom editor van de actieve codewidget naar de echte working-copygrens. Gewone Save richt zich op het actieve working-copy-input. Media-vervangende workbenchacties nemen één expliciete snapshot van alle resource-owned dirty modellen en bewaren die batch in hun confirmatie. De writer voltooit uitsluitend de daadwerkelijk geschreven modelsnapshot en behoudt de bestaande Lua-/AEM-runtime-syncsemantiek. | **Geïmplementeerd:** de code-tab-I/O-owner bevat geen save meer. `text_file_save.ts` ontvangt een `EditorTextModel` en bezit canonical persistence plus runtime-sync; een edit tijdens de asynchrone write blijft dirty. Hot Resume en Reboot verzamelen dirty modellen rechtstreeks bij `EditorTextModelService`, slaan die sequentieel op en wijzigen de actieve pane niet; theme toggle verandert evenmin van input. Een toekomstige visual BT-/FSM-input deelt het Lua-model en valt daardoor zonder apart opslag- of assetpad onder dezelfde Lua-save en Hot-Resume-semantiek. Geen hidden code-tab, active-widgetdocument, save-no-op op read-only inputs, optioneel savecontract, modefacade of per-frame dirty-scan. |
| `BLUA32-ASSET-EDIT-BATCH-01` | Maak de bestaande fysieke authoring-assetrevision geschikt voor één expliciete batch vóór meerdere dirty structured documenten Hot Resume mogen gebruiken. Groepeer edits in de vaste execution-domainrepresentatie, geef per domain de volledige lijst aan zowel de prelink-layout als de definitieve tail-layout, en installeer ieder geraakt medium eenmaal. Machine en C++ blijven uitsluitend rauwe ROM-bytes consumeren. | **Geïmplementeerd:** `Blua32PublicAssetChanges` bezit een ordered `assetEdits`-lijst en relocateert alle daarin genoemde bestaande assets tijdens één tailbuild. De hostrepresentatie is `[system, slot0, slot1]`; AEM gebruikt dezelfde batchroute voor haar ene huidige edit en Scenario-cartridges gebruiken de generieke lijst. Een layouttest bewijst twee gelijktijdige system-assetedits en behoud van niet-gerelateerde bytes. `ide/ARCHITECTURE.md` legt representaties, alle buildcallsites en de ongewijzigde TS/C++ raw-media-installgrens vast. Geen per-document media-install, host override-map, machine-assettype, Studio-ABI, dynamische importerregistry of framehotpathwerk. |
| `IDE-EDITOR-PANE-LIFECYCLE-01` | Leg vóór de eerste custom visual input één retained editor-pane-lifecycle per editorgroep vast. De input blijft document/viewstate; de pane is het herbruikbare control voor één inputkind. Een statische exhaustive built-in factorytable kiest de lazy factory, terwijl de editorgroep pane-instanties bewaart en `setInput`, `setOptions` en `clearInput` aanroept. | **Geïmplementeerd:** code, resource viewer, Behavior Lens en Scenario Lab bezitten hun eigen update-, draw-, keyboard-, pointer-, wheel- en statusgedrag. De workbenchrouters behandelen alleen globale commands, tabs, panels, modals en chrome en dispatchen daarna rechtstreeks naar de gecachete actieve pane. Wisselen bewaart input-owned codecontext via `clearInput`; dezelfde retained input krijgt alleen nieuwe selectieopties. Tests bewijzen lazy eenmalige paneconstructie, hergebruik over inputs, lifecyclevolgorde en directe hot-pathdispatch. Geen centrale inputkind-switch in update/draw/content-input/statusdispatch, pane per tab, per-frame factorylookup/allocatie, dynamische extensionregistry, DOM-/React-facade of Studio-/BT-kennis in de pane-owner. |
| `STUDIO-BT-VISUAL-EDITOR-01` | Bouw pas na een bewezen Lua source-editcontract een echte host-side BT-view op hetzelfde retained Lua-textmodel als de code-editor. De retained projectie toont de statisch herkende ordered topology, attachments, blackboard en properties; iedere beschikbare add/remove/move/connect/propertyactie produceert minimale Lua-textedits via dezelfde document-undo-owner. | Keyboard, controller en pointer kunnen op 384x288 met het IDE-tiny-font een bestaande Lua-BT maken en wijzigen. Source- en visual-view blijven bidirectioneel synchroon; Save plus Hot Resume compileert exact die Lua-bron en live BT-rebind blijft de bestaande library-owner. Ongesteunde dynamische constructies blijven bronbehoudend zichtbaar in plaats van herschreven. Draw parseert, formatteert of alloceert geen topology per frame. Geen JSONC/resourcecooker, tweede graphdatabase, whole-document serializer, runtime-Lua-tablemutatie of observertrace als authored waarheid. |
| `STUDIO-SOURCE-LENS-01` | Voeg een read-only Behavior Lens toe als echte workbench-view op de actuele Lua-resource. De generieke Lua-semantiek behoudt per call de lexicaal geldige modulebinding; een workbench-contribution herkent uitsluitend de echte BT-, FSM- en ActionEffect-registration APIs en bouwt retained source-topology. De parser, binder en query graph kennen geen cartlib-schema. De tab is een eigen discriminant, geen optionele code-tab-DTO. Selectie, collapse, scroll, geformatteerde rijen en hit-bounds blijven retained over frames en worden alleen bij source-version/layoutwijziging herbouwd. Dynamische Lua blijft zichtbaar als dynamic/incomplete. De view gebruikt het bestaande tiny font, het volledige 384×288-hoofdvlak en dezelfde logische keyboard/controller/pointercommands; source-open navigeert via de bestaande resource/navigation-owner. | De echte Moon-tree toont alle herkenbare hergebruikte occurrences met afzonderlijke viewidentiteit en gedeelde authored range; nested/concurrent FSM en echte ActionEffects zijn navigeerbaar; lokale `require`-aliases volgen de callee-before-arguments-volgorde; computed keys en builders leveren geen verzonnen topology; gewone Lua blijft leeg. Een live IDE-test opent de lens, bedient haar met keyboard/controller/pointer, springt naar bron en bewijst de tiny-fontlayout op 384×288. Draw parseert, formatteert en alloceert niet per frame. Toolchain/IDE-typechecks, Lua-tests, architectuuraudit en runtimecapture zijn groen. |
| `SCENARIO-LOGICAL-TICK-01` | Geef de bestaande frame-scheduler in TS en C++ één begrensde uitvoeroperatie die exact tot de volgende reeds gedefinieerde logische runtime-tick loopt, zonder presentatie-index of host-update als simulation-time te hernoemen. De normale framehotpath blijft dezelfde eigenaar en krijgt geen Studio-callback. | TS/C++ representation en callsites zijn vooraf vastgelegd; paritytests bewijzen exact één monotone tick, carry/budgetgedrag, IRQ/ICU-fase en ongewijzigde gewone frame-uitvoering; browser, Node en libretro blijven op dezelfde schedulercontracten. |
| `SCENARIO-TEST-SOURCE-01` | Laat de testpacker iedere guest-test als haar eigen source-resource met stabiele package-identiteit behouden. Een synthetisch samengeplakt `headless_test.lua`-document is geen discovery- of sourcenavigatie-owner. | Fouten en assertions wijzen naar de oorspronkelijke `_assert.lua`-resource en range; dezelfde packaged identities zijn beschikbaar voor headless tooling en browserdiscovery; er is geen tweede testregistratie of compatibiliteitsreader. |
| `STUDIO-SCENARIO-LAB-01` | Bouw na de twee prerequisites een browser-workbenchworkflow met drie expliciete owners naar VS Code-model: retained/lazy testcollectie, een execution owner voor run/cancel/rerun tegen één Runtime, en een afzonderlijke begrensde result service. Een workbench media session materialiseert eerst de actuele canonieke gewone ROM, installeert daarna uitsluitend de afgeleide scenario-ROM in de bestaande socket en herinstalleert na de laatste presentatiegelegenheid de canonieke ROM. Authoringlagen blijven canoniek; alleen de actuele executable sourcemap wisselt mee. Input wordt vóór ICU-sampling op expliciete logische ticks aangeboden; presentatiecaptures bewaren zowel request-tick als werkelijk gepresenteerd frame. Guest setup/update/assertions blijven expliciete testcode. | Bestaande tests worden eenmaal ontdekt; selectie, run, cancel en rerun gebruiken dezelfde stable test-id in browser en headless tooling; live en voltooide resultaten zijn begrensd; failures, faults, logs en captures navigeren naar de oorspronkelijke bron; herhaalde guest-owned startconditie en inputvolgorde leveren hetzelfde aangetoonde resultaat. Build/install/herstel zijn door de runtime-taskowner geserialiseerd en tests bewijzen dat canonieke source/ROM-lagen niet door scenario-media worden vervangen. Geen save-state/heap/RAM/VRAM-rollback, `HostTestRunner`-facade in browsercode, generieke `runtime.call`, tweede Runtime, machine/cartlib Studio-kennis of libretro-workbench. |
| `SCENARIO-INTERACTIVE-PACING-01` | Voeg naast het bestaande expliciete `runToNextLogicalTick` in de gespiegelde frame-scheduler een scheduled bounded operatie toe. Zij consumeert een geaccepteerde hostdelta via exact dezelfde accumulator, fractionele remainder, carry en catch-upgrens als `run`, maar stopt na hoogstens de volgende VBlank-begin en kent zelf geen PCRTC-periodbudget toe. Browser Scenario Lab bereidt iedere grens afzonderlijk en kan met nul extra hosttijd retained carry draineren. Headless Scenario en de ongepaceerde libretro-hosttimeline blijven de expliciete maximaal-snelle route gebruiken. | TS/C++ paritytests bewijzen partial frames over meerdere hostcalls, exact-once hostdelta, retained target/carry over backendfences, meerdere catch-upticks met inputvoorbereiding ertussen, PCRTC-timingwijziging en ongewijzigd `run`/`runToNextLogicalTick`. Een browserproef op 60/120/144Hz toont circa 49,761146 machineframes en correcte APU-tijd per wandseconde; dezelfde scenario-input/resultaten zijn gelijk aan de ongepaceerde headless run. Geen sleep, `setTimeout`, lokale framecounter, Scenario-pacingmode, audioresamplefix of vertraging van automation. |
| `ICU-SUPERVISOR-SAMPLE-CONTEXT-01` | Maak de machine-owned ICU-sourcepoort expliciet over normal versus actieve supervisortransition/context. `InputController` leidt die context rechtstreeks af uit de retained system-controllerfase; het is geen nieuwe save-state of register. Er blijft één ICU-registerfile. Fysieke hosts vullen beide contexten uit fysieke input; browser tooling mag alleen de normal-snapshot door retained playback vervangen en levert supervisorinput rechtstreeks uit de fysieke PlayerInput-bron. De representatie en alle TS/C++ sourcecallers worden vóór de diff vastgelegd. | Gespiegelde ICU-tests bewijzen de contextwisseling op entry- en leavefences, één sample sequence en ongewijzigde MMIO-woorden. Browser-routingtests bewijzen dat fysieke keys niet in normale playback lekken, wel direct in de BIOS-monitor verschijnen en na exit evenmin in de hervatte carttick lekken. Native/libretro vult beide contexten identiek zonder Studio-branch. Geen tweede ICU-bank, CPU-heapinspectie, Scenario-callback in hardware of toggling van playback vanuit een viewcontroller. |
| `STUDIO-SCENARIO-INTERRUPT-01` | Laat de execution owner vrijwillige supervisor-execution als pauze van uitsluitend scenario-tijd behandelen. Faultsequencecontrole blijft vóór de pauzegrens; monitorhardware en PCRTC lopen door, maar scenario tick/timeout, scheduled commands, observations en guestcalls staan stil. De bestaande fysieke IDE-chord opent de blokkerende workbench en exposeert daar het bestaande Cancel-command; er komt geen tweede stopmechanisme. | Een live browsertest start een echte afgeleide ROM, opent via fysieke Select+RB/RightCtrl+RightShift de IDE, bewijst nul machineprogressie onder de workbench en cancelt met canonical herstel. Een tweede test opent via ScrollLock de echte BIOS-terminal, typt met fysieke HID-input, hervat en bewijst exact de eerstvolgende retained playbacktick. Een guestfault faalt nog steeds. Geen `t.openLuaSource`/direct `t.command` als toegangsbewijs, featureknop, hardcoded shortcuttekst of Reboot-as-Cancel. |
| `STUDIO-SCENARIO-RUN-SET-01` | Vervang het single-leaf runmodel door een VS Code-achtig retained `ScenarioRun`: de geselecteerde collectie-node resolveert eenmaal naar ordered leaves en één immutable sourcebatch; run/resultservice bezit scope, items, voortgang, cancellation en rerun. De browsermedia-session bouwt ieder item uit dezelfde canonical ROM/sourcegeneratie, cold-boots ieder item, gaat na de laatste presentatie direct naar het volgende derived medium en herstelt canonical media eenmaal aan het einde. Eén itemfailure of 3000-scenario-tick-itemtimeout laat de rest lopen; cancellation bewaart het actieve item als cancelled en markeert queued items skipped, terwijl hostfalen de run beëindigt. | Selectie van de huidige Nemesis-projectroot voert alle 22 leaves eenmaal in stabiele volgorde uit; leaf-run gebruikt exact dezelfde requestvorm. Eén retained run toont aggregate counts en per-item logs/captures/faults/facts; rerun behoudt de vorige scope en cancel laat geen item verdwijnen. De projectroot heet in de `TESTS`-view `NEMESIS_S (22)` (of dezelfde beschikbare projectlabel/countprojectie), terwijl domain uitsluitend routingdata blijft. Geen controller-loop over `start`, top-level run per leaf, category-YAML/tagfacade, vorige-derived-ROM als buildinput, restore tussen items of per-frame aggregatie. |
| `STUDIO-FSM-TRACE-01` | Voeg als eerste, smalle recorded-observabilitycategorie FSM-transitions toe aan expliciete Scenario Lab-tests. `state:transition_to_state()` bevat alleen compiler-tracepoints op de werkelijke guard- en commitgrenzen. Gewone release/debug/Hot-Resume-builds wissen deze statements volledig; uitsluitend de afgeleide Scenario-ROM emit de sinklookup. Een recorder uit het afzonderlijke `testlib` bindt één concrete machine-root en prealloceert een vaste circular recordbuffer. Static instance/machine-identiteit staat eenmaal in de channelheader; records bevatten producer sequence, rauw `SYS_TIME_MS`, lane/from/to `def_id` en committed boolean. Scenario Lab bindt de geretourneerde guest-`Table` direct, draineert haar zonder heap/worldscan naar een afzonderlijke begrensde result sequence en bewaart observation tick los van producercoördinaten. | De echte Nemesis-pauzescenario toont ordered running→pause en pause→running facts voor exact `nemesis_s.director.nemesis_s.director.fsm`; een guardtest bewijst rejected zonder statewijziging en een nested-entertest bewijst commitordering. Ring-overflow faalt de test. De guest-buffer alloceert na constructie niet meer; compilerbewijs vergelijkt gewiste trace-source met dezelfde normale bytecode/constantpool en de instrumented O3-route wordt afzonderlijk gemeten. Facts hebben geen verzonnen sourcerange. Geen recorder, recorderfield, branch of trace-string in gewone cartcode; geen generieke behaviorhook, live monitor, runtime-call-RPC, registry/worldscan, BT-slotidentiteit, ActionEffect-reason of machine/C++-Studio-ABI. |
| `STUDIO-ACTIONEFFECT-TRIGGER-TRACE-01` | Voeg als tweede, afzonderlijke recorded categorie alleen ActionEffect-triggeradmission toe. De normale component krijgt compiler-tracepoints op haar eigen rejection- en accepted-grenzen; gewone executable builds wissen ze volledig. Een Scenario-only `testlib`-recorder bindt de unieke `actioneffect_component` van één concrete registry-owner en prealloceert een vaste circular buffer. `trigger()` evalueert iedere gate eenmaal en publiceert accepted of precies cooldown, ontbrekende required tag/state, aanwezige blocked tag/state of custom gate. Accepted volgt de immediate/deferred cooldownstate en gaat vooraf aan handler/eventdispatch, zodat geneste triggers producer-order behouden. Records bevatten sequence, rauw `SYS_TIME_MS`, effect-id en de producer-owned geïnterneerde outcome-string rechtstreeks; er is geen numerieke reason/label-ABI. | Cartlibtests bewijzen alle outcomecategorieën, accepted-before-nested ordering, overflow en ongewijzigde boolean gameplaysemantiek. Een echte Pietious-gate rejection en echte Nemesis accepted trigger komen via dezelfde Scenario Lab-owner in results en retained tiny-fontprojectie terecht. Na warm-up alloceert de producerbuffer niet; gewone bytecode/constantpool is trace-vrij en de Scenario O3-kosten zijn gemeten. Geen registry/worldscan, host-side reason-inference, sourcerange, generic diagnosticsfacade, callbacks in de periodieke lane, lifecycle/periodic/cooldown-commitfacts, BT-slotidentiteit of machine/C++-wijziging. |
| `STUDIO-ACTIONEFFECT-ACTIVITY-TRACE-01` | Voeg na triggeradmission uitsluitend de aggregate `activate(id)`-/`deactivate(id)`-commits toe. Trigger- en activityfacts van dezelfde geselecteerde component delen één monotone producerstream; er komen geen buffers die de host achteraf op `SYS_TIME_MS` mergeert. Een vast record bevat sequence, rauw `SYS_TIME_MS`, directe kindstring, effect-id en directe fact value: outcome-string voor `trigger`, nieuwe rauwe `active_count` voor `activate|deactivate`. Activity publiceert na count en first-activation periodieke lane/deadline, maar vóór eventuele latere geneste feiten. De host behoudt een typed fact-union in dezelfde retained sequence en presenteert count nul niet als effect removal. | Een compiler/runtime-test bewijst nested retain/release-counts, commit-before-observation, causale ordering met geneste triggers, fixed-buffer-overflow, nul post-warm-up guestallocaties en gemeten enabled overhead. Een echte Nemesis `Space`-down/up-flow toont in één Scenario Lab-resultaat `activate 1`, `trigger accepted`, `deactivate 0`, terwijl de bestaande gameplayassertie de periodieke herhaling controleert. Gewone release/debug-ROMs bevatten geen ActionEffect-tracekanaal, trace-only outcomeconstant of sinkdispatch; geen grant/revoke/rebind-, cooldowncommit- of periodicfact, tweede recorder, host-state-inference, sourceclaim, generic lifecyclefacade of machine/C++-wijziging. |
| `STUDIO-ACTIONEFFECT-SOURCE-LINK-01` | Koppel de bestaande ActionEffect-facts daarna uitsluitend in de workbench aan hun actuele authored registratie. De Behavior Lens-recognizer publiceert naast zijn outline een statische registratiecandidate wanneer de id een stringliteral of immutable lokale const-keten is. Een concrete, per semantic-workspace-generation opgebouwde index bewaart alle candidates onder execution domain, behavior-kind en semantische id. Scenario-resultaten blijven onveranderde runtimefacts; activeren van een fact bevraagt de actuele bronindex en opent alleen een unieke candidate. | De echte Nemesis-`fire_salvo`-fact navigeert via zijn const-id naar de `register_effect`-aanroep; een Pietious literal-id werkt identiek. Een bronwijziging bouwt pas bij de volgende navigatie één nieuwe indexgeneration. Dynamische ids leveren geen candidate en dubbele registraties worden niet door “eerste wint” verborgen. Parser, binder, query store, cartlib, testlib, ROM en resultrecords veranderen niet; geen per-frame parse/indexwerk, sourceclaim in guestdata, hostscan van Lua-runtimewaarden of algemene graph/inspectorfacade. |

`STUDIO-ACTIONEFFECT-PERIODIC-TRACE-01` is na toetsing aan de live owner geen
bouwslice. De dense periodieke lane bewaart het effectrecord maar niet opnieuw
de map-key waarmee `grant_effect(id)` dat record bezit. Een completion met
effect-id zou daardoor een extra id in ieder normaal effectrecord, een parallelle
id-lane, een reverse map of een scan vereisen. Geen daarvan wordt als
debuggedreven cartlib-state ingevoerd. De completion-grens na
`execute_effect()` is wel vastgesteld, maar blijft ongeobserveerd totdat een
niet-diagnostische runtime-eigenaar een echte actieve-effectidentiteit vereist
of een instrumentatierepresentatie die identiteit volledig buiten gewone
cartcode kan behouden.

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
De `profile:libretro-gx-dependency-soak-offscreen-wsl`-opdracht doorloopt alle
GX-scenes, eindigt op framebuffer-feedback en blijft paced, maar schakelt audio
uit zodat een dummy-audiodevice geen fictieve underruns rapporteert. Geen van
beide vervangt de zichtbare targetmetingen hieronder.

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
| `BIOS-IRQ-SCAN-01` | BIOS [`kernel/interrupts.lua`](../machine/bios/kernel/interrupts.lua) loopt `pairs(handlers)` en ackt na de scan. Cartlib [`irq.lua`](../cartlib/irq.lua) is lowest-set-bit plus ack-before-handler. Hervatten wanneer BIOS meer unmasked sources krijgt dan boot-DMA+VBlank; til de cart-dispatcher niet „voor consistentie” de firmware in. |
| `CARTLIB-VISUAL-SORT-01` | [`cartlib/world/world.lua`](../cartlib/world/world.lua) kopieert actieve visuals en `table.sort` bij iedere depth/revision. Hervatten wanneer een cart-visualbudget die sort als producer-hotspot meet. Geen tweede draw-path op gevoel. |
| `CARTLIB-WORLD-SINGLETON-01` | De cart-world is één module-instantie. Hervatten wanneer een gekozen productworkflow werkelijk twee gelijktijdige worlds in één ROM vereist; tot die tijd geen multi-world facade. |
