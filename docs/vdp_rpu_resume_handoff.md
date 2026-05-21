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
   - pinned buffer/surface revisions;
   - constant words/banks.
9. C++ buildsystem en parity manifest zijn aangepast:
   - `src/bmsx_cpp/CMakeLists.txt`
   - `scripts/core_parity_manifest.json`

## Laatste validatie die groen was

Laatst groen gedraaid vóór deze handoff:

```bash
npx tsc --noEmit --project src/bmsx/tsconfig.json
npm run audit:core-parity
cmake --build build-cpp-tests-make --target bmsx_core --parallel 2
git diff --check
```

Let op: na de laatste groene validatie is alleen deze handoff-markdown toegevoegd.

## Huidige git status bij handoff

```text
 M scripts/core_parity_manifest.json
 M src/bmsx/machine/devices/vdp/device_output.ts
 M src/bmsx/machine/devices/vdp/frame.ts
 M src/bmsx/machine/devices/vdp/vdp.ts
 M src/bmsx/machine/devices/vdp/vout.ts
 M src/bmsx/machine/runtime/save_state/codec.ts
 M src/bmsx/render/gameview.ts
 M src/bmsx/render/vdp/view_snapshot.ts
 M src/bmsx_cpp/CMakeLists.txt
 M src/bmsx_cpp/machine/devices/vdp/device_output.h
 M src/bmsx_cpp/machine/devices/vdp/frame.cpp
 M src/bmsx_cpp/machine/devices/vdp/frame.h
 M src/bmsx_cpp/machine/devices/vdp/vdp.cpp
 M src/bmsx_cpp/machine/devices/vdp/vout.cpp
 M src/bmsx_cpp/machine/devices/vdp/vout.h
 M src/bmsx_cpp/machine/runtime/save_state/codec.cpp
 M src/bmsx_cpp/render/gameview.h
 M src/bmsx_cpp/render/vdp/view_snapshot.cpp
 M tools/retroarch-gles2
?? docs/vdp_rpu_abi_draft.md
?? docs/vdp_rpu_resume_handoff.md
?? src/bmsx/machine/devices/vdp/rpu.ts
?? src/bmsx_cpp/machine/devices/vdp/rpu.cpp
?? src/bmsx_cpp/machine/devices/vdp/rpu.h
```

`tools/retroarch-gles2` was al dirty als submodulewijziging en is niet door deze RPU-wijzigingen bedoeld aangepast.

## Belangrijke ontwerpbeslissing in huidige worktree

`VdpDeviceOutput` exposeert geen semantic rendercategorieën meer. De host ziet scanout/dither metadata plus `VdpRpuFrameOutput`.

`VdpRpuFrameResources` bevat nu zowel refs als immutable pinned revision payloads:

- `bufferRevisions`
- `surfaceRevisions`
- `bufferRefs`
- `surfaceRefs`
- `constantWords`
- `constantBanks`

Dit was nodig omdat alleen refs niet genoeg zijn voor host-side WebGL/GLES2 upload/draw execution.

## Open werk / volgende stap

De volgende echte stap is RPU packet admission aansluiten. Dit was net gestart als plan, maar er is nog geen werk gedaan aan admission in deze laatste stap.

Aanbevolen resume-volgorde:

1. Re-run validatie na deze handoff-file:

```bash
npx tsc --noEmit --project src/bmsx/tsconfig.json
npm run audit:core-parity
cmake --build build-cpp-tests-make --target bmsx_core --parallel 2
git diff --check
```

2. Implementeer een echte RPU admission owner in TS/C++:
   - packet kind `VDP_RPU_PACKET_KIND`;
   - lifecycle checks;
   - resource definition/upload/discard;
   - constant bank definition/upload;
   - begin/end pass;
   - begin/end draw;
   - stream/constant/texture bindings.
3. Sluit RPU packet kind aan in VDP stream dispatch:
   - `consumeReplayPacketFromMemory`
   - `consumeReplayPacketFromWords`
   - TS en C++.
4. Zorg dat admission `buildFrame.rpu` vult, niet VOUT direct.
5. Voeg/controleer fault mapping:
   - `VDP_FAULT_RPU_BAD_PACKET`
   - `VDP_FAULT_RPU_BAD_SHADER`
   - `VDP_FAULT_RPU_BAD_STREAM_LAYOUT`
   - `VDP_FAULT_RPU_BUFFER_OOB`
   - `VDP_FAULT_RPU_STALE_RESOURCE`
   - `VDP_FAULT_RPU_BAD_SURFACE_USAGE`
   - `VDP_FAULT_RPU_BAD_CONSTANT_RANGE`
   - `VDP_FAULT_RPU_UNSUPPORTED_FEATURE`
   - `VDP_FAULT_RPU_COMMAND_OVERFLOW`
   - `VDP_FAULT_RPU_BAD_STATE`
6. Daarna pas backend execution aanpakken.

## Niet vergeten

- Geen lokale fixed/register/encoding helpers in random feature files.
- Geen defensive fallback voor BMSX-owned state.
- Geen legacy behavior bewaren als het botst met het RPU/hardwaremodel.
- TS/C++ mirrored runtime parity blijven valideren.
- Subagent review is verplicht als later parity/architectuurcleanheid wordt geclaimd volgens de coding-bible gate.
