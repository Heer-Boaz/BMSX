# Openstaande architectuur-slices

Dit document is alleen de actuele werkvoorraad voor architectuur-slices. Gesloten
of geschrapte slices staan hier niet. Duurzame machine-contracten horen in
`docs/architecture.md`; per-device details horen in de device-documenten.

| Slice | Status | Owner-boundary | Open werk | Klaar wanneer |
| --- | --- | --- | --- | --- |
| 17 | In progress | BLua section-owned storage | Concrete static mutable state, persistent scratch storage en immutable typed lookup tables migreren naar compiler-assigned `.bss`, `.data` of `.rodata` wanneer storage/lifetime dat echt vraagt. Geen generieke asset-format conversie. | Nieuwe of aangeraakte static storage gebruikt section-symbolen en typed memory in plaats van Lua-objecten of handgekozen `mem[...]`; TS/C++ linker/runtime parity blijft groen. |
| 19/20 | In progress | Const-module/static function ABI | Verdere const-module function exports alleen gap-driven migreren: fixed-point helpers, scratch aggregates, typed-pointer calling convention en audit-output pas wanneer een echte consumer dat nodig maakt. | Static exports linken als symbols/protos zonder runtime module-table, global-slot lookup, dynamic call target of hot-path Lua object transport. |
| 21 | In progress | CPU machine-code ABI | Static cart ABI verder naar words, registers, addresses, sections, memory en symbols trekken. Dynamic Lua-objecten blijven alleen in de expliciete gameplay/dynamic lane. | Hot/static modules gebruiken geen Lua-objectwaarden als ABI-transport; TS/C++ CPU/linker/debugger tonen dezelfde machine-code representatie. |
| 25 | Open | VDP/RPU texture residency and staging ownership | De huidige 1.75 MiB `VRAM_STAGING` is te groot omdat RPU texture-atlas storage onder staging is geboekt. De asymmetrie `primary=416 KiB` en `secondary=984704 bytes` is geen hardwarecontract maar een restbudget-effect. Kies hiervoor geen vrij instelbare cart-bankgrootte en laat rompacker/boot geen budgetten uitdelen: het PSX-achtige model is een kleine descriptor/scratch staging plus een vaste RPU texture-VRAM coordinate space waar cart/game code concrete texture/CLUT/atlas-posities in programmeert. | `VRAM_STAGING` bevat alleen descriptor/scratch/command storage; texture atlas bytes zitten niet meer in staging-accounting; texture residency zit in een expliciete RPU/VDP VRAM range met vaste hardwaregrenzen en door de cart/game geprogrammeerde adressen; rompacker materialiseert alleen die authored layout; firmware, boot-accounting en docs gebruiken dezelfde owner-owned layout zonder primary/secondary restbudgetten. |
| 24 | Deferred | Console model, device classes en region timing | Alleen oppakken bij een echte model/device-class producer of resterende manifest-hardwareknop. De huidige `psx` model/VDP-class en live region timing zijn contract; tweede VDP-class/APU-class is geen slice zonder producer. | Model/device-class/timing data komt uit de machine registry of ROM header, niet uit guest globals of cart/system manifest hardware shortcuts. |
| 10 | Decision needed | Rendering parity | Eerst beslissen of pixel-identieke TS/C++ output contract is. Nonblank/boot-parity is al onvoldoende bewijs als pixel parity contract wordt. | Bij “ja”: één golden/capture pad en TS/C++ pixelvergelijking. Bij “nee”: slice verwijderen. |

## Slice 25 decision: PSX-achtige texture residency

Slice 25 volgt geen cartridge-mapper model waarin een cart willekeurige bankgroottes
kiest. Dat past niet bij de PSX-achtige VDP/RPU boundary: de machine exposeert
een vaste VRAM address space en texture page/CLUT constraints; de game kiest zelf
welke VRAM-coördinaten voor framebuffers, textures, CLUTs en atlases gebruikt
worden.

Daarom is de eigenaarsscheiding:

- VDP/RPU bezit de fysieke ranges, page/coordinate constraints, MMIO writes en
  RPU-readback/revision accounting.
- Cart/game code bezit de concrete texture-layout en programmeert de adressen die
  primitives en descriptors gebruiken.
- Rompacker pakt bytes volgens die authored layout en faalt als de layout niet in
  de hardware past; het berekent geen primary/secondary budgets en deelt geen
  residency toe.
- Boot/firmware initialiseert hardware en system assets, maar is geen allocator
  voor cart texture residency.
