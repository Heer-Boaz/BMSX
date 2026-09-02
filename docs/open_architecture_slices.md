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

## Studio: eerst functioneel ontwerp, nog geen implementatieslice

De eerdere `STUDIO-GUEST-VIEWPORT-01` en `STUDIO-HOST-CHROME-01` zijn verworpen.
Zij begonnen bij een Unreal/Unity-achtig beeld, reserveerden socket 1 en schreven
al een scene-, pick-, gizmo- en pauseprotocol voordat de authoringproblemen en
runtime-eigenaren waren onderzocht. Geen onderdeel van dat protocol is nog een
bouwcontract. Ook `STUDIO-PIE-RUNTIME-01` is geen geldige vervolgslice zolang er
geen geaccepteerd Studio-ontwerp is.

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `STUDIO-FUNCTIONAL-DESIGN-01` | Maak na `CART-DEVICE-COMPOSITION-01` een ontwerp vanuit de echte authoring- en testtaken van de bestaande games en cartlib. Begin bij Behavior Trees, FSM-overgangen, ActionEffects, blackboard/state-data, eventketens en deterministische scenario-tests: wat moet de maker modelleren, live zien, pauzeren, stap-voor-stap uitvoeren, injecteren, opnemen, vergelijken en terugvinden in bron? Onderzoek per functie eerst volwassen productievoorbeelden (onder meer VS Code voor workbench/testing/debugger-ownership en gespecialiseerde BT/FSM-tools voor graph-editing en runtime-observatie). Verifieer daarna de live BMSX owners en representaties. Maak meerdere UX/ownership-opties; kies nog geen viewport, socket, mailbox, guest-ABI, scene graph of tweede Runtime. Neem de werkelijke lage presentatieresolutie, het bestaande IDE-tiny-font, keyboard/controllerbediening en browser plus libretro expliciet mee. | Een reviewbaar functioneel eisenmodel, workflows, resolutie-/inputbudget, runtime-observability-contract, testmodel en owner-matrix bestaan; iedere architectuurkeuze verwijst naar een best-practicebron en live BMSX-owner; prototypes mogen wegwerpbaar zijn en schrijven geen machine/cartlib ABI. De gebruiker heeft het ontwerp gekozen vóór er implementatieslices worden geknipt. |
| `STUDIO-IMPLEMENTATION-01` | **Geblokkeerd op het geaccepteerde functionele ontwerp.** Knip pas daarna verticale product-slices langs echte workflows, niet langs een vooraf bedacht Unreal-scherm. | `STUDIO-FUNCTIONAL-DESIGN-01` is geaccepteerd en iedere slice heeft een bewezen owner, representatie, interactief testpad en performancebudget. |

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
