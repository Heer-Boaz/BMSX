# Studio functioneel ontwerp

Status: **geaccepteerd productcontract voor fase A + C**

Dit document werkt `STUDIO-FUNCTIONAL-DESIGN-01` uit vanuit de bestaande
BMSX-representaties en productievoorbeelden. De gekozen eerste productroute is
**A + C**: een source-first Behavior Lens, gevolgd door een deterministisch
Scenario Lab. De eerste inspectieworkflow is stop-and-inspect; bestaande
BT/FSM/ActionEffect-definities blijven arbitrary Lua. Exacte per-node
BT-runtimecorrespondence en runtime-observability horen niet bij de eerste
source-lens. Libretro blijft speler/core en krijgt geen Studio-workbench.

Deze keuzes autoriseren geen viewport, cartridgefunctie, transport, guest-ABI
of runtime-instrumentatie. Iedere implementatieslice blijft gebonden aan de
owner- en representatiegrenzen verderop.

## Scope en ontwerpgrens

Studio moet makers helpen om het gedrag van een game te **modelleren,
begrijpen en testen**. De eerste probleemruimte bestaat uit:

- Behavior Trees (BT's), inclusief composites, Tasks, Services, decorators en
  blackboards;
- hiërarchische en concurrente FSM's, inclusief events, guards, timelines en
  state-scoped ActionEffects;
- ActionEffects, inclusief gates, cooldown, deferred cooldown commitment,
  periodieke uitvoering en geproduceerde events;
- eventketens tussen emitters, listeners, FSM's en ActionEffects;
- deterministische scenario-tests met input, checkpoints, traces, faults en
  captures;
- betrouwbare navigatie tussen een authored definitie, een concrete
  runtime-instance en de bron die die definitie voortbrengt.

Studio is geen scene-owner. Deze slice introduceert daarom geen scene graph,
object-outliner, transform-inspector, gizmo, Studio-cartridge, socketrol,
mailboxprotocol of tweede runtime. Cartridge-expansie blijft het zelfstandige,
generieke machinecontract uit [architecture.md](architecture.md#cartridge-expansion).

## Professionele uitgangspunten

De volgende principes komen rechtstreeks uit volwassen tools; de BMSX-keuzes
verderop benoemen waar de live representatie een andere oplossing vereist.

### Document en view zijn verschillende owners

VS Code maakt onderscheid tussen een resource/documentmodel en een of meer
views. Een tekstresource blijft een `TextDocument`; visual edits schrijven het
echte document en documentwijzigingen, undo, redo en revert stromen terug naar
alle views. Zie de gepinde VS Code-documentatie over
[view versus documentmodel](https://github.com/microsoft/vscode-docs/blob/15bdb6a1ce236766f5199af970e52ed567707520/api/extension-guides/custom-editors.md#L34-L52)
en
[documentsynchronisatie](https://github.com/microsoft/vscode-docs/blob/15bdb6a1ce236766f5199af970e52ed567707520/api/extension-guides/custom-editors.md#L106-L168),
plus VS Code's retained
[resource- en view-typegebonden modelmanager](https://github.com/microsoft/vscode/blob/48465bfbc57a81b0ff223d928753972c51b9ecd2/src/vs/workbench/contrib/customEditor/common/customEditorModelManager.ts#L11-L90).

Godot past dezelfde grens toe op een state-machine-resource: de editor bindt
aan het echte resource en respecteert read-only state
([bron](https://github.com/godotengine/godot/blob/6220ead4fa06611918e371e6f51d7b9a3aefe53c/editor/animation/animation_state_machine_editor.cpp#L54-L84));
transition-edits lopen via de centrale UndoRedo-manager op dat resource
([bron](https://github.com/godotengine/godot/blob/6220ead4fa06611918e371e6f51d7b9a3aefe53c/editor/animation/animation_state_machine_editor.cpp#L131-L170)).
Topology komt uit het resource, terwijl current/fade/travel runtime-decoraties
zijn
([bron](https://github.com/godotengine/godot/blob/6220ead4fa06611918e371e6f51d7b9a3aefe53c/editor/animation/animation_state_machine_editor.cpp#L1199-L1383)).

**Gevolg voor BMSX:** een graph mag een view op een echt authored document of
resource zijn, maar wordt nooit een tweede host-side waarheidsmodel.

### Static topology en runtime-observaties zijn verschillende representaties

LimboAI identificeert een BT-instance, de owner en het source asset afzonderlijk
van de depth-first taskstatus
([bron](https://github.com/limbonaut/limboai/blob/eb5645f37541ecad00c4c13148066605322cf67d/editor/debugger/behavior_tree_data.cpp#L20-L83)).
Bij een ongewijzigde root/topology werkt de view alleen status en timing bij en
behoudt zij selectie en collapse-state
([bron](https://github.com/limbonaut/limboai/blob/eb5645f37541ecad00c4c13148066605322cf67d/editor/debugger/behavior_tree_view.cpp#L103-L234));
updates worden gecoalesced
([bron](https://github.com/limbonaut/limboai/blob/eb5645f37541ecad00c4c13148066605322cf67d/editor/debugger/behavior_tree_view.cpp#L299-L334)).

BehaviorTree.CPP publiceert statusveranderingen via een expliciete
logger/subscribergrens
([bron](https://github.com/BehaviorTree/BehaviorTree.CPP/blob/9b63b505983f76e46d90d71c87d21fad0001f8a3/include/behaviortree_cpp/loggers/abstract_logger.h#L17-L61)),
bezoekt de tree eenmaal om subscriptions te installeren
([bron](https://github.com/BehaviorTree/BehaviorTree.CPP/blob/9b63b505983f76e46d90d71c87d21fad0001f8a3/src/loggers/abstract_logger.cpp#L64-L115)),
en houdt static topology, een vooraf bemeten statusbuffer en een begrensde
transitionhistory apart
([initialisatie](https://github.com/BehaviorTree/BehaviorTree.CPP/blob/9b63b505983f76e46d90d71c87d21fad0001f8a3/src/loggers/groot2_publisher.cpp#L123-L168),
[transitions](https://github.com/BehaviorTree/BehaviorTree.CPP/blob/9b63b505983f76e46d90d71c87d21fad0001f8a3/src/loggers/groot2_publisher.cpp#L222-L247)).

**Gevolg voor BMSX:** static topology wordt niet iedere tick gekopieerd;
runtime-observatie bestaat uit geselecteerde, begrensde semantische deltas. De
volledige LimboAI-snapshot en de generieke BehaviorTree.CPP-nodehooks zijn geen
blauwdruk voor de fused BMSX-hot paths.

### Discovery, uitvoering en resultaten zijn aparte testowners

VS Code scheidt de hiërarchische testcollectie, lazy discovery en code-relaties
([bron](https://github.com/microsoft/vscode/blob/48465bfbc57a81b0ff223d928753972c51b9ecd2/src/vs/workbench/contrib/testing/common/testService.ts#L27-L95))
van run intent, controllers en annulering
([bron](https://github.com/microsoft/vscode/blob/48465bfbc57a81b0ff223d928753972c51b9ecd2/src/vs/workbench/contrib/testing/common/testService.ts#L357-L485)).
Live en voltooide resultaten hebben een eigen service en begrensde retention
([bron](https://github.com/microsoft/vscode/blob/48465bfbc57a81b0ff223d928753972c51b9ecd2/src/vs/workbench/contrib/testing/common/testResultService.ts#L20-L67),
[retention](https://github.com/microsoft/vscode/blob/48465bfbc57a81b0ff223d928753972c51b9ecd2/src/vs/workbench/contrib/testing/common/testResultService.ts#L75-L215)).

**Gevolg voor BMSX:** een testlijst, een runner en result history worden niet in
één panelcontroller of runtimefacade samengevoegd.

### Debuggen selecteert instances en semantische categorieën

LimboAI registreert runtime-instances en volgt alleen de geselecteerde instance
([bron](https://github.com/limbonaut/limboai/blob/eb5645f37541ecad00c4c13148066605322cf67d/editor/debugger/limbo_debugger.cpp#L62-L179)).
Unreal beschrijft dezelfde functionele scheiding: een BT-debuggerinstance bevat
een tree asset, active path, additional active nodes en runtimebeschrijvingen
([FBehaviorTreeDebuggerInstance](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/AIModule/FBehaviorTreeDebuggerInstance));
de StateTree-debugger onderscheidt live values, actieve states, concrete
instances en opgenomen traces
([StateTree Debugger](https://dev.epicgames.com/documentation/en-us/unreal-engine/statetree-debugger-quick-start-guide)).
De Gameplay Debugger beperkt werk via een geselecteerd object en ingeschakelde
categorieën
([documentatie](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-the-gameplay-debugger-in-unreal-engine)).

Unreal's PIE, actor-overlay en scene viewport zijn hier uitdrukkelijk geen
architectuurvoorbeeld.

## Echte BMSX-representaties

Authoring, gecompileerde uitvoering en observatie zijn niet dezelfde
representatie. Een ontwerp dat deze grenzen overslaat, is geen geldige Studio-
implementatie.

### Behavior Trees

[`cartlib/behaviour_tree/program.lua`](../cartlib/behaviour_tree/program.lua)
verlaagt authored definitions bij admission naar retained evaluators, operands,
resetpaden en een state factory. De 50-Hz-route bevat daardoor geen generieke
featuredispatch (`program.lua:8-18,19-145`).

[`node_program.lua`](../cartlib/behaviour_tree/node_program.lua) kent iedere
gecompileerde **occurrence** een interne `execution_index` toe en interpreteert
authored tabellen niet in de evaluator (`node_program.lua:11-16,483-506`).
[`execution_layout.lua`](../cartlib/behaviour_tree/execution_layout.lua) bezit de
dense slots, flags, records en vooraf gealloceerde servicelane
(`execution_layout.lua:1-5,17-92`). Die woorden zijn compiler-owned runtime-
opslag, geen authored identifiers.

De echte Moon-tree hergebruikt dezelfde `fly_attack`- en
`death_ray_attack`-tabellen op meerdere posities
([`carts/nemesis_s/enemies/moon_tree.lua:14-197`](../carts/nemesis_s/enemies/moon_tree.lua)).
Daarom zijn Lua-objectidentiteit en een enkele sourcerange geen unieke
occurrence-identiteit. Een BT-view mag runtime-slots, tabelidentiteit of regels
niet stilzwijgend promoveren tot stabiele authored node-id.

[`blackboard.lua`](../cartlib/behaviour_tree/blackboard.lua) verlaagt semantische
keynamen naar dense slots en bewaart de namen in het layout voor rebind
(`blackboard.lua:1-4,27-54,66-113`). Views tonen de semantische keys; slots
blijven een intern datapad.

### FSM's

[`cartlib/fsm/fsm.lua`](../cartlib/fsm/fsm.lua) bewaart een hiërarchische
`def_id`, immutable definition topology en concrete runtime-state
(`fsm.lua:166-172,276-410,533-617`). FSM's hebben daardoor al een bruikbare
semantische path-identiteit.

De feitelijke grenzen zijn:

- guardbeoordeling en transition commit: `fsm.lua:916-970`;
- queued path processing: `fsm.lua:1150-1197`;
- eventhandling en bubbling: `fsm.lua:1554-1597`;
- de gecompileerde frame-evaluator: `fsm.lua:1599-1608` en
  [`frame_program.lua:11-88`](../cartlib/fsm/frame_program.lua).

Een toekomstige trace wordt op deze eigenaargrenzen geproduceerd. Zij wordt
niet achteraf gereconstrueerd uit `_machines`, `current_state` of andere private
tabellen.

### ActionEffects

[`cartlib/actioneffects/actioneffect_component.lua`](../cartlib/actioneffects/actioneffect_component.lua)
bezit per owner de effectdefinition, `active_count`, cooldown/pending state en
de dense periodieke lane (`actioneffect_component.lua:56-86,163-197,208-347`).

`trigger()` onderscheidt intern cooldown en gates, maar publiceert alleen een
boolean (`actioneffect_component.lua:250-305`). Een host kan dus geen rejection
reason afleiden. Als zo'n reden een gekozen productvereiste wordt, moet de
ActionEffect-producer die reden op zijn echte beslisgrens produceren; de
workbench mag haar niet raden.

### Events, world en identiteit

[`cartlib/event_emitter.lua`](../cartlib/event_emitter.lua) dispatcht synchrone,
directe Lua-values en gebruikt retained emitter-id voor filtering
(`event_emitter.lua:195-257,282-319,334-346`). Er is geen retained eventhistory.
Een causale eventweergave vereist daarom feiten bij emission en bij concrete
consumers; listener- of heapscans zijn geen vervanging.

[`cartlib/world/world.lua`](../cartlib/world/world.lua) bezit precies één
cart-world, spawn/disposal en structural barriers (`world.lua:1-33,634-728`).
[`cartlib/registry.lua`](../cartlib/registry.lua) bezit cartbrede numeric object-
en componentidentiteit (`registry.lua:3-79`). De host leest geen `world._objects`
en maakt daar geen scene-DTO van.

Gameplay-clock suspension is cartscheduling: de frame-clock kan doorlopen
(`world.lua:295-322`). Dat is niet hetzelfde als debugger-stop.

### IDE, debugger en testharness

De live IDE-grens uit [`ide/ARCHITECTURE.md`](../ide/ARCHITECTURE.md) blijft
gelden: editor bezit tekst/caret, workbench bezit panels en chrome, language
bezit generieke taalservices, en `common` blijft klein.

- [`ide/runtime/source_registry.ts`](../ide/runtime/source_registry.ts) bezit de
  exacte geladen source records en revisions.
- [`ide/runtime/debugger_state.ts`](../ide/runtime/debugger_state.ts) is een
  source/PC-debugger per execution domain (`debugger_state.ts:21-71,184-245`).
  Source stepping is geen BT/FSM semantic stepping.
- [`ide/runtime/suspended_guest.ts`](../ide/runtime/suspended_guest.ts) inspecteert
  echte CPU-`Value`s lazy (`suspended_guest.ts:22-92,165-230`). `callClosure()`
  voert guestcode uit en wordt geen generieke live Studio-RPC.
- De huidige workbenchroute wist queued runtime time en presenteert een held
  frame wanneer de overlay actief is
  ([`ide/workbench/host_frame.ts:74-84,184-255`](../ide/workbench/host_frame.ts)).
  Live-monitoring is daardoor een echte latere host-lifecyclekeuze, geen kleine
  panelwijziging.
- [`ide/testing/scenario/execution_service.ts`](../ide/testing/scenario/execution_service.ts)
  draait uitsluitend de verpakte loader-, ready-, setup- en updateclosures
  tegen één Runtime. De execution owner plant input op zijn monotone scenario-
  tick en biedt die input vóór de ICU-sampling van de bijbehorende
  logische runtime-tick aan. Browser en headless tooling adapteren dezelfde
  execution state machine aan hun host-frame lifecycle; geen van beide bezit
  een tweede runnerprotocol.
- `ide/testing/scenario` bezit daarnaast de gedeelde discovery- en result-
  services. De browser-mediasessie en UI blijven workbench-contributions;
  [`ide/workbench/state.ts`](../ide/workbench/state.ts) composeert die lagen.
  Runtime-modules importeren daardoor geen workbenchfeature.
- [`scripts/bootrom/platforms/input_timeline.ts`](../scripts/bootrom/platforms/input_timeline.ts)
  plant input en captures expliciet op
  `HeadlessPresentedFrame.frameIndex`. Dat is een presentation-/captureroute,
  geen machine-, cart- of scenario-tijdas.

### Cartridge-expansie

De machine heeft twee generieke sockets. Beide kunnen concrete `rom`, `ram` en
`mailbox`-componenten dragen; geen socket heeft een Studio-rol. Zie
[`machine/ts/spec/bmsx/cartridge.ts`](../machine/ts/spec/bmsx/cartridge.ts),
[`machine/ts/rompack/manifest.ts`](../machine/ts/rompack/manifest.ts) en het
[expansiecontract](architecture.md#cartridge-expansion).

Studio-functionaliteit definieert geen kaart, socketselectie, mailboxpayload,
board-id, capabilitybit, MMIO-register of DMA-route.

## Functionele eisen

### Definitie ontdekken en begrijpen

De maker kan:

1. BT-, FSM- en ActionEffect-definities vinden vanuit bron, testresultaat of een
   geselecteerde runtime-instance;
2. BT topology, composites, decorators, Services, Tasks en blackboard keys
   volgen;
3. FSM hierarchy, initial states, current states, concurrent regions, events,
   guards, timelines en scoped ActionEffects volgen;
4. ActionEffect gates, cooldown, deferred commitment, period en geproduceerd
   event zien;
5. vanuit ieder betrouwbaar geïdentificeerd element naar de echte bron springen
   en vanuit bron naar beschikbare behaviorviews navigeren;
6. dynamische of niet statisch oplosbare Lua als zodanig zien, zonder verzonnen
   topology of fallbackmodel.

### Runtime-instance selecteren en inspecteren

De maker selecteert expliciet één concrete instance op basis van echte
runtime-identiteit: execution domain, registry object-/component-id en tree-,
machine- of effect-id. De workbench kan vervolgens, voor zover de gekozen
observabilityoptie dit werkelijk produceert, tonen:

- BT active/running/waiting/success/failure-status en active path;
- blackboardwaarden en veranderingen per semantic key;
- FSM current states per region en requested, committed of rejected transitions;
- emitted, afgehandelde en doorgebubbelde events;
- ActionEffect activation, deactivation, cooldown, period en trigger outcome;
- een echte bronlocatie van het semantische element wanneer de gekozen
  correspondence-representatie die relatie bezit.

### Pauzeren, opnemen en terugvinden

De gebruiker kan gedrag opnemen, een concrete verandering selecteren, de
bijbehorende instance en waarden inspecteren en naar de bron springen. Het
eerste product gebruikt het volgende model:

1. **Stop-and-inspect:** openen van de workbench stopt dezelfde Runtime volgens
   het huidige hostmodel. De source-lens toont uitsluitend authored feiten.
   Een latere tracefase mag begrensde, vóór de stop geproduceerde feiten tonen
   en echte gestopte guestwaarden inspecteren.

Een live monitor blijft een afzonderlijke, niet gekozen productoptie. Die zou
een expliciete host-frame-, audio- en inputlifecycle vereisen en wordt niet
gebouwd via gameplay-clock, PIE of een tweede Runtime.

### Deterministische scenario's

Een scenario-workflow ondersteunt:

1. tests en scenario's ontdekken zonder duplicaatregistratie;
2. een test, groep of selectie starten, annuleren en herhalen;
3. een expliciete startconditie en cart-owned initialisatie gebruiken;
4. genormaliseerde input op expliciete logische runtime-ticks aanbieden;
5. assertions in guest-testcode uitvoeren;
6. semantic facts, checkpoints, faults, logs en captures verzamelen;
7. expected en actual vergelijken en de eerste afwijking aanwijzen;
8. vanuit een failure of trace-event naar de bron navigeren;
9. voor captures de logische tick en het werkelijk gepresenteerde frame apart
   registreren;
10. een begrensde history van live en voltooide resultaten bewaren.

Testcode mag expliciete verpakte setup/updateclosures gebruiken. Die testgrens
wordt niet uitgebreid tot een generieke live `runtime.call`, host-Lua-RPC of
mutation-API voor Studio.

## UX- en ownershiproute

Opties A en C vormen het gekozen eerste product. B blijft een latere
observabilityfase; D en E vereisen eerst een afzonderlijke keuze voor een
constrained authored representatie.

### Optie A — Source-first Behavior Lens

Een read-only structurele view boven het echte Lua-document en generieke
source/AST-feiten.

**Eigendom**

- de bron blijft workspace/editor-owned;
- generic parsing/binding blijft `ide/language`;
- behaviorherkenning en de view leven als Studio/workbench-contribution boven
  die generieke feiten;
- cartlib-typen lekken niet naar lexer, parser, binder of demand graph.

**Mogelijkheden**

- compacte BT/FSM/ActionEffect-outline;
- selectie en bronlocatie in beide richtingen;
- dynamische Lua-regio's eerlijk als unresolved/dynamic;
- geen runtime-instrumentatie nodig voor de eerste versie.

**Trade-off**

Huidige arbitrary Lua en hergebruikte BT-tabellen verhinderen volledige,
gegarandeerde runtime-nodecorrespondentie. Deze optie mag die beperking niet
verbergen.

### Optie B — Trace-first Behavior Debugger

Een debugger voor geselecteerde behaviorinstances, gebaseerd op feiten die de
semantische owner produceert.

**Eigendom**

- cartlib blijft eigenaar van BT/FSM/ActionEffect/eventsemantiek;
- alleen een gekozen, generieke diagnosticsgrens mag daar feiten produceren;
- workbench bezit selectie, tracepresentatie, filtering en sourcenavigatie;
- machine en cartridge-expansie kennen deze semantiek niet.

**Mogelijkheden**

- active state/path en live of opgenomen waarden;
- transition-, event- en effecttimeline;
- instance- en categoriefiltering;
- first-divergence-navigatie bij tests.

**Trade-off**

Deze optie vereist eerst gekozen identities, correspondence, debug/release-
variant, performancebudget en host-lifecycle. Dit document kiest geen transport
of ABI.

### Optie C — Scenario Lab

Een testproduct boven de bestaande guest-, host- en IDE-testowners.

**Eigendom**

- workbench bezit discoveryviews, commands en resultaatpresentatie;
- de gedeelde Scenario Lab execution service bezit de run state machine;
- assertions en domeininjectie blijven expliciete testcode;
- resultaten hebben een aparte, begrensde result owner.

**Mogelijkheden**

- discover, run, cancel en rerun;
- inputschedule, checkpoints, captures, faults en logs;
- vergelijking en sourcenavigatie;
- CI/headless en interactieve workflows rond hetzelfde testid.

**Trade-off**

Browser en headless tooling moeten dezelfde testidentiteit, execution owner en
resultaatsemantiek aan hun verschillende hostlifecycles binden. Die verticale
workflow wordt geen browserfacade rond een headless runner.

### Optie D — Text-backed Visual Authoring

Een graph of statechart als alternatieve view op een gekozen constrained
tekstrepresentatie.

**Eigendom**

- het workspace-document is canoniek;
- graph edits zijn echte documentedits via normale undo/redo/save;
- text view, visual view en Hot Resume zien dezelfde bronrevision.

**Mogelijkheden**

- visueel nodes/states toevoegen, verwijderen en verbinden;
- eigenschappen en source in context bewerken;
- normale dirty/save/revert- en Hot Resume-lifecycle.

**Trade-off**

Arbitraire huidige Lua-tabellen zijn niet betrouwbaar round-trippable. Deze
optie is pas geldig nadat een constrained tekstrepresentatie expliciet is
gekozen; zij mag geen bestaand Lua-programma destructief normaliseren.

### Optie E — Dedicated structured behavior resource

Een nieuw canoniek structured of binary behaviorasset met stabiele element-id's.

**Eigendom**

- het resource zelf is de authored waarheid;
- toolchain/admission compileren het resource naar cartlib-uitvoering;
- views en runtime decoration verwijzen naar resource-id's.

**Mogelijkheden**

- volledige graph editing;
- stabiele occurrence-identiteit;
- expliciete topology, schema en sourcecorrespondence.

**Trade-off**

Dit is een nieuw product- en assetformat met compiler-, admission-, lifecycle-
en migratiewerk. Het mag niet stilzwijgend als host-viewmodel of compatibiliteits-
laag worden ingevoerd.

### Gekozen volgorde

De productvolgorde is **A, daarna C**: eerst source-first begrip, daarna
deterministische scenario's. **B** volgt alleen voor geselecteerde recorded
observability nadat de benodigde semantische producers en identities expliciet
zijn ontworpen. **D** of **E** volgt alleen wanneer de gebruiker bewust een
constrained authoringrepresentatie kiest.

De source-lens blijft read-only boven arbitrary Lua. Zij belooft geen exacte
runtime-nodecorrespondentie. De eerste inspectieworkflow is stop-and-inspect en
libretro blijft buiten de Studio-workbench.

## Observabilitycontract

Dit hoofdstuk definieert benodigde informatie en ownership. Het definieert geen
registers, bytes, transport, hostprotocol, guest-ABI of device.

### Gescheiden representaties

1. **Authored document/resource** — de canonieke bewerkbare bron.
2. **Static topology/correspondence** — immutable semantische elementen en,
   wanneer werkelijk beschikbaar, hun sourceranges.
3. **Runtime instance** — concrete mutable uitvoering voor één object/component.
4. **Ordered semantic facts** — veranderingen op ownergrenzen.
5. **Workbench viewstate** — selectie, focus, collapse, filters en presentatie.

Geen van deze lagen wordt vervangen door een host-side world- of graph-DTO.

### Identiteit

- instance-identiteit gebruikt execution domain plus echte registry object-/
  component-id en behavior-id;
- FSM-elementen gebruiken de bestaande `def_id`/path;
- ActionEffects gebruiken hun bestaande effect-id binnen de geselecteerde owner;
- BT-elementen vereisen een echte **occurrence-id**; Lua-objectidentiteit,
  sourceregel en dense execution slot zijn daarvoor ongeldig.

Voor BT occurrence-to-sourcecorrespondence blijven drie eerlijke keuzes open:

1. een constrained authored resource met eigen stabiele element-id's;
2. producer/tooling-owned correspondence voor aantoonbaar herkenbare authored
   occurrences;
3. runtime-observatie zonder gegarandeerde per-node sourcemapping.

### Semantische feiten

Een logisch feit moet voldoende informatie dragen om ordering, instance,
element en outcome te begrijpen:

- de logische runtime-tick en volgorde daarbinnen;
- concrete instance-identiteit;
- fact kind;
- semantische elementidentiteit;
- status of outcome;
- alleen wanneer de workflow dat vereist een echte guest-value-referentie of
  checkpointwaarde.

Een presentation-frame-index is geen execution-coordinate. Als een visuele
capture aan een feit of checkpoint wordt gekoppeld, bewaart het resultaat beide
coördinaten en de aantoonbare relatie ertussen.

Static strings, topology en sourcemetadata worden niet bij ieder feit herhaald.
Dit is een functioneel datamodel, geen wireformat.

Feiten ontstaan alleen bij de owning semantic boundaries:

- BT: node/taskstatus, active path en latent lifecycle;
- blackboard: semantic key change bij de owning set-boundary;
- FSM: transition request, guard result, commit, enter, exit en handled event;
- ActionEffect: activation, deactivation, trigger outcome, cooldown commit en
  periodieke uitvoering;
- events: emission en concrete handled/propagated resultaten.

De host leidt ontbrekende feiten niet af uit private heap-, world- of component-
tabellen. In het bijzonder wordt een ActionEffect rejection reason pas getoond
als de producer die reden werkelijk onderscheidt.

### Selectie, retention en performance

Een gekozen observabilityimplementatie voldoet aan de volgende eisen:

- alleen geselecteerde instances en categorieën produceren of transporteren het
  gevraagde detail;
- static topology wordt eenmaal gepubliceerd of afgeleid;
- live updates zijn deltas, geen volledige tree/world snapshots;
- retained history heeft een expliciete vaste grens;
- geen per-frame table walk, formatting, stringbouw of allocation in de
  BT/FSM/ActionEffect-hot paths;
- snapshots worden alleen bij pause of een gekozen checkpoint gemaakt;
- disabled/release-overhead wordt gemeten op de echte cart-hot paths;
- een generieke callback- of hookdispatch wordt niet in de normale fused
  evaluator gesmokkeld.

### Pauze en semantic stepping

De bestaande debugger stopt op execution-domain/PC/sourcepunten. Dat bewijst
geen semantic enter/exit/transitiongrens.

Een latere productkeuze moet daarom expliciet kiezen tussen:

- een debug-instrumented cartvariant met semantic breakpoints; of
- deterministic scenario-step/checkpoints zonder live semantic hooks.

Paused details gebruiken echte guestwaarden via de bestaande suspended-guest-
owner. Arbitraire hostmutatie, algemene closurecalls of gameplay-clockpause zijn
geen debuggercontract.

## Testmodel

Het testmodel volgt VS Code's scheiding tussen collectie, uitvoering en
resultaten en hergebruikt BMSX's bestaande testowners.

### Tijdassen

BMSX heeft drie verschillende relevante ordeningen:

1. machine-execution en de logische runtime-ticks die
   [`FrameSchedulerState`](../machine/ts/machine/scheduler/frame.ts) sequentieel
   publiceert;
2. de monotone scenario-tick waarop expliciete testcommands gepland worden;
3. geaccepteerde host-presentaties en hun `HeadlessPresentedFrame.frameIndex`.

De PCRTC/host mag presentaties coalescen of bij een gestopte beam helemaal niet
publiceren terwijl machine-execution doorgaat. Deze tijdassen zijn daarom niet
uitwisselbaar. De execution owner bereidt de volgende scenario-tick en haar input
vóór ICU-sampling voor; na de aantoonbaar voltooide logische tick roept hij de
expliciete guest-update aan. Een guest-call die meerdere ticks nodig heeft,
vertraagt deze tijdas of een geplande release niet. De scenario-tick groepeert
testwerk maar is zonder die binding geen simulation-timebewijs. Een capture
wordt pas aan een werkelijk gepresenteerd frame toegewezen en bewaart daarnaast
de logische tick die haar aanvroeg. Observability gebruikt diezelfde execution-
ordering en leidt haar nooit uit een presentatie-index af.

### Discovery

- stabiele test-/scenario-id en hiërarchie;
- source resource en range;
- lazy discovery waar de collectie groot is;
- relatie van bron naar tests en van resultaat naar bron;
- geen tweede registratie van dezelfde guest- of hosttest.

### Run

- expliciete include/exclude-selectie;
- run, cancel en rerun;
- één Runtime per execution session;
- genormaliseerde input op expliciete logische runtime-ticks;
- expliciete guest-owned setup/update/assertions;
- eventuele cart-owned seed of initialisatie is onderdeel van de scenario-
  startconditie, niet van een algemene hostmutation-API.

Een interactieve browserrun mag dezelfde Runtime rebooten of opnieuw laden als
de gekozen workflow dat vereist; er draait geen tweede verborgen Runtime naast.
Een afzonderlijk headless proces is een testhost, geen PIE-runtime in Studio.

Voor de browser bestaat een run uit een expliciete media session. De huidige
workspacegeneratie wordt eerst de canonieke gewone ROM; de scenario-builder
leidt daaruit één tijdelijke executable test-ROM af en de bestaande fysieke
socket installeert die ROM. Source registries en authoringlagen blijven
canoniek, terwijl debugger/fault-resolutie gedurende de run naar de afgeleide
BLua32-image wijst. Na de laatste presentatiegelegenheid van pass, failure of
cancel wordt dezelfde canonieke ROM opnieuw geïnstalleerd en dezelfde Runtime
normaal koud gestart. Dit is geen heap-, RAM-, VRAM- of save-state-rollback:
herhaalbare seed en initialisatie blijven guest-owned scenario-startcondities.
De runtime-taskqueue serialiseert build, install en herstel; de UI bezit geen
mediawrites.

De browserprojectie is één echte workbench-tab, geen cart-UI en geen overlay op
de game. Zij gebruikt het tiny font en verdeelt het volledige contentvlak in
een retained testboom en retained resultatenboom. Beide panes zijn zelfstandige
list views met eigen rijen, selectie, scroll, hover en viewport-layout; alleen
de focus tussen panes behoort aan de omvattende tab. Selectie, collapse, tekst
en hit-bounds worden niet ieder frame gereconstrueerd.
Run/rerun/cancel zijn contextacties; een run legt de actuele geselecteerde bron
en open programmafiles vast, verlaat daarna tijdelijk de blokkerende IDE en
keert pas na canoniek mediaherstel naar dezelfde tab terug. Resultaat- en
failure-activatie loopt via de bestaande sourcenavigatie.

### Resultaat

Een resultaat kan bevatten:

- test-id en source/ROM-revision waarmee de run werkelijk is uitgevoerd;
- backend/host en scenario-startconditie;
- running, passed, failed of cancelled;
- fault en bronlocatie;
- ordered semantic facts en checkpointvergelijkingen indien observability is
  gekozen;
- captures en logs;
- eerste aantoonbare afwijking.

Live en voltooide resultaten hebben een begrensde history. De result owner is
niet de runtime, testtree of UI-controller.

## Resolutie en input

### Presentatiebudget

De actieve IDE zet haar eigen render target expliciet op 384×288 in
[`ide/cart_editor.ts`](../ide/cart_editor.ts); `VideoPresenter` maakt die maat
ook werkelijk de viewport-, canvas- en offscreen-target
([`machine/ts/render/video_presenter.ts`](../machine/ts/render/video_presenter.ts)).
De IDE kiest standaard de `tiny`-fontvariant in
[`ide/workbench/state.ts`](../ide/workbench/state.ts). De atlas beschrijft de tiny
glyphs als 4×6 pixels
([`machine/ts/render/host_overlay/atlas.generated.ts`](../machine/ts/render/host_overlay/atlas.generated.ts)).
384×288 bevat dus hoogstens 96×48 kale glyphcellen. Dat is alleen een absolute
bovengrens: headers, tabs, status, padding, scrollbars en de actuele
`charAdvance`/`lineHeight` verkleinen het bruikbare vlak.

Studio-layout gebruikt de werkelijke viewport-, font-, advance- en line-height-
metrics zoals de bestaande
[`ide/workbench/common/layout.ts`](../ide/workbench/common/layout.ts). Een
desktopmockup dat achteraf naar 384×288 wordt verkleind is geen geldige
prototype-route.

### Layoutregels

- één task-focused hoofdvlak op lage resolutie;
- compacte header, breadcrumb en instance/filtercontext;
- list/tree als standaardweergave voor diep gedrag;
- details vervangen het hoofdvlak tijdelijk of verschijnen als compacte sheet;
- een graph gebruikt het volledige beschikbare canvas en vereist focus/pan/zoom;
- selectie, collapse-state, focus en scroll zijn retained;
- geen permanente scene/outliner/viewport/details-drieverdeling.

Wegwerpprototypes moeten ten minste testen:

- de echte Moon-BT met hergebruikte subtrees;
- lange namen en diep geneste composites;
- concurrente FSM-regions;
- veel runtime-instances;
- een grote testcollectie en lange failureteksten;
- 384×288 met de echte tiny font en live chrome-metrics.

### Keyboard, controller en pointer

De UX definieert eerst logische commands:

- focus vorige/volgende;
- expand/collapse/open/back;
- wissel view/tab/instance;
- search/command;
- run/cancel/rerun;
- vorige/volgende verandering in een trace.

Keyboard, D-pad/controller en pointer sturen dezelfde commands. De uiteindelijke
bindings worden pas na een conflict- en interactieprototype gekozen. Fysieke
device-assignment, shortcutregistratie en capture blijven bij
[`hosts/common/input/manager.ts`](../hosts/common/input/manager.ts) en
[`hosts/common/input/shortcuts.ts`](../hosts/common/input/shortcuts.ts). Wanneer
de workbench input bezit, bereikt hetzelfde event niet gelijktijdig ICU/gameplay.

De workbench implementeert die grens declaratief naar het VS Code-model. Een
typed command-id heeft een centrale presentatienaam; keybindings en named-menu-
contributies verwijzen naar dat id. Een generieke action bar projecteert de
view-title-menu en pointer, keyboard en controller voeren uiteindelijk hetzelfde
command uit. Featurecode spelt daarom geen sneltoetsen uit in statustekst en
tekent geen eigen Run/Cancel-knoppen. Contextuele enablement en de gewogen
keybindingresolver lossen conflicten zoals debugger-F5 versus Scenario-Lab-F5
op buiten beide features.

## Browser en libretro

Volgens [architecture.md](architecture.md#runtime-container-vocabulary) is
Studio een authoringproduct boven een host. De browser-Studio composition root
voegt workbench, workspace, compiler en source tooling toe; playerhosts importeren
Studio niet. Libretro heeft geen browser- of Studio-lifecycle.

Daaruit volgen twee onderscheiden productsurfaces:

- **Browser Studio:** volledige source-, behavior-, trace- en testworkbench voor
  de opties die de gebruiker kiest.
- **Libretro:** machine/core en playerhost blijven Studio-vrij. Een latere,
  afzonderlijk gekozen native testslice kan vooraf verpakte portable scenario's
  uitvoeren, compact pass/fail presenteren of traces/captures exporteren. Zij
  bouwt geen TypeScript-workbench in de core en introduceert geen tweede runtime.

Volledige visual authoring in libretro is geen impliciete eis. Als dat gewenst
wordt, is het een expliciete productarchitectuurwijziging en geen facade boven
de core.

## Owner-matrix

| Owner | Verantwoordelijkheid | Bezit uitdrukkelijk niet |
| --- | --- | --- |
| `machine/{ts,cpp}` | Deterministische uitvoering, save-state, CPU, memory, MMIO en devices. | Studio, BT/FSM/ActionEffect-semantiek, viewmodels. |
| Cartridge controller/card | Twee fysieke sockets, concrete card-devices en signaalroutering. | Studio-transport, behavior-capabilities, scene/data-ABI. |
| `cartlib` | Gameplaysemantiek en de echte BT/FSM/ActionEffect/eventgrenzen. Alleen na keuze eventueel generieke diagnostics. | Product-UI, `studio`-module, hostcontrols of source-documentmodel. |
| Toolchain/rompack | Eventuele static correspondence en testpackaging als de gekozen authored representatie dat vereist. | Runtime scene graph of machinehot-path-DTO. |
| `ide/language` | Generieke Lua/AEM/YAML syntax en semantics. | Cartlib-nodecatalogus in lexer/parser/binder/demand graph. |
| `ide/runtime/source_registry` | Exact geladen source records en revisions. | Behavior-runtimewaarheid. |
| `ide/runtime/debugger_state` | Bestaande PC/source breakpoints en stepping. | Automatisch semantic stepping. |
| `SuspendedGuestSession` | Lazy inspectie van echte guestwaarden wanneer uitvoering gestopt is. | Algemene live control-RPC. |
| `ide/workbench/contrib/*` | Behavior-, trace- en testviews, commands, selectie, filters, results en sourcenavigatie. | Canonieke game/graphdata. |
| Workspace/editor | Canonieke bron/resource, dirty state, undo/redo/save en Hot Resume. | Runtime instance state. |
| `hosts/common` | Eén Runtime, frame lifecycle, fysieke input, audio/video en capture. | Gameplaysemantiek en Studio-Domain-DTO's. |
| Headless tooling | Scenario-uitvoering, inputtimeline, captures en CI-resultaten. | Live productcontrolprotocol. |
| C++/libretro | Corepariteit en eventueel expliciet gekozen native scenario-execution/presentatie. | Browser-Studio en editorworkbench. |

## Acceptatiefasen

De fasen beschrijven beslis- en bewijsgrenzen. De concrete implementatieslices
staan in [`open_architecture_slices.md`](open_architecture_slices.md).

### Fase 0 — Productkeuze zonder ABI — geaccepteerd

- A + C is gekozen;
- stop-and-inspect is gekozen;
- arbitrary Lua is gekozen voor de eerste source-lens;
- exacte per-node BT-runtimecorrespondence valt buiten die eerste lens;
- libretro blijft speler/core;
- geen machine-, cartlib-, transport- of guest-ABI-wijziging.

### Fase 1 — Static source lens

- echte `moon_tree` met hergebruikte subtrees;
- representatieve nested/concurrent FSM en ActionEffects;
- source navigation in beide richtingen;
- dynamic/unresolved constructs worden eerlijk weergegeven;
- geen frameworkkennis in language core;
- geen graph edits of runtime-instrumentatie.

### Fase 2 — Scenario Lab

- bestaande tests worden zonder duplicaatregistratie ontdekt;
- run, cancel en rerun werken via de gedeelde execution owner;
- bounded live/completed result history;
- input, fault, log en capture zijn terugvindbaar;
- failure navigeert naar bron;
- dezelfde startconditie en inputvolgorde geven hetzelfde aantoonbare resultaat;
- geen generieke live-RPC-facade.

### Fase 3 — Geselecteerde observability

- concrete instance- en categoriekeuze;
- static topology apart van runtime-deltas;
- feiten voor de gekozen BT/FSM/ActionEffect/blackboard/eventworkflows ontstaan
  op echte ownergrenzen;
- correspondence is exact of expliciet niet beschikbaar;
- paused inspection gebruikt true guest-values;
- geen per-frame allocaties of volledige snapshots;
- disabled/release-overhead en retained geheugen zijn gemeten.

### Fase 4 — Optionele visual authoring

- alleen na geaccepteerde constrained document-/resourcekeuze;
- graph edits wijzigen het echte document/resource;
- undo, redo, save, revert en Hot Resume gebruiken de bestaande owners;
- geen tweede graphdatabase;
- arbitraire Lua blijft source-first.

### Fase 5 — Semantic break/step

- expliciete keuze voor debug-instrumentatie of scenario-step;
- break op aantoonbare enter/exit/transition/effectgrenzen;
- geen generieke release-hot-path-hookfacade;
- één Runtime en geen PIE.

## Uitgestelde beslissingen

De eerste A + C-slices vereisen geen keuze over onderstaande onderwerpen en
bouwen er daarom ook geen abstractie voor:

1. Welke semantic facts een eerste recorded observabilityworkflow nodig heeft.
2. Welke echte produceridentiteit BT-occurrences aan runtimefeiten koppelt.
3. Of visual authoring later een constrained tekstformaat (D) of structured
   resource (E) gebruikt.
4. Of een live-monitorlifecycle naast stop-and-inspect ooit productscope wordt.
5. Of portable native scenario-execution ooit een afzonderlijk libretrodoel
   wordt.

Transport, correspondenceproductie en debug/release-instrumentatie worden pas
ontworpen wanneer een latere slice een van deze productkeuzes werkelijk maakt.

## No-go's

- een scene-outliner, transform-details of gizmo-first Studio;
- hostcode die `world._objects`, componenttabellen of Lua-objectshape als scene-
  of behavior-DTO leest;
- socket 1, mailbox, board-id, capabilitybit, PCRTC-circuit of cartridge-RAM als
  vooraf gekozen Studiofundament;
- OverlayRenderer-gizmos of een guest-rendered editorviewport;
- tweede Runtime, tweede world of PIE;
- gameplay-clock gebruiken als debugger-pause;
- generieke `runtime.call`/`callClosure`, host-Lua-RPC of hostmutation-API;
- dense BT execution slots, Lua-objectidentiteit of sourceregels presenteren als
  stabiele authored node-id;
- ontbrekende ActionEffect rejection reasons in de host raden;
- volledige tree-, heap- of worldsnapshot per tick;
- cartlib/BT/FSM/ActionEffect-typen in generieke lexer, parser, binder of demand
  graph;
- een los graphmodel naast het canonieke document/resource;
- beweren dat source stepping semantic stepping is;
- TypeScript Studio/workbench in de libretro core;
- visual authoring implementeren voordat de authored representatie is gekozen;
- alvast een transport-, ABI-, inspector-, multi-world- of debugfacade bouwen
  voor een nog niet gekozen productoptie.
