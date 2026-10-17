# Narrow supplement: numeric-for exits and NaN table positions

Read-only source extraction; no execution or runtime repair. This supplements `/tmp/bmsx-bios-table-next-facts.md` and supersedes any suggestion that wrong-position arithmetic necessarily throws or that a NaN position necessarily skips a shift. Root's isolated execution evidence is separate.

## Exact producer and branch mechanism

- Host compiler numeric-for initializes index, limit and step once, defaulting step to1: `toolchain/ts/lua/compiler.ts:4486-4498`.
- It tests `0 < step`; positive-step exit is **`limit < index`**, negative/nonpositive-step exit is **`index < limit`**. These are negated-strict-exit tests, not a continuation test `index <= limit` or `index >= limit`: `toolchain/ts/lua/compiler.ts:4499-4510`.
- Each exit comparison is emitted with A=1, followed by the exit jump. The CPU skips that next jump when comparison result differs from true; therefore false exit comparison enters/continues the body. TS dispatch: `machine/ts/machine/cpu/cpu.ts:2724-2735`; native dispatch: `machine/cpp/machine/cpu/cpu_dispatch.inl:356-368`.
- The host compiler emits body, `index = index + step`, then jumps back to the same comparison sequence: `toolchain/ts/lua/compiler.ts:4511-4521`.
- Firmware compiler specializes literal/default step sign but uses the same strict-exit operands with A=1: positive step uses `limit < index`; negative step uses `index < limit`: `machine/bios/compiler/compiler.lua:1485-1512`. Its dynamic-step path emits the same sign split and two comparisons: `machine/bios/compiler/compiler.lua:1514-1567`.
- Firmware then emits body, ADD(index,index,step), and back jump: `machine/bios/compiler/compiler.lua:1575-1599`.
- Both CPU LT leaves perform ordinary binary64 `<` for numeric operands. A NaN operand therefore gives false; neither leaf throws a comparison/type error for that numeric NaN: TS `machine/ts/machine/cpu/cpu.ts:2724-2735`; native `machine/cpp/machine/cpu/cpu_dispatch.inl:359-367`.

## How position becomes NaN, without a table-library arithmetic error

- Insert's positioned form computes `select(1, ...) // 1`; remove's nonnil explicit position computes `position_arg // 1`. Neither validates that input nor throws its own bad-position message: `machine/bios/table.lua:19-25,29-36`.
- Floor division on NaN remains NaN: quotient/truncation/subtract owner TS `machine/ts/spec/blua32/numeric.ts:1-5`; native `machine/cpp/spec/blua32/numeric.h:7-11`.
- TS arithmetic reads nonnumber slots as NaN, rather than parsing strings or throwing a numeric-argument error: `machine/ts/machine/cpu/value_slots.ts:128-131`; FLOORDIV reads through that numeric path at `machine/ts/machine/cpu/cpu.ts:2564-2567,2584-2586`.
- Native FLOORDIV decodes operand bits as doubles and normalizes the result, not a checked numeric coercion: `machine/cpp/machine/cpu/cpu_dispatch.inl:208-212`; decoding/NaN normalization `machine/cpp/machine/cpu/value.h:132-144`. Thus do not assign a library arithmetic-error contract to these wrong-type positions.
- NaN is an admissible numeric table key, not the nil-key error. TS hashes and compares it consistently: `machine/ts/machine/cpu/table.ts:879-887,912-918`; native normalized numeric word and key equality: `machine/cpp/machine/cpu/value.h:132-139,317-323`. Missing-key reads return nil: TS `machine/ts/machine/cpu/table.ts:169-180`; native `machine/cpp/machine/cpu/table.cpp:403-408`.

## Insert with a NaN positioned limit

- Positioned insert captures L and emits `for index = L, position, -1`, shifting `target[index]` into `target[index+1]`, then writes `target[position]` only after the loop: `machine/bios/table.lua:19-25`.
- With position=NaN and ordinary finite L, the descending loop's exit predicate is `index < NaN`, always false. **It enters the shift body; it does not skip it.** Its decrement does not make that exit predicate true. This conclusion is derived from the negative-step producer `toolchain/ts/lua/compiler.ts:4507-4519`, paired LT leaves `machine/ts/machine/cpu/cpu.ts:2724-2735` / `machine/cpp/machine/cpu/cpu_dispatch.inl:359-367`, and the library loop `machine/bios/table.lua:22-25`.
- Consequently source establishes **no comparison-driven completion of this shift**, and final `target[position] = value` is not reached by ordinary loop termination. Existing shift writes can occur first. A separately reached indexing fault, resource exhaustion or other execution interruption is not ruled out; this is not an executed infinite-duration proof: `machine/bios/table.lua:22-25`; update/back-jump producer `toolchain/ts/lua/compiler.ts:4518-4519`.
- Runtime zero trailing arguments take the positioned branch (argc is0), `select(1, ...)` produces no results, and its fixed local result is nil, hence NaN after //1. Body branch: `machine/bios/table.lua:13-21`; empty select suffix: `machine/ts/machine/cpu/cpu.ts:4304-4317`; fixed-result nil padding: `machine/ts/machine/cpu/cpu.ts:3406-3418`. This is a runtime-call fact, not authorization to write an ordinary source call rejected by arity diagnostics.

## Remove with an explicit NaN position

- Omitted/nil position still means L; **only an explicit nonnil position** goes through //1. The removed value is read first at that resulting position, before the loop: `machine/bios/table.lua:29-33`.
- With position=NaN, the ascending loop starts at NaN and its limit is L-1. Positive-step exit is `(L-1) < NaN`, false, so the body executes. The body is `target[NaN] = target[NaN+1]`; NaN+1 remains NaN, and the ADD step likewise leaves index NaN. No comparison-driven loop exit occurs: `machine/bios/table.lua:31-36`; positive-step producer `toolchain/ts/lua/compiler.ts:4504-4519`; ADD leaves TS `machine/ts/machine/cpu/cpu.ts:2569-2571`, native `machine/cpp/machine/cpu/cpu_dispatch.inl:171-175`.
- Therefore tail deletion `target[L] = nil` and `return removed` are not reached through ordinary loop termination in that case. For a plain table the loop addresses the same NaN numeric key repeatedly; metatable/index faults or other external/resource interruption remain separate possibilities. Source sites: `machine/bios/table.lua:32-37` and key-admission leaves above. No execution claim is added here.

## Ordinary direct source arity versus runtime indirect call

- Tooling descriptor requires list plus value for table.insert, with pos optional: `toolchain/ts/lua/builtin_descriptors.ts:61`.
- Static call resolution uses builtin minimum arity when a static callee path matches, and reports too-few arguments as an error with message template `<name> expects <required> arguments, but <actual> was/were provided.`: `toolchain/ts/lua/semantic/diagnostics.ts:357-375,395-415`.
- Root reports direct `table.insert(target)` is rejected as `table.insert expects 2 arguments, but 1 was provided.` This is parent-supplied observed evidence, not executed by this extractor. The zero-tail runtime route discussed above is reached indirectly (for example root's pcall route), not by pretending that rejected direct source is accepted.

## Editorial correction and retained limits

- Do not document a guaranteed bad-position arithmetic error, a guaranteed NaN bounds no-op, or guaranteed completion for wrong-type/nonfinite positioned insert/remove. Exact finite ordinary position algorithms in the original sheet remain intact.
- The established shared #/SETT/rawset producer mismatch remains a separate STOP. This supplement does not fix it, widen a whole optimizer/GC audit, or claim every possible host/runtime execution path for arbitrary values was tested.
