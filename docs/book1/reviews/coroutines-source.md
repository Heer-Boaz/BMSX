# Protected calls and coroutines: source and execution review

2026-10-18; source baseline0620b06d2. Current software is the authority.
This report covers the new protected-call/cooperative-thread chapter only,
not complete BIOS coverage, the CPU's seven open owner contracts, native
execution of the ordinary cartridge or whole-manual acceptance.

## Separation of work

Independent extractors produced protected-call facts, coroutine lifecycle facts
and a narrow firmware installation/surface inventory. Two fresh facts-only
authors wrote the nonoverlapping protected-call and lifecycle sections. Root
assembled the opening, reset, reason table, complete executed program and figure.
Nonauthors checked the actual source owners, not just the frozen sheets, in
three bounded review assignments. Public-only reader and actual-PDF reviews
have their own records.

Before implementation, the production Lua source's
[base-library structure](https://github.com/lua/lua/blob/master/lbaselib.c) and
[coroutine-library structure](https://github.com/lua/lua/blob/master/lcorolib.c)
were inspected as organizational references only. No Lua behavior was imported
as a BMSX fact. No architecture document or historical reference PDF was used.

## Actual execution scope

- Full ordinary `coroutines_manual` cartridge validation passes. Its artifact
  SHA256 is `dddd16ea045a7a443c97f15074a5f3e9bc14a63edbaf21d2ab942476e90acf35`.
- Derived integration case `protected_calls_and_thread_lifecycle` passes40
  retained assertions, excluding its completion wait. Separate ordinary BIOS
  playback emits all17 documented diagnostic lines. Neither result is native
  execution of that ordinary image.
- Existing TS coroutine suite passes22 tests. Existing paired coroutine suite
  passes30 O0/O3 vectors with its current native runner.
- Nine separate scratch bodies at both O0 and O3 pass18 common true completions
  and equal decoded final snapshots through the existing17-cycle-per-grant
  save/restore route. The cases cover public protected transfer, status-independent
  yieldability, error identity/nil, handler result shaping and validation,
  handler failure, body/handler yield, direct/wrapped failure close, and the
  externally failed wrapper correction below. No raw encoded-byte equality or
  exhaustive allocation, IRQ, GC or optimizer correctness is claimed.

Commands, exact modules, vector scopes and the discarded scratch-comparison
mistake are recorded in [execution facts](../facts/coroutines-example.md).
No runtime, compiler, BIOS, cartlib, publisher or shared test-harness edit was
needed. Example lint findings were resolved through actual result use, not an
exemption or facade.

## Independent protected-call source audit

# Protected calls: independent bounded source review

No mismatches or unsupported sentences found in `docs/book1/coroutines.md:11-87`.

Checked the frozen protected-call facts, lifecycle CF01 addendum, firmware installation facts and bounded example/probe evidence against their cited live owners. This includes exact result tuples and nil positions; ordinary empty-function/bare-return `true, nil`; arbitrary and nil error values; handler-validation timing; first-handler-result selection; the explicitly scoped built-in-handler OOM limitation; per-thread protection, hardware exception/interrupt barriers and yieldability; unwinding; and incremental primitive costs. Both TypeScript and C++ owners were inspected where mirrored. No architecture document or PDF was read. This is a bounded source review, not an exhaustive OOM, hardware-boundary, performance or runtime-parity claim.


## Independent root/program/diagram and reason-code audit

# Independent coroutine program/source audit

No unsupported or mismatching claim was found in the bounded material reviewed: the opening, reset boundary, transfer figure/caption/source map, complete program, retained-value table, and diagnostic output in `docs/book1/coroutines.md`, plus the related reset/map facts and example sources.

The five Lua listings reproduce `carts/coroutines_manual/results.lua` (18 lines) and the consecutive `cart.lua` chunks (117 lines) literally: 135 source lines. The companion test checks 40 retained observations excluding its completion wait. All 17 documented diagnostic lines match the ordinary-run log, with the documented spaces-versus-tab presentation distinction. Every SVG arrow and label follows this producer's actual two resumes, yield/result transfer, successful return prefixes, Suspended state and Dead state; it makes no elapsed-time or simultaneous-CPU claim.

Reset wording is bounded to the active/resumer chain, consistent with TS `machine/ts/machine/cpu/cpu.ts:841-908` and C++ `machine/cpp/machine/cpu/cpu.cpp:3388-3415,431-472`; it does not claim to close every unrelated suspended Thread. Installation, protected outcomes, thread transfers/status, explicit close/upvalue retention and private wrap cleanup were cross-checked against the live BIOS and cited mirrored CPU/table/thread/value owners, not inferred from fact-sheet prose alone.

Read-only source/log audit only. Existing execution logs were inspected; no test or native ordinary-cartridge run was newly performed. Newly inserted protected-call/lifecycle reference sections are outside this audit's initial scope. No repository/runtime/tooling file was changed.

## Narrow language-fault-reasons addendum

No unsupported or mismatching claim was found in the six reason/condition rows or the surrounding route/payload distinction in `docs/book1/coroutines.md:89-111`. Codes 1, 4, 7, 8, 9 and 10 match TS `machine/ts/spec/blua32/cop0.ts:27-36` and C++ `machine/cpp/spec/blua32/cop0.h:33-42`. Actual condition producers, classified run-loop handling and fault entry support the stated mapping and preserve explicitly thrown values without choosing a reason from their text: TS CPU `:3880,3951,4370-4380,1942-1969,1748-1761`, TS table `:149-158`; C++ CPU `:1902,1949,2225-2227,2643-2659,2306-2309`, C++ table `:393-395`. Both run loops first offer these errors to thread/protected handling and enter the fault route only if unhandled, so a protected failure result alone is not proof of fault entry. No repository edits or new execution claims.


## Independent lifecycle source audit

# Coroutine lifecycle source review

Scope: live `docs/book1/coroutines.md:89-166` (all eight public functions), checked against frozen lifecycle facts including CF01, installation facts, bounded example facts, and the cited live BIOS, paired CPU owners, and compiler producers. No architecture document, PDF, implementation edits, or new execution claims.

## Failure: rejected resume of an already-failed wrapped thread still triggers cleanup

Chapter `docs/book1/coroutines.md:152`:

> Rejection because a thread is non-suspended is also raised, but does not trigger this failed-thread cleanup.

This is overbroad for a target already in Failed state. The rejection path preserves Failed; the wrapper checks that retained status, not whether the immediately preceding resume executed the body. Therefore a rejected resume of an already-failed wrapped target does trigger its private close operation.

Exact conflicting live sources:

- `machine/ts/machine/cpu/cpu.ts:3779-3787`: resume rejects any status other than New or Suspended, returns `false` plus `cannot resume non-suspended coroutine` when no exception is active, and returns without changing target status. C++ mirror: `machine/cpp/machine/cpu/cpu.cpp:1821-1828`.
- `machine/bios/coroutine.lua:13`: `local failed_status<const> = 5`.
- `machine/bios/coroutine.lua:29-32`:
  ```lua
  local unwrap<const> = function(thread, ok, ...)
    if not ok then
        if status(thread) == failed_status then close_thread(thread) end
        raise((...))
  ```
- `machine/bios/coroutine.lua:36-38`: the wrapped closure invokes `unwrap(thread, resume(thread, ...))`.
- `machine/ts/machine/cpu/cpu.ts:3694-3696` returns the active Thread from `running`; `:3809-3816` leaves an unhandled body failure in Failed state and retains its error. C++ mirrors: `machine/cpp/machine/cpu/cpu.cpp:1737-1739,1850-1857`. Thus the ordinary public surface can expose the wrapped thread handle, and a direct `coroutine.resume(handle, ...)` can leave that target Failed before a later wrapped call.
- The private close does perform closure and failure clearing: BIOS `machine/bios/coroutine.lua:25`; paired TS `machine/ts/machine/cpu/cpu.ts:3708-3712,3820-3838`; C++ `machine/cpp/machine/cpu/cpu.cpp:1751-1755,1861-1873`.

The frozen extraction repeats the same overgeneralization at `docs/book1/facts/coroutines-lifecycle.md:75`: “Rejected resume of a non-suspended thread is not automatically closed.” Its live cited wrapper does not support that statement for a target already Failed.

No other failures found in the bounded reviewed section. This is source agreement for the remaining claims, not exhaustive execution, optimization-correctness, timing, GC, IRQ-interleaving, or device-state validation.

## Narrow correction recheck: PASS

Rechecked current `docs/book1/coroutines.md:160` and `docs/book1/facts/coroutines-lifecycle.md:75` against live `machine/bios/coroutine.lua:29-38` and the paired rejection/close branches cited above. Both now state that any false resume result raises its returned first error value, and that cleanup depends on the retained raw Failed status, including a rejection of an already-Failed target. They distinguish that rejection String from the older retained body error and exclude other non-suspended statuses from Failed cleanup. The correction closes the sole finding. No remaining mismatch in this narrow recheck; no tests rerun or audit scope widened.



## Source disposition

All three bounded source assignments pass after the one corrected wrapper
claim was independently rechecked. The diagram meaning also passes. No affected
common public-call owner mismatch remains in this chapter's extracted scope.
This is not exhaustive runtime parity or closure of unrelated CPU owner stops.
Public-only newcomer acceptance and exact generated-PDF acceptance remain
separate records in `coroutines-reader.md` and `coroutines-print.md`.
