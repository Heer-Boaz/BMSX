# BLua compiler-owned access and intrinsic forms: bounded source facts

Snapshot: `/home/boaz/BMSX`, HEAD `d5f491bd3a8fbcaecd8dfc3607e1013ce410b156`. Read-only source audit; no builds/tests or sketches executed. Unrelated worktree edits left alone. Not a proposed documentation chapter. No architecture docs, public language-guide chapters, or stock-Lua assumptions used as evidence. Scope frozen: six raw memory maps; typed-vs-untyped dereference boundary; six CP0 fields; three `blua32` operations; `halt_until_irq`; existing BIOS/cartlib usage pointers.

## 1. Representation / producer-to-consumer table

| Source form | Compiler representation / lowering | Paired TS / C++ consumer |
|---|---|---|
| `mem[byte_address]` | `MemoryAccessKind.Word=0`; `LOAD_MEM`/`STORE_MEM`, optionally displaced forms | TS `machine/ts/machine/cpu/cpu.ts:2992-3078,3080-3153`; C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:554-603,621-669`: mapped raw unsigned 32-bit word |
| `mem8[byte_address]` | `U8=1`, same memory opcodes | Same dispatch switches: mapped unsigned byte |
| `mem16le[byte_address]` | `U16LE=2` | Same dispatch switches: mapped unsigned 16-bit LE |
| `mem32le[byte_address]` | `U32LE=3` | Same dispatch switches: mapped unsigned 32-bit LE |
| `memf32le[byte_address]` | `F32LE=4` | Same dispatch switches: mapped numeric float32 LE, not raw float bits |
| `memf64le[byte_address]` | `F64LE=5` | Same dispatch switches: mapped numeric float64 LE, two 32-bit bus operations |
| `*typed_pointer` | Type's scalar access kind; no separate untyped raw-dereference mode | Same mapped memory datapath as above |
| `cop0.<field>` read/write | `MFC0`/`MTC0`, fixed register number | TS CPU `2738-2771`; C++ dispatch `386-421`: raw control words |
| `blua32.closure(function_address)` | Indirect `CLOSURE`, address held in a register | TS CPU `2865-2884`; C++ dispatch `443-460`: numeric address converted to raw u32, function record read on bus, closure created |
| `blua32.trace*` | Compile-time erased or lowered to ordinary table field and guest call operations | No special trace CPU instruction in these lowering paths; compiler owns source form |
| `halt_until_irq` | `HALT` | TS CPU `2471-2473,1611-1619`; C++ dispatch `132-135`, CPU `1643-1651`: interrupt-event/frame-depth latch |

Evidence for root-name-to-kind mapping: `toolchain/ts/lua/memory_access_syntax.ts:3-20`. Paired kind values / alignment masks: `machine/ts/spec/blua32/memory_access_kind.ts:1-10`; `machine/cpp/spec/blua32/memory_access_kind.h:8-24`.

## 2. Raw maps: exact usable shape, units, and limits

- Direct identifier indexing is compiler-recognized: target semantics requires an `IndexExpression` whose base is an identifier bound as `map`, then selects its access kind. `toolchain/ts/lua/compiler/target_semantics.ts:53-73`. Reads lower through `compiler.ts:4816-4835`; stores through `4137-4139,4229-4231`; address preparation through `4963-4979`; opcode selection through `5222-5245`.
- Index is a **byte address**, not a word index. Direct CPU dispatch consumes `readRKNumber(...) >>> 0` / C++ `toU32(readRK(...))`; displaced form adds `disp << 2` bytes. `machine/ts/machine/cpu/cpu.ts:2998,3083,3120`; `machine/cpp/machine/cpu/cpu_dispatch.inl:555,580,622,647`. Compiler only encodes aligned nonnegative byte offsets as displaced operands: `toolchain/ts/lua/compiler.ts:5208-5219,5222-5245`.
- CPU alignment is 4 bytes for `mem`, `mem32le`, `memf32le`, **also 4 bytes (not 8) for `memf64le`**; 2 bytes for `mem16le`; 1 byte for `mem8`. The paired spec masks are `[3,0,1,3,3,3]` at the kind-spec paths above. Misalignment enters address-error-load/store exception before the memory operation; paired dispatch ranges in table.
- `mem` and `mem32le` both use mapped LE u32 bus storage at the memory owner. They retain distinct access-kind/fault-access identities (`WORD` versus `U32`), so do not document one as compiler alias for the other: TS `machine/ts/machine/memory/memory.ts:426-435,524-525,544-570,619-620`; C++ `machine/cpp/machine/memory/memory.cpp:316-325,414-415,434-460,514-515`.
- Float maps numerically encode/decode IEEE float bytes at the owner: TS memory `573-588,659-671`; C++ memory `463-483,553-567`. `memf64le` reads low word at address then high word at address+4, stopping if a bus fault occurs; writes low then high, stopping if the first faults. The code does not establish transaction/rollback semantics.
- MMIO remains device/bus semantics, not ordinary RAM byte slicing. An aligned `mem8` IO read reads an IO slot then masks low 8 bits, while non-slot IO byte addresses fault: TS memory `442-451`; C++ memory `332-341`. `mem16le` IO accesses fault even when the 2-byte CPU alignment passes: TS memory `503-507,603-607`; C++ memory `393-397,498-502`. u32/word mapped IO goes through IO slot callbacks: TS memory `544-555,627-646`; C++ memory `434-445,522-540`.
- Bus faults after a mapped memory operation produce synchronous data-bus-error exceptions; a load does not publish its result when that sequence changes. Store dispatch checks readiness before writing; a non-ready mapped target latches the stalled address and rewinds the PC to the current store instruction. These are device stalls, not source-level retries or rollback: TS CPU `1647-1662,3020-3049,3073-3077,3110-3115,3125-3152`; C++ dispatch `585-602,638-643,652-668`.

### Name replacement / first-class restrictions

- Reserved intrinsic roots are exactly `blua32`, `cop0`: `toolchain/ts/lua/semantic/common.ts:5-7,26-31`; memory roots are exactly those in `memory_access_syntax.ts:3-20`.
- Compiler `declareLocal` rejects all six memory names and both intrinsic names as local or parameter names: `toolchain/ts/lua/compiler.ts:2118-2123`. Bare reads/stores reject reserved maps/intrinsics rather than loading a runtime table/function: `2818-2823,2876-2881,4116-4121`. They are not supported lexical replacement points or first-class values in linked compilation.
- Semantic binding looks for a declaration before assigning `map`/`reserved_intrinsic` classification: `toolchain/ts/lua/semantic/frontend.ts:605-638`. That does **not** override linked compiler declaration rejection above; do not infer supported shadowing from the binder alone. Memory declaration diagnostics also reject locals/constants/parameters/functions/globals: `semantic/diagnostics.ts:530-555`.

Unexecuted shape sketches (arbitrary addresses must be chosen for the actual hardware/memory owner; these are not runnable examples):

```lua
local raw = mem[address]
mem[address] = 0x00000001
mem8[byte_address] = 0x7f
local half = mem16le[halfword_address]
local bits = mem32le[word_address]
memf32le[float_address] = 1.5
local wide = memf64le[double_address]
```

## 3. `*`: stop the conflicting untyped-raw-pointer contract

- Parser accepts unary dereference `*operand` and dereference lvalues: `toolchain/ts/lua/syntax/parser.ts:965-966,1078-1081`.
- **Linked compiler does not accept `*numeric_address` as an untyped raw memory access.** It requires typed pointer/storage resolution for reads and writes: read rejection `compiler.ts:5308-5322`; assignment rejection `4060-4087`. Do not teach `*0x08000000` or `*address` where `address` has no compiled pointer type as a raw-map replacement.
- Dereference resolution preserves resolved base address, byte offset, type, and read-only status and changes pointer-index state: `compiler.ts:5105-5120`. Scalar loads use the resolved type's access kind; whole-struct scalar use is rejected: `5170-5189`. Scalar storage writes lower to the memory access kind; `.rodata` and whole-struct assignment are rejected: `4062-4078`.
- Actual existing concrete typed MMIO form: `cartlib/dma.lua:7-18` declares `local dma0_read_addr<const>: *word = 0x0800000c` and sibling registers; `67-72` programs `*dma0_read_addr`, `*dma0_write_addr`, transfer count/control/trigger. Storage/pointer-form details belong to `blua-extensions-storage.md`, not an invented raw-deref ABI.

## 4. CP0: complete six-field source inventory

| Exact field | Register | Linked source access |
|---|---:|---|
| `cop0.bad_address` | 8 | read only |
| `cop0.lua_fault_reason` | 9 | read only |
| `cop0.status` | 12 | read / write; compound assignment allowed |
| `cop0.cause` | 13 | read only |
| `cop0.epc` | 14 | read / write; compound assignment allowed |
| `cop0.exec` | 15 | write only; compound assignment rejected |

- Exact resolver and unknown-field error: `toolchain/ts/lua/compiler.ts:4797-4812`. Read lowering / exec read rejection: `4768-4775`. Writeable field check: `4047-4054`. Compound lowering / exec rejection: `4274-4280`.
- Central TS register/STATUS/cause spec: `machine/ts/spec/blua32/cop0.ts:1-24`; paired C++ `machine/cpp/spec/blua32/cop0.h:7-30`. STATUS interrupt-enable-current is bit 0; user-mode-current is bit 1. CART_ENTRY is both bits and SYSTEM_ENTRY only interrupt enable.
- Source CP0 read/write does not bypass privilege. Both `MFC0` and `MTC0` enter coprocessor-unusable synchronous exception when user mode is set: TS CPU `2738-2742,2756-2760`; C++ dispatch `386-390,405-409`.
- In supervisor dispatch, STATUS/EPC writes store raw u32 words; EXEC invokes `executeFunctionAddress(value)`: TS CPU `2761-2770`; C++ dispatch `410-419`. No masking/repair policy beyond raw u32 conversion is established at this boundary.
- Source access is more restricted than bare ISA: compiler rejects reads of EXEC and writes of CAUSE/BAD_ADDRESS/LUA_FAULT_REASON; paired ISA switches internally return zero for EXEC reads and ignore writes to read-only fields. This is an intentional observable source-vs-ISA boundary, not permission to document those source operations.
- Existing BIOS usage: `machine/bios/shell/monitor.lua:408-409` restores EPC/STATUS; `425-429` reads STATUS/CAUSE/EPC/BAD_ADDRESS/LUA_FAULT_REASON; `449` enables interrupt bit in saved STATUS. `machine/bios/main.lua:105-113` writes `cop0.exec = startup` to transfer startup execution. These are usage pointers; full monitor/EXEC lifecycle is out of scope.

Unexecuted supervisor-only shape sketch:

```lua
local status = cop0.status
local cause = cop0.cause
cop0.epc = resume_address
cop0.status = status | 1
cop0.exec = function_record_address
```

## 5. Compound memory / CP0 side effects: not atomic sugar

- Parser permits exactly one target and one RHS expression for compound assignment: `toolchain/ts/lua/syntax/parser.ts:927-952`.
- Compiler prepares targets first, compiles RHS next, then applies compound operation: `compiler.ts:4025-4039`. Memory-target address evaluation is captured during target preparation (`4963-4979`).
- Memory compound assignment emits memory **load, arithmetic/bitwise operation, store**, in that order, after RHS evaluation; CP0 emits **MFC0, operation, MTC0**: `compiler.ts:4274-4285`. This is a real read and a real write through the mapped device/CP0 owners, not a device-atomic operation and not rollback-protected. A read-side effect can therefore matter; use device-defined write values for registers rather than assuming read-modify-write is harmless.
- Compiler/dispatch establishes exact operation sequence, not an all-or-nothing source-level transaction. Read faults, write readiness, and write faults follow the separately cited memory dispatch paths. No new check/repair/retry helper is proposed.

## 6. `blua32`: complete three-operation linked compiler inventory

Root recognition for all operations requires a non-method call whose callee is a direct member of identifier `blua32` bound as reserved intrinsic: `toolchain/ts/lua/compiler.ts:4305-4323,5701-5725`. No alias/member-table lookup or colon-method intrinsic form is established. Bare `blua32` is rejected (section 2).

| Exact signature / formal names | Position | Restriction and lowering |
|---|---|---|
| `blua32.closure(function_address)` | expression; ordinary call-statement position also reaches expression lowering | Exactly 1 source argument, compiled for 1 result into address register; emits indirect CLOSURE; requested extra results nil-filled. `compiler.ts:5724-5736`; call statement route `4292-4302` |
| `blua32.trace(subject, channel, ...)` | statement only | At least 2 source arguments; channel must be string literal; remaining values compiled individually for 1 result. Erased if channel not selected. `compiler.ts:4324-4339,4351-4368` |
| `blua32.trace_sink(subject, channel, sink)` | statement only | Exactly 3 source arguments; channel string literal; selected lowering evaluates subject then sink, writes selected sink field. `compiler.ts:4324-4348` |

- Public descriptor formal names/signatures agree with the above: `toolchain/ts/lua/builtin_descriptors.ts:113-115`. Expression use of trace/trace_sink throws statement-only error; all other member call operation names throw unknown-operation error: `compiler.ts:5721-5728`.
- Compile options own instrumentation selection: `traceStatements` stored in program (`compiler.ts:501-514`) and default `'erase'` at `6211`. Selection may be erase, emit, or chosen channel array (`toolchain/ts/lua/compiler/trace_statement.ts:2`, inspected via exact declaration search). Arity and literal-channel checks occur before erasure (`4324-4339`); erased statements compile no subject/sink/payload expression evaluation in this path.
- Selected `trace` evaluates subject, loads subject's channel sink, skips if falsey, then invokes sink method `record` with sink receiver plus payload values. Payload expressions are compiled after the skip branch and therefore are not evaluated at runtime if sink is falsey: `compiler.ts:4351-4368`. This is guest sink dispatch, not an automatic host logging API.
- Selected `trace_sink` sets the owner-generated sink field. Clearing can use a nil sink (the lowering stores the supplied value; descriptor explicitly describes binds/clears): `compiler.ts:4341-4348`, `builtin_descriptors.ts:115`. Exact generated field spelling is deliberately not claimed here; use the intrinsic.
- Indirect CLOSURE converts address to u32, bus-reads the function record against active execution image, hard-halts on unsuccessful record read, then creates a closure: TS CPU `2865-2884`; C++ dispatch `443-460`. This establishes no safe fallback for arbitrary integers and no replacement for the linker/compiler owning function records.
- Existing BIOS constructor use: `machine/bios/compiler/load.lua:21-24` returns `blua32.closure(function_address)` from a frame with constant-pool parameter in register 1; `27-37` obtains address/const_pool from linker and calls that constructor. The inline comment explicitly ties generated root upvalue descriptor to that frame's r1. Do not turn it into a generic closure-address ABI without the owning record contract.
- Existing cartlib traces: `cartlib/behaviour_tree/bt_component.lua:53`; `cartlib/actioneffects/actioneffect_component.lua:182,192,199`; `cartlib/event_emitter.lua:289` (usage located; surrounding feature behavior not audited).

Unexecuted syntax sketches (compiler-selected traces required for runtime effects):

```lua
local callback = blua32.closure(function_record_address)
blua32.trace_sink(subject, 'hardware.command', sink)
blua32.trace(subject, 'hardware.command', opcode, raw_word)
blua32.trace_sink(subject, 'hardware.command', nil)
```

## 7. `halt_until_irq`: statement and wake boundary

- It is a lexed keyword, not a replaceable function: `toolchain/ts/lua/syntax/token.ts:121-122`. Parser creates a token-only statement with optional semicolon, no argument syntax: `syntax/parser.ts:428-429,603-610`. Compiler emits `HALT`: `compiler.ts:3665-3667`.
- Both CPU dispatchers call haltUntilIrq directly without a CP0-style user-mode privilege test: TS CPU `2471-2473`; C++ dispatch `132-135`.
- If the CPU's interrupt-event-pending latch is already set, HALT consumes it and does not establish a new halt. Otherwise it latches active thread and physical frame depth and clears yield request: TS CPU `1611-1619`; C++ CPU `1643-1651`. Thus do not promise every occurrence always sleeps until a future event.
- Halt identity is active-thread plus current physical frame depth: TS CPU `1635-1636`; C++ `machine/cpp/machine/cpu/cpu.h:279-280`. Accepted maskable interrupt requires current STATUS interrupt-enable bit and controller asserted maskable line: TS CPU `1680-1692`; C++ CPU `2247-2255` contains pending selection but its canAcceptMaskableInterruptLine implementation was not separately read in this bounded packet.
- Both paired enterPendingInterrupt paths record whether a halt latch existed; accepted NMI or maskable interrupt sets interrupt-event-pending only when no halt latch existed: TS CPU `1695-1727`; C++ CPU `2257-2285`. Exact full return-from-exception scheduling is outside this audit; do not generalize into every device event, timeout, or polling predicate waking HALT.
- Practical existing wait is a predicate loop around the keyword, not an assumption that any IRQ means vblank: `cartlib/gx/vblank.lua:6-21` registers vblank IRQ handler to increment sequence and waits until it changes. `cartlib/dma.lua:33-64` similarly tracks DMA completion sequence and checks busy bit before sleeping. This is an existing software predicate, not proposed defensive repair.

## 8. Instruction accounting: established narrow spec only

- TS central base-cycle table `machine/ts/spec/blua32/opcode.ts:75-84`, interpreted with enum at `1-65`, agrees with explicitly labelled C++ `machine/cpp/spec/blua32/opcode.cpp:5-69`: ordinary/displaced scalar memory loads/stores have base cost 2; MFC0/MTC0/CLOSURE/HALT have base cost 1. This is a **base opcode table fact only**, not a complete execution cost or source-statement count.
- Full charging dispatch path, bus waits, closure allocation/capture work and total instruction accounting were not traced in this bounded packet. Do not publish a source-level performance guarantee from those base values.

## 9. Explicit gaps and stop points

- No execution/build/test validation was performed; all snippets above are unexecuted syntax sketches.
- Typed storage construction/type layout/address-of details are delegated to storage packet; no untyped dereference semantics are inferred.
- Did not follow full EXEC transfer lifecycle, privilege changes at cartridge/system entry, function-record layout validation/capture fault cases, complete interrupt-return wake scheduling, full bus permission/controller dispatch, or final source instruction accounting. The immediately cited compiler/paired dispatch boundaries support only the bounded claims above.
- No whole-language explanation, debugger/source-map investigation, memory fallback, runtime validation, rollback, local encoding helper, or hardware repair is proposed.
