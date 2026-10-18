# BLua source programs — editorial evidence index

Initial baseline `fce16b952`; control-flow continuation at `e43ee94f1`,
2026-10-18. This is the linked-cartridge source
programming route, not a claim that the separate BIOS runtime compiler accepts
identical syntax, module loading or environment behavior. No architecture
manuscript or reference PDF is factual input. Source-language facts come from
the actual parser/compiler/linker owners; emitted operations and global-bank
behavior use paired CPU owners. There is no invented mirrored C++ source compiler.

## Finite author inputs

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
  Its repeat binder/compiler disagreement is retained separately as
  [OPEN LS01](blua-programs-repeat-scope.md), with an actual ordinary probe.
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
assumptions. The repeat-local disagreement remains OPEN LS01; it is not an
intended scoping guarantee or an excuse to repair the compiler in this manual
slice. **Publication stays blocked and the layout is a DRAFT.** No new gate
or compiler/runtime change follows from these facts.

## Remaining whole-manual scope

Canonical CPU and Memory definitions remain the authority for values, arithmetic,
calls/results, tables, byte storage, typed declarations and startup addresses.
The common Table-length STOP, CPU7 and BZ01 questions remain open. Full math/os,
BIOS source-loading/compiler APIs, all lifecycle attributes, SDK quality-rule
and installation/debugging coverage, Book III and whole-console newcomer
acceptance are not closed by this chapter's presence.
