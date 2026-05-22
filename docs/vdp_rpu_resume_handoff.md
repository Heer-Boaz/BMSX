# VDP RPU redesign - tussenstop / resume handoff

Datum: 2026-05-21
Werkmap: `/home/boaz/BMSX`

## Gebruikersnotitie

De gebruiker vroeg expliciet om in deze markdown op te nemen: **de agent is een faler die allemaal inefficiente code heeft geschreven.**

## Oorspronkelijke doel

Vervang alle aparte cart-zichtbare VDP render-units door één RPU (Render Processing Unit):

- vaste shader-varianten, geen cart-uploadbare shaders;
- cart levert raw vertex-, instance-, index- en constantdata via DMA/MMIO;
- host voert retained RPU command buffer uit als WebGL/GLES2 drawcalls;
- geen CPU-rendering fallback behalve expliciete bestaande software backend;
- VDP/host kennen geen semantiek als billboard, mesh, parallax of skybox.

## Huidige status

Er is nog geen volledige RPU-implementatie. De huidige worktree bevat een eerste RPU data/ABI-skelet plus host-output en frame-handoff veranderingen. Het doel is dus **niet klaar**.

Belangrijkste gerealiseerde stappen:

1. `docs/vdp_rpu_abi_draft.md` toegevoegd.
   - Beschrijft RPU host-output shape, packet schema, fixed capacities, stream layouts, shader variants, buffer/resource model, fault model, frame handoff en save-state shapes.
2. Nieuwe RPU datafiles toegevoegd:
   - `src/bmsx/machine/devices/vdp/rpu.ts`
   - `src/bmsx_cpp/machine/devices/vdp/rpu.h`
   - `src/bmsx_cpp/machine/devices/vdp/rpu.cpp`
3. `VdpDeviceOutput` is versmald naar scanout metadata plus `rpu`:
   - TS: `src/bmsx/machine/devices/vdp/device_output.ts`
   - C++: `src/bmsx_cpp/machine/devices/vdp/device_output.h`
   - Legacy outputvelden zoals `billboards`, `meshes`, `skyboxSamples`, XF/LPU/MFU/JTU snapshots zijn uit `VdpDeviceOutput` gehaald.
4. Host snapshot schrijft nu alleen de RPU frame pointer/reference door:
   - `src/bmsx/render/vdp/view_snapshot.ts`
   - `src/bmsx_cpp/render/vdp/view_snapshot.cpp`
   - Oude host-side semantic render counts worden op nul gezet zodat legacy scene state niet meer uit `VdpDeviceOutput` wordt opgebouwd.
5. RPU frame payload is door de frame pipeline getrokken:
   - `VdpBuildingFrameState.rpu`
   - `VdpSubmittedFrame.rpu`
   - VOUT visible RPU frame
   - `VdpDeviceOutput.rpu`
6. RPU frame handoff gebruikt swaps:
   - build frame -> submitted frame bij seal;
   - submitted frame -> visible VOUT frame bij present.
7. Centrale RPU helpers toegevoegd:
   - TS: `createVdpRpuFrameOutput`, `resetVdpRpuFrameOutput`, `captureVdpRpuFrameState`, `restoreVdpRpuFrameState`
   - C++: dezelfde functionele helpers in `rpu.cpp`/`rpu.h`
8. RPU save-state payloads zijn toegevoegd aan TS en C++ codecs:
   - command buffer prefixes;
   - buffer/surface refs;
   - live RPU buffer arena save/restore plus frame ref rebinding;
   - constant words/banks.
9. C++ buildsystem en parity manifest zijn aangepast:
   - `src/bmsx_cpp/CMakeLists.txt`
   - `scripts/core_parity_manifest.json`
10. TS en C++ ingress tests zijn aangepast aan de RPU-breaking change:
   - obsolete SBX/BBU `VdpDeviceOutput` assertions zijn verwijderd;
   - de eerdere XF submitted-frame snapshot-test is verwijderd omdat die internals controleerde in plaats van input->output;
   - de eerdere RPU-retained-internals test is verwijderd omdat die de implementatie nabootste in plaats van input->output te valideren.
11. De RPU WebGL/GLES2 executor heeft nu texture-coordinate attributes en sampler2D-uitvoering voor `V2_T2_C4` / `V3_T2_C4_C0` op bestaande VDP slot textures.
12. RPU-owned pass attachments zijn in TS/C++ executor aanwezig:
   - `RGBA8` color attachments worden GPU textures;
   - `DEPTH16` depth attachments worden baseline renderbuffers;
   - zero-draw passes met clears blijven uitvoerbaar omdat de backend passCount gebruikt, niet drawCount.
13. Instanced RPU shader variants zijn in TS/WebGL en C++/GLES2 aangesloten:
   - `V2_T2_C4_I_AFFINE2` gebruikt een raw affine2/uvrect/color instance stream;
   - `V3_C4_I_MAT4` gebruikt een raw mat4/color instance stream;
   - de executor gebruikt GPU instanced drawcalls (`draw*Instanced`) en geen CPU-expansie.
14. Skinning/lighting shader variants hebben nu GPU-datapaths in TS/C++:
   - `V3_N3_T2_C4_C0_C1` gebruikt normal/uv/color streams plus C0/C1 constants;
   - `V3_N3_T2_C4_J4_W4_C0_C1` gebruikt joints/weights plus joint matrices;
   - stream binding gebruikt nu de cart-zichtbare stream slots: slot 0 voor vertexdata, slot 1 voor instancedata; latere binds voor dezelfde slot winnen.
15. `bare_metal_cart` is omgezet naar RPU-packets via een centrale BIOS RPU-helper:
   - geen cart-zichtbare BBU/MDU/SBX packets meer in de cart;
   - parallax/sprite/billboard-equivalenten zijn cart-authored affine instance draws;
   - skybox/achtergrond-equivalent is een cart-authored RPU background draw;
   - mesh/morph/lighting-equivalent is cart-authored vertex-buffer update plus vaste `V3_N3_T2_C4_C0_C1` shader.
16. De oude cart-zichtbare SBX MMIO/globals/descriptors zijn verwijderd; de dode IO-window blijft wel gereserveerd zodat IRQ/DMA-adressen niet stil verschuiven.
17. RPU constants kunnen nu vanuit VDP device-registerfiles komen:
   - `CONSTANT_UPLOAD_DEVICE` kopieert XF/LPU/MFU/JTU-registerwoorden naar normale RPU constant banks;
   - XF/MFU/JTU Q16.16 words worden bij de RPU-boundary naar f32-constantwords gedecodeerd;
   - LPU-registerwoorden blijven raw;
   - `bare_metal_cart` routeert de mesh C0-matrix via een centrale `bios/vdp_xf.lua` helper en uploadt daarna vanuit XF naar de RPU;
   - `bare_metal_cart` routeert C1 lighting constants via een centrale `bios/vdp_lpu.lua` helper en uploadt daarna raw vanuit LPU naar de RPU;
   - BIOS/cart buffer writes gebruiken nu write-pointer assignments (`mem[wp], wp = ...` / `memwritef32(...)`) voor sequentiele vertex-, instance- en constantdata in plaats van lokale addr+stride schrijfpatronen.

## Laatste validatie die groen was

Laatst groen gedraaid in deze werkboom:

```bash
npx tsc --noEmit --project src/bmsx/tsconfig.json
npx tsx --test --import ./tests/lua/test_setup.ts tests/lua/vdp_ingress.test.ts
npx tsx --test --import ./tests/lua/test_setup.ts tests/lua/runtime_save_state_codec.test.ts
cmake --build build-cpp-tests-make --target bmsx_vdp_ingress_tests --parallel 2
./build-cpp-tests-make/bmsx_vdp_ingress_tests
cmake --build build-debug --target bmsx_core --parallel 2
npm run audit:core-parity
npm run build:bios -- --force
npm run build:game -- bare_metal_cart --force
rg -n "Number\\.isFinite|Number\\.isNaN|isNaN|typeof .*number|Math\\.floor|Math\\.ceil" src/bmsx/machine/devices/vdp src/bmsx/render/backend/webgl src/bmsx_cpp/machine/devices/vdp src/bmsx_cpp/render/backend/gles2 bios/vdp_rpu.lua bios/vdp_rpu_quads.lua bios/vdp_xf.lua bios/vdp_lpu.lua src/carts/bare_metal_cart/cart.lua && exit 1 || true
git diff --check
```

Let op: dit handoff-bestand zelf blijft een tussensnapshot; vertrouw bij resume
op `git status` en herhaal de validatie.

Headless runtime-smoke is geprobeerd, maar niet als groen bewijs meegenomen: de
huidige BIOS runtime faalt al bij boot op bestaande `bios/input/action_effect/*`
bron met dynamische `&(...)` string-id syntax. Dat staat los van de RPU-cart
migratie en moet apart worden opgelost voordat een visuele headless smoke als
validatie kan tellen.

## Huidige git status bij handoff

Deze eerdere snapshot is niet langer betrouwbaar na de backend-split. Gebruik `git status --short` als actuele bron; de RPU backendfiles staan nu onder `src/bmsx/render/backend/webgl/` en `src/bmsx_cpp/render/backend/gles2/`, niet onder een gedeelde `render/rpu` map.

## Belangrijke ontwerpbeslissing in huidige worktree

`VdpDeviceOutput` exposeert geen semantic rendercategorieën meer. De host ziet scanout/dither metadata plus `VdpRpuFrameOutput`.

Representable-maar-weird RPU command buffers zijn **geen blocker**. De RPU is emulatorhardware, geen high-level render API. Structurele packet/resource fouten mogen faulten bij admission, maar zodra een command buffer representable is moet de backend hem blind uitvoeren en mag het resultaat raar renderen.

Deze correctie is doorgetrokken in packet admission: shader-woorden decoderen
naar de vaste low-bit variantselector, onbekende stream-layout ids worden
retained en gebruiken alleen een deterministic fallback-stride voor range
pinning, en buffer/surface usage-mismatches faulten niet als high-level API
validatie.

`VdpRpuFrameResources` heeft nu no-copy refs tegen de RPU buffer arena:

- `bufferRefs`
- `surfaceRefs`
- `constantWords`
- `constantBanks`

De resource-retention keuze is bewust live-aliasing: retained frame refs wijzen
naar RPU-owned arena storage, niet naar frame-owned byte snapshots. Als de cart
een buffer muteert terwijl een submitted/visible command buffer die buffer nog
refereert, ziet de backend de actuele bytes en mag dat raar renderen. Dat is
emulatorhardwaregedrag en geen high-level API blocker. Save-state serialiseert
alleen de live arena-prefixes van gedefinieerde buffers en rebinding herstelt de
runtime aliases na restore.

## Open werk / volgende stap

RPU packet admission, live arena resource retention, VDP-device constant upload
en een eerste WebGL/GLES2 executor zijn aanwezig. De laatste LPU-routing stap
heeft bewust geen nieuwe retained-internals assertions toegevoegd; de eerdere RPU-internals test is verwijderd en validatie
moet input->output via build/rompack/runtime-smoke of bestaande tests blijven. De executor tekent nu de color-layout familie, kan
`V3_C4_C0` / `V3_T2_C4_C0` met C0-matrixconstants uitvoeren, en heeft een
texture-sampling pad voor `V2_T2_C4` / `V3_T2_C4_C0` via bestaande VDP
slot-textures. RPU-owned pass attachments zijn nu ook doorgetrokken naar de
TS/C++ executors: `RGBA8` color attachments worden backend-textures en `DEPTH16`
depth attachments worden renderbuffer-style depth storage. Instanced variants
voor affine2 en mat4 lopen via GPU instanced drawcalls. Skinning/lighting
variants hebben nu een eerste GPU-only shaderpad met raw joint/lighting
constants. Het doel is nog niet klaar omdat volledige eindvalidatie, visuele runtime-smoke en
review nog open zijn.

Aanbevolen resume-volgorde:

1. Re-run validatie na deze handoff-file:

```bash
npx tsc --noEmit --project src/bmsx/tsconfig.json
npx tsx --test --import ./tests/lua/test_setup.ts tests/lua/vdp_ingress.test.ts
npx tsx --test --import ./tests/lua/test_setup.ts tests/lua/runtime_save_state_codec.test.ts
npm run build:bios -- --force
npm run build:game -- bare_metal_cart --force
cmake --build build-debug --target bmsx_core --parallel 2
cmake --build build-cpp-tests-make --target bmsx_vdp_ingress_tests --parallel 2
./build-cpp-tests-make/bmsx_vdp_ingress_tests
npm run audit:core-parity
rg -n "Number\\.isFinite|Number\\.isNaN|isNaN|typeof .*number|Math\\.floor|Math\\.ceil" src/bmsx/machine/devices/vdp src/bmsx/render/backend/webgl src/bmsx_cpp/machine/devices/vdp src/bmsx_cpp/render/backend/gles2 bios/vdp_rpu.lua bios/vdp_rpu_quads.lua bios/vdp_xf.lua bios/vdp_lpu.lua src/carts/bare_metal_cart/cart.lua && exit 1 || true
git diff --check
```

2. Verbind RPU-owned texture sampling verder waar nodig; depth-texture sampling
   blijft achter `VDP_RPU_FEATURE_DEPTH_TEXTURE`.
3. Draai een visuele/runtime smoke op `bare_metal_cart` met de RPU-demo:
   - parallax via cart-authored affine/uv data;
   - mesh/morph/lighting via fixed RPU variants;
   - skybox-equivalent fullscreen/background work als cart-authored draws.
4. Houd admission op `buildFrame.rpu`; VOUT mag alleen sealed submitted frames
   presenteren.
5. Controleer fault mapping:
   - `VDP_FAULT_RPU_BAD_PACKET`
   - `VDP_FAULT_RPU_BAD_STREAM_LAYOUT` voor structurele stream-binding opslagfouten, niet voor onbekende layout ids
   - grote draw-count woorden mogen doorstromen; byte-span berekening wrapt als registerwoord en wordt geen semantische draw-reject
   - `VDP_FAULT_RPU_BUFFER_OOB`
   - `VDP_FAULT_RPU_STALE_RESOURCE`
   - `VDP_FAULT_RPU_BAD_SURFACE_USAGE` voor ontbrekende/zero-size surface resources, niet voor usage-mismatches
   - `VDP_FAULT_RPU_BAD_CONSTANT_RANGE`
   - `VDP_FAULT_RPU_COMMAND_OVERFLOW`
   - `VDP_FAULT_RPU_BAD_STATE`

## Niet vergeten

- Geen lokale fixed/register/encoding helpers in random feature files.
- Geen defensive fallback voor BMSX-owned state.
- Geen legacy behavior bewaren als het botst met het RPU/hardwaremodel.
- TS/C++ mirrored runtime parity blijven valideren.
- Subagent review is verplicht als later parity/architectuurcleanheid wordt geclaimd volgens de coding-bible gate.
