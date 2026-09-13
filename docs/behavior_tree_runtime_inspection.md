# BT-instance-inspectie zonder gereconstrueerde auteurstopologie

Datum: 2026-09-13. Owneraudit op `bc0fc8735`.

## Referentie en keuze

Daadwerkelijk gelezen productiebron, LimboAI op
`3f14ea4c26911e8b8e30c6bcdb575fc589a59deb`:

- [LimboDebugger::_track_tree / _untrack_tree][tracking] selecteert een concrete
  instance; `_on_bt_instance_updated` observeert uitsluitend die selectie.
- [Blackboard::_get / _get_property_list][blackboard] presenteert de opgeslagen
  variabelen van het gekozen blackboard, niet de defaults van een bronasset.
- [BehaviorTreeData::serialize][topology] leest behouden taskobjecten met hun
  eigen identiteit, kinderen en status. Dat is **niet** de BMSX-representatie.

Overgenomen: instancekeuze, eigen blackboardwaarden en een begrensde leesduur.
Niet overgenomen: taskboomklonen, runtime-signalen/serialisatie per update,
reflectie-getters, guards of een nieuwe debuggerregistry in cartlib. BMSX heeft
al een type-index, een stilgezette guest en een retained property inspector.

## Live owners en contract

- `cartlib/behaviour_tree/library.lua` compileert en publiceert programma's.
  `node_program.lua` laat lege/single-child composites verdwijnen; dezelfde
  authored tabel kan op twee plaatsen verschillende uitvoeringsslots krijgen.
- `bt_component.lua` kopieert evaluator/operand/reset uit het programma en
  bezit zelf execution memory, actieve services en het blackboard. Een gelijke
  `tree_id` bewijst niet dat een component al aan de nieuwste registratie hangt.
- `blackboard.lua` bewaart op de instance de eigen `_layout` en `_values`.
  `keys` geeft de namen, ook van slots met `nil`; herregistratie remapt waarden
  op naam. Niet indexeren via de nieuwste programmacatalogus of via de bron.
- Een debugger mag midden in rebind stoppen. Inspectie leest dan de werkelijk
  opgeslagen velden, niet een veronderstelde atomische toestand na de call.
  `nil` layout/storage tijdens eerste binding is zichtbaar als zodanig; geen
  vervanging door defaults, een lege tabel of een oude layout.
- `registry.lua` levert uitsluitend de bestaande BT-componentbucket. Geen
  heapscan, bronquery, callbackaanroep of andere interpretatie op de host.

De BT-graph krijgt dezelfde **Live**-route als de FSM. De gedeelde kiezer
onderscheidt component en owner bij gelijke boom-id. De bestaande inspector
toont eerst de eigen blackboardwaarden, daarna scheduling, ruwe execution
memory en daadwerkelijke calltargets. Een slot wordt niet als node aangeduid.
Alleen bestaande closure-symbolen leveren Source; scalarwaarden worden geen
schrijfplek en de gekozen authored registratie wordt geen runtimebewijs.

`SuspendedGuestSession` beëindigt de picker-/inspectorduur vóór uitvoering en
bij restore. Paint en scroll gebruiken uitsluitend vooraf gemaakte hostrows.
Geen gastgegevens worden in een editorinput opgeslagen. Inspectie voegt geen
cartlib-, CPU-, C++-, snapshot- of tick-pad toe. De echte rebindproef vond wel
de hieronder beschreven fout in de bestaande BT-compilatie.

## Gevonden compilerfout: absent reset is geen callback

De eerste echte Studio-run stopte tijdens Hot Resume met `CALL r2(false)` in
`bt_component.abort`. `compile_children` gebruikt `false` om ontbrekende
resetters in zijn dichte interne lijst te markeren. Single-child sequence en
selector retourneerden dat lijstitem rechtstreeks als de publieke, optionele
reset-callback. `abort` verwacht terecht een callback of `nil`.

De fold gebeurt nu vóór de child-list-builder: nul kinderen retourneert de
bestaande constante evaluator; één kind retourneert direct `compile_node`.
Geen omzetting/check in `abort`, geen runtime-wrapper. Dit vermijdt tevens de
vier tijdelijke childlijsten voor de gevallen die geen lijst nodig hebben.
Execution-indexadmission en de latere services/decorators blijven op hun eigen
compilegrens. De evaluatie-/abort-/rebindconsumers veranderen niet.

Referentie voor het simplificatieprincipe: LLVM's
[InstCombinerImpl::visitPHINode][fold] vervangt een gesimplificeerde instructie
door haar semantische waarde. Dat is geen BT-implementatie; de concrete
callback-/lijstrepresentatie wordt door de bovenstaande BMSX-owner bepaald.
O0/O3-proeven voeren lege/nested single-child sequences/selectors, stop/start,
herregistratie en een werkelijk actieve abort-callback uit met de echte cartlib.

## Bewijs en resterende grens

De onafhankelijke Studio-fixture gebruikt de echte cartlib, gewone Lua-modules
en Save/Reboot/Hot Resume. De proef toont aan: twee instances met dezelfde
id en verschillende waarden; geen blackboard versus een leeg blackboard versus
een benoemde nil-slot; gewijzigde slotvolgorde/defaults tijdens rebind; callback-
Source naar het echte bestand; geen guest- of bronmutatie door inspectie;
invalidation bij uitvoering en rewind; dezelfde UI op software/WebGL2/WebGPU.

Validatie:

- `browser.mjs --studio-runtime-inspection`: software, WebGL2 en WebGPU
  geslaagd, inclusief de bestaande FSM-/ActionEffect-/catalogusroutes. Ook
  werkelijk gestopt vóór en tussen de layout-/storagewrites tijdens eerste
  blackboardbinding; de inspector leest geen verzonnen defaultwaarde.
- `browser.mjs --studio`: de volledige bestaande Studio-workflows slagen op
  dezelfde drie renderers, inclusief graphauthoring, focus, Scenario Lab en
  pointer-/menu-/palettebediening.
- Zeven gepaarde screenshots, waaronder blackboard en eerste binding: op
  768×576 **nul verschillende RGBA-bytes** tussen software en beide GPU-paden.
  De twee nieuwe schermen zijn ook visueel bekeken op de tiny-font-layout.
- `test:lua`: **1771 geslaagd, 1 bestaande skip, 0 fouten**; de gedeelde cartlib-
  CPU-suite afzonderlijk **14/14**, inclusief de O0/O3-resetregressie.
- IDE-typecheck en browser-Studio-build slagen. De tests-projecttypecheck
  behoudt **48 bestaande diagnostics**, dezelfde files/errorcodes als de
  voorafgaande catalogusslice. Dus geen claim dat dat project typeclean is.
- Bestaande native CTest-suite **31/31**. Er is geen nieuwe native inspector;
  deze feature is een host-IDE-reader van bestaande guestrepresentaties.
- Architecture-boundaries (0 issues), core-parity, indentation en
  `git diff --check` slagen.

De gedeelde median-meethulp meet vier aanwezige BT-componenten. De warme
keuzeread ligt hier op de browserklokresolutie (`0 ms`), de propertyprojectie
rond `0,005 ms`. Dit is **geen** schaalbenchmark en nul betekent niet gratis.
Selectie maakt hostrows; de gecontroleerde stilstaande frames behouden zowel
rows als gemeten tekst en veranderen geen guestheap, cycles of callbackteller.
Het harnas maakt beide extra bronmodules via dezelfde herbruikbare echte
New File-flow; geen tweede compilerfixture, nepcomponent of Lua-callbridge.

Reproduceren:

```sh
node tests/conformance/runtime_replay/browser.mjs --studio-runtime-inspection \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/bt-inspection.png
npm run test:lua
```

`BMSX_PLAYWRIGHT_MODULE` kan naar de geïnstalleerde Playwright-module wijzen.

Dit sluit **geen** D3-topologie-/nodecorrespondentiegate. Een pointer naar de
oorspronkelijke declaratie is bovendien geen snapshot van compile-input: aliases
kunnen later veranderen, en `blackboard.compile` schrijft resolved slots in
keydescriptors. De keuze tussen behouden topologie en ontwikkelinformatie op de
echte loweringgrens blijft een afzonderlijke kosten-/lifetimeproef. Geen
`program.definition`, node-id, trace-ABI of graphstatus wordt hier toegevoegd.

[tracking]: https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/debugger/limbo_debugger.cpp#L131-L178
[blackboard]: https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/blackboard/blackboard.cpp#L52-L115
[topology]: https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/debugger/behavior_tree_data.cpp#L20-L54
[fold]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/llvm/lib/Transforms/InstCombine/InstCombinePHI.cpp#L1430-L1434
