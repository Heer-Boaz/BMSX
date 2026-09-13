# Geladen behavior-definities zonder actor

Datum: 2026-09-13. Baseline: `e533150e6`. D2-vervolg.

## Vooraf gelezen referenties

- [Lua 5.4.8 `aux_upvalue` / `lua_getupvalue`][lua] leest de daadwerkelijke
  capturecel van een closure. De closure hoeft niet op de actieve stack te
  staan; de debugger voert haar niet uit. BMSX leest zijn eigen open/gesloten
  upvalue-representatie en bestaande geïnstalleerde capturesymbolen.
- [LLDB's libstdc++ synthetic provider][lldb] projecteert de bestaande
  library-opslag, bijvoorbeeld `_M_impl`; geen extra library-register alleen
  voor de debugger. BMSX' cartlib-kennis blijft in de Behavior Lens-bijdrage.
  Wij kopiëren geen exception-fallbacks of ondersteuning voor oude layouts.
- [VS Code VariablesView][vscode] scheidt scopes, geselecteerde waarden en
  projectielifetime. De bestaande QuickInput/property inspector en suspended
  guest-lifetime blijven onze UI-owners; geen nieuwe graphdatabase.

Dit is een BMSX-afleiding, niet een gekopieerd protocol of een tweede Lua-VM.

## Live owners en read-contract

`actioneffect_component.lua` en `fsm_component.lua` bezitten elk al
`definitions_by_id`, vastgehouden door hun geëxporteerde `set_definition`.
Registratie publiceert daarin **vóór** de bestaande instances rebind uitvoeren.
Een catalogus kan dus al een nieuwe definitie tonen terwijl een geselecteerde
instance nog de oude bezit. De bestaande instance-inspectie blijft apart.

De generieke toolingreader koppelt een echte closure aan zijn actuele
instruction-busmapping en geïnstalleerde capturesymbolen. De gevraagde local
wordt gekwalificeerd door haar defining modulefunctie, niet door een globale
zoekactie op alleen de naam. Geen vaste upvalue-index, hardcoded compiler-id,
heapscan, closure-decompiler of evaluatie van `set_definition`.
Hot Resume kan oude captureslots behouden; een ambigue naam kiest daarom
niet zomaar de eerste binding. Ontbrekende/verwijderde bindings worden evenmin
met een gelijknamige factorylocal of een vroeger bronbereik ingevuld.
Niet geladen/geïnitialiseerde exports en ontbrekende debuglocaties blijven
onderscheiden van een geldige lege registry. Onopgeslagen bron verandert de
gelezen heap niet; callback-Source vereist zoals eerder exacte bronbytes.

De bijdrage leest uitsluitend de twee bestaande registries. Zij selecteert
een concrete gepubliceerde definitie, ook zonder component/actor; bij FSM's
volgt een keuze uit die geladen definitiehiërarchie. De propertypresentatie
wordt gedeeld met instance-inspectie, maar verzint geen actor/current/data.
Een registratie-id is een lookupkey, geen identiteit van een bronoccurrence.
Een callbackbron bewijst niet waar de omvattende definitie is aangemaakt.

Bediening vanuit een FSM-/ActionEffect-bronlens: **Behavior Lens: Inspect
Registered Definitions** in de command palette of **Registered Definitions**
in het node-/propertycontextmenu. De bestaande **Live**-actie blijft direct
instance-inspectie. Er komen geen extra toolbarbuttons of mode-switches bij.
Dit is nog geen globale actorbrowser of BT-definitiecatalogus.

Zoals een library-formatter kent deze bijdrage de concrete cartlib-opslag:
`set_definition` houdt `definitions_by_id` vast. Een wijziging van die owner
vereist een wijziging van deze bijdrage, niet van CPU, parser, graphcontrol of
working-copy. Dit pretendeert geen automatische ontdekking van willekeurige
vervangende cartlib-implementaties. Een werkende module-export zonder de
bijbehorende capturelocatie wordt niet als een geldige lege catalogus getoond.

Geen cartlib-/compilerwijzigingen, nieuwe catalogustabel, serialisatieveld,
registratieteller, guest-debughook of extra instructies per gameplaytick.
De enige native uitbreiding is de generieke, read-only CPU-debuggerread.

## TS/C++-representatie vóór de diff

| Gegeven | TS | C++ | Owner |
| --- | --- | --- | --- |
| Closure | `Closure` | `const Closure*` | CPU; geen geboortesocket. |
| Capture-index | `number` (bestaande integer index) | `int` | Geïnstalleerde upvaluebindings; geen cartlib-slotnummer. |
| Open cel | `frame.registers.get(index)` | `frame->registers[index]` | Huidige frame, niet de gesloten backupwaarde. |
| Gesloten cel | `materializeValue(tag, scalar, reference)` | `Value` | Bestaande value-representatie, geen JS-shapeclassificatie. |
| Debugread | `readClosureUpvalue` | `readClosureUpvalue` | Zelfde contract; `readFrameUpvalue` gebruikt deze read ook. |

Concrete callsites: de bestaande `readFrameUpvalue`-consumenten zijn
`ide/runtime/fault_state.ts` en `ide/runtime/lua_inspection.ts`; de nieuwe
closure-read loopt via `SuspendedGuestSession` naar de catalogusreader.
De C++ `readUpvalue`-datapath wordt ook door `GETUPVAL` in `cpu_dispatch.inl`
gebruikt; alleen zijn const-kwalificatie verandert, niet de instructieoperatie.
TS' `GETUPVAL`, capture-open/close/write, GC, snapshot/restore, FSM-register/
rebind/frame-evaluators en ActionEffect-trigger/periodic blijven ongewijzigd.
Geen continue CPU execution hook. Hostselectie bouwt retained rijen; paint
en scroll lezen geen captures of registries opnieuw.

## Validatie

De bestaande onafhankelijke inspectiefixture en gedeelde browserdriver zijn
uitgebreid, niet gekopieerd. Twee echte debuggerstops vóór het aanmaken van
actors bewijzen eerst **geïnitialiseerde maar lege registries**, daarna vier
gepubliceerde entries per registry. Lege, ongebruikte en onder twee keys gedeelde
ActionEffect-definities zijn afzonderlijk kiesbaar. Een actorloze FSM levert
haar werkelijke geneste definitiehiërarchie. Geen tweede testruntime, extra
fixtureloader of afhankelijkheid van de actuele gamebehaviors.

De echte palette en het contextmenu openen de normale picker/inspector.
Callback-Source van een ongebruikt effect opent de tweede Lua-bron. Mid-rebind
toont de effectcatalogus al `30` terwijl beide instances nog `20` vasthouden;
de FSM-catalogus toont de nieuwe nested defaults `20` terwijl beide instance-
kinderen nog `10` lezen. Gewijzigde bron/Hot Resume levert daarna `48` via de
nieuwe geïnstalleerde capturesymbolen. Restore sluit de registrykiezer en
inspector; herselectie leest de herstelde registry. Inspectie laat sourceversie,
heapbytes, cycles en callbackcounters ongemoeid en behoudt rijen/wrapping op
stilstaande hostframes.

- `browser.mjs --studio-runtime-inspection`: **software, WebGL2, WebGPU geslaagd**,
  inclusief eerdere instance-inspectie, compilefout, callbackdivergentie en Undo.
- De vijf inspectiecheckpoints zijn gepaard vergeleken: op 768×576 **nul
  afwijkende RGBA-bytes** tussen software en beide GPU-backends. De nieuwe
  catalogusschermen zijn ook visueel bekeken.
- `browser.mjs --studio`: de volledige bestaande workflows slagen op dezelfde
  drie renderers, inclusief bronbewerking, Scenario Lab, focus en pointerroutes.
- `test:lua`: **1769 geslaagd, 1 bestaande skip, 0 fouten**. Vier nieuwe O0/O3-
  proeven gebruiken echte modulecaptures, open/gesloten cellen en een shadowed
  factorylocal; `nil` blijft een gelezen waarde. Reads veranderen geen CPU-
  snapshot, heap of registers.
- Volledige `build-cpp-tests`-build en CTest: **31/31 geslaagd**. De bestaande
  native replayfixture bewijst de read vóór en na frame-return en na restore;
  de closure zelf wordt niet aangeroepen.
- IDE-typecheck, browser-Studio-build, beide architecture/core-parityaudits,
  indentation en `git diff --check`: geslaagd. De tests-projecttypecheck
  behoudt dezelfde **48 bestaande diagnostics**; geen nieuwe files/errorcodes.

De bestaande median-meethulp meet de selectiequery met vier entries per
registry. Warme resultaten liggen hier rond de browserklokresolutie
(`0–0,005 ms`); **0 betekent niet kosteloos**. Dit is geen schaalbenchmark voor
grote werelden of langzamere hardware. Er zijn geen gewijzigde guest-
executables, extra guestvelden of nieuwe per-tick/present-querycallsites.
Hostkeuze maakt de noodzakelijke retained items; geen cacheprotocol om
herhaald per-frame registrywerk te verbergen.

Reproduceren met de bestaande, geïsoleerde product-file-API-driver:

```sh
node tests/conformance/runtime_replay/browser.mjs --studio-runtime-inspection \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/catalog.png
cmake --build build-cpp-tests -j 4
ctest --test-dir build-cpp-tests --output-on-failure
```

`BMSX_PLAYWRIGHT_MODULE` wijst zo nodig naar de geïnstalleerde Playwright-tooling.
De driver verandert geen gebruikersworkspace of browserstorage. Algemene
actorselectie, definitie-allocation-/broncorrespondentie en BT-opname blijven
afzonderlijke vervolgstappen; dit sluit niet de volledige D2/D3-gate.

[lua]: https://github.com/lua/lua/blob/v5.4.8/lapi.c#L1357-L1396
[lldb]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/lldb/examples/synthetic/gnu_libstdcpp.py#L277-L299
[vscode]: https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/browser/variablesView.ts#L91-L170
