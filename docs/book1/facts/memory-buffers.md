# DMA byte-buffer lifetime facts for the memory chapter

Internal bounded author input, 2026-10-17. Read mirrored DMA spec fields and live paired DMA/Memory owners; existing DMA cartridge and its actual assertions. No architecture document, reference PDF, runtime edits or new device abstraction. This sheet does not grant allocation rights, imply a memory transaction, or establish other units' buffer lifetime.

Representation: paired raw u32 READ_ADDR/WRITE_ADDR/COUNT/CONTROL/status. Admission retains the channel, starting addresses, remaining count, control, block word count and deadline, not status or a payload snapshot. TS arithmetic explicitly wraps addresses/count to u32; C++ uses u32. Memory endpoints consume mapped U32LE accesses. Facts below stay in backed aligned RAM for overlap/lifetime claims and do not infer CPU alignment checking for DMA.

- DB01: An accepted START with nonzero count sets BUSY, then arbitrates. START with busy set is ignored; it does not queue a second transfer. Count zero finishes immediately, before request testing. Source TS `machine/ts/machine/devices/dma/controller.ts:131-143`; C++ `machine/cpp/machine/devices/dma/controller.cpp:62-73`; spec TS `machine/ts/spec/bmsx/io.ts:395-397`, C++ `machine/cpp/spec/bmsx/io.h:408-410`.
- DB02: A block is admitted only if both request selectors are asserted. FORCE=0 is always asserted; DISABLED=15 never asserted. Programmed block word count is field13:10 plus1; actual block length is minimum of remaining count and that length, thus1..16 for nonzero count. Source TS `machine/ts/machine/devices/dma/controller.ts:394-419,487-501`; C++ `machine/cpp/machine/devices/dma/controller.cpp:318-343,412-426`; fields TS `machine/ts/spec/bmsx/io.ts:374-394`, C++ `machine/cpp/spec/bmsx/io.h:387-407`.
- DB03: Admission stores starting read/write addresses, remaining count, control and block word count/deadline; it does not read payload words. Payload reads occur at block service, each immediately followed by its destination write; addresses then advance by0 or4 according to the captured increment bits and wrap modulo2^32. Source TS `machine/ts/machine/devices/dma/controller.ts:412-470,211-236`; C++ `machine/cpp/machine/devices/dma/controller.cpp:336-394,142-166`. Derived caution: START is not a copy of the source buffer; preserve source bytes until the transfer's final read. No CPU concurrency timing or interval bound inferred.
- DB04: At service end, resulting addresses/count overwrite channel words, admitted state is cleared, zero remaining count finishes, then arbitration continues. Ordinary programmed address/config writes are not rejected while BUSY; an admitted block uses captured words and later service writeback can overwrite programmed address/count changes. Source TS `machine/ts/machine/devices/dma/controller.ts:106-128,237-253,355-362`; C++ `machine/cpp/machine/devices/dma/controller.cpp:30-54,167-183,279-286`. Derived caution: prepare idle channel completely, start once, leave its programmed words alone through completion.
- DB05: Finish replaces status with DONE(2), clears BUSY by that replacement, and raises DMA0 bit0 / DMA1 bit8. Finish follows final mapped transfer accesses. This reports DMA transport completion, not completion of a receiving device's subsequent job. Source TS `machine/ts/machine/devices/dma/controller.ts:229-253,365-370`; C++ `machine/cpp/machine/devices/dma/controller.cpp:159-183,289-294`; named IRQ constants TS `machine/ts/spec/bmsx/io.ts:362,370`, C++ `machine/cpp/spec/bmsx/io.h:375,383`. A separate completion example from DB09 is needed before asserting a particular GPU observation.
- DB06: DMA mapped reads/writes route to mapped U32LE. Failed unmapped reads latch a fault and return0; unmapped/readonly mapped writes latch a fault and return without writing. The DMA loop does not test a fault sequence/result or abort: it still advances addresses/count. A DMA write to an I/O port not ready returns without writing; the controller does not retry that word. Thus DONE is not a success certificate; preserve the fault report and choose real request selectors, not FORCE for an unready port. Source TS `machine/ts/machine/memory/memory.ts:540-570,623-656`, `machine/ts/machine/devices/dma/controller.ts:229-253`; C++ `machine/cpp/machine/memory/memory.cpp:430-460,518-550`, `machine/cpp/machine/devices/dma/controller.cpp:159-183`. No synchronous CPU exception or automatic DMA error IRQ is inferred from this sheet.
- DB07: For aligned backed RAM, each mapped read obtains the current little-endian4bytes, then each destination write updates its4bytes. There is no block-sized source payload buffer or overlap/memmove branch in this DMA service. Derived deterministic example: initial RAM words[1,2,3,4,5], READ=base, WRITE=base+4, COUNT=4, both increments1, block length4, produces[1,1,1,1,1] from sequential read/write dependence. This is source-derived, NOT executed by the existing manual cartridge. Sources DB03 plus TS `machine/ts/machine/memory/memory.ts:561-565,648-650`; C++ `machine/cpp/machine/memory/memory.cpp:451-455,542-544`. Do not publish this as a captured measurement. Caution: use nonoverlapping source/destination for a normal copy.
- DB08: Existing complete `carts/dma_manual/cart.lua:53-102` transfers20 seed words to owned BSS, then programs both channels before either START for two nonoverlapping RAM copies of20 words. It uses actual linked `result.source`/`result.copies`, counts in words, control0x3c03(16wordblocks) and0x0c03(4wordblocks), IRQ sequence predicates and HALT statements, not guessed RAM addresses. Source storage `carts/dma_manual/results.lua:12-33`; original source `cart.lua:35-102`; tests `tests/carts/dma_manual/dma_manual_assert.lua:17-46`. Root independently ran `npm run validate:toolchain:cart -- dma_manual --debug` and `npm run headless:test -- dma_manual tests/carts/dma_manual/dma_manual_assert.lua`. Both exited0; the single integration case passed. Actual log `/tmp/bmsx-memory-dma-lifetime-validation.log`, artifact15617715196280ae1d1f96780d07600ffe7a4e6daba8a41ac9133e3b79e96aec. This proves only this program and its observations, not universal native or timing parity.
- DB09: The same complete example submits a five-word ROM stream to fixedGP0 with DMA0, then separately waits for GPU marker and GPU idle. The ordinary guest assertions require DMA DONE before marker/idle for this concrete stream, then confirm a red pixel through actual GPUREAD. Source `carts/dma_manual/cart.lua:104-138`; `tests/carts/dma_manual/dma_manual_assert.lua:47-71`. This is a bounded example, not universal DMA/GPU ordering or permission to reuse a live display surface. GPU source facts remain the separate GPU chapter's owner.

Not extracted: GEO/GTEPLUS/APU/IMGDEC capture/live access contracts, buffers after reset/EXEC, whole supervisor device sharing, cartridge media banking, a free-RAM allocator, arbitrary RAM misalignment/overflow, bus electrical arbitration, an automatic DMA terminal-fault policy, GPU/PCRTC VRAM ownership/reuse. These require their owning extracts. Link to complete owning unit sections rather than extend this DMA lifetime to them.

## Isolated DMA fault attribution: independent extension


2026-10-17. Extraction only; no prose, repository edit, new corruption cart,
build or execution. Independently inspected paired Memory/DMA and ordinary
scalar/displaced CPU access owners plus narrow I/O leaves. No architecture,
PDF, supervisor audit or new fault-sequence API. No unresolved source question
blocks the bounded isolated-operation procedure below.

## Checked core

- **DAF01 - One first-pending physical record.** Memory retains raw u32 CODE,
  ADDR and ACCESS. Every reported bus fault advances an internal u32 sequence,
  but while CODE is nonzero later reports do not replace the retained three
  words. Clearing resets CODE/ADDR/ACCESS to zero; it does not change that
  internal sequence. TS `machine/ts/machine/memory/memory.ts:419-423,811-834`;
  C++ `machine/cpp/machine/memory/memory.cpp:309-313,707-723`.

- **DAF02 - Guest-visible register/ACK operations.** Byte addresses are CODE
  `0x08010208`, ADDR `0x0801020c`, ACCESS `0x08010210`, ACK `0x08010214`.
  Aligned Word/U32 reads return the retained slot without acknowledging it.
  Any nonzero aligned Word/U32 write to ACK synchronously clears the record and
  leaves ACK zero; zero does not clear. Writing CODE/ADDR/ACCESS instead is a
  read-only fault, not a clear operation. Sources: paired I/O definitions
  `machine/ts/spec/bmsx/io.ts:102-105,209-212,399-410` and
  `machine/cpp/spec/bmsx/io.h:115-118,222-225,412-423`;
  TS Memory `:158-177,366-376,544-552,627-642,811-834,852-895`;
  C++ Memory `:90-99,245-259,434-442,522-536,695-723,729-772`.

- **DAF03 - Ordinary cartridge user-mode access is supported for these words.**
  These are mapped-memory accesses, not CP0 accesses. Both ordinary and
  displaced LOAD_MEM/STORE_MEM apply alignment, mapped access/readiness and
  fault-sequence handling, with no user-mode privilege rejection on these
  paths. Memory's ACK callback has no privilege test; ACK is absent from the
  read-only classifier, and this owner installs no ACK-ready gate. The record
  words have no read-to-clear handler. Therefore ordinary cartridge user code
  can read CODE/ADDR/ACCESS and clear via an aligned Word/U32 ACK write; no
  supervisor or CP0 write is required for that operation. Sources:
  TS `machine/ts/machine/cpu/cpu.ts:2992-3009,3020-3115,3117-3153`;
  C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:554-602,621-669`;
  paired Memory constructor/read/write/ACK/classifier bodies in DAF02, plus
  TS Memory `:261-265,426-435,619-641` / C++ Memory `:181-185,316-325,514-536`.
  This is not a claim that all MMIO operations have the same access policy.

- **DAF04 - No new-fault sequence register/API is available to this procedure.**
  The internal Memory sequence is not one of the mapped CODE/ADDR/ACCESS/ACK
  words. Their publication writes only those four slots. Do not expose the
  runtime's internal `readBusFaultSequence()` method as a guest API, or confuse
  it with the separately named supervisor publication sequence. An old pending
  record plus unchanged post-transfer CODE/ADDR/ACCESS cannot tell guest code
  whether additional faults occurred. Sources: DAF01, complete slot publication
  bodies TS Memory `:829-834` / C++ Memory `:718-723`, and the four-field I/O
  leaves in DAF02. This is a limit of this exposed record, not a new API gap to
  patch or paper over.

- **DAF05 - DMA uses U32 flags and continues after these mapped faults.**
  DMA reads/writes use mapped U32LE with READ|U32 (`0x401`) / WRITE|U32 (`0x402`)
  flags. The service does not test Memory's fault sequence/result: it performs
  each read then write and advances addresses/count. Unmapped reads report a
  fault and return zero; unmapped/read-only writes report a fault without the
  target write. Final count zero can still produce DONE after such accesses.
  Sources: TS `machine/ts/machine/devices/dma/controller.ts:211-253,365-370`,
  `machine/ts/machine/memory/memory.ts:85-96,540-570,623-656`;
  C++ `machine/cpp/machine/devices/dma/controller.cpp:142-183,289-294`,
  `machine/cpp/machine/memory/memory.cpp:16-27,430-460,518-550`.

- **DAF06 - Zero CODE is not general transfer success.** A mapped DMA write to
  an I/O port whose readiness callback says not ready returns without writing,
  without reporting a bus fault and without a retry in that service walk.
  Thus DONE and a clean fault record do not prove all intended words arrived.
  Correct request selection and operation-specific destination/result checks
  are still required. Sources: TS Memory `:627-641`, C++ Memory `:522-536`,
  paired DMA service loops in DAF05. This is a specific readiness limitation,
  not a universal device-success rule.

## Source-derived isolated clear-latch attribution procedure

- **DAF07 - Required assumption, not an automatic hardware isolation promise.**
  From saving the old report through the final post-transfer reads, exactly
  the one operation being assessed may produce bus faults, and no other code
  may acknowledge/clear the record. Other DMA channels, CPU accesses,
  interrupt/BIOS work or devices must not introduce another fault into that
  interval. The shared CODE/ADDR/ACCESS record carries no DMA-channel or bus-
  master identity; ACCESS identifies direction and access kind only. DAF01-02
  and the retained fields/flag leaves prove why this isolation is necessary;
  they do not provide an API that establishes it for arbitrary programs.

- **DAF08 - Exact bounded sequence.** Under DAF07, before starting the transfer:
  read CODE and preserve any older nonzero report's CODE/ADDR/ACCESS in owned
  program storage; do not overwrite or fabricate a hardware restore. Write
  nonzero word `1` to ACK at `0x08010214`, then read CODE to establish the clean
  zero baseline. Start the one prepared transfer and wait for its real
  completion predicate. Read CODE again; if nonzero, preserve CODE/ADDR/ACCESS
  before another ACK. That is the first reported bus fault since the clear
  and, only under DAF07, is attributable to the assessed operation. If zero,
  no bus fault was retained since that clean baseline, subject to the same
  no-other-clearer assumption; it is not a success certificate (DAF06).
  This sequence is a direct derivation from DAF01-03/05, not an executed test
  or a new transaction, atomic-snapshot, rollback or recovery contract.

- **DAF09 - If the old report must remain physically latched.** Saving its words
  to program storage preserves the diagnostic information but is not retention
  of the hardware latch itself. If acknowledging it is not permitted by the
  program's ownership/diagnostic policy, do not claim a new attributable fault
  check from the unchanged exposed record. Likewise, with concurrent fault
  producers/acknowledgers this record cannot identify which operation caused
  a later event. Use the operation's actual result observations without claiming
  fault attribution that these words do not supply. Basis: DAF01/04/07.

No claim of successful synchronous CPU exception recovery, all-device buffer
ownership, general supervisor behavior, atomic multiword snapshot or fresh
execution evidence follows from these facts.
