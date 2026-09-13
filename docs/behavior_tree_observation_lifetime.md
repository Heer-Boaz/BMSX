# BT-opname: programma-identiteit en voltooide bindingen

Datum: 2026-09-13. Vervolg op de [loweringproef](behavior_tree_compilation_observation.md)
en [selectieve tracecodegeneratie](lua_trace_selection.md).

## Ownerbesluit vóór de wijziging

LLVMs [JITEventListener][llvm] meldt concrete geproduceerde objecten en heeft
een aparte vrijgavelifetime. Lua 5.4.8 implementeert [zwakke sleutelassociaties
als ephemerons][lua]: een waarde houdt haar eigen zwakke sleutel niet alsnog
in leven. Beide mechanismen zijn daadwerkelijk gelezen. BMSX heeft deze
GC-semantiek al in beide CPUs; geen nieuwe debug-rootregistratie is nodig.

De bestaande expliciete `testlib`-opname krijgt:

- `programs[compiled_program]`: één opname per werkelijk voltooid programma,
  met zwakke sleutels. Geen catalogus op id-string, callbacktuple of bronpad.
- `completed_bindings[component]`: het programma van de **laatst volledig
  uitgevoerde** `rebind_program`, eveneens met zwakke sleutels. Per component
  één programmareferentie, geen nodekopie en geen tickobservatie.
- Geen sterke `latest`-latch meer. Een geregistreerd programma of geobserveerde
  component houdt de betreffende opname bereikbaar; vervangen, ongebruikte
  programma's en verdwenen components mogen door de gewone GC verdwijnen.

De producer meldt `bt.bind.complete` pas na de laatste bestaande rebind-write,
in `bt_component:rebind_program`. Compileren, registrypublicatie en het binden
van iedere actor blijven afzonderlijke feiten. De guest-VM bewaart alle
associaties als gewone tabellen; haar normale save-state herstelt de sleutels,
waarden en gedeelde referenties samen.

## Geen verzonnen atomair rebindcontract

Een completion-event zegt **niet** dat een latere rebind nog niet begonnen is.
Tijdens abort, halverwege nieuwe veldwrites of na een afgebroken rebind blijft
dit de laatst voltooide binding, niet een gegarandeerd coherent huidig
execution-memorymodel. De bestaande instance-inspector leest die werkelijke
velden al afzonderlijk. Deze opname mag dat niet vervangen door een oud
programma of door het nieuwst geregistreerde programma met dezelfde id.

Er komt daarom geen `pending`-map met handmatige begin/end-tellers: geneste
callbacks en een afgebroken Lua-call maken dat niet automatisch een betrouwbare
call-lifetime. Geen `pcall`/rollback rond rebind en geen nieuwe guesttransactie
voor observatie. De uiteindelijke live graph moet haar coherente stop-/
execution-grens nog bewijzen; deze slice presenteert alleen completionfeiten.

## Callsite- en representatiegrens

| Grens | Representatie / kosten |
| --- | --- |
| `program.compile` / `compile_node` | Bestaande drie koude compiletraces en nodefeiten. |
| `bt_component:rebind_program` | Eén nieuwe statement-only trace na de bestaande writes. Bij erasure geen code, constants of captures. |
| BT evaluate, service requests, FSM/AE ticks | Ongewijzigd; geen lookup of allocatie toegevoegd. |
| Sleutels en waarden | Gewone Lua-tabellen / programmaobjecten; TS `Value`/`Table` en C++ `Value`/`Table` blijven hun bestaande representatie houden. |
| GC / CPU-restore | Bestaande zwakke-tabellen- en snapshotowners, geen gewijzigde runtimecode. |

Dit blijft een expliciet toegelaten testlib-waarnemer, niet automatisch
opgeslagen Studio-data. Opname vóór de eerste compilatie, late attach,
compacte productopslag, allocation-/bronmapping en live graphcoherentie
blijven afzonderlijke productgates. Detach stopt toekomstige waarneming; de
afgekoppelde recorder bevat historische completionfeiten, geen live bindingen.

## Uitvoerbaar bewijs en kosten

De bestaande gedeelde CPU-fixture voert echte cartlib-compilatie, publicatie
en componentbinding uit. De aanvullende proeven zijn niet afhankelijk van
de inhoud of regelnummers van een gamecart:

- O0/O3: oude en nieuwe programma's met dezelfde id en gelijke callbacks
  blijven verschillend. Een nieuwe registrypublicatie verandert niet de
  geregistreerde completion van een oude, nog niet hergebonden component.
- Een ongebruikte maar geregistreerde definitie houdt haar opname; een alleen
  gecompileerd, nergens vastgehouden programma niet. Ook een cyclus van
  component → completionprogramma → callback → component wordt opgeruimd.
- Na 32 herregistraties met GC blijft de retained heap gelijk. De bestaande
  CPU-checkpointproef herstelt de nieuwe associaties en speelt twee keer dezelfde
  uitvoering af, met opnieuw gelezen guestreferenties.
- Een abortcallback bindt werkelijk een tussenliggend programma voordat de
  buitenste rebind verdergaat. Een falende abort publiceert geen nieuwe
  completion. De test leest ook de reeds gewijzigde activityslot; geen rollback.
- O0/O3-vergelijking met `23a6bcbe0`'s `bt_component.lua`, binnen verder dezelfde
  actuele fixture: gewiste `bt.bind.complete` levert **identieke code,
  constants en closure-layout** op.

O3, de bestaande 65-occurrencefixture met twee actors; registratie inclusief
hun eerste constructie. Setup is `recorder.new()`, afzonderlijk gemeten nadat
de fixturemodules al zijn geïnitialiseerd; retained is na GC. De vaste
module-initialisatiekosten zijn dus niet de setupkolom:

| Route | Code fixture | Setup retained | Registratie-allocatie | Registratie retained | Registratiecycli |
| --- | ---: | ---: | ---: | ---: | ---: |
| Gewist | 165.080 B | 0 B | 20.060 B | 14.688 B | 7.721 |
| Alle traces, geen recorder | 165.572 B | 0 B | 20.060 B | 14.688 B | 7.992 |
| Opname + completion geselecteerd | 165.572 B | 368 B | 35.224 B | 28.316 B | 12.619 |
| Alleen de vier koude kanalen | 165.444 B | 368 B | 35.224 B | 28.316 B | 12.619 |

Alle routes houden **3.720.145 cycli voor 9.984 ticks van beide actors**, zonder
guestallocaties na opwarming. De capture kost dus nog steeds **13.628 extra
retained bytes**, plus 368 bytes setup. Dit is niet ineens compacte, gratis
productopslag. De fixturecode omvat de expliciete testlib-consument en haar
checks; het codeverschil met de vorige fixture is geen gewone game-ROM-overhead.
Geen host-RSS-, piekgeheugen-, volledige worldframe- of native-profielclaim.

## Validatie

- Acht gerichte opname-/lifetimeproeven; volledige Lua-suite **1784 geslaagd,
  1 bestaande skip**. De voorafgaande compilerselectieslice haalt ook de
  volledige rompacker-suite (**124/124**).
- Nemesis-debug-ROM opnieuw gebouwd. De bestaande echte Studio-runtime-
  inspectie én volledige Studio-workflows slagen op software, WebGL2 en WebGPU:
  onder andere no-change init, midden-in-rebind, callback-Source, gewijzigde
  bron, compilefout, rewind, graphbewerking/Undo, focus en Scenario Cancel.
  Dit is regressiebewijs voor de gewone route, **geen** al aangesloten live
  BT-topologieopname in de UI.
- IDE-typecheck, architecture-boundaries (0 issues), core-parity, indentation
  en `git diff --check` slagen. Tests-projecttypecheck: dezelfde 46 bestaande
  diagnostics; geen nieuwe. Geen gewijzigde C++-runtime of nieuw native-
  recorderbewijs in deze slice.

Reproduceren van de onafhankelijke guestproeven:

```sh
npx tsx --test --import ./tests/lua/test_setup.ts tests/lua/behavior_compilation.test.ts
```

[llvm]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/llvm/include/llvm/ExecutionEngine/JITEventListener.h#L33-L63
[lua]: https://github.com/lua/lua/blob/v5.4.8/lgc.c#L468-L527
