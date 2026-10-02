# Shared runtime timeline

The host rewind timeline is the runtime transport, not a collection of
per-module playback buttons. Studio docks the same retained view above its
status bar while a runtime inspection editor is active. Authoring/test actions
remain in the editor. Actor/ActionEffect program timelines are guest timelines,
not substitutes for the machine history.

In a live inspector this is navigation through recorded machine state, not a
claim that the game image is visible. Game View shows that image; Actor Lab
already pairs its inspection with a game preview. The optional Game panel pairs
any other editor with that same completed scanout. Source-only editors and chat
do not reserve space for the runtime transport.

## Game panel and live behavior inspection

The workbench owns the right-hand Game panel and its resizable content inset.
Tabs, menus, status and the single runtime timeline remain full width. Physical
viewport dimensions and pointer coordinates do not change. The workbench
publishes content bounds through the editor group to its active pane; child
layouts and Find result details consume those bounds, not physical canvas width.
Painting consumes prepared layout. The panel does not open a second editor group,
execute the guest, capture an image or own a playback clock. Game View and Actor
Lab already display scanout, so the workbench suppresses the extra panel there
without discarding the user's layout choice. View / Toggle Game Panel is the
workbench action, not a permanent button in each module editor.

This follows the content-only right inset in
[VS Code EditorPart](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorPart.ts)
and the separate display/execution ownership of
[Godot GameView](https://github.com/godotengine/godot/blob/4.4/editor/plugins/game_view_plugin.cpp).
The split uses the existing workbench sash and common aspect-correct game-frame
layout. Minimum sizes keep its sash from crushing either view. When the canvas
cannot accommodate both, the editor keeps the space; widening restores the
retained panel choice. It is session layout, not part of the authored cart or
guest save state. Behavior source editors keep Source, Live and More as primary
actions; secondary commands use their existing context-menu owner, following
[VS Code WorkbenchToolBar](https://github.com/microsoft/vscode/blob/main/src/vs/platform/actions/browser/toolbar.ts).

A live FSM, BT or ActionEffect inspector retains only selected table hash ids
and its resource domain. Each suspended update reacquires that instance through
the installed cartlib type index and selected hierarchy. Its retained property
document rereads mutable fields after execution/history invalidation, never on
stationary paint. Value presentation retains typed scalar inputs and the actual
visible stored-entry sequence, not borrowed tables or an assumption that equal
table ids imply equal contents. Unchanged values reuse their text and rows;
definition/topology changes update the same document. Callback correspondence
is keyed by the current address/bus and installed source metadata, not closure
allocation identity. Empty cartridge sockets remain unmapped. The property
widget receives changed documents without stealing focus, resetting selection
or scroll, or remeasuring unchanged text. No guest tables or closures survive in
the retained selection. Registered-definition/source inspection remains a
snapshot, not a pretend live instance.

Heap replacement retires a selection. A restore that no longer contains the
instance retires it before a new branch can reuse discarded identities; replay
seeking itself is not a branch. The inspector reports this explicitly rather
than silently selecting another actor. Closing or switching away disposes the
live session and restores the ordinary authoring pause hold. Transport commands
are available only within live inspection, and use existing finite frame
navigation and host rewind.

References: [Blender timeline controls](https://github.com/blender/blender/blob/main/scripts/startup/bl_ui/space_time.py),
[VS Code debug toolbar](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugToolBar.ts),
[VS Code tab strip](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts).
Timeline track/position colors belong to the central theme definition, following
the semantic component-color ownership in the
[VS Code color registry](https://github.com/microsoft/vscode/blob/main/src/vs/platform/theme/common/colors/baseColors.ts),
not a borrowed tab foreground that can equal the timeline background.

## Live FSM instance graph

Actor Lab's **Show Live FSM Graph** command opens the selected physical machine,
or the machine owning a selected state. It is a hierarchy of actual instances,
not the authored transition diagram. The existing Actor tree supplies class
membership, child order and activity. Green side stripes mark its stored active
path, including concurrent children and ancestor/owner admission; keyboard and
pointer selection have a separate border/background. Neither indicator proves
that a callback has completed or a future transition guard will pass.

The graph bookmark uses the existing typed Actor target path. After execution
or history restore, Actor Lab reacquires membership before copying scalar
identities, labels and activity. No table, closure or borrowed Actor node enters
the retained graph. Missing/renamed membership and heap replacement explicitly
retire it; the user selects again through the Actor tree. Hidden-pane branch
reconciliation uses the suspended guest's explicit history-resume boundary.

Geometry, edge routes, viewport, pan and zoom use the shared workbench graph
controls, including Ctrl-wheel anchored zoom and Shift-wheel horizontal pan.
Activity-only updates change booleans, not measurements or layout.
Topology/font changes relayout and rematch the selected node or relationship by
physical identity. Details and method/action commands resolve through the same
fresh Actor tree, without adding a second inspector or execution service. Back
and Details are the primary actions; graph opening and zoom stay in the command
palette/context menu. The graph, title actions, sash and guest timeline slider
use an explicit command context without replacing their keyboard handlers.
Toolbar enablement and invocation both carry that context independently of
keyboard focus, as in the
[VS Code toolbar](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/toolbar/toolbar.ts).
Clicking a runtime action does not first blur a field to manufacture the correct
target. Normal draft admission remains with the focused editor. The action
control publishes retained enablement; painting does not resolve commands again.
The existing game preview and the one machine-history transport remain beside
and below the graph.

Reference implementations separate runtime instance identities from source
graphs: [LimboAI's debugger](https://github.com/limbonaut/limboai/blob/master/editor/debugger/limbo_debugger_plugin.cpp)
and [retained runtime tree viewer](https://github.com/limbonaut/limboai/blob/master/editor/debugger/behavior_tree_view.cpp),
and [BehaviorTree.CPP's Groot2 publisher](https://github.com/BehaviorTree/BehaviorTree.CPP/blob/master/src/loggers/groot2_publisher.cpp).
Here, ordinary BT compilation lowers authored nodes into evaluator closures and
compiler-owned execution slots. The optional test compilation recorder records
lowering occurrences, not runtime status or proven authored-source provenance.
BT source-node highlights therefore need explicit compilation metadata; source
names, closures or slot indices are not a substitute. This slice does not change
BT compilation or claim that mapping exists.

## Representation and callers (before mirrored edits)

| Representation | TypeScript | C++ | Owner |
| --- | --- | --- | --- |
| Earliest/latest/position, CPU rate | integer-valued cycles, number | i64 | runtime history/scheduler |
| Playback state | status union | TimelineStatus enum | host execution/rewind |
| Action admission | bit mask | u32 bit mask | host menu or Studio commands |
| Recorded frame boundaries | InputJournal sequence/cycles | i64 sequence/cycles | runtime input journal |
| Finite forward replay | Step request + target video tick | Step request + i64 target video tick | HostRewind |
| Labels, rectangles, hit regions | retained submissions/rectangles | fixed arrays/submissions | passive timeline view |
| Glyph metrics | BFont reference | BitmapFont pointer | host font |
| Before recording resumes | optional () => void | optional std::function<void()> | RuntimeHistory, host observer |

Steady-state callers: TS/C++ HostOverlayMenu input/render; TS Studio chrome
update/input/render; TS/C++ HostRewind.service replay loop and frame-boundary
lookups. No guest values, machine save format or second playback clock are
introduced. Labels are remeasured only on text/font changes. Native stepping
must consume recorded video boundaries, not seconds or nominal frame time.

The history-resume observer runs once in `resumeRecording`, before truncation
and new live execution, not in instruction, render or input-sampling hot paths.
Production callers are `hosts/common/rewind.ts` and `hosts/libretro/rewind.cpp`'s
Resume service. Matching callers in TS/C++ frame-scheduler tests and the two
runtime-replay conformance runners exercise pressure, rejoin and takeover.
No save-state field or VM identity changes. Studio composition forwards this
physical boundary to `SuspendedGuestSession`; hidden domain views reconcile
their own bookmarks before discarded identities can be reused. Replay/seek
invalidations alone do not admit a branch. Listeners on retained program inputs
end at input disposal; branch admission does not scan the tab group.

## Boundaries

The timeline view consumes published cycles and admission state. It does not
import Runtime, HostRewind, host-menu composition or a frame loop. Studio retains
its existing focus, captured slider/action input and RuntimeFrameNavigation
completion/arbitration. A scrub retains one latest target, not a queue of pointer
samples. Leaving the inspection scope revokes its gesture and owned operation.

Native uses its existing gamepad/pointer owner. Play preserves recorded future;
resume-from-here is an explicit branch, and returning to the present is separate.
The paused/read-only views do not imply permission to execute. History remains
usable without Studio or a server. Hot Resume relocation is out of scope.

## Validation

- Real TS host, WebGPU browser host, native host and libretro ABI rewind runs
  passed with Nemesis media. The host probes exercise repeated adjacent video
  frames backward/forward and retain the recorded future; forward clicks do not
  repeatedly restore a checkpoint.
- An actual Studio browser session used keyboard frame steps from the live
  Input Bindings inspector (829 -> 830 -> 829), pointer scrub, play/pause and
  return to present. Inspector scope remained active and recorded history was
  retained. Game View and the existing Actor Lab preview were visually checked.
- Tab overflow was exercised with a large font and a narrow viewport, including
  manual scrolling and choosing an editor from the searchable overflow list.
  Source and Terminal views had no runtime transport. Visual inspection caught
  timeline hover and dark-theme track contrast defects; the themed highlight
  and central track/position palette were corrected.
- Focused unit checks, TS project builds, native libretro builds and architecture
  and parity audits passed. These are separate from the live/visual evidence;
  performance on physical SNES Mini hardware was not measured.

### Game panel follow-through (2026-10-02)

- In a real WebGPU Studio window, the FSM inspector stayed attached while
  Studio MCP stepped 1410 -> 1350 -> 1410. Keyboard stepping then used the
  same transport. An Actor tool transitioned its actual machine from `rest`
  to `moving`; the open inspector refreshed the selected property without
  reopening. This mutation starts a new history recording: the check does
  not claim rewind across a tool mutation.
- BT readback stayed open across 4593 -> 4623 -> 4593. ActionEffect readback
  refreshed gameplay time through keyboard navigation and MCP 127 -> 142 ->
  127. Those requests awaited physical video-boundary completion, not command
  acceptance. No screenshot was used to determine runtime state.
- Visible UI checks exercised pointer/keyboard sash resizing, minimum editor
  width, source wrapping and Find bounds, theme/font changes, game-frame focus,
  closing the panel and returning keyboard selection to the inspector. The
  shared property renderer's unselected headings used a content foreground on
  a chrome background and disappeared in the dark theme; they now consume the
  matching header foreground. The source-toolbar overflow found in the split
  view was resolved with primary Source/Live/More and existing secondary menus;
  test/input-binding actions remain available there.
- 65 focused ownership/control checks passed, including real guest snapshot
  identity reacquisition and rejection of discarded-future id reuse. IDE
  typecheck, browser Studio build, architecture-boundary and core-parity audits
  passed. This follow-through changes Studio only: no native execution/history,
  guest save format, server endpoint or second playback engine was added.

The game panel does not map optimized BT execution slots onto authored graph
nodes. Live instance properties and source diagrams remain distinct surfaces.
The existing fixed logical canvas still limits mobile presentation; browser
resizing alone scales that canvas rather than creating a responsive DOM IDE.

### Live-readback ownership correction (2026-10-02)

Live instance resolution now returns borrowed runtime records, not QuickPick
presentation. Pickers alone construct their labels/descriptions. The property
document retains rows, value formatting and installed callback correspondence;
it still reads the actual mutable definition, blackboard layout and nested
preview entries on each admitted update. Preview limits are the existing
debugger display limits, not a new runtime/query cap. Suspended guest scratch
slots end their borrow before returning. A hidden Actor tree releases its
borrows once per acquisition, not by recursively traversing an already released
tree on every subsequent execution invalidation.

This uses the retained-update boundary illustrated by
[LimboAI's runtime tree viewer](https://github.com/limbonaut/limboai/blob/master/editor/debugger/behavior_tree_view.cpp),
without importing its immutable-tree assumption or a refresh throttle.

- Compiled guest checks performed 1,000 unchanged invalidation/readback updates:
  authoritative fields were reread, rows retained their identity, no value text
  was reformatted, and guest heap usage/scheduler cycles did not change. Mutable
  nested entries, preview ellipsis, typed keys and definition topology were also
  changed and read back. This measures specific repeated work, not frame rate
  or total host allocations.
- Callback correspondence was checked at O0 and O3, including a changed call
  target on the same closure, replaced installed media and an empty cartridge
  socket. Hidden Actor borrow release was exercised across 1,000 invalidations
  and reacquisition. These are data/lifetime checks, not exact UI-text contracts.
- A real WebGPU Studio session left the FSM inspector open during a completed
  Actor `transition_to('/moving')` call. It visibly changed `rest` to `moving`;
  fresh Actor-tree readback confirmed their changed activity. Physical tool
  completions then navigated 91 -> 97 -> 93 -> 95 without reopening. BT stayed
  attached through 95 -> 125 -> 95. ActionEffect stayed attached through
  96 -> 111 -> 96; its displayed gameplay time changed and returned to 884.224,
  also confirmed by fresh stored-value readback. Pointer previous/next retained
  the scrolled document; the game panel and callback-source rows remained
  readable. Screenshots verified presentation, not physical stepping completion.
- The final browser build was reloaded and initialized through the real frame
  tool, then checked again at 103 -> 113 -> 103 and pointer Play/Pause. The live
  inspector remained in Studio. The full Lua suite passed 2,894 checks (one
  skipped), separately from IDE typecheck, boundary/parity audits and browser
  build. Native replay evidence remains in the history-lifetime section above;
  no claim is made about every renderer backend or physical-device performance.

### Workbench boundary correction (2026-10-02)

- A real browser session opened Actor Lab's FSM graph and Details, then clicked
  Next frame and Play. Execution stayed in Actor Lab instead of switching to Game
  or closing Studio. Details still closes on execution, as its snapshot lifetime
  requires; the retained graph remains the runtime command target.
- Global Find with the Game panel open displayed both result line numbers
  (`:45`, `:69`) inside the editor content bounds. The actual panel, source
  wrapping and result clipping were checked visually, not inferred from tests.
- Focused action, pane and layout checks passed separately from those visible
  checks. These changes add no machine/history representation or playback loop.

### History lifetime correction (2026-10-02)

- TS/C++ frame-scheduler checks verified that the resume observer sees the
  suspended review position and retained future before takeover. The live
  inspection check restored a pre-birth heap, reconciled its hidden bookmark,
  and rejected the new branch's actual reuse of that allocation identity.
- Real-cart runtime replay/history cross-core conformance, TS/native HostRewind
  and libretro rewind/menu-pause ABI checks passed with Nemesis media. This is
  physical replay evidence, not proof of every Studio editor or physical-device
  performance.

### Live FSM graph follow-through (2026-10-02)

- Actual Studio MCP execution called the discovered machine `transition_to`
  method and awaited completion. Fresh Actor tree readback confirmed `rest`
  inactive and `moving` active; the already-open graph changed stripes without
  reopening. This call starts a new recording, not rewind across a mutation.
- Physical frame-navigation completions were 205 -> 235 -> 215 after the call.
  A separate fresh browser load exercised 1850 -> 1838 -> 1850
  through MCP and adjacent keyboard forward/back steps. The open graph retained
  its selection and the shared history review stayed available.
- Visible checks covered node Details/Back, command and Ctrl-wheel graph zoom,
  Shift-wheel pan, sash dragging, font and
  light/dark themes, and switching away with Details open before returning to
  the graph. Sash focus originally disabled the graph's primary actions; the
  pane now binds the sash and slider's explicit action context to the current
  presentation. Graph card text uses the foreground belonging to its header
  background, including in the dark theme.
- 108 focused checks passed. The graph checks exercise compiled guest activity,
  concurrent children, snapshot identity reacquisition, renamed membership,
  retained geometry/selection and zero extra font measurements during ordinary
  activity changes. Two memberships of the same physical state remain distinct
  selections; target correspondence uses typed keys and ancestry, not a hash id
  alone. IDE typecheck, browser Studio build, architecture-boundary
  and core-parity audits passed. These changes affect Studio presentation only;
  they add no guest values, save-state representation, native execution changes
  or independent history engine.

### Compact rewind interaction (2026-10-02)

The host transport shows only a track, its selected offset, OK and Back. Accept
(A / Enter / numpad Enter) resumes live recording from the selected point;
Cancel (B / Escape) rejoins the retained present. Preview (X / Space) never
implicitly accepts a selection. Left/Right seek seconds; LB/RB step recorded
video boundaries. These physical keyboard bindings belong to active host menus,
not the guest's configurable controller map. Held entry inputs are blocked until
release. A menu transition revokes capture and repeat edges, but does not invent
physical pointer movement. Dragged targets use the existing latest-intent seek.
Device hints change on actual input activity, without shifting a pressed target.

Studio keeps compact previous-frame, play/pause and next-frame actions. OK/Back
appear only during review. OK uses `runtime.resume` and the live pane's command
context: it releases that pane's inspection hold and resumes at the chosen point
without closing Studio. Back uses the existing `HostRewind.returnToPresent`
cancellation path, retains Requested pause, and ends review at the recorded end.
It is not a second finite seek left in review. Source/chat editors do not acquire
these controls or free-running permission. Normal workbench focus navigation
and action activation remain in the shared action-bar owner.

References examined before this interaction change:

- [Konami's Dominus rewind screen](https://www.konami.com/products_master/eu_publish/castlevania_dc/eu/es/images/rewind.jpg):
  track, position, A OK / B Cancel; no second confirmation page.
- [MAME menu.cpp](https://github.com/mamedev/mame/blob/master/src/frontend/mame/ui/menu.cpp):
  semantic select/back, exclusive input edges and menu-lifetime reset.
- [Godot InputMap](https://github.com/godotengine/godot/blob/master/core/input/input_map.cpp):
  physical UI accept/cancel bindings separate from game actions.
- [VS Code toolbar](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/toolbar/toolbar.ts):
  primary and secondary actions have separate presentation.

The mirrored representation remains physical keys/HID usages, existing u32
button/edge words, a retained input-source enum, capture target ids, cycle
coordinates, action masks and fixed label/rectangle arrays. Affected hot-path
callers are HostUiInput update/consume, host-menu input/render, passive timeline
layout, and Studio timeline update/input/draw. No machine instruction work,
save-state fields, independent clock, per-frame buffer construction or additional
capture cadence is introduced. Text is measured only on text/font changes.

Interaction validation:

- Real product browser + Studio MCP: Actor Lab stayed open across 3451 -> 3421.
  Pointer Back returned to 3451, ended review and kept Requested pause. OK after
  a fresh 30-frame rewind resumed live execution (observed 3474). A later preview
  advanced 7005 -> 7019 without changing the retained recorded end. Physical
  Enter/Escape were also exercised in the host overlay, including held entry
  Enter. Light/dark Studio, a narrower canvas, native overlay and browser host
  presentation were inspected visually; tool observations, not screenshots,
  determined execution/history state.
- `test:runtime-replay` passes real Nemesis/preload TS/C++ state comparison, host
  input/review/branch and libretro ABI runs. The WebGPU browser rewind run passes
  complete restored VRAM comparison. Input-routing checks pass in both hosts;
  Lua suite passes 2895 with one existing skip, and nine runtime/frame/actor tool
  integration checks pass. Boot command workflows pass on software/WebGL2/WebGPU.
- IDE typecheck, browser Studio/player and native libretro product builds,
  strict architecture boundaries, core parity and `git diff --check` pass.
  This is functional/layout evidence, not physical Mini timing evidence.
- The broad Studio workflow remains blocked outside this slice at
  `testAemSourceApplication`: it opens the default AEM editor but reads
  `activeCodeEditor.model`. The resolver already selected `AemEditorInput` before
  this change. No fallback editor or fake document was added to pass that probe.
  Repository-wide indentation also reports existing untouched cart/test/cJSON
  files, not this patch's files.
