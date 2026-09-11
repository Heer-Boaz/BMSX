# Publish the module's first result, including a factory call

Baseline `4bb58154c`. A concrete compiler bug found while verifying the source
query's imported-constructor contract. This is not a new runtime module loader.

## Evidence and ownership, before the fix

`return make_definition()` at the module's export statement leaves the module's
export slot nil at both O0 and O3, although the factory returned a table. The
semantic producer retains that call result as the module's value. A source editor
must not paper over this mismatch by only supporting inline constructors.

The live owners are `compiler/passes/module_contract.ts` (the final, single-
expression module export) and `compiler.ts::compileReturn` /
`compileRequireExpression` (publish and consume the existing export slot).
`compileReturn` skipped publication when that expression could return multiple
results. But `require` consumes one exported value; additional expression results
do not turn into extra module exports.

The production reference is Lua 5.4.8's
[loader result adjustment](https://github.com/lua/lua/blob/v5.4.8/loadlib.c#L648-L676):
its loader call requests one result before publishing it. BMSX keeps its own
compile/link-time module contract, not Lua's package table, loader search or
nil-to-true policy. In particular, BMSX unshaped modules yield true, while an
explicit exported nil stays nil. Both behaviors were checked on the real CPU.

The export statement therefore requests exactly one value from its expression,
publishes that value through the existing relocation/store and returns one
value. Ordinary function returns retain their existing multi-result behavior.
No second scratch bank, serializer, host intervention or runtime validation is
needed. This is TypeScript tooling that emits the shared BLua ISA, not a mirrored
TS/C++ device-state edit.

The probe also found that an early return can bypass a later runtime export,
leaving its slot nil. That is **not** a reason to merge every module `return`
as if BMSX had Lua's runtime loader. The future source-query producer must retain
the actual module-export boundary and publication uncertainty. That broader
source-evidence work, B03 reparenting and B06 authoring remain open.

## Validation

The two new independent CPU tests cover a local factory returning one, multiple
or no values, repeated import identity, exactly-once initialization and a factory
in another runtime API module. O0/O3 pass. The initial imported fixture used a
root static-function export with heap/global operations, which the existing
static ISA correctly rejects; it was corrected to the actual runtime-API owner,
not accommodated with a new static-function exception.

- Module export suite: **22 passed**; full Lua suite: **1,472 passed, one existing
  skip**; rompacker suite: **123 passed**.
- Toolchain build and IDE typecheck passed. Tests-project diagnostics are exactly
  the existing 51, unchanged. Strict architecture boundary, core parity and
  indentation audits plus `git diff --check` passed.
- Forced headless-tooling, BIOS and Nemesis builds passed. The actual headless
  Nemesis cinematic-flow scenario passed. The rebuilt Studio's full workflow
  passed on **software, WebGL2 and WebGPU**, including the existing source-edit/
  Undo/Hot Resume routes. No new Studio authoring feature is claimed here.

The change emits the previously omitted export store at module initialization;
it introduces no per-frame work. No new cold-workspace latency benchmark is
claimed: semantic-query implementation and facts are unchanged by this compiler
fix. Artifacts and the baseline CPU probe are in `/tmp/bmsx-written-sources/`.
