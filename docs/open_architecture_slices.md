# Openstaande architectuur-slices

Dit bestand is alleen de werkvoorraad. Afgeronde hardwarecontracten horen in
[`architecture.md`](architecture.md); testuitslagen en implementatiegeschiedenis
horen niet in deze lijst.

## Structurele uitvoeringsvolgorde

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `CPU-VALUE-01` | Houd de producer-owned guest-value-tag en payload in de TypeScript-CPU intact door registers, interpreterdispatch, builtins en Lua-tablehotpaths; classificeer niet opnieuw via JavaScript-hostwaarden. | TS en C++ hebben aan iedere VM-grens dezelfde guestrepresentatie en semantiek. De TS-hotpaths wissen geen bekende tags om ze daarna via `null`, booleans, `typeof`, objectidentiteit of shape-probes terug te vinden; er komen geen BigInt-hotpath, wrappers of allocaties bij. |
| `HOST-BOUNDARY-01` | Ontmantel de brede TypeScript-`Platform`-service-locator en plaats storage, clipboard, HID, onscreen UI, audio, RNG, input en video bij hun werkelijke host/productowner. | De machine-facing hostgrens is klein en conceptueel gelijk in TS/C++; player, Studio, headless en libretro behouden hun features zonder optionele facade, callbackprovider of host-magie in de machine. |
| `STUDIO-BOUNDARY-01` | Maak Studio een product boven de emulatorgrens in plaats van een consument van concrete TS-CPU-heapklassen. Neem de IDE-only firmwareasset hierbij mee. | AEM reload, Hot Resume, foutdiagnostiek en value-inspectie blijven werken via owner-defined runtime/toolingoperaties; Studio importeert geen concrete `Closure`-, `Table`- of `StringValue`-implementatie en de BIOS-ROM bevat geen IDE-assets. |
| `PARITY-COVERAGE-01` | Laat de parity-audit de werkelijke machinegrens bewaken nadat host- en Studio-code hun juiste owner hebben. | Brede paduitzonderingen verbergen geen machinecode of afwijkende machinecontracten; iedere resterende uitsluiting is een echte taal-, host- of productgrens en een groene audit bewijst de geclaimde TS/C++-surface. |
| `GX-REVISION-OWNER-01` | Leg de lifetime van GX command-, snapshot- en replacementrevisions bij de owner die backendinvalidatie over reset en machinevervanging werkelijk beheert. | Geen mutable process-global devicecounters; meerdere machines beïnvloeden elkaars revisions niet, terwijl iedere backend reset, restore en machinevervanging zonder stale cache verwerkt. TS, C++, software en accelerated backends volgen hetzelfde contract. |

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
