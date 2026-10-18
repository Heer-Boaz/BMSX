# System overview — final video/audio and editorial-delta source review

Result: **PASS after the two root corrections recorded below.** No concrete unsupported or mismatched sentence remains in the inspected scope. This is a bounded source audit, not whole-manual, runtime, accelerated-backend, electrical, or print acceptance.

- Checkout: `58bbf76d71bca37cff38e4c14690d61b37f9b654`, with the new public chapter still uncommitted.
- Final public chapter: `docs/book1/console.md`.
- Final chapter SHA-256: `70e80c237a661aeb0c6e8d18d28064cf9886881e43437a027b2447fa6039b984`.
- Inspected public scope: lines 115–184, “Graphics storage and drawing” through EOF; editorial opening lines 3–11; the cycle-accounting timebase wording at line 15; CPU-as-IRQ-consumer wording at line 27; SYSTEM's cycle-derived time wording at line 35; INPUT capture wording at line 37; and the two-DMA-channel/shared-admitted-block distinction at line 89.
- The firmware VRAM paragraph at line 131 corresponds substantively and literally to the independently audited paragraph recorded in `docs/book1/reviews/console-reservation-source.md`; its quotation omits only Markdown link markup and differs in typographic quotation style around the cross-reference. I did not redo that BIOS/terminal reservation audit.
- Figures were assigned separately. This audit checks their surrounding textual boundary statements, not SVG paths, arrows, layout, or PDF rendering.
- `docs/book1/facts/console-{video-audio,memory,control,firmware-vram}.md` were source indexes only. Actual paired leaves and owners were opened below. No architecture document, reference PDF, build, test, or runtime execution was used. No repository file was edited by this reviewer; only this `/tmp` report was written.

## Findings resolved during this audit — not current failures

### 1. Indexed texture coordinates were conflated with storage-word coordinates

Initial public sentence:

> Drawing and texture coordinates address raw sixteen-bit words; PCRTC has its own selectable storage interpretations.

Actual source lines:

- `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:130–132`: 4-bit sampling obtains the storage word at `pageX + integerDivide(windowedU, 4)` and selects `(textureWord >>> ((windowedU & 3) << 2)) & 0x0f`.
- Same file `:135–137`: 8-bit sampling obtains the storage word at `pageX + integerDivide(windowedU, 2)` and selects `(textureWord >>> ((windowedU & 1) << 3)) & 0xff`.
- `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:81–83`: the 4-bit branch uses `pageX + (windowedU / 4u)` and `(windowedU & 3u) << 2u`.
- Same file `:86–88`: the 8-bit branch uses `pageX + (windowedU / 2u)` and `(windowedU & 1u) << 3u`.
- Drawing storage-word addressing itself is direct at `machine/ts/render/backend/software/gx_gpu_vram.ts:11–13,115–126` and `machine/cpp/render/backend/software/gx_gpu_vram.h:16–24,162–197`.

The final literal at line 129 now distinguishes drawing storage words from packed indexed texels. Targeted recheck: **PASS**. The producer fact sheet VA02 was corrected by root too.

### 2. The biquad stage was described as enabled rather than optional

Initial public sentence:

> Slot controls include source rate, loop and gain parameters, with an enabled stereo biquad stage.

Actual source lines:

- `machine/ts/machine/devices/audio/output.ts:385–388`: `if (record.filter.enabled)` gates `processStereo` and use of filter output.
- `machine/cpp/machine/devices/audio/output.cpp:304–307`: the same enabled guard gates the stereo stage.
- `machine/ts/machine/devices/audio/biquad_filter.ts:32–34,47–53`: reset sets `enabled = false`; configuration sets it from `controlWord & APU_FILTER_CONTROL_ENABLE`.
- `machine/cpp/machine/devices/audio/biquad_filter.cpp:5–6,20–26`: the paired reset/configuration has the same behavior.

The final literal at line 163 says “with an optional stereo biquad stage.” Targeted recheck: **PASS**. The producer fact sheet VA15 was corrected by root too.

## Actual source ranges inspected

The following inventory records the bounded evidence read, not an additional public specification or a review of every method in each file.

### GPU shared storage and finite drawing capability

- `machine/ts/spec/bmsx/model.ts:1–56`; `machine/cpp/spec/bmsx/model.h:8–61`: installed resource/service constants and model fields.
- `machine/ts/machine/machine.ts:58–105,122–126`; `machine/cpp/machine/machine.cpp:14–48,65–69`: installed device wiring and timing injection.
- `machine/ts/spec/gx/vram.ts:1–13`; `machine/cpp/spec/gx/vram.h:9–23`.
- `machine/ts/spec/gx/gp0.ts:8–55`; `machine/cpp/spec/gx/gp0.h:15–58`.
- `machine/ts/machine/devices/gx/gpu.ts:435–449`; `machine/cpp/machine/devices/gx/gpu.cpp:32–47`.
- `machine/ts/render/backend/software/gx_gpu_state.ts:104–108`; `machine/cpp/render/backend/software/gx_gpu_state.h:90–99`.
- `machine/ts/render/backend/software/gx_gpu_vram.ts:1–18,115–140`; `machine/cpp/render/backend/software/gx_gpu_vram.h:16–28,162–197`.
- `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:113–139`; `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:64–90`.
- `machine/ts/render/backend/software/gx_gpu_commands.ts:140–303`; `machine/cpp/render/backend/software/gx_gpu_commands.cpp:139–232,235–285,289–319`.

### GTE/GEO ownership and the GEO work-budget units

- `machine/ts/machine/devices/gx/gte.ts:18–20,182–222,336–382,839–849,913–937,975–995`; `machine/cpp/machine/devices/gx/gte.h:14–16,143–145`; `machine/cpp/machine/devices/gx/gte.cpp:64–85,201–245,702–712,777–811,849–869`.
- `machine/ts/machine/devices/geometry/contracts.ts:21–23`; `machine/cpp/machine/devices/geometry/contracts.h:29–31`.
- `machine/ts/machine/devices/geometry/controller.ts:152–175,190–234,316–395`; `machine/cpp/machine/devices/geometry/controller.cpp:87–111,168–222,225–265,286–305`.
- `machine/ts/machine/devices/geometry/xform2.ts:42–108`; `machine/cpp/machine/devices/geometry/xform2.cpp:18–83`.
- `machine/ts/machine/scheduler/budget.ts:6–18`; `machine/cpp/machine/scheduler/budget.h:12–20`.

The explicitly requested 16,384,000 figure is the installed work-budget constant, propagated through TimingState and device timing. Accrual caps grants to remaining outer records; each dispatched outer-record service decrements one budget unit. The prose does not relabel that quantity MHz, vertices/s, pairs/s, or memory bandwidth.

### PCRTC storage interpretations, 13,500,000 Hz calculation reference and retained configuration

- `machine/ts/spec/gx/pcrtc.ts:9–51`; `machine/cpp/spec/gx/pcrtc.h:10–52`.
- `machine/ts/machine/devices/gx/gpu_local_memory.ts:3–8`; `machine/cpp/machine/devices/gx/gpu_local_memory.h:7–12`.
- `machine/ts/machine/devices/gx/gpu_pcrtc.ts:96,163–173,247–305,361–395,426–469,723–731,825–827`; `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:8,26–35,66–150,184–223,446–454,548–550`.
- `machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts:34–95`; `machine/ts/render/backend/software/gx_gpu_scanout.ts:27–44`; `machine/cpp/render/backend/software/gx_gpu_scanout.cpp:35–90,305–339`.

The explicitly requested 13,500,000 figure is present in both timing owners. Their half-line denominator multiplies this reference, then refresh uses the programmed half-line numerator and total half-line count. The chapter calls it a timing-calculation reference, not an independent CPU clock or fixed pixel/refresh specification.

### APU resources, bound storage, output and transfer edges

- `machine/ts/spec/audio/apu.ts:1–81`; `machine/cpp/spec/audio/apu.h:9–88`.
- `machine/ts/machine/devices/audio/slot_bank.ts:16–19,45–50`; `machine/cpp/machine/devices/audio/slot_bank.h:27–30`.
- `machine/ts/machine/devices/audio/command_fifo.ts:17–22,32–82`; `machine/cpp/machine/devices/audio/command_fifo.h:32–37`; `machine/cpp/machine/devices/audio/command_fifo.cpp:17–65`.
- `machine/ts/machine/devices/audio/sample_memory.ts:10–46`; `machine/cpp/machine/devices/audio/sample_memory.cpp:17–38`.
- `machine/ts/machine/devices/audio/command_executor.ts:146–158,228–236`; `machine/cpp/machine/devices/audio/command_executor.cpp:107–119,187–193`.
- `machine/ts/machine/devices/audio/source.ts:28–40`; `machine/cpp/machine/devices/audio/source.cpp:5–17`.
- `machine/ts/machine/devices/audio/output.ts:319–325,355–403,440–488,532–546`; `machine/cpp/machine/devices/audio/output.cpp:230–236,270–322,363–371,383–409,470–493`.
- `machine/ts/machine/devices/audio/biquad_filter.ts:18–64`; `machine/cpp/machine/devices/audio/biquad_filter.cpp:5–26`.
- `machine/ts/machine/devices/audio/sample_transfer.ts:32–42,135–180,201–236`; `machine/cpp/machine/devices/audio/sample_transfer.h:49–60`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:113–151,195–235`.
- `machine/ts/machine/devices/audio/service_clock.ts:152–170,199–221`; `machine/cpp/machine/devices/audio/service_clock.cpp:45–74,195–216`.
- `machine/ts/spec/bmsx/memory_map.ts:1–25`; `machine/cpp/spec/bmsx/memory_map.h:7–31`; `machine/ts/machine/memory/memory.ts:549–570,627–656,708–718`; `machine/cpp/machine/memory/memory.cpp:439–460,522–550,623–633`.
- Paired system-DMA word routing: `machine/ts/machine/devices/dma/controller.ts:211–253`; `machine/cpp/machine/devices/dma/controller.cpp:141–183`.

### Earlier editorial deltas only — not a repeat of the first-half audits

- Installed model product route: `hosts/browser/boot.ts:113–117`; `hosts/browser/player.ts:31–42`; `hosts/common/machine_runtime.ts:13–24`; `machine/ts/machine/runtime/runtime.ts:126–139`; `hosts/libretro/content.cpp:43–49`; `machine/cpp/machine/runtime/options.h:14–17`; `machine/cpp/machine/runtime/runtime.cpp:8–24`.
- Cycle-accounting consumers: `machine/ts/machine/runtime/timing/state.ts:23–32`; `machine/cpp/machine/runtime/timing/state.cpp:10–22`; `machine/ts/machine/runtime/timing/config.ts:3–7,18–25`; `machine/cpp/machine/runtime/timing/config.cpp:7–12,22–28`; `machine/ts/machine/devices/system/controller.ts:119–136`; `machine/cpp/machine/devices/system/controller.cpp:77–88`.
- CPU consumes the IRQ controller line: `machine/ts/machine/devices/irq/controller.ts:72–81`; `machine/cpp/machine/devices/irq/controller.h:19`; `machine/cpp/machine/devices/irq/controller.cpp:29–34`; `machine/ts/machine/cpu/cpu.ts:1680–1683,1718–1739`; `machine/cpp/machine/cpu/cpu.cpp:2242–2245,2280–2298`.
- INPUT capture and supervisor wire: `machine/ts/machine/devices/input/controller.ts:61–100`; `machine/cpp/machine/devices/input/controller.cpp:31–69`; VBlank connection `machine/ts/machine/runtime/vblank.ts:44–61`; `machine/cpp/machine/runtime/vblank.cpp:31–45`. The public paragraph no longer asserts a guest-visible recorded-cycle value.
- DMA outstanding channel transfers versus one admitted block: `machine/ts/machine/devices/dma/controller.ts:131–144,211–253,386–408`; `machine/cpp/machine/devices/dma/controller.cpp:62–73,141–183,310–332`. START checks its own channel's busy state; arbitration returns while any block is admitted.

No further sentence failure was found in these deltas. Existing broader first-half, CPU7, Table, and BZ01 questions are neither re-audited nor closed by this report.
