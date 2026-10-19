# Selectieve BLua32-tracecodegeneratie

Dit compilerbeleid bepaalt welke tracecode in expliciete meetbuilds terechtkomt.
Het beheert geen CPU-observer of Studio-opslag.

## Voorbeeld en live owner

Clang 20.1.8 controleert voor `__xray_customevent` en `__xray_typedevent` de
geselecteerde instrumentatiecategorie **vóór** het emitteren van argumenten
([CGBuiltin.cpp, 6327–6395][clang]). LuaJIT onderscheidt eveneens eventselectie
van het opbouwen van eventargumenten, en wist de route in builds zonder
VM-events ([lj_vmevent.h][luajit]). De overgenomen grens is codegeneratie vóór
argumentevaluatie; niet Clangs machine-instrumentatie of LuaJITs eventbus.

BMSX heeft al statement-only `blua32.trace` en `blua32.trace_sink`. Eén gedeelde
selectie voor een compilatie bepaalt welke **exacte** kanalen code krijgen:

- `'erase'`: alle tracestatements wissen; blijft de normale compilerdefault.
- `'emit'`: alle tracestatements emitteren; blijft het expliciete Scenario-
  cartridgecontract, ook voor door een game geschreven tracekanalen.
- `readonly string[]`: uitsluitend deze kanalen emitteren. Een lege lijst
  selecteert niets. De compiler maakt één lookup-set; de instellingen blijven
  direct serialiseerbaar. Geen prefix-, wildcard- of impliciete dependenciesemantiek.

De keuze geldt voor producer én sink, in entry en modules. De compiler kent
geen BT-, FSM-, ActionEffect- of Studio-kanalen. De bestaande rom-imagebuilder
geeft dezelfde selectie door; er komt geen selectieveld in de machine/header.
De buildproducer bewaart deze instelling in tooling-debugmetadata, zodat
bronherbouw haar niet verliest; zie [vooraf geladen modules](lua_preload_initialization.md).

## Kosten- en levensduurgrens

Een uitgesloten statement maakt geen instructions, constants, sinklookup of
closurecapture en evalueert geen subject, sink of payload. Een geselecteerde
trace behoudt de bestaande runtimebetekenis: subject lezen, sink testen, pas
bij een sink de payload evalueren. Het selecteren van één koud compilekanaal
zet dus niet stilzwijgend de runtime-traces van andere subsystemen aan.

Dit installeert **geen** recorder. De producer van een instrumenteerde build
kiest expliciet de benodigde kanalen en koppelt hun consumenten. Gewone
debug-ROMs blijven wissen. Hot Resume neemt de geïnstalleerde keuze
over; expliciete preloads kunnen vóór de eerste game-module-initialisatie een
recorder koppelen. De automatische Studio-buildpolicy en productopslag blijven
open; deze compileroptie vervangt dat contract niet.

De compiler en rom-imagebuilder zijn TypeScript-tooling; beide machineruntimes
voeren dezelfde reeds bestaande guestinstructies uit. Er wijzigt geen native
runtimecode of hot-path representatie. De selectie kost uitsluitend één
host-setlookup tijdens codegeneratie van een tracestatement.

Selectie wist statements, niet willekeurige ondersteunende modules of gewone
Lua-initialisatiecode. De module-/`require`-semantiek blijft ongewijzigd; het
aanroepen van een recorderconstructor buiten een trace is nog steeds gewone
guestcode. Dit is dus geen automatische dead-stripper voor debuglibraries.

[clang]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/CodeGen/CGBuiltin.cpp#L6327-L6395
[luajit]: https://github.com/LuaJIT/LuaJIT/blob/c6ffc141a8762b41703f9287d63d93622a13dd8f/src/lj_vmevent.h#L38-L64
