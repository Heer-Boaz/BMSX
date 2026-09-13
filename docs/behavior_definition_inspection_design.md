# Declaratieve behavior-authoring en inspectie van geladen definities

Datum: 2026-09-13. Live baseline: `c30009e07`.
**Status: D1-history/composite broninputs, de generieke D2-leesbasis en gerichte
ActionEffect-/FSM-instance-inspectie gebouwd; geen volledige definitiecatalogus.**

Dit document verwerkt de bijgestelde productgrens: cartlib ondersteunt al een
declaratieve manier van programmeren; die is de norm voor visuele authoring.
Het is geen opdracht om alle mogelijke Lua-programma's grafisch omkeerbaar te
maken. Het begrenst de eerder open factory-/API-herkomst als voorwaarde voor
verdere Behavior Lens-UX, zonder correcte taalfeiten of bronbewerkingen te vervangen.

## 1. Beslissingen en grenzen

- **Gewone declaratieve Lua blijft de enige auteursbron.** Geen nieuw behavior-
  assettype, bestandssuffix, ROM-record, Resource-framework, decoder of manifest.
- De bestaande registratie en compilatie in cartlib blijven bepalen wat draait.
  De IDE introduceert geen tweede evaluator voor cartlib-definities.
- Een bronweergave, een geladen definitie en een uitvoerende actor zijn
  verschillende inspectiedoelen. Een runtimewaarde wordt niet stilzwijgend een
  bronliteral; een bronkandidaat is niet automatisch een uitgevoerde registratie.
- Grafische authoring blijft bronbewerking met bestaande working copies, Save,
  Undo en Hot Resume. Een toekomstige expliciete runtime-mutatie is een andere
  operatie; dit ontwerp bouwt die niet en doet niet alsof zij bron opslaat.
- Geoptimaliseerde uitvoeringsstructuren worden niet terugvertaald naar een
  vermoedelijke declaratie. Ook wordt cartlib niet gedeoptimaliseerd voor de UI.
- De hierna genoemde BMSX-keuzes zijn **afleidingen uit benoemde referenties**.
  Er wordt geen bestaand engine-protocol of bewezen BMSX-implementatie geclaimd.

## 2. Wat de professionele implementaties daadwerkelijk doen

### UE5: expliciete asset, geladen boom, aparte instantiestate

De openbare [UBehaviorTree-API][ue-tree] onderscheidt `BTGraph`, `RootNode` en
`InstanceMemorySize`. De [editorworkflow][ue-workflow] opent een Behavior Tree-
asset zonder eerst gameplay te doorlopen. De [debugworkflow][ue-debug] koppelt
de graph aan uitvoering en blackboardwaarden. Dat bewijst niet dat Unreal
willekeurige C++-factories verliesloos naar bewerkbare graphnodes terugvertaalt.

**Overnemen:** definitie en instantie niet verwarren; uitvoering aan een bekende
definitie koppelen. **Niet overnemen:** hun assetformaat als verplicht nieuw
opslagformaat voor cartlib. Onderzocht: officiële API-/workflowdocumentatie;
geen claim dat de besloten volledige UE5-editorimplementatie is nagekeken.

### Godot: Resource-bewerkingen, niet GDScript herschrijven

Onderzocht op `c24bf5d933c53d9477d5e82c51403856a9e7da62`.
De [AnimationNodeStateMachine-editor][godot-editor] reconnect een transitie met
de modeloperaties `remove_transition` en `add_transition` en de bijbehorende
Undo-operaties. De [resourcebeschrijving][godot-resources] verklaart hoe property-
waarden worden geladen en opgeslagen. Dit is een animatie-FSM, geen ingebouwde
algemene Godot-BT-editor. Het gedeelde modelcontract betekent bovendien niet
dat editor en draaiend project noodzakelijk dezelfde geheugeninstantie hebben.

**Overnemen:** operaties op het domeinmodel, met afzonderlijke persistence en
history. **Niet overnemen:** serialisatie van een Lua-runtimeobject alsof dat
de oorspronkelijke Lua-expressies en comments bewaart.

### LimboAI: een concreet Godot-BT-voorbeeld

Onderzocht op `3f14ea4c26911e8b8e30c6bcdb575fc589a59deb`.
[BehaviorTree::instantiate][limbo-tree] cloneert de authored taskboom en maakt
een BTInstance. [BTInstance][limbo-instance] bewaart onder andere de bronboompath
en instance-owner. De [debugger][limbo-debugger] registreert instanties en
abonneert op updates van de geselecteerde instantie; die updates worden voor
de editor geserialiseerd. Debuggerregistratie is debug-buildgebonden.

**Overnemen:** expliciete definitie-/instance-identiteit en gerichte observatie.
**Niet kopiëren:** een volledige taskboom per actor, hun fallbacktask of volledige
boomserialisatie bij iedere geselecteerde update. Die kosten zijn niet bewezen
passend voor BMSX. Dit voorbeeld maakt hun bronbestand terugvindbaar; het levert
geen Lua-veldherkomst voor onze factories.

### Qt Design Studio / Qt Creator: de beter passende broneditorreferentie

Onderzocht op `f6e59e3b21aa8e086af27db922d1347a0610dcb4`.
[RewriterView][qt-rewriter] scheidt text-to-model en model-to-text. De
[ModelToTextMerger][qt-text] plant gerichte property- en reparentbewerkingen;
`applyChanges` voert bronrefactorings gegroepeerd uit. Daarnaast verwerkt
[NodeInstanceView][qt-instances] werkelijke instancewaarden. `valuesChanged`
actualiseert instance-informatie; `valuesModified` is een afzonderlijk pad
voor expliciete bewerkingen. Evaluatieresultaten zijn dus niet zomaar bronedits.

De [gedocumenteerde UI-subset][qt-subset] begrenst welke declaratieve constructies
de designer ondersteunt. Dat is een concreet professioneel voorbeeld van een
authoringcontract, in plaats van onbeperkte programmareconstructie.

**Overnemen:** declaratieve norm, behoud van geschreven bindings/expressies,
gerichte bronoperaties en gescheiden runtime-informatie. **Niet kopiëren:**
`.ui.qml`, hun componentbeperkingen, previewproces, modeldatabase,
herparse-/reindentbeleid of eventuele herstelpaden. BMSX heeft hiervoor al
tekstmodellen, semantische snapshots en gerichte Lua-editowners.

## 3. Live BMSX-owners: wat bestaat al en wat ontbreekt?

| Onderdeel | Live owner en betekenis |
| --- | --- |
| BT-registratie | [library.lua](../cartlib/behaviour_tree/library.lua): compileert, installeert en rebindt geïndexeerde componenten. Geen tweede Studio-registratie. |
| BT-definitie versus programma | [program.lua](../cartlib/behaviour_tree/program.lua): de declaratie is compilatie-input. Het geïnstalleerde programma bewaart evaluator, operanden, reset en statefactory; geen complete auteursboom. |
| Verlies van authored structuur | [node_program.lua](../cartlib/behaviour_tree/node_program.lua): een sequence met één kind wordt de evaluator van dat kind. Een sluiting of operand is daarom geen algemeen terugleesbaar nodemodel. |
| BT-instantie | [bt_component.lua](../cartlib/behaviour_tree/bt_component.lua) en [execution_layout.lua](../cartlib/behaviour_tree/execution_layout.lua): gedeeld programma, eigen slots/blackboard/services. Rebind vervangt uitvoeringsgeheugen; blackboardwaarden worden per semantische sleutel behouden. Slotnummer is geen blijvende auteursidentiteit. |
| FSM | [library.lua](../cartlib/fsm/library.lua), [fsm.lua](../cartlib/fsm/fsm.lua) en [fsm_component.lua](../cartlib/fsm/fsm_component.lua): de geladen state-definitiehiërarchie blijft bestaan; handlers, paden en evaluatie worden afgeleid/gecompileerd. De oorspronkelijke blueprint en geladen definitie zijn niet identiek. |
| ActionEffect | [actioneffects.lua](../cartlib/actioneffects.lua) en [actioneffect_component.lua](../cartlib/actioneffects/actioneffect_component.lua): de aangeleverde definitie blijft bewaard. Een gegund effect verwijst naar zijn definitie en heeft eigen cooldown-/periodieke state. |
| Componentcatalogus | [registry.lua](../cartlib/registry.lua) indexeert bestaande entries. Dit is niet tevens een catalogus van alle geregistreerde maar ongebruikte behavior-definities. De afzonderlijke definitieregisters zijn lokale tabellen. |
| Broninterpretatie | [source_reader.ts](../ide/workbench/contrib/behavior_lens/source_reader.ts) consumeert geschreven workspacefeiten. [API-herkenning](lua_source_api_bindings.md) consumeert generieke importpaden via ongewijzigde locals; die bewijzen geen uitvoering of exclusieve runtime-API-herkomst. |
| Bestaande inspectie | [suspended_guest.ts](../ide/runtime/suspended_guest.ts) leest de echte VM-representatie; de bestaande Scenario-observers lezen geselecteerde guestkanalen. Geen van beide is al een algemene geladen-definitiecatalogus. |
| Bron versus installatie | [sources.ts](../ide/runtime/sources.ts) en [runtime_source_status.ts](../ide/workbench/services/working_copy/runtime_source_status.ts) kennen werkbron en geïnstalleerde bron. Dat is niet automatisch de herkomst van iedere huidige heapdefinitie. |

Registratie is niet hetzelfde als een willekeurige tabel openen. Bijvoorbeeld
[Nemesis' ActionEffect-registratie](../carts/nemesis_s/player/actioneffects.lua)
berekent timing nadat de wereldcadans is ingesteld. Een editor mag dat niet
los op de host uitvoeren met een verzonnen clock of een tweede Lua-interpreter.
De normale cart-entry en expliciete `<init>`-route blijven uitvoeringseigenaar.

## 4. Declaratieve authoringnorm

Dit is een contract voor grafische authoring, **geen nieuwe beperking van BLua**.
Runtimecode buiten het contract blijft gewone uitvoerbare Lua.

1. Definities gebruiken de bestaande publieke registratie-API en bestaande
   veldrollen van cartlib. De gebruikte API wordt niet tijdens authoring door
   een andere functie met hetzelfde module-/memberpad vervangen.
2. De te bewerken structurele velden hebben een concrete geschreven eigenaar:
   bijvoorbeeld een BT-childlijst, FSM-state of ActionEffect-property. Ze mogen
   via gewone bindings/imports/reexports in andere bestanden staan. Eén bestand,
   een specifieke localnaam of overal `<const>` schrijven is geen vereiste.
3. Callbacks en berekende scalarwaarden blijven gewone Lua-expressies. De editor
   hoeft een handler niet uit te voeren om diens aanwezigheid of bron te tonen.
   Een live uitkomst vervangt niet automatisch de geschreven expressie.
4. Hergebruik blijft hergebruik. Een edit aan een gedeelde declaratie verandert
   die declaratie; de UI belooft geen lokale runtime-instantiewijziging. Bij
   een move blijven bestaande binding- en initialisatie-effectreviews geldig.
5. Factories kunnen normale definities registreren. Ze hoeven niet verwijderd
   te worden. Een unieke grafische schrijfplek voor elk geproduceerd runtimekind
   volgt er echter niet uit. Dat vraagt een expliciete auteursoperatie op de
   betreffende declaratie of aanroep; geen automatische clone/extract-rewrite.

De API-norm is geen excuus om de huidige beperkte recognizer alsnog een
runtimebewijs te noemen. De bronnencatalogus beschrijft authored registraties
binnen dit contract; een geladen catalogus beschrijft werkelijk gepubliceerde
definities. Voor die laatste is daadwerkelijke runtime-identiteit nodig.

Het contract vereist geen opsomming van alle mogelijke functie-uitkomsten.
Correcte generieke taalqueries blijven bruikbaar voor navigatie en edits;
verdere universele factory-expansie is geen gate voor iedere behaviorfeature.

## 5. Drie inspectiedoelen, geen drie auteursdatabases

| Vraag | Waarheid en lifetime | Toegestane verandering |
| --- | --- | --- |
| Wat heb ik geschreven? | Bestaande working copy en semantische snapshot, ook vóór boot en bij onopgeslagen tekst. | Gerichte Lua-edit met normale documenthistorie. |
| Wat is daadwerkelijk ingeladen? | Een concrete registratie/definitie in de huidige guest, niet alleen het geïnstalleerde bronbestand. | Deze inspectieroute leest; bronbewerking gaat naar een bewezen auteursplek. |
| Wat doet deze actor nu? | De geselecteerde instance en zijn huidige uitvoeringsstate. | Lezen via debugger-/observatieowners; niet impliciet terugschrijven naar gedeelde definities. |

Dezelfde graphcontrol kan de presentatie verzorgen. Dit document introduceert
geen nieuwe tabs, modusknoppen of commandfamilie om de ontbrekende data-eigenaar
te verbergen. Eerst moeten identiteit, write-target en lifetimes kloppen.

Een callback in een geladen FSM blijft een callback. De aanwezigheid ervan
geeft niet alle mogelijke toekomstige transities prijs. Een uitgevoerde
transitie is een observatie, geen bewijs dat de andere paden niet bestaan.
Ook een niet-geregistreerde definitie blijft vanuit haar bron bewerkbaar; een
live-only catalogus mag die huidige authoringmogelijkheid niet vervangen.

## 6. Inspectiegrens: leesbasis gebouwd, catalogus/topologie nog open

**Voorkeursrichting:** lees behouden definities/instancegegevens via de bestaande
debuggerrepresentatie; verkrijg ontbrekende topologie bij de cartlib-owner die
de definitie interpreteert, niet door de host diens evaluators te laten raden.

Bij ActionEffects kan eerst één bestaande effectinstantie worden geïnspecteerd.
Die bezit al een definitiereferentie. Een volledige catalogus, óók zonder
actorinstanties, is een afzonderlijke ontdekking-/publicatieverantwoordelijkheid.
FSM-definities zijn eveneens aanwezig, maar hun gecompileerde handlers en
actieve instances mogen niet als de oorspronkelijke bron worden voorgesteld.

Voor BT's moet vóór implementatie een concrete ownerproef de keuze vastleggen:

| Route | Wat zij oplost | Nog te bewijzen / oordeel |
| --- | --- | --- |
| Alleen bestaande evaluator-/closurestructuren lezen | Kan actuele uitvoeringsgegevens blootleggen. | **Geen auteurstopologie.** Afgewezen als algemene definitiereconstructie; single-child lowering is al een tegenvoorbeeld. |
| De bestaande declaratie éénmaal per geïnstalleerd programma behouden | Houdt ingeladen topologie beschikbaar zonder een boom per actor. Sluit conceptueel aan op behouden engine-definities. | Extra retained guestgeheugen en GC-live-set; publicatie, sharing en mutable aliases moeten expliciet worden gemeten/ontworpen. Niet alvast overal `program.definition` toevoegen. |
| Ontwikkelinformatie bij interpretatie/compilatie vastleggen | Scheidt auteursrelaties van de geoptimaliseerde uitvoer, zoals engines editor-/debuggegevens scheiden. | De feitelijke opname, nodecorrespondentie, attach-na-boot en rewind moeten via bestaande tooling-/debuggerowners bewezen worden. Geen ontworpen-op-papier debug-ABI als voldongen feit. |

De voorbeelden schrijven de keuze tussen de laatste twee routes niet voor
voor een 33 MHz-emulator. **Dit ontwerp kiest dus nog geen extra opslagveld,
tracekanaal, persistent id of protocol op gevoel.** Dat is de resterende
technische proef, niet een aanleiding voor een generiek Resource-framework.

De bestaande `blua32.trace` is geen kant-en-klare oplossing: de compiler kan
haar wissen of emitteren, maar [scenario_cartridge.ts](../toolchain/ts/rompack/scenario_cartridge.ts)
is nu de uitvoerproducer die haar aanzet. Gewone debug-ROMs en Hot Resume wissen
de statements. Bovendien koppelt een sink aan een concrete subjecttabel; hij
maakt niet vanzelf een late-attachbare definitiecatalogus of bronmapping.
Dat contract veranderen vereist een eigen onderbouwde toolingwijziging.

## 7. Identiteit, publicatie en herstart zijn harde voorwaarden

- Een publicatie geldt pas voor de handeling die werkelijk is uitgevoerd.
  Inspectie midden in registratie/rebind mag niet suggereren dat alle actors
  al aan dezelfde nieuwe definitie hangen. Een fout krijgt geen rollback,
  hersteldefinitie of fictief succesvol registratie-event.
- Een code-installatie is geen definitiepublicatie. [Hot Resume](../ide/runtime/hot_resume.ts)
  kan ook zonder bronwijziging `<init>` uitvoeren en heapdefinities vervangen.
  Bestaande `applied`-bronstatus bewijst dus niet zelfstandig de herkomst van
  iedere geladen definitie. Een feature-eigen teller lost dit niet vanzelf op.
- Actoridentiteit, definitie-identiteit, source occurrence en uitvoeringsslot
  blijven onderscheiden. Geen koppeling uitsluitend op gelijke id-string,
  callbackfunctie, bestandsnaam, canvaspositie of actuele arrayindex.
- Oude guestreferenties worden na reset, restore of vervanging niet opnieuw
  gebruikt. Bestaande restore-notificaties, debuggerstops, broninstallatie en
  componentrebind bepalen de lifetime. Rewind mag geen oude heap combineren
  met een cache van latere definities; attach mag geen nieuwe boot afdwingen.
  Dit blijft binnen het bestaande historycontract: Hot Resume kan history
  beëindigen. Inspectie verzint geen rewind over die grens en houdt geen tweede
  executable image of verloren geschiedenis in leven.
- Onopgeslagen bron en geladen bron kunnen verschillen. De bestaande source-
  en navigatieowners moeten dat verschil dragen. Geen live locatie openen in
  andere bytes en geen registratie als definitiebron vermommen.
- Alleen waarnemen voert geen getters/callbacks uit, roept geen `<init>` aan en
  verandert geen guestclock, dirty-state, Undo of rewindgeschiedenis.

### Representatie en TS/C++

De oorspronkelijke ontwerpslice wijzigde geen gespiegelde code. De D2-leesbasis
werkt inmiddels de TS/C++-debugsymbolen bij; zie `lua_runtime_inspection.md`.
De live representatiegrens voor verdere runtime-uitbreiding is:

| Gegeven | TypeScript | C++ | Owner / regel |
| --- | --- | --- | --- |
| Guestwaarde | `Value`, centrale `valueTag`/`ValueSlots` | NaN-gecodeerde `Value`, centrale value-functies | `machine/*/machine/cpu/value.*`; enumgetallen zijn geen gedeeld wire-format. Geen JS-shapeclassificatie of lokale conversies. |
| Tabel/closure | VM-`Table`/`Closure` | GC-beheerde `Table`/`Closure` | Geleende runtimewaarden, geen blijvende hostobject-id of ongeregistreerde GC-root. |
| Uitvoeringsdomein | `ExecutionDomainId` | `ExecutionDomainId` | Bestaande domeinen `-1/0/1`, geen behaviornamespace in hardware. |
| Debug-stop | `CPU.setExecutionHook` | `CPU::setExecutionHook` | Generiek instructie-/domeinmechanisme, geen cartlib-event in de CPU. Continu hooken is geen gratis observatie. |
| Restore | `Runtime.onStateRestored` | `Runtime::onStateRestored` | Host/tooling laat geleende inspectiestate los en leest opnieuw. |
| Broninformatie | Geïnstalleerde symbolen, ranges, locals/captures | Dezelfde toolinginformatie waar een native tool haar consumeert | Geen source-/behaviorloader toevoegen aan gewone libretro-gameplay. |

Voor een runtimepatch moeten ook alle concrete callsites worden benoemd:
registratie/installatie/rebind, BT compile/lowering, BT evaluate/service-
requests, FSM transition/frame-evaluators, ActionEffect trigger/periodic,
CPU-hookdispatch, GC en restore. Dit ontwerp machtigt geen wijziging daaraan.

## 8. Kostencontract en veranderbestendigheid

- De ongeobserveerde gameplayroute krijgt geen per-tick veldvalidatie,
  topologywalk, debug-dispatch of allocation. Release/trace-erasure wordt aan
  de uitgegeven instructies en retained heap getoetst, niet aan een flagnaam.
- Selectie-/registratiewijzigingen mogen gerichte hostprojectie vereisen;
  draw, pan en zoom consumeren retained data. Geen nieuwe workspacequery per
  node of frame, geen volledige heapscan om definities te vinden.
- Een gedeelde definitie wordt niet per actor gedupliceerd voor de UI.
  Iedere voorgestelde opname meet zowel transient allocations als blijvende
  guest-/hostbytes, inclusief GC-rooting en het effect van opnieuw registreren.
- Interne cartlib-refactors met hetzelfde publieke gedrag veranderen geen
  graphcontrol of Lua-parser. Een nieuw publiek veld/nodetype kan de cartlib-
  bijdrage veranderen. De betekenis daarvan kan niet automatisch uit syntax
  worden geraden; dat is legitieme domeinkennis, geen reden voor schema-DTO's.
- Een tweede taal krijgt haar eigen syntax-/bronbewerkingen en eventueel een
  andere debuggerweergave van waarden. Gedeelde tekst-/history-/graphowners
  blijven herbruikbaar. Geen universele AST of dynamisch pluginsysteem alleen
  om hypothetische toekomstige talen te kunnen noemen.

## 9. Vervolgslices met bewijs vóór verbreding

### D1 — Het gedeelde declaratieve bron-/bewerkingscontract

Veranker de norm in de bestaande recognizer, document-/rangeowners en edit-
admission, zonder een nieuw taalmodel. Behoud imports, gedeelde onderdelen,
berekende scalars, callbackbron en meerdere definities per bestand. Markeer
source discovery niet als bewezen runtimepublicatie. Cross-file mutaties
vereisen gedeelde multi-model edit/history, niet twee losse document-Undo's.

**Gate:** één onafhankelijke fixturefamilie door het bestaande harnas: direct,
alias, import/reexport, gedeelde childlijst, callbacks/scalars en twee definities
in één bestand. Dezelfde bronoperatie behoudt echte write-targets, trivia en
Undo; verplaatste bindings blijven correct. Variaties buiten het contract
mogen geen verkeerde bron bewerken of de bestaande editor laten vastlopen.

**Implementatiestatus:** de gedeelde [workspace-edit/history-owner](editor_workspace_history.md)
is gebouwd, met de bestaande cross-file Rename als eerste productconsument.
Een gezamenlijke edit wordt vanuit beide bestanden als geheel ge-Undo'd;
tussenliggende edits, vertakkingen en resourcelevensduur hebben expliciete
historysemantiek. Het [composite broninputcontract](editor_composite_sources.md)
sluit inmiddels ook Save/dirty/focus voor geïmporteerde ActionEffect-velden en
BT-bewerkingen binnen een providerbestand. Ook [FSM initial/path-edits](state_machine_source_ownership.md)
gebruiken nu hun echte bronmodel, inclusief een literal in een apart callbackbestand.
De registratiebron krijgt geen dummy-edit. Dit sluit niet de hele D1-gate:
de [API-bindingcorrectie](lua_source_api_bindings.md) ondersteunt gewone
ongewijzigde importlocals en member-aliases zonder `<const>`-vereiste.
Expliciete module/member-reexports gebruiken dezelfde snapshot-query tot aan
de publieke API-grens. Relocatie tussen verschillende bestanden, aggregate
API-exporttabellen en wrappers blijven
open. Ook runtime-inspectie is hiermee niet geïmplementeerd.

### D2 — Eén behouden definitie en één geselecteerde runtime-instantie

Begin bij de bestaande ActionEffect-definitiereferentie, niet bij een nieuw
catalogus-/protocolframework. Bewijs via normale guestregistratie en de echte
debugger dat bronexpressie, geladen waarde en instancewaarde onderscheiden zijn.
Dezelfde levensduur moet bij selectie, pause/continue, Hot Resume en restore
werken. Pas daarna de geladen FSM-hiërarchie en catalogusownership uitbreiden.

**Implementatiestatus:** [de generieke Lua-inspectiegrens](lua_runtime_inspection.md)
en [gerichte ActionEffect-instance-inspectie](actioneffect_runtime_inspection.md)
zijn gebouwd. De [FSM-vervolgslice](state_machine_runtime_inspection.md) kiest
een echte machine en daarna een state uit zijn behouden hiërarchie; zij leest
de eigen definitie en data van die state, ook midden in rebind. `Live` gebruikt
de bestaande registry-type-index en gedeelde kiezer/property inspector.
De geselecteerde instance en haar geladen definitie
blijven gescheiden van de open authored registratie, ook bij dezelfde effect-id.
Een onafhankelijke Studio-proef bedient de echte UI tijdens midden-in-rebind,
no-change `<init>`, gewijzigde installatie, compilefout en rewind. De compiler
en TS/C++-symbolowners leveren geldige debuglocaties; callback-Source volgt het
actuele instruction-bus-calltarget en vereist overeenkomende bronbytes.
Geen interpreterfallback, extra cartlib-state of bronwriteclaim. D2 blijft open
voor een catalogus inclusief ongebruikte definities, algemene actorselectie en
definitie-allocation-/registratiecorrespondentie. Een callbackbron bewijst niet
waar de omvattende definitietabel is gemaakt.

**Gate:** read-only inspectie zonder callbacks/guestmutatie; registratie zonder
actor niet verwarren met een lege definitie; no-change `<init>`, compilefout,
rebindstop en rewind geven geen stale bron-/heapkoppeling. Een actieve actor
krijgt geen volledige definitiekopie. TS/C++-representationele gelijkwaardigheid
wordt afzonderlijk bewezen; IDE-rendererproeven vervangen native bewijs niet.
Twee geschreven registraties van dezelfde id moeten bovendien verschillend
blijven van de definitie die nu daadwerkelijk aan de geselecteerde actor hangt.
Een correct gelezen waarde zonder bewezen sourcecorrespondentie is nog geen
geslaagde Source-link of grafische schrijfroute.

### D3 — BT-definitiecorrespondentie door de echte lowering heen

Vergelijk de twee nog mogelijke opnamekeuzes uit §6 op dezelfde normale
cartlib-compilatie. Geen alternatieve compiler, cartspecifieke fixturedecoder
of wijziging van de evaluator om gemakkelijker te kunnen tekenen.

**Gate:** single-child collapse, gedeelde subtrees, services/decorators, opaque
callback, twee actors, herregistratie en restore. Auteursnode, geladen node en
uitvoeringsslot worden aantoonbaar niet gelijkgesteld. Meet codebytes, heap-
retentie, opnamekosten en ongeobserveerde tickkosten vóór de productkeuze.
Daarna pas live BT-status op de graph aansluiten.

De volledige gates van deze slices zijn nog niet gesloten. De bredere UX-lijst blijft
bestaan, maar wordt niet langer gegijzeld door volledige analyse van alle
denkbare factories. Correctheidsfouten in gedeelde taalowners blijven echte
bugs; dit scopebesluit rechtvaardigt geen naamheuristiek of bekende verkeerde
bronlink.

## 10. Onderzoeksbewijs van deze ontwerpslice

De genoemde BMSX-owners zijn gelezen op de bovenstaande baseline. Godot,
LimboAI en Qt Creator zijn op de vermelde commits vastgezet en hun genoemde
methodes zijn in de daadwerkelijke GitHub-bron gecontroleerd. De resource-
en UI-subsetdocumentatie is op 2026-09-13 geraadpleegd. Lokale onderzoekskopieën:
`/tmp/bmsx-behavior-contract-design/refs/`.

Er is geen runtimeproef, performancewinst, werkende native inspectie of nieuw
publicatieprotocol bewezen in deze documentwijziging. De kosten- en lifetimes-
proeven hierboven zijn acceptatievoorwaarden, geen alvast behaalde resultaten.

Documentvalidatie: 26 nieuw toegevoegde lokale Markdown-links bestaan;
`audit:architecture-boundaries:strict` meldt 0 issues, `audit:core-parity` en
`git diff --check` slagen. Ongewijzigde historische voorbeeldlinks vallen buiten
die linkcheck. Er zijn voor deze documentslice geen product-/runtime-tests gedraaid.

[ue-tree]: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/AIModule/UBehaviorTree
[ue-workflow]: https://dev.epicgames.com/documentation/en-us/unreal-engine/behavior-tree-in-unreal-engine---user-guide
[ue-debug]: https://dev.epicgames.com/documentation/en-us/unreal-engine/behavior-tree-in-unreal-engine---quick-start-guide
[godot-editor]: https://github.com/godotengine/godot/blob/c24bf5d933c53d9477d5e82c51403856a9e7da62/editor/animation/animation_state_machine_editor.cpp#L140-L170
[godot-resources]: https://docs.godotengine.org/en/stable/tutorials/scripting/resources.html
[limbo-tree]: https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/bt/behavior_tree.cpp#L80-L96
[limbo-instance]: https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/bt/bt_instance.cpp#L34-L95
[limbo-debugger]: https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/debugger/limbo_debugger.cpp#L131-L178
[qt-rewriter]: https://github.com/qt-creator/qt-creator/blob/f6e59e3b21aa8e086af27db922d1347a0610dcb4/src/plugins/qmldesigner/libs/designercore/rewriter/rewriterview.cpp#L59-L65
[qt-text]: https://github.com/qt-creator/qt-creator/blob/f6e59e3b21aa8e086af27db922d1347a0610dcb4/src/plugins/qmldesigner/libs/designercore/rewriter/modeltotextmerger.cpp#L67-L180
[qt-instances]: https://github.com/qt-creator/qt-creator/blob/f6e59e3b21aa8e086af27db922d1347a0610dcb4/src/plugins/qmldesigner/instances/nodeinstanceview.cpp#L1520-L1569
[qt-subset]: https://doc.qt.io/qtdesignstudio/creator-quick-ui-forms.html
