# BLua source scope edges — finite current-source facts

Inspected checkout: `master`, `e43ee94f19d73aa4564f620e42ddbaa2c306a52f` (2026-10-18). This is read-only fact extraction for exactly three items indexed by `docs/book1/facts/blua-programs-source-forms.md:123–130`, especially gap 3 at line 127. That index describes an older inspection; the ranges below were read from the current checkout.

No repository edits, build, test, compiler invocation, execution, new harness, repair, or chapter writing was performed. `AGENTS.md` was read. `docs/architecture.md`, historical PDFs, public chapter prose and reviews were not opened. Existing `.vscode/launch.json`, `.vscode/tasks.json`, and untracked `docs/examples/` changes were left untouched. The existing CPU7, Table-length and BZ01 stops remain OPEN and are not investigated or resolved here.

“Accepted” below means no rejection for the named form on the inspected grammar, binding, and direct lowering paths, assuming the surrounding program has no independent error. It is not a passing SDK quality-lint result or an executed example. A source-derived emitted path is distinguished from an intended/approved language contract.

## Direct source owners and diagnostic gate

- `toolchain/ts/lua/compiler.ts:104–120` imports the shared semantic frontend and its bound-reference adapter. `compiler.ts:5913–5934` builds that frontend from the actual entry/module chunks and source. `compiler.ts:5937–5965,6181–6185` collects its diagnostics and rejects before lowering when any are present.
- `toolchain/ts/lua/semantic/frontend.ts:157–169,197–220` constructs the snapshot-backed frontend and computes the diagnostics consumed by the compiler. The consumed diagnostic categories are enumerated at `toolchain/ts/lua/semantic/diagnostics.ts:124–137`: identifier resolution, const writes/initializers, call arity, and reserved memory names. There is no vararg-context or goto-local-scope diagnostic in this enumerator or a special vararg/goto branch elsewhere in that diagnostics owner.
- `toolchain/ts/lua/compiler/bound_reference.ts:18–36` returns the bound identifier reference and uses a lexical declaration's `id` as its compiler symbol handle. `semantic/frontend.ts:599–613,657–668` classifies a resolved, in-scope local declaration as `lexical` and checks its recorded source scope. These are compiler dependencies, not a claim that IDE inference is runtime authority.
- This checkout's source parser/compiler is TypeScript. No independent C++ source parser/compiler is asserted. Paired runtime owners below are used only for the explicitly named emitted instruction behavior.

## V — `...` used outside a vararg function

### V01 — Grammar and binding do not reject this use

- `toolchain/ts/lua/syntax/parser.ts:1318–1342` accepts a `Vararg` token as a primary `VarargExpression`; this branch does not consult a function/parameter context. It applies wherever an expression is parsed, including a non-vararg function body and the top-level chunk. This does not make a bare `...` an expression statement: ordinary statement grammar is separate (`parser.ts:400–433`).
- The separate parameter-list parser uses a local `hasVararg` flag and puts it on the function AST (`parser.ts:716–746`). Its errors concern `...` not being the last parameter (`729–733`), not `...` expressions in an ordinary function's body.
- The directly consumed binder returns `UNKNOWN_EXPRESSION_VALUE` for `VarargExpression` without binding a name or checking a function context (`toolchain/ts/lua/semantic/model.ts:1191–1199`). The compiler's value-flow evaluator likewise returns an unknown fact (`toolchain/ts/lua/compiler/compile_value_flow.ts:298–303`), not a rejection.

**Finite source-legality result:** using `...` as an otherwise-valid expression in a function whose written parameter list has no `...` is not rejected for that reason by these current owners. The same expression grammar/binder/lowering is used for the entry chunk. Do not describe this as a stock-Lua syntax error.

### V02 — Lowering emits VARARG even for a non-vararg function

- `toolchain/ts/lua/compiler.ts:4699–4707,4749–4751` emits `VARARG(target, resultCount, 0)` for the expression, with no `hasVararg` gate. The `FunctionBuilder` has no function-is-vararg field among its state (`1225–1283`).
- The function record's vararg property is set independently from the parsed parameter list: `compiler.ts:5968–6000`, specifically `numParams` at 5995 and `isVararg: expression.hasVararg` at 5996. Entry and ordinary runtime-module chunk protos are explicitly non-vararg (`6319–6327,6356–6364`).
- The image producer encodes `record.isVararg` into `BLUA32_FUNCTION_VARARG` (`toolchain/ts/rompack/blua32_linker.ts:903–909`).
- `compiler.ts:5754–5764` treats a vararg expression as multi-result. For the ordinary, non-module-publication `return ...` route, `compiler.ts:4379–4394` therefore emits `VARARG` with result count 0 and `RET` with count 0. Other contexts pass their requested fixed/open result count to the same expression branch. This is a lowering observation, not an executed return-count test.

### V03 — Narrow paired-runtime consequence of that emitted instruction

| State / operation | TypeScript owner | C++ owner | Current source consequence |
| --- | --- | --- | --- |
| Non-vararg function entry | `machine/ts/machine/cpu/cpu.ts:3232–3236,3275–3278` | `machine/cpp/machine/cpu/cpu.cpp:3017–3021,3094–3098` | When the function-record vararg flag is absent, the new frame has `varargCount = 0`, even if extra arguments were supplied. |
| VARARG | `machine/ts/machine/cpu/cpu.ts:2896–2916` | `machine/cpp/machine/cpu/cpu_dispatch.inl:475–487` | `B=0` uses that frame's vararg count; `B>0` requests exactly B positions, copies the available prefix, and fills the remainder with nil. There is no “outside vararg function” fault branch. |

For direct execution in such a non-vararg frame, `VARARG A 0` copies zero values and sets `frame.top = A`; `VARARG A B` with positive B writes B nil values. A nested non-vararg function does not acquire an enclosing function's varargs via this opcode: the two instruction owners read the **current frame's** vararg area/count. These are deductions from matching execution owners, not a run result or a general call/return specification.

**Remaining boundary:** no execution, call-arity interaction, optimization-wide equivalence proof, or arbitrary malformed-source proof was performed. Source acceptance and this narrow emitted-op behavior are established; intended documentation policy remains separate.

## G — goto across lexical local scopes

### G01 — Source grammar and direct binder do not implement local-scope goto legality

- `toolchain/ts/lua/syntax/parser.ts:582–600` parses `::identifier::` and `goto identifier`; neither node carries a lexical-local set or target binding. Labels are routed as statements regardless of containing block (`400–404`), and goto is routed at `430–431`.
- `toolchain/ts/lua/semantic/model.ts:1047–1055` explicitly does nothing for goto/label statements. It does not resolve a label or compare goto-site and label-site local scopes.
- The compiler's consumed value-flow analyzer also returns directly for goto/label statements (`toolchain/ts/lua/compiler/compile_value_flow.ts:888–896`); it does not add a source rejection or a goto edge in that branch.

**Finite source-legality result:** there is no check here that rejects a goto merely because it crosses a local declaration or enters/leaves a lexical block in the same compiler function. Do not import a stock-Lua “jump into the scope of local” rule. This is a statement about the inspected implemented checks, not an ideal safety guarantee.

### G02 — One label map per FunctionBuilder, not one per lexical block

- Each `FunctionBuilder` owns `labelPositions: Map<string, number>` and `pendingLabelJumps: Map<string, number[]>` (`toolchain/ts/lua/compiler.ts:1225–1259`). Function expressions get a new builder (`5978–5986`); entry/module chunks likewise get their own builders (`6301–6313,6340–6350`).
- Lexical `pushScope`/`popScope` only maintain local binding records (`compiler.ts:2075–2086`). They neither create label maps nor remove label names. Therefore nested/sibling lexical blocks in one builder share the same label-name map; a nested function's builder does not share it.
- Finalization occurs after the complete chunk/function body has been compiled (`compiler.ts:1343–1352,1486–1502`). Any still-pending label names are sorted and reported as `Missing label(s): ...` (`2093–2099`). A label in a different function cannot satisfy this builder's pending entry.

### G03 — Forward, backward, duplicate and missing cases

Exact lowering owners: `toolchain/ts/lua/compiler.ts:4588–4619`.

- Every goto first emits a jump placeholder. If the name already exists in this function's map (a backward/already-compiled target), that jump is patched immediately (`4588–4595`).
- Otherwise its instruction index is appended to the pending array keyed only by label name (`4596–4601`). A subsequently compiled label patches every pending jump for that name and deletes the pending entry (`4609–4618`). This is the forward route, including a target compiled in a different lexical block of the same function.
- Any second label with the same spelling in that map is rejected with `Duplicate label 'name'.`, including a duplicate in another lexical block of that same function (`4604–4607`). A same-spelling label in a separate function has a separate map.
- A label is the current `code.length` and emits no separate label instruction (`4609–4610`). Neither goto/label routine compares scope depth, active local ids, declaration positions or initialization state. Neither adds initialization, local cleanup or a capture-close instruction around its jump.
- The generic placeholder is `JMP` by default and only its target is patched (`compiler.ts:3111–3130`). Code finalization additionally rejects an unpatched jump or an out-of-range signed displacement (`1859–1878`); these are encoding checks, not local-scope checks.

### G04 — Narrow paired-runtime behavior

`machine/ts/machine/cpu/cpu.ts:2849–2852` executes JMP by assigning `frame.pc` from its decoded target; `machine/cpp/machine/cpu/cpu_dispatch.inl:424–427` does the same (`FRAME.pc = bx`). Neither operation consults lexical locals or changes their register values.

Thus the emitted branch follows its target without a runtime lexical-local legality check. Forward crossing can skip the intervening initializer instructions; backward crossing resumes at the recorded earlier instruction position. This does **not** establish the value of every crossed local: the value depends on executed register writes and compiler transforms. In particular, no blanket “a skipped local is freshly nil,” “backward jumps recreate locals,” or captured-variable lifetime promise is made here.

**Remaining boundary:** this finite inspection does not prove correct value-flow optimization for arbitrary goto graphs, analyze all register/capture lifetime effects, run a crossing example, or make cross-function goto legal. It establishes the actual function-wide name-map checks and direct jump lowering, not an approved restrictions policy.

## R — repeat-body local referenced in its until expression

### R01 — Grammar accepts the expression; the consumed binder keeps the body local visible

- `toolchain/ts/lua/syntax/parser.ts:829–840` parses the body through `until`, then parses its condition as an expression. The condition is not inside the body's `LuaBlock` field, but is inside the `RepeatStatement` span.
- The directly consumed binder deliberately enters a loop scope from body start to `repeatStatement.span.end + 1`, visits the body, visits the condition, **then** leaves the scope (`toolchain/ts/lua/semantic/model.ts:921–930`).
- Ordinary local declarations activate their names after their initializer expressions (`semantic/model.ts:703–745`). Name resolution walks the current scope first (`2071–2082`); identifier reads record the resolved declaration id (`1570–1596`). Therefore a local declared directly in the repeat body's scope is a binder-visible lexical declaration when the condition is visited. A name confined to a nested inner `do`/branch has that inner scope's distinct boundary; this fact does not broaden it.
- `semantic/frontend.ts:599–613,657–668` uses that recorded repeat scope to classify the bound condition reference as lexical. A bound local name is not diagnosed as undefined merely because it occurs after `until` (`semantic/diagnostics.ts:246–270`).

### R02 — Explicit binder/compiler disagreement: no single intended contract may be inferred

Binder order, `toolchain/ts/lua/semantic/model.ts:928–930`:

```ts
this.visitBlock(repeatStatement.block);
this.visitExpression(repeatStatement.condition, { tableBaseDecl: null, tableBasePath: null });
this.leaveScope();
```

Compiler order, `toolchain/ts/lua/compiler.ts:4469–4477`:

```ts
this.pushScope(this.semantics.locations.range(statement.block.span));
// body statements compiled here (4470–4473)
this.popScope();
this.loopStack.pop();
const repeatJumps: number[] = [];
this.compileConditionJumps(statement.condition, false, repeatJumps);
```

The compiler removes every body-scope local id from `localBindings` in `popScope` (`compiler.ts:2082–2086`) **before** lowering the condition. The binder does not. This is an observed software-state disagreement between directly connected owners, not a mirrored TS/C++ runtime disagreement. Stop any claim that these owners establish one coherent intended repeat-local visibility contract. No repair, relocation or normalization is performed.

### R03 — Reached direct bare-name lowering path, not an approved language rule

For an ordinary direct condition read of a body-local name (for example the shape `repeat local done = true until done`, with no claim that this text was compiled or run):

1. The bound reference still has kind `lexical` and retains the body declaration id (`semantic/frontend.ts:599–613`; `compiler/bound_reference.ts:29–36`). The compiler does not rebind it to a same-spelling outer local.
2. The body's compiler `localBindings` entry has been deleted. Local lookup by that id returns null (`compiler.ts:2217–2223,2307–2313`); visible-binding and const lookup also use that id (`2268–2285,2299–2304,2323–2328`). Upvalue lookup only searches owning parent builders for that id, not deleted current-function body locals (`2241–2265,2315–2320`).
3. Condition lowering first tries compile-time evaluation (`compiler.ts:5445–5453`); a bare identifier can fold only through a currently resolved compiler const binding (`3299–3312`), which the popped body-local no longer supplies. The general bare condition then calls ordinary expression lowering (`5521–5523`), which sends an identifier to `emitReferenceLoad` (`4720–4722`).
4. In `emitReferenceLoad`, neither a current local nor an upvalue is found (`compiler.ts:2799–2817`). Its error branch only rejects kind `unresolved`, not a lexical reference whose compiler binding is gone (`2818–2826`). The reached tail uses the **name**, resolves a global slot, and emits `GETGL` or `GETSYS` (`2827–2828`). Global/system slot choice is `591–600`; a missing cart slot is allocated by name (`768–776`). This is not source rejection of the repeat-local form.
5. Paired execution of those emitted loads reads the named storage class: TypeScript `machine/ts/machine/cpu/cpu.ts:2344–2354`; C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:60–72`. Neither reconstructs the removed lexical binding. No claim is made here about that slot's initial value or eventual loop termination.

The direct body local being `<const>` does not by itself rescue this bare-name path: the compiler const lookup depends on the same deleted binding (`compiler.ts:2279–2285,2323–2328,3310–3311`). Conversely, an enclosing local that is not declared in the repeat body's popped scope is not removed by this specific pop; do not generalize the finding to all names in all until expressions.

**Precise unresolved boundary:** the plain direct lexical-read path is source-traced, not executed. This task does not establish every compound/typed expression path, a function expression capturing a body local inside the condition, capture-layout/Hot Resume behavior, or optimization-wide/runtime equivalence. Most importantly, parser/binder acceptance must not be rewritten as a working body-local-value guarantee. Any public treatment needs separate actual execution evidence and an explicit current-software-state note tracking this owner disagreement; it is not closed by syntax acceptance.

## Outcome and stop register

- Varargs outside a vararg function: current named source checks accept the expression; the compiler emits VARARG; paired runtime source gives zero available varargs in the non-vararg frame and fixed-count nil filling. No run result is claimed.
- Goto lexical-scope crossings: current named checks are function-wide duplicate/missing label handling and generic jump encoding, with no local-scope crossing restriction. Forward and backward routes are source-traced; no arbitrary goto-program correctness promise is made.
- Repeat locals in until: binder visibility is explicit, but compiler scope teardown precedes condition lowering. The direct missing-binding path reaches a name-based global load. This disagreement remains an OPEN software-state issue, not an approved language contract.
- No mirrored-runtime disagreement was found in the exact operations inspected: frame vararg count setup, VARARG, JMP and GETGL/GETSYS. This is not whole-runtime parity evidence.
- CPU7, Table-length and BZ01 remain OPEN. No tested/runtime execution claim, compiler/runtime fix, new harness, public prose edit or repository edit is included. Checkout remained at `e43ee94f19d73aa4564f620e42ddbaa2c306a52f`; `git diff --check` produced no output.
