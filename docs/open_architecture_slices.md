# Openstaande architectuur-slices

Dit bestand is alleen de werkvoorraad. Afgeronde hardwarecontracten horen in
[`architecture.md`](architecture.md); testuitslagen en implementatiegeschiedenis
horen niet in deze lijst.

## Uitvoerbaar

| ID | Nog te doen | Klaar wanneer | Afhankelijk van |
| --- | --- | --- | --- |
| `GX-PCRTC-01` | Verwijder twee overbodige backend-state-updates: GLES2 wisselt het sampleprogramma bij gelijke circuits en WebGL2/GLES2 publiceren een ongewijzigde blendconstant opnieuw. | De statecache werkt op de bestaande PCRTC-revisies en alle pixels blijven exact gelijk. | Geen; zie het [PCRTC-contract](architecture.md#gx-pcrtc-dual-read-output-circuits). |
| `HOST-ATLAS-01` | Laat de platformbuild één native host-UI-atlas maken in plaats van base64 die TS en C++ tijdens runtime afzonderlijk decoderen. | Beide runtimes gebruiken dezelfde descriptorvorm zonder runtime-decoder, lazy cache of extra pixelkopie. | Geen; owners: [producer](../scripts/rompacker/host_system_atlas.ts), [TS](../machine/ts/rompack/host_system_atlas.ts), [C++](../machine/cpp/rompack/host_system_atlas.cpp). |
| `CART-EXP-01` | Specificeer en implementeer twee fysieke cartridgeslots met eigen chip selects, busarbitrage, bootkeuze, IRQ/DMA, reset en save-state. | Alle hosts laden dezelfde twee slotinputs en ROM-, RAM- en minimale MMIO/IRQ-carts bewijzen de bus. | Eerst het [slotcontract](architecture.md#cartridge-expansion-and-terminal-call) reviewen. |
| `BIOS-TERM-EXT-01` | Voeg BIOS-commando `CALL <name> [arguments]` toe voor Lua-extensies uit een cartridge; developer-tools blijven cartcode. | Descriptor-, argument-, resultaat-, timing-, completion- en pager-ABI zijn vastgelegd en één developer-cart werkt zonder hostcallbacks. | `CART-EXP-01`. |

## Doorlopende performance-audit

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `PERF-RUNTIME-01` | Kies per iteratie één gemeten hot-pathowner en verwijder daar herhaalde decode, conversie, validatie, allocatie of dispatch bij de producer. Dit is een paraplu, geen enkele megaslice. | Analyzers blokkeren nieuwe overtredingen, parity blijft exact en representatieve low-end hardware houdt 50 Hz zonder oplopende backlog. |

## Uitgesteld tot een echte backend of target beschikbaar is

| ID | Nog te bewijzen | Vereist |
| --- | --- | --- |
| `HOST-LIVE-01` | IDE en quick menu renderen correct op WebGL2 en WebGPU. | Browserhost met beide API's. |
| `GX-LIVE-01` | `bare_metal_cart` en `2025` tonen opeenvolgende frames zonder flashes, zwart beeld of gedeeltelijke commandstreams. | WebGL2 en WebGPU. |
| `GX-READ-01` | GPUREAD wrap, padding, fences, DREQ en zichtbare VRAM-inhoud komen live overeen met de softwarevectoren. | WebGL2, GLES2 en WebGPU. |
| `GX-RASTER-01` | Polygonen, lijnen, clipping, textures, CLUT, mask, blend, dither en stores komen live exact overeen met software en GPUREAD. | WebGL2, GLES2 en WebGPU. |
| `BIOS-TERM-LIVE-01` | De zichtbare F2-terminalrun heeft correcte input, glyphs, zwarte cellen en transparante lege cellen. | WebGL2, WebGPU en GLES2. |
| `HOST-SUPERVISOR-01` | Down+Select opent en sluit de terminal exact eenmaal zonder gameplayinput te lekken. | Echte SNES Mini. |
| `PERF-03` | De NV texture-barrierroute werkt zonder beeldafwijking of oplopende vertraging. | Windows RetroArch op de betreffende GPU. |
| `PERF-04` | De 16k audio-/presentatiesoak houdt 50 Hz zonder sampleverlies, backlog of periodieke hitch. | Zichtbare frontend en daarna SNES Mini. |
| `SNES-ABI-01` | De tegen de actuele target-root gebouwde core en direct host starten zonder ABI- of loaderfouten. | Actuele SNES Mini-rootdump en hardware. |

## Geparkeerd

| ID | Hervatten wanneer |
| --- | --- |
| `GX-SW-01` | Een profiel op representatieve low-end ARM-hardware een concrete software-rasterizerhotspot aanwijst. |
