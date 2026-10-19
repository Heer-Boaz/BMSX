# BIOS table library: frozen source index

2026-10-18; baseline `1e8e3f340`. Current software is the authority. No
architecture document, reference PDF or stock-Lua behavior is input.

- [Reference facts](bios-table-reference.md): all six installed functions,
  argument/result counts, maintained-length snapshots, range conversion,
  mutation order, comparison and mutable dependencies. Exact source ranges
  are the evidence; descriptors alone do not establish behavior.
- [Position supplement](bios-table-positions.md): exact numeric-for producer,
  NaN shift-loop exit behavior and direct-source versus indirect-call arity.
- [Complete ordinary program](bios-table-example.md): both literal modules,
  retained observations, separate ordinary diagnostic playback and artifact
  identities. The normal default-length paths are exercised, not omitted.
- **CPU** owns ordinary value/index/call/length behavior and instruction charges.
  **BIOS base services** owns select, tostring and diagnostic print.
  **Protected calls and coroutines** owns error interception and retained
  earlier effects. **Memory** owns typed BSS, module layout and startup.

## Current length-producer disposition

The generic SETT/rawset boundary-refill disagreement was resolved by native
owner fix `f13fad92f`. [CPU Table semantics](cpu-table-semantics.md), section 4,
records the shared cross-array/hash refill scanner; [actual CPU execution
evidence](cpu-values-execution.md#table-boundary-refill-historical-and-current-instruction-execution)
now returns `5,1,5` in 33 charged cycles in both runtimes. The earlier
`5,1,5` versus `5,1,4` rows and the linked supplements' length-STOP wording are
historical for this specific producer difference.

The six procedures consume the maintained length defined in the CPU chapter;
they do not define a separate length rule. Only the inherited Table-length
hold is closed here. Other CPU/compiler questions, historical execution-scope
limits and final print acceptance are not closed by this owner fix.

## Bounded paired execution, separate from the ordinary cartridge

Nine scratch bodies at O0 and O3 execute the actual `machine/bios/base.lua`,
`table.lua` and coroutine dependencies using the existing test linker, runtime
and native runner. Each program returns one true. Every17-cycle grant uses the
existing CPU capture/restore path; all18 decoded final snapshots agree between
TS and native. This is not raw encoded-byte equality, complete BIOS boot,
native execution of the ordinary cartridge or a universal Table-length proof.
The console dependency is the existing empty fixture shape: these probes are
not diagnostic-output evidence.

Bodies cover counted tuples and one-nil ordinary returns; normal default-length
editing/sorting; nil fields and arbitrary separator conversion; inherited reads
versus own length; zero, fractional and beyond-end positions; interrupted sort
with surviving swap and error identity; ordered-prefix prescan and deferred
callback failure; live select/tostring dependencies; and NaN/nonnumber range
normalization with mixed-category default comparison. No fixed total cycles,
maximum safe recursive result count or physical bandwidth is established.

Scratch `/tmp/bmsx-bios-table-probe.ts`; final successful log
`/tmp/bmsx-bios-table-probe.log`. The nine bodies and bounded completion counts
are separate from the ordinary cartridge's30 retained assertions and14 actual
diagnostic lines recorded in the example facts. No new harness was introduced.

An additional initial position experiment did not complete in a bounded TS
run of10000 grants of17 cycles. It included an indirect no-tail insert and
nonnumeric positioned operations; it is not a native disagreement or a proven
universal nontermination result. Its source and log are preserved as
`/tmp/bmsx-bios-table-probe-position-noncompletion.ts` and
`/tmp/bmsx-bios-table-probe-position-noncompletion.log`. The final eighteen
passing comparisons exclude those uncompleted position operations explicitly;
they do not clear or conceal that separate observation. A direct source call
`table.insert(target)` was first rejected by the authoring descriptor's
minimum arity; the corrected experiment uses `pcall(table.insert, target)`.
No runtime/compiler repair or table-specific argument exception was inferred.
