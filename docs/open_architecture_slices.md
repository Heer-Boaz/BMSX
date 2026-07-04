# Openstaande architectuur-slices

Dit document is alleen de actuele werkvoorraad voor architectuur-slices. Gesloten
of geschrapte slices staan hier niet. Duurzame machine-contracten horen in
`docs/architecture.md`; per-device details horen in de device-documenten.

| Slice | Status | Owner-boundary | Open werk | Klaar wanneer |
| --- | --- | --- | --- | --- |
| 17 | In progress | BLua section-owned storage | Concrete static mutable state, persistent scratch storage en immutable typed lookup tables migreren naar compiler-assigned `.bss`, `.data` of `.rodata` wanneer storage/lifetime dat echt vraagt. Geen generieke asset-format conversie. | Nieuwe of aangeraakte static storage gebruikt section-symbolen en typed memory in plaats van Lua-objecten of handgekozen `mem[...]`; TS/C++ linker/runtime parity blijft groen. |
| 27 | In progress | Lua VM heap representation | Nieuwe steady-state heapmeting draaien; daarna alleen nog bewezen native-handle of VM-owned small-object druk reduceren. Geen save-state-codec werk zolang de runtime-representatie beweegt. | Gemeten kleine allocaties dalen zonder extra guards, fallbacks of hot-path GC-churn. |
| 28 | In progress | Program image runtime residency | Nieuwe program-image live-byte meting draaien; daarna alleen nog bewezen dubbele rodata/constpool/proto/debug ownership in loader/runtime reduceren. | Gemeten program-image live bytes dalen zonder debug-symbol afhankelijkheid, legacy reader, of TS/C++ representatie-drift. |
| 10 | Decision needed | Rendering parity | Eerst beslissen of pixel-identieke TS/C++ output contract is. Nonblank/boot-parity is al onvoldoende bewijs als pixel parity contract wordt. | Bij “ja”: één golden/capture pad en TS/C++ pixelvergelijking. Bij “nee”: slice verwijderen. |
