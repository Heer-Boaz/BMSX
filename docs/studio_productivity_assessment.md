# Studio productivity assessment — 2026-09-30

Scope: the cart-development workflow, not certification of every IDE feature,
browser, native host or device. Initial assessment revision: `0b4233368`
(including the guest-call completion fix in `14ba70a72`). The initial assessment
added no product code; subsequent authoring/navigation changes and their
separate verification are recorded in the follow-up section below.

## Verdict

Studio adds substantial value as an instrumented game-development environment.
The useful difference from a shell/editor is access to the actual paused machine:
stored values, source stops, living actors, isolated scenarios and recorded time.
It replaces guessing from game screenshots with observations of game state.

The complete authoring loop is usable, but not yet frictionless for an agent.
It still mixes domain tools with browser input for several project operations.
This is not an argument for replacing the existing editor, scheduler or history
owners, or making a second agent-only workbench.

## Live evidence

The ordinary development server, real Studio pages and official MCP SDK were
used. Browser keyboard/pointer actions operated the visible UI. No private
browser runtime access, guest heap injection or screenshot-based gameplay loop
was used. Screenshots were opened to check UI/artwork, not infer ball movement.

| Capability | Observed result |
| --- | --- |
| Empty cart to working game | [Bricklane](../carts/bricklane/README.md): UI-created project, source proposals, visible Apply/Save, source Reboot, lint rejection and correction, full build and published-window opening |
| Gameplay investigation | Actual keyboard controls won the published game with six bricks cleared and three lives retained; restart reset the game |
| Frame/history navigation | Rewound and replayed brick collision, life loss, game over and winning; ten pairs matched the observed game/ball/brick fields and machine cycles |
| Terminal and source debugger | Read cart globals and an actual frame local; eight consecutive frame evaluations followed immediately by Step Over completed after the completion-boundary fix |
| Scenario execution | Discovered 29 Nemesis cases; ran `movement_uses_speed_table_and_opposed_inputs` normally and in debug mode; both passed |
| Test debugger | Bound line 9 in the actual compiled test source, continued to the breakpoint, read `player` from its frame and inspected `x = 80`, `y = 60`; Step Over stopped before continuing to completion |
| Test isolation | The authoring machine stayed at cycle `1797685027` throughout the normal/debug test work |
| Actor Lab | Inspected the living director, its components and FSM; discovered and invoked the title state's ordinary `transition_to` action; fresh inspection showed `story` inactive and `title` active |
| Render observation | After the actor call, explicitly advanced 30 frames; the capture's published and observed position both named tick 2670 / cycle `1818242847`; the ordinary Actor Lab preview showed the title screen |
| Behavior Lens | Discovered 32 authored FSM/BT/effect registrations and read the intro FSM's states, entries, transitions and source ranges; partial callback resolution remained explicit |

The new Nemesis checks did not change authored source. A mistargeted browser
shortcut initially typed into a source editor; ordinary Undo removed that input,
and the visible document returned to clean / SOURCE APPLIED before proceeding.
That was an agent-input error, not proof of an editor defect.

The Scenario Lab UI was inspected while stopped and after completion. Its toolbar
and status reflected the tool-owned debug run. Selecting the actual case exposed
the normal/debug results. Actor Lab's visible state indicator agreed with the
fresh structured inspection. Long nested identifiers were frequently truncated
in the fixed-width panes; these observations do not establish a polished mobile
layout or accessibility acceptance.

Local evidence: `.bmsx/authoring/bricklane-20260930/`, especially `actions.jsonl`,
`states.jsonl`, `verified-navigation.json`, `completion-sequence.jsonl`,
`productivity-evidence.json`, `scenario-live-*-ui.png` and
`actor-director-published-ui.png`. The earlier Bricklane record identifies its
exact artifact. Evidence files are ignored, not application dependencies.

## Automated evidence and failures

The additional run used the existing actor-inspection, behavior-source, program
lifecycle, test-execution, test-debugger and test-inspection browser suites on
software, WebGL2 and WebGPU: **15 passed, 3 failed**.

All three failures are the behavior-source workflow's old combined invariant
that applying a review never saves (`studio_assistant_behavior.ts:71-72`). The
current ordinary review owner explicitly saves after Apply
(`contrib/edit_review/editor_pane.ts`), as do its UI text and tool contract. The
same obsolete expectation was already recorded in [MCP validation](studio_mcp.md#validation).
It was not removed or relaxed to report green results. Because those cases stop
at this check, this run does not certify their later BT/effect edit sequences.

The separate program-lifecycle workflow passed on all three backends: failing
scenario, reviewed source correction, persistence, installed-source inspection,
Reboot, execution, completed game capture and unchanged-scenario rerun. These
suites use real browsers and runtime owners with a deterministic model fixture;
they do not prove paid-model inference or replace the live authoring exercise.

The preceding completion fix additionally passed 55 lifecycle/debugger checks
and 12 browser execution workflows. Those counts are separate runs, not a claim
that the entire repository suite is green. Full C++ parity, login, clipboard,
standalone, reconnection and physical-phone acceptance were not rerun in this
assessment. Their earlier records remain separate evidence.

## Follow-up implementation and live verification

The next slice addresses authoring/navigation, not a second input, watch or
execution system. The initial gap inventory below is historical; these parts
have now been implemented through the existing owners:

| Operation | Owner and observed result |
| --- | --- |
| `studio_propose_source` | Exclusive creation through ordinary edit review. `keyboard_assert.lua` did not exist before approval; visible Apply created/saved it and opened the shared working copy. Discovery immediately found its declared case. |
| Scenario reproduction | The first live attempt exposed missing testlib in a cart built without tests. The ROM producer now includes source-only test infrastructure in debug media and handles cart-local suites consistently. After a real build, the new physical keyboard scenario passed at tick 14 while the authoring machine stayed at cycle `3172263153`. |
| `studio_hot_resume` | A reviewed temporary speed change (4 to 5) was installed through the ordinary supervisor-return/init path. Actual completion and installed source were read back. `ready`, tick 4609, paddle x 136, score 0 and lives 3 were unchanged; the target stayed paused. Source was restored through another approved review and Hot Resume. An init breakpoint visibly paused line 19; the operation was correctly still incomplete. Continue stopped at the physical control boundary and completed that operation. A fresh, freely running target was also paused by Hot Resume and remained at cycle `10396912119` after init completion. |
| `studio_open_build` | A completed build request opened its exact immutable cart/BIOS pair in another real Studio page. Navigation acknowledgement is not a boot receipt: the new page was separately observed via `studio_list_sessions`. |
| Run navigation | `studio_reveal_test_run` and **Scenario Lab: Reveal Active or Latest Run** selected the requested retained run and expanded its case ancestry. Routine result updates do not change the user's selection. |
| Window and pane identity | The two windows identify `carts/nemesis_s` and `carts/bricklane [opened <artifact>]`. “Opened” identifies origin, not proof of current installed-source equality after editing. Shared captured sashes resize Actor/Scenario panes by pointer or focused arrows/Home. Actual drags and keyboard resizing were inspected; the selected actor's full identifier is in the footer. |

Source reads, review approval, Save, build publication, navigation, installation,
init completion and scenario completion are still distinct operations. The
published opener reports browser denial explicitly, does not silently retry,
and severs the new window's opener before navigation. Standalone Studio has no
workspace-build opener and reports that capability as unavailable.

The relevant node/owner suites pass **144 checks**, including production of a
debug cart with no tests, workspace creation/execution of its first suite, and
debug/release repacking. The browser behavior-source, program-lifecycle and test
debugger workflows pass **9/9** across software, WebGL2 and WebGPU. The
published-build observation suite also passes **2/2**, including real browser
policy denial and an allowed pointer gesture opening an exact-artifact page
with a severed opener. These checks do not certify every browser's popup settings.
The old behavior-source check described above now separately verifies that Apply leaves
the machine unchanged and Save persists the approved source; it no longer
contradicts the actual review owner. These are functional/state checks, not
exact presentation-string contracts. IDE/browser/Node typechecks and the strict
boundary audit pass; repository-wide test typechecking still has unrelated
diagnostics and is not claimed clean. No paid model, native UI or physical phone
was used for this follow-up.

The production references studied before this slice were VS Code's
[bulk file creation](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/bulkEdit/browser/bulkFileEdits.ts),
[window title owner](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/titlebar/windowTitle.ts),
[explicit test-result reveal](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/testing/browser/testingExplorerView.ts),
[shared sash lifecycle](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/sash/sash.ts)
and [browser open failure handling](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/host/browser/browserHostService.ts).
BMSX reuses its own model/history, capture/focus, execution and build owners;
it does not import VS Code's service framework. Geometry/projection work occurs
on layout/source revisions, not by rebuilding actor/test rows on every drag tick.

Evidence is appended to `actions.jsonl`; visible checks are the `followup-*`
images in the existing local evidence directory. The Scenario-enabled published
artifact is `a85e5e7c3b89276366cef07ec056854dd058cf76ee2e8bf1ed0240ece3eceb0a`.

## Initial gap inventory and remaining direction

These priorities come from the observed workflow and current public tool catalog,
not assumptions that existing UI features are absent.

1. **Input and reusable reproductions belong in Scenario Lab.** Studio can advance exact
   frames, but the current tools cannot hold/release game controls at specified
   frame boundaries. Bricklane required browser key-down, a separate step call,
   then key-up. Scenario Lab already offers `press`, `down`, `up`, waits,
   assertions and logs on isolated targets. The new Bricklane suite uses these
   operations directly. This does not justify building a parallel input player
   on the authoring target.

2. **Focused observation and reusable reproductions.** Table pagination works,
   but repeatedly following globals → table → nested tables dominates simple
   questions such as “what changed in this collision?”. Terminal already executes
   Lua against real cart globals and debugger locals; Scenario cases can retain
   before/after observations and assert differences. Reuse those capabilities
   first. Persistent read-only historical watches/diffs would be a distinct
   evidence feature, not another Lua evaluator;
   inspections expire on execution and Terminal/actor calls clear prior retained
   history at the mutation boundary. Preserve those truthful lifetimes, do not keep stale table handles or
   evaluate arbitrary Lua on every frame as a shortcut. Frame/cycle seek already
   exists; the missing part is convenient, retained evidence and comparisons.

3. **Complete the tool surface of existing authoring operations.** New-source
   review, ordinary Hot Resume and explicit opening of a published build are now
   exposed, as recorded above. Reboot is exposed
   and is deliberately not Hot Resume. Source search/ranged reads would also
   avoid transferring whole catalogs/files for a small edit. Keep review approval,
   Save, compilation, installation and reset distinct rather than making a
   misleading “do everything” success receipt.

4. **Make the active work easier to locate.** Cart/artifact titles, explicit run
   reveal and shared pane resizing are now implemented and visibly checked.
   Mobile sizing, full accessibility and identifiers wider than the entire
   viewport are not certified by these desktop checks. Run reveal requires the
   run to be retained and its selection to remain in the current test catalog.

5. **Close reliability and verification gaps before expanding the surface.**
   The third concurrent Studio window stalled at `navigator.gpu.requestAdapter`
   in this Chromium/SwiftShader environment. The stall is now also reproduced
   by three standalone WebGPU pages with sustained rendering and no BMSX code.
   Stopping the first two pages' rendering released the third adapter request;
   see the [browser reliability investigation](#multi-window-browser-reliability-investigation).
   This is not an established window-count limit or a resolved product issue.
   The earlier PieceTree exception is now reproduced and fixed at its owner:
   text edits retired neither an empty Shift-selection anchor on a removed line
   nor, consistently, its recorded Undo state. Browser keyboard editing,
   Undo/Redo and Save/reload now pass the formerly failing sequence; see
   [editor reliability evidence](studio_build_jobs.md#editor-reliability-follow-through-2026-09-30).
   Correct obsolete verification expectations without replacing them with exact
   presentation-string contracts. Mobile sizing and secure LAN delivery retain their separately
   [documented limitations](studio_architecture_foundation.md#open-platform-usability-work-2026-09-29).

This running CLI request did not have native Studio tools in its negotiated tool
catalog, so validation called the public MCP endpoint through the official SDK.
The checked-in Codex configuration targets port 8080; this isolated session used
8092. This is a client/session configuration distinction, not evidence that the
MCP server needs another custom transport. Resume/reload the client with the
correct existing-server configuration to expose its tools directly.

Bottom line: Studio already materially improves runtime understanding and
debugging. The next productivity gain is less orchestration and more reusable
observations, not more chat chrome or more screenshots.

## Follow-up architecture review: build action handlers

Completed the bounded review of `choice.action === 'open'`. Build details,
unacknowledged receipts and blocked-popup recovery now declare each action with
its own `run` handler. Target, recipe and job selection remain ordinary data
choices; no general command registry, Quick Pick facade or second action service
was introduced. The existing picker closes before dispatch. Handlers capture
the build-service owner and, for opening/Retry, the same opener and immutable
artifact ID instead of rereading optional composition fields later.

References checked before implementation:
[VS Code action-bearing picks](https://github.com/microsoft/vscode/blob/main/src/vs/platform/quickinput/browser/pickerQuickAccess.ts)
and [browser opening/explicit Retry](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/host/browser/browserHostService.ts).
The chosen handler starts immediately, preserving the existing browser activation
timing. Both synchronous handler failures and asynchronous rejection reach the
ordinary command feedback; selecting or dismissing a receipt never resubmits it.

Validation: 29 existing Quick Pick checks and 6 build/browser checks pass;
IDE/browser typechecks, browser product build and strict boundary audit pass.
A local probe using the real Quick Input controller exercised Copy, log selection,
Refresh, Cancel, Dismiss, recipe submission, denied writes, thrown openers and
Retry with the originally captured opener. No exact UI-copy contracts were added.
In the actual Studio UI, keyboard selection copied the exact published artifact
ID to the browser clipboard, View Log made one explicit request (this job's log
was empty), and a pointer click opened the exact artifact in a second registered
Studio window without changing the first. Evidence is under
`.bmsx/authoring/build-handlers/`; this is navigation/handler validation, not a
new gameplay, physical-phone or all-browser popup certification.

## Multi-window browser reliability investigation

The original third-window stall is reproducible with Playwright's Chromium
headless shell **153.0.8010.12** (browser revision 1243) in this WSL software-GPU
environment. It remains at `navigator.gpu.requestAdapter()`, before device
creation or Studio registration, with no outstanding application HTTP request.
The actual WebGPU adapter is Google SwiftShader; the ANGLE renderer under the
original launch flags is Mesa llvmpipe. Launch flags alone do not identify the
driver actually selected.

A standalone reproduction now separates this from Studio, cart contents,
runtime state, authentication and the development server:

```sh
# Uses the installed Playwright browser; no ROM, build or BMSX server needed.
node scripts/render/diagnostics/webgpu_multi_window.mjs
# Control: initialize the same pages/devices without submitting draw work.
node scripts/render/diagnostics/webgpu_multi_window.mjs --draws=0
```

The fixture renders a full-screen triangle at 1920×1080, ten submissions per
animation callback, with a small arithmetic fragment shader. The first two
pages initialize. In the loaded reproduction, the third adapter request remains
pending for the 15-second observation interval. Stopping submission in the first
two pages, without refocusing or closing them, then lets the third initialize
(observed after about 1.3 seconds in both reduced runs). The no-draw control
initializes all three pages. The earlier small clear-only
sample did initialize all three; that did **not** rule out a load-dependent
browser/GPU problem. Starvation is a working hypothesis, not an identified
Chromium/Dawn source defect. The diagnostic reports observations, not a test
pass/fail for Studio startup; its intervals are not application timeouts.
This does not establish that BMSX's submission rate is optimal, or that ordinary
hardware-accelerated browsers have the same limitation.

The following experiments are **not fixes** and were not adopted:

- Awaiting the whole GPU queue before every animation callback released the
  stall, but inserts a global CPU/GPU synchronization point. Allowing two frames
  in flight did not release it. No such pacing policy was added to the product.
- Changing to Chromium's new headless mode initialized three Studio runtimes.
  Public MCP pause, forward/backward stepping and replay worked, but separately
  inspected browser captures were black. Successful tools or a boot marker are
  not evidence of a correctly presented UI.
- Other graphics-flag combinations produced missing shared-image backing,
  readback failures or GPU-process crashes. A headed trial initialized three
  windows and its third-window capture visibly showed the source editor, but
  later reloading one did not finish startup within the observation
  interval. None establishes reliable multi-window acceptance.

The reduced page/driver are diagnostic-only and load no BMSX modules. This slice
does not change the browser backend, frame loop, machine runtime, server,
backend-selection policy or C++ implementation. No adapter retry, timeout-driven
WebGL fallback or per-frame fence was introduced to turn the observation green.
The outstanding work is identifying/fixing the browser/GPU behavior and then
rerunning actual multi-window Studio presentation and reload acceptance.

References inspected: Chromium's own
[software-GPU pixel-test configurations](https://github.com/chromium/chromium/blob/main/content/test/gpu/gpu_tests/pixel_test_pages.py),
[SwiftShader setup](https://github.com/chromium/chromium/blob/main/docs/gpu/swiftshader.md),
[WebGPU command decoder](https://github.com/chromium/chromium/blob/main/gpu/command_buffer/service/webgpu_decoder_impl.cc),
and Three.js's [animation lifecycle](https://github.com/mrdoob/three.js/blob/dev/src/renderers/common/Animation.js).
Their implementations were used to check ownership and distinguish scheduling
experiments from justified application fixes, not copied into the BMSX hot path.
Local detailed logs, trace and inspected images are under
`.bmsx/authoring/multi-window-reliability/`.
