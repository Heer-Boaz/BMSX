# Openstaande architectuur-slices

Dit bestand is alleen de werkvoorraad. Afgeronde hardwarecontracten horen in
[`architecture.md`](architecture.md); testuitslagen en implementatiegeschiedenis
horen niet in deze lijst.

## Doorlopende architectuurgates

| ID | Controle | Groen wanneer |
| --- | --- | --- |
| `PARITY-COVERAGE-01` | Laat de parity-audit de werkelijke machinegrens bewaken nadat host- en Studio-code hun juiste owner hebben. | Brede paduitzonderingen verbergen geen machinecode of afwijkende machinecontracten; iedere resterende uitsluiting is een echte taal-, host- of productgrens en een groene audit bewijst de geclaimde TS/C++-surface. |

## Doorlopende performance-audit

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `PERF-RUNTIME-01` | Kies per iteratie één gemeten hot-pathowner en verwijder daar herhaalde decode, conversie, validatie, allocatie of dispatch bij de producer. Dit is een paraplu, geen enkele megaslice. | Analyzers blokkeren nieuwe overtredingen, parity blijft exact en representatieve low-end hardware houdt 50 Hz zonder oplopende backlog. |

## Cart-side SDK

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `CARTLIB-OWNERS-01` | Splits de monolithische `ecs/builtin`- en `ecs/systems`-pack per werkelijke systemowner en laat iedere cart zijn pipeline expliciet samenstellen. | Een cart linkt alleen gekozen systems; met name niet-GEO-carts linken geen overlap/collision-owner, en er komt geen nieuwe application- of featurefacade voor terug. |
| `CARTLIB-HOT-01` | Compileer FSM-, event- en action-effectwerk eenmaal en verwijder closures, padparsing en tijdelijke tables uit normale frame- en transitionpaden. | Bestaande semantics blijven behouden en normale dispatch/update/transition maakt geen guest-heapobjecten voor infrastructuur aan. |
| `CARTLIB-GX-01` | Maak GX/GTE een compacte low-level SDK rond raw registers, opcodes, packets en DMA; verplaats camera-, scene- en renderbeleid naar carts of optionele libraries. | De hardwarelaag bevat alleen echte protocollen, hergebruikt retained packet/state en schrijft niet per primitive opnieuw ongewijzigde GPU-state. |
| `CARTLIB-SURFACE-01` | Verwijder ongebruikte pre-GTE-code en verplaats aantoonbaar cart-specifieke utilities naar hun cart nadat de live require-graaf dit bewijst. | Geen compatibilitylaag blijft achter en alle nog publieke cartlibmodules bezitten herbruikbare console-SDK-functionaliteit. |

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
| `GX-REVISION-OWNER-01` | Meerdere gelijktijdige machines of een behouden backend over machinevervanging een concrete revision-collision kan observeren. |
| `GX-SW-01` | Een profiel op representatieve low-end ARM-hardware een concrete software-rasterizerhotspot aanwijst. |
| `BIOS-TERM-EXT-01` | Er een concrete behoefte is en de command-, call/return- en terminal-output-ABI voor een door firmware geselecteerde developer-cartridge is ontworpen. |
