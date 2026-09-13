# Selectieve BLua32-tracecodegeneratie

Datum: 2026-09-13. Onderdeel van de BT-compilatie-inspectiegrens, geen nieuwe
CPU-observer of Studio-opslag.

## Voorbeeld en live owner

Clang 20.1.8 controleert voor `__xray_customevent` en `__xray_typedevent` de
geselecteerde instrumentatiecategorie **vóór** het emitteren van argumenten
([CGBuiltin.cpp, 6327–6395][clang]). LuaJIT onderscheidt eveneens eventselectie
van het opbouwen van eventargumenten, en wist de route in builds zonder
VM-events ([lj_vmevent.h][luajit]). De overgenomen grens is codegeneratie vóór
argumentevaluatie; niet Clangs machine-instrumentatie of LuaJITs eventbus.

BMSX heeft al statement-only `blua32.trace` en `blua32.trace_sink`. Eén gedeelde
selectie voor een compilatie bepaalt nu welke **exacte** kanalen code krijgen:

- `'erase'`: alle tracestatements wissen; blijft de normale compilerdefault.
- `'emit'`: alle tracestatements emitteren; blijft het expliciete Scenario-
  cartridgecontract, ook voor door een game geschreven tracekanalen.
- `ReadonlySet<string>`: uitsluitend deze kanalen emitteren. Een lege set
  selecteert niets. Geen prefix-, wildcard- of impliciete dependenciesemantiek.

De keuze geldt voor producer én sink, in entry en modules. De compiler kent
geen BT-, FSM-, ActionEffect- of Studio-kanalen. De bestaande rom-imagebuilder
geeft dezelfde selectie door; er komt geen selectieveld in de ROM/hardware.

## Kosten- en levensduurgrens

Een uitgesloten statement maakt geen instructions, constants, sinklookup of
closurecapture en evalueert geen subject, sink of payload. Een geselecteerde
trace behoudt de bestaande runtimebetekenis: subject lezen, sink testen, pas
bij een sink de payload evalueren. Het selecteren van één koud compilekanaal
zet dus niet stilzwijgend de runtime-traces van andere subsystemen aan.

Dit installeert **geen** recorder. De producer van een instrumenteerde build
kiest expliciet de benodigde kanalen en koppelt hun consumenten. Gewone
debug-ROMs en Hot Resume blijven wissen. Een latere Studio-buildpolicy moet
ook opname vanaf de eerste compilatie, module-initialisatie, Hot Resume en
late attach samen dragen; deze compileroptie vervangt dat contract niet.

De compiler en rom-imagebuilder zijn TypeScript-tooling; beide machineruntimes
voeren dezelfde reeds bestaande guestinstructies uit. Er wijzigt geen native
runtimecode of hot-path representatie. De selectie kost uitsluitend één
host-setlookup tijdens codegeneratie van een tracestatement.

## Gerichte proeven

- O0/O3: exacte instructies, constants en closure-layout tegenover dezelfde
  bron zonder de uitgesloten statements. Subject-, sink- en payloadexpressies
  worden niet geëvalueerd; een prefixkanaal wordt niet impliciet geselecteerd.
- Werkelijke system-/cartridge-imagebuilders: verschillende selecties, een
  producer in een ander modulebestand, beide ROMs uitgevoerd door dezelfde CPU.
- De echte BT-opnamefixture blijft werken met alleen haar drie compilekanalen:
  **165.088 codebytes** tegenover 165.216 bij globale emit. De opnamekosten,
  guestheap en tickcycli zijn gelijk aan de bestaande geselecteerde recorder.
- 10.000 echte FSM-transities: **1.810.007 machinecycli** in zowel erase als
  BT-compile-only; 2.220.007 met de FSM-recorder geselecteerd. Na opwarming
  geen guestallocaties. Geen claim over hosttijd of volledige gameframes.

Selectie wist statements, niet willekeurige ondersteunende modules of gewone
Lua-initialisatiecode. De module-/`require`-semantiek blijft ongewijzigd; het
aanroepen van een recorderconstructor buiten een trace is nog steeds gewone
guestcode. Dit is dus geen automatische dead-stripper voor debuglibraries.

Validatie: volledige Lua-suite **1781 geslaagd, 1 bestaande skip**; rompacker
**124/124**. IDE-typecheck, architecture-boundaries (0 issues), core-parity,
indentation en `git diff --check` slagen. De tests-projecttypecheck behoudt
dezelfde 46 bestaande diagnostics als vóór de slice. Geen nieuwe native- of
Studio-opnamefunctionaliteit geclaimd op basis van deze compilerproeven.

[clang]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/CodeGen/CGBuiltin.cpp#L6327-L6395
[luajit]: https://github.com/LuaJIT/LuaJIT/blob/c6ffc141a8762b41703f9287d63d93622a13dd8f/src/lj_vmevent.h#L38-L64
