# Shared runtime timeline

The host rewind timeline is the runtime transport, not a collection of
per-module playback buttons. Studio docks the same retained view above its
status bar while a runtime inspection editor is active. Authoring/test actions
remain in the editor. Actor/ActionEffect program timelines are guest timelines,
not substitutes for the machine history.

In a live inspector this is navigation through recorded machine state, not a
claim that the game image is visible. Game View shows that image; Actor Lab
already pairs its inspection with a game preview. A general split/docking layout
for an arbitrary FSM/BT editor next to Game View is separate work. Source-only
editors and chat do not reserve space for this transport.

References: [Blender timeline controls](https://github.com/blender/blender/blob/main/scripts/startup/bl_ui/space_time.py),
[VS Code debug toolbar](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugToolBar.ts),
[VS Code tab strip](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts).
Timeline track/position colors belong to the central theme definition, following
the semantic component-color ownership in the
[VS Code color registry](https://github.com/microsoft/vscode/blob/main/src/vs/platform/theme/common/colors/baseColors.ts),
not a borrowed tab foreground that can equal the timeline background.

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
