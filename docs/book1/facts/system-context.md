# SYSTEM frozen CPU and device-boundary facts

2026-10-17; baseline ec4c5b27e. Separate paired-owner extracts, not public prose.
Source gaps in individual extraction scope are supplied by the other named sheets,
not inferred from function names. The direct CPU yield/HALT ordering disagreement
remains withheld. Current software supplies the documented contract.

# SYSTEM → CPU boundary facts (read-only extraction)

Baseline: `/home/boaz/BMSX`, `ec4c5b27e`, clean at start. No repository edits, implementation, tests, builds, framework, children, commits, `docs/architecture.md`, or reference PDF. The existing memory-lifecycle/boot/map and IRQ sheets were leads only; the authority below is the live paired owner/spec code. No universal CPU chapter or fixed interrupt latency is inferred.

`TSCPU` = `machine/ts/machine/cpu/cpu.ts`; `CPPCPU` = `machine/cpp/machine/cpu/cpu.cpp`; `CPPDISPATCH` = `machine/cpp/machine/cpu/cpu_dispatch.inl`; `TSSYS` = `machine/ts/machine/devices/system/controller.ts`; `CPPSYS` = `machine/cpp/machine/devices/system/controller.cpp`. Each row has one primary location and its live comparison. These are source-contract observations, not execution evidence.

## 1. Exact SYSTEM call boundary (writer → edge → CPU-visible result)

| ID | Writer / condition → CPU edge → direct result or limit | Primary | Mirror / comparison |
|---|---|---|---|
| SC01 | A CONTROL write with RESET sets SYSTEM's reset request, then calls `cpu.requestYield()`. It does not call CPU reset here. | TSSYS:139–143 | CPPSYS:91–95; agrees |
| SC02 | After RESET processing, ENTER, FAULT, FAULT_PUBLISH and LEAVE are processed in that order only when `!cpu.isUserMode()`. The gate tests CPU status privilege, not SYSTEM phase or execution-domain number. CONTROL's backing word is cleared after processing. | TSSYS:144–159 | CPPSYS:96–111; agrees |
| SC03 | On service, once GPU is quiescent and the transition target is SUPERVISOR, SYSTEM enters ENTRY_VECTOR, calls `cpu.abortStalledMemoryWrite()`, then `cpu.requestNonMaskableInterrupt()`, then publishes status and returns. This is the SYSTEM→CPU entry request edge, not immediate vector execution. | TSSYS:199–208 | CPPSYS:151–160; agrees |
| SC04 | ENTER/`activateSupervisorContext()` has **no CPU call**. At ENTRY_VECTOR it banks IRQ/DMA/GPU state, sets resumable and ACTIVE, and publishes status. At other phases it returns. CPU exception entry and device-context activation are distinct edges. | TSSYS:228–241 | CPPSYS:180–193; agrees |
| SC05 | FAULT first copies CPU Cause/EPC/BadAddress/LuaReason/ExceptionDomain through five getters and writes the six-word SYSTEM fault register bank, retaining its sequence word. This is an explicit CONTROL-command snapshot, not a CPU getter-backed live view. | TSSYS:243–249 | CPPSYS:195–201; agrees |
| SC06 | After that snapshot, FAULT in ACTIVE returns immediately. Otherwise it cancels only the pending CPU NMI latch; if starting in USER it begins device quiescence, then sets target FAULT and resumable false, schedules SYSTEM service, and requests CPU yield. | TSSYS:250–267 | CPPSYS:202–219; agrees |
| SC07 | FAULT_PUBLISH does not read CPU, copy the fault payload, or enter an exception. It increments the retained u32 sequence, wrapping modulo 2^32, and writes only the sequence I/O word. | TSSYS:269–273 | CPPSYS:221–225; agrees |
| SC08 | LEAVE is admitted only at ACTIVE with resumable true. It starts bus/GPU quiescence and target USER, clears exit-requested, schedules service and requests CPU yield. There is no CPU RFE or CPU frame pop in this method. | TSSYS:275–288 | CPPSYS:227–240; agrees |
| SC09 | After leave quiescence SYSTEM restores device contexts, sets phase/target USER and resumable false, resumes audio time, and publishes status. No CPU return/privilege/domain change appears in this branch. | TSSYS:215–225 | CPPSYS:167–177; agrees |
| SC10 | SYSTEM's `cpuHeld()` is true when target is not SUPERVISOR and phase is ENTRY_PRODUCER_QUIESCE or at/after BUS_QUIESCE. It is a predicate consumed elsewhere, not itself a CPU state write. | TSSYS:290–294 | `machine/cpp/machine/devices/system/controller.h:62–66`; agrees |

SC04/SC08/SC09 explicitly prevent conflating SYS_STATUS_RESUMABLE, a device-context state, with an already completed CPU return. Firmware and runtime continuation are separate dependencies.

## 2. CPU latch/acceptance leaves used by SYSTEM

| ID | CPU fact | Primary | Mirror / comparison |
|---|---|---|---|
| CP01 | `requestYield()` only sets `yieldRequested = true`; it does not reset, clear the call stack, set HALT, or enter an exception. | TSCPU:1585–1587 | CPPCPU:1639–1641; agrees |
| CP02 | `isUserMode()` is `(statusWord & CPU_STATUS_USER_MODE_CURRENT) != 0`; it does not inspect the current frame or active execution image. | TSCPU:1666–1668 | `machine/cpp/machine/cpu/cpu.h:286`; agrees |
| CP03 | `requestNonMaskableInterrupt()` sets one boolean pending latch. Repeated requests while set coalesce; `cancelNonMaskableInterrupt()` clears that boolean only. It does not unwind an accepted NMI frame or restore prior exception words. | TSCPU:1670–1678 | CPPCPU:2236–2240; cancel in `machine/cpp/machine/cpu/cpu.h:288`; agrees |
| CP04 | `abortStalledMemoryWrite()` clears only `memoryWriteBlocked`. It does not erase the saved raw address or edit the interrupted frame PC. The method name is not evidence that a store is committed or discarded. | TSCPU:1654–1656 | `machine/cpp/machine/cpu/cpu.h:285`; agrees |
| CP05 | Blocking a mapped write saves the **current instruction PC** back into its frame, sets the blocked boolean and raw target address, and clears yield. | TSCPU:1658–1663 | CPPCPU:2342–2347; agrees |
| CP06 | A device-ready `resumeMemoryWrite(address)` clears blocking only when blocking is set and the raw saved address equals its argument; it does not move PC or clear the saved address. | TSCPU:1647–1652 | CPPCPU:2349–2354; agrees |
| CP07 | `peekPendingInterrupt()` prefers pending NMI; otherwise maskable acceptance requires status IE-current and the IRQ controller asserted-line predicate. No IE or IRQ mask test is applied to the pending NMI branch. | TSCPU:1680–1693 | CPPCPU:2242–2255; agrees |
| CP08 | `enterPendingInterrupt()` handles pending NMI first, clears the pending latch, saves the previous five exception words, and enters the **system exception-function address** with NMI cause and the interrupted top frame's current PC. It marks the new frame NMI and retains the five saved words in NMI-return latches. | TSCPU:1695–1714 | CPPCPU:2257–2276; agrees |
| CP09 | Maskable acceptance chooses `activeExecutionImage.irqFunctionAddress` while in user mode and `systemImage.irqFunctionAddress` otherwise; EPC is the interrupted top frame's current PC. The vector choice is not based on SYSTEM phase/resumability. | TSCPU:1718–1725 | CPPCPU:2280–2283; agrees |
| CP10 | NMI and maskable acceptance each test whether any HALT-depth latch was present before entry; if none was present they set the retained interrupt-event latch. The common entry leaf clears the HALT latch. | TSCPU:1698,1715–1726 | CPPCPU:2260,2277–2284; agrees |
| CP11 | HALT consumes an already retained interrupt-event latch and returns without setting a HALT latch. Otherwise it records the active thread and current frame depth and clears yield. HALT's CPU meaning is not merely a spin/yield. | TSCPU:1611–1619 | CPPCPU:1643–1651; agrees |
| CP12 | A HALT latch counts as currently halted only for the same active thread and same current frame depth. | TSCPU:1635–1637 | `machine/cpp/machine/cpu/cpu.h:278–281`; agrees |
| CP13 | HALT opcode dispatch calls the `haltUntilIrq()` leaf. | TSCPU:2471–2473 | CPPDISPATCH:132–135; agrees |
| CP14 | In the normal running dispatch path, pending interrupts are checked before fetching the next decoded instruction, but after boundary checks for halt/blocking and budget. Do not derive wakeup-from-HALT integration or fixed request-to-vector latency from this loop alone. | TSCPU:1813–1827 | CPPCPU:2391–2430; same relevant acceptance relation; combined yield/HALT ordering excluded below |
| CP15 | Instrumented dispatch also prioritizes NMI, then offers the pre-maskable execution hook before maskable entry. The hook may stop execution instead of entering that maskable exception at that check. | TSCPU:1886–1900 | CPPCPU:2403–2423; agrees |

### Isolated disagreement: simultaneous yield plus halted/blocked state — STOP this scope

| Scope | TS location | C++ location | Frozen conclusion |
|---|---|---|---|
| Run-boundary result/consumption when yieldRequested and hardHalted, a matching HALT latch, or memoryWriteBlocked are simultaneously set | TSCPU:1809–1816 (normal), 1874–1881 (instrumented): consumes yield and returns Yielded first | CPPCPU:2391–2399: returns Halted before consuming yield | No shared ordering fact is publishable. This is a source disagreement only. Reachability through actual firmware/runtime, effects on cartridges, and whether any repair is needed are not established here. Do not extend it to disagreeing NMI priority/entry/RFE semantics. |

Direct conditions/call stack needed for root replay: SYSTEM CONTROL RESET → `requestYield` (SC01); non-ACTIVE FAULT → `cancelNonMaskableInterrupt`, schedule SYSTEM, `requestYield` (SC06); admitted LEAVE → schedule SYSTEM, `requestYield` (SC08). CPU HALT creates matching thread/depth latch (CP11/12); mapped write not-ready → `blockMappedWrite` creates blocked latch and clears yield (CP05); hard halt leaf sets hardHalted and clears yield (`TSCPU:1621–1626`, `CPPCPU:1653–1658`). This extraction does not prove the above combinations occur through ordinary guest execution.

## 3. Common exception entry, source-domain meaning and preserved state

| ID | CPU fact | Primary | Mirror / comparison |
|---|---|---|---|
| EX01 | Common entry samples **the interrupted top frame's execution image domain** into the u32 exception-domain word, writes EPC and Cause, shifts the low six status mode-stack bits left by two while retaining other status bits, clears HALT/thread/yield latches, and pushes a zero-argument exception frame with callSitePc equal to supplied EPC. | TSCPU:1764–1784 | CPPCPU:2312–2339; agrees |
| EX02 | The common entry leaf does not clear call stack, interrupted register slots, active thread, blocked-write latch/address, BadAddress or LuaReason. It adds an exception frame rather than EXEC-style replacement. This is the direct leaf's preservation scope, not a promise about later firmware. | TSCPU:1764–1784 | CPPCPU:2312–2339; agrees |
| EX03 | Synchronous exception entry rewinds the interrupted frame PC to `currentInstructionPc`, supplies the same PC as EPC, and uses the system exception-function address. | TSCPU:1732–1735 | CPPCPU:2290–2293; agrees |
| EX04 | An address exception first writes the supplied u32 address into BadAddress, then takes the synchronous entry path. | TSCPU:1737–1740 | CPPCPU:2295–2298; agrees |
| EX05 | Instruction-fetch exception entry charges one budget unit, sets the interrupted frame PC to the supplied PC and enters the system exception function with that EPC. Its leaf does not itself write BadAddress. | TSCPU:1742–1746 | CPPCPU:2300–2304; agrees |
| EX06 | The loop's misaligned-PC branch writes BadAddress = PC before entering instruction-fetch address-error-load. | TSCPU:1830–1834 | CPPCPU:2442–2445; agrees |
| EX07 | Lua-fault entry writes LuaReason, enters a synchronous TRAP exception, then places the encoded error value into exception-frame register 0. SYSTEM snapshots only the reason word, not that value. | TSCPU:1748–1762 | CPPCPU:2306–2310; agrees |
| EX08 | Run-loop out-of-memory, explicit thrown value and Lua execution errors first pass through `handleThreadError`. Only an unhandled result is converted to Lua-fault entry (respectively OUT_OF_MEMORY, EXPLICIT_ERROR, or error.reason). This is not a claim that every Lua `error` reaches SYSTEM. | TSCPU:1942–1966 | CPPCPU:2643–2658; agrees |
| EX09 | Ordinary LOAD_MEM/STORE_MEM alignment failure uses address-error entry. A mapped bus-fault-sequence change uses synchronous DATA_BUS_ERROR entry without writing BadAddress at that callsite. Thus the SYSTEM BadAddress snapshot is not automatically the fresh mapped-bus fault address. | TSCPU:3080–3088,3110–3127,3150–3152 | CPPDISPATCH:621–625,638–640,646–654,666–668; agrees |
| EX10 | The exception domain is an execution-image domain ID, not CPU privilege, an address, a fault type or SYSTEM phase. System domain -1 appears in the raw u32 snapshot as `ffffffff`; cartridge domains are 0 and 1. The system value follows EX01's u32 conversion. | `machine/ts/spec/blua32/execution_domain.ts:1–3` | `machine/cpp/spec/blua32/execution_domain.h:7–9`; agrees |
| EX11 | The CPU's system exception-function address is loaded from resolved system boot metadata at CPU reset; it is not a constant vector address established by this extraction. | TSCPU:869–871,897–906 | CPPCPU:431–435,463–471; agrees |
| EX12 | NMI/fault entry uses `pushFrame`, which resolves/reads its function record through the current bus domain mapping and pushes a frame whose executionImage/code PC come from that function record. This does not call `latchActiveExecutionImage`. | TSCPU:3187–3225 | CPPCPU:3049–3088; agrees |
| EX13 | `readFunctionRecordOnBus` asks `executionAddressSpace.domainIdOnBus(address,busSignals)` for a domain; a resolved domain selects its image, no resolved domain uses the ambient image. Address-space mapping itself was not opened in this pass. | TSCPU:1499–1508 | CPPCPU:1082–1092; agrees |

### Raw SYSTEM fault snapshot interpretation

| Field | Confirmed CPU source meaning | Primary | Mirror / comparison |
|---|---|---|---|
| Cause | Getter returns retained causeWord unchanged. Common entry replaces it with the selected exception cause (EX01). | TSCPU:2093–2095 | CPPCPU:2825–2827; agrees |
| EPC | Getter returns retained epcWord unchanged. Asynchronous entry uses interrupted current frame PC (CP08/09); synchronous entry uses faulting currentInstructionPc (EX03); firmware may write EPC before a later snapshot. | TSCPU:2089–2091,2109–2111 | CPPCPU:2821–2823,2841–2843; agrees |
| BadAddress | Getter returns retained badAddressWord unchanged. EX04/EX06 write it; unrelated common entry does not clear it. Do not label it universally valid/current solely because fault sequence changed. | TSCPU:2097–2099 | CPPCPU:2829–2831; agrees |
| LuaReason | Getter returns retained luaFaultReasonWord unchanged. EX07 writes it; unrelated common entry does not clear it. Interpret together with Cause, not as a mandatory newly produced reason for every snapshot. | TSCPU:2101–2103 | CPPCPU:2833–2835; agrees |
| Domain | Getter returns retained exceptionDomainWord unchanged. EX01 writes interrupted frame's domain, even though the exception runs through the system vector. | TSCPU:2105–2107 | CPPCPU:2837–2839; agrees |

Cause/LuaReason named numeric catalog, directly sourced rather than inferred from another ISA:

| ID | Spec value | Primary | Mirror / comparison |
|---|---|---|---|
| ENC01 | Status IE-current bit0, user-current bit1; entry shifts low-six mask `3f`, RFE restores low-four mask `0f`. System entry status=1; cartridge entry status=3. | `machine/ts/spec/blua32/cop0.ts:8–14` | `machine/cpp/spec/blua32/cop0.h:14–20`; agrees |
| ENC02 | Cause IRQ=`00000400`, NMI=`00010000`, code mask=`0000007c`; address-error-load=`10`, address-error-store=`14`, instruction-bus-error=`18`, data-bus-error=`1c`, coprocessor-unusable=`2c`, trap=`34` (all hexadecimal). No additional Cause bits are asserted here. | `machine/ts/spec/blua32/cop0.ts:16–24` | `machine/cpp/spec/blua32/cop0.h:22–30`; agrees |
| ENC03 | Lua reason numbers: UNKNOWN0, CALL_NON_FUNCTION1, INDEX_NON_TABLE2, ASSIGN_NON_TABLE3, INDEX_NIL4, METATABLE_LOOP5, ITERATE_NON_TABLE6, XPCALL_HANDLER_NOT_FUNCTION7, EXPLICIT_ERROR8, OUT_OF_MEMORY9, INVALID_ARGUMENT10. This catalogs the spec names, not every producer's reachability. | `machine/ts/spec/blua32/cop0.ts:26–36` | `machine/cpp/spec/blua32/cop0.h:32–42`; agrees |

## 4. CPU return and privilege (separate from SYSTEM LEAVE)

| ID | CPU fact | Primary | Mirror / comparison |
|---|---|---|---|
| RT01 | RFE in user mode takes coprocessor-unusable before returning. In privileged mode but on a non-exception frame, RFE hard-halts. It does not check SYSTEM phase/resumability. | TSCPU:2773–2781 | CPPDISPATCH:688–696; agrees |
| RT02 | Admitted RFE first retains current EPC as returnPc, closes/releases the exception frame, restores stackTop to the frame's varargBase, restores low-four status bits from the status shifted right two, and assigns the caller PC from that retained returnPc if a caller exists. | TSCPU:2782–2793 | CPPDISPATCH:697–707,715; agrees |
| RT03 | When that frame is marked NMI, RFE additionally restores Cause/EPC/BadAddress/LuaReason/ExceptionDomain from the five pre-NMI return latches. The caller PC is chosen **before** restoring the previous EPC. | TSCPU:2794–2800 | CPPDISPATCH:708–714; agrees |
| RT04 | Ordinary non-NMI RFE has no equivalent restoration of the five prior exception words. Neither RFE branch calls SYSTEM LEAVE or restores device contexts. | TSCPU:2773–2801 | CPPDISPATCH:688–717; agrees |
| RT05 | User-mode MFC0/MTC0 take coprocessor-unusable before their field access. Privileged MFC0 reads BadAddress/LuaReason/Status/Cause/EPC and returns zero for EXEC; unknown fields hard-halt. Privileged MTC0 writes Status/EPC or executes EXEC, ignores writes to BadAddress/LuaReason/Cause, and hard-halts for unknown fields. | TSCPU:2738–2771 | CPPDISPATCH:386–422; agrees |
| RT06 | Successful EXEC is a replacement edge: it clears the active call stack, latches the selected image/domain, sets entry status, clears HALT/event/blocked-address/hard-halt/yield state and pushes the selected static function with zero args. It is not the NMI/RFE resume path. | TSCPU:1523–1546 | CPPCPU:1095–1118; agrees |

## 5. Required callsites beyond this pass / explicit gaps

Only callsite names/line hits below were identified; these bodies were **not** inspected in this pass, to preserve the requested CPU-owner scope. Root is independently checking the runtime pair.

| Gap needed for complete SYSTEM teaching | Exact dependency / named callsite to replay |
|---|---|
| Wake a HALTed CPU and determine where SYSTEM hold gates interrupt acceptance | `machine/ts/machine/runtime/cpu_executor.ts:48–56,187–212`; paired `machine/cpp/machine/runtime/cpu_executor.cpp:20–28,168–193`; `cpu.enterPendingInterrupt()` with `systemController.cpuHeld()` |
| CPU-budget, service/deadline progression while blocked/HALT/held; do not infer from CP14 | `machine/ts/machine/runtime/cpu_executor.ts:152,187,211–212,256`; paired `machine/cpp/machine/runtime/cpu_executor.cpp:131,168,192–193,240` |
| RESET request's actual consuming edge / reset scope / reset order | `machine/ts/machine/runtime/frame/loop.ts:154` `takeResetRequest()`; paired `machine/cpp/machine/runtime/frame/loop.cpp:48`; continue into the named runtime reboot owner, not CP01 |
| Who produces supervisor line edges and whether those producers run in a halted/held boundary | External calls to `requestSupervisorLineEdge()` were not inspected. Need the actual producer and scheduler path. No input timing/host shortcut claims are made. |
| Firmware order linking ENTRY_VECTOR→ENTER, FAULT→quiesce→FAULT_PUBLISH, LEAVE→RFE; user-facing resume choices | Actual generated exception-vector producer and shared BIOS exception/supervisor handlers. CPU/SYSTEM leaves alone do not prove this firmware choreography or fault recovery policy. |
| Exactly which addresses bind to system/cartridge vector domains | `executionAddressSpace.domainIdOnBus` and boot descriptor resolution, called by EX11/EX13. The CPU contract here establishes selected vector *fields*, not undocumented addresses. |
| CPU behavior at invalid/corrupt exception vector record and nested synchronous faults; NMI-return latch overwrite if nested NMI is generated | Not generalized. `enterException` assumes its vector frame is pushable; this pass does not establish a public recovery/fallback contract or arbitrary nesting guarantee. |
| Complete mapped access forms / all bus/address fault producers | Only ordinary LOAD_MEM/STORE_MEM and misaligned fetch branch were read for the fresh-versus-retained BadAddress distinction. No universal access/fault side-effect claim. |
| Persistence/save-load ABI or all-state preservation | Not extracted. No claim that debugger snapshots/save states or SYS fault publication serialize every CPU state field. |
| Simultaneous yield+HALT/blocking ordering | Isolated source disagreement above; root must determine exact live reachability before deciding whether cartridge-visible chapter text is affected. No implementation proposal supplied. |

---

# SYSTEM reset and CPU-hold runtime boundary facts

Read-only paired-source extraction, baseline ec4c5b27e, 2026-10-17.
Narrow integration evidence, not source for a complete CPU or startup chapter.

SR01. CONTROL RESET latches a request and asks CPU to yield; reading CONTROL
is not request consumption. takeResetRequest returns the old latch and clears
it. Primary machine/ts/machine/devices/system/controller.ts:139-143,300-303;
mirror machine/cpp/machine/devices/system/controller.cpp:91-95,242-245.

SR02. Both frame-update and instruction-step entry consume pending reset before
preparing/running a scheduled frame. The ordinary update path also consumes
it after returning from CPU-budget execution. A consumed request calls
rebootSystem. Primary machine/ts/machine/runtime/frame/loop.ts:81-85,120-124,
152-158,220-223; mirror machine/cpp/machine/runtime/frame/loop.cpp:47-52,107-110,
147-151,185-189. No fixed request-to-reboot cycle latency follows from this.

SR03. rebootSystem resets frame/pending-call/completion state, clears IO/bus
faults, resets hardware, clears CPU execution environment, resets CPU, installs
boot primitives and schedules firmware entry. Primary
machine/ts/machine/runtime/runtime.ts:47-79,88-91; mirror
machine/cpp/machine/runtime/runtime.cpp:76-91,100-116. Do not infer full RAM
zeroing or cartridge/device persistence from this; exact boot DATA/BSS is in
already extracted memory-boot facts, not re-read in this narrow scope.

SR04. Hardware reset stops history, resets scheduler then all devices, resets
VBlank, configures installed timings, services GPU and applies published PCRTC
timing. Primary runtime.ts:48-55; mirror runtime.cpp:109-116. Device reset order
IRQ,input,DMA,cartridge,GEO,GPU,IMGDEC,GTE,APU,debugtransmit,SYSTEM is
machine/ts/machine/machine.ts:108-119 / machine/cpp/machine/machine.cpp:51-62.
Those calls name boundaries; this fact does not assert uninspected per-device
clearing of memory/buffers.

SR05. The stopped-CPU executor runs due timers and accepts a pending interrupt
only when SYSTEM does not hold CPU; it can advance hardware time to the next
deadline while the CPU is halted/held. With no scheduled deadline it returns,
not executing instructions to synthesize progress. Primary
machine/ts/machine/runtime/cpu_executor.ts:39-89; mirror
machine/cpp/machine/runtime/cpu_executor.cpp:12-61. Active slices also exclude
held CPU: TS:254-256 / C++:238-240. This is not a guarantee of IRQ acceptance
while held, nor fixed-duration HALT, host-wall time or a pause/resume callback.

SR06. The accepted CPU dependency remains separately scoped in
/tmp/bmsx-system-cpu-boundary-facts.md. In particular, TS and C++ direct CPU
run loops order simultaneous yield versus halt/blocked latches differently.
Do not claim a shared direct-run-loop precedence from these runtime facts or
silently repair it. Record exact scope/locations and test actual intended
routes separately; no cartridge-visible effect has been established yet.

Existing validation: tests/lua/system_controller.test.ts all12 pass; freshly
built bmsx_system_controller_tests and bmsx_cpu_supervisor_tests pass. Existing
runtime-reset case explicitly transfers firmware→cartridge then resets through
SYSTEM and observes firmware restart and valid later entry. This is bounded
existing execution evidence, not the forthcoming ordinary manual program or
full cross-device supervisor preservation proof.

---

# SYSTEM dependency: interrupt banks

Paired live owner read,2026-10-17 baseline ec4c5b27e. I=
machine/ts/machine/devices/irq/controller.ts and mirror
machine/cpp/machine/devices/irq/controller.cpp.

SQ01. Entry retains user pending FLAGS and MASK, marks supervisor bank active,
then starts active pending/MASK at0, publishing MASK/ACK0. Leave restores the
retained user FLAGS/MASK exactly, clears retained bank fields and deactivates
supervisor bank. The active supervisor pending/MASK are not OR-merged back.
Primary I:28-32,54-69; mirror I:44-60 I:24-27.

SQ02. Ordinary raise targets active pending. raiseUser instead targets retained
user pending while supervisor bank active; outside it, raiseUser is ordinary
raise. Both OR bits, not counts. I:76-88 / mirror I:29-41. This fact does NOT
identify all event producers; name source-specific destinations only after
reading the actual raise versus raiseUser callsites.

SQ03. System activation banks IRQ before DMA/GPU; its source comment explicitly
identifies GPU reset's ACK as acting on the now-active bank. System controller
TS:228-240 / C++:180-193.
No GPU reset details imported through the comment. Final leave invokes IRQ
restore after DMA/GPU/GEO/IMGDEC leave; separate controller facts own sequence.

No fixed bank-switch latency or IRQ-delivery guarantee inferred; normal IRQ/CPU
semantics remain the published IRQ chapter.

---

# SYSTEM dependency: DMA quiescence and banks

Paired live boundary extract,2026-10-17 baseline ec4c5b27e. D=
machine/ts/machine/devices/dma/controller.ts and mirror
machine/cpp/machine/devices/dma/controller.cpp and .h.

SB01. Initial control quiesce sets flag gating mapped TRIGGER writes; it does
not yet stop admission of work from already BUSY channels. Later bus quiesce
sets admission-stop flag too. Arbitration with this flag returns without
admitting a new block. Predicate=admission requested, no active channel and no
service in progress. D:92-103,305-318,386-409 / mirror.cpp:16-27,235-242,310-333;
.h:48. No all-channel-control write protection is inferred from TRIGGER gate.

SB02. An already admitted block executes its whole scheduled word loop at
service, updates read/write/count words, releases admitted block, conditionally
finishes channel and then arbitrates. The quiesce request does not cancel that
block midway or require the entire BUSY transfer count to reach0. D:211-254 /
mirror.cpp:141-184. Normal block/route costs remain DMA chapter, not an invented
universal transition delay or transfer-rate guarantee.

SB03. Enter banks channel register state plus next-channel arbitration cursor,
clears active DMA context, removes quiesce flags. Clear cancels DMA service,
clears admitted block and channel registers/mirrors, resets next cursor0 and
service/restore state. Leave first clears supervisor live context, copies the
retained user channels back, mirrors them, restores cursor, removes flags,
clears bank and resumes arbitration at current cycle. D:321-347 / mirror.cpp:
245-271. No payload RAM copy, separate memory bank, successful-whole-transfer
promise or private external request-line snapshot is performed by these methods.

SB04. SYSTEM is notified at current cycle only when quiesce requested and
predicate true. D:533-536 / mirror.cpp:458-461. Request lines can recompute
independently; retained channel register words are not a blanket pause of all
memory/device events.

Paired source agreement in scope. Existing System tests include staged DMA
quiescence; no new multi-device guest transfer stress test inferred here.

---

# SYSTEM dependency: GPU/PCRTC quiescence and banks

Paired live boundary extract,2026-10-17 baseline ec4c5b27e. G=
machine/ts/machine/devices/gx/gpu.ts and mirror
machine/cpp/machine/devices/gx/gpu.cpp. P=gpu_pcrtc.ts/.cpp in same directories.

SX01. Control quiesce gates GP1 write readiness. Later ingress quiesce requests
stopping GP0 ingress; it stops immediately if no admitted DMA block writesGP0,
otherwise predicate update waits for that admitted block to cease. GP0 DMA
readiness excludes stopped ingress; CPU readiness additionally requires empty
DMA ingress, free CPU FIFO room and no DMA owner of port. G:904-928,2025-2058 /
mirrorG:434-458,1499-1508,1534-1536. Do not treat initial control quiesce
as immediate total GP0 stop or arbitrary readback cancellation.

SX02. Fence ready requires ingress quiesce requested/stopped, no pending command
completion, empty DMA ingress and CPU FIFO, readback phaseIDLE, commandCount0.
It does NOT require zero partial packet-assembly words. G:930-937 /
mirrorG:460-467. This is distinct from GP1.IDLE or a whole rendered-frame /
physical-display completion guarantee. No constant fence latency established.

SX03. Entry first updates live status, retains user register and ingress
contexts, clears quiesce flags and resets transient GPU state before installing
supervisor PCRTC composition. Leave resets supervisor transient state, restores
user ingress/register contexts, marks presentation pending and clears retained
banks. G:577-625,669-744,940-962 / mirrorG:262-274,470-492 plus register/ingress helper
bodies atG.cpp:97-156,178-217. Retained user registers include draw/texture/area/
offset/mask, display words, programmed and presented PCRTC composition words.
Ingress fields include partial packet/image-load/polyline assembly and staged
command-buffer words. This is register/command retention, not a VRAM byte copy.
The entry/leave methods do not call VRAM save/restore; their separate full save
methods do: G:965-977 / mirrorG:495-506. Shared VRAM remains shared; the MEMORY
chapter's actual firmware surface/texture reservation must still be respected.

SX04. PCRTC bank capture/restore copies only composition words, not beam timing
words/epoch. Supervisor entry resets composition then maps user's PRESENTED
circuit1 DISPFB/DISPLAY into circuit2, user's EN1 into EN2, and copies presented
BGCOLOR. Those programmed composition words are also published as presented.
P:779-813 / mirrorP:501-535. This is neither duplication of framebuffer bytes
nor restoration of beam timing/phase on leave. Programmed-but-unpresented
composition is retained in user bank separately. Exact composition bit layouts
remain the published PCRTC chapter.

Paired source agreement in the listed switch/fence/readiness bodies.
No new backend/physical output test or all-GPU-state preservation claim.

---

# SYSTEM dependency: GEO quiescence

Live paired-owner read,2026-10-17 baseline ec4c5b27e. Narrow dependency only.
Owner G=machine/ts/machine/devices/geometry/controller.ts; mirror
machine/cpp/machine/devices/geometry/controller.cpp and controller.h.

SG01. Beginning supervisor quiescence sets a request flag, blocks new mapped
CMD writes through write-readiness and schedules SYSTEM at the current cycle.
It does not reset the active job. Quiescent means phase is not BUSY; successful,
error and rejected terminal phases all meet that predicate. Leaving supervisor
clears the request flag. G:104-117,278-295 / mirror .cpp:49-62,137-150;
.h:37-39. No separate GEO register bank is created by these methods.

SG02. Existing job service and normal terminal result writes remain in place.
Success latches DONE/processed/zero fault then raises GEO_DONE; error records
DONE|ERROR and packed fault then raises GEO_ERROR; rejection records REJECTED
then raises GEO_ERROR. All terminal routes notify SYSTEM if quiesce requested.
G:375-436 / mirror .cpp:285-345. Thus a completion during entry is a normal
result/IRQ, not an implicit abort, acknowledgement or successful-job guarantee.
The existing GEO chapter owns each command/result encoding and record time.

SG03. Only CMD has the supervisor write-readiness gate here. Configuration
writes remain their normal register writes; CTRL and FAULT_ACK retain existing
handlers. G:104-117,120-122 / mirror .cpp:49-67. Do not broaden this into all-GEO
MMIO blocked, complete shared-memory isolation, an internal snapshot copy or
proof that arbitrary privileged code can safely reuse live GEO state.

No new execution test in this narrow extract; existing System owner tests and
the full GEO manual/cart evidence are separate, bounded evidence.

---

# SYSTEM dependency: IMGDEC quiescence

Live paired-owner read,2026-10-17 baseline ec4c5b27e. Narrow dependency only.
D=machine/ts/machine/devices/imgdec/controller.ts; mirror
machine/cpp/machine/devices/imgdec/controller.cpp and controller.h.

SI01. Begin quiescence sets request flag, recomputes DMA request lines and
notifies SYSTEM if already quiescent. Predicate=requested and no scheduled
decode words; it does not require full stream completion, empty FIFOs or
STATUS.BUSY0. Existing scheduled batch still decodes on its deadline. While
requested, service schedules no next batch. D:264-295,357-360,544-547 /
mirror .cpp:169-198,258-260,449-452;.h:63-65.

SI02. Both IMGDEC input/output DMA ready lines are suppressed while requested;
the corresponding STATUS request bits follow these computed lines. New mapped
configuration writes require both !active and !requested; CPU DATA write
readiness also excludes requested, whereas the DMA-master readiness branch
returns true independently. Do not teach cancellation of an already admitted
DMA block from this gate. D:486-509,579-580,629-641 / mirror .cpp:391-414,
486-488,535-544. Existing DMA-block completion scope requires the DMA owner.

SI03. Leaving clears request, attempts to schedule next decode at current
cycle, restores normal computed DMA request lines and resumes config writes.
No reset/clear of stream/FIFOs/history or separate bank occurs in these methods.
D:274-281 / mirror .cpp:175-182. A stream may remain partially decoded
when the current batch boundary is reached; idle/completed states also meet
the predicate and a final batch can finish. Quiescence does not require DONE
or a whole upload, or grant another owner permission to overwrite retained state.

SI04. Normal stop cancels scheduled decode, suppresses request lines, writes
terminal status and raises IMGDEC IRQ, then notifies SYSTEM. D:525-547 / mirror
.cpp:430-452. This remains distinct from merely pausing at a batch boundary.

No new execution test in this narrow extract; no universal batch latency or
source-format contract inferred. The existing IMGDEC chapter owns those facts.

---

# SYSTEM dependency: APU voice clock hold

Paired live boundary extract,2026-10-17 baseline ec4c5b27e. C=
machine/ts/machine/devices/audio/controller.ts and mirror
machine/cpp/machine/devices/audio/controller.cpp. S=
machine/ts/machine/devices/audio/service_clock.ts and mirror
machine/cpp/machine/devices/audio/service_clock.cpp.

SV01. Controller's hold call delegates directly to service clock. Changing the
hold first synchronizes to the current cycle, then records held state. Holding
clears queued output samples and cancels normal APU service; release schedules
normal APU service again. Calling with unchanged held state does nothing.
C:182-183 / mirror C:89-90; S:98-109 / mirror S:136-147.

SV02. While held, advancing voice time updates lastCycle but returns before
accruing samples, advancing active slots or sampleSequence. Thus elapsed held
cycles do not become a deferred voice catch-up workload. Fractional sample
carry is not cleared by that branch. Normal scheduleNext cancels APU service
while held. S:129-142,207-221 / mirror S:167-180,202-216. No voice reset, memory
snapshot or separate voice bank is performed by this method.

SV03. The synchronization loop still completes already scheduled sample-transfer
work on its deadline, independently of the voice-held early return. S:118-126 /
mirror S:156-164. Holding voices is not a blanket promise that transfers, DMA,
APU MMIO and every APU state change stop. The existing APU chapter owns the
sample-transfer datapath, request and memory contracts; this narrow extraction
does not assert unlimited transfer throughput or status/IRQ behavior.

Source agreement in this named boundary; no new audio playback/physical output
claim or dedicated execution test added here.

---
