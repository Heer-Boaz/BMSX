# Openstaande architectuur-slices

Dit bestand is alleen de werkvoorraad. Afgeronde hardwarecontracten horen in
[`architecture.md`](architecture.md); testuitslagen en implementatiegeschiedenis
horen niet in deze lijst.

## Doorlopende performance-audit

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `PERF-RUNTIME-01` | Kies per iteratie één gemeten hot-pathowner en verwijder daar herhaalde decode, conversie, validatie, allocatie of dispatch bij de producer. Dit is een paraplu, geen enkele megaslice. | Analyzers blokkeren nieuwe overtredingen, parity blijft exact en representatieve low-end hardware houdt 50 Hz zonder oplopende backlog. |

## Solution- en productgrenzen

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `SOLUTION-WIRE-01` | Trek de gedeelde ROM-, BLua32-, register- en andere wire-contracten uit implementatiepaden naar hun specificatie-owner. | Toolchain hangt alleen van wire/ABI-contracten af en niet van TS- of C++-emulatorimplementatie. |
| `CPU-HOST-FFI-01` | Verwijder `NativeFunction`, `NativeObject` en de IDE-native bridge volledig uit de CPU/guest-valuerepresentatie. Geen compatibiliteitspad of vervangende host-callbacklaag; het expliciet geaccepteerde functieverlies is onderdeel van de slice. | Beide CPU's hebben uitsluitend machine/guest-waardetags en de player- en Studio-producten bevatten geen generieke CPU-host-FFI. |
| `CPU-OBSERVER-01` | Verwijder de TS-only instruction-observerdispatch uit de CPU-hotloop en ontwerp profiling uitsluitend als tooling boven een eerlijke machinegrens. | Normale TS- en C++-CPU-hotloops hebben dezelfde architecturale dispatch en geen dormant host-observerbranch. |
| `RUNTIME-TIMING-01` | Verplaats cart-zichtbare systeemtijdregisters uit de host/runtimecontainer naar een echt machine-device. | Tijd-MMIO is gemirrord machine-state en `Runtime` publiceert geen cart-zichtbare hostfaciliteit. |
| `HOST-DESCRIPTOR-GC-01` | Verwijder gekopieerde resource-descriptor-DTO's en andere per-actie/per-frame metadatareconstructie; consumers gebruiken de retained owner-records rechtstreeks. | Geen descriptorcopy zoals `{ domain, path, type, asset_id, readOnly }`, geen extra identity-map en geen vermijdbare allocatie in IDE- of hostflows. |

## Uitgesteld tot een echte backend of target beschikbaar is

| ID | Nog te bewijzen | Vereist |
| --- | --- | --- |
| `HOST-GX-LIVE-01` | IDE, quick menu, F2-terminal, `bare_metal_cart` en `2025` tonen stabiele opeenvolgende frames met correcte input, glyphs en terminalcellen, zonder flashes, zwart beeld of halve commandstreams. | WebGL2 en WebGPU; de terminal ook op GLES2. |
| `GX-READ-01` | GPUREAD wrap, padding, fences, DREQ en zichtbare VRAM-inhoud komen live overeen met de softwarevectoren. | WebGL2, GLES2 en WebGPU. |
| `GX-RASTER-01` | Polygonen, lijnen, clipping, textures, CLUT, mask, blend, dither en stores komen live exact overeen met software en GPUREAD. | WebGL2, GLES2 en WebGPU. |
| `HOST-SUPERVISOR-01` | Down+Select opent en sluit de terminal exact eenmaal zonder gameplayinput te lekken. | Echte SNES Mini. |
| `PERF-03` | De op de echte target geselecteerde ARM-fetch-, NV-barrier- of dependency-copyroute rendert exact en houdt 50 Hz zonder backlog. | Windows RetroArch en echte SNES Mini. |
| `PERF-04` | De 16k audio-/presentatiesoak houdt 50 Hz zonder sampleverlies, backlog of periodieke hitch. | Zichtbare frontend en daarna SNES Mini. |
| `SNES-ABI-01` | De tegen de actuele target-root gebouwde core en direct host starten zonder ABI- of loaderfouten. | Actuele SNES Mini-rootdump en hardware. |

## Geparkeerd

| ID | Hervatten wanneer |
| --- | --- |
| `GX-SW-01` | Een profiel op representatieve low-end ARM-hardware een concrete software-rasterizerhotspot aanwijst. |
| `BIOS-TERM-EXT-01` | Er een concrete behoefte is en de command-, call/return- en terminal-output-ABI voor een door firmware geselecteerde developer-cartridge is ontworpen. |
