# Openstaande architectuur-slices

Dit document is alleen de actuele werkvoorraad voor architectuur-slices. Gesloten
of geschrapte slices staan hier niet. Duurzame machine-contracten horen in
`docs/architecture.md`; per-device details horen in de device-documenten.

| Slice | Status | Owner-boundary | Open werk | Klaar wanneer |
| --- | --- | --- | --- | --- |
| 17 | In progress | BLua section-owned storage | Concrete static mutable state, persistent scratch storage en immutable typed lookup tables migreren naar compiler-assigned `.bss`, `.data` of `.rodata` wanneer storage/lifetime dat echt vraagt. Geen generieke asset-format conversie. | Nieuwe of aangeraakte static storage gebruikt section-symbolen en typed memory in plaats van Lua-objecten of handgekozen `mem[...]`; TS/C++ linker/runtime parity blijft groen. |
| 19/20 | In progress | Const-module/static function ABI | Verdere const-module function exports alleen gap-driven migreren: fixed-point helpers, scratch aggregates, typed-pointer calling convention en audit-output pas wanneer een echte consumer dat nodig maakt. | Static exports linken als symbols/protos zonder runtime module-table, global-slot lookup, dynamic call target of hot-path Lua object transport. |
| 21 | In progress | CPU machine-code ABI | Static cart ABI verder naar words, registers, addresses, sections, memory en symbols trekken. Dynamic Lua-objecten blijven alleen in de expliciete gameplay/dynamic lane. | Hot/static modules gebruiken geen Lua-objectwaarden als ABI-transport; TS/C++ CPU/linker/debugger tonen dezelfde machine-code representatie. |
| 24 | Deferred | Console model, device classes en region timing | Alleen oppakken bij een echte model/device-class producer of resterende manifest-hardwareknop. De huidige `psx` model/VDP-class en live region timing zijn contract; tweede VDP-class/APU-class is geen slice zonder producer. | Model/device-class/timing data komt uit de machine registry of ROM header, niet uit guest globals of cart/system manifest hardware shortcuts. |
| 10 | Decision needed | Rendering parity | Eerst beslissen of pixel-identieke TS/C++ output contract is. Nonblank/boot-parity is al onvoldoende bewijs als pixel parity contract wordt. | Bij “ja”: één golden/capture pad en TS/C++ pixelvergelijking. Bij “nee”: slice verwijderen. |
