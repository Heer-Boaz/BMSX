# APU download: current paired-source facts and bounded execution

Current software is authority. This finite sheet adds the read-side numerical
companion to the existing upload trace, not another full APU register reference.
No architecture document or historical-console PDF supplied facts. Source
derivation, ordinary guest execution and exact-deadline owner execution are
separate evidence streams.

# Independent current-source derivation: APU download
Scope: source inspection only; no execution, tests, repository edits, architecture document, historical PDFs or other reviewers' packets. Existing public exposition checked at `docs/book1/apu.md:587-726,1070-1100`.
Path abbreviations below: `T=machine/ts/machine`, `C=machine/cpp/machine`; paired spec paths are written explicitly.

## Verdict and controlled boundary
All proposed numbers follow the paired owners **if service is dispatched at the scheduled deadlines**: 20 words: 512,529,1041,1046,1174; four words: 512,517,645. These are not measured guest elapsed times.
Define cycle 0 as the mapped write that changes the transfer mode to DMA_READ, with installed APU timing already applied, FIFO empty, carry zero, chosen sample-RAM offset already programmed, and one DMA channel STARTed/BUSY but request-waiting. Source is fixed DATA, destination increments through mapped writable RAM; no competing DMA, supervisor quiescence, intervening control/address changes, destination crossing, clock change or CPU setup cost.
A bare new Machine does NOT establish installed APU transfer timing: transfer cpuHz initially equals 1 (`T/devices/audio/sample_transfer.ts:42`; `C/devices/audio/sample_transfer.h:58`). Apply `Machine.refreshDeviceTimings` (`T/machine.ts:122-126`; `C/machine.cpp:65-69`), which reaches APU setCpuHz (`T/devices/audio/service_clock.ts:112-116`; `C/devices/audio/service_clock.cpp:150-154`). DMA timing is configured from model in the constructor (`T/machine.ts:98-105`; `C/machine.cpp:41-48`).

## Register program / trigger order
1. While STOP/nonbusy: program TRANSFER_ADDRESS first; it stores the raw word and seeds moving offset `word & 0x7fffc` (`T/devices/audio/sample_transfer.ts:142-145`; `C/devices/audio/sample_transfer.cpp:113-116`). Prefill reads from that moving offset, not from CPU address 0x40000000.
2. DMA READ_ADDR=IO_APU_TRANSFER_DATA (0x080001ec), WRITE_ADDR=aligned RAM buffer, COUNT=20 (or 4); CONTROL=`WRITE_INCREMENT | (APU_READ << READ_REQUEST_SHIFT) | (FORCE << WRITE_REQUEST_SHIFT) | BLOCK_WORDS_16` = **0x00003c12**. READ_INCREMENT is clear; write request is FORCE, not APU_WRITE.
3. Write TRIGGER START=1; this sets STATUS BUSY=1, clears prior DONE, then arbitrates. Since STOP/empty FIFO does not assert APU_READ, the channel waits. Write TRANSFER_CONTROL=3 at cycle 0; mode change clears FIFO/carry and schedules initial 16-word prefill.
4. This requires mapped register writes, e.g. `memory.writeMappedU32LE`; `writeIoU32` merely updates IO backing words and bypasses owner hooks (`T/memory/memory.ts:430-435,619-624`; `C/memory/memory.cpp:320-325,514-519`).
Constants: `machine/ts/spec/bmsx/io.ts:354-356,374-397`; `machine/cpp/spec/bmsx/io.h:367-369,387-410`. Trigger semantics: `T/devices/dma/controller.ts:131-144`; `C/devices/dma/controller.cpp:62-74`.
Mode change/scheduling: `T/devices/audio/sample_transfer.ts:182-193,218-237,261-265`; `C/devices/audio/sample_transfer.cpp:153-164,212-248`.
Rewriting decoded mode 3 does not restart from zero; it preserves pending service/FIFO/carry. Therefore cycle 0 must mean a genuine mode change (or an explicitly equivalent empty, unscheduled state).

## Timing derivation
Installed CPU=33,868,800 Hz; transfer=44,100*24=1,058,400 words/sec, so each word costs exactly 32 cycles, carry stays zero. FIFO capacity=16 (`machine/ts/spec/bmsx/model.ts:7-9`; `machine/cpp/spec/bmsx/model.h:12-14`; `machine/ts/spec/audio/apu.ts:1,9-16`; `machine/cpp/spec/audio/apu.h:9,13-19`).
Budget rounding and carry: `T/scheduler/budget.ts:12-18`; `C/scheduler/budget.h:18-20`; scheduling stores one count/deadline, not per-word events (`T/devices/audio/sample_transfer.ts:218-236`; `C/devices/audio/sample_transfer.cpp:212-235`).
For fixed IO source to contiguous RAM, IO costs 0, RAM costs N+1, unlike the documented ROM upload's 8N+4. Different-region cost is max(read,write), giving **DMA block=N+1** (16=>17; 4=>5). Setup cost is charged anew for each block.
Cost/admission owners: `T/devices/dma/controller.ts:412-485`; `C/devices/dma/controller.cpp:336-410`. Block size=min(remaining,programmed 16); both selectors must pass (`T/devices/dma/controller.ts:487-501`; `C/devices/dma/controller.cpp:412-426`).
The request is FIFO-full, not count-aware. Once admitted, a block completes all mapped accesses without per-word request reevaluation; all accesses occur inside the deadline service callback. Last source AND destination accesses carry BLOCK_END. Source BLOCK_END schedules refill before DMA finishes count/address/status updates (`T/devices/dma/controller.ts:211-254`; `C/devices/dma/controller.cpp:141-184`; `T/devices/audio/sample_transfer.ts:159-168`; `C/devices/audio/sample_transfer.cpp:122-131`).

## Twenty-word request, no STOP
Here W0 is the word at the initial moving offset; +offsets are bytes, modulo 512 KiB. Transfer flags refer only to APU bits 7-10, not the whole STATUS word.
| Cycle | Committed event/state after its service |
|---:|---|
| 0 | DMA BUSY/count20, FIFO0; prefill16 scheduled due512, TRANSFER_BUSY=0x400. |
| 512 | W0..W15 prefetched together, offset+64, FIFO16. APU_READ + DMA_REQUEST=0x180, transfer not busy; request rise admits DMA16 due512+17=529. |
| 529 | DMA writes W0..W15 to RAM, FIFO0, DATA latch W15, count4/BUSY. First dequeue drops request; admitted block still completes. Last read schedules refill16 due529+512=1041; transfer flags0x400. |
| 1041 | W16..W31 prefetched, offset+128, FIFO16; flags0x180. APU_READ admits remaining4 due1041+5=1046. |
| 1046 | DMA writes W16..W19 to RAM; count0, BUSY cleared, DONE=2 and DMA IRQ raised. FIFO12 contains W20..W31, DATA latch W19. Last read already scheduled free-capacity4 refill due1046+128=1174; flags0x400. |
| 1174 | If not stopped: append W32..W35, offset+144, FIFO16 holding W20..W35; flags0x180, no transfer pending. DMA remains count0/DONE; no further block or refill. |
Thus desired20 in RAM at1046; 32 sample words have already been prefetched then, not20. Surplus refill adds4, not16. STOP after DONE discards12 already-prefetched FIFO words and can cancel4 not-yet-prefetched words.
RAM writes are visible in mapped-access order inside each service; the table describes the state after that callback, not separate one-cycle word edges.
Finish semantics: `T/devices/dma/controller.ts:237-253,365-374`; `C/devices/dma/controller.cpp:167-183,289-298`. Batch completion/offset/request updates: `T/devices/audio/sample_transfer.ts:201-215`; `C/devices/audio/sample_transfer.cpp:195-209`.

## Four-word request, no STOP
| Cycle | State after service |
|---:|---|
| 0 | DMA BUSY/count4 waits; initial16 prefill due512, not128. |
| 512 | W0..W15 prefetched, offset+64, FIFO16, flags0x180; admit DMA4 due517. |
| 517 | RAM has W0..W3, count0/DONE/IRQ; FIFO12=W4..W15, latch W3. Refill4 scheduled due645; flags0x400. |
| 645 | Append W16..W19, offset+80, FIFO16=W4..W19, flags0x180. No DMA restart/refill thereafter. |
Short DMA count does not shorten initial APU prefill; APU never reads DMA COUNT (`T/devices/audio/sample_transfer.ts:218-237`; `C/devices/audio/sample_transfer.cpp:212-235`).

## STOP strictly before versus at surplus deadline
For20, STOP at any post-DONE access cycle t with1046<=t<1174 cancels pending4 and clears FIFO, leaves offset+128/latchW19/RAM intact. At exactly1174, due4 complete FIRST (offset+144), then STOP clears FIFO; it cannot undo that prefetch. For4, the corresponding interval is517<=t<645 with offset+64; exactly645 first advances offset to+80. STOP clears APU transfer flags in either case; DMA count0/DONE and RAM results persist. A real CPU STOP requires its own instruction/access cycles; equality here specifies the access edge, not an instruction-start edge.
Transfer access ordering is explicit: earlier completions, voices through t-1, due-at-t completions, register access, voices through t (`T/devices/audio/service_clock.ts:185-205`; `C/devices/audio/service_clock.cpp:85-90,187-200`). Mode change cancels/empties/resets carry, but preserves current address, raw programmed address, latch and RAM (`T/devices/audio/sample_transfer.ts:182-193,239-243`; `C/devices/audio/sample_transfer.cpp:153-164,238-242`).
CPU DATA reads return latch only and cannot drain FIFO (`T/devices/audio/sample_transfer.ts:147-149`; `C/devices/audio/sample_transfer.cpp:118-120`). APU_STATUS_BUSY concerns voices/commands, not these transfers (`T/devices/audio/status_register.ts:21-29`; `C/devices/audio/status_register.cpp:25-39`).

## Scheduling/API qualification and paired review
No contradiction found between the paired TS/C++ specs, APU sample-transfer/service-clock owners, or DMA controller for this setup. Their relevant admission, rounding, atomic batch, request, BLOCK_END, finish and STOP behavior agree.
**Machine.advanceDevices alone only advances scheduler time; it does not dispatch due work** (`T/machine.ts:129-148`; `C/machine.cpp:72-91`). To derive exact cycle service events through Machine API, advance to each scheduler deadline and drain all due timers using hasDueTimer/popDueTimer/runDeviceService; account for unrelated earlier timers too. The runtime combines advance + drain (`T/runtime/cpu_executor.ts:322-338`; `C/runtime/cpu_executor.cpp:308-324`) and limits slices to nextDeadline (`T/runtime/cpu_executor.ts:275-295`; `C/runtime/cpu_executor.cpp:260-282`).
**Late/coarse dispatch is not timeline-equivalent:** APU completeService schedules its own continuation from completedDeadline, but updateDmaRequests arbitrates using scheduler.currentNowCycles, and DATA BLOCK_END likewise anchors to currentNowCycles. Therefore jumping directly0->1046 and then servicing APU will admit the first DMA block at1046, not512. APU STATUS reads synchronize APU but do not execute DMA callbacks (`T/devices/audio/status_register.ts:21-29`; `C/devices/audio/status_register.cpp:25-39`).
Current-time/admission anchors: `T/devices/dma/controller.ts:171-177`; `C/devices/dma/controller.cpp:101-108`; `T/devices/audio/sample_transfer.ts:135-139,159-166`; `C/devices/audio/sample_transfer.cpp:122-129,166-170`. The candidate equations are valid deadline-by-deadline source derivations, not proof that an arbitrary advanceTime call or actual guest program exhibits them.


## Separate actual execution observations

- Complete actual source: `carts/apu_download_manual/cart.lua:1–58` and
  `results.lua:1–16`; all74 literal BLua lines and full manifest are printed.
  Manual writes initialize40 raw words5A000000H OR index in private bytes0–159;
  no voice commands or source rewrites occur. The two downloads use byteoffsets
  0/40H, counts20/4, destination indices0/20 in the24-word BSS buffer.
- Actual ordinary build/product/guest pass all 24 destination words, full DMA
  status2, count0, masked pending1, full APU status420H at its post-DMA read,
  then20H/mode0 after STOP. Both faults remain zero. Source:
  `tests/carts/apu_download_manual/apu_download_manual_assert.lua:10–28`.
  The second read proves preservation of overlapping sourcewords16–19 after
  STOP; snapshots do NOT measure STOP's exact edge or strict cancellation.
- Final guest fault ports are APU08010218/systembus08010208, not contiguous
  with the transfer ports. Specs `machine/ts/spec/bmsx/io.ts:94–108,209–224,343–356`,
  `machine/cpp/spec/bmsx/io.h:107–121,222–237,356–369`. A draft test literal
  mistake was corrected from actual spec exports before first execution;
  no runtime, spec or firmware disagreement was found.
- Separate actual-owner execution uses six fresh Machine instances, real mapped
  transfer/DMA words, installed timing and deadline-by-deadline dispatch. Both
  counts use startingoffset0 and known A5000001H-series words, NOT the ordinary
  guest's source pattern or CPU instructions. All derived deadlines above are
  observed; exact STOP due edges deliberately receive no predispatch/status
  read/save capture, so mapped CONTROL itself services due work before STOP.
- Requested payloads match, following RAM sentinels remain intact, and all512KiB
  sample RAM are byte-equal their initialized baseline at every observation.
  STOP due−1 retains offsets128/64; exactdue retains144/80. All STOP cases have
  FIFO/pending0, mode0, APU status20H and retained completed DMA/data latch.
  Existing capture fields are observations, not an invented public FIFO/offset
  port or capture/restore workaround. Source:
  `machine/ts/machine/devices/audio/sample_transfer.ts:91–109` and the actual
  scratch replay `/tmp/bmsx-apu-download-owner-replay.ts`; observed compact/full
  JSON `/tmp/bmsx-apu-download-owner-observed{,-full}.json`.
- Both paired-source agreement and actual execution are bounded: no native,
  electrical/physical timing, arbitrary CPU/polling latency, fresh SDK or whole
  machine completion claim follows. Artifacts, commands, exact hashes and
  independent source/public-reader acceptance are retained in
  [the finite review](../reviews/apu-download-source.md).


## Durable exact-edge regression

Four normal parameterized cases in `tests/lua/audio_controller.test.ts` retain
the20/4-word exact schedules and STOP due−1/exactdue edges. They reuse the
existing Machine fixture with installed timing, dispatch actual due services,
and never read/capture/dispatch after advancing to the STOP edge before its
mapped CONTROL write. Payload/full sample RAM/sentinel and retained offsets
are asserted. All61 tests across that file and dma_controller.test.ts pass;
no new harness/helper or runtime behavior was added.
