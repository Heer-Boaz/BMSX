# Console overview: verified video/audio fact candidates

Scope: read-only live-owner extraction on master, 2026-10-18. Root AGENTS.md and git status read. Initial/final worktree: modified `.vscode/launch.json`, `.vscode/tasks.json`; untracked `docs/examples/`; none changed by this extraction. Existing `docs/book1/facts/{gpu,pcrtc,gte,geo,apu}.md` used only to locate owners. No architecture.md, reference PDF, build, runtime test, implementation, or repository edit. All factual anchors below were opened live. No disagreement found within these bounded facts; this is not full hardware/backend parity certification. Arithmetic byte/unit conversions below are identified as such.

## GPU local storage and raster capability

### VA01 — Installed GPU memory, not an advertised screen size
- Fact: installed model has `0x00200000` bytes GPU local memory = 2 MiB = 1,048,576 sixteen-bit words (arithmetic). Logical raw-coordinate periods are 1024 X words and 1024 Y rows. These are storage/address periods, **not** a 1024x1024 display mode.
- Paired specs: `machine/ts/spec/bmsx/model.ts:46-56`; `machine/cpp/spec/bmsx/model.h:51-61`; `machine/ts/spec/gx/vram.ts:1-5`; `machine/cpp/spec/gx/vram.h:9-14`.
- Direct paired owners: `machine/ts/render/backend/software/gx_gpu_state.ts:104-108`; `machine/cpp/render/backend/software/gx_gpu_state.h:90-99` allocate byteCount/2 u16 words; `machine/ts/render/backend/software/gx_gpu_vram.ts:11-13`; `machine/cpp/render/backend/software/gx_gpu_vram.h:16-24` use X row masking and the installed word mask.
- Model injection: `machine/ts/machine/machine.ts:68-75`; `machine/cpp/machine/machine.cpp:20-24`; the GPU retains the exact size in `machine/ts/machine/devices/gx/gpu.ts:435-445` / `machine/cpp/machine/devices/gx/gpu.cpp:35-44`.

### VA02 — Raster output, texture/CLUT data and display sampling share GPU local memory
- Fact: primitive rendering, texture/palette sampling and PCRTC scanout address the same raw GPU VRAM store; do not draw a separate texture RAM or separate private PCRTC framebuffer memory in the overview.
- Direct paired owners: render destination `machine/ts/render/backend/software/gx_gpu_vram.ts:115-140`; `machine/cpp/render/backend/software/gx_gpu_vram.h:162-197`; texture and CLUT reads `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:113-139`; `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:64-90`; PCRTC raw-word reads `machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts:34-35,46-95`; `machine/cpp/render/backend/software/gx_gpu_scanout.cpp:35-38,47-89`.
- Representation distinction: Drawing X uses raw linear 16-bit storage words; indexed texture U selects packed texels (4-bit: U>>2 word plus U&3 nibble; 8-bit: U>>1 word plus U&1 byte), while PCRTC selects its own storage interpretation (VA06). Shared bytes do not imply shared coordinate mapping.

### VA03 — GPU primitive families
- Fact: command-driven rasterization supports polygons (triangles, with quads split into two triangles), lines/polylines, rectangles, fills and VRAM image transfers. Polygons may be textured and flat- or Gouraud-colored; rectangles may be textured. This is a finite command/raster capability list, not a polygons-per-second rating.
- Paired specs: `machine/ts/spec/gx/gp0.ts:10-25`; `machine/cpp/spec/gx/gp0.h:17-32` define families/options.
- Direct paired owners: `machine/ts/render/backend/software/gx_gpu_commands.ts:140-210,212-274,276-303`; `machine/cpp/render/backend/software/gx_gpu_commands.cpp:139-212,214-285,289-319`.
- Optional texture summary: 4-bit indexed, 8-bit indexed and direct16 modes, sourced by `machine/ts/spec/gx/gp0.ts:50-52` / `machine/cpp/spec/gx/gp0.h:52-54` and the texture/CLUT reads in VA02. Do not turn texture bits per texel into framebuffer color depth or installed-memory size.

## PCRTC output domain

### VA04 — Two programmable scanout circuits
- Fact: PCRTC has two scanout circuits, each programmed with framebuffer base/width/storage/origin and a signal-space display window/magnification; output may compose the circuits with background/blending. They are two readers/compositors of shared local memory, not two added RAM banks.
- Paired spec: `machine/ts/spec/gx/pcrtc.ts:12-23,39-47`; `machine/cpp/spec/gx/pcrtc.h:13-24,40-48` identify circuit1/circuit2 and composition controls.
- Direct paired owners: two retained circuits `machine/ts/machine/devices/gx/gpu_pcrtc.ts:302-305` / `machine/cpp/machine/devices/gx/gpu_pcrtc.h:126-132`; source/display decode `machine/ts/machine/devices/gx/gpu_pcrtc.ts:361-390` / `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:120-150`; background/composition dispatch `machine/ts/render/backend/software/gx_gpu_scanout.ts:27-44` / `machine/cpp/render/backend/software/gx_gpu_scanout.cpp:305-339`.

### VA05 — Programmed beam timing and programmed output extent, not one fixed resolution/rate
- Fact: beam timing is decoded from SMODE/SYNCH/SYNCV words. The timing datapath uses a 13,500,000 reference-clock constant and derives half-line/field periods and refresh from those words. Display extent comes from enabled display windows and signal step. An overview must not substitute model PAL/NTSC convenience constants, reset words or host canvas size for a universal fixed screen resolution/refresh.
- Paired spec: programmable timing words `machine/ts/spec/gx/pcrtc.ts:24-33,48-51`; `machine/cpp/spec/gx/pcrtc.h:25-34,49-52`.
- Direct paired owners: clock `machine/ts/machine/devices/gx/gpu_pcrtc.ts:96` / `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:8`; timing decode/derived refresh `machine/ts/machine/devices/gx/gpu_pcrtc.ts:247-298` / `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:66-117`; display-window/output extents `machine/ts/machine/devices/gx/gpu_pcrtc.ts:426-469` / `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:184-223`.
- Lifetime/domain distinction: scanout consumes retained presentation words/timing, not blindly every later live word. Presentation latch copies words then republishes decoded scanout: `machine/ts/machine/devices/gx/gpu_pcrtc.ts:723-731,825-827`; `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:446-454,548-550`.

### VA06 — Scanout storage interpretations are not new memory capacities
- Fact: current PCRTC sampling paths include CT32, CT24, CT16, CT16S and GX16; GPU24 is available on circuit1 only. They reinterpret shared local-memory addresses. Do not label the GPU primitive rasterizer itself a native CT32/CT16 writer merely because PCRTC can scan those layouts.
- Paired definitions: `machine/ts/machine/devices/gx/gpu_local_memory.ts:3-8`; `machine/cpp/machine/devices/gx/gpu_local_memory.h:7-12`.
- Direct paired selection: `machine/ts/machine/devices/gx/gpu_pcrtc.ts:163-173`; `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:26-35`; paired sampling in VA02.

## GTE versus GEO ownership/data routes

### VA07 — GTE is register-fed transform/lighting arithmetic
- Fact: GTE stores32 data words,32 control words and10 PLUS words, all raw u32. CPU programs mapped operand/control registers and a command, then reads register results. Ordinary COMMAND directly calls the arithmetic execute path. This is not an addressed batch that fetches vertex arrays or emits GPU packets automatically.
- Paired specs: `machine/ts/spec/bmsx/io.ts:117-128`; `machine/cpp/spec/bmsx/io.h:130-141`.
- Direct paired owners: raw arrays `machine/ts/machine/devices/gx/gte.ts:18-20,182-185`; `machine/cpp/machine/devices/gx/gte.h:14-16,143-145`; mapped programming/readback `machine/ts/machine/devices/gx/gte.ts:205-222,344-355`; `machine/cpp/machine/devices/gx/gte.cpp:68-85,206-222`.
- Finite capability examples: matrix/vector arithmetic, rotation/translation with perspective projection and lighting/color arithmetic. Direct paired algorithms: `machine/ts/machine/devices/gx/gte.ts:839-849,913-937,975-995`; `machine/cpp/machine/devices/gx/gte.cpp:702-712,777-812,849-869`. Results stay in the GTE registerfile in these algorithms.
- Wording constraint: "CPU-fed" describes the CPU programming route, **not** a claim that every ordinary GTE register rejects DMA bus accesses. Ordinary register/command thunks do not discriminate bus master. PLUS COMMAND specifically rejects DMA readiness: `machine/ts/machine/devices/gx/gte.ts:372-379`; `machine/cpp/machine/devices/gx/gte.cpp:240-243`.

### VA08 — GEO is a separate memory-addressed, single-job batch engine
- Fact: GEO captures source/destination addresses, count, parameters and strides into one active job. On service it dispatches XFORM2_BATCH, SAT2_BATCH or OVERLAP2D_PASS and processes records through the memory owner. It is not the GTE registerfile or an automatic rendering stage.
- Paired command definitions: `machine/ts/machine/devices/geometry/contracts.ts:21-23`; `machine/cpp/machine/devices/geometry/contracts.h:29-31`.
- Direct paired job capture/activation: `machine/ts/machine/devices/geometry/controller.ts:330-372`; `machine/cpp/machine/devices/geometry/controller.cpp:225-265`; one optional active job `machine/ts/machine/devices/geometry/controller.ts:83-93` / `machine/cpp/machine/devices/geometry/controller.h:62-75`; busy doorbell does not queue `machine/ts/machine/devices/geometry/controller.ts:316-328` / `machine/cpp/machine/devices/geometry/controller.cpp:168-177`.
- Actual payload/output route, not just register naming: XFORM2 reads record/vertex/matrix source memory and writes transformed vertices to RAM: `machine/ts/machine/devices/geometry/xform2.ts:42-108`; `machine/cpp/machine/devices/geometry/xform2.cpp:18-83`. Command service selection: `machine/ts/machine/devices/geometry/controller.ts:190-225`; `machine/cpp/machine/devices/geometry/controller.cpp:179-212`.

### VA09 — Optional GEO rate number is a work budget, not an independent MHz/core rating
- Fact: installed model sets16,384,000 GEO work units per second. Controller accrues this budget from system cycles and consumes one unit per outer record service. Do not relabel it "16.384 MHz", vertices/s, triangles/s, collision pairs/s or end-to-end memory bandwidth.
- Paired spec: `machine/ts/spec/bmsx/model.ts:17,46-56`; `machine/cpp/spec/bmsx/model.h:22,51-61`.
- Direct paired owners: timing injection `machine/ts/machine/machine.ts:122-126` / `machine/cpp/machine/machine.cpp:65-69`; budget and record loop `machine/ts/machine/devices/geometry/controller.ts:152-167,190-234,375-395`; `machine/cpp/machine/devices/geometry/controller.cpp:87-105,179-222,286-305`.

## APU resources, memory domains and output cadence

### VA10 — Sixteen playback slots, separate command/transfer buffers
- Fact: APU has16 playback slots, each with21 raw parameter words. Separate command FIFO holds16 captured command entries. Separate sample-transfer FIFO holds16 **32-bit words =64 bytes** (arithmetic), not16 samples or sixteen-bit words.
- Paired spec: `machine/ts/spec/audio/apu.ts:5,9,25-29,51-52`; `machine/cpp/spec/audio/apu.h:13,23,32-36,58-59`.
- Direct paired owners: slot arrays `machine/ts/machine/devices/audio/slot_bank.ts:16-19,45-50` / `machine/cpp/machine/devices/audio/slot_bank.h:27-30`; command FIFO arrays `machine/ts/machine/devices/audio/command_fifo.ts:17-22` / `machine/cpp/machine/devices/audio/command_fifo.h:32-37`; transfer FIFO `machine/ts/machine/devices/audio/sample_transfer.ts:32-36` / `machine/cpp/machine/devices/audio/sample_transfer.h:49-56`.

### VA11 — APU owns512 KiB private sample RAM
- Fact: private APU sample RAM capacity is524,288 bytes =512 KiB, with sample-source descriptor base `0x40000000`. It is not another512 KiB of ordinary CPU RAM and is not part of GPU VRAM.
- Paired spec: `machine/ts/spec/audio/apu.ts:6-8`; `machine/cpp/spec/audio/apu.h:10-12`.
- Direct paired storage/binding: `machine/ts/machine/devices/audio/sample_memory.ts:10-38`; `machine/cpp/machine/devices/audio/sample_memory.h:25-27`, `machine/cpp/machine/devices/audio/sample_memory.cpp:17-30`.
- No normal CPU load/store aperture at that source base: CPU mapped paths have system ROM/RAM/cartridge paths and no APU RAM path, with cartridge bus ending `0x31000000`: `machine/ts/spec/bmsx/memory_map.ts:3-21` / `machine/cpp/spec/bmsx/memory_map.h:9-27`; `machine/ts/machine/memory/memory.ts:549-570,627-656`; `machine/cpp/machine/memory/memory.cpp:439-460,522-550`.

### VA12 — Live source-buffer playback binds private sample RAM or ROM, not main RAM
- Fact: non-generator PLAY binds a whole source region either to private sample RAM or to a ROM view (system ROM or selected cartridge ROM). **Ordinary main RAM is not a direct voice source.** PLAY resolves the selected cartridge slot at execution; output retains a view/pointer into that selected storage rather than copying the audio payload into a voice.
- Direct paired source binding: `machine/ts/machine/devices/audio/command_executor.ts:146-158,228-236`; `machine/cpp/machine/devices/audio/command_executor.cpp:107-119,187-193`; RAM-or-ROM selection `machine/ts/machine/devices/audio/sample_memory.ts:20-38`; `machine/cpp/machine/devices/audio/sample_memory.cpp:17-30`; ROM-only memory binding `machine/ts/machine/memory/memory.ts:708-718`; `machine/cpp/machine/memory/memory.cpp:623-633`.
- Direct paired retained source/readout: `machine/ts/machine/devices/audio/output.ts:460-470,532-546`; `machine/cpp/machine/devices/audio/output.cpp:383-398,470-493`.
- Diagram consequence: main RAM can feed a programmed system-DMA transfer **to APU DATA/FIFO then private sample RAM**, not an invented live main-RAM-to-voice arrow. Actual DMA read/write pair: `machine/ts/machine/devices/dma/controller.ts:214-235`; `machine/cpp/machine/devices/dma/controller.cpp:145-165`; mapped RAM read path `machine/ts/machine/memory/memory.ts:540-570` / `machine/cpp/machine/memory/memory.cpp:430-460`; APU DMA dispatch `machine/ts/machine/devices/audio/service_clock.ts:152-170` / `machine/cpp/machine/devices/audio/service_clock.cpp:45-74`; FIFO admission/RAM commit in VA14.

### VA13 — Output cadence is44,100 stereo frames/s with signed16-bit left/right output
- Fact: APU output is44,100 stereo frames/s; each frame emits left and right signed16-bit samples after mix saturation. Source sample rates/rate steps are distinct programming parameters, not a different output clock.
- Paired spec: `machine/ts/spec/audio/apu.ts:1-4`; `machine/cpp/spec/audio/apu.h:9,20-22`.
- Direct paired cadence: `machine/ts/machine/devices/audio/service_clock.ts:207-221`; `machine/cpp/machine/devices/audio/service_clock.cpp:202-216` accrue sample frames from system cycles. Direct paired stereo/saturation: `machine/ts/machine/devices/audio/output.ts:319-325,390-392,440-448`; `machine/cpp/machine/devices/audio/output.cpp:230-236,309-311,363-371`.
- Output rate is not an independent APU CPU/core frequency or an electrical DAC pin rating. Source words are loaded separately at `machine/ts/machine/devices/audio/source.ts:28-40` / `machine/cpp/machine/devices/audio/source.cpp:5-17`.

### VA14 — Sample-memory DMA service pace is1,058,40032-bit words/s, not full bus throughput
- Fact: APU's sample-memory DMA service budget is44,100*24 =1,058,400 **32-bit words/s**; FIFO capacity16 words is64 bytes. A scheduled batch becomes effective at its completion edge; words are not separately committed at each word-period. Upload goes DMA DATA→FIFO→private sample RAM; download reverses it.
- Paired spec: `machine/ts/spec/audio/apu.ts:1,9-10`; `machine/cpp/spec/audio/apu.h:9,13-14`.
- Direct paired width: FIFO storage in VA10; sample-memory uses LE32 read/write `machine/ts/machine/devices/audio/sample_memory.ts:41-46` / `machine/cpp/machine/devices/audio/sample_memory.cpp:33-38`; completed words each advance by4 bytes `machine/ts/machine/devices/audio/sample_transfer.ts:201-213` / `machine/cpp/machine/devices/audio/sample_transfer.cpp:195-207`; C++ IO_WORD_SIZE=4 at `machine/cpp/spec/bmsx/memory_map.h:29`.
- Direct paired ingress/deadline/commit: `machine/ts/machine/devices/audio/sample_transfer.ts:159-180,201-236`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:122-151,195-235`; system-cycle budget helper `machine/ts/machine/scheduler/budget.ts:12-18` / `machine/cpp/machine/scheduler/budget.h:18-20`.
- Boundary: this is FIFO↔sample-memory pacing, **not** complete DMA source-bus cost, CPU call latency, electrical sustained bandwidth or a universal limit on CPU manual writes. In MANUAL_WRITE mode CPU DATA writes immediately store one32-bit word and advance4 bytes: `machine/ts/machine/devices/audio/sample_transfer.ts:151-156`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:134-139`.

### VA15 — Optional compact playback capability list
- Fact: playback datapath includesPCM8,PCM16 and4-bit BADP decoding plus the defined square generator; it supports per-slot source rate/loop/gain and an optional stereo biquad stage. These are capabilities, not a promise to validate arbitrary malformed metadata or every bit-depth word.
- Direct paired decoder/generator branches: `machine/ts/machine/devices/audio/output.ts:355-388,460-485,532-546`; `machine/cpp/machine/devices/audio/output.cpp:270-307,383-408,470-493`.
- Paired named square/rate/gain/filter spec: `machine/ts/spec/audio/apu.ts:2-4,27-28,79-81`; `machine/cpp/spec/audio/apu.h:20-22,34-35,86-88`.
- Do not call the whole unit "16 PCM channels" without acknowledging compressed sources/generator and stereo-source mixing; "16 playback slots/voices" preserves the finite resource boundary.

## Gaps and stop conditions

- No spec/direct-owner or TS/C++ disagreement was found for the facts above. The early progress-message phrase "16-bit transfer words" was an extraction mistake, corrected by direct VA10/VA14 owners; it was not a source mismatch and must not enter the overview.
- No fixed universal resolution or refresh is established: programmed beam timing/display windows own it (VA05). Reset/example modes are not hardware capacity claims.
- No independent GTE/GEO/APU core MHz, die/pin bus clock, analog DAC characteristics, pixels/s, triangles/s, per-format voice bandwidth or electrical sustained transfer rating is established here. Model work/service constants retain their original units (VA09/VA13/VA14).
- No detailed register catalogue, per-decoder malformed-state audit, GPU packet-length re-extraction, every accelerated graphics backend, physical audio output or live runtime parity is claimed. These source facts establish finite installed resources and ownership/data routes only.
- Diagram/lifetime requirements supported here: GTE operands/results remain register-owned; GEO fetches current addressed memory for its retained job; GPU raster/texture/PCRTC share local-memory bytes; PCRTC consumes retained presentation configuration; APU source views remain bound storage, separate from DMA transfer completion.
