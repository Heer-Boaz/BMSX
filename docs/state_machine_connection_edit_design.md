# FSM connection editing and source impact review

## References and boundary

This completes the source-evidence, proof-history and shared-connection-control
slices. Lua remains canonical; the graph never owns mutable topology.

- [Godot's reconnect operation](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/editor/animation/animation_state_machine_editor.cpp)
  retains the particular transition during a provisional drag and commits one
  document Undo action after release. BMSX retains the particular return proof,
  not an endpoint pair, and does not copy Godot's no-self/parallel restrictions.
- VS Code's [bulk edit review pane](https://github.com/microsoft/vscode/blob/8a344c1efe17c6d7b5ce0c53d26459ac72b2e5e0/src/vs/workbench/contrib/bulkEdit/browser/preview/bulkEditPane.ts)
  separates the impact tree, source navigation and Apply/Discard actions. Its
  [conflict owner](https://github.com/microsoft/vscode/blob/8a344c1efe17c6d7b5ce0c53d26459ac72b2e5e0/src/vs/workbench/contrib/bulkEdit/browser/conflicts.ts)
  subscribes to affected source models for the proposal's lifetime. A choice
  picker is not a substitute for reviewing a change.

## Ownership

The cold FSM index maps source occurrences to actual scopes and marks literal
path proofs eligible for retargeting. Selected-edge capability is a constant-time
query of that index plus current source/writability. Initial/concurrent edges,
constant aliases and arbitrary Lua do not acquire target grips. Source-end
reconnection would change the handler owner and is not this operation.

One physical gesture creates one existing `StateMachineRetargetAnalysis`. Only
state headers with actual scopes are candidates. The analysis retains only the
current candidate; mouse movement inside a header does not rescan consumers.
The shared control owns threshold, capture, scrolling, preview and cancellation.
An unchanged or unproven target never becomes an accepted drop.

A single recognized use commits on release. Multiple recognized uses open an
editor-local **source edit review control** instead. It uses the shared property
tree, action bar, focus and command owners, not a new modal input router or an
FSM-specific popup. It occupies the editor body at the actual tiny-font size.
It is transient control state, not a tab, saved document or alternate history.

The contribution produces all impact rows once, including registration, origin,
old/new target and exact proof source. Every row is informational: a single
shared literal cannot be selectively applied to just one consumer. Apply and
Discard are explicit commands. Enter/double-click opens the selected source
without applying; Escape discards. Source navigation or switching the pane ends
the review. Other workbench commands remain available; opening the palette does
not discard the review. Source changes immediately invalidate it; loss of
writability revokes Apply and ends it on update. No stale proposal is rebased,
silently retried, or applied anyway.

The review detaches its listeners and focus before calling the contribution's
accepted edit. That edit uses the existing literal writer and proof-history
operation. It does not run Save, install media or call guest Lua. Save/Hot Resume
uses the ordinary compiler and `<init>` path: definition rebind preserves live
state, and subsequent guest transitions consume the changed definition.

The impact list covers recognized source consumers, not arbitrary dynamic Lua
calls or escaped tables. It explicitly says so; no claim of exhaustive runtime
reference analysis is made. No machine, cartlib or mirrored-runtime ABI changes.

## Required evidence

- Independent fixtures: literal/alias/entry capability, shared returns and
  registrations, rejected targets, source/read-only invalidation, no preview
  edits, one accepted edit, exact Source and Undo/Redo proof selection.
- Review control: no edit from row selection, separate Apply/Discard, source
  navigation, palette focus, lifetime cleanup, source changes, retained layout.
- Actual Studio pointer drags and review, Source/Undo/Redo, then ordinary Save/
  Hot Resume with an independent Lua fixture and a guest-driven transition, on
  software, WebGL2 and WebGPU. A fake graph or source-only test is insufficient.
- No per-motion source scan for an unchanged target, no per-frame impact-list
  construction or text measurement. Measure source admission separately from
  rendering and guest execution, and report the limitations of those numbers.

## Validation — 10 September 2026

- Full Lua suite: **1,224 pass, one skipped, zero failures**. Seven new independent
  drag/review tests cover admission, exact shared proof, readonly/source lifetime,
  separate actions and retained text/overlay storage. Existing source/history/
  connection regressions remain in that suite.
- The physical FSM workflow passes on **software, WebGL2 and WebGPU**, including
  held Apply/Discard/Source, gesture/review Escape, palette interruption and
  acceptance, pane/source/readonly invalidation, hidden Undo/Redo and one actual
  Save/Hot Resume. Two retained guest machines first reject and then enter the
  edited target through ICU-driven callbacks and normal guards/exit/entry.
  Independent direct-use retargeting also commits exactly once on release.
- Complete Studio and Pietious navigation pass on all three backends. The real
  headless Behavior Lens reports **59 assertions**. Tiny-font review captures
  were inspected. Accelerated runs use Chromium/SwiftShader; they are not a
  physical-GPU performance measurement.
- Browser/headless builds and IDE typecheck pass. Tests-project diagnostics remain
  the same **51 existing issues** against `48b0d3570`; not a clean tests-project
  typecheck. Strict architecture, core-parity, indentation and diff checks pass.
  No machine, C++ or cartlib implementation changes.

### Measured boundary

Node 22.23.1, isolated processes after validation finished. Three process medians,
10 warmups and 25 batches each. Values below are **microseconds per operation**:

| Recognized uses | Capability | Begin + first target | Motion within target | Impact/open/layout | Retained review layout | Review + overlay quads |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 32 | 0.0055 | 2.147 | 0.0106 | 25.652 | 0.0070 | 15.953 |
| 1,024 | 0.0052 | 65.350 | 0.0166 | 616.335 | 0.0140 | 16.052 |

Only three nodes of the selected registration are laid out; consumer count varies
across other registrations. These numbers do not establish constant-time node
hit testing. New-candidate analysis and review construction scale with actual
uses; stationary capability and retained review do not repeat them. Unchanged
text/rows and quad buffers are retained. No heap/GC instrumentation, parser,
worker timing, complete pointer dispatch, GPU raster, guest/Hot Resume or total
Studio-frame cost is included.

The existing source-analysis workload was also bundled against `48b0d3570` and
the working tree, with two isolated before/after process pairs in opposite order.
Construction plus first check was **1.956 → 1.950 µs** for 32 uses and
**72.418 → 66.396 µs** for 1,024. Source projection (not the new view index) was
**0.0704 → 0.0720 ms** and **3.4025 → 3.4469 ms** respectively. Cached checks were
about **0.0013–0.0016 µs**, below a useful cross-process performance claim. This
is a bounded comparison, not a universal speedup or zero-overhead guarantee.
Commands are in the conformance README; logs, baseline bundles, raw measurements
and captures are under `/tmp/bmsx-fsm-drag/`.
