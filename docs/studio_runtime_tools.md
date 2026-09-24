# Studio runtime tools

## Goal and acceptance

Codex must investigate the actual Studio target, not merely edit files next to a
chat pane. The complete acceptance workflow is: reproduce a scenario, observe
its image and state, inspect objects and scopes, step/rewind the right target,
evaluate Lua where needed, propose a canonical-source fix, apply/save/install
with distinct outcomes, and rerun the scenario. This document is a work plan;
unimplemented rows below are not advertised capabilities.

| Requirement | Owner / boundary | Evidence required | State |
| --- | --- | --- | --- |
| Working copies, diagnostics, reviewed edits | existing source tools | source receipts, review/history tests | implemented |
| Historical test evidence | ScenarioResultService | retained-result tests | implemented |
| Live globals, nested values, invalidation | SuspendedGuestSession + runtime inspection | real cartridge and bridge tests, no guest execution | implemented for installed global bindings; see validation below |
| Current CPU stack, frame locals and upvalues | installed symbols + RuntimeInspection | real source stop, recursive/inline frames, expired handles | implemented; see [stack inspection](studio_stack_inspection.md) |
| Game image | presentation owner + image-capable tool transport | pixels from each renderer, target/time provenance | implemented for paused authoring target; browser and native pixel evidence below |
| Pause, finite video stepping, retained-history seek | execution/history owners + RuntimeFrameNavigation | actual completion, retained-range and cancellation tests | implemented for the authoring target; validation below |
| Installed-source breakpoints, Continue and source stepping | RuntimeBreakpoints / RuntimeDebuggerExecution | exact bindings, execution intent, actual stops and cancellation | implemented for authoring target; see [source debugger](studio_source_debugger.md) |
| Session-context Lua Terminal | firmware compiler/REPL, shared Terminal session and debugger plans | real conversation calls, stops and TS/C++ BIOS parity | implemented; see [Terminal contract](studio_lua_terminal.md) |
| Explicit cart-global access from Lua Terminal | BIOS getglobal/setglobal + CPU registerfiles | real register/object writes, TS/C++ parity | implemented; see [named globals](global_register_access.md) |
| Implicit cart bindings in Lua Terminal | BIOS compiler named-register lowering | real conversation/manual writes, TS/C++ monitor parity | implemented; [binding contexts](studio_terminal_contexts.md) |
| Frame-context Lua Terminal | installed compiler/debugger binding contract | actual selected binding writes, liveness and frame lifetime, not copied scope tables | open; physical evaluation core tested on TS/C++, selected-stop admission/native name resolution not exposed; [binding contract](studio_terminal_contexts.md) |
| Discover/run/wait/cancel scenarios | TestRun/ScenarioRunService | real isolated targets, cancellation and completion | implemented; [test execution](studio_test_execution.md) |
| Retained failed test inspection | TestExecution / TestTargetInspection | phase-thread locals/upvalues, compiled source, expiry; no authoring reads | implemented read-only; [test inspection](studio_test_inspection.md) |
| Live test breakpoint/step/debug-rerun | target-bound debugger and composed execution hooks | actual stops/control on the test target | implemented for one named case; prompt-scoped control, [live test debugger](studio_test_debugger.md) |
| FSM/BT/ActionEffect source queries and reviewed edits | shared Behavior Lens documents and syntax-edit producers | canonical-source review, builder readback and Undo | implemented for initial-state, child-list and property edits; [behavior source tools](studio_behavior_tools.md) |
| Live Object/FSM/BT/ActionEffect/timeline inspection | shared Actor Lab runtime tree and suspended value owner | typed instance identity, nested values and execution/restore expiry | implemented for authoring/history; [Actor tools](studio_actor_tools.md) |
| Live Actor mutation | World mutation rendezvous and runtime call owner | explicit operation lifetime, admission and live-state readback | open; inspection and source tools do not imply mutation |
| Apply/save/build/install lifecycle | working-copy, Save, boot and Hot Resume owners | distinct receipts, rerun against installed code | open |

## Reference implementations

Studied before implementation:

* [VS Code debug model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/debugModel.ts):
  lazy children, variable paging, session/frame-bound evaluation and reference
  invalidation. BMSX does not copy its external-adapter fallback handling into
  trusted runtime reads.
* [DAP](https://github.com/microsoft/debug-adapter-protocol/blob/main/specification.md):
  scopes/variables refer to a suspended state; execution acknowledgement is not
  the later stopped event. Evaluate and side-effect-free inspection are distinct.
* [VS Code test service](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/testing/common/testService.ts):
  explicit discovery, execution, cancellation and results, independent of views.

These are design references, not a requirement to build a DAP server or a
generic execute-any-command facade.

## Ownership

Tools call the same pane-independent owners as ordinary Studio features.
The existing browser/server bridge carries requests and results; it does not
create a replacement game on the server. Every runtime request identifies its
target. Authoring, running tests and retained failed tests are different targets.
Authoring, live test and retained-test inspection have separate admissions; an
unsupported/expired test attachment fails, never silently inspects authoring.

Inspection reads actual guest values. Source metadata supplies names/locations,
not guessed values. Globals scopes describe bindings in installed BIOS/active
cartridge symbols, not a second per-cartridge global bank and not a claim to
enumerate dynamically created names without symbols. Tables retain typed keys;
display labels are never lookup keys. No metamethod or Lua function is executed
to inspect a stored value. Objects are expanded lazily; a table is traversed once
per inspection context, not once per requested page or host frame.

Borrowed references expire on execution, guest call entry, state replacement,
workspace/connection retirement or explicit context replacement. No heap values
survive in the tool registry after expiry. Source edits alone do not rewrite
installed-machine observations. A new read cannot revive an old handle.

Tool-input decoding is confined to the external model boundary. Internal values
use their guest tags and existing formatting. There are no serialized heap
restore operations or rollback around guest mutations.

## Representation and performance gate

| Data | TypeScript owner/representation | C++ owner/representation | Change in first slice |
| --- | --- | --- | --- |
| Globals | CPU ordinary/system registerfiles; guest Value slots | CPU ordinary/system registerfiles; guest values | none |
| Table keys/values | Table stored entries, ValueTag | Table stored entries, guest tags | none |
| Time | scheduler machine cycles; frameScheduler video sequence | scheduler machine cycles; frame scheduler | none |
| Inspection handles | IDE-only borrowed-value registry | no IDE registry required | new tooling only |
| Terminal compilation/execution | BIOS load/pcall + CPU | same BIOS + native CPU | session and cart parity proven by physical-monitor conformance; selected-frame bindings still open |

First-slice hot-path callsites: `runWorkbenchHostFrame` invalidates outstanding
borrows before normal execution and rewind replay, including with the editor
closed. Existing guest-call and machine-replacement invalidation remain owners.
No per-instruction hook, per-frame value traversal, serialization or inference is
added. Values and pages are constructed only on explicit inspection requests.

## Next implementation gates

1. Live global/table and current-frame inspection have explicit suspended
   lifetimes. Actor semantic roots share the authoring suspension; live and retained
   test attachments now have separate lifetimes.
2. Image transport and presentation capture are implemented; target-bound test
   captures remain part of test-target integration.
3. Expose execution owners with completed/stopped/interrupted outcomes, not UI
   command dispatch. Logical video steps and source/instruction steps differ.
4. Cart-context evaluation now shares the BIOS compiler on TS/C++. Complete
   selected-frame bindings and lifetime ownership before claiming local evaluation.
5. Test execution, target-bound debugging and basic source-backed builder actions
   are implemented. Live semantic Actor operations and builder transfer/retarget
   impact review remain open.

Long operations wait on owner completion/events, not repeated provider polls.
User Stop cancels owned work without undoing already performed guest writes.
Image requests and inspection are on demand, never a continuous model feed.

## First-slice validation (2026-09-24)

* `runtime_inspection_tools.test.ts`: compiled guest globals, typed numeric/string/
  boolean/reference keys, aliases/cycles, one table walk across pages, unchanged
  guest heap/clock, unavailable symbols, foreign/expired handles, operation
  admission and prompt/connection retirement. Conversation tests cover actual
  dispatch without extra inference or implicit resume. Focused bundle: 35 pass.
* `studio_runtime_tools.test.ts`: real browser, authorized HTTP and Codex
  app-server, with a deterministic local Responses fixture. Software, WebGL2 and
  WebGPU each read the installed World and a nested object while retaining dirty
  source, guest heap and execution position. Actual execution with the editor
  closed, rewind restore and recorded forward stepping all retire references;
  the stopped historical target remains inspectable. Eight expected model
  requests per workflow, one connection, no background model polling.
* Full Lua suite: 2399 pass, one skip. Ordinary assistant suite (including new
  runtime cases): 18 pass. Existing runtime-inspection UI/Hot Resume/rewind
  regression: WebGL2 pass. HTTP/ordinary server admission: 16 pass.
* Browser Studio build and IDE/common/browser/Node host typechecks pass.
  The tests project still reports 96 diagnostics: a compiler-host comparison
  against HEAD before this slice found identical diagnostics, none introduced
  or removed. Strict architecture audit: zero issues.

This is automated integration evidence, not live-model reasoning, personal
account authentication, screenshot delivery to Codex, native Terminal parity or
completion of the full acceptance workflow.

## Game-image slice: design gate

The image is the retained completed game frame, after device quantization and
before CRT/host UI composition. It is not a browser screenshot, a second
software render, or an image reconstructed from object data. Runtime observation
position and the machine position at frame publication are separate metadata:
a stopped CPU can be ahead of its last completed visual frame.

Reference: MAME `video_manager::save_snapshot` / `create_snapshot_bitmap` in
[video.cpp](https://github.com/mamedev/mame/blob/master/src/emu/video.cpp) keeps
screen selection and native image production in video ownership, separate from
encoding. BMSX already retains completed-frame textures, so it reads those rather
than rendering a substitute. The installed Codex 0.156.1 generated
`DynamicToolCallResponse` schema supports `inputImage` with `imageUrl`; the
existing text result remains text and PNG attachments use that real content
type, not base64 inside prose. A contract test must inspect the next actual
Responses request.

| Boundary | TS | C++ | Intended change |
| --- | --- | --- | --- |
| Retained frame | RenderPassLibrary history handles / RenderGraphRuntime textures | RenderGraphRuntime history handles / textures | read only the presenter's committed history index |
| Pixels | software RGBA bytes; WebGL bottom-up RGBA; WebGPU padded BGRA/RGBA | software ARGB words; GLES2 bottom-up RGBA | backend emits tightly packed, top-down RGBA8; no gamma transform |
| Capture | asynchronous texture readback (WebGPU mapping) | synchronous software/GLES2 readback | owned result buffer; no CPU/guest execution |
| Provenance | VideoPresenter presentation sequence + RenderPresentationState publication cycles/tick | native presenter sequence; native host retains its time owner | committed frame, not UI refresh count |
| PNG | browser image codec / Node PNG codec | existing native screenshot codec | host encoding, never guest/tool-local pixel conversion |
| Provider | existing Studio HTTP + Codex session | no native IDE bridge | typed image attachment, no extra server |

Hot-path callsites to audit before mirrored edits: TS/C++ VideoPresenter
`finalizePresentation` / `resetPresentationHistory` and TS
RenderPresentationState `presentFrame`. They retain scalar publication identity
only. Texture readback, row/channel normalization, PNG encoding and transport
occur solely on an explicit capture request. No extra render pass, per-frame
pixel copy or model request is introduced. Outstanding reads use the existing
runtime task admission boundary; cancellation must not poison that queue or
silently resume the target.

Capture/PNG ownership lives in `hosts/common/game_capture.ts`, injected through
the `GameImageCapture` contract. Runtime tools add authoring-target/paused-state
admission and current observation metadata. Studio does not reach into the host
presentation loop, and ordinary host callers can reuse capture without Codex.

## Game-image validation (2026-09-24)

* The pinned Codex 0.156.1 app-server forwards an `inputImage` tool attachment
  into the next Responses request as `input_image` with `detail: high`.
  Existing text-only results remain text. Contract suite: 6 pass.
* Actual browser machine -> authorized HTTP -> production CodexSession -> real
  app-server -> deterministic Responses fixture: software, WebGL2 and WebGPU
  deliver the same 256x192 Nemesis frame byte-for-byte. Native texture and decoded
  delivered PNG hashes match. The image excludes the visible Studio/assistant
  overlay. Current cycles/tick and publication identity remain explicit; guest
  clock, heap and dirty source are unchanged. Nine expected model requests and
  one connection per workflow, no background polling. Full assistant suite:
  18 pass; all three runtime/image workflows also rerun after the ownership gate.
* Independent 65x3 asymmetric texture vectors verify orientation, channels,
  ownership and WebGPU row padding for both RGBA and BGRA textures. Native
  software/GLES2 tests cover the same values, committed/partial history,
  graph-rebuild unavailability, CRT/overlay exclusion and GL binding retention.
  Native capture/presenter/overlay bundle: 3 pass.
* Capture unit tests cover unavailable frames, task admission, foreign targets,
  cancellation before/during readback, explicit GPU failures and retained pause.
  Conversation Stop, disconnect and turn completion discard late image replies
  without another model request or a poisoned task queue. Focused bundle:
  42 pass. Full Lua suite: 2406 pass, one skip. HTTP suite: 16 pass.
* Browser Studio and Node tooling builds plus IDE/common/browser/Node typechecks
  pass. Strict architecture audit: zero issues; core parity audit passes.
  Tests-project comparison against HEAD retains 96 existing diagnostic sites;
  four messages only change their missing-member lists/counts for expanded
  presenter/presentation types. No new diagnostic site or error code.

This proves automated pixel delivery, not a live model's visual reasoning or
personal-account authentication. Images are requested observations, not a
continuous video stream. At this slice boundary, execution/rewind tools were still
open; the next section records frame navigation. Contextual Terminal invocation
with native parity and Scenario Lab execution were still open at that boundary;
their later implementations are linked in the acceptance table. Later contracts
record test-target debugging. Semantic builder tools and complete
fix/save/install/rerun acceptance remain open.

## Frame navigation: implementation gate

References studied before this slice: VS Code `Thread`/`DebugSession` execution
requests and stopped-event handling, the DAP Next/StepBack contract, and MAME
`device_debug::single_step` / `go_vblank` in
[debugcpu.cpp](https://github.com/mamedev/mame/blob/master/src/emu/debug/debugcpu.cpp).
Command acceptance is not stopped-state completion. Video-boundary stepping is
not source/instruction stepping. BMSX retains its real scheduler and input-journal
owners rather than estimating frames from wall-clock time.

The pane-independent frame-navigation owner serves both ordinary Studio
commands and assistant tools. It accepts one finite operation, retains user pause,
and resolves after actual host execution/presentation settles. It must report
completed, stopped, interrupted, replaced or failed outcomes with actual machine
position; no client/provider polling, timers, or simulated UI actions. Cancellation
must not stop a newer user intent. History seeks select retained video boundaries,
report any boundary selection, and preserve the recorded future.

| Representation | TS owner | C++ owner | Change |
| --- | --- | --- | --- |
| Machine cycles / video sequence | scheduler / frame scheduler integer counters | same counters | none |
| Retained timeline | RuntimeHistory / InputJournal | RuntimeHistory / InputJournal | none |
| Restore provenance | RuntimeRestoreOrigin enum at applyRuntimeSaveState | same native enum | publish existing origin in restore callback rather than infer it from UI state |
| Host navigation intent | HostExecutionControl / HostRewind | native frontend owns its own controls | retain command revisions; no emulated-state representation change |
| Awaitable Studio operation | frame-navigation service | no native Studio service | owner lifecycle, not a new execution loop |

Hot-path inventory: `runWorkbenchHostFrame` advances pending navigation completion
once after the existing frame work; idle navigation returns immediately without
allocations. `HostExecutionControl` and `HostRewind` change intent revisions only
on explicit commands. `applyRuntimeSaveState` (TS/C++) forwards its already-owned
restore origin on state replacement. No per-instruction hooks, new snapshot
copies, register conversions, or extra guest evaluations are introduced.

## Frame-navigation validation (2026-09-24)

`studio_step_frames` takes a target, direction and positive count;
`studio_seek_history` takes a target and retained machine cycles. Both await the
owner's result. `studio_runtime_status.history` exposes range, review position
and operation availability. The reported position is actual machine time, not
the UI's requested seek destination. Frame navigation does not promise a gameplay
update per video tick and is distinct from source/instruction stepping.

* The real browser machine -> authorized HTTP -> Codex app-server -> deterministic
  Responses workflow passes on software, WebGL2 and WebGPU. It inspects, advances
  four video boundaries, rejects an expired borrowed handle, reinspects, rewinds
  two, captures the game image, seeks and replays retained input. Actual receipts
  match the machine, source remains dirty/uninstalled, and no tool changes panes.
  A second prompt advances a long batch; the visible Stop control interrupts real
  execution and leaves the target paused and inspectable. Ordinary Next/Previous
  Frame commands then use the same owner. Exactly 13 model requests, two explicit
  prompts, one connection and one interrupt per workflow; no background polling.
* The 62-test focused bundle covers real scheduler progress, one restore for a
  backward batch, replay-to-live transition, retained-start/range outcomes,
  mutation and initialization admission, cancellation during a queued GPU fence,
  failed task retirement, reset/external-load provenance and independent newer
  execution/history intent. Conversation Stop/disconnect/completion discard late
  results; a provider request cancellation aborts navigation/capture even before
  turn completion, without retiring other tool requests. These are automated
  integration/unit tests, not live-model reasoning.
* Native frame-scheduler tests assert HistorySeek versus ExternalLoad provenance;
  the real-cart native host-rewind conformance runner passes. This slice changes
  callback provenance, not native scheduler/history semantics or Terminal parity.
* Full assistant/browser suite: 21 pass. Full Lua suite: 2422 pass, one skip.
  HTTP admission suite: 16 pass. Product Studio/Node tooling
  builds and IDE/common/browser/Node typechecks pass. Architecture-boundary
  audit: zero issues; core parity audit passes. The tests project retains its 96
  pre-existing diagnostics; the new navigation tests introduce none.
* Ordinary Studio workflows and runtime-inspection/Hot Resume/rewind workflows
  also pass on WebGL2. These exercise the visible command routes separately from
  provider tools; no new global gameplay keybinding or Codex-specific control was
  added.

The subsequent [Terminal slice](studio_lua_terminal.md) adds actual conversation
execution, stopped/completed observations, request cancellation and physical
BIOS-monitor parity. That initial slice explicitly supported only the Terminal's
own session namespace. The subsequent
[named global-register access](global_register_access.md) slice permits explicit
`getglobal`/`setglobal` calls to the actual ordinary registerfile and live cart
objects, including from a conversation. The
[binding-context slice](studio_terminal_contexts.md) now also supplies implicit
cart bindings through the same compiler and registers, on both machines.

Subsequent slices add [Continue/source-debugger operations](studio_source_debugger.md)
and [scenario discovery/execution](studio_test_execution.md). Still open:
frame-context Lua Terminal bindings, cross-turn test-debugger handoff, live Actor
mutation, complex builder transfer/retarget review and the complete
reproduce/fix/rerun acceptance flow. Basic canonical-source builder operations
are implemented as recorded in the acceptance table above.

The subsequent [retained test inspection](studio_test_inspection.md) slice adds
actual phase-thread stack/scopes/objects and compiled-source reads, shared with
ordinary Scenario Lab. This is read-only post-mortem at case end, not a copied
fault heap or live test execution control. Test pixel capture remains open.
