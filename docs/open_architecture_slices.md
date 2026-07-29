# Openstaande architectuur-slices

Dit bestand is alleen de werkvoorraad. Afgeronde hardwarecontracten horen in
[`architecture.md`](architecture.md); testuitslagen en implementatiegeschiedenis
horen niet in deze lijst.

## Bewezen architectuurblockers

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `PARITY-BOOT-01` | Maak boot-, media-, `Memory`- en runtime-eigenaarschap in TS en C++ werkelijk gelijk. Contentlifecycle blijft bij de producthost; de machine consumeert het fysieke ROM-medium rechtstreeks. | `MachineManager`, `RuntimeOptions` en de constructieflow hebben één betekenis in beide runtimes, of een overbodige managerlaag is verwijderd. Er zijn geen lifecyclefacades, dubbele ROM-eigenaren of taalafhankelijke publieke machine-API's. |
| `PARITY-FRAME-01` | Haal host-wandklok en presentatietijd uit de machine-owned `FrameLoopState`. | De mirrored framestate bevat alleen emulatietijd en machine-uitvoering; browser en libretro bewaren hun eigen presentatietijd boven de core zonder cart-zichtbaar verschil. |
| `PARITY-AUDIT-01` | Laat de parity-audit het gedeclareerde contract werkelijk afdwingen nadat de eigenaars zijn gelijkgetrokken. | `public_symbol_parity` wordt uitgevoerd, verdwenen roots kunnen niet groen blijven en publieke paden, namen, representaties en eigenaarschap van de twee cores worden gecontroleerd. De audit bevat geen skiplist of cosmetische uitzondering om bestaande verschillen te verbergen. |
| `SOLUTION-TS-01` | Splits de TypeScript-solution volgens de al bestaande dependencyrichting: machine-core, gedeelde host-support, language/compiler en ROM-authoringtooling zijn afzonderlijke build/package-eigenaren. | `@bmsx/machine` compileert alleen de emulatiemachine; hosts delen één host-supporttarget; compiler en rompacker zijn geen runtimeonderdeel. Er komt geen facade of duplicatie per browser/Node-host bij. |
| `BUILD-GEN-01` | Behoud automatische generatie van de host-system-atlas, maar maak die een expliciete buildgraph-prerequisite in plaats van productcode die rompacker-internals uitvoert. | Product- en deploymodules importeren geen ROM-authoringcode; een normale productbuild regenereert stale atlasartefacten nog steeds automatisch en deterministisch, zonder handmatige stap of featureverlies. |
| `MODEL-VRAM-01` | Maak geïnstalleerde VRAM-capaciteit werkelijk model- en device-owned, zonder de vaste GX-adresgeometrie met de fysieke backing te verwarren. Specificeer eerst per model de ontbrekende adresdecode/alias/open-bus-semantiek en selecteer het model vóór backendconstructie. | GX, save-state en alle software/WebGL2/WebGPU/GLES2-datapaden gebruiken dezelfde geïnstalleerde backing en fysieke decode. Backends alloceren exact eenmaal voor het geselecteerde model; er is geen 2-MiB-schaduwbuffer, hostfallback of alleen-cosmetische capaciteitswaarde. |

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
