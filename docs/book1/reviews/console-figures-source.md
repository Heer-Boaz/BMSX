# Console overview figures — independent semantic source audit

## Verdict and frozen scope

**PASS for the two inspected SVGs: no unsupported or source-mismatched title, description, visible label or selected-route arrow found.** This is a bounded semantic source review, not a PDF/layout review, an electrical bus diagram certification, a full device-register audit, an execution test, or acceptance of the complete console manual. No source discrepancy affecting a drawn fact was found in the paired declarations and datapaths inspected below.

Frozen input hashes (SHA-256):

- `docs/book1/figures/console-video.svg`: `192bc68c23668856a4e1bb82bc4fac6bc15e2704568e4f2e47a8bf3325034b87`
- `docs/book1/figures/console-audio.svg`: `140b8c7e9b7ff146198d5f7b56446ed8139c445f0b53e2c37df28379d47c1a14`

Read the actual paired current specs and owners, not merely the existing fact sheets. The existing APU and PCRTC sheets were source indexes only. No architecture document, historical PDF, builds, running cartridge, or rendered output was opened. No repository files were changed. Figures explicitly select useful routes; omitted wiring, units, arbitration, storage formats, readback paths and publication/service edges are not assertions of absence.

## Video figure

### RAM / ROM source data → CPU / DMA word supply → GPU GP0 port

The labels and first two arrows match a selected software-supplied upload/drawing route. Main RAM and ROM have mapped word-read routes; DMA services read a word and issue that same word to a mapped destination. GP0 is mapped for writes, and its owner distinguishes CPU ingress from DMA ingress. The drawing does not assert that every GP0 word changes a pixel, that RAM/ROM alone can supply words, or that port submission is immediately visible scanout.

Actual source ranges:

- Mapped RAM/ROM reads: `machine/ts/machine/memory/memory.ts:544–570`; `machine/cpp/machine/memory/memory.cpp:434–460`.
- CPU and DMA mapped word writes into I/O: `machine/ts/machine/memory/memory.ts:620–642`; `machine/cpp/machine/memory/memory.cpp:515–536`.
- DMA word transport: `machine/ts/machine/devices/dma/controller.ts:220–235`; `machine/cpp/machine/devices/dma/controller.cpp:150–165`.
- GP0 mapping: `machine/ts/machine/devices/gx/gpu.ts:462–464`; `machine/cpp/machine/devices/gx/gpu.cpp:53–55`.
- GP0 CPU/DMA admission: `machine/ts/machine/devices/gx/gpu.ts:1034–1052`; `machine/cpp/machine/devices/gx/gpu.cpp:551–569`.

### GPU → writes → GPU local memory, 2 MiB

The installed model allocates `0x00200000` bytes for GPU local storage and passes it to the GPU. The address leaf defines 1,024 × 1,024 local words at two bytes per word, consistent with 2 MiB; neither is drawn as a display resolution. The selected GP0 image-load route emits an upload command whose execution writes that shared local store. The fill command also writes it. “Writes” is the direction of the selected path, not a claim that GPU local-memory access is write-only.

Actual source ranges:

- Installed capacity: `machine/ts/spec/bmsx/model.ts:46–56`; `machine/cpp/spec/bmsx/model.h:51–61`.
- Model → GPU construction: `machine/ts/machine/machine.ts:68–75`; `machine/cpp/machine/machine.cpp:19–23`.
- Local address shape: `machine/ts/spec/gx/vram.ts:1–5`; `machine/cpp/spec/gx/vram.h:9–14`.
- Local-store allocation: `machine/ts/machine/devices/gx/gpu.ts:435–458`; `machine/cpp/machine/devices/gx/gpu.cpp:31–51`; software word store `machine/ts/render/backend/software/gx_gpu_state.ts:85–108`; `machine/cpp/render/backend/software/gx_gpu_state.h:90–99`.
- GP0 image-load completion: `machine/ts/machine/devices/gx/gpu.ts:1652–1660`; `machine/cpp/machine/devices/gx/gpu.cpp:1130–1137`.
- Upload execution: `machine/ts/render/backend/software/gx_gpu_commands.ts:75–99,297–299`; `machine/cpp/render/backend/software/gx_gpu_commands.cpp:40–75,314–316`.
- Fill writes: `machine/ts/render/backend/software/gx_gpu_commands.ts:53–71`; `machine/cpp/render/backend/software/gx_gpu_commands.cpp:11–36`.

### Shared local memory → read selected source windows → PCRTC two reading circuits and output composition → display output

There are exactly two circuit state records. Their source base, width and X/Y origin are independently decoded. Both circuits sample the same local-word storage used by command execution; they do not allocate separate framebuffers. Composition writes the second selected circuit then the first, with the configured background/operation paths. The arrow labelled “Pixels” and visible note that a second reading circuit is not a second memory are supported. Both circuits need not be enabled, and the figure does not imply they always fetch a source pixel or that there is a fixed output size/rate.

Actual source ranges:

- Two circuit records: `machine/ts/machine/devices/gx/gpu_pcrtc.ts:302–303`; `machine/cpp/machine/devices/gx/gpu_pcrtc.h:126–127`.
- Separate selected source windows: `machine/ts/machine/devices/gx/gpu_pcrtc.ts:361–389`; `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:120–150`.
- Per-circuit composition paths: `machine/ts/machine/devices/gx/gpu_pcrtc.ts:479–533`; `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:233–287`.
- Same storage handed to command execution and scanout: `machine/ts/render/backend/software/gx_gpu.ts:49–56`; `machine/cpp/render/backend/software/gx_gpu.cpp:70–87`.
- Sample reads from that store: `machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts:34–55`; `machine/cpp/render/backend/software/gx_gpu_scanout.cpp:35–91`.
- Final circuit composition: `machine/ts/render/backend/software/gx_gpu_scanout.ts:13–44`; `machine/cpp/render/backend/software/gx_gpu_scanout.cpp:305–340`.

## Audio figure

### ROM source / private sample RAM → live sample reads → APU: 16 slots, playback / square generation

The APU has 16 voice slots. A sampled source is bound either to private sample RAM or to a ROM byte view, not ordinary main RAM. Playback retains the bound byte storage and reads sample data from it; it is not a capture/copy of the complete payload at PLAY. The square generator branch produces samples without reading a sample payload. Thus the two source arrows and absence of a direct main-RAM playback arrow are supported. “Bound while playing” denotes the retained ROM source binding, not a fresh cartridge-selection lookup on each sample.

Actual source ranges:

- Slot count and square-generator constant: `machine/ts/spec/audio/apu.ts:25–28`; `machine/cpp/spec/audio/apu.h:32–35`.
- Voice slot allocation: `machine/ts/machine/devices/audio/output.ts:81–115`; `machine/cpp/machine/devices/audio/output.h:111–113`.
- Source binding and generator bypass: `machine/ts/machine/devices/audio/command_executor.ts:152–158,228–236`; `machine/cpp/machine/devices/audio/command_executor.cpp:113–119,187–193`.
- Private-RAM or ROM-only bindings: `machine/ts/machine/devices/audio/sample_memory.ts:20–38`; `machine/cpp/machine/devices/audio/sample_memory.cpp:17–30`.
- ROM view has no main-RAM branch: `machine/ts/machine/memory/memory.ts:708–718`; `machine/cpp/machine/memory/memory.cpp:623–633`.
- Retained source storage, not full-payload capture: `machine/ts/machine/devices/audio/output.ts:452–470`; `machine/cpp/machine/devices/audio/output.cpp:375–398`.
- Live PCM reads: `machine/ts/machine/devices/audio/output.ts:532–546`; `machine/cpp/machine/devices/audio/output.cpp:488–493`.
- Square generation / sampled-playback branches: `machine/ts/machine/devices/audio/output.ts:355–380`; `machine/cpp/machine/devices/audio/output.cpp:273–290`.

### APU → left / right output, 44,100 stereo frames/s, signed 16-bit components

The service clock accrues output frames at 44,100 Hz and advances the voice mixer. Every frame contributes two output components; final output is clamped to signed 16-bit and stored as signed 16-bit components. This is the APU output-frame contract, not an analog/pin rating, host delivery guarantee, source-file sample rate or a claim that suspended clocks keep producing samples.

Actual source ranges:

- Output-rate constant: `machine/ts/spec/audio/apu.ts:1`; `machine/cpp/spec/audio/apu.h:9`.
- Service accrual and voice advance: `machine/ts/machine/devices/audio/service_clock.ts:207–220`; `machine/cpp/machine/devices/audio/service_clock.cpp:204–215`.
- Voice advance → mixer: `machine/ts/machine/devices/audio/active_slots.ts:57–58`; `machine/cpp/machine/devices/audio/active_slots.cpp:50–51`.
- Two components per frame and signed-16 output: `machine/ts/machine/devices/audio/output.ts:319–320,440–448`; `machine/cpp/machine/devices/audio/output.cpp:230–231,363–371`.

### Main RAM / ROM upload source → CPU / DMA APU transfer port, 32-bit transport → private sample RAM, 512 KiB, not CPU-linear memory

This separate route is supported. CPU and DMA reach the transfer-data I/O word; CPU manual-write mode writes a word, and DMA write mode queues words then writes them into private RAM. Address increments and the sample-memory read/write primitive are four bytes. Capacity is 512 KiB; the backing store is owned by the APU, not the CPU memory map. Its source-address convention at `40000000h` is not a mapped main-RAM aperture. DMA upload completion is a transport event, not slot activation or a playback command.

Actual source ranges:

- RAM/ROM source reads and DMA transport: the paired memory and DMA ranges listed above under video word supply.
- Transfer-mode/capacity constants: `machine/ts/spec/audio/apu.ts:6–16`; `machine/cpp/spec/audio/apu.h:10–19`.
- Private storage allocation: `machine/ts/machine/devices/audio/sample_memory.ts:10–12`; `machine/cpp/machine/devices/audio/sample_memory.h:25–27`.
- Transfer-data I/O mapping: `machine/ts/machine/devices/audio/service_clock.ts:42–48`; `machine/cpp/machine/devices/audio/service_clock.cpp:31–36`.
- CPU/DMA dispatch for the transfer-data port: `machine/ts/machine/devices/audio/service_clock.ts:162–170`; `machine/cpp/machine/devices/audio/service_clock.cpp:64–73`.
- CPU manual word upload: `machine/ts/machine/devices/audio/sample_transfer.ts:151–155`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:134–138`.
- DMA upload admission and completion: `machine/ts/machine/devices/audio/sample_transfer.ts:171–177,201–213`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:142–149,195–207`.
- Private 32-bit read/write datapath: `machine/ts/machine/devices/audio/sample_memory.ts:41–46`; `machine/cpp/machine/devices/audio/sample_memory.cpp:33–38`.
- CPU map ends below the sample address convention: `machine/ts/spec/bmsx/memory_map.ts:6–23`; `machine/cpp/spec/bmsx/memory_map.h:12–29`, with mapped reads/writes terminating in the unmapped path in the paired memory ranges listed above.
- Shared private storage is separately supplied to transfer and playback: `machine/ts/machine/devices/audio/controller.ts:76–104`; `machine/cpp/machine/devices/audio/controller.cpp:31–54`. Transfer completion writes storage and updates DMA requests; PLAY uses the separate command-executor path listed above. This supports “Transfer completion and playback are distinct.”

## Remaining acceptance boundary

No semantic figure correction is requested for these hashes. Actual PDF layout, clipping, label collisions, arrow visibility, caption placement and readability still require visual inspection of the final rendered chapter. No whole-runtime parity, fixed-rate display mode, electrical timing, device-register completeness or whole-manual reader acceptance is inferred from this report.
