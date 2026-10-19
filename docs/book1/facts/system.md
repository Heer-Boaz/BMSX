# SYSTEM frozen control, timing and diagnostic facts

2026-10-17; baseline ec4c5b27e. Separate paired-owner extracts, not public prose.
Source gaps in individual extraction scope are supplied by the other named sheets,
not inferred from function names. The direct CPU yield/HALT ordering disagreement
remains withheld. Current software supplies the documented contract.

# SYSTEM controller: bounded live fact sheet

Baseline: `master`, `ec4c5b27e`, worktree initially clean. Read-only extraction; no tests, builds, implementation edits, or reference-PDF/architecture reads. All numbered facts below come from live source, not prior memory. Controller-state inventory is not a cartridge save-state ABI.

## Source keys

Every locator below resolves to exactly this primary source path; `TS/C++ agree` means inspected corresponding logic, not a claim about uninspected callees.

| Key | Exact path |
|---|---|
| T | `machine/ts/machine/devices/system/controller.ts` |
| C | `machine/cpp/machine/devices/system/controller.cpp` |
| H | `machine/cpp/machine/devices/system/controller.h` |
| IT | `machine/ts/spec/bmsx/io.ts` |
| IC | `machine/cpp/spec/bmsx/io.h` |
| MT | `machine/ts/spec/bmsx/memory_map.ts` |
| MC | `machine/cpp/spec/bmsx/memory_map.h` |
| MODT | `machine/ts/spec/bmsx/model.ts` |
| MODC | `machine/cpp/spec/bmsx/model.h` |

## Address and controller access facts

Address arithmetic: IO base `0x08000000`, word stride 4 bytes (MT:6,23,32; MC:12,29,38). Numeric addresses below are evaluated from the mirrored constant chain, not hex literals in the owner. IT:3-160,167-179,196-201 and IC:15-173,180-192,209-214 agree. Controller mapping establishes callbacks only; actual RO/WO enforcement, width/alignment rules and plain-backed reads are separate Memory-owner facts supplied by root.

| ID | Word; address | Controller-owned access/reset/retention fact | Primary and mirror |
|---|---|---|---|
| R1 | `TIME_MS`; `0x08010228` | Read callback; no controller write callback. Live scheduler-time conversion, not a retained controller register. Controller reset does not reset scheduler time or explicitly write this word. | IT:110,167; IC:123,180; T:86-105,119-129; C:48-67,77-81; agree |
| R2 | `FRAME_MS_Q16`; `0x0801022c` | Read callback returns GPU timing field directly. No controller write callback, retained latch, or explicit reset value. Producer reset/rounding is outside this sheet. | IT:111,168; IC:124,181; T:89,93-105,131-133; C:51,55-67,83-85; agree |
| R3 | `CYCLES_PER_FRAME`; `0x08010238` | Read callback returns low unsigned 32 bits of GPU `nextVblankCycleBudget`. No controller write callback, retained latch, or explicit reset value. Do not replace this producer field with an invented fixed frame duration. | IT:114,171; IC:127,184; T:90,93-105,135-137; C:52,55-67,87-89; agree |
| R4 | `CONTROL`; `0x0801034c` | Write callback; controller writes backing word to zero after every control write, on reset and on restore. No bits remain latched in this backing word. No controller read callback. Pending reset is a separate boolean. | IT:123,178; IC:136,191; T:86,93-105,139-159,322-340; C:48,55-67,91-111,264-282; agree |
| R5 | `STATUS`; `0x08010350` | Read callback derives status from latches/phase. Controller also refreshes backing word on state changes/reset/restore. Reset value zero. No controller write callback. | IT:124,179; IC:137,192; T:87,93-105,351-367; C:49,55-67,293-309; agree |
| R6 | `SUPERVISOR_FAULT_SEQUENCE`; `0x08010428` | First of six retained raw u32 fault words; reset zero. No controller read/write callback for any fault word. Publishing increments internal sequence modulo 2^32 and writes this backing word. Fault capture itself does not increment it. | IT:153,159,196; IC:166,172,209; T:73,100,243-273; C:62,195-225; H:103; agree |
| R7 | `SUPERVISOR_FAULT_CAUSE`; `0x0801042c` | Retains all 32 bits returned by CPU `readCauseWord()` at fault capture; reset zero. No controller decode. | IT:154,197; IC:167,210; T:46-51,73,100,244; C:18-23,62,196; agree |
| R8 | `SUPERVISOR_FAULT_EPC`; `0x08010430` | Retains all 32 bits returned by CPU `readEpcWord()` at fault capture; reset zero. No controller decode. | IT:155,198; IC:168,211; T:46-51,73,100,245; C:18-23,62,197; agree |
| R9 | `SUPERVISOR_FAULT_BAD_ADDRESS`; `0x08010434` | Retains all 32 bits returned by CPU `readBadAddressWord()` at fault capture; reset zero. No controller decode. | IT:156,199; IC:169,212; T:46-51,73,100,246; C:18-23,62,198; agree |
| R10 | `SUPERVISOR_FAULT_LUA_REASON`; `0x08010438` | Retains all 32 bits returned by CPU `readLuaFaultReasonWord()` at fault capture; reset zero. No controller decode. | IT:157,200; IC:170,213; T:46-51,73,100,247; C:18-23,62,199; agree |
| R11 | `SUPERVISOR_FAULT_DOMAIN`; `0x0801043c` | Retains all 32 bits returned by CPU `readExceptionDomainWord()` at fault capture; reset zero. No controller decode. | IT:158,201; IC:171,214; T:46-51,73,100,248; C:18-23,62,200; agree |

## Complete control/status bit behavior

| ID | Fact | Primary and mirror |
|---|---|---|
| B1 | CONTROL bit0 `RESET=0x01`; bit1 `SUPERVISOR_ENTER=0x02`; bit2 `SUPERVISOR_LEAVE=0x04`; bit3 `SUPERVISOR_FAULT=0x08`; bit4 `SUPERVISOR_FAULT_PUBLISH=0x10`. Remaining bits have no branch/effect in controller. | IT:414-418; IC:427-431; T:139-159; C:91-111; agree |
| B2 | One write executes independent tests in this order: RESET; if CPU is not user mode, ENTER, FAULT, FAULT_PUBLISH, LEAVE; then backing CONTROL=0. Not mutually exclusive priority selection. Later operations see earlier state changes. | T:139-159; C:91-111; agree |
| B3 | RESET is outside the user-mode gate: set `resetRequested=true`, call CPU `requestYield()`. No machine reset is performed by this callback. More RESET writes coalesce in one boolean. | T:139-144; C:91-96; agree |
| B4 | User-mode CONTROL writes do not execute ENTER/FAULT/PUBLISH/LEAVE. They still process RESET and zero the backing CONTROL word. CPU mode meaning/check implementation is outside this sheet. | T:139-159; C:91-111; agree |
| B5 | ENTER invokes activation; activation is a no-op unless phase is ENTRY_VECTOR. It does not itself request a supervisor edge or begin ordinary entry from USER. | T:145-147,228-241; C:97-99,180-193; agree |
| B6 | FAULT always captures CPU fault payload before its phase branch. PUBLISH increments sequence regardless of phase or payload freshness once privileged gate passed. LEAVE acts only in ACTIVE and when resumable. | T:148-156,243-288; C:100-108,195-240; agree |
| B7 | STATUS bit0 `SUPERVISOR_ACTIVE=1` iff phase != USER (includes quiesce and ENTRY_VECTOR, not merely ACTIVE phase); bit1 `EXIT_REQUESTED=2` iff exit latch true; bit2 `RESUMABLE=4` iff resumable latch true. All other status bits are zero. These are separate tests. | IT:420-422; IC:433-435; T:351-367; C:293-309; agree |

## Exact time representations at SYSTEM boundary

| ID | Fact | Primary and mirror |
|---|---|---|
| T1 | TS `cpuHz` is a number constructor parameter; C++ is i64. `setTiming` replaces it; controller does not validate, rescale scheduler time, or reset latches. Installed model constant is `33_868_800 Hz`, but whether a particular machine passes it is a runtime caller fact, not proved by model declaration. | T:74-108; H:46-59,104; MODT:7,46-47; MODC:12,51-52; agree on declared model frequency and assignment |
| T2 | `elapsedMilliseconds()` is non-MMIO floating arithmetic: TS `currentNowCycles()*1000/cpuHz`; C++ f64(cycles)*1000.0/f64(cpuHz). No integer truncation or u32 wrap at this helper boundary. | T:111-113; C:69-71; agree on expression |
| T3 | TIME_MS TS exact operations: `cycles=currentNowCycles()`; `r=cycles%cpuHz`; `s=(cycles-r)/cpuHz`; `n=r*1000`; `m=n%cpuHz`; return `(s*1000+(n-m)/cpuHz)>>>0`. C++ first casts cycles and cpuHz to u64, then returns u32(`(cycles/cpuHz)*1000+((cycles%cpuHz)*1000)/cpuHz`). For nonnegative integer inputs in common exact arithmetic this truncates fractional milliseconds and wraps modulo 2^32. Scheduler range/sign/JS exactness contract is not inspected; do not infer universal parity outside that contract. | T:119-129; C:77-81; paired expressions inspected |
| T4 | FRAME_MS_Q16 is forwarded without conversion as `gpu.readPcrtcTiming().frameDurationMillisecondsQ16`; C++ return type is u32. SYSTEM source alone does not define producer division/rounding, bit signedness interpretation, or PCRTC reconfiguration timing. | T:131-133; C:83-85; agree |
| T5 | CYCLES_PER_FRAME reads `gpu.readPcrtcTiming().nextVblankCycleBudget`, TS `>>>0`, C++ u32 cast. No division/rounding in controller; low 32-bit conversion at SYSTEM boundary. Producer derivation and deadline alignment are not inspected. | T:135-137; C:87-89; agree |

## Supervisor phases, transitions, boundary calls

Phase numbers are internal saved/controller state, not extra MMIO bits. USER=0, ENTRY_PRODUCER_QUIESCE=1, ENTRY_VECTOR=2, ACTIVE=3, BUS_QUIESCE=4, GPU_QUIESCE=5. Targets: USER=0, SUPERVISOR=1, FAULT=2. TS numbers; C++ u8. (T:35-44,53-64; H:19-41.)

| ID | Input/guard | Exact local effects, in order; uninspected callee behavior deliberately omitted | Primary and mirror |
|---|---|---|---|
| S1 | `requestSupervisorLineEdge`, phase USER | Audio `setVoiceClockHeld(true,now)`; phase ENTRY_PRODUCER_QUIESCE; target SUPERVISOR; resumable=false; GPU `beginSupervisorControlQuiesce`; DMA same; geometry `beginSupervisorQuiesce`; imgdec same; write status; schedule SYSTEM service at current scheduler cycles; return. Does not change exit latch here. | T:161-174; C:113-126; agree |
| S2 | `requestSupervisorLineEdge`, ACTIVE and resumable | Set exit-requested=true and write status. Does not call LEAVE automatically. In every other phase/guard outcome the edge method has no effect. | T:175-179; C:127-131; agree |
| S3 | `onService`, ENTRY_PRODUCER_QUIESCE | If geometry or imgdec not quiescent, return with no local reschedule. Otherwise DMA `beginSupervisorQuiesce`, phase BUS_QUIESCE, write status. Continue into next independent phase test in same call. | T:181-190; C:133-142; agree |
| S4 | `onService`, BUS_QUIESCE | If DMA not quiescent, return with no local reschedule. Otherwise phase GPU_QUIESCE, GPU `beginSupervisorQuiesce`, write status. Continue into next phase test in same call. | T:191-198; C:143-150; agree |
| S5 | `onService`, GPU_QUIESCE | If GPU not quiescent, return. Target SUPERVISOR: phase ENTRY_VECTOR, CPU `abortStalledMemoryWrite`, CPU `requestNonMaskableInterrupt`, write status, return. NMI implementation/priority/vector/CPU resume are not proved here. | T:199-209; C:151-161; agree |
| S6 | `onService`, GPU_QUIESCE and target FAULT, GPU quiescent | phase ENTRY_VECTOR, call activation, return. This branch does not request NMI. Activation immediately makes ACTIVE and resumable=true (S8). | T:199-214,228-241; C:151-166,180-193; agree |
| S7 | `onService`, GPU_QUIESCE, GPU quiescent, neither SUPERVISOR nor FAULT target | DMA leave context, GPU leave context, geometry leave context, imgdec leave context, IRQ leave context, phase USER, target USER, resumable=false, audio clock held=false at current cycles, write status. Does not explicitly clear exit-requested here; ordinary LEAVE cleared it earlier. | T:215-225; C:167-177; agree |
| S8 | activation, phase ENTRY_VECTOR | IRQ enter context before DMA enter context before GPU enter context; set resumable=true; phase ACTIVE; target SUPERVISOR; write status. No geometry/imgdec enter-context call here. Other phases return without effect. Source comment says IRQ is banked before GPU reset because GP1 reset acknowledges active-bank GPU line; callee implementation not inspected in this sheet. | T:228-241; C:180-193; agree |
| S9 | FAULT, all phases | Capture cause, EPC, bad address, Lua reason, exception domain in that order; then copy all six fault words, including unchanged sequence, to IO backing in ascending address order. If already ACTIVE, return immediately; no resumable clear, NMI cancel, service request, or CPU yield on that branch. | T:243-252,369-375; C:195-204,311-317; agree |
| S10 | FAULT, not ACTIVE | CPU cancel NMI. If USER: hold audio clock; set ENTRY_PRODUCER_QUIESCE; begin GPU control/DMA control/geometry/imgdec quiesce in that order. For other non-ACTIVE phases leave phase unchanged. Then target FAULT, resumable=false, write status, schedule SYSTEM at now, CPU requestYield. Exit-requested is not changed here. | T:253-267; C:205-219; agree |
| S11 | Fault resumability consequence | FAULT initially clears resumable on non-ACTIVE branch, but reaching S6/S8 sets it true again and target SUPERVISOR. FAULT in ACTIVE preserves previous resumable/target/phase. Do not claim faults inherently remain nonresumable or PUBLISH makes them nonresumable. No conflicting mirror/spec requirement found in inspected scope. | T:243-267,210-213,228-240; C:195-219,162-165,180-192; agree |
| S12 | PUBLISH after privileged gate | Internal sequence `(old+1) mod 2^32`, write sequence IO backing only. Payload is not freshly recaptured or cleared; no phase/status/resumable/exit effect. Sequence can wrap to zero; no zero-skip or validity guard. | T:269-273; C:221-225; agree |
| S13 | LEAVE, guard ACTIVE && resumable | phase BUS_QUIESCE; target USER; exit-requested=false; GPU begin control quiesce; DMA begin control quiesce; DMA begin quiesce; write status; schedule SYSTEM at now; CPU requestYield. Resumable stays true until final S7. Does not issue geometry/imgdec begin-quiesce here. Other guards return without effect. | T:275-288; C:227-240; agree |
| S14 | `cpuHeld()` | Exact predicate: target != SUPERVISOR AND (phase == ENTRY_PRODUCER_QUIESCE OR phase >= BUS_QUIESCE). Normal SUPERVISOR-target entry therefore does not assert this hold predicate. This reports a flag; how frame execution consumes it is outside sheet. | T:290-294; H:62-66; agree |
| S15 | `supervisorContextActive()` | Exact predicate phase != USER; includes transitional phases and ENTRY_VECTOR. This is not identical to CPU privilege or only ACTIVE phase. | T:296-298; H:67-69; agree |

## Reset request lifecycle and state inventory

| ID | Fact | Primary and mirror |
|---|---|---|
| L1 | Initial local state: reset=false; phase USER; target USER; resumable=false; exit=false; six raw u32 fault words zero. TS uses Uint32Array(6), C++ std::array<u32,6>. Constructor maps callbacks only; initial IO backing initialization is a Memory/machine assembly concern. | T:67-91; H:98-104; C:27-53; agree |
| L2 | `reset()` sequence: cancel SYSTEM service; reset=false; phase USER; target USER; resumable=false; exit=false; zero six fault words; release audio hold at scheduler now; CONTROL backing=0; copy fault words to IO; copy status to IO. Does not call CPU reset, scheduler reset, or other device reset itself. | T:93-105; C:55-67; agree |
| L3 | `takeResetRequest()` returns current reset boolean and clears it unconditionally. Later take returns false unless another write/restore set it. Caller decides the actual reset time and scope; it is outside controller. | T:300-304; C:242-246; agree |
| L4 | `captureState()` contains exactly eleven named fields: `resetRequested`, `supervisorPhase`, `supervisorTransitionTarget`, `supervisorResumable`, `supervisorExitRequested`, `supervisorFaultSequenceWord`, `supervisorFaultCauseWord`, `supervisorFaultEpcWord`, `supervisorFaultBadAddressWord`, `supervisorFaultLuaReasonWord`, `supervisorFaultDomainWord`. First, fourth and fifth are booleans; phase/target TS number/C++ u8; six fault words TS u32 storage/C++ u32. No cpuHz/time/GPU timing field is captured here. | T:53-65,306-320; H:30-42; C:248-262; agree |
| L5 | `restoreState()` assigns those eleven fields (fault words into raw u32 storage), sets audio held iff restored phase != USER at current scheduler cycles, zeros CONTROL backing, copies all six fault words then status to IO. No device context-switch calls or scheduling occur in this method. | T:322-341; C:264-283; agree |
| L6 | `postLoad()` schedules SYSTEM service at current scheduler cycles only for ENTRY_PRODUCER_QUIESCE/BUS_QUIESCE/GPU_QUIESCE. USER/ENTRY_VECTOR/ACTIVE do not schedule here. Service scheduling semantics/order are external. | T:343-349; C:285-291; agree |
| L7 | `writeSupervisorFaultIo()` always writes sequence, cause, EPC, bad address, Lua reason, domain in ascending word-address order using IO_WORD_SIZE=4. Fault capture therefore copies unchanged sequence before payload IO copies; a separate PUBLISH write changes sequence afterward when software chooses it. This is source control flow, not a claim of guest concurrency or physical bus cycle counts. | T:369-375; C:311-317; agree |

## Scoped omissions and exact dependencies

No spec/owner/mirror conflict was found within inspected controller/spec scope. No fixes or inferred missing behavior were introduced. The following are deliberately NOT certified here:

| Dependency | Inspected boundary / next required owner scope |
|---|---|
| Actual MMIO access policy, byte/halfword behavior, bus faults, low backing reads | Controller's `Memory.mapIoRead/mapIoWrite/writeIoU32`; root separately inspects `machine/{ts,cpp}/machine/memory/memory.{ts,h,cpp}`. Do not call fault words RO solely from absence of controller write callbacks. |
| TIME clock origin, reset-to-zero timing, range/sign/exactness, actual cpuHz parameter | `scheduler.currentNowCycles()` and constructor/setTiming callers; runtime/machine/scheduler ownership, root scope. |
| FRAME duration fixed-point units/rounding/zero/reset; next-vblank cycle budget exact derivation | `gpu.readPcrtcTiming()`; roots located at `machine/ts/machine/devices/gx/gpu.ts:1451`, C++ `gpu.h:229`; producer `gpu_pcrtc.ts` / `gpu_pcrtc.{h,cpp}`. Root covers; this sheet does not inspect producer. |
| CPU privilege, NMI gate/priority/vector, yield, stalled-write abort, cancellation, fault-word meaning | Named CPU calls at T:139-159,203-206,243-266 / C:91-111,155-158,195-218. Separate CPU extractor owns internals. |
| Device quiescent predicates, transfer draining/cancel behavior, saved context/banks, audio-time hold | Exact calls/order listed S1-S13; `AudioController`, `DmaController`, `GeometryController`, `GxGpu`, `ImgDecController`, `IrqController`. Root/next device-callee extractor owns details. No claim all units pause instantaneously. |
| Supervisor line source and actual exit policy | `requestSupervisorLineEdge()` caller, host/latch/runtime boundary. Edge method itself does not resume. |
| Actual reset request consumption / CPU hold use / SYSTEM service dispatch | `machine/ts/machine/runtime/frame/loop.ts:154`, C++ `machine/cpp/machine/runtime/frame/loop.cpp:48` located by symbol search only; root covers integration. |
| Serialized host save-state codec/format/version | Only eleven capture fields certified. Located but not inspected: `machine/ts/machine/runtime/save_state/{schema.ts:378-383,codec.ts:1297-1317}`; C++ `{schema.cpp:385-390,codec.cpp:1335-1355}`. Not a guest-programming ABI. |
| Debug-print words | `PRINT_CHAR=0x08010230`, `PRINT_FLUSH=0x08010234` addresses from IT:112-113,169-170 / IC:125-126,182-183. These belong to separate `system/debug_transmit` owner; root extracts it. No controller evidence for buffer or flushing semantics here. |
| Bus-fault words | Spec addresses CODE=`0x08010208`, ADDR=`0x0801020c`, ACCESS=`0x08010210`, ACK=`0x08010214` (IT:102-105,209-212; IC:115-118,222-225). Memory owner, not this controller; ACK behavior and register retention are omitted here. |

Final required caller/producer scopes for newcomer-complete SYSTEM chapter: Memory MMIO policy and fault latch; machine reset/clock assembly; frame-loop reset/hold/service integration; scheduler service resumption; GPU PCRTC timing producer; per-device quiesce/context behavior; CPU privileged/NMI/fault-word contract; supervisor-line producer; separate SystemDebugTransmit owner. Root has explicitly taken these dependencies; no additional implementation work is authorized by this sheet.

---

# SYSTEM resource-count derivation

Frozen derivation2026-10-17 baselineec4c5b27e, using register R1–R11, SD01/04,
IO_WORD_SIZE4 in mirrored memory_map leaves. Thirteen addressed32-bit words:
3time+CONTROL+STATUS+6fault+2diagnostic,52addressedbytes, noncontiguous addresses
(not one contiguous reservedspan and not a52byte payloadRAM). Faultreport
payloadbank has6raw32bitwords,24bytes includingsequence. Diagnosticring8192bytes
sharedpartial/completedunread perSD04. Counts are arithmetic on actual enumerated
ports, not an invented per-deviceclock, queue depth or storage capacity elsewhere.

---

# SYSTEM words — Memory access-boundary facts

Read-only live paired-owner extraction, 2026-10-17, baseline ec4c5b27e.
Not chapter prose. Source aliases below are exact paths; no architecture/PDF.

| Alias | Primary path | Mirror path |
|---|---|---|
| M | machine/ts/machine/memory/memory.ts | machine/cpp/machine/memory/memory.cpp |
| I | machine/ts/spec/bmsx/io.ts | machine/cpp/spec/bmsx/io.h |
| S | machine/ts/machine/devices/system/controller.ts | machine/cpp/machine/devices/system/controller.cpp |

SA01. Mapped aligned word read dispatches the registered read handler; absent
one, it reads raw IO slot backing. This is separate from raw main-memory RAM
backing. Primary M:366-368,544-552; mirror M:245-250,438-442. The controller maps
CONTROL write but not read; STATUS/TIME/FRAME/CYCLES have read handlers; fault
words use slot backing (S:86-90,369-375 / mirror S:48-52,311-317). These boundary
facts explain access/readback, not host methods in the public chapter.

SA02. STATUS, TIME_MS, FRAME_MS_Q16, CYCLES_PER_FRAME and all six supervisor
fault words are explicitly read-only to mapped word writes. Write raises
READ_ONLY before IO slot or handler change; code=3. Primary M:627-641,852-891;
I:399-402; mirror M:522-535,729-768; I:412-415. This is not a blanket rule that
all ports without write handlers are RO.

SA03. Mapped unaligned word access wholly inside the IO aperture raises
UNALIGNED_IO=2; failed read returns0. Primary M:549-555,628-646; I:401;
mirror M:439-445,523-540; I:414. Mapped halfword reads wholly contained in IO raise
that same fault and return0: M:503-506 / mirror M:393-396. Mapped byte and
halfword writes wholly contained in IO raise that fault before action: M:466-469,603-606 /
mirror M:355-358,498-501. It is not correct to say every narrow read faults:
a mapped byte read at an aligned slot address invokes the normal read and
returns its low8bits; byte at a nonaligned IO address faults2 and returns0.
Primary M:442-449; mirror M:332-339. Aligned fullword access avoids truncation. IO classification requires whole
access containment: M:836-837 / mirror M:725-726. A halfword beginning at
the last IO byte crosses into adjacent raw RAM and follows the non-IO raw
path instead: M:512-515,608-610 / mirror M:402-405,503-505. Do not broaden
these access-classification rules beyond the actual mapped aperture.

SA04. CONTROL is written as a raw whole word before its handler runs, then
SystemController always writes slot0 back. A read after accepted handler return
is0, including unknown/ignored bits. Primary M:371-376; S:139-159; mirror
M:253-259; S:91-110. Neither a retained command mask nor fault ACK is inferred.

SA05. Word-read versus U32/F32/byte access classes have distinct recorded bus
ACCESS flags. Do not invent one universal numeric ACCESS word. First pending
bus fault wins while sequence increments on each fault: M:811-826 / mirror
M:705-715. Full fault/controller delivery is the existing Memory/CPU reference,
not newly inferred here. Access-class bits are I:403-410 / mirror I:416-423.

Executed evidence: /tmp/bmsx-system-register-replay.{cpp,ts}, native/TS logs and
comparison log. 33 exact paired observations pass, including all10 RO words,
aligned byte low8, unaligned byte/word, forbidden halfword, forbidden narrow
control writes with no reset request, self-clearing reset and ignored unknown
control bits. These are direct owner calls, not ordinary guest execution.
The fixture explicitly installs the model timing; bare Machine construction
is not a completed hardware boot and must not supply public reset timings.

---

# SYSTEM timing-word producer — PCRTC facts

Read-only paired-source extraction, 2026-10-17 baseline ec4c5b27e. Narrow owning
producer scope, not a PCRTC chapter rewrite or full timing-space audit.

| Alias | Primary | Mirror |
|---|---|---|
| P | machine/ts/machine/devices/gx/gpu_pcrtc.ts | machine/cpp/machine/devices/gx/gpu_pcrtc.cpp |
| G | machine/ts/machine/devices/gx/gpu.ts | machine/cpp/machine/devices/gx/gpu.h |
| S | machine/ts/machine/devices/system/controller.ts | machine/cpp/machine/devices/system/controller.cpp |

ST01. SYSTEM FRAME_MS_Q16 forwards current retained PCRTC timing's raw word;
CYCLES_PER_FRAME returns low32 of nextVblankCycleBudget. The GPU getter returns
the timing object/reference without read-triggered recomputation/service.
Primary S:131-136; G:1451-1453 / mirror S:83-88; G:229. Neither is a countdown to
the next interrupt or a nominal fixed frame-rate constant.

ST02. Live programmed beam words produce horizontal total/reference divider,
half-line rational numerator/denominator, vertical total/unit, active and sync
half-lines, running and refresh. Exact arithmetic and bit loads P:247-282 /
mirror P:66-101. Running requires neither SINT nor PRST plus all three timing
quantities nonzero. No separate system-clock/control register is introduced.

ST03. Running refreshScaled is integer quotient of denominator*1,000,000 by
numerator*totalHalfLines. FRAME raw word is low32 of integer quotient
65,536,000,000,000 / refreshScaled. Full-duration value is separately
1000/(refreshScaled/1,000,000), NOT obtained by decoding the wrapped register.
Primary P:283-291; mirror P:102-110. Stopped producer reports refresh/frame word/
full duration0: P:292-295 / mirror P:111-114. This is the already corrected word
contract, not permission to add local Q16 encoders or fallback timings.

ST04. A changed programmed beam-timing word immediately updates operational
timing and restarts the beam; writing identical bits does nothing. Presented
words remain a distinct latch. Primary P:587-598; mirror P:332-342. Thus SYSTEM
reads programmed timing, not a screenshot/display-presentation acknowledgment.

ST05. Restart uses beam epoch now, remainder0, halfLine0. With running timing,
CYCLES budget is deadline(activeHalfLines+totalHalfLines)-deadline(activeHalfLines).
With stopped timing it is0. Primary P:836-854; mirror P:558-575. At serviced
VBlank it updates to deadline(lastVBlank+period)-deadline(lastVBlank), not
(deadline-now). Primary P:674-681; mirror P:397-404. State restore recomputes it
from the next retained VBlank landmark: P:762-773 / mirror P:485-495.

ST06. Half-line period uses cpuHz*numerator divided by denominator, retaining
integer base and fractional remainder. Deadline adds exact whole cycles plus
one if its remainder is nonzero. Primary P:829-834,868-874; mirror P:552-556,
589-596. Frame budgets can differ by one due to fractional beam phase; they
are not an independent byte/bus bandwidth or elapsed program charge.

ST07. Runtime reset configures device time from the installed machine model,
including GPU cpuHz, after scheduler/device reset. Primary
machine/ts/machine/runtime/runtime.ts:48-55 and
machine/ts/machine/machine.ts:122-126; mirrors runtime.cpp:109-116 and
machine.cpp:65-69. Bare Machine.resetDevices alone leaves GPU cpuHz unconfigured
in the direct fixture; that is not the ordinary machine reset contract.

Executed direct paired fixture at installed33,868,800Hz and beam restart0:
FRAME=1317011, CYCLES=680628. These values are from the properly timed fixture,
not a new fixed CYCLES constant. Stopping PCRTC yields both0 while TIME_MS at
one second still reads1000. Source/evidence /tmp/bmsx-system-register-replay.*.
Existing12 TS system cases and rebuilt native system/CPU suites pass, including
the separate long-period word-width regression. That regression uses raw beam
words to produce refresh312 microhertz, raw FRAME3892851843 from full Q16 integer
210051282051, while independent full milliseconds remain3205128.205128205:
tests/lua/system_controller.test.ts:291-343 and
tests/cpp/system_controller_test.cpp:489-569. Scope is current deterministic
software contract, not an electrical clock rating or universal extreme-state
parity proof. No new source discrepancy was found here.

ST08. At ordinary installed hardware reset, before firmware instructions advance
time, the scheduler is reset and installed model timing configured (SR04/ST07).
PCRTC reset installs its reset raw words (P:560-571 / mirrorP:305-316) and restarts
beam with those words. Actual paired properlytimedreset fixture reports TIME0,
FRAME1317011=00141893H, CYCLES680628=000A62B4H. The frame period remains a derived
word and subsequent CYCLES can vary with phase; these are reset-state readouts,
not fixed future budgets or values promised at cartridge entry after firmware.
Sources producer reset+rebuild/restart ST02–06 and executed33row replay. No BIOS
post-boot reset is inferred from direct Machine construction.

---

ST09. For raw unsigned TIME_MS samples and an actual interval below2^32ms,
`(current-start) % 0x100000000` gives a nonnegative wrapping distance. MOD uses
the positive-divisor modulo rule; BAND instead returns a signed32-bit Number,
so `& 0xffffffff` is not an unsigned-distance conversion for the upper half.
TS `machine/ts/spec/blua32/numeric.ts:7–13`,
`machine/ts/machine/cpu/cpu.ts:2581–2592`;
C++ `machine/cpp/spec/blua32/numeric.h:13–20`,
`machine/cpp/machine/cpu/cpu_dispatch.inl:199–205,222–228`.

# SYSTEM diagnostic transmitter — frozen facts

Live paired-owner extraction, 2026-10-17, baseline ec4c5b27e. Not chapter prose.
Sources D = machine/ts/machine/devices/system/debug_transmit.ts and mirror
machine/cpp/machine/devices/system/debug_transmit.cpp; U =
machine/ts/common/utf8.ts and mirror machine/cpp/common/utf8.h; I =
machine/ts/spec/bmsx/io.ts and mirror machine/cpp/spec/bmsx/io.h.
Memory access/readback policy is in the separate access facts.

SD01. Two mapped word write ports CHAR=08010230H, FLUSH=08010234H. Each
retains the full last written word, initially/reset0. Their write handlers
are mapped without read handlers, so normal mapped readback uses raw slots.
D:26-36,66-83 / mirror D:8-19,49-66; addresses I:110-114,167-171 and
mirror I:123-127,180-184; IO_BASE/word-size from memory_map leaf. No data/status
read handler or guest dequeue port is provided by these two-port owners.

SD02. CHAR interprets its word as a Unicode codepoint and appends encoded
UTF-8 bytes. 00000000H..0000007FH uses1byte,80H..7FFH2bytes,800H..FFFFH3bytes
except D800H..DFFFH,10000H..10FFFFH4bytes. Surrogates and values>10FFFFH append
single3FH ('?'). Raw CHAR readback remains the written word, including invalid
codepoint words. D:66-75 / mirror D:49-58; central U:56-81 / mirror U:117-141.
It is not an address, string handle, packed four-character word, or UTF-8 byte
port. No encoder needs adding to cartridge code.

SD03. CHAR itself never publishes the partial bytes, including when its word
is newline0000000AH. Every FLUSH write, including0, attempts to append one
ASCII LF byte0AH and publish the entire current retained byte count. It retains
its raw written word; value is not a length, threshold or enable mask. D:66-83 /
mirror D:49-66. This is the write-visible line completion edge, not a display
command, IRQ or drain-completion acknowledgement.

SD04. The shared output ring is8192bytes, holding completed unread and current
partial bytes together; encoding requires1..4bytes per CHAR. Insufficient room
for a whole codepoint or FLUSH's newline discards only the current partial
line, preserving all completed unread bytes, and marks the line overflowed.
Further CHAR writes append nothing until FLUSH clears that mark. An already
overflowed FLUSH publishes nothing but clears the mark. A FLUSH that first
runs out of space also discards partial/publishes nothing and clears the mark.
D:19-24,77-95,105-108 / mirror D:60-78,88-90 and
machine/cpp/machine/devices/system/debug_transmit.h:35-42; capacity I:424 /
mirror I:437. Successful publication is not proof of receiver draining; no
readiness/free-space/accepted-line counter is exposed by this owner. No baud
rate, physical connector or independent transmitter clock is defined here.

SD05. Reset empties output and zeros both port words. Retained save-state
fields contain only charWord and flushWord; restore clears completed/partial
bytes and overflow state, then restores those two raw words/slots. The output
queue is not serialized by this unit. D:9-12,31-51,98-102 / mirror D:14-35 and
header:12-15. These are editorial save-state facts, not new guest words.

SD06. Actual direct paired-owner replay passed33 total observations (shared
with access/timing). CHAR41H,0AH,E9H,D800H,1F600H,FFFFFFFFH gives no available
output beforeFLUSH; CHAR raw readbackFFFFFFFFH. FLUSH0 publishes11 bytes
41 0A C3 A9 3F F0 9F 98 80 3F 0A, rawFLUSH0. Exactly8192 unflushed ASCII'A'
words then FLUSH9 discards that full partial and publishes0bytes; CHAR still41H,
FLUSH9. Next CHAR42H/FLUSH0 publishes42 0A. Source operands and exact native/TS
observations: /tmp/bmsx-system-register-replay.{cpp,ts},
/tmp/bmsx-system-register-replay-{native,ts}.log. This is actual device execution,
not yet an ordinary guest or physical-output test. Existing System tests12TS,
rebuilt native system+CPU suites pass separately. No guest-side flow control,
on-screen print behavior or electrical throughput is inferred.

SD07. BIOS print converts each argument to text with tostring, inserts a tab
between arguments, calls console.write, then console.end_line (no console.flush
call). console.write appends each codepoint as <=FFH byte or replacement63 to
its own8192byte BIOS history and also writes raw fullcodepoint to CHAR.
console.end_line appends historyLF and writes FLUSH1. console.flush later reads
BIOS history into terminal.write_code. Raw CHAR/FLUSH owner never calls BIOS
history/terminal code: it only appends diagnostic ring bytes above. Thus raw
ports do not add BIOS console-history entries or draw glyphs; BIOS print sends
to BOTH diagnostic output and retained BIOS history, not an immediate display
flush. Sources machine/bios/base.lua:265-275,
machine/bios/tty/console.lua:6-17,19-66; diagnostic D:66-95.

---


## Guest alignment precedes the MMIO access boundary

SA06. Ordinary typed LOAD_MEM/STORE_MEM check scalar alignment before mapped
memory access. Misaligned Word/halfword enters address-error load/store, not a
new UNALIGNED_IO bus fault; byte has no scalar alignment restriction, but its
IO slot-address rule still applies. If an aligned scalar access reaches an
invalid IO width/offset, the Memory-owner SA03 rules apply. A new mapped-bus
fault triggers CPU data-bus error before successful result assignment; the
Memory leaf's zero return is not a successful guest load. Sources
machine/ts/machine/cpu/cpu.ts:3080-3088,3110-3129,3150-3152;
machine/cpp/machine/cpu/cpu_dispatch.inl:621-627,638-640,646-668; scoped ordinary
LOAD_MEM/STORE_MEM CPU facts EX09 and independent chapter source audit. No
universal precedence for every memory opcode is inferred.

## Shared INPUT context

INPUT is not part of the banked cartridge context. The paired context owner and
BIOS monitor sources are recorded once in [INPUT timing facts, IT09](input-timing.md#bios-and-supervisor-ownership--2026-10-19).
This does not resolve attachment calibration or output-receiver precision.
