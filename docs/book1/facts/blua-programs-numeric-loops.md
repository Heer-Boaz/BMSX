# BLua numeric-for mutation and explicit-zero edges — finite source facts

## Scope and inspection boundary

- Checkout inspected: `master`, `e43ee94f19d73aa4564f620e42ddbaa2c306a52f` (2026-10-18).
- Read-only source extraction. No repository edits, build, test, cartridge execution, runtime/compiler repair, fallback, or new harness. The pre-existing worktree entries were `.vscode/launch.json`, `.vscode/tasks.json`, and untracked `docs/examples/`; they were not changed.
- `AGENTS.md` was read. `docs/book1/facts/blua-programs-source-forms.md` was used only as a source index. No `docs/architecture.md`, historical PDF, public chapter prose, or review was opened.
- Authority below is current executable source. This sheet closes only the named source DRAFT questions about assigning the numeric-for variable and supplying an explicit zero step. It does not accept CPU7, Table length, BZ01, all source forms, all optimizer behavior, or the whole manual.
- Statements described as finite deductions are deductions from the cited branch/update sequence, not measured execution results. Unless explicitly stated otherwise, comparison/update explanations concern Number operands; the finite examples do not establish all-NaN, infinity, range, representability, overflow, or termination guarantees.

## A. Actual cartridge producer route

**P01 — This is the cartridge compiler's loop, not a stock-Lua runtime numeric-for implementation.** Cartridge program-module assets are parsed using `parseLuaChunk`; that wrapper directly constructs `LuaLexer` and `LuaParser`. The cart branch compiles the entry and selected modules with `compileLuaChunkToProgram`, encodes the resulting object, and calls `linkCartBlua32Image`. The syntax `ForNumericStatement` dispatches to the compiler method inspected below.

Evidence:
- `toolchain/ts/rompack/blua32_image_builder.ts:84–108` (source assets to parsed modules), `213–231` (cart compiler/object/link route).
- `toolchain/ts/lua/analysis/parse.ts:16–21` (actual lexer/parser wrapper).
- `toolchain/ts/lua/compiler.ts:3651–3653` (numeric-for lowering dispatch).

**P02 — Binding facts here are from the compiler's directly consumed frontend.** The compiler builds a frontend from the actual entry/module source and AST, consumes its diagnostics, and gives the entry builder the frontend's bound file. The numeric-for lowerer obtains the loop declaration from that same semantic file. This is not an IDE hover/type-inference claim.

Evidence:
- `toolchain/ts/lua/compiler.ts:5913–5934`, `6181–6185`, `6301–6314`, `4487–4490`.
- `toolchain/ts/lua/semantic/frontend.ts:157–169` (frontend construction), `197–220` (bound file and directly computed diagnostics), `599–613` (lexical/global reference classification).

**P03 — The sequence below names lowerer logical registers/control-flow edges, not guaranteed literal optimized ROM bytes.** `getCode` finalizes the builder; finalization optionally calls the general instruction optimizer when `optLevel > 0`. Its finite Number constant arithmetic uses `+`, and Number ordering folding uses `<`/`<=`. Finalization encodes the patched instruction targets as relative instruction-word offsets, accounting for WIDE instructions. The linker copies compiled text, performs its relocation passes, and puts that text into the linked image. There is no separate numeric-for dispatch in the inspected producer: its actual lowerer emits LT/JMP/ADD.

Evidence:
- `toolchain/ts/lua/compiler.ts:1690–1693`, `1728–1744`, `1771–1778`, `1847–1878`, `2010–2020`, `4486–4526`.
- `toolchain/ts/lua/compiler/optimizer/index.ts:2086–2122` (optimization-level entry), `toolchain/ts/lua/compiler/optimizer/values.ts:183–189,217–226` (Number folding operations).
- `toolchain/ts/rompack/blua32_linker.ts:818–837,956–958`, `1128–1154`.
- Boundary: this is not a proof that every arbitrary O1/O2/O3 program transformation is correct, nor a promise that optimization preserves instruction count or physical register numbering.

## B. Grammar, evaluation order, and lexical scope

**N01 — Numeric syntax is `for name = start, limit [, step] do block end`.** After `for name`, `=` selects numeric-for; the parser reads start, limit, then optional step, retaining a separate AST expression for each. An omitted step is represented as `null`; explicit `0` is a present numeric-expression node, not omission.

Evidence:
- `toolchain/ts/lua/syntax/parser.ts:843–849,871–891`.

**N02 — Start, limit, and step are evaluated in that order, once per ordinary entry into this numeric-for statement, before its first test.** The lowerer declares/allocates `indexReg`, emits start into it with one requested result, allocates `limitReg` and emits limit into it with one requested result, then allocates `stepReg` and emits explicit step into it with one requested result. With no step node it loads Number `1`. The backedge targets `loopStart`, which is recorded only after these initializations, so normal iteration does not reevaluate any header expression.

Evidence:
- `toolchain/ts/lua/compiler.ts:4486–4502,4518–4519`.
- `toolchain/ts/lua/compiler.ts:3029–3043` (relative jump emitter records its target).
- Boundary: start's result seeds the mutable loop variable; it is not a separate immutable start cache. The limit and step results have their own allocated local registers. Changing source variables that originally supplied these Number values does not cause those expressions to be reread by the normal backedge. Reentry into the statement evaluates the header again; no lifetime-wide single-evaluation claim is made.

**N03 — The loop variable is a new body-local binding; the header expressions are bound before it is declared.** The binder first visits start, limit, and optional step in the enclosing scope, then enters the loop block scope, declares the variable with kind `'local'`, activates it, and visits the body. Therefore an occurrence of the same spelling in a header expression refers to the preceding enclosing binding (if one resolves), not the new loop variable. Body references resolve to the active loop binding unless another lexical binding shadows it. The loop binding is not published after leaving the scope.

Evidence:
- `toolchain/ts/lua/semantic/model.ts:933–950` (header-before-local binding order).
- `toolchain/ts/lua/semantic/model.ts:1665–1681` (`true` means activate the local; it does not mean const), `2071–2082` (nearest-scope binding lookup), `2110–2112` (leave scope).
- `toolchain/ts/lua/compiler.ts:4487–4490,4525`, `2082–2086` (compiler scope binding removal).

## C. The body variable and loop-control register are the same binding

**N04 — There is no hidden induction-variable copy separate from the body variable in this lowerer.** `indexReg` is the return value of `declareLocalFromDecl(loopDecl, ...)`; that local is stored under the declaration's symbol handle. Ordinary bound identifier loads resolve that handle back to its local register and load/copy from it. The loop's tests and tail ADD all use that very `indexReg`.

Evidence:
- `toolchain/ts/lua/compiler.ts:4488–4490,4504,4508,4518`.
- `toolchain/ts/lua/compiler.ts:2193–2204,2124–2135,2150,2168,2217–2223,2307–2312` (declaration to binding/register identity).
- `toolchain/ts/lua/compiler.ts:4720–4722,2799–2805` (bound body identifier load).

**N05 — Assignment to that unshadowed loop binding is permitted and writes the loop-control register.** The binder declares a `'local'`, not a `'constant'`; directly consumed constant-write diagnostics reject only kind `'constant'`. The compiler's identifier-assignment path rejects a local only if its kind is `'const'`, otherwise targets that binding's `reg`; a normal assignment emits MOV to it. Compound local assignment likewise computes from the target register and MOVs the result back to it. The numeric-for tail then adds cached `stepReg` to the register's *current post-body value*, not to a separately retained pre-body value.

Evidence:
- `toolchain/ts/lua/semantic/model.ts:945–948`.
- `toolchain/ts/lua/semantic/diagnostics.ts:274–293`.
- `toolchain/ts/lua/compiler.ts:4090–4103,4207–4211,4242–4248`, `4513–4519`.
- Boundary: this concerns an assignment whose resolved declaration is the loop variable. An assignment to a distinct same-spelled local introduced in the body is not an assignment to the loop binding. This sheet does not specify captured-variable lifetime, per-iteration closure cells, debugger register writes, or every goto/scope edge.

## D. Exact test/update edges and paired execution owners

**N06 — The normal-flow test is a pre-body test, with this exact LT/JMP polarity.** The compiler emits the following logical edges. `I`, `L`, `S` mean `indexReg`, cached `limitReg`, cached `stepReg`; `LT A,B,C` compares `B < C` and skips the immediately following *whole instruction* when the comparison Boolean differs from `A != 0`.

| Lowered location | Emission / condition | Edge |
| --- | --- | --- |
| Test selector | `LT 0, K(0), S` | When `0 < S` is true, skip the JMP to the other test and take the positive-step test. Otherwise execute that JMP. |
| Positive-step test | `LT 1, L, I`; next instruction is exit JMP | Exit if `L < I`; otherwise skip that exit JMP and JMP to body. |
| Other test | `LT 1, I, L`; next instruction is exit JMP | Exit if `I < L`; otherwise skip that exit JMP and enter body. |
| Ordinary body fallthrough | `ADD I, I, S`; `JMP loopStart` | Update the current body-visible value, then repeat the selector/test. |
| Test exit / pending break exit | targets patched after ADD and backedge | Leave the loop without running another body. |

Evidence:
- Producer: `toolchain/ts/lua/compiler.ts:4499–4525`; patched jump placeholders are JMP by default, `3111–3129`.
- TS LT operand/tag handling and skip polarity: `machine/ts/machine/cpu/cpu.ts:2701–2736` (Number comparison specifically `2725–2726`, polarity `2733–2735`).
- C++ LT: `machine/cpp/machine/cpu/cpu_dispatch.inl:356–368` (Number comparison `360–361`, polarity `365–367`).
- TS skip advances by the next decoded instruction's width: `machine/ts/machine/cpu/cpu.ts:1994–2004`; C++: `machine/cpp/machine/cpu/cpu.cpp:1008–1017`.
- TS JMP: `machine/ts/machine/cpu/cpu.ts:2849–2852`; C++ JMP: `machine/cpp/machine/cpu/cpu_dispatch.inl:424–427`.
- Decoded JMP destination formation: `machine/ts/machine/cpu/cpu.ts:1343–1349`; `machine/cpp/machine/cpu/cpu.cpp:931–937`.

**N07 — Finite Number interpretation of those edges is inclusive at the limit, but the source comparisons must not be rewritten into stronger all-value claims.** For finite Numbers, a positive step allows the body while `I <= L`; a negative step takes the other test and allows the body while `I >= L`. Equality does not trigger either strict-less-than exit. The emitted facts are nevertheless “exit if `L < I`” / “exit if `I < L`”, not a universal direct `<=`/`>=` test. The selector is literally `0 < S`, not a special zero check or a general classification of every possible runtime value.

Evidence: `toolchain/ts/lua/compiler.ts:4500–4509` plus paired LT owners cited in N06.

**N08 — ADD's numeric datapath is shared with ordinary arithmetic, with no numeric-for-only update/zero-step trap.** TS reads the RK Number operands and writes `left + right` as a Number; C++ reads its RK values, decodes the Number doubles and writes their sum. The loop uses ordinary ADD with destination and left operand both `indexReg`. Thus mutation affects the tail increment and the next test. It does not cause an immediate mid-body range check: remaining ordinary body statements precede that emitted tail. A `break` in this loop emits its pending exit jump; numeric-for patches that jump after the ADD/backedge, so break bypasses the tail update.

Evidence:
- `machine/ts/machine/cpu/cpu.ts:2551–2571,3589–3597,3497–3500`.
- `machine/cpp/machine/cpu/cpu_dispatch.inl:171–175`; `machine/cpp/machine/cpu/cpu.h:447–452` (RK source selection).
- `toolchain/ts/lua/compiler.ts:4513–4524,4621–4627`.
- Representation boundary: TS register Numbers use tagged scalar slots backed by `Float64Array` (`machine/ts/machine/cpu/value_slots.ts:25–35,128–131,181–186`); C++ `Value` is `uint64_t`, and Number encoding/decoding uses double bit storage (`machine/cpp/machine/cpu/value.h:29,95–110,132–145,159–161`). No integer induction-register or fixed-point loop counter is introduced here.

## E. Explicit zero step — actual current behavior

**Z01 — Explicit zero is not rejected by a numeric-for-specific compile rule and is not replaced with default one.** The parser preserves the step expression; the compiler tests whether the *node exists*, compiles it when present, and only loads one when absent. Numeric literal zero lowers to `K0`. The directly consumed diagnostic dispatcher has identifier, const-local-write/initializer, call, and reserved-memory diagnostics, not a zero-step diagnostic. There is no zero-step exception/guard in this numeric-for lowerer or the cited LT/ADD paths.

Evidence:
- `toolchain/ts/lua/syntax/parser.ts:875–889`.
- `toolchain/ts/lua/compiler.ts:4493–4498,4707–4710,3157–3163`.
- `toolchain/ts/lua/semantic/diagnostics.ts:124–137`.
- Zero/one instruction execution: TS `machine/ts/machine/cpu/cpu.ts:2325–2330`; C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:40–47`.
- Boundary: other errors in a program can still reject or interrupt that program; this is not an assertion that every source containing a zero step compiles or runs successfully.

**Z02 — Finite zero takes the “other” (non-positive) test, not the positive-step test.** With `S = 0`, `0 < S` is false. The next test is therefore `I < L`: if true, exit before the body; if false, enter it. In finite Number cases, `start < limit` produces no body entry; `start == limit` and `start > limit` permit initial body entry. There is no rule here that zero always produces zero iterations or that zero is silently converted to `1`.

Evidence: `toolchain/ts/lua/compiler.ts:4500–4510` plus paired LT/K0 owners in N06/Z01.

**Z03 — When the finite body leaves the loop binding unchanged, the zero-step tail provides no counter progress.** On ordinary fallthrough it computes the current `I + 0`, and retests. For finite numeric values with the same ordering result, this does not make a previously passing zero-step bound test fail. This is a statement about the numeric-for control path, not an unconditional “program runs forever” guarantee: body writes, break/return/other control transfers, faults, host/runtime interruption, or a failure to reach ordinary fallthrough are separate possibilities.

Evidence: `toolchain/ts/lua/compiler.ts:4508–4519`; paired Number ADD/LT owners in N06/N08.

**Z04 — Body mutation can terminate an entered finite zero-step loop through the next normal test.** For example, with start `3`, limit `1`, and step `0`, the initial `3 < 1` exit check is false, so the body is eligible to run. If that body writes the *loop binding* to Number `0` and reaches the tail, ADD computes `0 + 0`, and the next `0 < 1` check exits. Conversely start `1`, limit `3`, step `0` exits before any body assignment can run. These are finite static deductions; neither example was compiled or executed in this task.

Evidence: lexical/register identity N03–N05; `toolchain/ts/lua/compiler.ts:4500–4519`; paired LT/ADD/K0 owners in N06/N08/Z01.

## Disagreements and still-open boundaries

- No disagreement was found between the inspected TS and C++ executable owners for the claimed Number ADD, Number strict-order comparison, skip polarity, zero/one loads, or JMP edges. This is not whole-runtime parity acceptance and not an all-value numeric specification.
- Do not describe body-variable assignment as ignored, rejected, or confined to a presentation copy. The current producer uses that same bound local register for body access, update, and tests.
- Do not describe explicit zero as a compile error, default one, always-empty loop, or universal nontermination case. Preserve the actual branch and update facts above.
- No arbitrary non-Number header/mutation semantics, all-NaN/infinite behavior, arithmetic range/rounding/overflow/underflow promises, finite-step eventual progress, iteration count bound, or termination guarantee was derived here.
- No proof of every optimizer transformation, closure capture lifetime, unusual goto scope entry, guest-visible debugger/register mutation, or malformed lexical input is added.
- No chapter text, examples execution acceptance, SDK quality-lint result, build result, CPU7/Table-length/BZ01 resolution, or whole-manual acceptance is supplied.
