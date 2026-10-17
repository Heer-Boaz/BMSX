# BLua function/call/return facts — bounded source extraction

Snapshot: `master`, HEAD `b582b7344`, 2026-10-17. Internal author input, not chapter prose, a full ISA/ABI, or runtime proof. No repository edits/tests. Existing memory-boot BM30–35 and memory-storage establish only the byte-storage/value-slot boundary; live compiler and paired CPU owners below are the authorities for these facts. Other agents subsequently added untracked language-manual fixtures; this extraction did not modify them. Paired CPU extraction: `/tmp/bmsx-memory-call-cpu-paired.md`.

## Toolchain-compiled source producers (not a universal on-console loader claim)

**MC01 — Formal argument order.** A function's implicit `self`, when present, is declared before the authored parameter list; authored parameters are declared in list order. Each local declaration takes the next local register. The prototype records `numParams = parameters.length + implicitSelf` and `isVararg = hasVararg`. Scope: compiler placement, not guest byte-RAM addresses.

Sources: `toolchain/ts/lua/compiler.ts:1487-1495,2124-2126,5992-5999`.

**MC02 — Parameter syntax is not typed-local syntax.** The function parser accepts parameter identifiers and optional trailing `...`; tokens after `...` are rejected. That producer contains no pointer/type annotation branch. Do not transplant the documented local `: *word` syntax into a function parameter list or claim typed parameter/return metadata from typed local views.

Source: `toolchain/ts/lua/syntax/parser.ts:716-745`.

**MC03 — Plain source-call placement.** For a non-method ordinary call, the compiler places the target at `callBase`, followed by arguments at `callBase+1`. Each nonfinal argument is compiled for one value. If the final argument is classified multi-result, it is compiled open and the emitted CALL uses B=0; otherwise CALL encodes the fixed argument count. Returned fixed values are moved from the call block into requested targets when needed. Scope excludes special compile-time `require` handling and intrinsic lowering.

Source: `toolchain/ts/lua/compiler.ts:5628-5698`.

**MC04 — Multi-result classification is explicit.** `...` is multi-result; a CallExpression is multi-result except resolved `require`, and except a known exactly-one-return prototype at optimization level >=2. Other expression kinds are not multi-result. This classifier governs the trailing expansion branches named here; it is not a promise that arbitrary expressions produce lists.

Source: `toolchain/ts/lua/compiler.ts:5754-5764`.

**MC05 — Assignment adjustment.** Earlier RHS expressions are compiled for one value. The final RHS expression receives the number of remaining targets only when more than one target remains and MC04 classifies it multi-result; otherwise it receives one result. Ordinary assignment supplies nil to targets without a produced value. Local initialization uses the same trailing-result request and nil-initializes locals without a runtime initializer value. Excess produced results are not additional assignment targets.

Sources: `toolchain/ts/lua/compiler.ts:4159-4204,4031-4039`; local producer `toolchain/ts/lua/compiler.ts:3890-3892,3913-3939,4013-4019`.

**MC06 — Return adjustment.** One returned expression classified multi-result is compiled open and returned open. With several return expressions, all nonfinal expressions are compiled for one value; a final multi-result expression is compiled/returned open, otherwise RET has the expression count. Exception: the static module-root publication branch explicitly requests/returns one root value. Do not generalize that module-root exception to ordinary functions.

Source: `toolchain/ts/lua/compiler.ts:4379-4408`.

**MC07 — Bare return and fall-through return one nil.** The source compiler emits LOADNIL plus fixed RET B=1 for both an explicit empty `return` and its default function-ending return. This differs from stock Lua's zero-result behavior and from interpreting raw RET B=0 as zero results.

Sources: `toolchain/ts/lua/compiler.ts:4372-4377,5767-5770`; default return appended `toolchain/ts/lua/compiler.ts:1496-1502`.

**MC08 — WITHHELD as a common BLua rule: parenthesized call adjustment differs by producer.** The external toolchain parser returns the inner expression directly for `(expression)`; its MC04 classifier still sees the CallExpression kind. The on-console firmware parser instead sets `expands_results=false` for a parenthesized call, and its call/return emitters require that flag for expansion. Therefore no unqualified BLua-wide parenthesized-call cardinality statement is accepted. The first behavior is restricted to the external-toolchain producer; the second belongs to on-console source loading. No runtime fix or compatibility advice follows from this extract.

Sources: `toolchain/ts/lua/syntax/parser.ts:1345-1349`; `toolchain/ts/lua/compiler.ts:5754-5764`; opposing producer `machine/bios/compiler/parser.lua:177-183`; consumers `machine/bios/compiler/compiler.lua:652-656,1152-1155`. Existing loader fixture expectations: `tests/lua/firmware_call_results.test.ts:12-13,18,31-43` (not executed by this extraction).

**MC09 — Call statement result is unused by the source.** A standalone call statement is compiled requesting one result into a temporary, not encoded as a raw zero-result call. No source binding receives that temporary. In particular raw CALL C=0 cannot be described as the compiler's discard-results convention.

Source: `toolchain/ts/lua/compiler.ts:4292-4303`.

**MC10 — Vararg read producer.** Compiling a `...` expression emits VARARG with destination and requested result count. Expansion/cardinality comes from the enclosing call, assignment or return context above, not a separate language-visible byte buffer.

Source: `toolchain/ts/lua/compiler.ts:4749-4751`.

## Paired runtime call contract / raw encoding (not source syntax)

**MC11 — Actual callable classes.** CALL accepts only a tagged Closure or BuiltinFunction. A numeric byte address or numeric ID is not itself callable; this dispatch has no `__call` table lookup. The compiler's ordinary function expression emits CLOSURE, rather than treating its prototype index as the runtime callable value.

Sources: `machine/ts/machine/cpu/cpu.ts:2918-2939`; `machine/cpp/machine/cpu/cpu_dispatch.inl:490-503`; producer `toolchain/ts/lua/compiler.ts:4752-4761`.

**MC12 — Closure payload and function-record address.** A closure owns a function-record address and upvalues. CLOSURE without its register-address flag interprets its encoded operand times 16 as that address; its alternate branch reads a u32 address from a register. The frame's instruction PC is separately initialized from the record's codeAddress. Thus a function-record byte address, first instruction byte address, compiler prototype index/name, and tagged callable are distinct representations.

Sources: `machine/ts/machine/cpu/closure.ts:21-30`; `machine/cpp/machine/cpu/closure.h:20-24`; `machine/ts/machine/cpu/cpu.ts:2865-2884,3264-3269`; `machine/cpp/machine/cpu/cpu_dispatch.inl:443-460`; `machine/cpp/machine/cpu/cpu.cpp:3009-3012`.

**MC13 — Function-record fields relevant here.** Record size 32 bytes, alignment 16; codeAddress offset 0, numParams 8, maxStack 12, flags 16, upvalue-table address/count 20/24. VARARG is flag bit 0; STATIC is bit 1. These offsets describe an image record, not call arguments stored in mapped main RAM.

Sources: `machine/ts/spec/blua32/image_format.ts:30-46`; `machine/cpp/spec/blua32/image_format.h:36-52`.

**MC14 — Raw CALL operands.** A identifies the callee register and arguments start at A+1. B=0 takes open argument count `max(frame.top-A-1,0)`; positive B means B-1 arguments. The fixed-count spec encoder emits n+1. C is saved verbatim as the requested result count (MC18). Do not apply B's offset rule to C.

Sources: `machine/ts/spec/blua32/opcode.ts:70-73`; `machine/cpp/spec/blua32/opcode.h:21-25`; `machine/ts/machine/cpu/cpu.ts:2918-2936`; `machine/cpp/machine/cpu/cpu_dispatch.inl:490-500`.

**MC15 — Parameter cardinality / missing and excess arguments.** Named parameters receive the first numParams arguments in order, copied into callee registers starting at zero. Missing named arguments become nil. Non-vararg functions retain no excess arguments. Vararg functions retain exactly `max(argCount-numParams,0)` excess values in their vararg area. There is no arity-error comparison in these ordinary closure-frame setup paths; a function body/builtin may impose its own API requirements.

Sources: `machine/ts/machine/cpu/cpu.ts:3272-3297`; `machine/cpp/machine/cpu/cpu.cpp:3017-3043`.

**MC16 — Frame slots are not mapped byte-RAM stack storage.** Each thread owns frames plus a value-slot stack. TS storage is parallel tag/scalar/reference arrays; native storage is `vector<Value>`. A frame's vararg area starts at previous stackTop; register base follows varargs; reserved register capacity is max(maxStack,1) slots, and top initially equals numParams. These owners assign no guest RAM byte base/stack-pointer ABI. Do not assert identical physical slot encodings or that the whole reserved range is identically cleared: see G01.

Sources: `machine/ts/machine/cpu/thread.ts:11-26`; `machine/ts/machine/cpu/value_slots.ts:25-52`; `machine/cpp/machine/cpu/thread.h:15-26`; `machine/ts/machine/cpu/cpu.ts:3175-3184,3272-3281`; `machine/cpp/machine/cpu/cpu.cpp:3017-3028`.

**MC17 — Raw VARARG and RET counts.** VARARG B=0 copies all retained varargs and sets frame.top to A+count; positive B requests exactly B values and nil-pads missing values. RET B=0 returns the open range `max(top-A,0)`; positive B returns exactly B values (not B-1). RET first closes upvalues. Zero in these raw operands means open, not an intrinsic zero-element list.

Sources: `machine/ts/machine/cpu/cpu.ts:2896-2916,2942-2945`; `machine/cpp/machine/cpu/cpu_dispatch.inl:475-487,506-508`.

**MC18 — Ordinary returned values replace the call block.** The child's saved returnBase is CALL A. Saved result count C=0 receives all actual results; positive C receives exactly C, truncating excess or nil-padding missing values. Caller top becomes returnBase+receivedCount. The child frame is popped and thread stackTop returns to its varargBase. Scope: ordinary child return, not special completion/coroutine/protected-call routing.

Sources: `machine/ts/machine/cpu/cpu.ts:3270-3271,2981-2989,3406-3418`; `machine/cpp/machine/cpu/cpu_dispatch.inl:541-550`; `machine/cpp/machine/cpu/cpu.cpp:3013-3014,3127-3139`.

**MC19 — Builtin result adjustment matches CALL's C rule.** Builtin result writing receives all results for C=0 or exactly positive C, truncates/pads nil, and sets caller top accordingly. This is cardinality parity, not a statement that each builtin accepts missing/excess arguments or returns the same kind of result.

Sources: `machine/ts/machine/cpu/cpu.ts:3421-3438`; `machine/cpp/machine/cpu/cpu.cpp:1876-1892,3127-3139`.

**MC20 — Captured locals survive normal return as upvalues.** Nonstatic closure creation resolves captured local-slot upvalues or enclosing-closure upvalues. RET closes upvalues before releasing the returning frame. This supports closure-captured language values, not exposing captured local slots as stable CPU byte addresses. Static zero-upvalue closures can instead be cached by function-record address.

Sources: `machine/ts/machine/cpu/cpu.ts:3302-3359,2945`; `machine/cpp/machine/cpu/cpu.cpp:2907-2964`; `machine/cpp/machine/cpu/cpu_dispatch.inl:508`.

**MC21 — Runtime encodings are mirror-specific.** TS `ValueSlots` stores explicit tags plus scalars/references, including a scalar BuiltinFunctionId. Native stores a 64-bit Value and a tagged builtin-object pointer. A closure is a guest callable category in both, not a shared raw numeric-address encoding. Do not call all ordinary language slots raw 32-bit words or claim their physical representation is mapped main RAM.

Sources: `machine/ts/machine/cpu/value_slots.ts:25-40,202-206,235-237`; `machine/cpp/machine/cpu/value.h:29,95-139,171-173,185-187,240-246`.

## Named exported BIOS functions — same call machinery, distinct compile-time binding

**MC22 — The named direct BIOS export list is narrow.** The configured direct function imports are root exports of `math/sin`, `string/float/decode`, and `gpu/system_vram_region`. The import record carries module path, export-path key and functionAddress; it is not a universal list of every firmware/library function.

Sources: `toolchain/ts/rompack/system.ts:9-22`; `toolchain/ts/rompack/blua32_bios_imports.ts:12-20`.

**MC23 — Named direct BIOS import is a compile-time call target.** Installed module bindings resolve through the BIOS import index; compile-time locals for static function exports retain the binding rather than a Lua runtime value. Loading one as an ordinary runtime value is rejected with `Static function export '...' is a call target, not a Lua runtime value.` Its legal call position emits a symbolic target load and the same ordinary CALL producer. Do not claim the imported name can be passed/stored/returned as a first-class closure simply because authored ordinary local functions can.

Sources: `toolchain/ts/lua/compiler.ts:2561-2590,2685-2686,2745-2758,2831-2835,5666-5690`.

**MC24 — Linked BIOS target is a function-record address.** The system link product writes each configured import's functionAddress from its function-table address array. The cartridge linker rewrites its BIOS target relocation to CLOSURE with `functionAddress >> 4`. Local closure prototype operands are likewise rewritten to function-record addresses divided by 16. The resulting CALL is not a dedicated BIOS opcode, raw call-by-ID, or branch directly to the codeAddress.

Sources: `toolchain/ts/rompack/blua32_linker.ts:791-799,1065-1078,660-672,428-445`; CALL closure consumption in MC11/12. Paired opcode leaves `machine/ts/spec/blua32/opcode.ts:45-50,66-68`, `machine/cpp/spec/blua32/opcode_list.inl:44-49` contain ordinary CLOSURE/CALL/RET, no separate CALL_BIOS.

**MC25 — Ordinary BIOS closure call is not EXEC or privilege entry.** Ordinary CALL/frame setup records the target record's image and PC but does not write CPU status or relatch the active execution-image/bus state. Thus normal calling of a record in the system image is still ordinary CALL. This is not an API permission guarantee for arbitrary BIOS memory/device activity; do not teach EXEC as normal function invocation.

Sources: `machine/ts/machine/cpu/cpu.ts:2918-2939,3252-3299`; `machine/cpp/machine/cpu/cpu_dispatch.inl:490-503`; `machine/cpp/machine/cpu/cpu.cpp:2995-3046`. Separate EXEC entry is `machine/ts/machine/cpu/cpu.ts:1523-1546`, `machine/cpp/machine/cpu/cpu.cpp:1095-1118`.

**MC26 — Existing installed library globals use another route.** Boot firmware assigns `string = require('string')`. The compiler's cart boot-primitive list is empty, and non-boot global names resolve to ordinary GETGL/SETGL, not GETSYS. The paired CPU registers ordinary global names into its shared ordinary name-to-slot map and GETGL/SETGL access that ordinary value store; each image maps its encoded name indices to those runtime slots. This route is distinct from MC22's three named static function imports. Scope: actual producer and slot route, not a universal guarantee of frontend undeclared-name visibility.

Sources: `machine/bios/main.lua:4-7`; `toolchain/ts/lua/compiler/system_boot_symbols.ts:8-10`; `toolchain/ts/lua/compiler.ts:591-600,2827-2828,2885-2886`; `machine/ts/machine/cpu/cpu.ts:1015-1045,1335-1342,2344-2356`; `machine/cpp/machine/cpu/cpu.cpp:561-591,923-930`; `machine/cpp/machine/cpu/cpu_dispatch.inl:60-76`.

## Relevant call failures only

**MC27 — Nonfunction CALL is a language call fault.** Calling any non-Closure/non-Builtin tag throws LuaExecutionError with CALL_NON_FUNCTION reason 1. A wrong count alone does not take this dispatch failure. Handling/trap/recovery policy is outside this extract.

Sources: `machine/ts/machine/cpu/cpu.ts:2922-2939`; `machine/cpp/machine/cpu/cpu_dispatch.inl:493-503`; `machine/ts/spec/blua32/cop0.ts:26-36`; `machine/cpp/spec/blua32/cop0.h:32-42`.

**MC28 — Target-record/upvalue bus failure is distinct.** Closure CALL hard-halts when its function record cannot be read on the current execution bus. CLOSURE also hard-halts on failed function-record read, and dynamic closure creation hard-halts if a captured-upvalue record read fails. These are the relevant inspected call/closure metadata edges, not a complete arbitrary malformed-image/fetch/fault contract.

Sources: `machine/ts/machine/cpu/cpu.ts:3252-3259,2871-2877,3315-3324`; `machine/cpp/machine/cpu/cpu.cpp:2995-3003,2918-2927`; `machine/cpp/machine/cpu/cpu_dispatch.inl:447-454`.

## Existing exact examples (authority is the named source, no invented program)

**MC29 — Existing one-argument/one-result direct BIOS use.** Exact existing firmware snippets:

```lua
local sin_turn32<const> = require('math/sin')
```

```lua
local sin<const> = function(radians)
	local sin_q16<const> = sin_turn32((trunc(radians * turn32_per_rad)) & 0xffffffff)
	return sin_q16 * q16_inv_scale
end
```

Authorities: `machine/bios/math.lua:1,100-103`. Export implementation takes `angle` and returns one expression on either branch: `machine/bios/math/sin.lua:43-64`. These snippets establish real call spelling and authored cardinality, not a new angle-format/numerical-accuracy API claim.

**MC30 — Existing zero-argument/two-result direct BIOS use.** Exact existing cartridge excerpts:

```lua
local system_vram_region<const> = require('gpu/system_vram_region')
```

```lua
result.system_origin, result.system_size = system_vram_region()
```

Authorities: `carts/display_manual/cart.lua:4,40`. Exact existing exported function opening/return excerpts:

```lua
return function()
```

```lua
	return (left & 0x0000ffff) | ((top & 0x0000ffff) << 16),
		((right - left) & 0x0000ffff) | (((bottom - top) & 0x0000ffff) << 16)
end
```

Authorities: `machine/bios/gpu/system_vram_region.lua:10,27-29`. Their packed GPU-coordinate meaning remains the separate BM36 owner; this fact records actual zero-argument/two-result spelling, not physical RAM storage or a whole GPU reservation audit.

**MC31 — Existing ordinary vararg forward/return.** Exact existing firmware function:

```lua
local closed<const> = function(thread, ...)
	frame_scopes.retire(thread, 0)
	return ...
end
```

Authority: `machine/bios/coroutine.lua:21-24`. This is a real named-parameter-plus-varargs and open-return producer. No coroutine lifecycle/protected-call/recovery contract is inferred from the snippet.

## Narrow root extensions, checked against live owners

**MC32 — Method receiver.** A cartridge colon call evaluates its receiver, looks up the named method and passes the same receiver as the first argument; explicitly authored arguments follow it. A colon-defined function includes implicit self before its named parameters (MC01). This is not a byte-memory object ABI. Producer `toolchain/ts/lua/compiler.ts:5661-5665,5673-5690`; paired SELF handlers `machine/ts/machine/cpu/cpu.ts:2452-2469` / `machine/cpp/machine/cpu/cpu_dispatch.inl:124-129`. No string-method metatable, call-order race or table `__call` behavior is inferred.

**MC33 — On-console loader route naming.** Installed boot publishes global `load = lua_compiler.load`; the API protected-calls its compiler/load.compile and returns the compiled result or nil plus its failure result. The compile producer parses the source through the firmware parser and compiles/links its root closure. `machine/bios/main.lua:8-9`; `machine/bios/compiler/api.lua:1-24`; `machine/bios/compiler/load.lua:27-46`. This identifies the on-console producer in MC08; it is not the full loader environment/lifetime/security/error contract. MC08 permits two explicitly route-scoped statements, not a common parenthesis rule or a runtime fix. Complete dynamic source loading remains a separate programming reference.

# Bounded call-fact gaps / withheld claims

**G01 — Withheld common clearing-range guarantee for maxStack=0.** TS `prepareFrameRegisters` clears `max(maxStack,1)` reserved entries (`machine/ts/machine/cpu/cpu.ts:3175-3183`). Native ordinary push reserves max(maxStack,1) but clears only maxStack entries (`machine/cpp/machine/cpu/cpu.cpp:3022-3028`; materialized-argument push `:3099-3105`). The precise inspected disagreement is the clearing range for a representable zero maxStack record. Do not claim mirror-identical complete reserved-slot clearing for all records. This extraction neither proves a compiler-emitted zero-maxStack function nor executes a repro; no fix is requested/inferred.

**G02 — Keep producer scope and raw encoding separate.** Toolchain bare/default source return is one nil; B=0/C=0 are open raw operands, not generally zero arguments/results. **Parentheses common contract withheld:** external toolchain discards the wrapper (`toolchain/ts/lua/syntax/parser.ts:1345-1349`, classifier `toolchain/ts/lua/compiler.ts:5754-5764`); on-console firmware sets `expands_results=false` for parenthesized call (`machine/bios/compiler/parser.lua:177-183`) and tests that flag when expanding final arguments/results (`machine/bios/compiler/compiler.lua:652-656,1152-1155`). Existing loader tests expect scalar adjustment (`tests/lua/firmware_call_results.test.ts:12-13,18,31-43`). Do not merge these into an all-BLua claim. No loader test/runtime was executed here; no fix is inferred.

**G03 — No new physical ABI / pointer-signature inference.** Frame slots/closures are language runtime storage, not a byte-addressable RAM stack. Static imported BIOS function names are compile-time call targets, not ordinary first-class runtime values. Parameter parser has no pointer annotation branch. This extraction does not establish typed-view metadata propagation through signatures, string bytes, arbitrary-local address-of, object layout/GC/reclamation, ownership transfer, stack limits, permitted RAM arenas, or byte-address ABI for dynamic values.

**G04 — Bounded fault/privilege scope.** Only nonfunction CALL and the named record/upvalue bus-failure edges are extracted. No arbitrary malformed image/fetch path, protected-call handling, supervisor/recovery policy, complete builtin arity contract, exception behavior, or exhaustive EXEC permission audit is added. Normal CALL being non-privilege-transition does not grant device/MMIO permissions.

**G05 — Shared library namespace versus direct imports.** Do not describe all BIOS/library functions as `require`-importable static exports: direct import list has exactly three configured roots. Existing shared `string` comes from firmware global publication and ordinary global slots, not GETSYS. MC26 stops before a universal cart-frontend name-visibility/availability guarantee; use an actually compiled program for author-facing syntax claims.

No repository file, compiler/runtime source or test was changed by this extraction. Narrow paired-source evidence exists in `/tmp/bmsx-memory-call-cpu-paired.md`; no full ISA/ABI/GC/recovery audit is claimed.
