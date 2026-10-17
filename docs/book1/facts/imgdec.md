# IMGDEC — frozen source evidence

Book I installed image-stream decoder. Editorial evidence, not public prose.
The live software contract is authoritative for this edition. No architecture
prose or reference PDF supplied facts. ICR covers control/register/timing, IST
the word stream and generated packets; IBL/IBD/IGP name narrow programming and
adjacent-owner boundaries. Source-derived calculations and actual execution
are distinguished. All public claims still require nonauthor source review.
Private save state is not an extra cartridge interface.

# IMGDEC control/register/timing facts

Extraction only; no runtime or repository edits. Fact IDs use `ICR-`.

## Source scope and boundary

- Initial scope read: `machine/ts/spec/imgdec/{registers,stream}.ts`, `machine/cpp/spec/imgdec/{registers,stream}.h`; `machine/ts/machine/devices/imgdec/controller.ts`; `machine/cpp/machine/devices/imgdec/controller.{h,cpp}`; IMGDEC-related declarations in `machine/ts/spec/bmsx/{io,model}.ts` and `machine/cpp/spec/bmsx/{io,model}.h`.
- Added scope: `machine/{ts,cpp}/spec/bmsx/memory_map.*` for absolute addresses and word stride; direct constructor/service-routing ranges of `machine/ts/machine/machine.ts` and `machine/cpp/machine/machine.cpp`; mapped-word/read-only/readiness ranges of `machine/ts/machine/memory/memory.ts` and `machine/cpp/machine/memory/memory.cpp`; `machine/ts/machine/memory/bus_signals.ts` and `machine/cpp/machine/memory/bus_signals.h`; FIFO owner `machine/ts/machine/devices/word_fifo.ts` and `machine/cpp/machine/devices/word_fifo.h`; direct write-stall/release ranges of `machine/ts/machine/cpu/cpu.ts`, `machine/cpp/machine/cpu/cpu.cpp`, and `machine/cpp/machine/cpu/cpu_dispatch.inl`.
- Never read `docs/architecture.md` or reference PDFs. No GitHub study or implementation performed. No relevant memory hit.
- Detailed token arithmetic and GP0 output-packet sequence are another extractor's scope. This sheet includes only their control/timing/fault boundaries where required.

## Representation table

| ID | Value | TypeScript representation | C++ representation | Paired evidence |
|---|---|---|---|---|
| ICR-001 | Raw programming/status/data words and stream counts | private `number` fields; corresponding save-state fields `number` | private `u32`; save-state `u32` | `machine/ts/machine/devices/imgdec/controller.ts:76-100,109-126`; `machine/cpp/machine/devices/imgdec/controller.h:22-46,102-119` |
| ICR-002 | Input/output FIFO storage | `WordFifo`, backing `Uint32Array`; word writes use `>>> 0` | `WordFifo<32>` / `WordFifo<64>`, backing `std::array<u32, Capacity>` | `machine/ts/machine/devices/imgdec/controller.ts:103-105`; `machine/cpp/machine/devices/imgdec/controller.h:96-98`; `machine/ts/machine/devices/word_fifo.ts:1-9,33-35`; `machine/cpp/machine/devices/word_fifo.h:10-11,23-25,54-57` |
| ICR-003 | History storage and cursors | `Uint32Array(4096)`; numeric cursors/count | `std::array<u32,4096>`; `size_t` cursors/count | `machine/ts/machine/devices/imgdec/controller.ts:103-107`; `machine/cpp/machine/devices/imgdec/controller.h:96-100`; `machine/ts/spec/imgdec/stream.ts:1-2`; `machine/cpp/spec/imgdec/stream.h:9-10` |
| ICR-004 | Decode/output states | integer constants `0..8` / `0..4`, numeric private state | corresponding `u32` constants/private state | `machine/ts/machine/devices/imgdec/controller.ts:60-74,122-123`; `machine/cpp/machine/devices/imgdec/controller.cpp:13-27`; `machine/cpp/machine/devices/imgdec/controller.h:115-116` |
| ICR-005 | Active/quiesce | booleans; active restored from BUSY | booleans; active restored from BUSY | `machine/ts/machine/devices/imgdec/controller.ts:108,127,245-257`; `machine/cpp/machine/devices/imgdec/controller.h:101,120`; `machine/cpp/machine/devices/imgdec/controller.cpp:149-162` |
| ICR-006 | Time and scheduled batch | numeric cycles-per-word/deadline; numeric batch count; no batch deadline `-1` | `i64` cycles-per-word/deadline; `u32` batch count; no batch deadline `-1` | `machine/ts/machine/devices/imgdec/controller.ts:128-137,183-184`; `machine/cpp/machine/devices/imgdec/controller.h:95,121-122`; `machine/cpp/machine/devices/imgdec/controller.cpp:88-89` |
| ICR-007 | Bus signals | numeric bitfield; CPU `0`, DMA `1`, DMA block-end `2` | `u8` bitfield with same constants | `machine/ts/machine/memory/bus_signals.ts:1-10`; `machine/cpp/machine/memory/bus_signals.h:7-14` |

## Register map and access

- **ICR-008 — Address owner.** IO base is `0x08000000`; word stride is 4 bytes. IMGDEC occupies 9 consecutive IO words. Absolute addresses below are evaluations of mirrored address declarations (TS declarations evaluated, C++ spec compiled independently; identical results). Sources: `machine/ts/spec/bmsx/memory_map.ts:6,23,32`; `machine/cpp/spec/bmsx/memory_map.h:12,29,38`; `machine/ts/spec/bmsx/io.ts:138-148,183-192`; `machine/cpp/spec/bmsx/io.h:151-161,196-205`. Address base-index dependency expressions: `machine/ts/spec/bmsx/io.ts:3-148`; `machine/cpp/spec/bmsx/io.h:15-161`.

| ID | Offset / absolute address | Register | Access on mapped-word boundary | Reset | Paired sources |
|---|---|---|---|---|---|
| ICR-009 | `+0x00` / `0x080103fc` | INPUT_WORD_COUNT | R/W config; full raw word stored | 0 | `machine/ts/spec/bmsx/io.ts:139,184,202-208`; `machine/cpp/spec/bmsx/io.h:152,197,215-221`; `machine/ts/machine/devices/imgdec/controller.ts:156,556-560,645`; `machine/cpp/machine/devices/imgdec/controller.cpp:61,462-467,548` |
| ICR-010 | `+0x04` / `0x08010400` | TEXTURE_DESTINATION | R/W config; full raw word stored | 0 | `machine/ts/spec/bmsx/io.ts:140,185,202-208`; `machine/cpp/spec/bmsx/io.h:153,198,215-221`; `machine/ts/machine/devices/imgdec/controller.ts:157,561-563,646`; `machine/cpp/machine/devices/imgdec/controller.cpp:62,468-470,549` |
| ICR-011 | `+0x08` / `0x08010404` | TEXTURE_SIZE | R/W config; full raw word stored | 0 | `machine/ts/spec/bmsx/io.ts:141,186,202-208`; `machine/cpp/spec/bmsx/io.h:154,199,215-221`; `machine/ts/machine/devices/imgdec/controller.ts:158,564-566,647`; `machine/cpp/machine/devices/imgdec/controller.cpp:63,471-473,550` |
| ICR-012 | `+0x0c` / `0x08010408` | CLUT_DESTINATION | R/W config; full raw word stored | 0 | `machine/ts/spec/bmsx/io.ts:142,187,202-208`; `machine/cpp/spec/bmsx/io.h:155,200,215-221`; `machine/ts/machine/devices/imgdec/controller.ts:159,567-569,648`; `machine/cpp/machine/devices/imgdec/controller.cpp:64,474-476,551` |
| ICR-013 | `+0x10` / `0x0801040c` | CONTROL | R/W config; full raw word stored; bit 0 starts | 0 | `machine/ts/spec/bmsx/io.ts:143,188,202-208`; `machine/cpp/spec/bmsx/io.h:156,201,215-221`; `machine/ts/machine/devices/imgdec/controller.ts:160,570-575,649`; `machine/cpp/machine/devices/imgdec/controller.cpp:65,477-482,552` |
| ICR-014 | `+0x14` / `0x08010410` | STATUS | Read-only; mirrored status latch | 0 | `machine/ts/spec/bmsx/io.ts:144,189`; `machine/cpp/spec/bmsx/io.h:157,202`; `machine/ts/machine/devices/imgdec/controller.ts:161,650`; `machine/cpp/machine/devices/imgdec/controller.cpp:66,553`; `machine/ts/machine/memory/memory.ts:852-869`; `machine/cpp/machine/memory/memory.cpp:729-746` |
| ICR-015 | `+0x18` / `0x08010414` | DATA | Read dequeues output when available; write submits input; shared data latch | 0 | `machine/ts/spec/bmsx/io.ts:145,190`; `machine/cpp/spec/bmsx/io.h:158,203`; `machine/ts/machine/devices/imgdec/controller.ts:146-148,177,583-627`; `machine/cpp/machine/devices/imgdec/controller.cpp:51-53,82,491-533` |
| ICR-016 | `+0x1c` / `0x08010418` | INPUT_WORDS_RECEIVED | Read-only live progress thunk | 0 | `machine/ts/spec/bmsx/io.ts:146,191`; `machine/cpp/spec/bmsx/io.h:159,204`; `machine/ts/machine/devices/imgdec/controller.ts:139,171,550-553`; `machine/cpp/machine/devices/imgdec/controller.cpp:45,76,455-459`; `machine/ts/machine/memory/memory.ts:867-869`; `machine/cpp/machine/memory/memory.cpp:744-746` |
| ICR-017 | `+0x20` / `0x0801041c` | DECODED_WORD_COUNT | Read-only live progress thunk | 0 | `machine/ts/spec/bmsx/io.ts:147,192`; `machine/cpp/spec/bmsx/io.h:160,205`; `machine/ts/machine/devices/imgdec/controller.ts:140,172,550-553`; `machine/cpp/machine/devices/imgdec/controller.cpp:46,77,455-459`; `machine/ts/machine/memory/memory.ts:867-869`; `machine/cpp/machine/memory/memory.cpp:744-746` |

- **ICR-018 — Readback backing.** Only DATA and the two progress words get IMGDEC read callbacks. Other mapped reads return stored IO slots. Accepted mapped writes first store their raw word into the IO slot, then invoke the write handler; device `writeIoU32` writes the slot directly without the mapped handler. Sources: `machine/ts/machine/devices/imgdec/controller.ts:139-148`; `machine/cpp/machine/devices/imgdec/controller.cpp:45-53`; `machine/ts/machine/memory/memory.ts:366-376,430-431`; `machine/cpp/machine/memory/memory.cpp:245-259,320-321`.
- **ICR-019 — Read-only write boundary.** Mapped-word writes to STATUS or either progress register raise `BUS_FAULT_READ_ONLY` and return before write readiness or slot/handler writes. Sources: `machine/ts/machine/memory/memory.ts:627-642,867-869`; `machine/cpp/machine/memory/memory.cpp:522-536,744-746`.
- **ICR-020 — Configuration readiness.** All five config registers share readiness `!active && !supervisorQuiesceRequested`; START is not an active-job abort/restart route through this admitted guest boundary. Sources: `machine/ts/spec/bmsx/io.ts:202-208`; `machine/cpp/spec/bmsx/io.h:215-221`; `machine/ts/machine/devices/imgdec/controller.ts:141-145,579-580`; `machine/cpp/machine/devices/imgdec/controller.cpp:47-50,486-488`.
- **ICR-021 — CPU/DMA readiness consumers.** CPU STORE_MEM and STORE_MEM_D consult mappedWriteReady before memory writes; word-sequence variants consult firstBlockedMappedWordWrite. False readiness records the blocked address and retries the current instruction (PC reset). Device resume releases only the matching blocked target. DMA mapped-word writes consult the device-ready callback and return without storing when false. Sources: `machine/ts/machine/cpu/cpu.ts:1647-1662,3010-3028,3125-3132,3163-3169`; `machine/cpp/machine/cpu/cpu.cpp:2342-2353`; `machine/cpp/machine/cpu/cpu_dispatch.inl:585-592,611-617,652-659,678-684`; `machine/ts/machine/memory/memory.ts:261-282,635-641`; `machine/cpp/machine/memory/memory.cpp:181-201,529-535`.

## Bits, retained words, and START

- **ICR-022 — CONTROL defined bit.** START is bit 0 (`0x00000001`). On a CONTROL write, the whole raw word is retained before testing START. START calls start synchronously. Start clears only bit 0, preserving bits 31:1 in the CONTROL latch/readback. The inspected controller has no other CONTROL-bit consumer. Sources: `machine/ts/spec/imgdec/registers.ts:1`; `machine/cpp/spec/imgdec/registers.h:9`; `machine/ts/machine/devices/imgdec/controller.ts:298-307,556-575`; `machine/cpp/machine/devices/imgdec/controller.cpp:199-208,462-482`.
- **ICR-023 — STATUS defined bits.** BUSY bit 0 (`0x01`), DONE bit 1 (`0x02`), INPUT_REQUEST bit 2 (`0x04`), OUTPUT_REQUEST bit 3 (`0x08`), FORMAT_FAULT bit 4 (`0x10`). Sources: `machine/ts/spec/imgdec/registers.ts:3-7`; `machine/cpp/spec/imgdec/registers.h:11-15`.
- **ICR-024 — Status word producers.** Reset sets STATUS to 0; START replaces STATUS with BUSY; stop replaces the entire word with its supplied DONE or FORMAT_FAULT word. DREQ recomputation changes only INPUT_REQUEST and OUTPUT_REQUEST, preserving all other bits of its current status word. Sources: `machine/ts/machine/devices/imgdec/controller.ts:161,302-304,499-506,525-535`; `machine/cpp/machine/devices/imgdec/controller.cpp:66,203-205,404-410,430-440`.
- **ICR-025 — Configuration lifetime/no independent START snapshot.** The four raw programming words are stored directly by their write callbacks. Start does not copy them to a separate job structure; it resets stream-private state and then uses those retained fields. Input count is read during request/progress/completion tests; destination/size words are read when scheduled headers are emitted. Guest config-write admission is the inactive/non-quiescing gate in ICR-020. Sources: `machine/ts/machine/devices/imgdec/controller.ts:165-185,298-307,433-443,486-494,512-516,556-580`; `machine/cpp/machine/devices/imgdec/controller.cpp:70-90,199-208,338-348,391-399,417-421,462-488`.
- **ICR-026 — START exact local order.** resetStreamState → active true → CONTROL START-bit clear → STATUS BUSY → mirror CONTROL → mirror STATUS → mirror reset DATA latch → attempt scheduleDecode(currentNowCycles) → updateDmaRequests. Sources: `machine/ts/machine/devices/imgdec/controller.ts:298-307`; `machine/cpp/machine/devices/imgdec/controller.cpp:199-208`.
- **ICR-027 — Zero-input START edge.** Start resets inputWordsReceived and empties input FIFO, then attempts scheduleDecode. In header phase with no input word, failIfInputExhausted calls FORMAT_FAULT stop when received count equals programmed input count; the programmed-zero case reaches that equality immediately. Sources: `machine/ts/machine/devices/imgdec/controller.ts:165-178,298-307,357-381,519-522`; `machine/cpp/machine/devices/imgdec/controller.cpp:70-83,199-208,258-282,424-427`.

## FIFO, DATA, progress, DREQ, IRQ

- **ICR-028 — Capacities/block quantum.** Input FIFO 32 words, output FIFO 64 words, IMGDEC DMA block quantum 16 words, history 4096 words with mask 4095. Sources: `machine/ts/spec/imgdec/registers.ts:9-11`; `machine/cpp/spec/imgdec/registers.h:17-19`; `machine/ts/spec/imgdec/stream.ts:1-2`; `machine/cpp/spec/imgdec/stream.h:9-10`.
- **ICR-029 — CPU DATA-write readiness.** Requires active, not quiescing, inputWordsReceived < programmed inputWordCountWord, nonzero FIFO free space, and no DMA ownership of this DATA write port. For DMA master the callback returns true unconditionally before these tests. Sources: `machine/ts/machine/devices/imgdec/controller.ts:629-641`; `machine/cpp/machine/devices/imgdec/controller.cpp:535-544`.
- **ICR-030 — DATA write/counter effect.** Every executed DATA write sets the data latch; enqueues it only if input FIFO is not full; increments inputWordsReceived modulo 2^32 even when FIFO was full. DMA non-block-ending writes return before scheduling/DREQ work. Other writes attempt scheduleDecode(now), publish a successful deadline, then recompute DREQ. Sources: `machine/ts/machine/devices/imgdec/controller.ts:608-626`; `machine/cpp/machine/devices/imgdec/controller.cpp:518-532`.
- **ICR-031 — DATA read/ownership/empty behavior.** A non-DMA read while DMA owns the DATA read port returns the existing data latch immediately. Otherwise, if output FIFO has data, pop one word into the data latch, mirror it, increment outputWordsRead modulo 2^32. If output FIFO is empty, that pop/mirror/count step does not occur; the existing latch is used. DMA reads without BLOCK_END return before completion/rescheduling/DREQ work. Sources: `machine/ts/machine/devices/imgdec/controller.ts:583-605`; `machine/cpp/machine/devices/imgdec/controller.cpp:491-515`.
- **ICR-032 — DATA read local tail order.** At CPU reads / DMA block endings, after the optional pop: if outputWordsRead equals expected outputWordCount and streamComplete(), stop(DONE) and return; otherwise attempt scheduleDecode(now), publish successful deadline, updateDmaRequests, return. Sources: `machine/ts/machine/devices/imgdec/controller.ts:597-605`; `machine/cpp/machine/devices/imgdec/controller.cpp:507-515`.
- **ICR-033 — Input progress semantics.** INPUT_WORDS_RECEIVED is the submitted DATA-write count, not number consumed by stream decoder. Its callback returns the private counter directly. Sources: `machine/ts/machine/devices/imgdec/controller.ts:550-553,614-618`; `machine/cpp/machine/devices/imgdec/controller.cpp:455-459,520-524`.
- **ICR-034 — Decoded progress semantics.** DECODED_WORD_COUNT increments by one modulo 2^32 only in emitPayloadWord, which writes payload into output/history; output header emission does not increment it. Progress callback returns the private counter. Sources: `machine/ts/machine/devices/imgdec/controller.ts:429-445,476-483,550-553`; `machine/cpp/machine/devices/imgdec/controller.cpp:334-350,381-388,455-459`.
- **ICR-035 — DREQ IDs and IRQ bit.** DMA_REQUEST_IMGDEC_WRITE is 5; DMA_REQUEST_IMGDEC_READ is 6; IRQ_IMGDEC is `1<<7` (`0x80`). Sources: `machine/ts/spec/bmsx/io.ts:369,388-389`; `machine/cpp/spec/bmsx/io.h:382,401-402`.
- **ICR-036 — Input DREQ predicate.** inputRemaining = programmed input count − inputWordsReceived modulo 2^32; inputBlockWords = min(inputRemaining,16); inputReady = not quiescing AND active AND inputRemaining nonzero AND input FIFO free >= inputBlockWords. Sources: `machine/ts/machine/devices/imgdec/controller.ts:486-490`; `machine/cpp/machine/devices/imgdec/controller.cpp:391-395`.
- **ICR-037 — Output DREQ predicate.** outputRemaining = expected output count − outputWordsRead modulo 2^32; outputBlockWords = min(outputRemaining,16); outputReady = not quiescing AND active AND outputRemaining nonzero AND output FIFO count >= outputBlockWords. Sources: `machine/ts/machine/devices/imgdec/controller.ts:491-494`; `machine/cpp/machine/devices/imgdec/controller.cpp:396-399`.
- **ICR-038 — DREQ/status/resume publication order.** Set DMA request-line mask for request IDs 5 and 6; replace status request bits from the two predicates; mirror STATUS only if changed; if inputReady and DMA does not own DATA write port, resume CPU write on DATA. Sources: `machine/ts/machine/devices/imgdec/controller.ts:495-509`; `machine/cpp/machine/devices/imgdec/controller.cpp:400-414`.
- **ICR-039 — Completion is drain-sensitive.** streamComplete requires OUTPUT_COMPLETE, DECODE_TOKEN, inputWordsReceived == programmed inputWordCountWord, and input FIFO empty. DONE stop is invoked by a DATA read only after outputWordsRead == expected outputWordCount and streamComplete. Decoder reaching output-complete alone does not call DONE stop. Sources: `machine/ts/machine/devices/imgdec/controller.ts:393-401,512-516,597-599`; `machine/cpp/machine/devices/imgdec/controller.cpp:294-302,417-421,507-509`.
- **ICR-040 — stop exact local effects/order.** Cancel IMGDEC service → active false → scheduled count zero → deadline -1 → deassert both IMGDEC DMA lines → replace/mirror STATUS argument → resume all five config addresses → raise IRQ_IMGDEC → notify supervisor boundary. No input/output FIFO reset or data/config clear occurs in stop. Sources: `machine/ts/machine/devices/imgdec/controller.ts:525-546`; `machine/cpp/machine/devices/imgdec/controller.cpp:430-451`.
- **ICR-041 — Interrupt-producing stops.** Both DONE and FORMAT_FAULT use the shared stop which raises IRQ_IMGDEC. Local start/reset contain no IMGDEC IRQ acknowledgement. Sources: `machine/ts/machine/devices/imgdec/controller.ts:151-163,298-307,519-535,597-599`; `machine/cpp/machine/devices/imgdec/controller.cpp:56-68,199-208,424-440,507-509`.

## Timing and service ordering

- **ICR-042 — Installed model rate/injection.** Installed PSX model specifies 2 cycles per output word. Its imgDecCyclesPerOutputWord is passed directly to ImgDecController construction, stored, and multiplied by scheduled word count. Sources: `machine/ts/spec/bmsx/model.ts:13,46-53`; `machine/cpp/spec/bmsx/model.h:18,51-58`; `machine/ts/machine/machine.ts:76-83`; `machine/cpp/machine/machine.cpp:23`; `machine/ts/machine/devices/imgdec/controller.ts:131-137,425`; `machine/cpp/machine/devices/imgdec/controller.cpp:31-44,330`.
- **ICR-043 — Scheduling guard/header parsing.** scheduleDecode returns false if inactive, quiescing, or a batch is already scheduled. Otherwise stream-header words are synchronously consumed while available, before any output deadline is set. Incomplete stream header calls failIfInputExhausted and returns false. Sources: `machine/ts/machine/devices/imgdec/controller.ts:357-381`; `machine/cpp/machine/devices/imgdec/controller.cpp:258-282`.
- **ICR-044 — Output-space/header batch gating.** After header parsing, advanceOutputStage runs; output free 0 returns false. Output header stage requires at least 3 free words and schedules exactly 3 output words. Sources: `machine/ts/machine/devices/imgdec/controller.ts:383-392`; `machine/cpp/machine/devices/imgdec/controller.cpp:284-293`.
- **ICR-045 — Payload batch bound.** Payload scheduling first prepares a run. It refuses a batch if no longer active or still awaiting token/repeat word. Batch is min(runWordsRemaining, stageWordsRemaining, output FIFO free,16); literal additionally limited to current input FIFO count. A zero-sized candidate calls failIfInputExhausted and returns false. Sources: `machine/ts/machine/devices/imgdec/controller.ts:58,403-423`; `machine/cpp/machine/devices/imgdec/controller.h:14`; `machine/cpp/machine/devices/imgdec/controller.cpp:304-328`.
- **ICR-046 — Deadline formula.** A successful batch sets decodeDeadline = anchorCycle + scheduledDecodeWords * cyclesPerOutputWord. No per-stream-input-word delay is added in this function. Sources: `machine/ts/machine/devices/imgdec/controller.ts:357-426`; `machine/cpp/machine/devices/imgdec/controller.cpp:258-331`.
- **ICR-047 — Atomic scheduled emission boundary.** decodeScheduledWords copies its batch count, clears scheduled count/deadline to 0/-1, then emits the scheduled header or payload batch. Header emission returns after advancing stage; payload emission decrements runWordsRemaining, returns decodePhase to TOKEN when run finishes, advances output stage. Sources: `machine/ts/machine/devices/imgdec/controller.ts:429-473`; `machine/cpp/machine/devices/imgdec/controller.cpp:334-378`.
- **ICR-048 — onService exact order.** Cancel existing IMGDEC service; decode batch only if scheduled count nonzero and now >= deadline; if active and not quiescing, attempt next batch anchored at service's nowCycles; updateDmaRequests; notify supervisor; if count nonzero publish current deadline. Sources: `machine/ts/machine/devices/imgdec/controller.ts:283-295`; `machine/cpp/machine/devices/imgdec/controller.cpp:184-196`.
- **ICR-049 — Direct service route.** Machine dispatch for DEVICE_SERVICE_IMGDEC invokes controller.onService(nowCycles) and returns zero. Sources: `machine/ts/machine/machine.ts:155-157`; `machine/cpp/machine/machine.cpp:98-100`.
- **ICR-050 — Scheduling/publishing callsite inventory.** start attempts scheduleDecode without explicitly publishing a service; leaveSupervisorContext, readDataThunk, writeDataThunk explicitly publish if scheduling succeeds; onService schedules then publishes any outstanding batch; restoreState publishes a restored outstanding batch. Sources: `machine/ts/machine/devices/imgdec/controller.ts:253-260,274-278,283-295,298-307,601-604,623-626`; `machine/cpp/machine/devices/imgdec/controller.cpp:158-165,175-181,184-208,511-514,529-532`.
- **ICR-051 — DMA block-end edge.** DATA read/write callbacks defer schedule/DREQ work for DMA words lacking BLOCK_END; final admitted hardware-block word carries BLOCK_END in bus-signal definition. CPU accesses do not take this DMA defer branch. Sources: `machine/ts/machine/devices/imgdec/controller.ts:583-626`; `machine/cpp/machine/devices/imgdec/controller.cpp:491-532`; `machine/ts/machine/memory/bus_signals.ts:1-9`; `machine/cpp/machine/memory/bus_signals.h:9-14`.

## Format-fault conditions and precedence

- **ICR-052 — Wrong magic.** During synchronous stream-header parsing, first word unequal to stream magic `0x31444d49` calls stop(FORMAT_FAULT) immediately before changing decode phase. Sources: `machine/ts/spec/imgdec/stream.ts:4`; `machine/cpp/spec/imgdec/stream.h:12`; `machine/ts/machine/devices/imgdec/controller.ts:361-368`; `machine/cpp/machine/devices/imgdec/controller.cpp:262-269`.
- **ICR-053 — Back-reference fault boundary.** After a back-reference token is consumed and its distance assigned, distance > current historyWordCount calls stop(FORMAT_FAULT) before entering the back-reference payload phase. Sources: `machine/ts/machine/devices/imgdec/controller.ts:331-348`; `machine/cpp/machine/devices/imgdec/controller.cpp:232-249`.
- **ICR-054 — Input exhaustion trigger.** failIfInputExhausted tests equality only: inputWordsReceived == programmed inputWordCountWord; true calls FORMAT_FAULT stop. Callers: missing stream-header words, empty FIFO while waiting token/repeat word, zero-sized payload candidate, and incomplete stream at OUTPUT_COMPLETE. Sources: `machine/ts/machine/devices/imgdec/controller.ts:320-325,379-381,393-400,419-421,519-522`; `machine/cpp/machine/devices/imgdec/controller.cpp:221-225,280-282,294-300,324-326,424-427`.
- **ICR-055 — Output-complete residue fault.** At OUTPUT_COMPLETE, if streamComplete is false and either input FIFO is nonempty or decode phase is not TOKEN, stop FORMAT_FAULT; otherwise call failIfInputExhausted. This branch occurs after advanceOutputStage and the outputFree==0 early return. Sources: `machine/ts/machine/devices/imgdec/controller.ts:383-401`; `machine/cpp/machine/devices/imgdec/controller.cpp:284-302`.
- **ICR-056 — Local check order.** scheduleDecode's order is guard → header consume/magic fault → incomplete-header exhaustion → output stage advance → no-output-space return → header-space gate OR output-complete residue/exhaustion OR prepare run/backref/empty-input fault → payload limits/zero-candidate exhaustion → deadline. Sources: `machine/ts/machine/devices/imgdec/controller.ts:320-426`; `machine/cpp/machine/devices/imgdec/controller.cpp:221-331`.

## Reset, quiescence, private save state

- **ICR-057 — Full reset exact order.** Cancel IMGDEC service; deassert both IMGDEC DREQ lines; resetStreamState; clear supervisorQuiesceRequested; clear four programming words, CONTROL, STATUS; mirror all seven programming/status/data words. Sources: `machine/ts/machine/devices/imgdec/controller.ts:151-185,644-651`; `machine/cpp/machine/devices/imgdec/controller.cpp:56-90,547-554`.
- **ICR-058 — Stream reset values.** Input/output FIFO reset; history write index/count 0; active false; submitted/decoded/texture/CLUT/expected-output/read-output counts 0; DATA 0; decode phase MAGIC(0); output stage TEXTURE_HEADER(0); run/repeat/distance/scheduled words 0; deadline -1. History backing array is not filled/cleared here; availability is reset via index/count. Sources: `machine/ts/machine/devices/imgdec/controller.ts:60-74,165-185`; `machine/cpp/machine/devices/imgdec/controller.cpp:13-27,70-90`; FIFO reset implementation `machine/ts/machine/devices/word_fifo.ts:28-30`; `machine/cpp/machine/devices/word_fifo.h:18-20`.
- **ICR-059 — Begin/quiescent predicate.** beginSupervisorQuiesce sets its flag, recomputes DREQ, notifies supervisor. Quiescent means requested AND scheduledDecodeWords==0; it does not require inactive or empty FIFOs. Sources: `machine/ts/machine/devices/imgdec/controller.ts:264-271`; `machine/cpp/machine/devices/imgdec/controller.cpp:169-172`; `machine/cpp/machine/devices/imgdec/controller.h:64`.
- **ICR-060 — Quiescence boundary.** Existing scheduled batches are still decoded by onService when due before its active/not-quiescing scheduling guard. New scheduleDecode attempts refuse quiescing. On quiescent notification, SYSTEM device service is scheduled at currentNowCycles. Sources: `machine/ts/machine/devices/imgdec/controller.ts:283-295,357-359,544-546`; `machine/cpp/machine/devices/imgdec/controller.cpp:184-196,258-260,449-451`.
- **ICR-061 — Leave supervisor.** Clear quiesce flag; attempt schedule at currentNowCycles; publish if successful; recompute DREQ; resume each config-address stalled write. Sources: `machine/ts/machine/devices/imgdec/controller.ts:274-280,538-540`; `machine/cpp/machine/devices/imgdec/controller.cpp:175-181,443-445`.
- **ICR-062 — Save-state fields.** Captures seven raw config/status/data words; inputWordsReceived, decodedWordCount, textureWordCount, clutWordCount, outputWordsRead; decodePhase, outputStage, runWordsRemaining, repeatWord, backReferenceDistance; supervisorQuiesceRequested; input/output FIFO words; retained history words; scheduledDecodeWords and scheduledDecodeCycles. Sources: `machine/ts/machine/devices/imgdec/controller.ts:76-100,187-219`; `machine/cpp/machine/devices/imgdec/controller.h:22-46`; `machine/cpp/machine/devices/imgdec/controller.cpp:92-123`.
- **ICR-063 — FIFO/history serialization order.** FIFO capture iterates peek(index) from oldest queued word to newest; restore resets then writes in array order. History capture starts at `(historyWriteIndex-historyWordCount)&4095` and captures retained chronological words; restore writes at backing-array index 0 onward, sets write index = history length &4095, count = history length. Sources: `machine/ts/machine/devices/word_fifo.ts:38-60`; `machine/cpp/machine/devices/word_fifo.h:28-50`; `machine/ts/machine/devices/imgdec/controller.ts:188-192,246-251`; `machine/cpp/machine/devices/imgdec/controller.cpp:112-118,150-156`.
- **ICR-064 — Saved timing is relative.** scheduledDecodeCycles = 0 when no scheduled words, otherwise deadline−currentNowCycles. Restore cancels existing service and reconstructs deadline as -1 when no scheduled words, otherwise currentNowCycles+saved scheduledDecodeCycles; republishes if scheduled words nonzero. Sources: `machine/ts/machine/devices/imgdec/controller.ts:215-218,222-223,253-260`; `machine/cpp/machine/devices/imgdec/controller.cpp:119-122,126-127,158-165`.
- **ICR-065 — Reconstructed fields.** Active is reconstructed from restored STATUS BUSY. Expected outputWordCount is reconstructed as 0 while restored decodePhase <= CLUT_WORD_COUNT phase; otherwise texture count+3+(CLUT count==0 ?0:CLUT count+3), modulo 2^32. DREQ is recomputed after state restoration. Sources: `machine/ts/machine/devices/imgdec/controller.ts:236-260`; `machine/cpp/machine/devices/imgdec/controller.cpp:140-165`.
- **ICR-066 — Restore ordering.** Cancel existing IMGDEC service; assign seven config/status/data latches and mirror them; assign private counts/phases/run/quiesce/FIFO/history state; reconstruct schedule/deadline and active; recompute DREQ; publish restored service when nonzero batch. Sources: `machine/ts/machine/devices/imgdec/controller.ts:222-261`; `machine/cpp/machine/devices/imgdec/controller.cpp:126-166`.

## Genuine unresolved/out-of-scope gaps

- **ICR-G01** Global IRQ mask, sticky-pending and ACK semantics are not extracted: controller only names `irq.raise(IRQ_IMGDEC)`. Controller reset/start do not themselves acknowledge IRQ. Paired boundary: `machine/ts/machine/devices/imgdec/controller.ts:151-163,298-307,534`; `machine/cpp/machine/devices/imgdec/controller.cpp:56-68,199-208,439`.
- **ICR-G02** Physical DMA arbitration, block admission, ROM/RAM bus costs and delivery rate are outside this controller sheet; only IMGDEC DREQ predicates and BLOCK_END consumption extracted. Paired boundary: `machine/ts/machine/devices/imgdec/controller.ts:486-509,583-641`; `machine/cpp/machine/devices/imgdec/controller.cpp:391-414,491-544`.
- **ICR-G03** Byte/halfword MMIO access rules are not extracted; register access table is the mapped-word boundary only. Paired examined boundary: `machine/ts/machine/memory/memory.ts:544-555,627-646`; `machine/cpp/machine/memory/memory.cpp:434-445,522-540`.
- **ICR-G04** Full save-file schema/version and system-level restore orchestration are not extracted; only private controller state capture/restore. Paired boundary: `machine/ts/machine/devices/imgdec/controller.ts:187-261`; `machine/cpp/machine/devices/imgdec/controller.cpp:92-166`.
- No affected extraction stopped for a discovered TS/C++ or spec/owner disagreement. No unit test/runtime result is used as the authority for these source facts.


---

# IMGDEC compressed stream and output facts (source extraction)

Scope: live mirrored `machine/{ts,cpp}/spec/imgdec/{registers,stream}.*` and `machine/{ts,cpp}/machine/devices/imgdec/controller.*`. Direct owning `machine/{ts,cpp}/spec/gx/gp0.*` was additionally opened only to establish the emitted CPU-to-VRAM opcode, fixed CLUT size word, and the GP0 transfer-size helper arithmetic. No architecture document, historical PDF, cart compressor, GPU implementation, or runtime test was used for the facts below. The worked examples are **calculations, not execution evidence**. No TS/C++ disagreement was found in this extraction's scope.

All hexadecimal numbers below are raw 32-bit words. `u32(x)` denotes the source's unsigned 32-bit arithmetic (`>>> 0` in TS; `u32` arithmetic in C++), not an additional validation rule. Sources are paired on every factual entry; their line numbers refer to the live checkout read on 2026-10-17.

## Representation and capacities

| ID | Representation / capacity | Paired source |
|---|---|---|
| IST-001 | History capacity is 4096 decoded payload words; ring mask is 4095 (`0xfff`). | `machine/ts/spec/imgdec/stream.ts:1-2`; `machine/cpp/spec/imgdec/stream.h:9-10` |
| IST-002 | Input FIFO capacity is 32 words; output FIFO capacity is 64 words; IMGDEC's DMA request block quantity is 16 words. | `machine/ts/spec/imgdec/registers.ts:9-11`; `machine/cpp/spec/imgdec/registers.h:17-19` |
| IST-003 | Live history storage is `Uint32Array(4096)` in TS and `std::array<u32,4096>` in C++; history write position and valid count are separate from decoded-word count. | `machine/ts/machine/devices/imgdec/controller.ts:102-126`; `machine/cpp/machine/devices/imgdec/controller.h:96-119` |
| IST-004 | Stream/config words, input-received count, decoded count, texture/CLUT counts, run count, repeat word, and back-reference distance use TS `number` fields and C++ `u32` fields; these are not byte strings or host object classifications. | `machine/ts/machine/devices/imgdec/controller.ts:76-94`; `machine/cpp/machine/devices/imgdec/controller.h:22-40` |
| IST-005 | Decode batch ceiling is 16 payload words. | `machine/ts/machine/devices/imgdec/controller.ts:58-58`; `machine/cpp/machine/devices/imgdec/controller.h:14-14` |

## Input layout and tokens

| ID | Exact fact | Paired source |
|---|---|---|
| IST-006 | Stream magic is `0x31444d49`; the stream-header constant is 3 words. | `machine/ts/spec/imgdec/stream.ts:4-5`; `machine/cpp/spec/imgdec/stream.h:12-13` |
| IST-007 | Header parsing consumes, in order: exact magic, raw texture payload-word count `T`, raw CLUT payload-word count `C`. A mismatched first word immediately invokes FORMAT_FAULT; the latter two words are assigned directly. Parsing can stop between these words when the input FIFO empties. | `machine/ts/machine/devices/imgdec/controller.ts:357-382`; `machine/cpp/machine/devices/imgdec/controller.cpp:258-283` |
| IST-008 | Token kind is bits 31:30 (`shift=30`): 0 literal, 1 repeat, 2 back-reference, 3 zero. The ordinary run field is bits 29:0 (`mask=0x3fffffff`). | `machine/ts/spec/imgdec/stream.ts:7-12`; `machine/cpp/spec/imgdec/stream.h:15-20` |
| IST-009 | Back-reference field constants are: distance bits 11:0 (`12` bits, mask `0xfff`); length bits 29:12 (`shift=12`, mask `0x3ffff`); minimum length 3. | `machine/ts/spec/imgdec/stream.ts:13-17`; `machine/cpp/spec/imgdec/stream.h:21-25` |
| IST-010 | On consuming a token the ordinary run length is `(token & 0x3fffffff)+1`, hence **1..1,073,741,824**. Literal enters literal phase. Repeat enters a phase that consumes exactly one following input word as the repeat value before entering repeat phase; if that word is unavailable, it remains waiting for it (or faults when input is exhausted). | `machine/ts/machine/devices/imgdec/controller.ts:320-339`; `machine/cpp/machine/devices/imgdec/controller.cpp:221-240` |
| IST-011 | Back-reference replaces the ordinary run count with `((token >>> 12) & 0x3ffff)+3`, hence **3..262,146**; distance is `(token & 0xfff)+1`, hence **1..4096**. It faults immediately if distance exceeds the currently valid history-word count, before entering back-reference phase. Zero enters zero phase using the ordinary run count. | `machine/ts/machine/devices/imgdec/controller.ts:340-352`; `machine/cpp/machine/devices/imgdec/controller.cpp:241-253` |
| IST-012 | Literal emits one FIFO input word per decoded payload word; repeat emits its held word repeatedly; zero emits raw word 0 repeatedly. No payload-input words are consumed by the repeat emission loop or zero loop. | `machine/ts/machine/devices/imgdec/controller.ts:447-468`; `machine/cpp/machine/devices/imgdec/controller.cpp:352-373` |
| IST-013 | Each back-reference emission reads `history[(historyWriteIndex-distance)&0xfff]`, then emits that word. Because emission advances history before the next loop iteration, a run may overlap its own newly emitted output. | `machine/ts/machine/devices/imgdec/controller.ts:458-484`; `machine/cpp/machine/devices/imgdec/controller.cpp:363-389` |
| IST-014 | Payload emission writes output FIFO first, stores the same word into history (TS explicitly `>>>0`), advances the history write position modulo 4096, saturates valid history count at 4096, and increments decoded-word count modulo 2^32. | `machine/ts/machine/devices/imgdec/controller.ts:476-484`; `machine/cpp/machine/devices/imgdec/controller.cpp:381-389` |
| IST-015 | A scheduled payload emission subtracts its emitted count from run remaining. Only zero run remaining returns the decoder to token phase. It then advances output stage. | `machine/ts/machine/devices/imgdec/controller.ts:469-474`; `machine/cpp/machine/devices/imgdec/controller.cpp:374-379` |
| IST-016 | A fresh stream resets FIFOs, history position and valid count, input/decoded/output counts, decode phase to magic, output stage to texture header, run remaining, repeat word, and back-reference distance. History array contents themselves are not cleared by this routine. | `machine/ts/machine/devices/imgdec/controller.ts:165-184`; `machine/cpp/machine/devices/imgdec/controller.cpp:70-89` |

## Output words, counts, sizes, and stage progression

| ID | Exact fact | Paired source |
|---|---|---|
| IST-017 | After reading `C`, expected total output-word count becomes `u32(T+3+(C==0 ? 0 : C+3))`. It counts both GP0 headers and payload; it is not the decoded-payload counter. | `machine/ts/machine/devices/imgdec/controller.ts:369-377`; `machine/cpp/machine/devices/imgdec/controller.cpp:270-278` |
| IST-018 | Texture header emission writes exactly `[GX_GPU_GP0_CPU_TO_VRAM_FIRST<<24, textureDestinationWord, textureSizeWord]`. CLUT header emission writes exactly `[GX_GPU_GP0_CPU_TO_VRAM_FIRST<<24, clutDestinationWord, GX_GPU_CLUT_4BIT_SIZE_WORD]`. These are output FIFO words, not direct memory/VRAM writes. Each header changes to its payload stage and returns without using the payload-emission routine. | `machine/ts/machine/devices/imgdec/controller.ts:429-445`; `machine/cpp/machine/devices/imgdec/controller.cpp:334-350` |
| IST-019 | The owning GP0 CPU-to-VRAM first opcode is `0xa0`, making the emitted command word `0xa0000000` (raw unsigned representation). | `machine/ts/spec/gx/gp0.ts:19-20`; `machine/cpp/spec/gx/gp0.h:26-27` |
| IST-020 | The owning CLUT constant is `16 | (1<<16) = 0x00010010`; `GX_GPU_CLUT_4BIT_WORDS=16` and `GX_GPU_CLUT_8BIT_WORDS=256` are GP0 constants. IMGDEC's CLUT header always uses that one 4-bit size constant. Do not conflate the constant's value 16 with the separate compressed-stream `C` count of 32-bit payload words. | `machine/ts/spec/gx/gp0.ts:35-37`; `machine/cpp/spec/gx/gp0.h:37-39` |
| IST-021 | Texture-payload stage ends when decoded-word count equals `T`; the next stage is complete if `C==0`, otherwise CLUT header. CLUT-payload stage ends when decoded-word count equals `u32(T+C)`. No history reset or run reset occurs in stage advancement. | `machine/ts/machine/devices/imgdec/controller.ts:310-318`; `machine/cpp/machine/devices/imgdec/controller.cpp:211-219` |
| IST-022 | The initial output stage is texture header even if `T==0`. Consequently a zero-texture stream still emits that header. Only after entering texture-payload stage does the equality in IST-021 skip its empty payload. `C==0` omits the CLUT header and payload stage. | `machine/ts/machine/devices/imgdec/controller.ts:165-179`; `machine/cpp/machine/devices/imgdec/controller.cpp:70-84` |
| IST-023 | Destination/texture-size config writes retain their input words directly; IMGDEC header emission (IST-018) forwards those words unchanged. This extraction establishes raw pass-through, not a coordinate decoder or a RAM-address interpretation. | `machine/ts/machine/devices/imgdec/controller.ts:558-569`; `machine/cpp/machine/devices/imgdec/controller.cpp:465-476` |
| IST-024 | In the directly opened GP0 size helpers, width is `(((sizeWord&0xffff)-1)&1023)+1`, and height is `((((sizeWord>>>16)&0xffff)-1)&511)+1`; dimensions therefore decode to 1..1024 and 1..512. E.g. raw size 0 decodes to 1024×512, and `0x00010010` to 16×1. These are **GP0 helper** meanings; IMGDEC does not call them. | `machine/ts/spec/gx/gp0.ts:57-101`; `machine/cpp/spec/gx/gp0.h:59-103` |
| IST-025 | For a payload stage, target is `T` or `u32(T+C)`; remaining is `u32(target-decodedWordCount)`. A scheduled chunk is the minimum of run remaining, stage remaining, free output FIFO words, and 16; literal chunks are additionally limited to current input FIFO count. If this gives zero, input-exhaustion handling is invoked. | `machine/ts/machine/devices/imgdec/controller.ts:403-423`; `machine/cpp/machine/devices/imgdec/controller.cpp:304-328` |
| IST-026 | Thus a run can stop at the texture boundary with run remaining nonzero, emit the CLUT header, then continue that same run/history in CLUT payload. This follows the exact stage cap and retained-run transition, not a separately encoded texture/CLUT token boundary. | `machine/ts/machine/devices/imgdec/controller.ts:429-474`; `machine/cpp/machine/devices/imgdec/controller.cpp:334-379` |
| IST-027 | Header scheduling requires at least 3 free output FIFO words and schedules all three header words together. No token preparation is performed by that header branch; token preparation occurs only in the payload branch. | `machine/ts/machine/devices/imgdec/controller.ts:383-405`; `machine/cpp/machine/devices/imgdec/controller.cpp:284-306` |

## Exhaustion, malformed streams, and observable partial effects

| ID | Exact fact | Paired source |
|---|---|---|
| IST-028 | `streamComplete()` is precisely: output stage complete, decode phase token, input words received equal configured input-word count, and input FIFO empty. There is no separate end-token condition in this predicate. | `machine/ts/machine/devices/imgdec/controller.ts:512-517`; `machine/cpp/machine/devices/imgdec/controller.cpp:417-422` |
| IST-029 | Input-exhaustion handling faults only on equality `inputWordsReceived==inputWordCountWord`; it does not test greater-than or inspect a byte count. | `machine/ts/machine/devices/imgdec/controller.ts:519-523`; `machine/cpp/machine/devices/imgdec/controller.cpp:424-428` |
| IST-030 | Token/repeat-value preparation checks an empty input FIFO before popping. It invokes exhaustion handling and returns. A header that still lacks one of its three words likewise invokes exhaustion handling after draining available header words. | `machine/ts/machine/devices/imgdec/controller.ts:320-382`; `machine/cpp/machine/devices/imgdec/controller.cpp:221-283` |
| IST-031 | Scheduling order after header parsing is: advance output stage; return if output FIFO has no free words; handle a pending header (requires 3 free); otherwise, if output stage is complete and the exact completion predicate is false, fault when input FIFO is nonempty **or** phase is not token. Only the empty-FIFO/token-phase case instead calls exhaustion handling. Therefore the full-output-FIFO return precedes malformed-tail inspection. | `machine/ts/machine/devices/imgdec/controller.ts:379-405`; `machine/cpp/machine/devices/imgdec/controller.cpp:280-306` |
| IST-032 | A payload run is capped at the final stage target, not rejected in advance for exceeding it. If payload completion leaves run remaining, the phase stays non-token (IST-015), and the complete-stage check faults (IST-031). Already emitted payload/header words are not rolled back. | `machine/ts/machine/devices/imgdec/controller.ts:393-423`; `machine/cpp/machine/devices/imgdec/controller.cpp:294-328` |
| IST-033 | Literal shortage can emit its available prefix: chunk size is capped to input FIFO count; when a later attempt has zero literal input it calls exhaustion handling. Repeat/zero/back-reference emission itself needs no additional compressed input words once the run is prepared. | `machine/ts/machine/devices/imgdec/controller.ts:403-468`; `machine/cpp/machine/devices/imgdec/controller.cpp:304-373` |
| IST-034 | Stop cancels service, clears active/scheduled work and DMA request lines, writes the supplied terminal status, resumes config writes, and raises IMGDEC IRQ. It does **not** clear either FIFO, decoded/input counters, history, run, output stage, or data latch. | `machine/ts/machine/devices/imgdec/controller.ts:525-536`; `machine/cpp/machine/devices/imgdec/controller.cpp:430-441` |
| IST-035 | DATA reads can pop already queued output even after stop, because this read path has no active-status gate. Each actual pop updates the data latch and increments output-words-read modulo 2^32. An empty FIFO leaves the latch unchanged. CPU reads while DMA owns the read port return the current latch without popping. | `machine/ts/machine/devices/imgdec/controller.ts:583-592`; `machine/cpp/machine/devices/imgdec/controller.cpp:491-501` |
| IST-036 | DONE is invoked by the DATA-read path only when output-words-read equals expected output count **and** `streamComplete()` holds. A DMA read before block end returns before this test. Completing decode/output production alone does not invoke DONE here. | `machine/ts/machine/devices/imgdec/controller.ts:593-605`; `machine/cpp/machine/devices/imgdec/controller.cpp:502-515` |
| IST-037 | On DATA write, the input latch is set; the word is enqueued only if FIFO is not full; input-words-received increments modulo 2^32 regardless of that enqueue. Non-block-ending DMA writes return before scheduling/update. This is the callback's literal behavior; ordinary write readiness is a separate controller contract. | `machine/ts/machine/devices/imgdec/controller.ts:608-627`; `machine/cpp/machine/devices/imgdec/controller.cpp:518-533` |
| IST-038 | For representable large count words, output total, combined CLUT target, and stage subtraction use modulo-2^32 arithmetic rather than checked arithmetic or saturation. The parser does not compare `T` or `C` with texture dimensions while assigning them. | `machine/ts/machine/devices/imgdec/controller.ts:369-423`; `machine/cpp/machine/devices/imgdec/controller.cpp:270-328` |

## Worked raw-word calculations (not execution)

### IST-039 — Frozen all-four-token texture + CLUT stream

Program raw config: input-word count `19` (`0x13`); texture destination `0x00400040`; texture size `0x00060004`; CLUT destination `0x00800040`. The destination values here are only opaque words within the IMGDEC source scope. The texture size helper calculation is width=4, height=6. Input words by index:

```text
00  31444d49  magic
01  0000000c  T=12 payload words
02  00000008  C=8 payload words
03  00000001  literal length (1+1)=2
04  11112222  literal A
05  33334444  literal B
06  40000001  repeat length (1+1)=2
07  55556666  repeat word R
08  80001003  back-reference: ((0x1003>>12)&0x3ffff)+3=4; (0x003&0xfff)+1=4
09  c0000003  zero length (3+1)=4
10  00000007  literal length (7+1)=8
11  00000000  CLUT literal 0
12  03e0001f  CLUT literal 1
13  7fff7c00  CLUT literal 2
14  42104210  CLUT literal 3
15  001f001f  CLUT literal 4
16  03e003e0  CLUT literal 5
17  7c007c00  CLUT literal 6
18  7fff7fff  CLUT literal 7
```

Decoded texture payload is `[A,B,R,R,A,B,R,R,0,0,0,0]`: at back-reference start valid history is `[A,B,R,R]`, distance 4 reproduces those four words. CLUT payload is the eight raw literal words at input indices 11..18. Calculated total output is `12+3+8+3=26` words:

```text
00 a0000000   01 00400040   02 00060004
03 11112222   04 33334444   05 55556666   06 55556666
07 11112222   08 33334444   09 55556666   10 55556666
11 00000000   12 00000000   13 00000000   14 00000000
15 a0000000   16 00800040   17 00010010
18 00000000   19 03e0001f   20 7fff7c00   21 42104210
22 001f001f   23 03e003e0   24 7c007c00   25 7fff7fff
```

All four token kinds, lengths, histories and stage transitions above are calculated by the owning token/emission code. Paired source: `machine/ts/machine/devices/imgdec/controller.ts:310-484`; `machine/cpp/machine/devices/imgdec/controller.cpp:211-389`. Raw opcode/size values are independently established by IST-019/020.

### IST-040 — Overlapping run crossing the output-header boundary

Config input count=10, texture destination=`0x00200040`, texture size=`0x00010010`, CLUT destination=`0x00300060`:

```text
31444d49 00000008 00000008
00000001 11223344 aabbccdd
40000001 55667788
c0000000
80008004
```

Here literal2 gives `[A,B]`; repeat2 gives `[R,R]`; zero1 gives `[0]`; back-reference `0x80008004` means length `8+3=11`, distance `4+1=5`. Payload sequence by decoded index is:

```text
texture 0..7: A B R R 0 A B R
CLUT    8..15: R 0 A B R R 0 A
```

The back-reference is split after three words by the texture target, the three CLUT header words are emitted, and the remaining eight back-reference words continue from the same history. Later back-reference words read earlier words of the same run. Calculated raw output is 22 words:

```text
a0000000 00200040 00010010
11223344 aabbccdd 55667788 55667788 00000000 11223344 aabbccdd 55667788
a0000000 00300060 00010010
55667788 00000000 11223344 aabbccdd 55667788 55667788 00000000 11223344
```

Paired source: `machine/ts/machine/devices/imgdec/controller.ts:310-484`; `machine/cpp/machine/devices/imgdec/controller.cpp:211-389`.

### IST-041 — Fault calculations with partial output

Assume a fresh START, the full specified input supplied, normal decoder service, adequate FIFO space, and **no output reads before the fault**. Let `D` and `S` be the raw programmed texture destination/size words.

| Raw input (configured input count is its length) | Calculated consequence |
|---|---|
| `[31444d49,00000003,00000000,80000000]` (4 words) | Texture header `[a0000000,D,S]` is emitted first. The first back-reference requests length3/distance1 with valid history count0, so it faults before any payload. Three output words remain queued; decoded count is0. |
| `[31444d49,00000002,00000000,c0000002]` (4 words) | Zero run requests3 but final target is2. Header plus two zero words is emitted; run remaining1 leaves zero phase at output complete, so FORMAT_FAULT follows with five words queued and decoded count2. |
| `[31444d49,00000002,00000000,00000001,12345678]` (5 words) | Literal run requests2 but only one literal word is supplied. Header plus `12345678` is emitted; the next attempt sees zero literal input with received==configured and faults, leaving four words queued and decoded count1. |
| `[31444d49,00000000,00000000]` (3 words) | Valid empty-payload stream produces only `[a0000000,D,S]`; no token is needed. It meets the stream-complete predicate after that header stage advances, but DONE still requires output-read completion. |

Paired source: `machine/ts/machine/devices/imgdec/controller.ts:310-536`; `machine/cpp/machine/devices/imgdec/controller.cpp:211-441`. DATA-read DONE behavior is separately sourced by IST-036. These are deterministic source calculations under the stated assumptions, not claims that a harness ran them.

## Actual scope gaps (not guarantees)

- IMGDEC owners establish word-token layout, not the byte order of an external file/container or CPU subword accesses.
- The IMGDEC files do not establish downstream GP0 destination coordinate decoding, VRAM addressing/wrapping, pixel/channel formats, or how 32-bit upload payload words map to VRAM halfwords. No coordinate labels or visual interpretation are inferred from the example words here.
- The compressed header takes arbitrary `T`/`C` words directly; the owner has no schema describing an image type or a CLUT format field. The fixed emitted CLUT header is established, but a promise that every representable count matches a downstream GP0 packet is absent.
- Tool-side encoding/compression, asset-format guarantees, carts, external producers, and runtime evidence were outside this extraction. No guarantees about them are inferred.


---

# IMGDEC shared programming-boundary facts

Editorial frozen source-language and adjacent-unit scope. No architecture or historical PDF read. No runtime change authorized. Hardware IMGDEC facts belong to the independent ICR/IST sheets.

## IBL01 — Real BIOS source language

Typed scalar memory ports, explicit BSS completion sequence, capture-before-trigger and predicate HALT loop are actual BIOS patterns. Sources `machine/bios/kernel/dma.lua:4–8,14–33`. Named typed rodata arrays/records are used by `machine/bios/math/sin.lua:1–3,34–46` and `machine/bios/shell/commands.lua:61–78`. This is source-language evidence, not a new firmware export or IMGDEC hardware claim.

## IBL02 — Existing direct IMGDEC programming order

Existing cartlib programs four configuration words, arms the output channel, arms input, then START; it waits both channels idle before the setup. Output count is T+3+(C==0 ? 0 : C+3). Actual local module `cartlib/gx/imgdec.lua:4–24`; its adjacent DMA module programs fixed IMGDEC source/destination and fixed GP0 output in `cartlib/dma.lua:4–26,91–104`. These are ordinary direct-programming precedents, not BIOS exports or justification to copy wrapper layers into the manual example.

## IBD01 — Bounded DMA operands for the example

Two independent DMA channel register runs each have six word fields in order: READ_ADDR, WRITE_ADDR, TRANSFER_COUNT, CONTROL, STATUS, TRIGGER. Channel0 addresses 0800000c/10/14/18/1c/20H; channel1 080103e4/e8/ec/f0/f4/f8H. START trigger bit0; status BUSY bit0/DONE bit1. CTRL bit0 read increment, bit1 write increment; read request bits5:2, write request bits9:6; block bits13:10 encode words−1. Request FORCE0,GX_WRITE1,IMGDEC_WRITE5,IMGDEC_READ6. Thus16-word control words: ROM→fixed IMGDEC 00003d41H; fixed IMGDEC→incrementingRAM 00003c1aH; fixed IMGDEC→fixedGP0 00003c58H. No request or port ownership is implied for unmentioned bits. Sources `machine/ts/spec/bmsx/io.ts:10–19,131–137,218–231,374–389,395–397` and `machine/cpp/spec/bmsx/io.h:22–30,144–150,231–244,387–402,408–410`; addresses derive IO base08000000H and word4 from `machine/ts/spec/bmsx/memory_map.ts:3–7` / `machine/cpp/spec/bmsx/memory_map.h:9–13`. Existing full DMA chapter owns the complete channel contract.

## IBD02 — Cycle costs used in bounded timeline

Installed DMA RAM1cycle/word+1setup; cartridge8/word+4setup; IO cost0. Cross-region span charges max(source,destination), sameRAM/sameCartridge sums, one minimum cycle per entire otherwise0 block. Each block starts a new setup; no crossing or competition except the two named channels in the worked replay. Derived ROM→IMGDEC16words132cycles and3words28cycles; IMGDEC→RAM16words17cycles and10words11cycles. Sources `machine/ts/spec/bmsx/model.ts:7–13,46–53`, `machine/cpp/spec/bmsx/model.h:12–18,51–58`; `machine/ts/machine/devices/dma/controller.ts:412–483` and `machine/cpp/machine/devices/dma/controller.cpp:336–407`. IO classified before RAM: `machine/ts/machine/memory/memory.ts:725–737` / `machine/cpp/machine/memory/memory.cpp:642–653`. These are installed cycle budgets, not electrical bus ratings. Source-line scope re-read directly; existing DMT13–17 in `docs/book1/facts/dma.md` corroborates but does not replace these live owners.

## IBD03 — Fully controlled all-four-token→RAM replay

Actual TypeScript and linked native owners were constructed with current installed timing, real Memory/CPU/IRQ/scheduler/DMA/IMGDEC, source in cartridgeROM, output in ordinary RAM, both channels prearmed with16-word blocks before START atcycle0. No guest instructions, GPU or other work was run. Input is19raw words:

31444d49,0000000c,00000008,00000001,11112222,33334444,40000001,55556666,80001003,c0000003,00000007,00000000,03e0001f,7fff7c00,42104210,001f001f,03e003e0,7c007c00,7fff7fff.

Texture destination00400040H, size00060004H, CLUTdestination00800040H. Exact26output words:
a0000000,00400040,00060004,11112222,33334444,55556666,55556666,11112222,33334444,55556666,55556666,00000000,00000000,00000000,00000000,a0000000,00800040,00010010,00000000,03e0001f,7fff7c00,42104210,001f001f,03e003e0,7c007c00,7fff7fff.

Every output word asserted in both replays. Event records byte-identical:

| Cycle | Edge | received | decoded payload | FIFO output words | output read |
|---|---|---:|---:|---:|---:|
|132|Input block16 ends|16|0|0|0|
|138|Texture header3 published|16|0|3|0|
|142|Literal2 published|16|2|5|0|
|146|Repeat2 published|16|4|7|0|
|154|Back-reference4 published|16|8|11|0|
|160|Input tail3 ends; DMA0 DONE|19|8|11|0|
|162|Zero4 published|19|12|15|0|
|168|CLUT header3 published; output request admits16|19|12|18|0|
|184|CLUT literal8 published|19|20|26|0|
|185|Output block16 ends|19|20|10|16|
|196|Output tail10 ends; IMGDEC DONE and DMA1 DONE|19|20|0|26|

Final pending181H = DMA0/IMGDEC/DMA1. Evidence fixtures `/tmp/bmsx-imgdec-timing-replay.ts` / `.cpp`, logs `/tmp/bmsx-imgdec-timing-replay.log` / `-native.log`; these are scratch validation evidence, not a new repo harness or source of inferred hardware behavior. Numeric derivation uses IBD02 plus the independent ICR scheduling and IST stream/packet facts. Timeline anchor excludes all configuration/instruction/handler/startup time; do not label196cycles ordinary guest routine latency, VRAM completion or a displayed frame.

## IBD04 — Shared mapped-word and central IRQ boundary

IMGDEC STATUS/INPUT_WORDS_RECEIVED/DECODED_WORD_COUNT are mapped read-only; mapped word writes raise READ_ONLY without changing the register. Unaligned mapped IO word writes fault UNALIGNED_IO. Sources `machine/ts/machine/memory/memory.ts:627–646,852–869` / `machine/cpp/machine/memory/memory.cpp:522–540,729–746`. This narrow shared scope does not claim complete byte/halfword access semantics.

Central FLAGS/ACK/MASK at08000000/04/08H. Pending reset0, maskreset0; raising ORs pending independently of mask; asserted line pending&mask. ACK clears only written1bits and reads0; mask does not clearpending. Source addresses `machine/ts/spec/bmsx/io.ts:3–8,214–216` / `machine/cpp/spec/bmsx/io.h:15–20,227–229`; semantics `machine/ts/machine/devices/irq/controller.ts:19–26,72–80,91–125` / `machine/cpp/machine/devices/irq/controller.cpp:14–21,29–33,62–92`. DMA0bit0,IMGDECbit7,DMA1bit8 => mask181H, sources `machine/ts/spec/bmsx/io.ts:362–370` / `machine/cpp/spec/bmsx/io.h:375–383`.

CPU accepted-interrupt event latch: when no HALT latch, acceptance records an event; a later halt_until_irq consumes existingevent rather than sleeping; otherwise establishesHALTlatch. This supports sequence-predicate waits even when ownedcompletion is accepted between predicate read and HALT. Sources `machine/ts/machine/cpu/cpu.ts:1611–1618,1718–1727` / `machine/cpp/machine/cpu/cpu.cpp:1643–1650,2280–2285`. No fixed interruptlatency inferred. Independent source-review required for every added public claim despite this extraction.

## IBD05 — Installed cycle timebase and rate conversion

Installed system-cycle timebase is33,868,800cycles/s (33.8688MHz cycle basis). Source `machine/ts/spec/bmsx/model.ts:7,45–53` and `machine/cpp/spec/bmsx/model.h:12,51–58`; direct installed model already re-read in this extraction. IMGDEC model charge2cycles/outputword supplied atconstruction is ICR-042 (and `machine/ts/spec/bmsx/model.ts:13,53` / `machine/cpp/spec/bmsx/model.h:18,58`). Direct arithmetic: 0.5outputword/cycle =>16,934,40032-bitoutputwords/s =>67,737,600outputbytes/s under uninterrupted fundedservice, adequateinput/outputcapacity and no source/sinkwaiting. Headers count as outputwords and consume charge; token/controlinputwords aren't independentfixedcharges. This is an installed cycle-budget conversion, not an independently specified decoderoscillator, electricalbusbandwidth, compressedinputrate, guaranteedwholeuploadrate or displayed-frame rate. Actual FIFO starvation/outputbackpressure/service delay can only add wait to that isolated chargedwork model; do not silently includeCPUsetup/handler/transporttime in52outputcycles or196controlledtimelinecycles.

## IGP01 — Narrow downstream GPU port/setup boundary

This added scope is solely the example's existing GP0 path, not IMGDEC-owned addressing. GP0=0801023cH and GP1/GPUSTAT=08010240H. Paired declarations `machine/ts/spec/bmsx/io.ts:115–116,172–173` / `machine/cpp/spec/bmsx/io.h:128–129,185–186`, IO-base/stride dependencies ICR008. GP1 opcode04 in bits31:24 selects DMA direction; low2bits retain direction, direction2=CPU_TO_GP0. Source `machine/ts/spec/gx/gp1.ts:5,13–14` / `machine/cpp/spec/gx/gp1.h:11,19–20`; `machine/ts/spec/gx/gp0.ts:39–42` / `machine/cpp/spec/gx/gp0.h:41–44`; dispatch/retention `machine/ts/machine/devices/gx/gpu.ts:1362–1364,1862–1875` / `machine/cpp/machine/devices/gx/gpu.cpp:871–873,1340–1353`. Thus04000002H configures the example's direction. GX_WRITE request depends on direction2's packet-acceptance status, not IMGDEC completion: `machine/ts/machine/devices/gx/gpu.ts:1930–1962` / `machine/cpp/machine/devices/gx/gpu.cpp:1407–1437`.

GPUSTAT bit26(04000000H) is commandGPU_IDLE; it requires readbackidle, no pendingcommanddeadline, emptyCPU+DMA ingress, no partiallyassembledpacket/image-load/polyline. It is not proof of actual pixelstorage publication. Bit27(08000000H) is readbackREADY. Sources `machine/ts/machine/devices/gx/gpu.ts:180–181,1902–1913` / `machine/cpp/machine/devices/gx/gpu.h:55–56` and `machine/cpp/machine/devices/gx/gpu.cpp:1379–1390`. The full GPU chapter owns additional status bits/frontiers.

GP0E6 opcode supplies maskmode low2bits. Bit0forcesmaskonwrites; bit1testsoldmask. E6000000H selects neither, so unprotectedrawupload retains eachsourcehalfwordincludingbit15. Sources opcode/retention `machine/ts/spec/gx/gp0.ts:6`, `machine/cpp/spec/gx/gp0.h:13`; `machine/ts/machine/devices/gx/gpu.ts:1232–1235,1831–1834` / `machine/cpp/machine/devices/gx/gpu.cpp:811–814,1311–1314`; flags `machine/ts/render/backend/gx_gpu_render_rules.ts:337–343` / `machine/cpp/render/backend/gx_gpu_render_rules.h:341–347`; softwarepixelwrite `machine/ts/render/backend/software/gx_gpu_vram.ts:39–46` / `machine/cpp/render/backend/software/gx_gpu_vram.h:50–65`. Generalformat/masking/rasteroptions remain the completeGPUchapter.

## IGP02 — The example's packet counts and actual pixel-data check

GP0A0upload begins a width×height16bit-sampletransfer, requiring ceil(width×height/2)32bitpayloadwords. Dimensions decode fromrawsize by IST024; beginImageLoad source `machine/ts/machine/devices/gx/gpu.ts:1805–1813` / `machine/cpp/machine/devices/gx/gpu.cpp:1285–1293`. XYdecode x=low10bits, y=upper16maskedbyYgate; the example64/64and64/128fit eitherYgate. Payloadlow16thenhigh16, rowmajor: `machine/ts/render/backend/gx_gpu_render_rules.ts:218–228` / `machine/cpp/render/backend/gx_gpu_render_rules.h:222–232`; normalsoftwareupload `machine/ts/render/backend/software/gx_gpu_commands.ts:77–103` / `machine/cpp/render/backend/software/gx_gpu_commands.cpp:40–74`. Thus destination00400040H,size00060004H means4×6storagehalfwordsat(64,64), exactly12payloadwords; CLUT00800040H,size00010010H means16×1at(64,128), exactly8payloadwords. This storagewidth does NOT assert a texture-bit-depth or a rendered onscreenimage.

C0readback has threewords[command,XY,size] (existingcompleteGPUfactF25); normalreadbackGPUREADconsumes onlyREADY and onlywhenDMAdoesnotownreadport. It returnsretainedlatchotherwise. READYdatafirstsamplelow16,nextsamplehigh16; consuminglastwordreturnsreadbackidle. Direct pairedsources `machine/ts/machine/devices/gx/gpu.ts:1019–1032,1739–1741` / `machine/cpp/machine/devices/gx/gpu.cpp:536–548,1222–1224`; `machine/ts/machine/devices/gx/gpu_command_buffer.ts:163–185` / `machine/cpp/machine/devices/gx/gpu_command_buffer.h:107–129`. The actualordinaryintegrationcase readsall12+8wordsafterthefourphaseprogramstops; everywordagreeswiththe26wordpacketstream'spayload. No screenshot/display/native/backend-parityclaimfollows. FullGPUreadbacklatency/fence/wrapcontext remainsintheexistingcompleteGPUchapter; do notinventafixedC0→READYdelay.

---

## IEX01 — Ordinary executed BLua program

The exact two modules are `carts/imgdec_manual/results.lua:1–53` and
`carts/imgdec_manual/cart.lua:1–213`; the ordinary integration case is
`tests/carts/imgdec_manual/imgdec_manual_assert.lua:1–101`. Full cart
validation and normal BIOS-started execution pass. No runtime, BIOS, compiler
or cartlib changes supplied the result. This is execution evidence, not an
additional hardware contract or an electrical/native/display proof.

| Phase | Decoder STATUS / received / decoded | DMA0 / DMA1 / IMGDEC sequences | Retained data |
|---|---|---|---|
| 1, all four token kinds into RAM | 2 / 19 / 20 | 1 / 1 / 1 | All 26 packet words match IST-039 and IBD03 |
| 2, repeat to fixed GP0 | 2 / 19 / 20 | 2 / 2 / 2 | Subsequent actual GPUREAD checks all 12 texture and 8 CLUT words |
| 3, CPU-fed invalid first back-reference | 10H / 4 / 0 | 2 / 2 / 3 | Header A0000000H, 00400040H, 00060004H; empty DATA read retains last word |
| 4, fresh empty-payload START into RAM | 2 / 3 / 0 | 3 / 3 / 4 | Header A0000000H, 00200020H, 00000000H |

Both DMA counts are zero and both STATUS words are 2 at all four observations.
Before valid DMA jobs 1/2/4, both armed STATUS snapshots are 1. Phase 3 does not
arm channels: its `armed_status` BSS zeros mean **not recorded**, not an
observed hardware idle/status encoding. Final owned central bits 181H are clear
and MASK is zero; unrelated disabled pending is preserved. Exact assertions
and producer ordering are in the paired cartridge/case paths above. The
ordinary program's waits distinguish both DMA sequences from IMGDEC stop and
separately observe GPU command idle; that idle bit alone is not pixel proof.

## IEX02 — Paired stream-prefix and history replay

Additional scratch fixtures used the actual current Memory/CPU/IRQ/scheduler,
DMA and IMGDEC owners, installed two-cycle output charge, no armed DMA/GPU,
CPU-side mapped DATA accesses with readiness asserted, and all authored input
present before service. They drained only after queued output was established.
Ten records are byte-identical in TypeScript and linked native execution:

| Case | Decoder cycles | Decoded payload words | STATUS before / after output drain | Queued output words |
|---|---:|---:|---|---:|
| IST-040, overlapping history across CLUT header | 44 | 16 | 9 / 2 | 22, every word asserted |
| IST-041, first back-reference | 6 | 0 | 10H / 10H | 3 |
| IST-041, overlong zero run | 10 | 2 | 10H / 10H | 5 |
| IST-041, truncated literal | 8 | 1 | 10H / 10H | 4 |
| IST-041, empty payload | 6 | 0 | 9 / 2 | 3 |
| Wrong magic | 0 | 0 | 10H / 10H | 0 |
| Only magic supplied, header incomplete | 0 | 0 | 10H / 10H | 0 |
| Configured input count zero | 0 | 0 | 10H / 10H | 0 |
| Repeat token without repeat value | 6 | 0 | 10H / 10H | 3 |
| Extra input after exact zero-run target | 8 | 1 | 10H / 10H | 4 |

All raw prefixes, counters, retained DATA and IRQ 80H were asserted. Successful
streams remain BUSY|OUTPUT_REQUEST (9), with no IRQ, until drained; fault
prefixes remain FORMAT_FAULT after draining. The first scratch expectation
mistakenly omitted OUTPUT_REQUEST from successful undrained status. ICR's
actual request predicate established 9; the expectation was corrected without
changing hardware. Source-derived IST cases and the separate ordinary program
remain the authority for the teaching claims, not an invented blanket promise
for malformed counts or every possible stream.

Evidence fixtures `/tmp/bmsx-imgdec-stream-replay.ts` and `.cpp`, logs
`/tmp/bmsx-imgdec-stream-replay.log` and `-native.log`. The installed-word
pipeline/deterministic fault predicates come from ICR/IST's paired owner lines;
these isolated replay cycles are not CPU-feed instruction or IRQ latency.

---

## IER01 — Post-DONE empty DATA read

DATA's completion predicate has no active/BUSY guard. After fully drained
successful completion, a further CPU DATA read with no DMA read-port owner
returns the retained last word and invokes DONE stop again, re-raising IRQ80H.
There is no output pop or new decoded payload. Non-block-ending DMA reads and
CPU reads while DMA owns the read port return before that test. Paired sources:
`machine/ts/machine/devices/imgdec/controller.ts:583–605,512–517,525–535`;
`machine/cpp/machine/devices/imgdec/controller.cpp:491–515,417–422,430–440`.

The IEX02 replays now explicitly ACK the first IRQ before the extra empty read.
Both successful cases re-raise80H; all eight fault cases preserve pending zero
because their completion predicate remains false. All ten updated records and
retained values agree between owners. This edition documents the live behavior,
not an invented one-shot IRQ. A different terminal-edge policy remains a
separate hardware/implementation decision. Independent source review is still
required for this new public caution.
