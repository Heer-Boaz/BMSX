# GPU startup/reset facts — frozen 2026-10-18

Facts only; repository-relative paths. Pending public startup-state clarification, not a new chapter approval. No architecture document or reference PDF was opened. No paired-owner/spec disagreement was found in this bounded extraction.

| Fact | TypeScript evidence | C++ evidence |
|---|---|---|
| Full device `GxGpu.reset()` resets PCRTC, clears GPUREAD and Y-extension, resets command state, initializes VRAM bytes, installs GPU defaults and latches presentation registers. This is not the GP1 command. | `machine/ts/machine/devices/gx/gpu.ts:475–490` | `machine/cpp/machine/devices/gx/gpu.cpp:66–81` |
| VRAM initializer is a reproducible fixed-seed patterned power-on store, not an all-zero clear; this does not mean every word is nonzero. Generator constants/algorithm are not needed in public prose. | `machine/ts/machine/devices/gx/vram_power_on.ts:3–13,73–86` | `machine/cpp/machine/devices/gx/vram_power_on.cpp:8–20,79–92` |
| GP1(00h) clears GP0 stream state and resets GPU control registers, not VRAM or PCRTC; `resetGpuRegisters` does not assign GPUREAD or Y-extension. | `machine/ts/machine/devices/gx/gpu.ts:1340–1350,755–772` | `machine/cpp/machine/devices/gx/gpu.cpp:850–859,285–302` |
| PCRTC CSR RESET clears GP0 stream state, resets GPU registers/PCRTC and latches presentation; no VRAM initialization, GPUREAD clear or Y-extension assignment occurs on this path. | `machine/ts/machine/devices/gx/gpu.ts:1409–1418,755–772` | `machine/cpp/machine/devices/gx/gpu.cpp:918–927,285–302` |
| PCRTC's own reset restores config/present words, CSR/IMR, sets field zero, restarts beam; it has no pixel-store initialization. | `machine/ts/machine/devices/gx/gpu_pcrtc.ts:560–571` | `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:305–316` |
| GP1/CSR stream-clear operations can retain accepted drawing and flush a consumed image-upload prefix. “Not a VRAM clear” is correct; “all pixels stay unchanged” is not. Words only waiting in input FIFOs are discarded. | `machine/ts/machine/devices/gx/gpu.ts:1609–1626,1663–1671` | `machine/cpp/machine/devices/gx/gpu.cpp:1087–1105,1140–1148` |
| Installed raw store is 1024×1024 16-bit words, 2 MiB; row coordinate units are words/rows, not CPU byte addresses. | `machine/ts/spec/gx/vram.ts:1–5`; `machine/ts/spec/bmsx/model.ts:54–55` | `machine/cpp/spec/gx/vram.h:9–14`; `machine/cpp/spec/bmsx/model.h:59–60` |

Shared firmware/toolchain facts below have **one source**, not separate TS/C++ hardware owners:
- No cartridge-entry power-on-pattern guarantee: BIOS `machine/bios/main.lua:126–136` programs GPU/display, uploads the system texture and initializes/flushes terminal output; `:105–113` later executes cartridge startup.
- Named imported BIOS function: `require('gpu/system_vram_region')`; empty-argument returned function. Export declaration `toolchain/ts/rompack/system.ts:9–21`; shared producer `machine/bios/gpu/system_vram_region.lua:1–28`; real shared consumer `cartlib/gx/vram.lua:99–107`.
- Query reads actual authored upload origin/size header plus full terminal layout and returns their bounding rectangle; first packed word low/high halves are x/y, second low/high halves are width/height. Shared producer `machine/bios/gpu/system_vram_region.lua:10–28`.
- x/width are 16-bit VRAM-word counts; y/height are row counts, as seen in terminal geometry `machine/bios/tty/layout.lua:3–11,18–25` and raw texture upload header consumed by the query. No numeric function address, asset-id substitution, upload/wait/allocation/protection operation is performed by this query.
- BIOS monitor reuses terminal coordinates and reuploads system atlas: `machine/bios/shell/monitor.lua:455–472`. Cart handoff is not release of that footprint.
- Public existing ownership/query destination is `docs/book1/memory.md:59–98`; Console cross-link already exists at `docs/book1/console.md:131`. GPU currently lacks its own onramp link. No new whole-manual reservation contract is needed.
