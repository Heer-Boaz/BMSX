# CPU boundaries: bounded paired source facts

Read-only extraction at baseline `375de6170`, 2026-10-17. No architectural documents, PDF, compiler, chapter prose, or other authors' output used. The opcode sheet was an identity index only; this extraction inspected live source. No runtime or repository edits. This is the frozen inspected scope, not a whole-CPU audit.

## Source keys

- T: `machine/ts/machine/cpu/cpu.ts`
- C: `machine/cpp/machine/cpu/cpu.cpp`
- D: `machine/cpp/machine/cpu/cpu_dispatch.inl`
- TH: `machine/ts/machine/cpu/call_state.ts`; CH: `machine/cpp/machine/cpu/call_state.h`
- FT: `machine/ts/spec/blua32/instruction_format.ts`; FH/FC: `machine/cpp/spec/blua32/instruction_format.h` / `instruction_format.cpp`
- ET: `machine/ts/machine/runtime/cpu_executor.ts`; EC/EH: `machine/cpp/machine/runtime/cpu_executor.cpp` / `cpu_executor.h`
- ST: `machine/ts/machine/scheduler/device.ts`; SC/SH: `machine/cpp/machine/scheduler/device.cpp` / `device.h`

AGREES below means the named bounded source leaves agree, not runtime replay, performance, electrical timing, or universal malformed-state conformance.

## Instruction words, formats and encoding limits

| ID | Paired fact | Exact evidence |
|---|---|---|
| BF01 | Instruction words are four bytes, stored/fetched big-endian. Word bits: ext31–24, opcode23–18, low A17–12, low B11–6, low C5–0. The opcode field is six bits. | FT:1–14,44–70; FH:8–20; FC:11–41; actual fetch T:1271–1278 / C:838–845. AGREES. |
| BF02 | Ordinary ABC splits ext into A's two high bits, B's three high bits, C's three high bits. Without WIDE, raw A is8 bits (0–255), raw B/C9 bits (0–511). With WIDE, A14 bits (0–16383), raw B/C15 bits (0–32767). | FT:7–14,20–33; FH:13–20,26–39; T:1304–1333; C:874–921. AGREES. These are encoding ranges, not allocated register counts. |
| BF03 | For Bx formats A is6 bits unprefixed /12 prefixed (0–63 /0–4095). Unsigned Bx is20 /26 bits (0–1048575 /0–67108863). Signed Bx is−524288…524287 /−33554432…33554431. Bx combines body low B/C, body ext, and prefix B; prefix C does not contribute to Bx. | FT:3–14,24–33,39–41; FH:9–20,30–39; FC:6–8; T:1307–1326,1331; C:877–919. AGREES. |
| BF04 | Displacement formats use ext as unsigned8-bit displacement. A/B/C are each6 bits unprefixed /12 prefixed (0–63 /0–4095). Prefix bits do not extend disp. Memory displacement uses words: effective byte address is u32(base+4×disp); B is a register, not RK. | T:1307–1319,1331–1333,1363,2992–2998; C:877–904,917–921,951; D:554–555,579–580,605–606. AGREES. |
| BF05 | RK consumers sign-extend ordinary B/C to9 bits, or15 bits with WIDE. Thus RK is−256…255 /−16384…16383; nonnegative selects register, negative selects constant index−1−RK. Each RK field can select register0…255 or constant0…255 unprefixed, register0…16383 or constant0…16383 prefixed. These are encoding limits, not proof of storage availability. | T:1355–1362,3589–3597; C:943–950; `machine/cpp/machine/cpu/cpu.h:447–452`. AGREES. Do not apply RK interpretation to operands whose handlers consume raw B/C. |
| BF06 | Decode consumes zero or one WIDE prefix: first WIDE supplies six high bits each from its A/B/C, followed by exactly one body word. There is no prefix loop. The prefix ext byte is not used to extend operands. If the body opcode is again WIDE and execution reaches its handler, it hard-halts. This is not an arbitrarily chainable prefix or a separately executed zero-cost operation. | T:1265–1298,2306–2308; C:832–868; D:1–4. AGREES. |
| BF07 | Branch target is u32(instruction-start PC + complete width×4 + signedBX×4). Complete width is1 or2 words, including WIDE. Jump handlers assign this precomputed target. | T:1323–1326,1343–1348,2849–2863; C:909–912,931–936; D:424–440. AGREES. |

## Fetch, advancement and skip

| ID | Paired fact | Exact evidence |
|---|---|---|
| FF01 | Before normal instruction decode/dispatch, misaligned PC (low two bits nonzero) writes BadAddress and enters AddressErrorLoad through instruction-fetch exception entry. | T:1830–1839,1909–1917; C:2435–2463. AGREES. |
| FF02 | Decode snapshots bus-fault sequence, reads the first word big-endian, and for WIDE reads a second word at PC+4. A new bus fault on either read enters InstructionBusError with the instruction-start PC, including the prefix address for a second-word failure. | T:1265–1298; C:832–868. AGREES; top-address wrap is separately stopped below. |
| FF03 | Fetch-exception entry subtracts one cost unit, leaves interrupted frame PC at the supplied fetch PC, and enters the exception using that PC. This is a fetch-exception charge, not dispatch of an unfetched body's nominal base cost. | T:1742–1745; C:2300–2303. AGREES. |
| FF04 | Once decoded, the run loop records current instruction start, advances frame PC by full width×4, records lastPc at the body word (start+(width−1)×4), subtracts dispatch base cost, then invokes the handler. | T:1842–1854,1920–1933; C:2465–2507. AGREES away from the explicitly stopped PC-overflow boundary. |
| FF05 | Skip-next decodes the next instruction if needed with fusion disabled and advances over its full decoded width, including a WIDE body. It does not invoke the skipped handler or subtract its nominal base cost. A decode/fetch failure can still enter the fetch exception. | T:1994–2003; C:1008–1016. AGREES away from PC-overflow boundary. EQ/LT/LE use it: T:2692–2698,2733–2735,2844–2846; D:341–353,356–368,371–383. |
| FF06 | Normal decoding has bounded successor lookahead for selected numeric pairs. It can decode the successor before executing the current instruction and propagates that decode failure; therefore do not publish a universal rule that only the instruction about to execute is ever fetched. | T:1381–1412; C:971–998. AGREES. This extraction does not broaden speculative-fetch/cache visibility beyond those named paths. |
| FF07 | Execution bus signals are latched from active image domain: system domain uses CPU-master signals; cartridge domains use cartridge-slot signals. Instruction decode reads with that latched execution bus, not a blanket assertion that instruction fetch uses ordinary data selection. | T:1145–1155,1271,1288–1290; C:665–674,838,858–860. AGREES. Domain mapping/admission beyond these leaves is not re-audited. |

## Base charging, admission, scheduler and elapsed machine cycles

| ID | Paired fact | Exact evidence |
|---|---|---|
| BT01 | Each run grant replaces instructionBudgetRemaining. Before beginning another ordinary instruction the loop checks remaining<=0. It does not compare the next instruction's full cost against the positive remainder. Once admitted, base cost is subtracted before the handler. Consequently an instruction can execute with a positive remainder smaller than its cost and leave a negative remainder. | T:1802–1805,1818–1820,1842–1854; instrumented T:1863–1866,1883–1885,1920–1933; C:2356–2362,2400–2402,2465–2480. AGREES. |
| BT02 | Handler admission failures occur after this base subtraction: e.g. CP0 privilege rejection and memory alignment/readiness rejection. Blocking does not refund base charge. A later retry re-enters ordinary dispatch and is base-charged again. Sequence surcharge is only after successful readiness preflight. | T:2738–2741,2992–3024 plus FF04; D:386–389,554–618 plus C:2474–2493. AGREES. A blocked readiness attempt performs no store; executor waits rather than polling readiness. |
| BT03 | Generic additional charges subtract from the same remaining grant. There is no mid-handler general budget guard in charge/CYCLES_ADD. This does not promise an unbounded maximum overshoot: each instruction/helper's dynamic cost still matters. | T:1990–1992; C:2493. AGREES. |
| BT04 | Execution dispatch cost table starts with the64 opcode base costs. Fused numeric pairs charge the first instruction's base initially, test remaining before the second, then charge the second separately. Observation dispatch has zero own base and charges original opcode once before executing it. Do not multiply WIDE prefix width by body base cost. | `machine/ts/machine/cpu/execution_image.ts:20–24`; `machine/cpp/machine/cpu/execution_image.cpp:7–14`; T:2236–2261,2295–2304; C:2534–2561,2580–2607,2624–2629. AGREES. |
| BT05 | Regular executor first services due timers, limits CPU slice to remaining frame budget, caller maximum, and next scheduled deadline, then computes consumed = grant−remaining. If consumed>0, it subtracts that complete amount from frame budget, adds to activeCpuUsedCycles, and advances machine devices by consumed. Therefore a negative CPU remainder is counted as actual charged cycles, not clipped to the grant. | ET:244–295; EC:227–282. AGREES. |
| BT06 | Scheduler's in-slice current time is slice-base cycle +(grant−remaining); outside a slice it uses schedulerNowCycles. A CPU slice brackets runUntilDepth with active-slice state. | ST:52–80; SC:33–43; SH:34–40. AGREES. |
| BT07 | A new device deadline at or before active slice target requests CPU yield, rather than rewinding an already executed instruction. | ST:106–110,184–191; SC:69–73,146–153. AGREES. Direct simultaneous yield/HALT precedence is stopped below. |
| BT08 | Blocked-write regular execution advances toward scheduled events without retrying/polling the instruction; wait cycles are counted against frame budget and activeCpuUsedCycles. A ready edge, not executor polling, releases the CPU blocked-write state. | ET:257–273; EC:241–258. AGREES. Specific device ready-edge production remains device-owned. |
| BT09 | IRQ-HALT/CPU-held stopped execution services due timers and advances idle machine cycles toward scheduled deadlines while budget permits; if no deadline exists it returns without drawing down the budget. No fixed wall-clock HALT duration is established. | ET:39–89; EC:12–62. AGREES. |
| BT10 | Machine advanceDevices adds the supplied cycle count to scheduler time (and accrues geometry cycles); advanceRuntimeTime then services due timers. | `machine/ts/machine/machine.ts:129–132` / `machine/cpp/machine/machine.cpp:72–75`; ET:322–339 / EC:308–325. AGREES. |
| BT11 | Maximum individual executor slice grant is0x7fffffff cycles. This is a slice cap, not an architectural instruction count, call-depth limit, or encoded register capacity. | ET:11,275; EH:12; EC:260–262. AGREES. |

## Clock basis: inspected declarations and consumption, installation gap

BC01. Paired machine-model definitions select33,868,800 Hz (`machine/ts/spec/bmsx/model.ts:7,46–56`; `machine/cpp/spec/bmsx/model.h:12,51–61`). Paired runtime TimingState constructors consume model.cpuFreqHz as cpuHz and derive cycles/millisecond and frame budget (`machine/ts/machine/runtime/timing/state.ts:23–32`; `machine/cpp/machine/runtime/timing/state.cpp:10–22`). This confirms the declared model basis and TimingState consumption. **The complete actual product config/install chain was not inspected before this time-box freeze. Do not claim this sheet proves that every launched target installs this model or that no runtime override exists.** Root requested this chain; it remains an explicit gap, not a reason to infer installation from the declaration.

## Ordinary guest values versus words; resources and startup

| ID | Paired fact | Exact evidence |
|---|---|---|
| BR01 | Ordinary registers hold guest values, not uniform u32 words. The numeric payload uses64-bit floating-point Number/double; non-numeric value kinds remain distinct. A raw memory Word load converts u32 to a guest Number rather than copying a whole encoded guest value. CP0 raw words and instruction words are separate representations; internal value storage is not a guest memory ABI. | `machine/ts/machine/cpu/value_slots.ts:25–40,124–138`; `machine/cpp/machine/cpu/value.h:29–40,95–148`; T:3091–3092,3114; D:563,575; raw CP0 T:279–289 / `machine/cpp/machine/cpu/cpu.h:499–509`. AGREES at guest semantic level; internal representations intentionally differ. |
| BR02 | New root-thread backing stack starts with8 value slots and stackTop0; frame list starts empty. Constructor makes root thread Running and reserves64+8×8 tracked bytes. This is backing storage, not8 architectural registers per function. | `machine/ts/machine/cpu/thread.ts:7–26`; `machine/cpp/machine/cpu/thread.h:11–26`; T:482–507; C:392–397. AGREES. |
| BR03 | A pushed function frame takes entry PC from function record codeAddress, initial top from numParams, vararg count from actual surplus arguments only for vararg functions, and initial register capacity max(maxStack,1). Declared register slots are initialized Nil before parameters are copied; missing parameters become Nil. Frame addresses/registers are frame-relative. | T:3175–3184,3218–3248,3261–3298; C:3005–3045,3077–3123. AGREES for declared maxStack slots; spare slot maxStack0 is bounded separately below. |
| BR04 | Register backing storage can grow: thread backing rounds up with a minimum8, reserves tracked stack bytes, and rebinds/pointer-refreshes frames. Explicit register growth also grows in power-of-two buckets with a minimum8. Opcode bit width alone neither allocates that capacity nor guarantees all encoded indices are usable in every frame. | T:523–545,3441–3470; C:3155–3190,3419–3432. AGREES for ordinary admitted sizes. No whole-range huge-allocation or malformed maxStack conformance established. |
| BR05 | No fixed call-depth admission check appears in the inspected pushFrame/pushLatchedFrame leaves. MAX_POOLED_FRAMES=32 controls only retained reusable released frames, not maximum active depth. Do not translate this absence into an unlimited recursion guarantee. | T:257,797–837,3187–3299; `machine/cpp/machine/cpu/cpu.h:548–551`; C:2995–3124,3364–3385. AGREES for named leaves. |
| BR06 | Stack growth reserves8 tracked bytes per slot. Lua heap capacity is installed ramByteCount−BASE_RAM_USED_SIZE; reserve may collect and then throws out-of-memory if still over capacity. Current paired model declaration has4MiB RAM and BASE_RAM_USED_SIZE=512KiB, yielding3.5MiB tracked capacity for that model, shared with other tracked values rather than wholly available for registers. | `machine/ts/machine/cpu/thread.ts:8–9`; native thread.h:12–13; T:532 / C:3423; `machine/ts/machine/cpu/lua_heap.ts:21–58` / `machine/cpp/machine/cpu/lua_heap.cpp:11–33`; model TS:54 /native:59; `machine/ts/spec/bmsx/memory_map.ts:27–29` / `machine/cpp/spec/bmsx/memory_map.h:33–35`. AGREES. Full installed model chain remains BC01 gap. |

## Actual constructor versus reset

| ID | Paired fact | Exact evidence |
|---|---|---|
| BZ01 | Constructor field initialization uses Status CART_ENTRY=3, zero Cause/EPC/BadAddress/LuaFaultReason/exception-domain and retained NMI words, no HALT latch (depth−1/thread null), pending flags false, currentInstructionPc0, lastPc0, grant0. Constructors make root Running but do not themselves call CPU.reset or push the boot frame. Do not label constructor initializers as the reset vector contract. | T:259–293,482–507; `machine/cpp/machine/cpu/cpu.h:351–353,490–516`; C:358–398; `machine/ts/spec/blua32/cop0.ts:8–14` / `machine/cpp/spec/blua32/cop0.h:14–20`. AGREES. |
| BZ02 | Actual reset resolves system domain boot, clears completion/call stack, removes HALT/blocked/hard-halt/pending-event/NMI/yield state, sets Status SYSTEM_ENTRY=1, zeroes Cause/EPC/BadAddress/LuaFaultReason/exception-domain and all retained NMI-return words, clears execution-image/closure caches, activates/latches system image and its exception function, then pushes system startup static function with zero arguments. | T:869–908; C:431–472. AGREES. |
| BZ03 | Reset PC comes from the selected system startup function's function record via pushFrame, not an inferred fixed instruction address0. The reset leaf does not explicitly reset every CPU diagnostic/grant field (e.g. lastPc, currentInstructionPc, instructionBudgetRemaining); no wholesale every-field-zero claim is justified. | T:869–908,3194–3207,3221–3225; C:431–472,3051–3065,3085–3088. AGREES for explicit assignments and named calls. Full firmware startup function/address production is outside this extraction. |
| BZ04 | Clear-call-stack closes/removes active/resumer-chain frames, resets occupied register-stack ownership/top, sets root Running, completion thread root, and clears threadSwitchRequested. This supports reset's call-stack boundary, not a claim that every guest thread object is reset. | T:841–866; C:3388–3415. AGREES at the bounded ownership boundary. Backing-array clearing extent differs; do not publish identical unused-capacity bytes/values. |

## Isolated stops and nonclaims

1. **BX01 — sequential/skip PC overflow:** T stores frame PC as number (`TH:18`) and performs uncoerced additions in T:1845,1924,1995–2003,2256; native frame PC is u32 (`CH:28`) with u32 additions in C:1015–1016,2467,2554–2555,2600–2601. At the top-of-u32 address-space boundary, these assignment representations are not the same. Do not claim a universal shared modulo-u32 sequential/skip PC contract. The branch target's explicit modulo conversion BF07 agrees. No reachability, mapped target behavior, or runtime fault consequence is claimed for this narrow difference.
2. **BX02 — maxStack0 spare-slot initialization:** TS clears max(maxStack,1) slots (T:3176–3183), native allocates max(maxStack,1) but fills only maxStack slots (C:3022–3028,3099–3105). Declared maxStack slots agree; a universal newly allocated/spare slot Nil guarantee for a reused maxStack0 frame is not established. Do not turn this source difference into a claim of guest-visible failure, or claim it affects every reset startup.
3. **BX03 — already isolated requested-yield versus HALT/hard-halt/blocked precedence:** TS checks/consumes requested-yield first (T:1809–1816,1874–1881); native checks halt/blocked first (C:2391–2399). No shared simultaneous-state result/consumption order is asserted. Do not resolve it in prose or extrapolate it to RFE/NMI.
4. **BX04 — unsupported scalar kinds:** Existing isolated issue remains outside a common scalar memory contract. No reserved-kind trap/fallback or whole-machine malformed-kind behavior is established by these ranges. This task does not resolve it.
5. Encoding maxima are not allocated resource capacities. No malformed operand/index safety, unlimited stack/recursion, whole-address-space fetch admission, atomic memory sequence, rollback, electrical bus bandwidth, exact IRQ latency, or wall-clock wait guarantee is derived.
6. Full installed product config/model chain, full firmware startup producer, all metadata admission/huge-allocation limits, all builtin dynamic charges, and whole-library ownership/accounting are explicit unextracted gaps. This frozen sheet is sufficient only for its bounded decode/fetch/base-charge/scheduler/reset/resource facts.

## Root closure-format addendum

BF08. CLOSURE register-address flag is decoded C bit14 (1<<14), supplied by
WIDE prefix C bit5. It does not extend Bx: Bx's high six bits are prefix B.
Primary `machine/ts/spec/blua32/instruction_format.ts:35–36` and consuming
`machine/ts/machine/cpu/cpu.ts:2865–2870`; mirrored
`machine/cpp/spec/blua32/instruction_format.h:41–42` and consuming
`machine/cpp/machine/cpu/cpu_dispatch.inl:443–446`. Paired agreement; this is
not an extra opcode or a new local encoding helper.
