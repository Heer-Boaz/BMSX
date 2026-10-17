# DMA — frozen source evidence

Book I installed two-channel DMA, extracted from scoped mirrored spec leaves and
live owners. This is editorial evidence, not public chapter prose. No architecture
document or reference PDF supplied facts. Register (DMR), transfer/timing (DMT),
port/fault (DMP) and actual BIOS/source-language (DMB) slices were extracted
separately. Internal snapshot fields below are not additional cartridge words.

## Authority and limits

The live software contract is authoritative for this edition, as requested.
Unspecified independent pin/bus clocks, physical arbitration waveforms and
sustained electrical ratings remain future specification decisions, not invented
values or a claim of physical qualification. No DMA-specific payload RAM size is
inferred from its registers or admitted configuration. Cartridge request names
are retained; socket/card programming is Book II. Executable examples follow
actual firmware data declarations and service predicates; private firmware
modules are not presented as cartridge exports.

# BMSX DMA register and owner-state fact sheet

Checkout inspected: `master`, `7b9a24334`; initial working tree clean. Extraction only; no repository edits. All source paths below are repository-relative. TS and C++ were checked separately. No owner/spec/mirror disagreement found in the facts below. No architecture document or PDF opened.

## Scope and evidence convention

- Facts describe the scoped live spec constants, DMA register/controller owners, and exact Memory slot/access boundary. They do not introduce a hardware specification beyond those sources.
- Every DMR fact has current TS and C++ source evidence. Repeated behavior shared by register-table rows is established by the cited common DMR facts. There is no shared cross-language producer among these scoped DMA/spec files: each listed TS/C++ source is its own mirror.
- Numeric addresses are evaluations of the mirrored constant expressions, not copied from external documentation. Normal mapped word access is the access surface below; direct owner `writeIoU32` updates are distinct.

## Layout and all twelve register words

**DMR00 — Layout/address basis.** There are two channels and six register words per channel. A word is four bytes; `IO_BASE = RAM_BASE = 0x08000000`. Channel 0 occupies indices 3..8. Channel 1's base is the PCRTC timing block's end; its six indices are not adjacent to channel 0. The numeric addresses in DMR01–DMR12 were evaluated independently from each mirror and agree.

- TS: `machine/ts/spec/bmsx/io.ts:3-18`, `machine/ts/spec/bmsx/io.ts:125-137`, `machine/ts/spec/bmsx/io.ts:218-237`; `machine/ts/spec/bmsx/memory_map.ts:6`, `machine/ts/spec/bmsx/memory_map.ts:23`, `machine/ts/spec/bmsx/memory_map.ts:32`.
- C++: `machine/cpp/spec/bmsx/io.h:15-30`, `machine/cpp/spec/bmsx/io.h:138-150`, `machine/cpp/spec/bmsx/io.h:231-250`; `machine/cpp/spec/bmsx/memory_map.h:12`, `machine/cpp/spec/bmsx/memory_map.h:29`, `machine/cpp/spec/bmsx/memory_map.h:38`.

Access/reset evidence is DMR13–DMR17. `Command/read-zero` means writes invoke the command callback and ordinary reads return zero; it does not mean reads fault.

| Fact | Address | Exact constant name | Mapped access | Reset | TS address evidence | C++ address evidence |
|---|---|---|---|---|---|---|
| DMR01 | `0x0800000c` | `IO_DMA0_READ_ADDR` | R/W raw word | `0` | `machine/ts/spec/bmsx/io.ts:13,219` | `machine/cpp/spec/bmsx/io.h:25,232` |
| DMR02 | `0x08000010` | `IO_DMA0_WRITE_ADDR` | R/W raw word | `0` | `machine/ts/spec/bmsx/io.ts:14,220` | `machine/cpp/spec/bmsx/io.h:26,233` |
| DMR03 | `0x08000014` | `IO_DMA0_TRANSFER_COUNT` | R/W raw word | `0` | `machine/ts/spec/bmsx/io.ts:15,221` | `machine/cpp/spec/bmsx/io.h:27,234` |
| DMR04 | `0x08000018` | `IO_DMA0_CONTROL` | R/W raw word | `0` | `machine/ts/spec/bmsx/io.ts:16,222` | `machine/cpp/spec/bmsx/io.h:28,235` |
| DMR05 | `0x0800001c` | `IO_DMA0_STATUS` | Read-only; mapped write faults | `0` | `machine/ts/spec/bmsx/io.ts:17,223` | `machine/cpp/spec/bmsx/io.h:29,236` |
| DMR06 | `0x08000020` | `IO_DMA0_TRIGGER` | Command/read-zero | `0` | `machine/ts/spec/bmsx/io.ts:18,224` | `machine/cpp/spec/bmsx/io.h:30,237` |
| DMR07 | `0x080103e4` | `IO_DMA1_READ_ADDR` | R/W raw word | `0` | `machine/ts/spec/bmsx/io.ts:132,226` | `machine/cpp/spec/bmsx/io.h:145,239` |
| DMR08 | `0x080103e8` | `IO_DMA1_WRITE_ADDR` | R/W raw word | `0` | `machine/ts/spec/bmsx/io.ts:133,227` | `machine/cpp/spec/bmsx/io.h:146,240` |
| DMR09 | `0x080103ec` | `IO_DMA1_TRANSFER_COUNT` | R/W raw word | `0` | `machine/ts/spec/bmsx/io.ts:134,228` | `machine/cpp/spec/bmsx/io.h:147,241` |
| DMR10 | `0x080103f0` | `IO_DMA1_CONTROL` | R/W raw word | `0` | `machine/ts/spec/bmsx/io.ts:135,229` | `machine/cpp/spec/bmsx/io.h:148,242` |
| DMR11 | `0x080103f4` | `IO_DMA1_STATUS` | Read-only; mapped write faults | `0` | `machine/ts/spec/bmsx/io.ts:136,230` | `machine/cpp/spec/bmsx/io.h:149,243` |
| DMR12 | `0x080103f8` | `IO_DMA1_TRIGGER` | Command/read-zero | `0` | `machine/ts/spec/bmsx/io.ts:137,231` | `machine/cpp/spec/bmsx/io.h:150,244` |

**DMR13 — Register representation and reset.** A channel stores exactly five raw words: read address, write address, transfer count, control, status. TRIGGER has no channel-state field. Clearing sets all five words to zero. Mirroring writes those five words to the matching Memory slots and writes zero to TRIGGER. Controller reset calls the clear/mirror path, so all twelve mapped register words read zero afterward.

- TS: `machine/ts/machine/devices/dma/registers.ts:12-35,58-66`; `machine/ts/machine/devices/dma/controller.ts:203-209,340-347`.
- C++: `machine/cpp/machine/devices/dma/registers.h:12-24`; `machine/cpp/machine/devices/dma/registers.cpp:7-19`; `machine/cpp/machine/devices/dma/controller.cpp:133-138,264-271`.

**DMR14 — Programmed raw writes.** DMA installs write handlers for READ_ADDR, WRITE_ADDR, TRANSFER_COUNT, CONTROL and TRIGGER for each channel; it installs no DMA read handlers. Address callbacks assign the incoming word directly to the selected raw address field. Config callbacks assign the incoming word directly to CONTROL or TRANSFER_COUNT and then call arbitration. There is no busy rejection in these address/config handlers and no CONTROL masking on storage.

- TS: `machine/ts/machine/devices/dma/controller.ts:92-99,106-128`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:16-23,30-54`.

**DMR15 — Backing-slot order and readback.** A mapped aligned word write first passes the read-only test, then stores the word into the Memory I/O backing slot, then calls its write handler. TS converts to an unsigned word at this boundary; C++ receives `uint32_t`. Reads dispatch a read handler if present, otherwise return that backing slot. Because the DMA constructor maps no reads, normal DMA register readback is the backing-slot value, not an on-demand read of the controller's channel object. Owner `writeIoU32` updates the slot directly without invoking the mapped write callback.

- TS: `machine/ts/machine/memory/memory.ts:366-375,430-431,544-552,627-642`; DMA bindings: `machine/ts/machine/devices/dma/controller.ts:92-99`.
- C++: `machine/cpp/machine/memory/memory.cpp:245-258,320-321,434-442,522-536`; DMA bindings: `machine/cpp/machine/devices/dma/controller.cpp:16-23`.

**DMR16 — STATUS access and fields.** Both STATUS addresses are explicitly read-only. A mapped write raises `BUS_FAULT_READ_ONLY` and returns before slot storage or callback. `BUSY = 1 << 0`; `DONE = 1 << 1`. The controller's busy predicate tests only BUSY. Reading STATUS through the slot path does not clear it.

- TS: `machine/ts/machine/memory/memory.ts:627-632,852-866,891-893,366-368`; `machine/ts/spec/bmsx/io.ts:395-396`; `machine/ts/machine/devices/dma/controller.ts:517-518`.
- C++: `machine/cpp/machine/memory/memory.cpp:522-527,729-743,768-770,245-250`; `machine/cpp/spec/bmsx/io.h:408-409`; `machine/cpp/machine/devices/dma/controller.cpp:442-443`.

**DMR17 — TRIGGER/START write semantics.** START is bit 0 of TRIGGER, not a separate register. On every delivered TRIGGER callback, the controller first writes zero to its backing slot. If START is clear or the channel is busy, it returns. Thus other written bits alone do not start anything, and START while busy is ignored rather than queued/restarted. An accepted START replaces STATUS with exactly BUSY in both owner state and slot. If the programmed count is zero it immediately finishes the channel, then invokes arbitration. The immediate finish is independent of the request-selector readiness test.

- TS: `machine/ts/spec/bmsx/io.ts:397`; `machine/ts/machine/devices/dma/controller.ts:131-143,365-370`.
- C++: `machine/cpp/spec/bmsx/io.h:410`; `machine/cpp/machine/devices/dma/controller.cpp:62-73,289-294`.

**DMR18 — Completion STATUS/IRQ effect.** Finish replaces STATUS with exactly DONE (therefore clears BUSY) in both owner state and the backing slot, and raises the channel's completion IRQ: DMA0 uses `IRQ_DMA0_DONE = 1 << 0`; DMA1 uses `IRQ_DMA1_DONE = 1 << 8`. This is not a STATUS write-to-clear interface. An accepted later START replaces DONE with BUSY per DMR17; reset clears it per DMR13.

- TS: `machine/ts/machine/devices/dma/controller.ts:365-370`; `machine/ts/spec/bmsx/io.ts:362,370`; STATUS rejection: `machine/ts/machine/memory/memory.ts:627-632,865-866`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:289-294`; `machine/cpp/spec/bmsx/io.h:375,383`; STATUS rejection: `machine/cpp/machine/memory/memory.cpp:522-527,742-743`.

## CONTROL fields and encodings

**DMR19 — Defined CONTROL fields.** The scoped spec masks and live datapath decoding establish:

| Bits | Mask | Name | Decode |
|---|---|---|---|
| 0 | `0x00000001` | READ_INCREMENT | 0 => read step 0; 1 => read step `IO_WORD_SIZE` (4 bytes) |
| 1 | `0x00000002` | WRITE_INCREMENT | 0 => write step 0; 1 => write step `IO_WORD_SIZE` (4 bytes) |
| 5:2 | `0x0000003c` | READ_REQUEST | Four-bit selector, shift 2 |
| 9:6 | `0x000003c0` | WRITE_REQUEST | Four-bit selector, shift 6 |
| 13:10 | `0x00003c00` | BLOCK_WORDS | Four-bit value plus 1 => programmed block length 1..16 words; actual admission takes min(remaining count, programmed block length) |

- TS: `machine/ts/spec/bmsx/io.ts:374-382`; `machine/ts/machine/devices/dma/controller.ts:220-223,412-419`.
- C++: `machine/cpp/spec/bmsx/io.h:387-395`; `machine/cpp/machine/devices/dma/controller.cpp:150-153,336-343`.

**DMR20 — Full CONTROL word is retained.** The setter stores the complete incoming word; the admission snapshot also copies the complete control word. The decoder consumes the masks listed in DMR19. Bits 31:14 remain stored/readable as part of the raw word; no meaning is assigned to them here. They are not cleared on CONTROL write or admission. The named `DMA_CONTROL_BLOCK_WORDS_16` constant is the value `0xf << 10`.

- TS: `machine/ts/machine/devices/dma/controller.ts:120-128,412-419,463-468,220-223,487-491`; `machine/ts/spec/bmsx/io.ts:374-382`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:45-54,336-343,387-392,150-153,412-416`; `machine/cpp/spec/bmsx/io.h:387-395`.

**DMR21 — Named request selector encodings.** Both read and write selector fields use these same numeric constants:

| Encoding | Exact constant |
|---|---|
| 0 | `DMA_REQUEST_FORCE` |
| 1 | `DMA_REQUEST_GX_WRITE` |
| 2 | `DMA_REQUEST_GX_READ` |
| 3 | `DMA_REQUEST_APU_WRITE` |
| 4 | `DMA_REQUEST_APU_READ` |
| 5 | `DMA_REQUEST_IMGDEC_WRITE` |
| 6 | `DMA_REQUEST_IMGDEC_READ` |
| 7 | `DMA_REQUEST_CARTRIDGE_SLOT0_WRITE` |
| 8 | `DMA_REQUEST_CARTRIDGE_SLOT0_READ` |
| 9 | `DMA_REQUEST_CARTRIDGE_SLOT1_WRITE` |
| 10 | `DMA_REQUEST_CARTRIDGE_SLOT1_READ` |
| 15 | `DMA_REQUEST_DISABLED` |

- TS: `machine/ts/spec/bmsx/io.ts:383-394`; field decode: `machine/ts/machine/devices/dma/controller.ts:487-491`.
- C++: `machine/cpp/spec/bmsx/io.h:396-407`; field decode: `machine/cpp/machine/devices/dma/controller.cpp:412-416`.

**DMR22 — Selector decision rule, including unnamed values.** Admission requires both selected requests to be asserted. FORCE returns true; DISABLED returns false; every other selector is tested as bit `1 << selector` in the controller's request-lines word. Thus 11..14 have the generic bit-test behavior, not an inferred disabled/reserved behavior. The scoped spec assigns them no named constants. No claim is made here about external producers of request-line bits 11..14.

- TS: `machine/ts/machine/devices/dma/controller.ts:487-501`; named constants: `machine/ts/spec/bmsx/io.ts:383-394`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:412-426`; named constants: `machine/cpp/spec/bmsx/io.h:396-407`.

## Programmed state versus admitted block and visible effects

**DMR23 — Distinct programmed registerfile and admitted snapshot.** On admission the controller copies channel READ_ADDR, WRITE_ADDR, TRANSFER_COUNT and the full CONTROL word into `scheduled*` fields and records block word count/active channel/deadline. Service reads those scheduled fields, not current programmed fields. Arbitration returns without admitting a replacement while a block is active or service is running. Consequently a raw address/count/control write can be visible in its backing slot immediately (DMR15) without changing the already admitted block.

- TS: `machine/ts/machine/devices/dma/controller.ts:106-128,211-223,386-388,412-417,463-470`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:30-54,141-153,310-312,336-341,387-394`.

**DMR24 — Completion writeback visibility.** The service loop transfers its admitted words first. After the loop, it writes the computed read address, write address and remaining count into the programmed channel fields and their three backing slots. It does not write CONTROL back. Therefore writes to those address/count words after admission can be overwritten by this block's snapshot-derived completion writeback; a changed programmed CONTROL remains for later admission. The service then clears the admitted block, finishes if the resulting count is zero, and arbitrates. There is no per-word update of those three DMA readback slots inside this loop.

- TS: `machine/ts/machine/devices/dma/controller.ts:211-253`; next admission uses programmed CONTROL: `machine/ts/machine/devices/dma/controller.ts:412-417`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:141-183`; next admission uses programmed CONTROL: `machine/cpp/machine/devices/dma/controller.cpp:336-341`.

**DMR25 — Reset includes internal live/parked state.** In addition to clearing/mirroring visible registers, reset cancels DMA service, clears admitted fields and deadline, sets next channel to 0, serviceActive/restorePending false, request lines to 0, both supervisor-quiesce flags false, and clears parked user channel words/userNextChannel. Active-channel sentinel is the channel count (2). Timing configuration is not modified by this reset path.

- TS: `machine/ts/machine/devices/dma/controller.ts:45,203-209,340-362` (timing members at `64-68`).
- C++: `machine/cpp/machine/devices/dma/controller.cpp:133-138,264-286` (timing members at `machine/cpp/machine/devices/dma/controller.h:75-79`).

## Internal capture/restore shape — not a guest register or serialized ABI

**DMR26 — Capture object fields.** `DmaControllerState` declares `channels`, `activeChannel`, `nextChannel`, `scheduledBlockWords`, `scheduledBlockCycles`, `scheduledReadAddressWord`, `scheduledWriteAddressWord`, `scheduledTransferCountWord`, `scheduledControlWord`, `supervisorQuiesceRequested`, `supervisorAdmissionQuiesceRequested`, `userChannels`, `userNextChannel`. Each of the two channel arrays contains the five raw fields listed in DMR13. In C++, raw register/address/count/control fields are `u32`, remaining scheduled cycles is `i64`, and supervisor flags are bool; TS uses number/boolean. This is the in-memory controller state shape only; field ordering/byte layout/encoding in a serialized save file was not inspected and must not be inferred.

- TS: `machine/ts/machine/devices/dma/controller.ts:47-61`; `machine/ts/machine/devices/dma/registers.ts:12-20`.
- C++: `machine/cpp/machine/devices/dma/controller.h:16-30`; `machine/cpp/machine/devices/dma/registers.h:12-20`.

**DMR27 — Capture/restore behavior.** Capture copies both live and parked channel states and the scheduled snapshot. `scheduledBlockCycles` is zero for no scheduled words, otherwise `serviceDeadline - currentNowCycles`. Restore cancels the scheduled DMA service, restores/mirrors the raw registerfile (which also zeros TRIGGER), restores snapshot/parked/control fields, reconstructs deadline as supplied `nowCycles + scheduledBlockCycles`, sets serviceActive false and restorePending true. `postLoad` clears restorePending, schedules the existing active block at that deadline, or arbitrates if no active block. These facts describe the owner methods, not a complete save-file pipeline.

- TS: `machine/ts/machine/devices/dma/controller.ts:256-302`; raw copy/mirror: `machine/ts/machine/devices/dma/registers.ts:39-66`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:186-232`; mirror: `machine/cpp/machine/devices/dma/registers.cpp:11-19`.

## Deliberate scope gaps / handoff

- Transfer timing, bus fault propagation, physical request producers, CPU blocking/port ownership and supervisor-system callsites belong to the other scoped extraction sheets; this sheet does not establish them.
- The trigger readiness callback is present, but CPU write-stall behavior is not inferred from the DMA callback alone. The callback's precise paired source is `machine/ts/machine/devices/dma/controller.ts:98,102-103` / `machine/cpp/machine/devices/dma/controller.cpp:22,26-27`.
- No foreign hardware semantics, unnamed-bit meanings, missing feature expectations, or serialized ABI were inferred. No runtime changes or tests were performed for this extraction.


---

# DMA transfer, arbitration, and timing facts (DMT)

Live audit: `master`, `7b9a24334`, 2026-10-17. Read-only extraction; no implementation, no architecture.md, no PDFs. Each fact below is paired against the live TypeScript and C++ owner. No owner/spec/mirror disagreement was found within this scope. MMIO backing-slot visibility and STATUS/TRIGGER access rules belong to the separate DMR fact sheet; the statements below about programming writes describe the DMA callbacks, not an independently inferred Memory policy.

## Public transfer behavior

### DMT01 — Raw channel registerfile versus admitted-block latches

The channel owner holds raw read-address, write-address, transfer-count, control, and status words. A distinct admitted-block state holds channel, block length, captured read/write/count/control words, and deadline. It is incorrect to equate a newly programmed/read-back register word with the value already captured for an admitted block. Register mirroring writes the raw channel words, and writes TRIGGER as zero.

- TS: `machine/ts/machine/devices/dma/registers.ts:12-25,58-66`; `machine/ts/machine/devices/dma/controller.ts:69-76,463-470`.
- C++: `machine/cpp/machine/devices/dma/registers.h:12-20`; `machine/cpp/machine/devices/dma/registers.cpp:11-19`; `machine/cpp/machine/devices/dma/controller.h:80-87`; `machine/cpp/machine/devices/dma/controller.cpp:387-394`.

### DMT02 — Two channels; start and busy behavior

There are two channels. A TRIGGER callback first clears the corresponding trigger backing slot to zero. If START bit 0 is absent, or the channel is already BUSY, it returns without starting/restarting that channel. Otherwise it replaces status with BUSY (not BUSY OR old status), mirrors BUSY, completes immediately if count is zero, and then arbitrates. BUSY is status bit 0; DONE is status bit 1.

- TS: `machine/ts/spec/bmsx/io.ts:10-11,395-397`; `machine/ts/machine/devices/dma/controller.ts:131-143,517-519`.
- C++: `machine/cpp/spec/bmsx/io.h:22-23,408-410`; `machine/cpp/machine/devices/dma/controller.cpp:62-73,442-444`.

### DMT03 — Both request selectors must be asserted

CONTROL read-request bits 2..5 and write-request bits 6..9 are independently decoded. Admission requires **read-request asserted AND write-request asserted**. Selector 0 (FORCE) is always asserted; selector 15 (DISABLED) is never asserted; every other representable selector tests its corresponding bit in the request-line mask. Thus unassigned selectors 11..14 are not collapsed to FORCE/DISABLED by this owner. A changed request-line mask immediately invokes arbitration at scheduler current time; an unchanged mask does nothing. This does not preempt an admitted block.

- TS: `machine/ts/spec/bmsx/io.ts:376-394`; `machine/ts/machine/devices/dma/controller.ts:171-177,386-388,487-502`.
- C++: `machine/cpp/spec/bmsx/io.h:389-407`; `machine/cpp/machine/devices/dma/controller.cpp:101-107,310-312,412-426`.

### DMT04 — Request selector assignments

Selectors: FORCE 0; GX_WRITE 1; GX_READ 2; APU_WRITE 3; APU_READ 4; IMGDEC_WRITE 5; IMGDEC_READ 6; CARTRIDGE_SLOT0_WRITE 7; CARTRIDGE_SLOT0_READ 8; CARTRIDGE_SLOT1_WRITE 9; CARTRIDGE_SLOT1_READ 10; DISABLED 15. Device-specific request production is outside this controller audit.

- TS: `machine/ts/spec/bmsx/io.ts:383-394`.
- C++: `machine/cpp/spec/bmsx/io.h:396-407`.

### DMT05 — Block size is 1..16 words; final block truncates

CONTROL bits 10..13 encode programmed block words minus one. At admission, actual block length is `min(remaining transferCountWord, programmedBlockWords)`. Arbitration handles a busy zero-count channel as completion before testing requests, so ordinary admission has a nonzero length. Addresses are not used to shrink a block at mapped-region boundaries; those boundaries split timing spans only.

- TS: `machine/ts/spec/bmsx/io.ts:380-382`; `machine/ts/machine/devices/dma/controller.ts:399-405,412-429`.
- C++: `machine/cpp/spec/bmsx/io.h:393-395`; `machine/cpp/machine/devices/dma/controller.cpp:323-328,336-353`.

### DMT06 — Admission captures full transfer inputs and deadline

Admission captures the current raw read address, write address, full remaining count, and complete control word, as well as actual block words. It calculates a block-cycle cost and schedules DMA service at `anchorCycle + blockCycles`. There are no per-word scheduler services in this implementation: the complete admitted block is executed by one service callback.

- TS: `machine/ts/machine/devices/dma/controller.ts:412-470,211-236`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:336-394,141-166`.

### DMT07 — Block service ordering and unsigned wrap

At service, each slot performs mapped DMA **read, then mapped DMA write of that word, then read-address update, then write-address update, then count decrement**. CONTROL bit 0 enables source increment and bit 1 enables destination increment; each enabled step is four bytes, otherwise zero. Address additions and count decrement are unsigned 32-bit wrapping operations (`>>> 0` in TS; `u32` arithmetic in C++). The block loop uses captured words, not the currently programmed channel words. After the entire loop, the controller commits read address, write address, and remaining count to its registerfile and mirrors all three to I/O.

- TS: `machine/ts/spec/bmsx/io.ts:374-375`; `machine/ts/spec/bmsx/memory_map.ts:1,23`; `machine/ts/machine/devices/dma/controller.ts:211-243`.
- C++: `machine/cpp/spec/bmsx/io.h:387-388`; `machine/cpp/spec/bmsx/memory_map.h:7,29`; `machine/cpp/machine/devices/dma/controller.cpp:141-173`.

### DMT08 — DMA bus signals and cartridge slot binding

Both mapped accesses identify the DMA master. Each access independently derives cartridge-slot signals from its captured request selector: slot-0 read/write selectors select slot 0; slot-1 read/write selectors select slot 1; all other selectors add no slot signal. The last read AND last write in the admitted block each carry DMA_BLOCK_END. These are transfer/access signals, not proof of a particular electrical bus rate.

- TS: `machine/ts/machine/devices/dma/controller.ts:222-232,504-514`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:152-162,429-439`.

### DMT09 — Programming writes while busy

The address and configuration callbacks do not reject BUSY writes: address writes replace the channel's raw address word; control/count writes replace their raw word and request arbitration at current scheduler time. An already admitted block is not recomputed/preempted. Consequently, writes to that active channel's address/count before its service are overwritten by the eventual post-block captured-state results; a control write is not overwritten by service and can affect a later admission. While a busy channel has no admitted block, newly written address/control/count values are the values available to subsequent arbitration; in particular writing count zero can complete it during arbitration even if request gates are false. A START while BUSY is ignored after trigger clear.

- TS: `machine/ts/machine/devices/dma/controller.ts:106-143,237-243,386-405,463-469`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:30-73,167-173,310-328,387-393`.

### DMT10 — Nonpreemption and round-robin selection

There is one admitted block across both channels. Arbitration returns while a block is active or its service loop is executing (and during internal restore deferral). Otherwise it scans exactly two channels beginning at `nextChannel`, modulo two. It skips non-BUSY channels; finishes and skips zero-count BUSY channels; admits the first remaining BUSY channel whose two request gates are true; then sets `nextChannel = (admittedChannel + 1) % 2`. The turn advances on admission, not on completion or a skipped gate. Initialization and live-transfer reset set nextChannel to 0. This is block-level round-robin among eligible channels, not word interleaving, fixed priority, or preemption on a new request.

- TS: `machine/ts/machine/devices/dma/controller.ts:69-70,340-347,386-409`.
- C++: `machine/cpp/machine/devices/dma/controller.h:80-81`; `machine/cpp/machine/devices/dma/controller.cpp:264-271,310-333`.

### DMT11 — Deadline anchoring

Start, configuration writes, and changed request lines arbitrate using scheduler current time. At the end of a block service, the next arbitration is anchored to the **previous block's stored service deadline**, not the callback's argument or a fresh current-time read. Therefore a continuously eligible next block chains from the previous scheduled edge. The callback saves that deadline before clearing its admitted state. No statement about electrical clock domains or bus stalls follows from this bookkeeping.

- TS: `machine/ts/machine/devices/dma/controller.ts:128,143,177,211,226-227,245-253,469-470`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:54,73,107,141,156-157,175-183,393-394`.

### DMT12 — Completion and IRQ order

`finishChannel` replaces status with DONE, mirrors DONE, **then raises** the channel's completion IRQ, then attempts release of relevant stalled CPU writes. Channel 0 completion uses IRQ bit 0; channel 1 uses IRQ bit 8. Zero-count START first publishes BUSY, then immediately runs that DONE/IRQ sequence, without admitting a transfer block. At ordinary block completion the final address/count mirrors happen first, service-active is cleared and the admitted block is cleared, released old ports are checked, and only then does count-zero completion publish DONE and raise IRQ; next arbitration follows. There is no per-channel IRQ-enable bit decoded by the DMA controller.

- TS: `machine/ts/spec/bmsx/io.ts:362,370,374-397`; `machine/ts/machine/devices/dma/controller.ts:134-143,237-253,365-374`.
- C++: `machine/cpp/spec/bmsx/io.h:375,383,387-410`; `machine/cpp/machine/devices/dma/controller.cpp:63-73,167-183,289-298`.

## Installed timing model

### DMT13 — Actual installed costs, not constructor placeholders

The paired installed `PSX_MACHINE_SPEC` has CPU frequency **33,868,800 Hz**, DMA RAM cost 1 cycle/word plus setup 1, system ROM 1 cycle/word, and cartridge region 8 cycles/word plus setup 4. Machine construction passes those five model costs into DMA `setTiming` with scheduler current time. DMA's field initializers (notably RAM setup 0 and cartridge cost/setup 0) are not the installed PSX costs. The constructor accepts a MachineModelSpec, so these numerical values describe the paired PSX model, not an invented invariant for arbitrary alternative model objects.

- TS: `machine/ts/spec/bmsx/model.ts:7-12,27-33,46-52`; `machine/ts/machine/machine.ts:52-55,98-105`; placeholder contrast: `machine/ts/machine/devices/dma/controller.ts:64-68`.
- C++: `machine/cpp/spec/bmsx/model.h:12-17,32-38,51-57`; `machine/cpp/machine/machine.cpp:7-10,41-48`; placeholder contrast: `machine/cpp/machine/devices/dma/controller.h:75-79`.

### DMT14 — Installed per-span cycle formulas

For a span of `n` words, the installed PSX formulas are RAM `n + (regionStart ? 1 : 0)`; system ROM `n`; cartridge `8*n + (regionStart ? 4 : 0)`; I/O and Other `0`. The cartridge formula applies to MemoryRegionKind.Cartridge, not solely a successfully readable physical ROM. Its classified aperture includes cartridge ROM/RAM/MMIO subregions. The controller sums the resulting timing spans and raises a total zero-cycle block to **one cycle**; it does not impose one cycle separately on every I/O/Other word or span.

- TS: `machine/ts/spec/bmsx/model.ts:8-12`; `machine/ts/machine/devices/dma/controller.ts:434-461,473-483`; `machine/ts/machine/memory/memory.ts:725-750`.
- C++: `machine/cpp/spec/bmsx/model.h:13-17`; `machine/cpp/machine/devices/dma/controller.cpp:358-385,397-407`; `machine/cpp/machine/memory/memory.cpp:642-667`.

### DMT15 — Shared bus sums; otherwise overlapping maximum

For each paired source/destination timing span, if both ends have the same region kind AND it is RAM or Cartridge, the contribution is `readCycles + writeCycles`. Otherwise contribution is `max(readCycles, writeCycles)`. Thus RAM-to-RAM and Cartridge-to-Cartridge sum; SystemRom-to-SystemRom uses maximum, not sum; cross-region transfers use maximum. The rule compares region kind, not equality of addresses or cartridge slot selection. For spans without crossings under the installed model: RAM→RAM `2*n + 2`; Cart→Cart `16*n + 8`; RAM↔Cart `max(n+1,8*n+4)`; ROM↔RAM `max(n,n+1)`; ROM↔Cart `max(n,8*n+4)`; ROM→ROM `n`; RAM↔I/O `n+1`; Cart↔I/O `8*n+4`; I/O↔I/O costs one total block cycle. These are formula substitutions, not measured electrical rates.

- TS: `machine/ts/machine/devices/dma/controller.ts:434-441,460-483`; installed numbers `machine/ts/spec/bmsx/model.ts:8-12`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:358-365,384-407`; installed numbers `machine/cpp/spec/bmsx/model.h:13-17`.

### DMT16 — Setup belongs to each endpoint's region start

Both endpoint regionStart flags begin true on every admission, so each setup-bearing endpoint incurs setup at block start. Timing spans are split at whichever endpoint boundary comes first. Splitting because only the opposite endpoint reached a boundary does not repeat setup for the continuing endpoint. A particular endpoint incurs setup again only when its own region span is exhausted and its mapping is recomputed. Fixed/nonincrementing endpoints assign the entire block as their initial region span. Therefore fixed RAM/Cartridge endpoints still incur one setup at block start, not one setup per repeated address access.

- TS: `machine/ts/machine/devices/dma/controller.ts:418-457,473-480`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:342-381,397-404`.

### DMT17 — Exact mapping/crossing boundary helpers

The timing classifier checks a full four-byte I/O range first; then system ROM versus Other below RAM_BASE; installed RAM range versus Other below CART_ROM_BASE; and cartridge aperture versus Other above it. Incrementing endpoints use the helper's remaining-word span, capped at block remainder. System ROM, installed RAM, and I/O each use their own end. Cartridge spans separately terminate at CART_ROM_END, CART_RAM_END, or CART_MMIO_END; the endpoint's setup resets at those boundaries even though all three classify as Cartridge. Other spans advance to the next listed mapping boundary, ultimately the 2^32 wrap boundary. Word span is the rounded-up count of word starts before that boundary (integer `(boundary - address + 3)/4`), limited by requested words. Both timing prediction and actual service address updates wrap at 32 bits. These helpers determine timing; mapped read/write fault/data behavior is a separate Memory-owner fact.

- TS: `machine/ts/machine/memory/memory.ts:725-774`; `machine/ts/machine/devices/dma/controller.ts:424-457,233-235`.
- C++: `machine/cpp/machine/memory/memory.cpp:642-692`; `machine/cpp/machine/devices/dma/controller.cpp:348-381,163-165`.

### DMT18 — setTiming preserves an admitted block

An unchanged timing tuple does nothing. A changed tuple replaces the five stored costs; if no block is active it immediately arbitrates at the supplied time, otherwise it does not recalculate that block's latched deadline. The ordinary Machine refreshDeviceTimings path does not call DMA setTiming; the live paired Machine callsite is construction with the model values.

- TS: `machine/ts/machine/devices/dma/controller.ts:146-168`; `machine/ts/machine/machine.ts:98-105,122-126`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:76-98`; `machine/cpp/machine/machine.cpp:41-48,65-69`.

### DMT19 — Unknown electrical rates omitted

The scoped model supplies a CPU frequency and emulated DMA cycle costs, not independent SDRAM, system-ROM, cartridge-bus, or I/O electrical clock-frequency declarations. No such MHz values, bus widths beyond the four-byte word access contract, sustainable bandwidth, or real-time throughput guarantees are inferred here. Derived cycle-formula examples above are explicitly not those claims.

- TS evidence boundary: `machine/ts/spec/bmsx/model.ts:7-12,27-38`; `machine/ts/machine/devices/dma/controller.ts:146-152,473-483`.
- C++ evidence boundary: `machine/cpp/spec/bmsx/model.h:12-17,32-42`; `machine/cpp/machine/devices/dma/controller.cpp:76-82,397-407`.

## Internal/editorial facts — do not present as new guest registers or a transaction API

### DMT20 — Port ownership and stalled CPU write release (controller boundary only)

For each BUSY channel the controller compares a queried address against that channel's read/write address. For the active admitted channel those queries return the captured scheduled base address, not a mid-block local address or newly programmed address; for other channels they return raw register addresses. `hasAdmittedWriteBlock(address)` is specifically active-channel existence AND captured write-base equality. Address programming can attempt to release a stalled CPU write; block service checks the previously captured base ports after clearing admission; completion checks ports after changing status. Resume occurs only if CPU reports a blocked write to the exact queried address and no BUSY channel owns it in either direction. This is the controller's ownership/release contract only: device-side readiness, which writes stall, and memory fault behavior require the separate owning-boundary audit.

- TS: `machine/ts/machine/devices/dma/controller.ts:106-117,180-200,216-217,244-248,365-382,521-530`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:30-42,110-130,146-147,174-178,289-306,446-455`.

### DMT21 — Supervisor quiesce is internal admission/control state

Trigger readiness is false while supervisor control quiesce is requested. Control-only quiesce sets that flag; full quiesce additionally forbids new block admission. An admitted block is not cancelled by these requests. Full quiescence means admission quiesce requested, no active channel, and no service loop active. Its boundary notification schedules the internal system service at scheduler current time. Supervisor entry preserves user registerfile/round-robin turn then clears live DMA; leaving clears live DMA, restores/mirrors user words and turn, clears the preserved user context, then arbitrates at current time. These are internal machine/supervisor mechanisms, not guest DMA CONTROL bits.

- TS: `machine/ts/machine/devices/dma/controller.ts:98,102-104,305-337,386-393,533-535`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:22,26-27,235-261,310-316,458-460`; `machine/cpp/machine/devices/dma/controller.h:48`.

### DMT22 — Save-state carries admitted state separately

Capture saves raw channel words, active/next channel, admitted length and captured read/write/count/control words, remaining deadline offset (zero when no scheduled block), quiesce flags, and saved user context. Restore cancels service, restores/mirrors raw words, restores admitted state, rebases deadline to `now + saved offset`, clears service-active and defers arbitration via restorePending. PostLoad clears deferral and either schedules the restored active block at its restored deadline or arbitrates at current time. Request-line assertion state is not in the controller's captured state shown here; do not infer postload request production from this sheet.

- TS: `machine/ts/machine/devices/dma/controller.ts:47-60,256-302`.
- C++: `machine/cpp/machine/devices/dma/controller.h:16-29`; `machine/cpp/machine/devices/dma/controller.cpp:186-232`.

### DMT23 — Reset state

Reset cancels live DMA service, clears admission/deadline, resets next turn to channel 0, clears service-active/restore deferral, clears/mirrors both raw channels, clears request lines and quiesce flags, and clears saved user context. It does not reset the installed timing tuple to constructor placeholder values.

- TS: `machine/ts/machine/devices/dma/controller.ts:203-208,340-362`.
- C++: `machine/cpp/machine/devices/dma/controller.cpp:133-138,264-286`.

## Scope/acceptance notes

- No runtime edits, no proposed architecture, no chapter prose, no BIOS claim.
- No tests run: this deliverable is exact owner/spec/mirror extraction, not dynamic proof.
- No production-reference study was required because nothing was implemented.
- Confirm guest MMIO read/write visibility and access permissions through the DMR sheet rather than promoting callback behavior into a generic Memory claim.


---

# BMSX installed Book I DMA — port, request, access and fault facts

Source-extraction fact sheet, not a chapter draft. Scope: the paired current DMA owners/register leaves, common mapped-memory access and CPU stalled-store owners, and only the GX/APU/IMGDEC request/readiness datapaths needed below. No architecture document, reference PDF, implementation, repo edit, test or commit. Selectors 7–10 are named only; no Book II cartridge protocol audit. No real spec/owner or TS/C++ disagreement was found in this bounded surface. “No disagreement” is not a whole-device or electrical-conformance claim.

All source paths below are relative to `/home/boaz/BMSX`. Every DMP fact carries paired TS/C++ current-source evidence. Previously frozen GPU/PCRTC facts are identified explicitly where reused.

## Selector and admission contract

| ID | Fact | TypeScript evidence | C++ evidence |
|---|---|---|---|
| DMP01 | Each CONTROL word has independent 4-bit read-request bits 5..2 and write-request bits 9..6. Read increment is bit 0, write increment bit 1; block-length field bits 13..10 encodes words minus one (1..16). The controller tests **both selected request lines** before admitting a block. Selectors are not inferred from endpoint addresses. | `machine/ts/spec/bmsx/io.ts:374-394`; `machine/ts/machine/devices/dma/controller.ts:412-419,487-502` | `machine/cpp/spec/bmsx/io.h:387-407`; `machine/cpp/machine/devices/dma/controller.cpp:336-343,412-427` |
| DMP02 | FORCE selector 0 always tests asserted; DISABLED selector 15 always tests deasserted. Every other selector, including unnamed 11..14, executes `(requestLines & (1 << selector)) != 0`. The current constant leaves name no 11..14 meaning. Do **not** call 11..14 hardwired zero, alias them to DISABLED, or invent a producer. | `machine/ts/spec/bmsx/io.ts:383-394`; `machine/ts/machine/devices/dma/controller.ts:494-502` | `machine/cpp/spec/bmsx/io.h:396-407`; `machine/cpp/machine/devices/dma/controller.cpp:419-427` |
| DMP03 | The named selectors are GX_WRITE=1, GX_READ=2, APU_WRITE=3, APU_READ=4, IMGDEC_WRITE=5, IMGDEC_READ=6, slot0 write/read=7/8, slot1 write/read=9/10. `setRequestLines(mask, asserted)` replaces only masked latch bits, preserving all others; a changed result reruns arbitration. Reset sets requestLines to zero. | `machine/ts/spec/bmsx/io.ts:383-394`; `machine/ts/machine/devices/dma/controller.ts:171-178,203-209` | `machine/cpp/spec/bmsx/io.h:396-407`; `machine/cpp/machine/devices/dma/controller.cpp:101-108,133-139` |
| DMP04 | Admission snapshots source address, destination address, remaining count and the complete CONTROL word. The programmed block is capped at remaining words. Service uses those captured values, including the separate request selectors decoded from captured CONTROL; later live CONTROL/address writes do not replace that admitted block's captured endpoints/selectors/count. | `machine/ts/machine/devices/dma/controller.ts:412-419,463-470,211-225` | `machine/cpp/machine/devices/dma/controller.cpp:336-343,387-394,141-155` |
| DMP05 | At service, each slot performs one mapped 32-bit little-endian source read followed by one mapped 32-bit little-endian destination write, then advances each enabled address by 4 and decrements remaining count, with unsigned 32-bit wrap. Both sides carry DMA-master; BLOCK_END is set on **only the last word of that admitted block**, not only at channel completion and not on every word. Source and destination carry independently derived cartridge-slot strobes when their captured selector is 7..10; no cartridge protocol behavior is established here. | `machine/ts/machine/devices/dma/controller.ts:211-243,504-515`; `machine/ts/machine/memory/bus_signals.ts:1-14` | `machine/cpp/machine/devices/dma/controller.cpp:141-173,429-440`; `machine/cpp/machine/memory/bus_signals.h:7-22` |
| DMP06 | Request-line gating occurs when a block is admitted, not again between its individual words. During service, request changes can call arbitration, but `serviceActive`/active-channel guards prevent a new admission. The current block continues through its captured number of slots even if its request deasserts during a port read/write. This is block admission, not an agreement that every arbitrary FORCE transfer is semantically valid at its chosen port. | `machine/ts/machine/devices/dma/controller.ts:171-178,229-236,386-407` | `machine/cpp/machine/devices/dma/controller.cpp:101-108,159-166,310-331` |

## Actual request producers 1..6

| ID | Fact | TypeScript evidence | C++ evidence |
|---|---|---|---|
| DMP07 | GX_WRITE (1) asserts only for GPU direction FIFO or CPU_TO_GP0 when the GPU direction-selected DMA request is nonzero. FIFO mode requires ingress not supervisor-stopped, separate DMA ingress empty and physical GP0 FIFO count below capacity. CPU_TO_GP0 requires the packet-acceptance bit described in DMP08. Direction GPUREAD_TO_CPU uses read-ready for GPUSTAT's direction-selected request but does not assert GX_WRITE. | `machine/ts/machine/devices/gx/gpu.ts:1930-1962` | `machine/cpp/machine/devices/gx/gpu.cpp:1407-1437` |
| DMP08 | The GPU CPU_TO_GP0 packet-acceptance bit requires readback IDLE, ingress not stopped and DMA ingress empty. With image-load words outstanding it tests command FIFO space; during polyline payload it is false; with no partial fixed packet and an empty FIFO it is true. Otherwise it requires a non-polygon/non-line packet with accumulated words below that packet's target. This can differ from one-word CPU write readiness. | `machine/ts/machine/devices/gx/gpu.ts:1878-1901` | `machine/cpp/machine/devices/gx/gpu.cpp:1356-1378` |
| DMP09 | GX_READ (2) asserts iff the readback port has DMA read enabled and its phase is READY. The DMA read enable is changed on transitions into/out of GPUREAD_TO_CPU direction. A submitted readback becoming READY updates the request; consuming the last packed readback word changes the phase to IDLE and updates the request. | `machine/ts/machine/devices/gx/gpu_command_buffer.ts:155-193`; `machine/ts/machine/devices/gx/gpu.ts:1862-1875` | `machine/cpp/machine/devices/gx/gpu_command_buffer.h:88-127,157-160`; `machine/cpp/machine/devices/gx/gpu.cpp:1340-1353` |
| DMP10 | APU_WRITE (3) asserts iff transfer mode is DMA_WRITE and its transfer FIFO is empty. APU_READ (4) asserts iff mode is DMA_READ and that FIFO is full (capacity 16 words). They describe APU transfer-FIFO batch readiness, not DMA channel completion or completion of sample-RAM draining/filling. | `machine/ts/machine/devices/audio/sample_transfer.ts:261-266,201-236`; `machine/ts/spec/audio/apu.ts:9` | `machine/cpp/machine/devices/audio/sample_transfer.cpp:244-248,195-235`; `machine/cpp/spec/audio/apu.h:13` |
| DMP11 | IMGDEC_WRITE (5) asserts iff not supervisor-quiescing, active, unsigned input remaining is nonzero, and input FIFO free space is at least `min(inputRemaining,16)`. IMGDEC_READ (6) uses the same not-quiescing/active/nonzero conditions for unsigned output remaining and requires output FIFO count at least `min(outputRemaining,16)`. These use the IMGDEC stream's own remaining values, not the DMA channel's count/block field. | `machine/ts/machine/devices/imgdec/controller.ts:486-498`; `machine/ts/spec/imgdec/registers.ts:11` | `machine/cpp/machine/devices/imgdec/controller.cpp:391-403`; `machine/cpp/spec/imgdec/registers.h:19` |

## Port ownership versus admitted-block readiness/data

| ID | Fact | TypeScript evidence | C++ evidence |
|---|---|---|---|
| DMP12 | `ownsReadPort(A)`/`ownsWritePort(A)` means any BUSY channel has an **exactly equal raw address A** on that side. For the admitted channel the comparison uses its captured starting endpoint; for another BUSY channel it uses the live programmed endpoint. It is not a range hold, alignment alias, decoded device identity, request-assertion test, or incremented per-slot cursor. A BUSY channel waiting for DREQ can therefore own its configured exact port. `hasAdmittedWriteBlock(A)` is narrower: an active admitted block with captured write address exactly A. | `machine/ts/machine/devices/dma/controller.ts:180-201,517-531` | `machine/cpp/machine/devices/dma/controller.cpp:110-131,442-456` |
| DMP13 | GP0 CPU write readiness synchronizes due GPU work and requires not stopped, DMA ingress empty, physical command FIFO room and no DMA write-port owner. GP0 **DMA** write readiness tests only not stopped; the GPU stages DMA words in its separate ingress FIFO and runs its normal timing/pipeline on BLOCK_END. Thus CPU one-word admissibility, GX_WRITE packet DREQ, and DMA port write-ready are distinct contracts. | `machine/ts/machine/devices/gx/gpu.ts:2025-2034,1034-1059,1915-1922` | `machine/cpp/machine/devices/gx/gpu.cpp:1499-1508,551-576,1392-1399` |
| DMP14 | GP0 reads synchronize due GPU work and consume a READY readback word only for a DMA master or when DMA does not own GP0's read port. A CPU read while read-owned, or a read without READY data, returns the retained GPUREAD latch instead of consuming/forcing zero. DMA source reads have no generic read-ready callback; the device supplies its actual value. | `machine/ts/machine/devices/gx/gpu.ts:1019-1031`; `machine/ts/machine/memory/memory.ts:540-555` | `machine/cpp/machine/devices/gx/gpu.cpp:536-548`; `machine/cpp/machine/memory/memory.cpp:430-445` |
| DMP15 | APU transfer-data DMA write-ready is true. CPU write-ready requires **neither** read nor write DMA ownership of that exact transfer-data port. CPU reads return the APU data latch. DMA reads pop only when mode is DMA_READ and FIFO is nonempty, otherwise returning the retained data latch; DMA writes always change the latch but enqueue only in DMA_WRITE mode. A BLOCK_END read/write schedules the next APU batch within the relevant mode/data branch. Therefore DREQ is not a promise that FORCE in a different mode creates valid data or completes sample-RAM work. | `machine/ts/machine/devices/audio/service_clock.ts:152-182`; `machine/ts/machine/devices/audio/sample_transfer.ts:147-179` | `machine/cpp/machine/devices/audio/service_clock.cpp:45-82`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:118-150` |
| DMP16 | IMGDEC data DMA write-ready is true. CPU write-ready instead requires active, not quiescing, input words received below the programmed total, at least one free input FIFO word, and no DMA write-port owner. CPU reads while read-owned return the data latch; other reads pop only when output FIFO is nonempty, otherwise retaining the latch. DMA nonfinal words return before the end-of-block completion/decode/request-update path. DMA writes update the data latch, enqueue only if input FIFO not full, and increment words received; nonfinal DMA words defer decode/request update until BLOCK_END. Do not equate IMGDEC DREQ with CPU word readiness or invent a stall for every data-port read. | `machine/ts/machine/devices/imgdec/controller.ts:583-641` | `machine/cpp/machine/devices/imgdec/controller.cpp:491-544` |
| DMP17 | DMA release of a CPU store requires the CPU to be blocked at the **same exact address** and neither read nor write DMA ownership remaining there. The controller checks released initial endpoints after a block, endpoints at channel finish, and the currently blocked target after an address-register write. A ready-edge resume clears the blocked flag only when its exact raw target matches; it does not itself write a value to the port. | `machine/ts/machine/devices/dma/controller.ts:106-117,244-253,365-383`; `machine/ts/machine/cpu/cpu.ts:1647-1662` | `machine/cpp/machine/devices/dma/controller.cpp:30-42,174-183,289-307`; `machine/cpp/machine/cpu/cpu.cpp:2342-2353` |
| DMP18 | CPU scalar stores check mapped write-ready before executing the store. A refusal rewinds PC to the current instruction, records the exact blocked address and returns blocked, so the instruction can be retried after release. Multiword store instructions pre-scan their mapped word targets and block on the first not-ready word before starting that word sequence. This is the CPU stalled-store mechanism, not rollback after accepted port writes. | `machine/ts/machine/cpu/cpu.ts:1658-1662,3010-3025,3121-3129,3155-3170`; `machine/ts/machine/memory/memory.ts:261-282` | `machine/cpp/machine/cpu/cpu.cpp:2342-2347`; `machine/cpp/machine/cpu/cpu_dispatch.inl:579-618,646-685`; `machine/cpp/machine/memory/memory.cpp:181-201` |

## Common raw mapped-CPU access and register readback

| ID | Fact | TypeScript evidence | C++ evidence |
|---|---|---|---|
| DMP19 | Common aligned I/O reads call the registered read handler when one exists; otherwise they return the retained raw I/O slot. An accepted I/O write stores the raw word in that slot **before** invoking its write handler. DMA maps write handlers for addresses/count/control/trigger, but no read handlers for its register bank; ordinary DMA register readback therefore uses retained slots. DMA register mirroring writes raw addresses/count/control/status and resets trigger slots to zero. This does not promise that every device register reads back its last write: device read handlers/actions can differ. | `machine/ts/machine/memory/memory.ts:366-376`; `machine/ts/machine/devices/dma/controller.ts:92-99`; `machine/ts/machine/devices/dma/registers.ts:58-67` | `machine/cpp/machine/memory/memory.cpp:245-259`; `machine/cpp/machine/devices/dma/controller.cpp:16-23`; `machine/cpp/machine/devices/dma/registers.cpp:11-20` |
| DMP20 | A word-aligned CPU U8 load runs the **whole word I/O read callback** and returns low 8 bits; offsets 1..3 fault UNALIGNED_IO. CPU U8 stores fault for any byte address in the I/O region, including word aligned. CPU U16 reads/writes fault UNALIGNED_IO even when word aligned. These are common memory rules, not DMA register-specific byte/halfword operations; a byte load from an actionful data port is not a side-effect-free peek. | `machine/ts/machine/memory/memory.ts:442-451,466-469,503-506,603-606` | `machine/cpp/machine/memory/memory.cpp:332-341,356-359,393-396,498-501` |
| DMP21 | Word and U32 accesses use the raw 32-bit little-endian mapped-word path. A mapped I/O callback is selected only at an address aligned to 4 bytes inside the I/O slot range; a nonaligned 32-bit access wholly inside I/O reports UNALIGNED_IO. Normal CPU load/store dispatch checks its kind's alignment **before** reaching memory; misaligned CPU accesses take the synchronous address-error path instead of invoking a device callback. | `machine/ts/machine/memory/memory.ts:426-435,524-525,544-555,619-645,840-845`; `machine/ts/machine/cpu/cpu.ts:2999-3008,3121-3127` | `machine/cpp/machine/memory/memory.cpp:316-325,414-415,434-445,514-539`; `machine/cpp/machine/memory/memory.h:134-139`; `machine/cpp/machine/cpu/cpu_dispatch.inl:579-587,621-625,646-654` |
| DMP22 | F32 accesses reinterpret one 32-bit word. F64 accesses low 32 bits at A then high 32 bits at A+4, skipping the second access if the first raises a bus fault; it is not a device-level atomic 64-bit register transaction. The normal CPU scalar store readiness check is at its first address before this operation; multiword instructions use the separate pre-scan in DMP18. An earlier individual accepted word is not rolled back if a later word faults. | `machine/ts/machine/memory/memory.ts:573-588,659-671`; `machine/ts/machine/cpu/cpu.ts:3125-3152` | `machine/cpp/machine/memory/memory.cpp:463-482,553-567`; `machine/cpp/machine/cpu/cpu_dispatch.inl:652-667` |

## Faults, discarded writes, counting and completion

| ID | Fact | TypeScript evidence | C++ evidence |
|---|---|---|---|
| DMP23 | DMA's mapped read/write methods use the ordinary mapped 32-bit bus paths (read/write access kind U32), carrying the DMA bus signals. An unaligned I/O read records UNALIGNED_IO and yields zero; an unaligned I/O write records UNALIGNED_IO and returns without a write. A write to a read-only I/O word records READ_ONLY and returns before slot storage/handler invocation. DMA0_STATUS and DMA1_STATUS are among these read-only words. These are **system memory bus faults**, not DMA status/error bits. | `machine/ts/machine/memory/memory.ts:540-555,623-646,852-866`; `machine/ts/spec/bmsx/io.ts:395-396` | `machine/cpp/machine/memory/memory.cpp:430-445,518-540,729-743`; `machine/cpp/spec/bmsx/io.h:408-409` |
| DMP24 | An ordinary unmapped DMA source read records UNMAPPED and returns zero; an unmapped destination write records UNMAPPED and returns. Every recorded bus fault increments the sequence; only the first nonacknowledged fault supplies the retained system CODE/ADDR/ACCESS details. These actions do not throw or return a DMA stop/result flag to the service loop. | `machine/ts/machine/memory/memory.ts:557-570,648-656,811-820`; `machine/ts/machine/devices/dma/controller.ts:229-236` | `machine/cpp/machine/memory/memory.cpp:447-460,542-550,707-716`; `machine/cpp/machine/devices/dma/controller.cpp:159-166` |
| DMP25 | DMA service does **not** test the bus-fault sequence or a per-word success flag. After a faulting source read it still attempts the destination write with the value returned by memory; after a refused/faulting destination write it still advances the enabled addresses and decrements transfer count. It continues all scheduled block slots, publishes resulting endpoints/count, and finishes normally if remaining count is zero. Earlier read side effects and accepted writes are not rolled back. No dedicated DMA error IRQ/status or fault-stop transition is present in this service path; the exposed named DMA status bits here are BUSY and DONE only. | `machine/ts/machine/devices/dma/controller.ts:211-254,365-370`; `machine/ts/spec/bmsx/io.ts:395-396` | `machine/cpp/machine/devices/dma/controller.cpp:141-184,289-294`; `machine/cpp/spec/bmsx/io.h:408-409` |
| DMP26 | DMA destination I/O writes additionally consult that port's write-ready callback using DMA bus signals. If it rejects, memory returns without storing the I/O slot or invoking the write handler; this branch itself raises no bus fault and gives the DMA loop no success signal. Counting still follows DMP25. This callback must not be confused with admission DREQ or CPU ownership/readiness. | `machine/ts/machine/memory/memory.ts:627-642`; `machine/ts/machine/devices/dma/controller.ts:229-236` | `machine/cpp/machine/memory/memory.cpp:522-536`; `machine/cpp/machine/devices/dma/controller.cpp:159-166` |
| DMP27 | A newly raised bus fault during an ordinary CPU scalar data access is detected by the CPU's before/after sequence check and enters synchronous data-bus-error. That CPU instruction mechanism is separate from DMA service, which has no such check (DMP25). Do not claim that the DMA service fault itself enters a CPU load/store exception or stops the channel. | `machine/ts/machine/cpu/cpu.ts:3129-3152`; `machine/ts/machine/devices/dma/controller.ts:229-253` | `machine/cpp/machine/cpu/cpu_dispatch.inl:657-667`; `machine/cpp/machine/devices/dma/controller.cpp:159-183` |
| DMP28 | On accepted START for an idle channel, status becomes BUSY. Zero programmed transfer count finishes immediately. Finish **replaces** status with DONE and raises DMA0_DONE (IRQ bit 0) or DMA1_DONE (IRQ bit 8). Finish is driven by remaining transfer count, not downstream GPU execution, APU sample-RAM completion, IMGDEC decoding completion, or display presentation. DONE alone therefore is not proof that every destination write was accepted or fault-free (DMP25–26). | `machine/ts/machine/devices/dma/controller.ts:131-143,250-252,365-370`; `machine/ts/spec/bmsx/io.ts:362-370,395-397` | `machine/cpp/machine/devices/dma/controller.cpp:62-73,180-182,289-294`; `machine/cpp/spec/bmsx/io.h:375-383,408-410` |

## Completion-domain distinctions — reuse of frozen GPU/PCRTC facts

| ID | Fact | TypeScript evidence | C++ evidence |
|---|---|---|---|
| DMP29 | GPU marker GP0(1f) is a distinct in-order parser action: if GPUSTAT24 was clear, it sets that latch and raises IRQ_GPU (bit 6). Repeated markers while that latch is set do not re-raise. GP1(02) and system IRQ_ACK acknowledge different latches. Becoming GPU-idle does not automatically raise this marker IRQ. This is not DMA_DONE. Reused frozen fact `/tmp/bmsx-gpu-gp1-facts.md:A09` (line 117), with its paired source references. | `machine/ts/machine/devices/gx/gpu.ts:1204-1210,1340-1404`; `machine/ts/spec/bmsx/io.ts:368` | `machine/cpp/machine/devices/gx/gpu.cpp:784-790,850-914`; `machine/cpp/spec/bmsx/io.h:381` |
| DMP30 | GPU idle requires readback IDLE, no pending GPU command deadline, DMA ingress and command FIFO empty, and no partially assembled fixed packet/image-load/polyline. It is distinct from DMA remaining-count completion and from displayed-state latching; retained executed/presentation commands are not tested by this idle condition. Reused `/tmp/bmsx-gpu-gp1-facts.md:GPUSTAT bit26` (line 99), also verified in the bounded request producer source read. | `machine/ts/machine/devices/gx/gpu.ts:1905-1912` | `machine/cpp/machine/devices/gx/gpu.cpp:1382-1389` |
| DMP31 | Normal pending PCRTC configuration becomes displayed at VBlank entry through runtime VBlank handling → GPU presentation → PCRTC presentation latch. This is not the DMA completion path, GPU marker IRQ, or GPU idle bit. Reused frozen `/tmp/bmsx-pcrtc-edge-event-facts.md:7-19`: its exact paired chain is runtime `vblank.ts:44-65` / `vblank.cpp:31-49`, GPU `gpu.ts:1493-1514` / `gpu.cpp:975-996`, PCRTC `gpu_pcrtc.ts:723-731,825-827` / `gpu_pcrtc.cpp:446-454,548-550`. Reset explicitly publishes reset state immediately and is not deferred to that normal presentation edge. | `machine/ts/machine/runtime/vblank.ts:44-65`; `machine/ts/machine/devices/gx/gpu.ts:1493-1514`; `machine/ts/machine/devices/gx/gpu_pcrtc.ts:723-731,825-827,560-572` | `machine/cpp/machine/runtime/vblank.cpp:31-49`; `machine/cpp/machine/devices/gx/gpu.cpp:975-996`; `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:446-454,548-550,305-317` |

## Explicit limits

- No electrical DREQ timing, sustained throughput, simultaneous CPU/DMA bus cycle waveform, or undocumented selector guarantee is inferred.
- No cartridge request protocol behind selectors 7–10 was audited.
- No generalized promise about a device's valid payload, future data, command completion, decoding completion, sample-memory completion or displayed picture follows from a request line or DMA_DONE.
- This source-only extraction does not add a behavioral test, performance measurement or whole-device acceptance claim.


---

# DMA — firmware and source-language facts

Frozen editorial facts, not chapter prose. No architecture document or reference
PDF opened. Shared BIOS/cartlib/compiler producers are identified as single-source;
hardware claims require the mirrored DMA/controller/spec sheets. No public
cartridge export is inferred from private BIOS require paths.

| ID | Fact | Owning source |
|---|---|---|
| DMB01 | BIOS DMA declares typed `*word` pointers for DMA0 read/write/count/control/trigger and fixed GP0; the routine writes source, destination, count, control and START in that order. Raw control3c41 and START1 are firmware operands; their hardware decoding belongs to DMR/DMT facts. | `machine/bios/kernel/dma.lua:4–12,26–33` |
| DMB02 | Its completion sequence is explicit `bss ...: word`; its registered DMA0 callback increments the word. Before issuing a transfer, the routine snapshots the sequence and waits in a predicate loop containing statement `halt_until_irq` until it changes. | `machine/bios/kernel/dma.lua:14–33` |
| DMB03 | Firmware command-list submission appends a GPU marker, waits for its DMA submission routine, separately polls controller GPU pending, ACKs controller GPU and then GPU-local request. DMA completion and GPU marker are distinct waits in this actual programming route. | `machine/bios/gpu/commandlist.lua:9–15`; marker semantics separately in reviewed GPU fact F35/A09. |
| DMB04 | Cartridge `cartlib/dma` requires `cartlib/irq` and registers DMA0 and DMA1 callbacks via its init function. Each callback increments its own BSS sequence. Requiring this route is distinct from authoring a separate direct global irq entry. | `cartlib/dma.lua:2–3,30–45`; installed globalIRQ in `cartlib/irq.lua:23–34` |
| DMB05 | `cartlib/dma.wait0_idle` and `wait1_idle` snapshot the matching BSS sequence, return if the matching STATUS BUSY bit is clear, otherwise execute HALT until sequence changes. | `cartlib/dma.lua:47–65` |
| DMB06 | `copy_to_gp0`, `copy_to_apu`, `copy_from_apu`, `copy_to_imgdec` program channel0 and start it; these functions themselves do not wait. `copy_from_imgdec_to_gp0` programs channel1 and starts it without waiting. The raw constant operands are3c41,3cc1,3c12,3d41,3c58 respectively; decoding is hardware-fact scope. | `cartlib/dma.lua:22–28,67–105` |
| DMB07 | BIOS static arrays/records are authored as typed `rodata`, with mutable buffers/state in explicit BSS, not ordinary heap tables pretending to be registers. Named record initializer and typed word-view forms are actually present. | `machine/bios/shell/commands.lua:61–94`; `machine/bios/tty/terminal.lua:41–73,122–128`; `machine/bios/math/sin.lua:43–56` |
| DMB08 | Startup section initialization zeroes the BSS word span before the entry call. | shared producer `toolchain/ts/lua/compiler.ts:1534–1555,1561–1584` |
| DMB09 | Const-module BSS exports retain a storage-address representation; emitting a BSS address uses a relocated constant load. A small app-owned results module can therefore share the actual BSS address with an ordinary guest suite without inventing a host API/test MMIO slot or heap register facade. | shared producers `toolchain/ts/lua/compiler/passes/const_module_exports.ts:90–111`; `toolchain/ts/lua/compiler.ts:3177–3180`; existing concrete pattern `carts/irq_manual/results.lua:1–21`, `tests/carts/irq_manual/irq_manual_assert.lua:1–6` |
| DMB10 | The ordinary guest suite returns a literal named integration case; each case receives a fresh physical target and ordinary cartridge execution. The runner sees source-owned exported state rather than an authored host/test global. | current `docs/guest_testing.md:16–83`; existing actual `tests/carts/irq_manual/irq_manual_assert.lua:19–44` |

## Reused completed adjacent-unit contracts

- IRQ pending/mask/ACK, entry flags, BSS/HALT service sequences and local versus
  controller acknowledgement are in the reviewed `docs/book1/facts/irq.md` and
  public `docs/book1/irq.md`. A direct example should own only DMA0/1 and any
  explicitly used GPU bits; `cartlib/irq` must not be required as well as a new
  direct global handler.
- GPU GP0 packet encoding, FIFO/DREQ, GP1 DMA direction and local request marker
  are in `docs/book1/facts/gpu.md`, with paired owner links. They are not inferred
  from a DMA selector name. The complete public GPU chapter exists.
- PCRTC display publication is not DMA completion; its reviewed chapter resolves
  scanout/latching. Do not infer a new display mode from a DMA route.

## Intended example assignments, not execution claims

RAM-to-RAM multi-block copy, cartridge-ROM-to-RAM copy and two busy channels can
use explicit BSS/rodata and actual typed port writes. A ROM command stream to
fixed GP0 may follow the actual BIOS route. Exact control encodings, transfer
counts, final words, block schedules and clock budgets must come from frozen
DMR/DMT/DMP facts and independent arithmetic before publication. No example is
implemented or executed by this extraction. No private BIOS module path is a
claimed cartridge API.


## Derived lesson preconditions

- **DMD01:** The P03 forward-overlap calculation assumes ordinary writable RAM
  for the full A..A+15 span, outside actionful I/O. Alignment alone is not that
  precondition. Under that assumption DMT07's sequential read/write order gives
  all three destination words11111111 and final endpoints A+12/A+16/count0.
  Source boundary: TS `machine/ts/machine/memory/memory.ts:648–656`,
  C++ `machine/cpp/machine/memory/memory.cpp:542–550`; mapped I/O alternatives
  TS `memory.ts:627–642`, C++ `memory.cpp:522–536`. Independent review caught
  the omitted RAM precondition before publication; no owner mismatch found.


## Executable lesson inputs and observations

These describe the supplied controlled program, not additional hardware
registers or universal latency guarantees. They supplement DMB source-language
patterns and DMR/DMT/DMP hardware facts.

| ID | Fact / observation | Source |
|---|---|---|
| DME01 | `seed` is twenty literal readonly word operands; `gpu_commands` is the five-word E6/fill/marker stream. The entry declares typed scalar MMIO ports and uses the const result module's BSS storage address. | `carts/dma_manual/cart.lua:1–35`; `carts/dma_manual/results.lua:1–33`; DMB07–09. |
| DME02 | The actual three-phase program snapshots each sequence before START, programs ROM/RAM20 with3c03, two RAM20 copies with3c03/0c03 and ROM5→fixedGP0 with3c41. Its handler increments only the matching DMA0/DMA1 BSS sequence and ACKs flags&101. | `carts/dma_manual/cart.lua:37–138`; field decoding DMR19–22 and completion DMT12. |
| DME03 | Ordinary guest execution observes all60 copied words exact, sequences3/1, both post-START STATUS samples1, all final count0/status2/trigger0, incremented80-byte memory endpoints, fixedGP0 and20-byte GPU-source advancement. | `tests/carts/dma_manual/dma_manual_assert.lua:20–54`; exact input code in DME01–02. This is a controlled observation, not atomic STATUS sampling or an IRQ-latency guarantee. |
| DME04 | For this supplied fill workload execution samples GPU-local24/idle26 both clear after DMA service, later local24/controller6 set at marker, then idle26 set. Explicit local and controller ACKs clear their respective owned bits; masked VBlank pending is not required to be zero. | `carts/dma_manual/cart.lua:115–138`; `tests/carts/dma_manual/dma_manual_assert.lua:55–63`; hardware latches DMP29–31. |
| DME05 | An actual C0 one-pixel readback at(0,0) returns0000001f after the fill. This is pixel evidence distinct from marker/idle observations. | `tests/carts/dma_manual/dma_manual_assert.lua:65–72`; GPU fill quantization/traversal paired owners in `docs/book1/facts/gpu.md:V01–V02`, marker/readback in that same reviewed sheet; input stream DME01. |
