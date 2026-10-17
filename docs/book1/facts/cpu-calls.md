# CPU calls and object-operand facts (live-source extraction)

Scope: CALL, RET, VARARG, CLOSURE, GETUP, SETUP, GETGL, SETGL, GETSYS, SETSYS, GETT, SETT, GETI, SETI, GETFIELD, SETFIELD, SELF, NEWT. No repository edits. No architecture chapter, PDFs, chapter prose, compiler, tests, or memory used. `git status --short` was empty at extraction start and finish.

## Source-key notation

Every `T:n-m`, `D:n-m`, or `C:n-m` below identifies exactly one owner path/range:

- T = `machine/ts/machine/cpu/cpu.ts`
- D = `machine/cpp/machine/cpu/cpu_dispatch.inl`
- C = `machine/cpp/machine/cpu/cpu.cpp`
- OTS = `machine/ts/spec/blua32/opcode.ts`
- OCPP = `machine/cpp/spec/blua32/opcode.cpp`
- ITS = `machine/ts/spec/blua32/instruction_format.ts`
- ICPP = `machine/cpp/spec/blua32/instruction_format.h`
- FTS = `machine/ts/spec/blua32/image_format.ts`
- FCPP = `machine/cpp/spec/blua32/image_format.h`

Notation: `R(i)` is a logical frame register slot, `K(i)` an execution-image constant, `top` the exclusive logical register top. `RK(x)` is `R(x)` when the decoded signed RK operand is nonnegative, otherwise `K(-1-x)`. It is not a register byte address.

## Spec/owner disposition

- **MATCHED, narrow:** fixed CALL argument encoding/decoding is explicitly defined by OTS:70-73 and `machine/cpp/spec/blua32/opcode.h:21-25`; dispatch agrees at T:2918-2921 / D:490-492.
- **MATCHED, narrow:** closure register-address flag is explicitly defined by ITS:35-36 / ICPP:41-42; dispatch consumes it at T:2865-2870 / D:443-446. Function alignment 16 is FTS:30-31 / FCPP:36-37.
- **MATCHED, narrow:** vararg/static flags and upvalue stack/index masks are explicitly defined by FTS:41-46 / FCPP:47-52 and consumed by the frame/capture owners below.
- **MATCHED:** opcode identities/order and costs are mirrored by OTS:1-84 / `machine/cpp/spec/blua32/opcode_list.inl:1-64` plus OCPP:5-70. Cost table below is decoded from those parallel sequences.
- **IMPLEMENTATION-ONLY:** the inspected spec leaves do not define the remaining per-op operand effects, top rules, table resolution, callable classification, or error policy. For those rows, the paired live owners below agree; this is not an independent prose-spec guarantee.
- **No inspected disagreement found.** No stopped conflicting claim is outstanding within the bounded scope. Broader validity/heap/library semantics were not inferred.

## Guest-value and register representation

| Fact | TypeScript evidence | C++ evidence | Disposition |
|---|---|---|---|
| Logical values distinguish nil, false, true, number, string, table, closure, builtin function, thread. TS stores tag/scalar/reference lanes; native stores an encoded 64-bit `Value`. These are runtime representations, not one shared raw register-word ABI. | `machine/ts/machine/cpu/value.ts:8-18`; `machine/ts/machine/cpu/value_slots.ts:25-40` | `machine/cpp/machine/cpu/value.h:29-40`; `machine/cpp/machine/cpu/value.h:95-129` | Owner agreement on guest categories; storage intentionally differs. Native number classification is encoded-tag zero, not a `ValueTag::Number` enum member. |
| CALL examines the guest value category: Closure or BuiltinFunction, and nothing else. A number containing a function-record address is not itself CALL-callable. | T:2922-2939 | D:493-503 | Implementation-only; do not describe callable payloads as guest raw pointers. |
| Register stores that use the ordinary fast setter raise `top` to at least `index+1`; they do not lower it. | T:3475-3479 | C:2494-2500 | Implementation-only. |
| Frame register storage is a logical view into the owning thread stack, positioned after that frame's saved varargs. | T:3175-3184 | C:3017-3028 | Implementation-only; no guest byte-addressed registerfile established. |
| RK selection uses negative decoded values for image constants and nonnegative values for register slots. | T:2476-2488 | `machine/cpp/machine/cpu/cpu.h:447-452` | Implementation-only here; root owns actual decode/field widths. |

## Operand/effect matrix

Base costs are listed separately below. Loads into A raise top through the ordinary setter/bump, unless a dedicated top rule is stated.

| Opcode | Established operand/effect fact | TS owner | C++ owner |
|---|---|---|---|
| GETGL | `R(A) = ordinaryGlobal(imageGlobalSlot(Bx))`. Bx in the instruction denotes the execution-image ordinary-global name index, not a table key or immediate string value. | T:2351-2354 | D:70-73 |
| SETGL | `ordinaryGlobal(imageGlobalSlot(Bx)) = R(A)`. No register result/top increase. | T:2355-2357 | D:75-78 |
| GETSYS | `R(A) = systemGlobal(imageSystemSlot(Bx))`, in the distinct system namespace. | T:2344-2347 | D:60-63 |
| SETSYS | `systemGlobal(imageSystemSlot(Bx)) = R(A)`. No register result/top increase. | T:2348-2350 | D:65-68 |
| GETI | `R(A) = index(R(B), C)`, with C itself the integer key, not `R(C)` or `K(C)`. | T:2358-2376 | D:80-91 |
| SETI | `index(R(A), B) = RK(C)`, with B itself the integer key. | T:2378-2408 | D:94-102 |
| GETFIELD | `R(A) = index(R(B), string-id K(C))`; C indexes the image constant pool directly, not RK. | T:2410-2422 | D:105-111 |
| SETFIELD | `index(R(A), string-id K(B)) = RK(C)`; B indexes the image constant pool directly. | T:2424-2450 | D:114-121 |
| SELF | Preserve the original `R(B)` into `R(A+1)` first, then put field lookup `index(original R(B), string-id K(C))` into `R(A)`; both destinations affect top. The receiver is retained separately from the method value. | T:2452-2469 | D:124-129 |
| GETT | `R(A) = index(R(B), RK(C))`. The key is a guest value, not a byte offset. | T:2474-2500 | D:137-149 |
| SETT | `index(R(A), RK(B)) = RK(C)`. No register result/top increase. | T:2502-2541 | D:152-162 |
| NEWT | Create a table with B array-capacity request and C hash-size request; store the table value in A. Neither B nor C is a source register or initial table element count. | T:2543-2549 | D:165-168 |
| GETUP | Copy closure upvalue B's current value into `R(A)`. | T:2886-2889 | D:463-466 |
| SETUP | Copy `R(A)` into closure upvalue B's current storage. No register result/top increase. | T:2891-2894 | D:469-472 |

All matrix operand-effect rows are implementation-only beyond the spec facts explicitly matched above. Capacity interpretation for NEWT is additionally anchored at T:515-520 / C:408-418: hash request is passed through `Table.hashCapacity`, array request passed as array capacity, then storage reserved/created. Exact hash growth policy and table storage layout are out of scope.

## CALL, RET, VARARG and frame top

| Fact | TS owner | C++ owner | Spec relation |
|---|---|---|---|
| CALL A selects callee; arguments start at `A+1`. B>0 means exactly B-1 arguments. B=0 means `max(top-A-1,0)` arguments. | T:2918-2935 | D:490-500 | B rule explicitly matches OTS:70-73 / `machine/cpp/spec/blua32/opcode.h:21-25`. |
| CALL C is the requested result count passed unchanged to closure/builtin call machinery; C=0 means accept all produced results, C>0 means exactly C. Results replace slots beginning at caller A. | T:2923-2935 | D:491-500 | Dispatch implementation-only; count expansion proved by return writer below. |
| Ordinary closure entry reads the closure's function-record address on the execution bus; failed read hard-halts. It does not jump to an instruction address taken directly from a generic callee number. | T:3252-3261 | C:2995-3005 | Function metadata layout is FTS:30-39 / FCPP:36-45. Root owns detailed record-read/fault behavior. |
| New frame PC is the record code address; returnBase/returnCount are saved; top begins at numParams, not maxStack. | T:3261-3274 | C:3005-3028 | Metadata fields named by FTS:32-38 / FCPP:38-44; entry behavior implementation-only. |
| Fixed parameters copy `min(numParams,argCount)` arguments; missing parameters become nil. Excess arguments are retained as varargs only when the vararg flag is set; vararg count is `max(argCount-numParams,0)`, otherwise zero. | T:3275-3297 | C:3017-3043 | Vararg flag matches FTS:41 / FCPP:47. |
| VARARG A,B copies saved varargs beginning at A. B=0 means all saved varargs; B>0 means exactly B values (not B-1), filling shortage with nil. | T:2896-2909 | D:475-480 | Operand/count effects implementation-only. |
| VARARG B=0 sets top exactly to `A+copiedCount`, including zero values; fixed B only raises top to at least `A+B`. | T:2910-2915 | D:481-486 | Implementation-only; open VARARG may lower top. |
| RET A,B returns from A. B=0 produces `max(top-A,0)` values; B>0 produces exactly B values (not B-1). It closes that frame's open upvalues before return routing. | T:2942-2946 | D:506-508 | Implementation-only. |
| Return writes select all produced values for requested count zero, otherwise requested count; excess results truncate, missing results become nil. Caller top is then exactly `returnBase+selectedCount`. | T:3406-3419 | C:3127-3140 | Implementation-only. |
| Ordinary nested RET writes results into caller returnBase, then pops/releases callee and releases its stack span back to varargBase. | T:2981-2989 | D:542-550 | Implementation-only. |
| RET has explicit alternate routes for protected-call target, completion latch, and coroutine resumer; a root frame with no resumer latches completion values. Thus 'every RET writes to another frame' is false. | T:2947-2979 | D:509-540 | Implementation-only; protected-call/coroutine continuation semantics not expanded. |
| Normal builtin completion uses the same result-count selection/nil-padding/exact-top rule and writes starting at CALL A. | T:3421-3438 | C:1888-1892 | Implementation-only; special PCall/XPCall/coroutine routes excluded. |

## CLOSURE and upvalue lifetime

| Fact | TS owner | C++ owner | Spec relation |
|---|---|---|---|
| CLOSURE destination is A. With register-address flag clear, its function-record address is `Bx*16`. With flag set, Bx selects the register supplying an unsigned address. It then reads the function record on the bus before constructing/storing a Closure value. | T:2865-2883 | D:443-459 | Flag matches ITS:35-36 / ICPP:41-42; alignment matches FTS:31 / FCPP:37. Numeric conversion edge cases are root/numeric-agent scope. |
| CLOSURE record-read failure hard-halts without writing A; an upvalue-table bus-read fault also hard-halts and returns without writing A. | T:2871-2883; T:3313-3324 | D:447-459; C:2916-2928 | Implementation-only fault policy. |
| A static-flag record with zero upvalues uses the per-function-address static closure cache. Other records follow capture allocation. | T:3302-3307 | C:2907-2912 | Flag matches FTS:42 / FCPP:48. |
| Static closure cache yields the existing closure for that function address or records a zero-upvalue closure for it. | T:1158-1166 | C:700-713 | Implementation-only; this is guest closure identity behavior, not a raw address becoming callable. |
| Each upvalue descriptor is one 32-bit word read at `upvalueTableAddress + index*4`. Its high bit means capture a parent-frame register slot; lower 31 bits give that slot/upvalue index. Clear high bit selects an existing parent closure upvalue. | T:3315-3336 | C:2918-2940 | Matches FTS:44-46 / FCPP:50-52. |
| For stack captures, an already-linked open upvalue for the parent-frame slot is reused; otherwise a new open upvalue is created and linked. Do not generalize this to deduplication of arbitrary malformed/duplicate descriptors in one record. | T:3326-3333; T:3342-3357 | C:2930-2937; C:2949-2960 | Implementation-only. |
| While open, GETUP/SETUP access the captured frame register slot; after closing, they access the upvalue's retained guest-value storage. | T:3377-3403 | C:2980-2992 | Implementation-only. |
| Closing copies each open captured register value into its upvalue, marks it closed, and detaches frame/list links. RET invokes this before releasing the frame. | T:3362-3374 | C:2967-2977 | Implementation-only. Other close/unwind callsites not audited. |

## Global namespace mapping

| Fact | TS owner | C++ owner | Spec relation |
|---|---|---|---|
| Ordinary globals and system globals use separate name-to-slot maps, registered-name lists, and value stores. Registering a new name initializes its value to nil; registering an existing name reuses its slot within the chosen namespace. | T:1013-1047 | C:555-591 | Separate image global/system name tables are FTS:13-16 / FCPP:19-22. |
| Image creation independently registers ordinary and system name tables and retains their image-index-to-runtime-slot arrays. | T:1106-1124 | C:631-642 | Matches separate image table/count fields; does not prove software privilege policy. |
| Decode translates GETGL/SETGL Bx through the image ordinary-slot array and GETSYS/SETSYS Bx through system-slot array, before direct dispatch copying. | T:1334-1342 | C:922-930 | Implementation-only mapping. Root owns decode details. |

## Table/index boundary and bounded error facts

| Fact | TS owner | C++ owner | Spec relation |
|---|---|---|---|
| Table reads accept a Table base; String bases route to the CPU string-index table. Other guest categories throw INDEX_NON_TABLE. This applies to general, integer, and cached string-field lookup. | T:619-638; T:655-672; T:687-706 | C:3243-3274; C:3277-3315 | Implementation-only. This is not substring indexing inferred from C or a host string property lookup. |
| Read with no metatable performs direct table read. With a metatable it delegates to table index resolution; an exhausted/failed chain throws METATABLE_LOOP. | T:639-652; T:673-684; T:707-726 | C:3243-3249; C:3207-3228; C:3282-3297 | Implementation-only boundary, not an audit of `__index` semantics. |
| Table writes accept only Table bases; general/integer/string-field stores delegate directly to corresponding table storage methods. Other guest categories throw ASSIGN_NON_TABLE, including String. | T:729-793 | C:3335-3361 | Implementation-only; do not invent `__newindex` behavior from these CPU methods. |
| GETI explicitly attempts an integer-array read when the table base has no metatable, and SETI explicitly attempts an integer-array store first. Native additionally exposes analogous number-array GETT/SETT fast paths in dispatch; TS general GETT/SETT delegate to table-owner methods. Exact general-key and array rules are not established by this extraction. | T:2362-2366; T:2396-2408; T:2490-2498; T:2531-2540 | D:80-101; D:137-161 | Implementation-placement difference, not an established semantic conflict. No uninspected table fast-path equivalence claim. |
| GETFIELD/SETFIELD/SELF use an instruction-associated predicted table slot cache, not a changed guest key or a numeric byte address. | T:2412-2419; T:2440-2448; T:1364-1365 | D:105-128 | Implementation-only; cache internals excluded. |
| CALL of any non-Closure/non-BuiltinFunction guest category throws CALL_NON_FUNCTION. | T:2922-2939 | D:493-503 | Implementation-only; exception routing is root scope. |

The quoted fault names are symbolic reason constants, not a claim about host exception text or guest catch policy.

## Base costs and extra primitive charge

Spec cost pair for the table: OTS:75-84 / OCPP:5-70; opcode indexing pair OTS:1-65 / `machine/cpp/spec/blua32/opcode_list.inl:1-64`. These agree.

| Base cycles | Scoped opcodes |
|---|---|
| 1 | GETT, NEWT, CLOSURE, GETUP, GETSYS, GETGL, GETI, GETFIELD, SELF |
| 2 | SETT, SETUP, VARARG, CALL, RET, SETSYS, SETGL, SETI, SETFIELD |

CALL of a builtin additionally charges the builtin's base cost before its special/normal route: T:3841-3848 / C:1876-1885. The base cost is primitive-specific; current cost tiers are 1, 2, 4 with perArg/perRet metadata zero (`machine/ts/machine/cpu/value.ts:97-142` / `machine/cpp/machine/cpu/value.h:23-93`). This is not a claim that the opcode base is the entire cost of arbitrary primitive internals. No table- or closure-specific additional explicit instruction charge appears in the inspected dispatch/narrow owner paths; heap/GC timing and library-specific work are not audited. Root owns when base budget is debited and exception/debt scheduling.

## Explicit scope gaps

- Full table key admissibility, nil/NaN keys, array/hash rules, missing-key semantics, metatable function/table chain behavior, chain limit, cached-slot correctness, table growth, and heap/GC errors: table owners not expanded.
- Function-record bus validity, alignment exceptions, malformed metadata behavior, closure record boundary checks, numeric register-address conversion edge cases: root/numeric extraction, not inferred here.
- Protected-call, coroutine, completion, interrupt-frame, error unwind, and builtin internals beyond the directly visible return routes/base charge: not expanded.
- Compiler emission invariants, function/upvalue index validity, duplicate descriptor guarantees, unreachable/invalid register values: no compiler/tests inspected, no assumed validation/fallback.
- Native host payload encoding is implementation storage, not evidence of a portable guest pointer ABI; TS host references likewise do not define guest classification.
