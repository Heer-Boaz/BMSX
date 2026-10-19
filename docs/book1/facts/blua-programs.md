# BLua source programs — editorial evidence index

Initial baseline `fce16b952`; control-flow continuation at `e43ee94f1`,
2026-10-18. This is the linked-cartridge source
programming route, not a claim that the separate BIOS runtime compiler accepts
identical syntax, module loading or environment behavior. No architecture
manuscript or reference PDF is factual input. Source-language facts come from
the actual parser/compiler/linker owners; emitted operations and global-bank
behavior use paired CPU owners. There is no invented mirrored C++ source compiler.

## Finite author inputs

- [Storage and address extensions](blua-extensions-storage.md): complete primitive
  layout inventory, DATA/BSS/RODATA, structs/arrays, typed views, address selection
  and size/count operations. Independent source review narrows `string` reads
  to generic selected-constant lookup; String production belongs to its initializer.
- [Compiler-owned access and intrinsics](blua-extensions-intrinsics.md): six
  maps, six CP0 fields, three `blua32` operations including tracing, HALT and
  compound side effects. Direct RODATA protection is distinct from alias views.
- [Module extension inventory](blua-extensions-modules.md): const namespaces,
  static targets, literal imports and the exact ordinary-startup/`<init>` split.
- [Additional extension spellings and current build routes](blua-extensions-operators.md):
  six augmented assignments, String/address `&`, arrow access, source conventions
  and trace-selection boundaries. This is not a general Lua tutorial or a
  permanent Lua-version compatibility promise.
- [Concrete closure producer and development participant trigger](blua-extensions-development.md):
  the actual BIOS record/capture-context construction and the explicitly staged
  development invocation, not a new cartridge boot hook or guessed raw-address API.
- [Existing complete static-record program](memory-example.md): both literal
  modules are reused rather than creating another cartridge/helper. Their
  unchanged source was revalidated and its retained-result case rerun for this
  extension-first route; the new supplemental facts record exact current evidence.
- [Source spelling and forms](blua-programs-source-forms.md): lexer literals,
  names and comments; declarations, binding, expression grouping and statement
  forms. This is the actual cartridge frontend, not stock Lua or a promise of
  identical BIOS runtime-parser syntax.
- [Modules and linked programs](blua-programs-modules.md): headers, names,
  entry selection, literal imports, startup, export shape, const namespaces,
  static call targets and the actual named BIOS import surface.
- [Installed environment](blua-programs-environment.md): normal BIOS handoff,
  public name installation, ordinary global slots, capture versus public-name
  lookup, and EXEC versus system reboot. Math/os/load are inventories and
  boundaries only, not finished API references.
- [Executed modular program](blua-programs-program.md): the six complete source
  files, force-validation build, 19 retained assertions, separate five-line
  ordinary playback and explicit limits. Initial rejected example code was
  corrected rather than changing or suppressing quality rules.
- [Normal-startup attribute boundary](blua-programs-init-lifecycle.md):
  declaration restrictions and ordinary closure creation, normal startup versus
  the separately invoked generated mechanism. The latter is not exposed as a
  cartridge API.
- [Variable-argument and label edges](blua-programs-scope-edges.md):
  current-call varargs, function-wide labels and jump-only scope crossings.
  Its historical repeat binder/compiler disagreement and ordinary probe are
  retained under [resolved LS01](blua-programs-repeat-scope.md).
- [Numeric-loop control](blua-programs-numeric-loops.md): ordered cached header
  values, strict tests, body-visible counter mutation and explicit zero step.
  The [complete executed program](blua-programs-loops-program.md) supplies
  sixteen retained assertions and six separate ordinary diagnostics.
- [Generic-for protocol](blua-programs-generic-for.md): initial list adjustment,
  cached iterator/state/control, fixed argument/result counts, nil-only exit
  and the hidden control copy before the body. Its
  [complete executed program](blua-programs-iterators-program.md) supplies
  ten retained assertions and three separate ordinary diagnostics.

## Current bounded checks

The [source acceptance record](../reviews/blua-programs-source.md) links the
independent actual-owner form/module/environment and canonical-logical audits,
the real program evidence, source-blind reader reconstruction and actual PDF
inspection. A reader-discovered missing `and`/`or` definition is now supplied in
the canonical [CPU logical subsection](../cpu.md#logical-expressions), from
[separate actual-source facts](cpu-logical-expressions.md), not foreign Lua
assumptions. The original six modular-program listings exactly match their
executed source files; the two new programs have separate evidence records.

Finite review passes remain separate from completeness. Normal boot does not
automatically invoke an attributed function. The current vararg, goto and
numeric-loop boundaries are now extracted rather than left as unnamed
assumptions. Compiler commit `3d49ea3d5` subsequently resolved
[LS01](blua-programs-repeat-scope.md) and the
[BZ01 signed-zero constant discrepancy](bios-base.md#bz01--negative-zero-constant-resolved).
It also added typed floating DATA/RODATA initialization; the storage facts and
public source/Memory chapters now reflect that owner change. Focused execution
at O0–O3 and the neighboring compiler suite cover these changes; they do not
establish whole-chapter or whole-manual acceptance.

## Remaining whole-manual scope

Canonical CPU and Memory definitions remain the authority for values, arithmetic,
calls/results, tables, byte storage, typed declarations and startup addresses.
The Table-length producer was also repaired by `f13fad92f`; CPU7 questions remain open. Full math/os,
BIOS source-loading/compiler APIs, all lifecycle attributes, SDK quality-rule
and installation/debugging coverage, Book III and whole-console newcomer
acceptance are not closed by this chapter's presence.
