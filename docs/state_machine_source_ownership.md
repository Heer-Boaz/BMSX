# FSM edits use their actual Lua source owners

2026-09-13; D1 follow-through after `aef65b982` and compiler prerequisite
`674652ff7`. Lua remains the authored representation.

## Reference implementations

Inspected production code, not just editor screenshots:

- [Godot's transition reconnection][godot] changes the actual state-machine
  resource and records the transition and selection in shared Undo/Redo.
  Rendered endpoints are interaction geometry, not a substitute resource.
- [Qt Creator's model-to-text merger][qt] resolves property operations through
  the owning source model and text modifier, with tracked source positions.
  BMSX keeps its existing token-preserving Lua edits; it does not copy QML's
  parser, runtime instance layer or recovery policy.
- [VS Code's multi-resource editor][vscode] aggregates resource persistence and
  dirty state. BMSX's existing [composite input](editor_composite_sources.md)
  supplies that capability; this slice does not create an FSM-specific Save
  route or private history.

These are adaptations to BMSX's declarative Lua representation. They are not a
claim that those engines invert arbitrary Lua callbacks into editable graphs.

## Ownership

| Operation | Actual write owner |
| --- | --- |
| Set Initial | The parent's Lua table constructor, including insertion of a missing field |
| Retarget a direct or wrapped `go` path | The string literal at that written field |
| Retarget a known callback return | The first returned string literal at that exact return statement |
| Source / Back | The selected source proof and its file-qualified coordinates |
| Save / dirty / Undo / Redo | Existing workspace models, history and composite input membership |

The registration anchor is still the input identity and discovery source. It is
not an implicit write target. A read-only registration cannot disable editing
of a writable provider; a writable registration cannot authorize edits in a
read-only provider. Commands, pointer admission, retained drag lifetime and
review Apply all consume the actual write model's access policy.

The cold FSM source index now retains the actual retargetable literal per
outcome instead of a same-file boolean capability. Hover uses this index and the
retained model map; it does not query the workspace or scan consumers. A drag
resolves its model once. Dependency changes invalidate its source generation;
loss of the write model's access invalidates the gesture/review.

A selected definition's editable return literals can live outside its displayed
declaration nodes. Their models therefore join the composite input's Save/Undo
scope too. Merely importing a callback or querying another definition does not
add that file. Participating documents retain input lifetime: incomplete syntax
or deleting the return must not discard the file needed to Undo or Save it.
No stale AST, layout or proposal is retained as a fallback.

The existing path-binding and source-history rules remain intact: preserve
absolute/relative anchors, bind proposed paths for every recognized consumer,
reject unresolved/dangling consumers, preserve surrounding tokens/trivia and
track the exact selected return rather than its line number or edge ordinal.
Aliases and arbitrary expressions remain source edits, not permission to
rewrite a guessed initializer.

**Coverage limit:** recognized consumers are those in the current registration
source document, including its imported declarations and callbacks. This is not
a whole-workspace caller inventory. The review names both the actual proof file
and the registration source it covers; other registration files, escaped tables
and dynamic calls are not enumerated. One literal remains a shared source edit,
not a private mutation of the selected occurrence or running instance.

## Compiler prerequisite

The live imported-callback test exposed syntax-based static promotion of an
ordinary module returning a function. `674652ff7` fixes the module-contract
producer: only `module<const>` selects the static ABI. Normal returned closures
keep captures, table access, call results and runtime identity. The Studio does
not wrap them in a table, rewrite them into a different syntax or invoke them
to inspect their returned path.

All nine existing bare-function BIOS/cartlib static modules now declare their
ABI explicitly. Eight independent scalar/math modules were compiled before and
after at O0/O3: all sixteen code/constant/data comparisons match. The remaining
VRAM-region function is exercised by the rebuilt BIOS. This is specific
instruction-stream evidence, not a general performance or runtime guarantee.

## Proof and remaining work

The existing fixture families are shared across local/provider variants rather
than copied from game source. `behavior_edit_fixture.ts` supplies real workspace
models, history and source lifetimes to the edit and drag tests. They cover
separate registration, branch and callback files; exact Source/Undo bookmarks;
read-only combinations; incomplete syntax; shared consumers; missing initial
fields; and exclusion of unrelated callback dependencies from Save/Undo.

The existing browser workflows run Set Initial and Source/history with both
local and imported declarations. The same physical reconnect/review workflow
also runs with the callback in another module (`--studio-fsm-retarget-imported`):
normal Save/Reboot, drag cancellation, shared-use review, read-only and dependency
invalidation, Source, Undo/Redo and Save/Hot Resume, followed by real ICU input
through both retained live FSMs and their guards. No guest table is patched by
the test. The application is exercised on software, WebGL2 and WebGPU.

The additional Set Initial live probe exposed an intermittent synthetic-pointer
failure around canvas resizing, reproduced in the unchanged `aef65b982` baseline.
The shared browser fixture now follows [Playwright's stable-position check][pointer]:
observe equal canvas bounds across browser animation frames **before** converting
the intended UI point to screen coordinates. `BrowserVideoOutput` schedules its
layout on rAF; an accelerated machine tick plus a microtask drain is not that
layout boundary. This affects only test click admission. There is no retry of a
failed click, arbitrary sleep or application input fallback.
The final probe observed a real pending `640×480` to `768×576` layout change
before pointer placement and passed on all three renderers.

This admits edits **inside** provider files. It does not move syntax between
two files, broaden API/factory recognition, enumerate every runtime caller, or
implement the separate loaded-definition/instance inspection contract D2/D3.

### Validation results

- **1,710 Lua tests pass; one existing skip.** IDE typecheck passes. The tests
  project retains the exact same 51 baseline diagnostics, compared by diagnostic
  text, not only count.
- Full Studio workflows, imported physical FSM reconnection/Hot Resume and the
  existing local reconnection and initial-state live workflows pass on software,
  WebGL2 and WebGPU. Expected negative compile/fault probes retain their fault
  gates. BIOS, Nemesis and the debug browser product have been rebuilt.
- Strict architecture boundaries, core parity, indentation and `git diff --check`
  pass. No machine or C++ runtime source changed; this is not native-host UI proof.

The existing `profile_fsm_drag.ts` workload was reused, with an additional
`--imported` mode. Node 22.23.1, ten warmups / medians of 25 batches, three
alternating baseline/current process pairs, without concurrent browser/build/test
jobs. Selected-definition geometry and source indices are retained before timing.
For 1,024 recognized uses, medians in microseconds:

| Operation | Baseline | Current local | Current imported (one process) |
| --- | ---: | ---: | ---: |
| Endpoint capability | 0.0105 | 0.0172 | 0.0184 |
| Analysis + first candidate | 73.09 | 69.16 | 71.01 |
| Movement within retained target | 0.0279 | 0.0221 | 0.0192 |
| Impact construction + initial review layout | 598.11 | 639.95 | 640.73 |

Resolving the actual owner adds the necessary model lookup; file-qualified review
text also costs work at review creation. Retained movement does not rebuild this
text or rescan consumers. These tiny isolated measurements are not a speedup
claim, a full workspace/frame budget, a GC measurement or GPU timing. Logs and
the static-instruction comparisons are under `/tmp/bmsx-fsm-*` and
`/tmp/bmsx-static-modules-*`.

[godot]: https://github.com/godotengine/godot/blob/c24bf5d933c53d9477d5e82c51403856a9e7da62/editor/animation/animation_state_machine_editor.cpp#L131-L177
[qt]: https://github.com/qt-creator/qt-creator/blob/f6e59e3b21aa8e086af27db922d1347a0610dcb4/src/plugins/qmldesigner/libs/designercore/rewriter/modeltotextmerger.cpp#L67-L104
[vscode]: https://github.com/microsoft/vscode/blob/8e35945bae3f2b0b3d0276963281180f1ce10cb0/src/vs/workbench/contrib/multiDiffEditor/browser/multiDiffEditorInput.ts#L316-L343
[pointer]: https://github.com/microsoft/playwright/blob/v1.58.2/packages/injected/src/injectedScript.ts#L663-L710
