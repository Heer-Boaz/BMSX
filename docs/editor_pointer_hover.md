# Routed pointer hover (A09)

## Owner contract

`PointerHoverService` owns the current routed hover path. Each host pointer
dispatch begins a generation; controls mark themselves only at an accepted hit
on the existing input route. The dispatch ends by delivering leave to previously
hovered targets not visited this generation, including early returns for capture,
chrome, panels and exclusive popups. No second geometry tree or synthetic pointer
snapshot is involved. Optional enter is delivered once per admission; leave only
revokes pointer feedback, not keyboard selection, focus or a captured gesture.

Controls release hover before detaching their input or hiding. Editor shutdown
clears the path even when no subsequent pointer poll will run. Hover ownership is
independent of `PointerCaptureService` and `InputFocusService`.

## Production reference

Qt Quick's `QQuickDeliveryAgentPrivate::deliverHoverEvent` retains hovered items,
marks the actual hit traversal with a generation, and sends leave to unvisited
items. `deliverHoverEventToItem` distinguishes enter/move/leave; a leave does not
consume propagation. Reference inspected before implementation:
[Qt delivery agent, lines 1134–1188 and 1288–1337](https://github.com/qt/qtdeclarative/blob/0890fc6e9b1fd1445267028dd4c9d3b2364bdb60/src/quick/util/qquickdeliveryagent.cpp#L1134-L1188).

BMSX uses its existing ordered, manually hit-tested control dispatch rather than
copying Qt's scene tree. A retained map of control identities and bound sweep
callbacks avoids a per-poll path array, callback closure or event object. Work is
proportional to the actual hovered route, not the number of workspace controls.

## Integrated boundaries

- `dispatch.ts` begins/finishes the hover phase around every return, including
  captured delivery. The phase does not catch exceptions or synthesize input.
- Action bars, graphs, property trees/inspectors, Scenario/Scene lists, the
  resource/Problems panels, quick input, inline search, tabs and code feedback
  publish only hits accepted by their actual input route. Menu **selection** is
  not hover state and is not cleared by leave. The older menu bar now excludes
  lower pointer routing while open; its click-to-close contract is unchanged.
- Code contribution detach also releases runtime-error hover. The existing
  active-error setter leaves before replacing the overlay; direct assignments
  in non-code panes have been removed. Hide/shutdown do not wait for a poll.
- Reusable controls receive the service explicitly, alongside their existing
  focus/capture services. No service bag, hit-test registry, guest pointer state,
  compiler ABI or C++ runtime representation is introduced.

## Executed evidence (2026-09-11)

- Enter once, move retains membership, leave once; nested hits, explicit detach,
  and synchronous removal from notification callbacks.
- Action bars, graph hover and list/inspector feedback lose hover when a higher
  route consumes input. A captured drag and keyboard selection survive leave.
- Actual Studio: Source button → Problems/chrome/popup without clicking; canvas
  leave and editor hide; source navigation and the existing Undo/Hot Resume gates.
- Nine new independent unit cases cover the service, actual action/graph/tree/
  inspector controls and error-overlay replacement. Full Lua suite: 1535 pass,
  one existing skip, no failures. IDE typecheck passes; tests typecheck retains
  the exact 51-error baseline. Architecture/parity/indent/diff gates and the
  browser product build pass.
- The actual Studio case added to the independent scene-viewport fixture fails
  on `178357311` at Source → Problems, not at a new API or mock. It passes in
  software, WebGL2 and WebGPU, with both fonts and an actual command palette,
  menu, outside-canvas pointer and editor deactivation. Existing source/Undo/
  Hot Resume workflows and Pietious navigation remain the broader live gates.
- The final software image was inspected alongside the previous committed
  image. This is not a claim that every existing visual issue is solved: the
  pre-existing Problems-row overlap in this short-viewport image is unchanged.
  Menu-bar keyboard/navigation convergence is also not claimed by this slice.

## Cost boundary

`profile_pointer_hover.ts` uses retained targets and 100,000-poll batches,
10 warmups/25 measured batches; three isolated Node processes, no concurrent
browser or typecheck. Median microseconds per stationary poll across runs:

| Route | Microseconds/poll |
| --- | ---: |
| One target | 0.0103 |
| Four nested targets | 0.0334 |
| Sixteen nested targets | 0.1293 |
| Actual action-bar hit + complete hover phase | 0.0140 |

Each stationary target receives exactly one enter, and one leave on teardown,
not repeated notifications. The new owner retains one map and bound callbacks;
it creates no per-poll path array, closure or pointer event. Map membership is
changed on actual entry/leave. This is an absolute, warmed microbenchmark, **not**
a before/after speedup, full host-frame/GC measurement or SNES Mini evidence. It
excludes physical input sampling, existing snapshot creation, layout, semantic
queries, guest execution and drawing. Artifacts: `/tmp/bmsx-pointer-hover/`.
