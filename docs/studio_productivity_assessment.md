# Studio productivity assessment — 2026-09-30

Scope: the cart-development workflow, not certification of every IDE feature,
browser, native host or device. Product revision: `0b4233368` (including the
guest-call completion fix in `14ba70a72`). This assessment adds no product code
or new test contracts.

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

## Most valuable remaining work

These priorities come from the observed workflow and current public tool catalog,
not assumptions that existing UI features are absent.

1. **Frame-scheduled input on the authoring target.** Studio can advance exact
   frames, but the current tools cannot hold/release game controls at specified
   frame boundaries. Bricklane required browser key-down, a separate step call,
   then key-up. Scenario Lab already drives test input; build on the existing
   input/timeline owners rather than writing cart globals or adding a second loop.

2. **Focused observation and reusable reproductions.** Table pagination works,
   but repeatedly following globals → table → nested tables dominates simple
   questions such as “what changed in this collision?”. Shared stored-value
   watches/diffs, relevant stop conditions and recorded input/reproduction
   export would reduce that work. Today there are no corresponding public tools;
   inspections expire on execution and Terminal/actor calls clear prior retained
   history at the mutation boundary. Preserve those truthful lifetimes, do not keep stale table handles or
   evaluate arbitrary Lua on every frame as a shortcut. Frame/cycle seek already
   exists; the missing part is convenient, retained evidence and comparisons.

3. **Complete the tool surface of existing authoring operations.** Creation of
   a whole cart is exposed, but individual new Lua/test files still require UI or
   workspace access. New-source review, ordinary Hot Resume and explicit opening
   of a published artifact have no corresponding MCP operation. Reboot is exposed
   and is deliberately not Hot Resume. Source search/ranged reads would also
   avoid transferring whole catalogs/files for a small edit. Keep review approval,
   Save, compilation, installation and reset distinct rather than making a
   misleading “do everything” success receipt.

4. **Make the active work easier to locate.** Both live windows were listed as
   `BMSX`; artifact URLs distinguish them but not human intent. A cart/artifact
   label, useful operation links and less truncation of actor/test identifiers
   would help human and agent alike. Opening Scenario Lab initially selected a
   different case from the active tool-started run: provide clear navigation to
   that operation without stealing the user's selection on every update.

5. **Close reliability and verification gaps before expanding the surface.**
   The third concurrent Studio window stalled at `navigator.gpu.requestAdapter`
   in this Chromium/SwiftShader environment. A minimal three-window WebGPU sample
   did not hang; the exact cause is unresolved, not established as a browser limit.
   The earlier PieceTree exception is also not proven fixed. Correct obsolete
   verification expectations without replacing them with exact presentation-string
   contracts. Mobile sizing and secure LAN delivery retain their separately
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
