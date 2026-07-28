# Openstaande architectuur-slices

Dit bestand is alleen de werkvoorraad. Afgeronde hardwarecontracten horen in
[`architecture.md`](architecture.md); testuitslagen en implementatiegeschiedenis
horen niet in deze lijst.

## Bewezen solutiongrenzen

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `NATIVE-MEDIA-01` | Verwijder bestandspaden, mmap en bytebuffer-eigendom uit de C++ `MachineManager`. De libretro-host behoudt de backing storage; de machine consumeert uitsluitend stabiele ROM-byteviews, gelijk aan de TypeScript-initialisatiegrens. | `MachineManager` importeert geen file- of mmap-owner, heeft geen path-load-API en kopieert geen hostmedia. Reboot en source-aware diagnostics blijven dezelfde fysieke bytes gebruiken zonder extra kopie. |
| `NATIVE-TARGET-01` | Splits de native CMake-linkgrens: `bmsx_core` bevat alleen machine/runtime en de lage wire-formatdependencies; platform, host-input, output-resampling, presentatie, overlays en GLES2 leven in een host-supporttarget boven de core. | De core archive bevat geen host/platform/render/input/audio-transport/mmap objecten en linkt geen GLES2, `dl` of zlib voor hostpresentatie. Libretro, de directe host en diagnostics behouden alle huidige features door expliciete compositie boven `bmsx_core`. |

## Doorlopende performance-audit

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `PERF-RUNTIME-01` | Kies per iteratie één gemeten hot-pathowner en verwijder daar herhaalde decode, conversie, validatie, allocatie of dispatch bij de producer. Dit is een paraplu, geen enkele megaslice. | Analyzers blokkeren nieuwe overtredingen, parity blijft exact en representatieve low-end hardware houdt 50 Hz zonder oplopende backlog. |

## Vereist een interactieve backend of fysieke target

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
