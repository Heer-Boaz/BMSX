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
the installed cartlib type index and selected hierarchy. It formats properties
only after execution/history invalidation, never on stationary paint. The
property widget updates values without stealing focus, resetting selection or
scroll, or remeasuring unchanged text. No guest tables or closures survive in
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
reconciliation uses the existing Actor Lab invalidation owner.

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

Steady-state callers: TS/C++ HostOverlayMenu input/render; TS Studio chrome
update/input/render; TS/C++ HostRewind.service replay loop and frame-boundary
lookups. No guest values, machine save format or second playback clock are
introduced. Labels are remeasured only on text/font changes. Native stepping
must consume recorded video boundaries, not seconds or nominal frame time.

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
