# IRQ — source fact sheet

Editorial evidence, not the public chapter. The scope is the three controller words, their CPU delivery boundary and the actual firmware/source-language conventions used by the cartridge example. Each fact retains its owning source paths and line ranges. No architecture document or reference PDF is input. Mirrored owners agree within this scope.

# Controller extraction

Scope: interrupt-controller owners and save state, mirrored I/O constants and relevant memory-map constants; Memory boundary only for FLAGS read-only and ACK raw-zero readback. Fact sheet, not chapter prose. No mirror disagreement found in these bounded facts. Device-source conditions, CPU exception entry, instruction timing, bus throughput and BIOS usage are omitted from this extraction.

## Public register and controller facts

### ICF01 — addresses, names and word spacing

- `IO_BASE = RAM_BASE = 08000000H`; `IO_WORD_SIZE = 4`.
- IRQ base index is 0; FLAGS index 0, ACK index 1, MASK index 2; IRQ bank size is three words.
- `08000000H IO_IRQ_FLAGS`; `08000004H IO_IRQ_ACK`; `08000008H IO_IRQ_MASK`.
- TS sources: `machine/ts/spec/bmsx/memory_map.ts:6-7,23-25,32-33`; `machine/ts/spec/bmsx/io.ts:3-8,213-216`.
- C++ sources: `machine/cpp/spec/bmsx/memory_map.h:12-13,29-31,38-39`; `machine/cpp/spec/bmsx/io.h:15-20,226-229`.

### ICF02 — FLAGS read and reset

- FLAGS reads the current pending-flags word; reading does not clear it.
- Reset pending flags: `00000000H`.
- TS sources: `machine/ts/machine/devices/irq/controller.ts:13,19-21,102-105`.
- C++ sources: `machine/cpp/machine/devices/irq/controller.cpp:8,14-16,72-74`.

### ICF03 — FLAGS writes fault at the Memory boundary

- A mapped aligned whole-word write to FLAGS is rejected before the I/O slot or controller write path is reached; Memory raises `BUS_FAULT_READ_ONLY`.
- `BUS_FAULT_READ_ONLY = 3`.
- TS sources: `machine/ts/machine/memory/memory.ts:627-641,852-865`; `machine/ts/spec/bmsx/io.ts:399-402`.
- C++ sources: `machine/cpp/machine/memory/memory.cpp:522-535,729-742`; `machine/cpp/spec/bmsx/io.h:412-415`.

### ICF04 — ACK write-one-clear and read-zero

- ACK has a write handler, no read handler installed by this owner.
- For accepted ACK word `A`, pending flags become `pending & ~A`; each written one clears that pending bit, each written zero preserves it.
- Zero does not change pending flags.
- The ACK handler writes `00000000H` to the ACK raw I/O slot before it returns. Reset and post-load also write zero there.
- Memory reads an I/O slot with no read handler from its raw slot. Thus ACK reads zero after reset and after each completed accepted ACK write.
- TS sources: `machine/ts/machine/devices/irq/controller.ts:12-16,19-32,107-116`; `machine/ts/machine/memory/memory.ts:366-376,430-432,549-552`.
- C++ sources: `machine/cpp/machine/devices/irq/controller.cpp:6-11,14-26,76-85`; `machine/cpp/machine/memory/memory.cpp:245-259,320-322,439-442`.

### ICF05 — MASK read/write and reset

- MASK reads the current mask word.
- An accepted MASK write replaces the entire mask with the written word; no named-source-bit mask is applied.
- Reset mask: `00000000H`.
- Mask writes do not modify pending flags.
- TS source: `machine/ts/machine/devices/irq/controller.ts:15-16,19-26,118-126`.
- C++ source: `machine/cpp/machine/devices/irq/controller.cpp:10-11,14-21,87-93`.

### ICF06 — named interrupt bits

| Bit | Mask | Exact constant |
| --- | --- | --- |
| 0 | `00000001H` | `IRQ_DMA0_DONE` |
| 1 | `00000002H` | `IRQ_GX_PCRTC` |
| 2 | `00000004H` | `IRQ_VBLANK` |
| 3 | `00000008H` | `IRQ_GEO_DONE` |
| 4 | `00000010H` | `IRQ_GEO_ERROR` |
| 5 | `00000020H` | `IRQ_APU` |
| 6 | `00000040H` | `IRQ_GPU` |
| 7 | `00000080H` | `IRQ_IMGDEC` |
| 8 | `00000100H` | `IRQ_DMA1_DONE` |
| 9 | `00000200H` | `IRQ_CARTRIDGE_SLOT0` |
| 10 | `00000400H` | `IRQ_CARTRIDGE_SLOT1` |

- TS source for every row: `machine/ts/spec/bmsx/io.ts:362-372`, one row per consecutive source line.
- C++ source for every row: `machine/cpp/spec/bmsx/io.h:375-385`, one row per consecutive source line.
- These constants name source bits; this sheet supplies no device-source trigger conditions from the names alone.

### ICF07 — pending OR, mask-independent latching, coalescing

- Raising word `R` changes pending flags to `pending | R`, independently of MASK.
- Re-raising already-pending bits leaves the pending word unchanged; no event count is stored by this operation.
- The raise operation does not change MASK.
- TS source: `machine/ts/machine/devices/irq/controller.ts:76-81`.
- C++ source: `machine/cpp/machine/devices/irq/controller.cpp:29-34`.

### ICF08 — output-line equation and retained bits

- Maskable interrupt line is asserted exactly when `(pending & mask) != 0`.
- MASK and the raise/ACK equations operate on full words. Bits 31:11 have no names in ICF06 but are not removed by these controller operations; do not label them hardwired-zero or write-ignored.
- TS sources: `machine/ts/machine/devices/irq/controller.ts:72-81,107-126`; `machine/ts/spec/bmsx/io.ts:362-372`.
- C++ sources: `machine/cpp/machine/devices/irq/controller.h:19,33-37`; `machine/cpp/machine/devices/irq/controller.cpp:29-34,76-93`; `machine/cpp/spec/bmsx/io.h:375-385`.

### ICF09 — controller update edge, not a guessed CPU latency

- ACK clears pending flags within its mapped write callback; MASK replacement also occurs within its mapped write callback.
- Memory writes the raw slot, then invokes the installed write handler before returning from that I/O write path.
- FLAGS reads return the pending word within the read callback; MASK reads return the mask word within the read callback.
- This fact does not specify CPU exception-entry latency, a system-cycle charge, or an interrupt-priority order.
- TS sources: `machine/ts/machine/memory/memory.ts:366-376`; `machine/ts/machine/devices/irq/controller.ts:102-126`.
- C++ sources: `machine/cpp/machine/memory/memory.cpp:245-259`; `machine/cpp/machine/devices/irq/controller.cpp:72-93`.

### ICF10 — common callback behavior for admitted masters

- The installed IRQ read/write handlers do not inspect initiating-master or bus-strobe signals. Their register effects are the same for a call admitted to the handler.
- TS source: `machine/ts/machine/devices/irq/controller.ts:102-126` (handlers take context/address/value only).
- C++ sources: `machine/cpp/machine/devices/irq/controller.h:27-30`; `machine/cpp/machine/devices/irq/controller.cpp:72-93` (the `MappedBusSignals` argument is unused).
- This fact does not specify DMA admission, arbitration, or transfer timing.

## Editorial/system-internal facts — do not automatically expose as cartridge protocol

### ICF11 — reset state beyond public registers

- Reset clears active pending/mask, saved user pending/mask, and supervisor-context-active indication.
- Reset writes ACK raw slot zero and MASK raw slot zero.
- TS source: `machine/ts/machine/devices/irq/controller.ts:19-27`.
- C++ source: `machine/cpp/machine/devices/irq/controller.cpp:14-22`.

### ICF12 — controller-owned saved state

- Captured fields: `mask`, `pendingFlags`, `userMask`, `userPendingFlags`, `supervisorContextActive`.
- First four are word fields; the final field is a Boolean indication. No packed serialized word layout is declared by these state types.
- Restore installs all five fields, then post-load sets ACK raw slot zero and publishes the active MASK to the raw slot.
- TS sources: `machine/ts/machine/devices/irq/save_state.ts:1-7`; `machine/ts/machine/devices/irq/controller.ts:29-51`.
- C++ sources: `machine/cpp/machine/devices/irq/save_state.h:7-13`; `machine/cpp/machine/devices/irq/save_state.cpp:5-22`; `machine/cpp/machine/devices/irq/controller.cpp:24-27`.

### ICF13 — supervisor entry bank operation

- Entry copies active pending and MASK to saved user pending and user MASK, sets supervisor-context-active, clears active pending and MASK, then performs post-load publication.
- This method has no repeated-entry guard in either owner; no instruction/MMIO entry protocol is supplied by this extraction.
- TS source: `machine/ts/machine/devices/irq/controller.ts:54-61`.
- C++ source: `machine/cpp/machine/devices/irq/controller.cpp:44-51`.

### ICF14 — supervisor exit bank operation

- Exit replaces active pending and MASK with the saved user words, clears both saved user words, clears supervisor-context-active, then performs post-load publication.
- Active supervisor pending/mask are not merged into the restored user words.
- TS source: `machine/ts/machine/devices/irq/controller.ts:63-70`.
- C++ source: `machine/cpp/machine/devices/irq/controller.cpp:53-60`.

### ICF15 — user-directed raise and internal acknowledgement

- `raiseUser(R)` uses normal active `raise(R)` when supervisor context is inactive; while active it ORs `R` into saved user pending, leaving active pending unchanged.
- Internal `acknowledge(A)` applies the same active pending `& ~A` operation as mapped ACK and clears the ACK raw slot.
- TS source: `machine/ts/machine/devices/irq/controller.ts:83-100`.
- C++ source: `machine/cpp/machine/devices/irq/controller.cpp:36-42,62-70`.

## Explicitly omitted from this bounded extraction

No supplied facts about source-device trigger/clear/retrigger conditions; CPU cause/EPC/vector/interrupt-enable/priority/nesting/return/HALT semantics; BIOS routines or BLua examples; subword accesses; DMA admission/arbitration; physical clock/bus/pin characteristics; fixed-cycle interrupt latency; source-count guarantees beyond pending-bit OR behavior. These require their own scoped owners/spec extraction and must not be inferred from this sheet.

# CPU delivery extraction

Extraction scope: current interrupt-controller owners; CPU maskable-interrupt acceptance, entry, return and HALT paths; their immediate execution callsites; mirrored CP0/opcode specifications; the single shared producer of the guest IRQ vector; actual BIOS `irq(flags)` binding. No chapter prose. No repository edits. No architecture document or reference PDF opened.

Mirror result: no disagreement found in the facts below. The IRQ-vector instruction producer and BIOS Lua have one shared source, not independent TypeScript/C++ implementations; those rows identify that fact explicitly rather than inventing a mirror.

## Acceptance and pending state

- **CPU-I01 — Central line.** The controller's asserted maskable-interrupt line is exactly `(pendingFlags & mask) != 0`. CPU maskable acceptance is exactly `STATUS.IEc != 0 && asserted line`. There is no mode or handler-presence condition in this acceptance predicate.
  - TS controller: `machine/ts/machine/devices/irq/controller.ts:72–74`.
  - C++ controller: `machine/cpp/machine/devices/irq/controller.h:19`.
  - TS CPU: `machine/ts/machine/cpu/cpu.ts:1680–1683`.
  - C++ CPU: `machine/cpp/machine/cpu/cpu.cpp:2242–2245`.
- **CPU-I02 — Pending is not masked on arrival.** Raising source bits ORs them into pending without consulting the mask. FLAGS reads return pending; MASK writes replace the mask. A masked source can remain pending. Multiple raises of an already-set bit retain the same bit, not a count.
  - TS: `machine/ts/machine/devices/irq/controller.ts:76–81,102–105,123–126`.
  - C++: `machine/cpp/machine/devices/irq/controller.cpp:29–34,72–74,91–93`.
- **CPU-I03 — Acknowledgement.** ACK clears the selected pending bits with `pending & ~value`; zero clears none. The ACK backing word is written back to zero. CPU maskable exception entry does not perform that acknowledgement.
  - TS ACK: `machine/ts/machine/devices/irq/controller.ts:107–116`; CPU entry: `machine/ts/machine/cpu/cpu.ts:1718–1728,1764–1779`.
  - C++ ACK: `machine/cpp/machine/devices/irq/controller.cpp:76–85`; CPU entry: `machine/cpp/machine/cpu/cpu.cpp:2280–2287,2312–2334`.
- **CPU-I04 — No per-source CPU selection.** The CPU acceptance predicate asks whether any pending-and-enabled bit exists; accepted maskable entry takes one IRQ vector and sets cause to `CPU_CAUSE_IRQ`. It does not select a highest source bit or invoke one vector per pending bit.
  - TS: `machine/ts/machine/cpu/cpu.ts:1680–1683,1718–1728`.
  - C++: `machine/cpp/machine/cpu/cpu.cpp:2242–2245,2280–2287`.

## CP0 and exception entry/return

- **CPU-I05 — Relevant CP0 constants.** STATUS is CP0 register 12, CAUSE is 13, EPC is 14. STATUS bit 0 is current interrupt enable (IEc), bit 1 is current user mode. Mode-stack mask is `0000003fH`; RFE restore mask is `0000000fH`. System-entry STATUS is `00000001H`; cartridge-entry STATUS is `00000003H`. IRQ cause is `00000400H`.
  - TS spec: `machine/ts/spec/blua32/cop0.ts:3–16`.
  - C++ spec: `machine/cpp/spec/blua32/cop0.h:9–22`.
- **CPU-I06 — Reset and program entry.** CPU reset sets STATUS to system-entry status and CAUSE/EPC to zero; it clears the HALT latch and accepted-interrupt event latch. Execute-function entry sets STATUS to cartridge-entry or system-entry according to the function's execution domain and clears both latches.
  - TS reset: `machine/ts/machine/cpu/cpu.ts:869–892`; function entry: `machine/ts/machine/cpu/cpu.ts:1523–1546`.
  - C++ reset: `machine/cpp/machine/cpu/cpu.cpp:431–456`; function entry: `machine/cpp/machine/cpu/cpu.cpp:1095–1118`.
- **CPU-I07 — Vector selection.** On accepted maskable IRQ, user mode selects the active execution image's IRQ function address; non-user mode selects the system image's IRQ function address. The interrupted frame's current PC is supplied as EPC.
  - TS: `machine/ts/machine/cpu/cpu.ts:1666–1668,1718–1725`.
  - C++: `machine/cpp/machine/cpu/cpu.h:286`; `machine/cpp/machine/cpu/cpu.cpp:2280–2284`.
- **CPU-I08 — Entry datapath.** Exception entry writes exception domain, EPC, and CAUSE; updates STATUS by `(STATUS & ~0000003fH) | ((STATUS << 2) & 0000003fH)`; clears the HALT latch; and pushes an exception frame whose call-site PC is EPC. Consequently the new current-mode and current-enable bits are both zero. This is not an ACK operation.
  - TS: `machine/ts/machine/cpu/cpu.ts:1764–1785`.
  - C++: `machine/cpp/machine/cpu/cpu.cpp:2312–2340`.
- **CPU-I09 — Normal maskable nesting gate.** Following that entry transformation, maskable acceptance remains gated by current IEc. The entry does not leave IEc enabled. STATUS writes in non-user mode replace the whole STATUS word directly. No automatic per-source priority/nesting facility is established by these paths.
  - TS: `machine/ts/machine/cpu/cpu.ts:1680–1683,1772–1773,2756–2765`.
  - C++: `machine/cpp/machine/cpu/cpu.cpp:2242–2245,2320–2321`; `machine/cpp/machine/cpu/cpu_dispatch.inl:405–414`.
- **CPU-I10 — RFE.** RFE requires non-user mode and an exception frame. It removes that frame, sets the caller PC to EPC, and updates STATUS by `(STATUS & ~0000000fH) | ((STATUS >> 2) & 0000000fH)`. The ordinary maskable-return path does not acknowledge controller bits. User-mode RFE takes the coprocessor-unusable exception; non-exception-frame RFE hard-halts.
  - TS: `machine/ts/machine/cpu/cpu.ts:2773–2801`.
  - C++: `machine/cpp/machine/cpu/cpu_dispatch.inl:688–716`.
- **CPU-I11 — CP0 privilege.** MFC0 and MTC0 in user mode take the coprocessor-unusable exception. In non-user mode MFC0 STATUS/CAUSE/EPC reads those words; MTC0 STATUS and EPC replaces those words. MTC0 CAUSE does not change CAUSE.
  - TS: `machine/ts/machine/cpu/cpu.ts:2738–2771`.
  - C++: `machine/cpp/machine/cpu/cpu_dispatch.inl:386–421`.

## Guest `irq(flags)` entry and installed BIOS dispatch

- **CPU-I12 — Delivered flags are a fresh full pending-word read.** The generated guest IRQ vector loads the word at IO_IRQ_FLAGS; if the read value is nonzero, it calls global `irq` with that complete word as its sole argument; it then executes RFE. It does not AND that argument with IRQ_MASK. It therefore does not supply only the bit that caused acceptance. The FLAGS load occurs in vector code, after CPU acceptance/entry, not as a pending snapshot stored by CPU entry.
  - Shared vector producer: `toolchain/ts/lua/compiler.ts:1633–1649`.
  - FLAGS owner pair: `machine/ts/machine/devices/irq/controller.ts:102–105`; `machine/cpp/machine/devices/irq/controller.cpp:72–74`.
  - CPU entry pair (no flags argument/snapshot): `machine/ts/machine/cpu/cpu.ts:1718–1728,1764–1779`; `machine/cpp/machine/cpu/cpu.cpp:2280–2287,2312–2334`.
- **CPU-I13 — BIOS binding.** Installed BIOS global `irq(flags)` calls `interrupts.dispatch(flags)`.
  - Single shared BIOS source: `machine/bios/main.lua:17,50–52`.
- **CPU-I14 — BIOS registered handlers.** Dispatch iterates the registered mask/handler pairs. For every pair with `flags & mask != 0`, it calls `handler(flags & mask, flags)` and accumulates `ack | (flags & mask)`. After that iteration it writes nonzero accumulated ACK to `08000004H` and returns the accumulated value. Registration is `handlers[mask] = handler`. This source provides no sorted source-priority ordering; it uses `pairs(handlers)` directly.
  - Single shared BIOS source: `machine/bios/kernel/interrupts.lua:1–23`.
- **CPU-I15 — BIOS acknowledgement scope.** Unmatched flags are not included in the BIOS dispatcher's accumulated ACK. Overlapping registered masks can both match the same delivered flag word. The handler calls occur before the dispatcher's final ACK write.
  - Single shared BIOS source: `machine/bios/kernel/interrupts.lua:5–16,19–21`.

## HALT and acceptance timing

- **CPU-I16 — HALT operation.** HALT calls `haltUntilIrq`. If the accepted-interrupt event latch is already true, HALT clears that latch and does not establish a wait. Otherwise it latches the active thread and current frame depth as halted-until-IRQ. The halted predicate matches both the active thread and current depth.
  - TS: `machine/ts/machine/cpu/cpu.ts:1611–1619,1635–1637,2471–2473`.
  - C++: `machine/cpp/machine/cpu/cpu.cpp:1643–1651`; `machine/cpp/machine/cpu/cpu.h:278–281`; `machine/cpp/machine/cpu/cpu_dispatch.inl:132–135`.
- **CPU-I17 — Accepted-event latch, not an event counter.** Accepted maskable IRQ sets `interruptEventPending = true` only when no HALT depth is latched. It is a single boolean. Accepted exception entry clears the HALT depth/thread latch. These latches are separate from controller pending bits and ACK.
  - TS: `machine/ts/machine/cpu/cpu.ts:1718–1727,1781–1785` and `1611–1614`.
  - C++: `machine/cpp/machine/cpu/cpu.cpp:2280–2285,2336–2340` and `1643–1646`.
- **CPU-I18 — Halted CPU wake checks the same acceptance gate.** The stopped-CPU execution path attempts `enterPendingInterrupt()` while the CPU is halted and the system controller is not holding it. That operation still applies CPU-I01. A raw masked pending bit, or a pending line while IEc is zero, is not sufficient for maskable acceptance. This fact does not rule out other independently sourced nonmaskable events.
  - TS execution callsite: `machine/ts/machine/runtime/cpu_executor.ts:39–58`; gate/entry: `machine/ts/machine/cpu/cpu.ts:1680–1683,1718–1729`.
  - C++ execution callsite: `machine/cpp/machine/runtime/cpu_executor.cpp:12–29`; gate/entry: `machine/cpp/machine/cpu/cpu.cpp:2242–2245,2280–2287`.
- **CPU-I19 — Running CPU sample position.** In the ordinary dispatch loop, the interrupt-acceptance check precedes the next decoded dispatch/fetch. Halted or blocked execution is returned before that running-loop check. There is a separate stopped-CPU path in CPU-I18. Do not turn this into a guaranteed check after every unfused source instruction or a fixed interrupt-latency number.
  - TS ordinary loop: `machine/ts/machine/cpu/cpu.ts:1802–1854`; instrumented path: `1863–1933`.
  - C++ loop: `machine/cpp/machine/cpu/cpu.cpp:2380–2435,2465–2479`.
- **CPU-I20 — Time continues during HALT.** The stopped-CPU path runs due device timers, tries accepted-interrupt entry, and can advance time to the next scheduled device deadline while the CPU remains halted. It does not execute parked CPU instructions. No controller interrupt-propagation frequency, fixed raise-to-handler deadline, or sustained IRQ throughput is specified by these operations.
  - TS: `machine/ts/machine/runtime/cpu_executor.ts:39–88`.
  - C++: `machine/cpp/machine/runtime/cpu_executor.cpp:12–61`.
- **CPU-I21 — Instruction base costs only.** MFC0, MTC0, RFE, and HALT each have a one-cycle ISA base cost. LOAD_MEM has base cost two, as used by the shared vector's FLAGS read. These costs are not a promise that interrupt delivery, the full vector, BIOS dispatch, or a user handler takes one or two cycles.
  - TS ISA enum and table: `machine/ts/spec/blua32/opcode.ts:40–65,75–84`.
  - C++ table: `machine/cpp/spec/blua32/opcode.cpp:44–45,55,58,69`.

## Internal-only ownership and save-state notes

The following items are audit evidence. Do not translate runtime thread/frame representation into cartridge-visible registers.

- **CPU-X01 — CPU save-state distinction.** CPU state preserves `haltedUntilIrqFrameDepth`, `haltedUntilIrqThreadRef`, `interruptEventPending`, STATUS, CAUSE, EPC, and the independent nonmaskable-pending boolean. Those are CPU-owned, not extra controller register words. Capture/restore retains the accepted-event latch separately from the HALT latch.
  - TS capture: `machine/ts/machine/cpu/cpu.ts:4617–4633`; restore: `4876–4892`.
  - C++ state fields: `machine/cpp/machine/cpu/cpu.h:143–159`; capture: `machine/cpp/machine/cpu/cpu.cpp:1379–1394`; restore: `1616–1632`.
- **CPU-X02 — Controller bank context is not every IRQ entry.** Controller supervisor-context entry saves the user pending/mask pair and clears the active pair; leave restores the user pair. The actual system-controller activation callsite invokes that controller operation as part of its supervisor-context transition. Ordinary CPU exception entry only changes CPU status/exception state and pushes its frame; it does not invoke controller-bank entry.
  - TS controller: `machine/ts/machine/devices/irq/controller.ts:54–69`; actual system callsite: `machine/ts/machine/devices/system/controller.ts:228–240`; ordinary exception entry: `machine/ts/machine/cpu/cpu.ts:1764–1779`.
  - C++ controller: `machine/cpp/machine/devices/irq/controller.cpp:44–60`; actual system callsite: `machine/cpp/machine/devices/system/controller.cpp:180–192`; ordinary exception entry: `machine/cpp/machine/cpu/cpu.cpp:2312–2334`.
- **CPU-X03 — Source-level boundary caveat.** Ordinary dispatch can fuse adjacent arithmetic instructions; its IRQ check is outside execution of that decoded dispatch. Instrumented dispatch has additional stopping hooks. Neither fact belongs in a cartridge hardware description, but together they prohibit deriving a cycle-precise IRQ guarantee simply from the visible loop.
  - TS decode: `machine/ts/machine/cpu/cpu.ts:1381–1421`; check: `1821–1826`; instrumented check/hooks: `1886–1907`.
  - C++ decode/check architecture: `machine/cpp/machine/cpu/cpu.cpp:971–1005,2403–2430,2465–2479`.

## Explicitly omitted

No new fact is supplied for a separate BLua critical-region primitive, guaranteed per-source service order, guaranteed worst-case IRQ latency, physical IRQ pins or propagation delay, a controller clock specification, safe arbitrary nested maskable handlers, or complete NMI semantics. No such guarantee has been established by this bounded extraction. No test names were used as specifications.

# Firmware and cartridge extraction

Scope: source extraction and candidate-example audit only. No chapter prose,
repository edits, implementation, or execution claim. `docs/architecture.md` and
`docs/book1_text.pdf` were not opened. BIOS and live paired CPU/controller owners
were inspected. GPU facts are reused from the already-published frozen GPU sheet,
not imported from external hardware. No source disagreement found in this scope.

## Actual BIOS and cartridge conventions

| ID | Confirmed fact | Source |
|---|---|---|
| B01 | The system firmware defines global `function irq(flags)` and forwards `flags` to its own interrupt dispatcher. | `machine/bios/main.lua:50–52` |
| B02 | BIOS IRQ acknowledgement uses `local irq_ack<const>: *word = 0x08000004` and `*irq_ack = ack`, not a Lua array pretending to be registers. | `machine/bios/kernel/interrupts.lua:3–15` |
| B03 | BIOS `interrupts.on(mask, handler)` retains one callback under that exact mask key. Dispatch iterates registered entries and, if `flags & mask` is nonzero, calls `handler(flags & mask, flags)`. | `machine/bios/kernel/interrupts.lua:5–20` |
| B04 | BIOS dispatch ORs all matched bits into `ack`; after callbacks finish it acknowledges those bits only, if nonzero, and returns that acknowledgement word. It neither acknowledges unmatched flags nor explicitly filters against IRQ_MASK. | `machine/bios/kernel/interrupts.lua:5–16` |
| B05 | BIOS VBlank uses explicit mutable `bss bios_vblank_count: word`; a registered VBlank callback increments it. `vblank.wait()` repeatedly tests the count and executes statement `halt_until_irq` while zero, then subtracts one. | `machine/bios/kernel/vblank.lua:4–20` |
| B06 | BIOS DMA likewise uses explicit BSS completion sequence, snapshots it before starting a transfer, and loops with `halt_until_irq` until it changes. This is a separate DMA-specific utility, not an IRQ-controller API to invent locally. | `machine/bios/kernel/dma.lua:12–33` |
| B07 | BIOS static storage includes `rodata ...: word[4]` and separately declared typed BSS arrays and words. | `machine/bios/tty/terminal.lua:41–73` |
| B08 | Named struct declarations and typed readonly arrays with named initializer fields are actual BIOS source forms. | `machine/bios/shell/commands.lua:61–94` |
| B09 | Typed views of explicit BSS are actual BIOS source forms (`local ...<const>: *word = terminal_dirty_rows`). | `machine/bios/tty/terminal.lua:122–128` |
| B10 | A typed ROM word view is actual BIOS source (`local lut<const>: *word = sin_quarter_lut`), read using zero-based indices. | `machine/bios/math/sin.lua:2–36,43–56` |
| B11 | Existing bare-metal cartridge defines its own global `irq(flags)`, ORs flags into retained software state, and acknowledges the supplied flags through typed MMIO. | `carts/bare_metal_cart/cart.lua:3–4,24–33` |
| B12 | Existing bare-metal cartridge waits on its own retained source bit in a predicate loop containing `halt_until_irq`; it removes only the consumed software bit afterward. | `carts/bare_metal_cart/cart.lua:177–188` |
| B13 | The published GPU example defines a direct cartridge IRQ entry, uses typed MMIO, typed `rodata`, explicit BSS, and ends in statement `halt_until_irq` with VBlank unmasked. | `carts/gpu_manual/cart.lua:3–11,14–70,144–148` |

These are source conventions, not a promise that private system-ROM `require`
paths are callable cartridge BIOS exports. The new direct example needs no
`typedWordIO` wrapper or named loader abstraction; the source form is the actual
`local ...<const>: *word = address` declaration and dereference.

## Distinct existing cartridge dispatcher — do not conflate with BIOS dispatch

| ID | Confirmed fact | Source |
|---|---|---|
| D01 | Requiring `cartlib/irq` installs the cartridge's global `irq(flags)` function. Its own comment explicitly leaves bare-metal carts free to define their own IRQ function instead. | `cartlib/irq.lua:23–26` |
| D02 | `register(source, handler)` stores a callback and ORs `source` into IRQ_MASK; `unregister(source)` removes the callback and clears those mask bits. | `cartlib/irq.lua:13–20` |
| D03 | This dispatcher computes `pending = flags & *irq_mask_register`, selects the least significant pending bit, acknowledges that source **before** its callback, calls `handler(source)`, then removes that bit from its local pending word. | `cartlib/irq.lua:26–34` |
| D04 | This differs from BIOS B03/B04: BIOS passes both masked-by-registration and complete flags and acknowledges after callbacks; cartlib passes one selected physical source and acknowledges before callbacks. Neither behavior should be described as the other. | `machine/bios/kernel/interrupts.lua:5–16`; `cartlib/irq.lua:26–34` |

## Generated `irq(flags)` ABI and CPU acceptance — paired owners

| ID | Confirmed fact | Sources |
|---|---|---|
| A01 | The generated cartridge interrupt-entry sequence loads **the full IO_IRQ_FLAGS word**, compares it with zero, calls global `irq` with that one word if nonzero, and emits RFE. It does not AND the word with IRQ_MASK. | Producer: `toolchain/ts/lua/compiler.ts:1633–1650` |
| A02 | Therefore `flags` may include a disabled pending source when another enabled source caused acceptance. The generated entry's read is the snapshot supplied to the function; it is not an independently sampled per-source callback. | Derivation from A01 plus `machine/ts/machine/devices/irq/controller.ts:72–80,102–105,118–125`; paired `machine/cpp/machine/devices/irq/controller.cpp:29–34,72–92` and `machine/cpp/machine/devices/irq/controller.h:17–28` |
| A03 | Maskable CPU acceptance requires both CPU status IE-current set and the controller's asserted line (pending AND mask nonzero). | `machine/ts/machine/cpu/cpu.ts:1680–1692`; paired `machine/cpp/machine/cpu/cpu.cpp:2242–2254` |
| A04 | For a maskable interrupt the CPU selects the active execution image's IRQ vector in user mode and the system image's vector otherwise. | `machine/ts/machine/cpu/cpu.ts:1718–1725`; paired `machine/cpp/machine/cpu/cpu.cpp:2280–2284` |
| A05 | Exception entry stores EPC and cause, pushes the status mode-stack bits, clears the HALT latch, and invokes the vector as an exception frame. The CPU itself passes no handler arguments; the generated vector in A01 owns the FLAGS load and `irq(flags)` call. | `machine/ts/machine/cpu/cpu.ts:1764–1784`; paired `machine/cpp/machine/cpu/cpu.cpp:2312–2339` |
| A06 | Status IE-current is bit 0, user-current bit 1. The cartridge entry status is `3` (both bits set); system entry status is `1`. | `machine/ts/spec/blua32/cop0.ts:8–14`; paired `machine/cpp/spec/blua32/cop0.h:14–20` |
| A07 | Executing a cartridge entry function selects that cartridge entry status and clears its HALT/event/stalled-write state before the entry executes. Do not confuse CPU IE-current's initial value with IRQ_MASK, which is a separate device word. | `machine/ts/machine/cpu/cpu.ts:1523–1546`; paired `machine/cpp/machine/cpu/cpu.cpp:1095–1118` |
| A08 | `halt_until_irq` is a source statement compiled to HALT; it is not a function call. | `toolchain/ts/lua/compiler.ts:3665–3667`; actual BIOS `machine/bios/kernel/vblank.lua:16–20` |
| A09 | HALT consumes a retained interrupt-event latch and returns immediately when that latch is set; otherwise it records the current thread/frame as halted. Acceptance sets that event latch when there was no HALT latch, while accepted exception entry clears HALT. | `machine/ts/machine/cpu/cpu.ts:1611–1619,1695–1727,1781–1784`; paired `machine/cpp/machine/cpu/cpu.cpp:1643–1651,2257–2285,2336–2339` |
| A10 | The generated vector returns with RFE; RFE restores mode-stack status and the interrupted caller's PC from EPC. An ordinary public handler returns to that generated vector. | Producer `toolchain/ts/lua/compiler.ts:1647–1649`; `machine/ts/machine/cpu/cpu.ts:2773–2793`; paired `machine/cpp/machine/cpu/cpu_dispatch.inl:688–707` |

No fixed interrupt latency, complete IRQ entry-cycle budget, NMI tutorial, or
compiler implementation change is asserted by this extraction.

## Narrow controller facts needed by the example

| ID | Confirmed fact | Sources |
|---|---|---|
| I01 | FLAGS, ACK and MASK occupy the first three 4-byte I/O words: `08000000`, `08000004`, `08000008`. GPU source is `40`; VBlank source is `04`. | `machine/ts/spec/bmsx/io.ts:3–8,213–216,362–368`, `machine/ts/spec/bmsx/memory_map.ts:6,23,32`; paired `machine/cpp/spec/bmsx/io.h:15–20,226–229,375–381`, `machine/cpp/spec/bmsx/memory_map.h:12,29,38` |
| I02 | A controller source raise ORs its word into pending regardless of mask. Repeated raises while a bit remains pending coalesce into that same bit; no event count is retained there. | `machine/ts/machine/devices/irq/controller.ts:72–80`; paired `machine/cpp/machine/devices/irq/controller.cpp:29–34` |
| I03 | MASK write replaces the mask word; it does not erase pending. FLAGS read returns the pending word. | `machine/ts/machine/devices/irq/controller.ts:102–105,118–125`; paired `machine/cpp/machine/devices/irq/controller.cpp:72–92` |
| I04 | ACK clears only bits selected by written ones, then its backing word is zero. Writing ACK zero clears no pending bits. | `machine/ts/machine/devices/irq/controller.ts:107–115`; paired `machine/cpp/machine/devices/irq/controller.cpp:76–84` |
| I05 | Hardware reset clears pending and MASK; source-code entry is not a promise of an otherwise empty pending word after real BIOS activity. | Reset: `machine/ts/machine/devices/irq/controller.ts:19–27`; paired `machine/cpp/machine/devices/irq/controller.cpp:14–22`; actual BIOS activity `machine/bios/main.lua:126–142` |
| I06 | `word` occupies four bytes, alignment four, and uses the Word memory-access representation. The actual source patterns above need no halfword register writes. | Producer `toolchain/ts/lua/compiler/struct_types.ts:44–55`; representation `machine/ts/spec/blua32/memory_access_kind.ts:1–10`; paired `machine/cpp/spec/blua32/memory_access_kind.h:8–23` |
| I07 | The compiler emits startup BSS zero stores before entry via its section initializer. Explicitly authored mutable words belong in BSS, as in the actual BIOS wait examples. | Producer `toolchain/ts/lua/compiler.ts:1534–1555,1561–1584`; BIOS examples B05/B06 |

## Already-frozen GPU producer contract reused, not re-extracted

| ID | Frozen fact | Source |
|---|---|---|
| G01 | GP0 `1f000000` is an in-order marker. At execution, a clear GPUSTAT24 becomes set and raises IRQ_GPU `40`; when GPUSTAT24 remains set, repeated markers do not raise again. | `docs/book1/facts/gpu.md:251` (GP0 F35), `:550` (control A09), with paired owner links embedded there |
| G02 | GP1 `02000000` clears the GPU-local GPUSTAT24 latch only. ACK `40` clears controller pending GPU only. Both need their own acknowledgement for independent later GPU requests. | `docs/book1/facts/gpu.md:477` (C02), `:550` (A09), with paired owner links embedded there |
| G03 | Becoming GPU idle does not itself raise IRQ_GPU; an IRQ marker is not display acceptance or scanout completion. | `docs/book1/facts/gpu.md:251,550` |
| G04 | Actual BIOS command-list submission appends an IRQ request, submits DMA, polls controller FLAGS bit40, acknowledges controller40, then acknowledges GPU through `gx_gpu.ack_irq()`. | `machine/bios/gpu/commandlist.lua:9–16`; producer `machine/bios/gpu/gpu.lua:156–158,200–203` |
| G05 | Actual published cartridge scalar code writes the marker to GP0, polls GPUSTAT24, clears GP1local and controller latches, then waits for idle separately. | `carts/gpu_manual/cart.lua:135–142` |


## Root supplemental extraction — fixed scope

- **IRQ-S01 — Source-owned example VBlank.** VBlank entry presents the ready picture, services input and then raises `IRQ_VBLANK`. VBlank end is ignored by this handler. Standard firmware initialization calls `gx_gpu.reset_320x240`, whose setup writes the running PCRTC timing configuration. The example retains that running beam rather than programming a second timing mode. It polls pending04 with MASK0; this does not imply a fixed VBlank delay. Sources: [TS VBlank](../../../machine/ts/machine/runtime/vblank.ts#L44-L65), [C++ VBlank](../../../machine/cpp/machine/runtime/vblank.cpp#L31-L49); shared firmware [initialization](../../../machine/bios/main.lua#L126-L142), [timing setup](../../../machine/bios/gpu/gpu.lua#L79-L105). Complete PCRTC timing/stop contract remains [PCRTC facts](pcrtc.md), not a new IRQ timing definition.
- **IRQ-S02 — Example producer/readiness.** GPUSTAT bit24 is the GPU-local request latch; bit26 is idle iff readback is idle, no pending deadline, both ingress FIFOs empty and no partial fixed packet/upload/polyline. GP0 `1f000000` sets local24 and raises controller40 only if local24 was clear; GP1 `02000000` clears local24 only. Controller ACK40 clears pending40 only. The example waits idle26 before markers and does not start another GP0 producer. Source: already-reviewed GPU fact [A09 and status26](gpu.md#5-admission-ingress-read-ownership-and-irq), specifically GPU fact sheet lines532,550 with their paired live owner links; [TS command execution](../../../machine/ts/machine/devices/gx/gpu.ts#L1194-L1212), [C++ execution](../../../machine/cpp/machine/devices/gx/gpu.cpp#L774-L791). This is not a guarantee that idle raises an IRQ, or that marker completion publishes scanout.
- **IRQ-S03 — Installed cycle timebase.** Installed `cpuFreqHz` is 33,868,800 Hz. A system cycle is therefore `1/33868800` seconds, approximately29.525699ns. This is the system-cycle unit used by CPU-I21, not a sourced separate interrupt-controller oscillator, propagation time, arbitration guarantee, or maximum sustainable interrupt rate. Sources: [TS constants](../../../machine/ts/spec/bmsx/model.ts#L7-L7), [TS installed model](../../../machine/ts/spec/bmsx/model.ts#L46-L56), [C++ constants](../../../machine/cpp/spec/bmsx/model.h#L12-L12), [C++ installed model](../../../machine/cpp/spec/bmsx/model.h#L51-L61).
- **IRQ-S04 — Mapped access widths.** At the IRQ word addresses, aligned register-word/U32 reads call the full-word read path; U8 reads at those aligned addresses call the same full read then return7:0. U8 reads at offsets1–3, all U8 writes into IO, and mapped U16 reads/writes into IO raise UNALIGNED_IO2 before any IRQ callback. Word writes first reject FLAGS with READ_ONLY3, then call the normal ACK/MASK callback when admitted. F32 transfers one word's bits; F64 transfers low word atA then high word atA+4, and stops if the first faults. Thus F64 store at FLAGS does not reach ACK; F64 store atACK applies ACK low word then MASK high word, not an atomic controller command. Sources: [TS byte read](../../../machine/ts/machine/memory/memory.ts#L442-L451), [C++](../../../machine/cpp/machine/memory/memory.cpp#L332-L341), [TS byte write](../../../machine/ts/machine/memory/memory.ts#L466-L469), [C++](../../../machine/cpp/machine/memory/memory.cpp#L356-L359), [TS halfword read](../../../machine/ts/machine/memory/memory.ts#L503-L506), [C++](../../../machine/cpp/machine/memory/memory.cpp#L393-L396), [TS halfword write](../../../machine/ts/machine/memory/memory.ts#L603-L606), [C++](../../../machine/cpp/machine/memory/memory.cpp#L498-L501), [TS word read](../../../machine/ts/machine/memory/memory.ts#L544-L555), [C++](../../../machine/cpp/machine/memory/memory.cpp#L434-L445), [TS word write](../../../machine/ts/machine/memory/memory.ts#L627-L646), [C++](../../../machine/cpp/machine/memory/memory.cpp#L522-L540), [TS float read](../../../machine/ts/machine/memory/memory.ts#L573-L588), [C++](../../../machine/cpp/machine/memory/memory.cpp#L463-L482), [TS float write](../../../machine/ts/machine/memory/memory.ts#L659-L671), [C++](../../../machine/cpp/machine/memory/memory.cpp#L553-L567), [TS fault constants](../../../machine/ts/spec/bmsx/io.ts#L399-L402), [C++](../../../machine/cpp/spec/bmsx/io.h#L412-L415). CPU alignment rejection and synchronous exception translation remain the common contract already extracted in [PCRTC mapped access and faults](pcrtc.md#mapped-access-and-faults), not a claim that CPU faults set controller pending bits.

## Separate specification decisions

The software-authoritative contract supplies pending/mask/ACK state, visibility on accepted writes, CPU delivery conditions, explicit ISA base costs and the installed system-cycle timebase. It does not define an independent IRQ oscillator, physical pin timing, fixed request-to-handler latency, electrical bus width/arbitration or a sustained interrupt-rate guarantee. Keep those future hardware-specification decisions separate; do not invent ratings from another console or block a software-authoritative chapter on nonexistent electrical sources. Source-device-specific causes beyond the two bounded examples belong to their owning chapters. Bits9/10 may be named here; cartridge devices and sockets remain Book II.

- **IRQ-S05 — Authored example storage.** The example's `results` const module declares five header words (`completed_phase`, `gpu_services`, two handler flags and `ack_zero_flags`) followed by eight five-word phase records: `(5+8*5)*4=180` BSS bytes. A const export of a BSS declaration is represented by its storage address, not a runtime table of register values; consuming the address emits a relocated constant load. This is a source-language/data-layout fact, not a hardware port. Sources: [const export producer](../../../toolchain/ts/lua/compiler/passes/const_module_exports.ts#L94-L120), [address producer](../../../toolchain/ts/lua/compiler.ts#L3177-L3180), [word width](../../../toolchain/ts/lua/compiler/struct_types.ts#L44-L55), actual authored [result storage](../../../carts/irq_manual/results.lua#L1-L21). Actual execution/layout evidence is separate from this producer contract.

- **IRQ-S06 — Qualified actual-example vector base budget.** The current built `irq_manual` cartridge's IRQ entry has logical operations LOADK, LOAD_MEM, EQ with zero constant, JMP, GETGL, MOV, CALL, RFE. Nonzero FLAGS skips JMP:7 logical operations,9 base cycles; zero FLAGS executes LOADK/LOAD_MEM/EQ/JMP/RFE:5 logical operations,6 base cycles. Callback body and its RET are excluded. This is a measured linked-program sequence/base-cost derivation, not a universal IRQ hardware latency or an optimizer-independent vector size/cost. The independently linked O0–O2 audit sample retains an extra K0 and has10/7 instead; do not publish that as this O3 cartridge's cost. Sources: shared [entry producer](../../../toolchain/ts/lua/compiler.ts#L1633-L1649), [TS ISA opcode/charges](../../../machine/ts/spec/blua32/opcode.ts#L1-L84), [C++ ISA charges](../../../machine/cpp/spec/blua32/opcode.cpp#L7-L69), actual [cartridge entry](../../../carts/irq_manual/cart.lua), central [logical instruction indexing](../../../toolchain/ts/rompack/disassembler.ts#L482-L509). Root audit uses existing ROM/image/disassembly owners on `dist/irq_manual.debug.rom`; detailed execution/derivation evidence is in the source review.
