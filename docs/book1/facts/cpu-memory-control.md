# CPU memory and control: bounded paired facts

Documentation-only extraction; no implementation proposal. Scope is the named instruction handlers and their narrow called leaves. No architecture document, PDF, compiler, device-port implementation or reference project was used. Full fetch/decode, run-loop budget charging and SYSTEM/executor integration belong to the root extraction. Source line numbers are from the current checkout on 2026-10-17.

## Source keys

- **T** = `machine/ts/machine/cpu/cpu.ts`
- **D** = `machine/cpp/machine/cpu/cpu_dispatch.inl`
- **C** = `machine/cpp/machine/cpu/cpu.cpp`
- **TH/CH** = `machine/ts/machine/cpu/value_slots.ts` / `machine/cpp/machine/cpu/value.h`
- **MT/MC** = `machine/ts/machine/memory/memory.ts` / `machine/cpp/machine/memory/memory.cpp`
- **OT/OC** = `machine/ts/spec/blua32/opcode.ts` / `machine/cpp/spec/blua32/opcode.cpp`
- **IT/IH** = `machine/ts/spec/blua32/instruction_format.ts` / `machine/cpp/spec/blua32/instruction_format.h`
- **KT/KH** = `machine/ts/spec/blua32/memory_access_kind.ts` / `machine/cpp/spec/blua32/memory_access_kind.h`
- **PT/PH** = `machine/ts/spec/blua32/cop0.ts` / `machine/cpp/spec/blua32/cop0.h`

Disposition **AGREES** means the cited TS/C++ owners agree for the described fact, not universal conformance or timing proof. **STOP** excludes the affected unsupported/mismatched behavior from a shared architectural assertion. **DEPENDENCY** leaves integration with the root.

## Encoding and handler operands

| ID | Bounded fact | TypeScript evidence | C++ evidence and paired disposition |
|---|---|---|---|
| E01 | Opcodes, decimal: LOAD_MEM_D=4, STORE_MEM_D=12, STORE_MEM_WORDS_D=13, MFC0=38, MTC0=39, JMP=40, JMPIF=41, JMPIFNOT=42, LOAD_MEM=49, STORE_MEM=50, STORE_MEM_WORDS=51, RFE=52, HALT=63. | OT:1–66 | `machine/cpp/spec/blua32/opcode.h:9–13` plus `machine/cpp/spec/blua32/opcode_list.inl:1–64`; AGREES. |
| E02 | The three `_D` opcodes select DISP encoding, not BX. The three jumps select BX. Other scoped opcodes select neither. | OT:86–106 | OC:72–204; AGREES. |
| E03 | For LOAD_MEM and STORE_MEM, A is a register destination/source, B is an RK address operand, C is MemoryAccessKind. For STORE_MEM_WORDS, A starts a register sequence, B is RK address, C is a word count rather than a kind. RK < 0 selects constant index `-1-rk`; RK >= 0 selects that register. Address numeric value is converted to u32. | T:3080–3169,3589–3597 | D:621–684; `machine/cpp/machine/cpu/cpu.h:447–452`; CH:199–221; AGREES. |
| E04 | `_D` forms use register B, not RK; address is `(u32(R[B]) + (disp << 2)) mod 2^32`. `disp` is the instruction's unsigned 8-bit ext byte (0–255 word displacements), not sign-extended and not WIDE-extended. C remains kind/count as above. | T:1278,1297,1307–1333,1363,2992–3017 | C:880–921,951; D:554–617; AGREES. Raw decode is otherwise a root dependency. |
| E05 | DISP repurposes ext, so base A/B/C are six bits; optional WIDE adds six bits above each, yielding 12-bit operands. Ordinary ABC base A is 8 bits and B/C 9 bits; optional WIDE adds six above these. Jumps use signed BX displacement of 20 bits without WIDE / 26 with it; A has 6/12 bits under BX encoding. | IT:1–33; T:1304–1333 | IH:8–39; C:880–921; AGREES for the scoped decode interpretation. |
| E06 | MFC0/MTC0 use A as value register and raw B as CP0 field number, not RK; C is not read by their handlers. RFE and HALT do not read A/B/C in their handlers. | T:2471–2473,2738–2801 | D:132–135,386–422,688–716; AGREES. |

## Memory value and transfer representation

The following valid-kind table is paired with both actual handler switches, not inferred from enum names alone.

| Kind C | Transfer / register value | CPU alignment | Paired sources / disposition |
|---|---|---|---|
| 0 Word | 4-byte little-endian unsigned raw word transfer. A load writes a **guest Number containing the u32 integer**, not the register/value encoding. A store converts numeric R[A] to a u32 word. | addr & 3 = 0 | KT:1–10; KH:8–24; T:3027–3029,3054–3056,3091–3093,3131–3133; D:563,592,630,659; MT:426–435; MC:316–325; AGREES. |
| 1 U8 | One unsigned byte; loaded as numeric 0–255. Stored integer low eight bits. | no CPU alignment restriction | KT:1–10; KH:8–24; T:3030–3032,3057–3059,3094–3096,3134–3136; D:564,593,631,660; MT:442–451,466–479,379–388; MC:332–341,356–369,262–270; AGREES. |
| 2 U16LE | Two little-endian bytes; loaded as numeric 0–65535. Stored integer low 16 bits. | addr & 1 = 0 | KT:1–10; KH:8–24; T:3033–3035,3060–3062,3097–3099,3137–3139; D:565,594,632,661; MT:503–521,603–616,392–404; MC:393–411,498–511,280–292; AGREES. |
| 3 U32LE | Four little-endian bytes; numeric u32 load/store. Same data path as Word, but U32 versus Word bus-fault access descriptor. | addr & 3 = 0 | KT:1–10; KH:8–24; T:3036–3038,3063–3065,3100–3102,3140–3142; D:566,595,633,662; MT:426–435,524–525,619–620; MC:316–325,414–415,514–515 plus defaults `machine/cpp/machine/memory/memory.h:77,93`; AGREES. |
| 4 F32LE | Four little-endian IEEE single-precision bits decoded to guest Number; numeric store rounds to single precision and transfers those bits. Not u32 integer conversion of the numeric float. | addr & 3 = 0 | KT:1–10; KH:8–24; T:3039–3041,3066–3068,3103–3105,3143–3145; D:567,596,634,663; MT:573–576,659–662; MC:463–468,553–557; AGREES. |
| 5 F64LE | Eight little-endian IEEE double-precision bits decoded to guest Number / numeric double encoded to bits for store. Two 32-bit transfers: low half at addr first, high half at addr+4 second. Only **4-byte**, not 8-byte, CPU alignment. No universal NaN-payload preservation assertion. | addr & 3 = 0 | KT:1–10; KH:8–24; T:3042–3044,3069–3071,3106–3108,3146–3148; D:568,597,635,664; MT:578–588,664–672; MC:470–483,559–567; AGREES. |

| ID | Bounded fact | TypeScript evidence | C++ evidence and paired disposition |
|---|---|---|---|
| M01 | Numeric-to-word conversion truncates toward zero and keeps the unsigned low 32 bits; non-number registers feed NaN and then integer conversion produces zero. This is conversion behavior, not a guest type exception or host-type check. Fractional addresses are likewise converted before alignment checking. | T:2998,3083,3120,3158; TH:128–130; explicit `>>>0` at T:3028,3132,3537 | CH:95–107,125–148,199–221; D:555,580,606,622,647,673; AGREES. Float stores use numeric decode (non-number -> NaN), not word conversion: T:3040,3043,3144,3147; D:596–597,663–664; CH:147–149. |
| M02 | All scoped data-memory accesses use CPU bus-master identity through mapped-memory leaves. These instruction handlers do not test the current user/supervisor status bit. This does not assert that every memory/controller target is admitted. | T:2992–3170; MT:426–435,442–451,503–525,619–620 | D:554–686; MC:316–325,332–341,393–415,514–515; AGREES. Device/controller admission is a dependency. |
| M03 | Aligned IO U8 loads read the **low byte of a whole IO word**. Non-word-aligned IO U8 loads produce a bus fault, despite CPU U8 alignment mask zero. U8 stores anywhere wholly within IO produce a bus fault; U16 IO loads/stores do too. Do not infer that all subword memory kinds can program IO. | MT:442–451,466–469,503–507,603–607,836–845 | MC:332–341,356–360,393–397,498–502; `machine/cpp/machine/memory/memory.h:134–141`; AGREES. |
| M04 | Word/U32/F32/F64 access aligned IO via whole-word mapped handlers. F64 can cause two ordered IO accesses. Device-specific meaning and side effects are not extracted. | MT:426–435,544–571,573–588,627–672 | MC:316–325,434–483,522–567; AGREES. |

## Memory faults, blocking, ordering and partial effects

| ID | Bounded fact | TypeScript evidence | C++ evidence and paired disposition |
|---|---|---|---|
| F01 | Alignment is tested before any mapped-memory operation; failure enters AddressErrorLoad for loads or AddressErrorStore for stores/word sequences with BadAddress set to the converted effective address. Sequence count zero still passes through this alignment check. | T:2998–3010,3083–3087,3120–3124,3158–3162,1737–1740 | D:555–560,580–585,606–611,622–627,647–652,673–678; C:2295–2298; AGREES. Cause constants: PT:19–22 / PH:25–28. |
| F02 | Scalar stores then ask mappedWriteReady(start address) before reading/converting A for the write and before taking a bus-fault-sequence snapshot. This happens for every store kind, including subword and F64. Readiness is checked only at the starting address, not the F64 upper half. Therefore a not-ready aligned start IO target can stall before a later width/permission/bus fault would be observed. | T:3020–3028,3117–3132; MT:261–266,627–642,664–672 | D:579–598,646–665; MC:181–186,522–536,559–567; AGREES. |
| F03 | Sequence stores preflight the full counted IO-word span for the first not-ready slot **before any sequence writes or the sequence surcharge**. The scan is increasing address order within the IO overlap; no payload-dependent readiness test. Zero count reports no blocked address. This means a later blocked IO word is found before an earlier non-IO write can fault or commit. | T:3010–3017,3163–3169; MT:268–282 | D:605–618,672–685; MC:188–201; AGREES. Scan endpoint is computed without 32-bit wrap, while actual sequence writes wrap u32; do not replace that source fact with a whole-address-space readiness guarantee. |
| F04 | Blocking restores frame.pc to the current instruction start, sets the blocked flag and raw blocked target address, and clears requested-yield. It performs no store. A matching raw-address ready edge clears the blocked flag; abort also clears that flag. Retry therefore starts the instruction again; there is no stored partial sequence offset. Run-loop retry charging/scheduling belongs to root. | T:1647–1663,3011–3015,3021–3024,3125–3128,3163–3167 | C:2342–2353; `machine/cpp/machine/cpu/cpu.h:285`; D:585–588,611–615,652–655,678–682; AGREES. |
| F05 | LOAD snapshots Memory's bus-fault sequence, performs the selected read, compares sequence afterwards and enters DataBusError on a new event. It writes destination A only when no new event occurred. A preexisting unacknowledged bus-fault record alone does not make the load fail; a new event is detected even while that earlier record remains latched. Read/device side effects already performed are not undone. | T:3051–3078,3088–3115; MT:811–819 | D:560–576,627–643; MC:707–715; AGREES. |
| F06 | Scalar STORE snapshots immediately before the write, then compares sequence and enters DataBusError on a new event. There is no capture/restore/rollback; any earlier effects of a multi-transfer store remain. Faulting device-operation effects beyond the common memory leaves are not specified here. | T:3025–3049,3129–3153 | D:589–602,656–669; AGREES. |
| F07 | F64 read/store stops after the low transfer if that transfer raises a new fault. If only the high transfer faults, the low read/device side effect or low-word store already happened. LOAD still does not update destination on either new fault. Scalar-store readiness does not preflight high-half IO. | MT:578–588,664–672; T:3073–3077,3110–3114,3021–3025,3125–3129 | MC:470–483,559–567; D:571–575,638–642,585–590,652–657; AGREES. |
| F08 | STORE_MEM_WORDS writes R[A+i] converted to u32 at `(start+4*i) mod 2^32`, in increasing i order. It checks fault-sequence change after **each** word, stops immediately on the first new fault and enters DataBusError. Prior successful words remain; later words are not attempted. This is not an atomic transaction. | T:3533–3544 | C:3194–3205; AGREES. |
| F09 | Synchronous instruction exceptions restore the interrupted frame's PC and EPC to currentInstructionPc, not the already advanced PC. Address exceptions additionally write BadAddress; ordinary DataBusError does not assign BadAddress in these leaves. Common exception entry writes Cause and exception-domain, shifts low six Status bits left by two (retaining higher bits), clears HALT/yield latches and creates an exception frame. | T:1732–1740,1764–1784 | C:2290–2298,2312–2339; AGREES. Handler-function lookup/frame creation are named dependencies, not expanded. |
| F10 | Memory fault sequence increments for every new fault event even when its first-fault record is already occupied. Code/address/access latch only if code was NONE. Guest-visible fault slots publish that first record; ACK slot is reset to zero. Thus CPU's new-event exception can coexist with older latched detailed bus-fault metadata until acknowledged. | MT:811–833 | MC:707–722; AGREES. Actual memory map numbers and device policies are outside this extraction. |

## Branch behavior

| ID | Bounded fact | TypeScript evidence | C++ evidence and paired disposition |
|---|---|---|---|
| B01 | Jump decode resolves byte target `(instruction-start PC + full instruction byte width + signedBX*4) mod 2^32`; full width includes WIDE. Handler assigns the precomputed target, not a target relative to the handler's current PC. | T:1320–1326,1343–1348,2849–2863 | C:905–912,931–936; D:424–440; AGREES. |
| B02 | JMP always assigns target and ignores A. JMPIF tests register A; JMPIFNOT tests its inverse. Untaken conditional branch leaves the already advanced sequential PC intact. These handlers perform no target-memory access or alignment check themselves; next-fetch behavior belongs to root. | T:2849–2863 | D:424–440; AGREES. Sequential-PC advance is a root dependency. |
| B03 | Truthiness uses guest tags: only Nil and False are false. Number zero, numeric NaN, empty strings and other tags are true; no scalar/host-object truthiness test is used. | TH:157–160 | CH:193–197 (encoded guest tags); AGREES. |

## CP0, mode admission, RFE, HALT

| ID | Bounded fact | TypeScript evidence | C++ evidence and paired disposition |
|---|---|---|---|
| P01 | CP0 fields are BadAddress=8, LuaFaultReason=9, Status=12, Cause=13, EPC=14, EXEC=15. Current interrupt-enable is Status bit 0; current user mode is bit 1. System-entry Status=1; cartridge-entry Status=3. | PT:1–14 | PH:7–20; AGREES. |
| P02 | MFC0/MTC0/RFE first inspect Status bit 1. In user mode all enter coprocessor-unusable, before field selection, source conversion or RFE exception-frame checking. HALT, jumps and memory handlers have no such current-mode check. No inference from cartridge image identity substitutes for this status-bit admission. | T:1666–1668,2738–2781,2471–2473,2849–2863,2992–3170; PT:23 | `machine/cpp/machine/cpu/cpu.h:286`; D:132–135,386–440,554–716; PH:29; AGREES. |
| P03 | Privileged MFC0 returns the selected raw u32 latch as guest numeric value in A; EXEC reads zero. Unknown CP0 field hard-halts instead of a coprocessor-unusable/trap exception. Destination is not written in those rejected cases. | T:2738–2754 | D:386–402; AGREES. |
| P04 | Privileged MTC0 converts R[A] to u32 first. Status and EPC replace their raw words without masks/alignment validation. Writes to BadAddress, LuaFaultReason and Cause are ignored. Unknown fields hard-halt. EXEC invokes executeFunctionAddress(value), not an ordinary register-latch write. | T:2756–2771 | D:405–422; CH:199–221; AGREES. |
| P05 | EXEC first reads a function record on the CPU bus and requires static-function flag; failure hard-halts. Success clears the active call stack, latches the selected image, sets Status to 3 for executionDomainId >=0 else 1, clears HALT/event/blocked-target/hard-halt/yield state and pushes that static function with zero arguments. It is a replacement edge, not RFE. Function-record and closure producer details remain dependencies. | T:1523–1546 | C:1095–1118; AGREES. |
| P06 | RFE in supervisor mode requires the current frame be an exception frame; otherwise hard-halt. It samples current EPC before frame removal, closes frame upvalues, removes that frame, restores stackTop to varargBase, and replaces Status low four bits with previous Status bits 2–5 while retaining higher bits. It assigns sampled EPC to the remaining caller PC, if one exists. | T:2773–2793; PT:10–11 | D:688–707; PH:16–17; AGREES. Frame release occurs before Status assignment in TS and at the end in C++; no guest-visible difference is established by this extraction. |
| P07 | If the popped exception frame is NMI-marked, RFE then restores retained pre-NMI Cause/EPC/BadAddress/LuaFaultReason/exception-domain words. The resumed caller PC uses the sampled active EPC, not the subsequently restored retained EPC. It does not restore the pre-NMI Status word wholesale. | T:2782–2800 | D:697–715; AGREES. Producers of retained NMI words belong to root. |
| P08 | HALT calls haltUntilIrq. If interruptEventPending was retained, it consumes that event and does not create a HALT latch. Otherwise it records active thread plus current frame depth and clears yield. A matching HALT condition requires both same active thread and same frame depth; it is not a guest spin loop. | T:2471–2473,1611–1619,1635–1637 | D:132–135; C:1643–1651; `machine/cpp/machine/cpu/cpu.h:278–281`; AGREES. Wake/accept scheduling is root dependency. |
| P09 | hardHalt sets hardHalted, removes HALT-thread/depth latch and clears yield. It does not set a new CP0 cause in that leaf. | T:1621–1626 | C:1653–1658; AGREES. Recovery/reset lifecycle belongs to root. |

## Nominal instruction cost versus dynamic sequence surcharge

| ID | Bounded fact | TypeScript evidence | C++ evidence and paired disposition |
|---|---|---|---|
| T01 | BASE_CYCLES is 2 for all six scoped memory opcodes. It is 1 for MFC0, MTC0, JMP, JMPIF, JMPIFNOT, RFE and HALT. This is the table's nominal cost, not a complete instruction/pipeline timing assertion. | OT:75–84 | OC:10,18–19,44–48,55–58,69; AGREES. Root covers when base cost is actually charged and WIDE/fetch/budget accounting. |
| T02 | Each sequence handler adds `ceilDiv4(C) = (C+3)>>2` only **after** successful readiness preflight and before attempting any data word. C counts 32-bit words, so surcharge is one unit per four words rounded up, not C or bytes. The full surcharge is charged even if a later word faults; zero count adds zero and performs no sequence writes (but alignment still precedes that). Scalar kinds, including F64, add no per-transfer charge in the inspected handlers. | T:3010–3017,3163–3169,3533–3543; `machine/ts/machine/common/numeric.ts:68–70` | D:554–686; C:3194–3205; `machine/cpp/machine/common/numeric.h:71–73`; AGREES. Meaning of charge/CYCLES_ADD and retry base-cost accounting belongs to root. |

## Isolated stops and limits

| ID | Affected fact / exact boundary | Paired evidence | Disposition |
|---|---|---|---|
| X01 | **C outside MemoryAccessKind 0–5 for scalar LOAD/STORE(_D): no shared behavior is established.** The six-entry table is directly indexed by decoded C; TS receives an absent alignment entry (bitwise coercion) and scalar switch lacks a default, while C++ uses unchecked std::array indexing and LOAD switches end in `__builtin_unreachable`. Do not invent a reserved-kind trap, defined value, deterministic shared fault or safe fallback. Sequence C is a count and is unaffected by this kind-specific stop. | KT:1–10 / KH:8–24; T:2996–3002,3026–3045,3052–3077,3082–3114,3119–3149; D:556,562–569,581,591–598,623,629–636,648,658–665 | **STOP** the unsupported-kind behavior. Valid 0–5 facts remain bounded above. Root owns whether any producer/admission boundary narrows the machine contract; no repair recommended here. |
| X02 | Simultaneous requested-yield with hard-halt, matching HALT latch or blocked-write state has an existing isolated TS/C++ run-boundary ordering disagreement. Do not publish a shared consumption/result precedence, extrapolate to NMI/RFE, or declare a hardware bug from that discrepancy. | Only the named isolated discrepancy in `docs/book1/facts/system-context.md:51–57` was consulted; it identifies T:1809–1816,1874–1881 versus C:2391–2399. | **STOP** shared run-boundary ordering, already assigned to root. HALT leaf P08 itself agrees. |
| X03 | No per-device port readiness/fault/side-effect audit, firmware reachability proof, native runtime replay, tests, benchmark or UI proof was performed. No claim about fixed wall-clock HALT duration or interrupt-entry latency. | Handler leaves stop at Memory/controller callbacks, exception frame/closure producers and root run loops. | **DEPENDENCY**, not evidence of failure. |

## Root dependency names (do not silently enlarge these facts)

- Raw instruction fetch/decode/WIDE validity, sequential-PC advancement, malformed operand/index behavior and next-fetch faults.
- `charge` / `CYCLES_ADD`, BASE_CYCLES dispatch charging, exhausted budget/overshoot, blocked retry charging.
- `readFunctionRecordOnBus`, `staticClosureAtAddress`, `pushFrame`/`pushLatchedFrame`, release/close-upvalue ownership.
- Memory/controller/device mapping and actual IO callbacks, ready-event scheduling, fault metadata map addresses.
- Runtime executor wakeup/hold/budget behavior and SYSTEM integration; only isolated run-boundary disagreement X02 was consulted from the named existing fact file.

## Integer-path precision addendum

M01a. Numeric NaN and infinities become zero on the same u32 address/integer-
store path. This is separate from floating-point stores retaining numeric
nonfinite values. Primary TS CPU integer conversions at2998,3028,3083,3120,
3132,3158 and native value.h:199–229 /dispatch555,580,606,622,647,673 use
the owning word conversion. The numeric sheet independently extracts that
central conversion including zero/nonfinite cases. No runtime guard added.
