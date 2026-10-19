# INPUT cross-boundary access and sample timing facts

2026-10-17, HEAD aaf6236a1. Internal author input, not prose. Narrow paired Memory/runtime/IRQ/CPU owners plus the shared BIOS/vector producer; no architecture or reference PDF. Root extraction; independent source review still required.

- **IT01 — Access classification.** Every snapshot word in [IO_INP_KEYS,IO_INP_OUTPUT_PORT), IO_INP_STATUS and IO_INP_OUTPUT_STATUS is read-only to mapped whole-word writes. Such writes raise BUS_FAULT_READ_ONLY=3 and do not update the I/O slot/callback. Paired owners `machine/ts/machine/memory/memory.ts:627-642,852-855,873-874` / `machine/cpp/machine/memory/memory.cpp:522-535,729-732,750-751`; fault code `machine/ts/spec/bmsx/io.ts:402` / `machine/cpp/spec/bmsx/io.h:415`. Aligned whole-word access is the normal interface; Memory's existing owning reference supplies subword/unaligned faults, not an invented INPUT fault bank.
- **IT02 — Readback/write visibility.** Memory writes its retained slot before invoking an installed write callback; a read without a mapped read callback returns that retained slot. Input constructor maps write callbacks, not read callbacks. Thus ordinary INPUT reads do not fetch a new input sample or acknowledge the sampled snapshot. CTRL persists as its last retained word unless the Input owner resets/mirrors it; OUTPUT_CTRL callback forces its readback to zero, see output sheet. Sources `machine/ts/machine/memory/memory.ts:366-376` / `machine/cpp/machine/memory/memory.cpp:245-259`; constructors `machine/ts/machine/devices/input/controller.ts:37-48` / `machine/cpp/machine/devices/input/controller.cpp:8-18`.
- **IT03 — Sourced timing edge and IRQ order.** Runtime responds to GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN by entering VBlank. On that edge it first calls display presentation, then Input onVblankEdge at current scheduler cycles, then raises IRQ_VBLANK. VBLANK_END does not invoke this sample path. Therefore when an armed sample publishes on that edge, its retained data/STATUS publication precedes this edge's central VBlank raise. This is ordering, not a fixed raise-to-handler latency. Sources `machine/ts/machine/runtime/vblank.ts:44-64` / `machine/cpp/machine/runtime/vblank.cpp:31-47`; input publication `machine/ts/machine/devices/input/controller.ts:78-106` / `machine/cpp/machine/devices/input/controller.cpp:48-74`. Central named source IRQ_VBLANK=4 at `machine/ts/spec/bmsx/io.ts:364` / `machine/cpp/spec/bmsx/io.h:377`. No separate input-complete source is raised by the inspected INPUT callback.
- **IT04 — No fabricated input timing number.** The Input callback itself has no separate scheduled sample clock, FIFO transfer charge or configured independent oscillator. It is invoked at IT03's PCRTC edge and copies the raw snapshot synchronously in that callback. This does not establish electrical polling/bandwidth, physical key-to-edge latency or a fixed handler delay. Sources exactly IT03 controller/runtime paths. PCRTC chapter owns the edge's programmed timing; IRQ chapter owns CPU delivery.
- **IT05 — Central IRQ setup for isolated complete example.** IRQ_FLAGS08000000H, ACK08000004H and MASK08000008H; VBlank mask00000004H. ACK written one clears that pending bit; MASK replaces the entire word and does not clear pending. FLAGS raise is OR/coalescing, not sample count. Sources paired constants `machine/ts/spec/bmsx/io.ts:213-216,364` / `machine/cpp/spec/bmsx/io.h:226-229,377`; paired IRQ controllers `machine/ts/machine/devices/irq/controller.ts:72-81,107-126` / `machine/cpp/machine/devices/irq/controller.cpp:76-93,29-34`.
- **IT06 — Real cartridge handler route.** Shared source compiler's generated IRQ entry reads current complete FLAGS, calls global irq(flags) when nonzero and executes RFE. The argument is not filtered by MASK. A cartridge author may define function irq(flags); that ordinary source handler acknowledges only its owned bits in this example. Producer `toolchain/ts/lua/compiler.ts:1633-1649`. BIOS before ordinary cart EXEC sets central MASK0 (`machine/bios/main.lua:105-113`). CPU cart function entry sets cart-entry STATUS including IEc1 (`machine/ts/machine/cpu/cpu.ts:1523-1546` / `machine/cpp/machine/cpu/cpu.cpp:1095-1118`; paired cart status `machine/ts/spec/blua32/cop0.ts:8-14` / `machine/cpp/spec/blua32/cop0.h:14-20`). This does not grant user access to CP0 writes; no such write is required by the example. Arbitrary resumed/supervisor entry is not this assumption.
- **IT07 — Wait condition is sample sequence, not a VBlank interrupt count.** Maskable acceptance needs current IEc and pending&mask. HALT permits time/device deadlines to proceed, but a merely masked pending bit does not guarantee wake. Thus ARM, then compare STATUS to its pre-ARM value in a loop; use HALT only after enabling an owned VBlank IRQ route, and recheck STATUS after wake. This sequence is a programming derivation of the explicit one-shot sample/sequence facts plus IRQ acceptance/HALT. Sources `machine/ts/machine/cpu/cpu.ts:1611-1619,1680-1683,1718-1728`; `machine/cpp/machine/cpu/cpu.cpp:1643-1651,2242-2245,2280-2287`; time paths `machine/ts/machine/runtime/cpu_executor.ts:39-88` / `machine/cpp/machine/runtime/cpu_executor.cpp:12-61`. Reading a retained nonzero CTRL is not reading the private arm latch, per register sheet.

## BIOS and supervisor ownership — 2026-10-19

- **IT08 — Ordinary BIOS handoff is not an INPUT reset.** Boot arms INPUT before
  its VBlank loop and again after each boot-screen update. The handoff masks IRQ
  delivery and executes the selected startup record; it does not reset INPUT.
  Table reset words therefore do not describe a guaranteed cartridge-entry
  snapshot or initial sequence. Sources `machine/bios/main.lua:105–113,136–142`;
  CPU entry `machine/ts/machine/cpu/cpu.ts:1523–1546` /
  `machine/cpp/machine/cpu/cpu.cpp:1095–1118`. IT07's current-STATUS baseline
  remains the fresh-sample protocol; no particular inherited sequence is promised.
- **IT09 — Shared, unbanked INPUT during supervisor service.** There is one
  INPUT register file, pending ARM and sequence. SYSTEM activation banks IRQ,
  DMA and GPU, not INPUT; leave restores those banks and releases the other
  held units without an INPUT capture/restore. Sources INPUT
  `machine/ts/machine/devices/input/controller.ts:29–35,78–106` /
  `machine/cpp/machine/devices/input/controller.h:18–30` and
  `machine/cpp/machine/devices/input/controller.cpp:48–74`; SYSTEM
  `machine/ts/machine/devices/system/controller.ts:181–240` /
  `machine/cpp/machine/devices/system/controller.cpp:133–192`.
  The monitor explicitly arms before its first input sample and in its loop;
  its exit issues SYSTEM LEAVE without restoring INPUT. Sources
  `machine/bios/shell/monitor.lua:406–413,447–455,494–499`.
  Accepted monitor samples therefore replace the same snapshot and increment
  the same sequence; LEAVE does not reinstate the cartridge's prior sample or
  sequence. Neither transition itself is claimed to cancel ARM. The separate
  `cancelSampleArm` call belongs to runtime VBlank reset, not these context
  transitions: `machine/ts/machine/runtime/vblank.ts:21–27` /
  `machine/cpp/machine/runtime/vblank.cpp:9–14`.

Open boundaries: attachment coordinates/units, pad calibration/trigger policy
and arbitrary output intensity remain separate. Physical electrical/sample
throughput is not defined here. No safe fallback or runtime repair is inferred.
