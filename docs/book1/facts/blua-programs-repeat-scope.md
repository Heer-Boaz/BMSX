# LS01 — repeat binder/compiler scope disagreement: RESOLVED

## Current disposition — 2026-10-19

Resolved by compiler commit `3d49ea3d5`. `compileRepeat` now lowers the `until`
condition before popping the body's lexical scope, matching the binder. The
compiled local's debug scope also includes the condition. Current owner:
`toolchain/ts/lua/compiler.ts:4481–4499`.

Focused executed regressions at O0, O1, O2 and O3 cover a body `<const>` that
shadows a true global, mutable locals in a compound condition, a closure
created in the condition, break/scope exit, and a typed body-local pointer.
The shadowing case returns three passes, not the historical one below.
`tests/lua/interpreter.test.ts:59–124` and
`tests/lua/compiler_source_map.test.ts:16–23` retain these checks. The complete
eight-file neighboring compiler test run passed 168/168; compiler-project
typecheck and `git diff --check` passed. This does not rerun the historical
ordinary cartridge or certify the separate BIOS runtime compiler.

The LS01 publication hold below is superseded. This compiler correction does
not close unrelated CPU, Table, runtime-loading or whole-manual questions.

## Historical investigation — 2026-10-18

Baseline `e43ee94f1` was the software authority for the evidence below. This is an editorial
software-state note and reproducible investigation, not a normative language
repair, a recommended use pattern or a release exemption. No compiler/runtime
implementation was changed during that investigation. Source extraction is retained in
[scope-edge facts](blua-programs-scope-edges.md#r--repeat-body-local-referenced-in-its-until-expression).

## Conflicting directly connected owners

Binder, `toolchain/ts/lua/semantic/model.ts:928–930`:

```ts
this.visitBlock(repeatStatement.block);
this.visitExpression(repeatStatement.condition, { tableBaseDecl: null, tableBasePath: null });
this.leaveScope();
```

Compiler, `toolchain/ts/lua/compiler.ts:4469–4477`:

```ts
this.pushScope(this.semantics.locations.range(statement.block.span));
// compile body statements
this.popScope();
this.loopStack.pop();
const repeatJumps: number[] = [];
this.compileConditionJumps(statement.condition, false, repeatJumps);
```

The binder keeps the body local visible through the condition; the compiler
removes the body binding first (`compiler.ts:2082–2086`). The direct bare-name
load then has a lexical reference but no current binding/upvalue; it reaches
name-based GETGL/GETSYS (`compiler.ts:2799–2828`). This is not a mirrored TS/C++
CPU difference: the paired load owners read the named bank as emitted. It is
not permissible to infer one coherent intended repeat-local visibility rule
from these two owners. The normal body-local guarantee remains stopped.

## Actual ordinary-source observation

Complete probe `carts/repeat_scope_probe/entry.lua`:

```lua
module<entry>

-- This owned name distinguishes a global read from the body-local read.
setglobal('repeat_scope_probe_ready', true)
local passes = 0
repeat
	passes += 1
	local repeat_scope_probe_ready<const> = passes >= 3
until repeat_scope_probe_ready

print('Repeat scope', passes)

while true do
	halt_until_irq
end
```

Source SHA-256 `2414eedb8a75714f059c0e7fd015cdd5f992613192fb2c07c2a3c415d2278798`.
The whole probe has no caller-supplied body local or engine fallback. It sets
its owned ordinary global true; the distinct lexical local is false on pass1
and pass2, true on pass3. Both the source-traced current path and the contrasting
lexical-read path terminate, without a diagnostic timeout/alternate exit guard.

`npm run validate:toolchain:cart -- repeat_scope_probe --debug` passed ordinary
compilation and the unchanged project quality rules, artifact
`b686b33ad533de322e86968ef552b090269d24a6406723b29c55c111884d7a44`.

`npm run headless:tooling -- --debug --input-timeline tests/carts/repeat_scope_probe/ordinary_timeline.json repeat_scope_probe`
separately ran the ordinary debug cartridge and printed exactly:

```text
Repeat scope	1
```

Logs: `/tmp/bmsx-repeat-scope-build.log`, `/tmp/bmsx-repeat-scope-ordinary.log`.
One pass agrees with the source-traced global-load path. Reading the body's
local would reach its third pass, not its first. This bounded actual result
supports the current-software discrepancy; it does not approve that result as
a language rule. There is no fixture assertion requiring an eventual repair to
preserve this defect. Future owner correction must update this note/probe,
not add a legacy compatibility behavior.

The manifest and zero-based presentation-offset4 timeline are supplied with
the probe; the endpoint is not a timing guarantee or output assertion. No native
cartridge execution, O0/all-optimizer/all-compound/typed-expression/capture
coverage, reset lifetime or separate BIOS runtime-parser claim follows.

## Historical publication treatment

Keep LS01 explicit in the source-program coverage record and manual follow-up.
Do not document binder acceptance as a working body-local `until` guarantee,
do not silently reinterpret it as deliberate global scoping, and do not fix the
compiler during this manual slice. Other sourced source forms and interfaces
can proceed independently. Existing CPU7, Table length and BZ01 remain open.
