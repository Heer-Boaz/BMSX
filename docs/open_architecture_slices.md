# Openstaande architectuur-slices

Dit bestand is alleen de werkvoorraad. Afgeronde hardwarecontracten horen in
[`architecture.md`](architecture.md); testuitslagen en implementatiegeschiedenis
horen niet in deze lijst.

## Overnamepunt

Begin een nieuwe slice altijd met `git status --short --branch`, de recente
`git log` en de live owners. Deze lijst is een werkhypothese, geen toestemming
om een beschreven oplossing mechanisch te bouwen.

De huidige inputgrenzen zijn:

- ICU bezit uitsluitend de rauwe keyboard-, pointer-, pad- en outputregisters.
  Action maps, repeats, consumptie, shortcuts en device-assignment horen daar
  niet in;
- de browserhost bezit fysieke devices en expliciete toewijzing aan player
  1--4. De onscreen gamepad neemt als gewoon device aan diezelfde toewijzing
  deel;
- libretro ontvangt reeds genormaliseerde logische frontendports. Iedere
  geconfigureerde JOYPAD-port kan de quick menu, terminal en onscreen keyboard
  besturen; pad 0 heeft geen speciale overlayrol meer;
- het onscreen keyboard is een host-owned virtuele keyboardbron naast het
  fysieke keyboard. Het is geen ICU-feature en geen guest-eventinjector;
- de SNES Mini-build gebruikt GCC 10/C++17. BLua32-f64-woorden worden centraal
  little-endian gelezen en geschreven; targetcode mag niet opnieuw afhankelijk
  worden van C++20 `std::bit_cast`.

De verborgen hold-Start-assignmentflow is geen open herstelpunt. Browserdevices
worden zichtbaar via de quick menu toegewezen; bij libretro blijft fysieke
controller-naar-port-toewijzing eigendom van de frontend.

## Eerstvolgende ontwerpslice

### `HOST-INPUT-REMAP-01` — remapping zonder ownervermenging

De quick menu kan volledige gamepads aan players toewijzen, maar bezit nog geen
contract voor het remappen van afzonderlijke D-pad-, button-, stick- en
triggercontrols. Dit is eerst een owner- en representatievraag; implementeer nog
niets voordat deze tabel voor browser en libretro is ingevuld:

| Grens | Voorbeelden | Beoogde owner |
| --- | --- | --- |
| Fysiek device | browser Gamepad, onscreen pad, frontendcontroller | host/frontend |
| Genormaliseerde padcontrol | `BGamepadButton`, axis, libretro RetroPad-control | host input adapter |
| Device-to-player | browser `DeviceBinding`, libretro port | browserhost respectievelijk frontend |
| Logische gameplayactie | bewegen, vuren, pauze | cart/cartlib |

Lees daarvoor eerst de actuele owners
`hosts/common/input/{manager,player,shortcuts}.ts`,
`hosts/common/host_overlay_menu.ts`,
`hosts/libretro/{input,host_overlay_menu}.{h,cpp}` en
`cartlib/input/input.lua`. Benoem vóór een mirrored edit expliciet de
frame-hot-paths `Input.pollInput()`, `HostOverlayMenu.tickInput()`,
`LibretroInput::poll()` en `HostOverlayMenu::tickInput()`; een remap mag daar
alleen een reeds gecompileerde retained lookup zijn.

Onderzoek als productiereferenties minimaal SDL's
[`SDL_gamepad.c`](https://github.com/libsdl-org/SDL/blob/main/src/joystick/SDL_gamepad.c),
RetroArchs
[`input-and-controls`](https://github.com/libretro/docs/blob/master/docs/guides/input-and-controls.md)
en Godots
[`InputMap`](https://github.com/godotengine/godot/blob/master/core/input/input_map.cpp).
Classificeer daarbij apart:

1. device-normalisatie/autoconfig;
2. user-remapping van genormaliseerde controls;
3. device-to-player-assignment;
4. cart-authored logical-action binding.

Klaar wanneer de gekozen grens browserdevices, touchscreen en libretroports
kan representeren zonder een tweede frontendremapper in libretro, zonder een
globale stick-naar-D-pad-default en zonder fysieke controls in cartcode. De
runtime-hot-path gebruikt retained tabellen/records en doet geen stringmatching,
allocatie of herhaalde mappingcompilatie per frame.

Verboden richtingen zijn remapping in ICU/MMIO, een cartlib-default die sticks
en D-pad samenvoegt, cart-specifieke hostcode, een legacy-dual-path en een
facade die browserassignment en libretroports ten onrechte hetzelfde device-
lifecyclecontract geeft.

## Validatiebasis voor inputwerk

Een inputslice is pas overdraagbaar wanneer de relevante subset hiervan groen
is en ieder interactief restant in de tabel verderop blijft staan:

```sh
npx tsx --tsconfig tsconfig.base.json --test \
  --import ./tests/lua/test_setup.ts \
  tests/lua/host_input_routing.test.ts \
  tests/lua/input_manager.test.ts
cmake --build build-cpp-tests --target \
  bmsx_libretro_host_shortcuts_tests \
  bmsx_libretro_save_state_tests -j2
ctest --test-dir build-cpp-tests --output-on-failure \
  -R 'bmsx_libretro_(host_shortcuts|save_state)_tests'
npm run audit:core-parity
npm run audit:architecture-boundaries -- --summary-only
npm run build:platform:libretro-snesmini:debug
```

De laatste opdracht is de GCC-10 cross-build, ABI-check en QEMU-smoke. Zij
vervangt de hieronder genoemde fysieke SNES Mini-validatie niet.

## Doorlopende performance-audit

| ID | Opdracht | Klaar wanneer |
| --- | --- | --- |
| `PERF-RUNTIME-01` | Kies per iteratie één gemeten hot-pathowner en verwijder daar herhaalde decode, conversie, validatie, allocatie of dispatch bij de producer. Dit is een paraplu, geen enkele megaslice. | Analyzers blokkeren nieuwe overtredingen, parity blijft exact en representatieve low-end hardware houdt 50 Hz zonder oplopende backlog. |

## Vereist een interactieve backend of fysieke target

| ID | Nog te bewijzen | Vereist |
| --- | --- | --- |
| `HOST-GX-LIVE-01` | IDE, quick menu, BIOS-terminal, `bare_metal_cart` en `2025` tonen stabiele opeenvolgende frames met correcte input, glyphs en terminalcellen, zonder flashes, zwart beeld of halve commandstreams. | WebGL2 en WebGPU; de terminal ook op GLES2. |
| `GX-READ-01` | GPUREAD wrap, padding, fences, DREQ en zichtbare VRAM-inhoud komen live overeen met de softwarevectoren. | WebGL2, GLES2 en WebGPU. |
| `GX-RASTER-01` | Polygonen, lijnen, clipping, textures, CLUT, mask, blend, dither en stores komen live exact overeen met software en GPUREAD. | WebGL2, GLES2 en WebGPU. |
| `HOST-OSK-LIVE-01` | Touch en iedere toegewezen/aangesloten controller openen en besturen quick menu en onscreen keyboard. Shift, Backspace, Delete, spatie, Enter, cursor, Home/End en lowercase/uppercase labels werken; sluiten lekt geen chord of letter naar cart, terminal of IDE. Cheat-/sealtekst kan zonder fysiek keyboard worden ingevoerd. | iPhone/browser en echte SNES Mini. |
| `HOST-SUPERVISOR-01` | Select+L opent en sluit de terminal vanaf iedere aangesloten frontendport exact eenmaal zonder gameplayinput te lekken. | Echte SNES Mini. |
| `PERF-03` | De op de echte target geselecteerde ARM-fetch-, NV-barrier- of dependency-copyroute rendert exact en houdt 50 Hz zonder backlog. | Windows RetroArch en echte SNES Mini. |
| `PERF-04` | De 16k audio-/presentatiesoak houdt 50 Hz zonder sampleverlies, backlog of periodieke hitch. | Zichtbare frontend en daarna SNES Mini. |
| `SNES-ABI-01` | De door de GCC-10 cross-build en QEMU-smoke geaccepteerde core start tegen de actuele target-root en frontend zonder ABI-, loader- of GLES2-fouten. | Actuele SNES Mini-rootdump en hardware. |

## Geparkeerd

| ID | Hervatten wanneer |
| --- | --- |
| `GX-REVISION-OWNER-01` | Meerdere gelijktijdige machines of een behouden backend over machinevervanging een concrete revision-collision kan observeren. |
| `GX-SW-01` | Een profiel op representatieve low-end ARM-hardware een concrete software-rasterizerhotspot aanwijst. |
| `BIOS-TERM-EXT-01` | Er een concrete behoefte is en de command-, call/return- en terminal-output-ABI voor een door firmware geselecteerde developer-cartridge is ontworpen. |

### `GX-CART-LAYOUT-01` — filename-driven cartridge-VRAM-layout

De huidige producergrens blijft voorlopig behouden. Een imagebestand bepaalt met
`@atlas=N` zijn atlaslidmaatschap; de rompacker verwijdert dit suffix uit het
uiteindelijke `imgid`, bouwt de atlas en genereert de fysieke bindings.
Gameplay gebruikt uitsluitend `imgid` en logische sourceregio's. Een
cart-authored fysieke layout aan de ROM-buildgrens is daarmee niet hetzelfde als
fysieke VRAM-coordinaten die naar gameplaycode lekken: zij vervult de rol van
een linker-layout voor beperkt consolegeheugen.

Een vervanging door YAML-lijsten met assets, streams, capacities of semantische
working sets is expliciet verworpen. Die aanpak dupliceert informatie die de
filename-driven importer al bezit en maakt de cartridgeproducer omslachtiger.
Een toekomstige slice moet daarom het bestaande contract veld voor veld
classificeren en alleen verkeerd eigendom of echte duplicatie verwijderen:

- atlaslidmaatschap blijft filename-owned;
- concrete atlasinhoud en afmetingen worden door rompacker en atlasbuilder
  afgeleid;
- de system-VRAM-reservering en GX-alignment zijn machine/tooling-owned en horen
  niet per cartridge te worden herhaald;
- bewuste framebufferplaatsing, slot-aliasing en gelijktijdige residency mogen
  cart-ROM-layoutbeslissingen blijven;
- runtime-uploadmomenten blijven gameplay-owned;
- `gx_texture.upload(imgid)`, logische sourceregio's, `upload_raw` en directe
  raw-GX-programmering blijven beschikbaar.

Verboden oplossingsrichtingen voor deze slice zijn een runtime-VRAM-allocator,
per-frame residencygraphs of stringmatching, een `GameView`, dubbele
filename/YAML-assetregistratie, een legacy-dual-path en readinessguards rond
IMGDEC. Uploadadmission mag de vooraf berekende bestemming publiceren voordat
IMGDEC gereed is; tijdelijk ongeinitialiseerde VRAM is bedoeld hardwaregedrag.

Hervatten wanneer de huidige fysieke layout opnieuw concreet producerwerk
dupliceert of een nieuwe cartridge niet zonder handmatige coordinaten kan worden
gepakt. Begin dan met een live inventaris van `framebuffers`, `reserved`,
`slots`, `groups` en `working_sets`; behoud ieder veld dat een bewuste
cartridge-linkbeslissing vertegenwoordigt.
