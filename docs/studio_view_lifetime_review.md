# Studio view lifetime and execution ownership

This reviews the shared owners behind Terminal, Game View and the live tools,
not just their pointer branches. It is not a whole-engine architecture sign-off.
The machine, firmware shell, replay engine and native input path are unchanged.

## Corrected: options repeated input attachment

`EditorPane.setOptions` called `activate` by default. Only Code Editor supplied
its own options implementation. Same-input navigation in the other selectable
panes therefore repeated attachment, chrome changes and control binding.
Terminal options could also resume a suspended monitor plan. Views without
navigation options inherited the same unrelated lifecycle effects.

The shared owner now orders input attachment and optional navigation separately.
Actor Lab, Behavior Lens, Scene Editor, Cart Maps, Scenario Lab and Resource
Viewer own their concrete options; Code Editor keeps its existing selection
owner. Reusable graph, split and toolbar controls stay attached during same-input
navigation. Only the destination selection's transient inspectors/reviews end.
Projection and layout stay in the normal view update, not a second input attach.

The reference is VS Code's separate
[input, options and visibility operations](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorPane.ts)
and [editor-group orchestration](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorPanes.ts).
Focus is another operation, not a shortcut for any of those lifetimes.

## Verified: Workbench admission is not focus-owned transport

`RuntimeCartEditor.executionSuspended` uses
`inputFocus.target.guestInput.recipient` to release the Workbench hold only for
the primary game. The original bounds-only attachment has been replaced with
an explicit recipient for independent interactive sessions. This is
deliberate existing behavior, documented in the runtime-timeline contract and
checked by the real game-input conformance workflow; it is not an isolated
Terminal mistake. Restoring game focus can consequently change whether the
guest advances, although `InputFocusTarget` describes input routing.

The follow-up inspected the actual commands, focus control, pane lifetime and
host-frame consumer together. The admission policy already has one owner:
`RuntimeCartEditor.executionSuspended`. Focus publishes routing context; it does
not dispatch Continue, change a transport revision or clear Requested pause.
The policy intentionally consumes that context to decide whether source
authoring should hold the guest. Independence of transport from focus does not
require removing this deliberate UX behavior or copying its intent into a
second flag/service.

| Representation | Producer / owner | Meaning |
| --- | --- | --- |
| `guestInput` bounds/recipient | Embedded `GameInputControl` | Physical input destination, including while explicitly paused; secondary focus does not unblock the authoring machine. |
| `suspendsRuntime` / inspector `running` | Active pane and inspection lifetime | Permission to release the automatic authoring hold for live inspection; not actual playback state. |
| `workbenchExecutionRequested` | Debugger/supervisor operation plan | An explicit operation may execute while Studio remains open. |
| `executionSuspended` | `RuntimeCartEditor` | Composed Workbench hold, consumed by the host frame. |
| `HostPauseReason.Requested` | `HostExecutionControl` | Explicit transport intent; neither focus nor pane activation clears it. |

The real game-input workflow exercises source focus, the side panel, Actor Lab
Details, explicit pause, frame advance and rewind. Focusing an explicitly paused
viewport still routes physical input but leaves the guest clock held. Hidden
viewports release their focus. No execution-policy rewrite is warranted by
these findings. Preserve the separate transport, debugger/evaluation plans and
rewind review owners.

VS Code's [debug session](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugSession.ts)
and Godot's [debugger/run-bar integration](https://github.com/godotengine/godot/blob/master/editor/debugger/editor_debugger_node.cpp)
keep Continue/Pause operations with the debug target, not editor attachment or
rendering. They are references for that separation, not proof that BMSX's
automatic source-authoring hold must match their UX.

## Corrected: inspector painting prepared interaction geometry

`BehaviorLensEditorPane.draw`, `ScenarioLabEditorPane.draw` and
`ScenarioTargetInspection.draw` laid out their inspector controls. Inline
ActionEffect and shared property editing also revealed the selection while
painting, and the shared value-input painter measured the text viewport.

The existing pane updates now prepare parent layout, then inspector/review/value
geometry. Scenario target inspection prepares its action bar and lazy tree in
its update, not draw. AEM and Lua Program prepare their property tree before the
shared inline edit. Scene, Cart Maps and ROM Inspector prepare their own value
controls; invisible/read-only Scene fields do not acquire new measurement work.
The existing geometry and measurement caches remain with their original owners.
There is no new view facade, generic lifecycle or execution side effect.

This follows VS Code's [prepare/render scheduling](https://github.com/microsoft/vscode/blob/main/src/vs/editor/browser/view.ts),
[variable-view layout](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/variablesView.ts)
and [split-view child layout](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/splitview/splitview.ts).

## Corrected: ROM filtering was a property draft

The ROM filter used `ValueInput`, so visible query text did not filter results
until Enter/blur. Its command context also replaced the text field's own Undo
and Redo owner with the pane. The query is now an ordinary retained `TextField`,
using the existing editing, history, clipboard, viewport and paint primitives.
ROM actions are explicitly registered without replacing that local history.
Query observation belongs to input attachment and ends at detachment; Enter
only transfers focus to results. No property transaction, generic control
facade, timer or new per-frame projection was introduced. VS Code likewise
separates [filter changes from result acceptance](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/viewFilter.ts).

## Corrected: popup return focus outlived a transient control's input

Opening the command palette from an authored property commits/cancels its draft
through ordinary blur and ends that inline edit. The palette retained the old
field object anyway. Escape could refocus an invisible cell with no source
binding; the next typed input/Enter reached its parser and threw. The same
ownership gap allowed a popup to resurrect a dismissed inspector or source
review, including its toolbar.

Focus eligibility now comes directly from each shared control's existing input,
inspection, image or source binding. The focus owner resolves a retired control
to its containing scope. Quick input and context menus also capture their
provider/command origin after blur has completed, not before the departing edit
ends. Persistent fields still own their local history; command lookup does not
inherit commands from a parent. There is no parallel attachment/visibility flag,
per-frame eligibility scan, parser guard or new source/application path. This
follows VS Code's [visible-ancestor focus restoration](https://github.com/microsoft/vscode/blob/main/src/vs/platform/quickinput/browser/quickInputController.ts)
at the canvas focus owner rather than checking DOM state in feature files.

The follow-up reproduced the same lifetime gap in the source editor's Rename
widget: blur disposes its `WorkspaceSourceContext`, but palette cancellation
could refocus its retained field and invoke `onDidInvalidate` on that absent
context. Rename now exposes focus eligibility from its existing source context,
not a new visibility flag. Cancellation returns to the source and a new explicit
Rename starts a new reference operation. VS Code likewise ties its
[Rename widget to a cancellable refactor operation](https://github.com/microsoft/vscode/blob/main/src/vs/editor/contrib/rename/browser/renameWidget.ts).

## Boundaries that must remain

- Assistant and observed-conversation sessions outlive pane detachment; their
  existing session/input owners decide closure, not focus or rendering.
- The BIOS terminal is physical firmware state. Detaching its view suspends its
  existing plan; it does not synthesize CONT, restore state or create a host REPL.
- Debugger/agent evaluation is an explicit operation through the existing CPU
  and BIOS owners, not an alternative terminal or a replacement emulator.
- Source models and navigation bookmarks retain resource identity independently
  of the active code pane. Same-input navigation is not source installation.

These corrections change no CPU instruction hook, guest representation or
per-frame observer. Validation distinguishes owner/lifecycle tests, compiled
Studio workflows and visible product interaction; it is not native parity or a
whole-engine architecture sign-off.

## Validation of the input/options correction

The focused pane, focus, navigation-history and resource-navigation tests pass
(34 cases). The compiled Studio workflow and Pietious Cart Maps workflow pass on
software, WebGL2 and WebGPU, including source/history navigation, ordinary
Save/Hot Resume, Scenario Lab cleanup and page reload.

Separately, keyboard/pointer interaction in the rebuilt standalone Studio opens
a Scene Editor member, opens its source and returns through Go Back. The viewed
product captures retain the selected member and its correct property controls;
there are no uncaught page errors or Studio API requests in that interaction.
This is visible product evidence, unlike the compiled workflow's model fixtures.
IDE typecheck, strict boundary audit, debug/release Studio builds and diff checks
also pass. These checks do not establish a whole-engine audit or native parity.

## Validation of geometry preparation and execution admission

The existing focused suites pass (99 cases), including retained property
measurement, inline drafts, Scene scrolling and assistant tool composition. A
stale test-fixture reference to the removed terminal was corrected to the actual
`RuntimeLuaEvaluation` owner; both IDE and test typechecks pass.

The full Studio workflow, isolated Scenario Lab test-runner workflow, Pietious
Cart Maps/reload and game-input/pause workflow pass on software, WebGL2 and
WebGPU. The physical retained-test stack can be expanded after `update` and
before the first paint. Rebuilding that same test with the old target-inspector
owner fails on this exact operation. The mutation is test-local, without an
unsafe product switch or edits to the running workspace owners.

Separately, keyboard/pointer interaction in the rebuilt standalone Studio was
used to inspect the actual ActionEffect value draft and source-details UI, an
AEM property draft and the ROM filter's applied results. The resulting product
captures were viewed, not merely generated. There were no uncaught page errors
or Studio API requests. Debug/release Studio builds, strict architecture-boundary
audit (zero issues) and diff checks pass. This closes these scoped view-owner
findings, not a native-runtime parity or whole-engine performance audit.

The ROM follow-up passes the existing focus/history workflow on software,
WebGL2 and WebGPU: typing, keyboard/menu Undo/Redo, Cut/Paste, reattachment,
map navigation, unchanged-frame projection and source/guest isolation. The
same workflow fails at ROM field-history ownership with the previous pane
injected only into a scratch test bundle. Rebuilt standalone UI captures were
also viewed before and after the correction; no uncaught errors or Studio API
requests occurred. The focused existing suites pass (42 cases).

Local batched projection measurements over the real BIOS, Nemesis and Pietious
asset, section and function lists range from 0.002 to 0.315 ms/query (largest
function list: 2,132 entries). This measures query projection, not a complete
host frame or native performance. Unchanged frames do not project again.

## Validation follows the physical terminal and native editor owners

The standalone workspace fixture still expected the deleted Lua-only console's
transcript, clipboard and automatic activation. Those expectations were removed;
the existing physical BIOS workflow remains the terminal gate. The fixture also
now uses AEM's existing Open Source action after opening its native editor,
rather than assuming every resource opens directly as source text. The BIOS
workflow no longer sends unnecessary `q` commands after non-modal HELP/REGS.
No product, terminal or runtime behavior changed in this validation correction.

Both standalone cases pass, including real browser quota failure/retry and
canonical YAML/AEM editing, Save and reload while offline, without Studio API
requests. The physical BIOS workflow passes on software, WebGL2 and WebGPU.
Separately, actual keyboard/pointer interaction in the rebuilt standalone
product runs HELP, REGS, LUA (`6 * 7` yielding `42`) and CONT. Those captures and
the native AEM/source, offline reload and failed-save UI captures were viewed.
No uncaught page errors occurred. Test typecheck, strict boundary audit and diff
checks pass; these checks are not native-runtime parity or whole-engine proof.

## Validation of transient focus lifetime

The closed-field crash was reproduced with keyboard/pointer input in the actual
standalone AEM editor. After the correction, palette cancellation, source
Undo/Redo and starting/committing a fresh inline edit work without that fault.
Those rebuilt product captures were viewed; no Studio API requests or uncaught
page errors occurred. The focused existing suites pass (125 cases). Injecting
the old property-edit or inspector-scroll owner into separate scratch test
bundles makes their respective focus-lifetime cases fail at the expected
operation, without changing production code.

The full compiled Studio, game-input/pause/rewind and physical BIOS-terminal
workflows pass on software, WebGL2 and WebGPU. Both standalone workspace cases
pass, including offline canonical-source edits, Save/reload and real browser
quota failure/retry. IDE/test typechecks, debug/release Studio builds, strict
boundary audit (zero issues) and diff checks pass. This is an IDE focus-owner
correction, not a native-runtime parity or whole-engine performance claim.

For the Rename follow-up, keyboard/pointer interaction in the rebuilt standalone
product reproduced the expired-context crash before the correction. Afterward,
palette cancellation returns to source input, source Undo works and explicit
Rename opens a fresh reference context. Those product captures were viewed;
there were no console exceptions, uncaught page errors or Studio API requests
in the corrected interaction. The existing focused suites pass (36 cases), as
do the full Studio workflows on software, WebGL2 and WebGPU, both typechecks,
debug/release Studio builds and the strict boundary audit. Injecting only the
previous Rename owner into a scratch workflow bundle fails at palette Escape
with the original `onDidInvalidate` error. Focus eligibility reads the retained
context only on focus transitions; no per-frame work or runtime change was added.

## Host exceptions and physical guest faults have separate owners

The two independently reproduced focus crashes also expose an existing diagnostic
ownership problem. `surfaceHostFrameError` formerly forwarded every host exception to
`handleLuaError`/`recordLuaError`, replacing its JavaScript stack with the guest's
current frames. A Rename `TypeError` therefore appeared at `vblank.wait` with
`HALT_UNTIL_IRQ`, even though the cartridge caused no exception. Physical guest
faults already enter through the separate supervisor fault-sequence owner.

That path is now removed, not wrapped or renamed. Host failure retains the
original JavaScript stack, logs it and automatically opens a transient Host Error
document. View: Host Error can reopen it while the failure is active. Its ordinary
scroll control handles arrows, paging, Home/End and pointer scrolling; clipboard
copies the original stack, independently of visual wrapping. Only stack, font or
width changes rebuild the text projection. There is no guest source identity,
synthetic Lua frame, new terminal or persisted host diagnostic.

The status bar owns a distinct failure slot, while the active pane receives the
remaining status bounds. It does not inspect an editor-input kind to decide which
failure to show. Normal status painting adds no rectangle allocation or extra
clip transition. Host failure still blocks execution and settles pending boot and
source operations with the original error. Accepted installation and physical
reset/restore clear admission; clearing a guest snapshot alone cannot do so. An
existing physical fault snapshot is not replaced by host exception presentation.

Tests that formerly manufactured a guest diagnostic from a plain host Error now
raise real CPU exceptions and publish the supervisor latches through minimal test
firmware, or use the ordinary suspended-stack reader. The machine and C++ core
are unchanged; these are IDE diagnostic and validation-owner corrections.

Production references read before implementation: VS Code's
[unexpected-error owner](https://github.com/microsoft/vscode/blob/main/src/vs/base/common/errors.ts),
[target-driven debug session](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugSession.ts)
[independent status entries](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/statusbar/statusbarPart.ts)
and [read-only wrapped output editor](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/output/browser/outputView.ts).

The focused existing suites pass (159 cases), as do IDE/test typechecks,
debug/release Studio builds and the strict boundary audit (zero issues). Actual
Studio, frame-recovery, execution-operation and boot-operation browser workflows
pass on software, WebGL2 and WebGPU.

Injecting only the previous Rename owner into a scratch product bundle reproduces
the original native TypeError through keyboard input. The Host Error document
shows its unchanged JavaScript stack; native copy, close, reopen and Reboot work.
Guest cycles remain frozen until recovery, without a guest fault or supervisor
publication. A 105-line native host stack also scrolls through arrows, paging,
Home/End and the mouse wheel, while clipboard retains the original text. Those
rebuilt product captures were viewed, including failure status on the source pane.

Separate scratch lifecycle checks confirm that pending boot/source receipts carry
the original exception object, and that a host failure above a real guest bus
fault retains that physical snapshot, its seven guest frames and its supervisor
sequence while showing the host document. Reboot recovers both. These standalone
checks produced no uncaught page errors or Studio API requests. Scratch injections
do not enter the shipped bundle. This validates the IDE error boundary, not native
parity, mobile canvas reflow or whole-engine performance.
