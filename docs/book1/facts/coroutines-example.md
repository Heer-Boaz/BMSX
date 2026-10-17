# Protected calls and coroutine example: frozen execution facts

2026-10-18; baseline0620b06d2. Documentation/ordinary example additions only.
No runtime, compiler, BIOS, cartlib, publisher or shared-harness edits.

- CX01. Complete modules: carts/coroutines_manual/results.lua18 lines and
  cart.lua117 lines. Typed BSS owns result storage. Ordinary main/child language
  values are not private Thread words or raw free-RAM addresses. Module/typed
  storage/indexing/startup rules are the accepted Memory facts. Chapter listings
  must reproduce the result module and consecutive entry chunks literally.
- CX02. Entry6–12: pcall arithmetic returns true,10,nil,4. The retained numerical
  fields hold10/4; the success and interior-nil flags are1. Entry14–35: error
  preserves failure Table identity and nil, xpcall uses handler result144 and
  discards its extra result, handler error becomes error in error handling,
  pcall(rawget,{},nil) returns false and Table index is nil. The earlier store77
  is retained in this actual route; no universal transaction model is inferred.
- CX03. Entry37–68: main flag true and nonyieldable. Created body sees itself
  running with main-thread flag false, main normal, and itself yieldable. First resume
  supplies10/3, yields true,13,nil,ready, leaving suspended. Next resume supplies
  17,nil,23 as yield-call results; body returns40,nil,3. Parent observes true,
  40,nil,3, target dead, rejected resume false/exact non-suspended text, close
  true and main running. All14 thread flags are1; retained values13/40/3.
- CX04. Entry70–78: failing coroutine resume returns false and the same error
  Table; status is dead. First close returns false and that same Table, second
  close returns true. All4 failure flags are1. Normal completion and failure
  are not distinguished solely by the public status String.
- CX05. Entry80–92: child creates a surviving read closure over value19, yields
  19, and is then closed without running its value20 assignment. Reading the
  capture afterward gives19; all3 close flags are1. No device quiescence or
  cancellation semantics are inferred from closing language frames.
- CX06. Entry94–107: wrapped child yields12 then returns supplied34. Wrapped
  failure preserves original Table error under pcall; closing its retained
  Thread afterward succeeds because the wrapper already closed Failed state.
  Both wrap flags are1; actual BIOS wrap behavior is separate source evidence.
- CX07. Entry109–117 emits five final lines after twelve earlier diagnostic
  lines, sets completed1, and waits with halt_until_irq. Actual ordinary log
  contains all17 exact companion output lines with tabs and its timeline ends
  normally at presentation frame4. This is not a fixed boot-time/CPU-cycle claim.
- CX08. validate:toolchain:cart coroutines_manual --debug passes; ordinary
  artifactdddd16ea045a7a443c97f15074a5f3e9bc14a63edbaf21d2ab942476e90acf35.
  Derived-image integration case protected_calls_and_thread_lifecycle passes40
  retained assertions, excluding its completion wait. Ordinary BIOS playback
  separately passes companion headless:tooling/timeline command. This is not
  native execution of that ordinary cartridge or all error/transfer paths.

Logs /tmp/bmsx-coroutines-cart-build.log, -cart-test.log and -ordinary.log.
Initial example lint rejected one-use result locals and a captured initializer
with no direct body read. The final program actually prints the result groups
and yields the captured value before closing; no lint exemption, facade helper,
runtime repair or framework change was introduced.

## Independent paired-owner execution, not the ordinary image

Existing22 TS coroutine tests pass. Existing test:coroutines passes30 O0/O3
paired CPU/runtime vectors, including its actual save/restore and decoded-state
comparison, hardware-interrupted and completion-latch boundaries. Scope is the
existing named cases, not exhaustive runtime parity or every IRQ interleaving.

Separate scratch /tmp/bmsx-coroutines-extra-probe.ts reuses existing compiler,
real BIOS coroutine modules, test system ROM linker, Runtime and current native
bmsx_coroutine_runner. Nine bodies at O0/O3 give18 common true completions and
equal decoded final snapshots. Every CPU grant is17 cycles with the existing
capture/restore observation route. No new repo test framework was added.

- wrap_external_failure: retain the wrapped Thread through running, externally
  resume it to failure, then invoke its wrapper. The rejected resume raises the
  new non-suspended String, not the previous body error; private Failed cleanup
  occurs, so a later explicit close returns true. This confirms the bounded
  source-review correction, not a runtime repair.
- public_protected_transfer: pcall(public coroutine.yield) suspends/resumes with
  its own true prefix; pcall(public coroutine.resume) returns true followed by
  the resume prefix, including true,false,error for a target failure.
- yieldable_status: root false; New, normally Dead and Failed created threads
  true; after closing Failed true; explicit nil argument and closing main are
  caught Invalid argument. Yieldability is not resume permission.
- protected_values: true10,nil,4; Table error identity; false,nil error.
- handler_returns: first transformed144, extra discarded; empty handler yields
  nil; nonfunction xpcall handler caught by an outer pcall with exact source text.
- handler_failure: exact error-in-error-handling text; nil-key fault String.
- body_yield: xpcall body yields pause, resumes to error, nonyieldable handler
  transforms the Table code to144, body returns false,144 normally to resumer.
- handler_yield: attempted yield from handler becomes false/error-in-error-
  handling; outer coroutine returns normally rather than suspending there.
- closed_failure: direct failure, false/error first close, true second close;
  wrapper rethrows identical Table and closes Failed before later explicit close.

Log /tmp/bmsx-coroutines-extra-probe.log. The first scratch attempt incorrectly
compared whole encoded Uint8Arrays with large assert diagnostics and omitted
per-grant restore. It was stopped for excessive diagnostic memory use, then
aligned with the existing decoded-state conformance route and rerun. Only the
final18 completed comparisons are claimed; no raw encoded-byte equality is
claimed. No owner defect or runtime fix is inferred from that fixture mistake.
