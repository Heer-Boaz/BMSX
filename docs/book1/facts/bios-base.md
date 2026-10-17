# BIOS base services: frozen source index

2026-10-18; baseline24a37a1df. Current software is the authority. No
architecture document, historical reference PDF or stock-Lua behavior is input.
This chapter covers twelve installed base globals, not all BIOS libraries,
source loading/environments, private firmware modules or Book II devices.

- [Base-service reference facts](bios-base-reference.md): installation, actual
  primitive aliases versus ordinary BIOS functions; assert, rawequal, type,
  tostring, tonumber, next, pairs, ipairs, select, getglobal, setglobal, print.
  Every fact has its actual owning path/range, with paired implementations where
  applicable. Advertised source signatures and runtime tuple shapes are distinct.
- [Complete ordinary program](bios-base-example.md): both literal modules,
  actual retained observations and separate ordinary diagnostic playback.
- **CPU** owns value identity/Number conversion, fixed/open argument/result
  adjustment, ordinary indexing and incremental instruction charges. **Memory**
  owns typed BSS and startup. **Protected calls and coroutines** owns the error
  and cooperative-thread interfaces. **SYSTEM** owns raw diagnostic transport
  and fault publication. These cross-references do not clear CPU's seven stopped
  owner questions or supply missing complete-library/environment contracts.

No new runtime repair is inferred. Descriptor omissions or abbreviated signatures
are not permission to invent APIs, discard actual variadic values, or import
another Lua implementation's argument/iteration/conversion behavior. No universal
hash iteration order, exact-decimal parser, fixed wrapper service time, or
unbounded-input termination guarantee is claimed.

## Bounded paired execution, separate from the ordinary cartridge

Nine scratch bodies at O0 and O3 execute actual `machine/bios/base.lua` and its
real coroutine dependency with the existing test linker/runtime/native runner.
The `tty/console` dependency is the existing empty console-fixture shape used
by `tests/helpers/cartlib_cpu.ts:97-106`: **not diagnostic-output evidence**.
Every17-cycle grant uses the existing CPU capture/restore route; each program
returns one true and its final decoded snapshot agrees between TS and native.
All18 comparisons pass. Bodies cover assert tuples/nil errors, type/text/value
identity, numeral grammar and explicit errors, select's raw-word boundaries,
iterator factories/inherited reads, globals/print result count, mutable ordinary
bindings, and source-zero observation. No raw encoded-byte equality, complete
BIOS boot, physical timing or exhaustive runtime/optimizer conformance is claimed.

Scratch `/tmp/bmsx-bios-base-probe.ts`; final log
`/tmp/bmsx-bios-base-probe.log`. The final type/text vector obtains negative zero
from actual `tonumber('-0')`, so it tests the formatter's received value rather
than presuming how every source expression is compiled. Initial scratch errors
were an incorrect positive-zero expectation, a two-result success wrapper not
matching the existing native runner's one-true completion contract, and a
JavaScript/Lua string-escape mistake. These were fixture errors, not runtime
repairs. A further genuine source-producer difference is retained below instead
of being discarded to obtain a green aggregate.

## Separate source-producer finding: negative-zero constant

BZ01. In the same source observation body, `tostring(-0)` records `-0` at O0
and `0` at O3. At each level both TS and native agree on the same linked image.
`tostring(tonumber('-0'))` records `-0` at both levels; `tostring(1/(-0))` records
`-inf` at both levels; `tostring(123456.5)` records `123457` at both levels.
These are actual observations, not universal optimization or source-algebra
rules. Do not infer that default Number formatting loses negative zero or
that moving a literal beneath division is a recommended workaround.

Relevant producer locations: unary folding at
`toolchain/ts/lua/compiler/optimizer/index.ts:581-588` calls the unary evaluator;
`toolchain/ts/lua/compiler/optimizer/values.ts:165-168` negates a Number;
`toolchain/ts/lua/compiler/optimizer/values.ts:123-131` chooses K0 for a value equal to zero.
The ordinary constant emitter also chooses K0 for zero at
`toolchain/ts/lua/compiler.ts:3157-3159`. Root read these locations; the complete
optimizer-pass/rewrite chain is not independently traced here. This is a
separate compiler-owner question, not an eighth TS/C++ runtime disagreement.
The existing seven runtime-owner questions remain open. No compiler repair,
fallback or editorial universal signed-zero source guarantee is authorized.
