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

## Open: focus participates in execution policy

`RuntimeCartEditor.executionSuspended` uses
`inputFocus.target.guestInputBounds` to release the Workbench hold. This is
deliberate existing behavior, documented in the runtime-timeline contract and
checked by the real game-input conformance workflow; it is not an isolated
Terminal mistake. Restoring game focus can consequently change whether the
guest advances, although `InputFocusTarget` describes input routing.

Live inspector inputs additionally carry local `running` flags while
`HostExecutionControl` owns explicit pause and the scheduler consumes the final
hold. These flags release the automatic Workbench hold; they are not another
playback clock. Game focus cannot clear an explicit Requested pause. The verified
coupling is therefore automatic execution admission, not a demonstrated failure
of Pause. Replacing the focus branch with another pane flag would repeat the
ownership problem. A follow-up must establish one Workbench admission policy
for the live inspectors and Game panel, independently of input routing. It must
preserve the separate explicit transport, debugger/evaluation plans and rewind
review owners rather than merge them into another generic execution service.
VS Code's [debug session](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugSession.ts)
owns Continue/Pause operations separately from editor attachment and focus.

## Open: inspector painting still prepares interaction geometry

`BehaviorLensEditorPane.draw`, `ScenarioLabEditorPane.draw` and
`ScenarioTargetInspection.draw` still lay out inspector controls. Paint therefore
participates in preparing pointer targets. The existing controls already own
layout operations; their containing panes must publish geometry during update,
before input/rendering consumes it. Do not introduce another geometry cache,
generic view facade or repaint-triggered execution to repair this boundary.

## Boundaries that must remain

- Assistant and observed-conversation sessions outlive pane detachment; their
  existing session/input owners decide closure, not focus or rendering.
- The BIOS terminal is physical firmware state. Detaching its view suspends its
  existing plan; it does not synthesize CONT, restore state or create a host REPL.
- Debugger/agent evaluation is an explicit operation through the existing CPU
  and BIOS owners, not an alternative terminal or a replacement emulator.
- Source models and navigation bookmarks retain resource identity independently
  of the active code pane. Same-input navigation is not source installation.

The first correction changes no CPU instruction hook, guest representation or
per-frame observer. Validation distinguishes owner/lifecycle tests, compiled
Studio workflows and visible product interaction; none closes the open slices.

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
