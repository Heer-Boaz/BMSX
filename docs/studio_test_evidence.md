# Studio test evidence: recorded outcomes, not execution authority

Implemented on 2026-09-23 after correcting workspace test admission and retaining
the accepted suite source in ordinary result history.

## Owners

- `ScenarioRunService` admits current workspace selections/sources. `TestRun` and
  `TestExecution` own isolated execution; no assistant adapter calls them.
- `ScenarioResultService` owns recorded run/case identity, states, counters,
  accepted suite text, failures and bounded output. The existing Scenario Lab
  Details inspector reads those same records. Old failed suite text remains
  inspectable after a changed rerun passes or its physical target is disposed.
  `TestRun` compiles directly from those accepted records, not a second source
  array supplied independently by its caller. Recorded and executed suite text
  therefore share one producer boundary in both Studio and the CLI.
- `ScenarioRetainedSequence` counts records it evicts. Ordinary Details exposes
  log/capture retention loss as well as the captured source. This counts only
  Studio's result-ring eviction, not gaps inside guest producer rings. Trace
  producer sequences and time words retain their original representations.
- `WorkspaceTestTools` is a prompt-scoped read adapter over that result owner.
  It owns opaque handles and transport snapshots, not another run/history model,
  machine, source writer, debugger or polling loop.

Before implementation, VS Code's pinned
[result owner](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/testing/common/testResult.ts#L354-L390)
and [result service](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/testing/common/testResultService.ts#L126-L138)
were studied: original evidence is distinct from preview text, and result lookup
is distinct from execution. Its
[retirement state](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/testing/common/testResult.ts#L510-L519)
does not rewrite the recorded outcome. BMSX does not copy its extension-host,
persistence, source-location fallbacks or service registry.

## Capabilities

1. `studio_list_test_runs` lists retained runs known when the explicit prompt
   was admitted, newest first. It returns historical coverage and counts, not
   every source/log. An empty list does not certify a passing workspace.
2. `studio_read_test_run` returns the selected run and its case summaries with
   prompt-local case handles. A running run may still be preparing; it is never
   converted into a successful result because a preparation promise settled.
3. `studio_read_test_result` returns one case's actual state, accepted suite text,
   original case range, source revision, ticks, phase failures, structured fault
   frames, retained logs/capture metadata and FSM/ActionEffect facts. One-case
   reads avoid sending every suite and output record just to choose a failure.

These are fixed read capabilities alongside the existing source tools. No
Save, build, Run, Rerun, Cancel, shell, provider RPC or direct file-write tool has
been added. A test handle cannot authorize an edit: proposals still require
fresh source receipts and the ordinary explicit review/history route.

`test_tool_protocol.ts` owns this external schema. The existing argument-object
admission is shared with source tools in `tool_input.ts`; owned result data is
consumed directly, without another runtime validation layer.

## Lifetime and correspondence

Prompt admission captures bounded run membership, not copies of all evidence.
New runs require a new explicit prompt. Each requested projection reports its
result-owner revision and observes the admitted run at read time. Prior returned
snapshots stay unchanged when preparation ends, teardown adds a failure or a
capture receives a presentation. Reads do not wait or poll for those events.

Eviction rejects a handle even if it previously had a cached snapshot; a later
run cannot inherit it. Prompt completion/interruption, account/connection
retirement and workspace clear release read authority. Historical evidence can
still be read after an ordinary source edit within a prompt, but that does not
refresh its separately invalidated source/edit receipts. No event starts another
model turn automatically.

`sourceCoverage: accepted-suite-only` means exactly that: the suite bytes accepted
for this case. A preparation failure may not have executed them. Neither an equal
revision number nor a past pass proves that current suite/dependency sources
match. Captures are metadata, not stored image pixels. Logs/facts report their
retained windows and eviction counts, not a claim of exhaustive guest observation.
Source ranges/locations are original one-based Lua coordinates; their positions
may no longer match current documents. Interactive test-target debugging remains
unimplemented and is not simulated by returning authoring-Runtime state.

## Work budget and validation

Run admission retains at most the existing bounded history membership. No suite
text, log or trace is materialized until that case is explicitly read. Unchanged
projections reuse their cached data at the result owner's revision. Result rings
still overwrite in place at fixed capacity, adding only an eviction counter at
overflow. No per-frame/instruction guest work or document parsing is introduced.

Owner tests cover empty history, prompt membership, exact CRLF/Unicode source,
unchanged repeated reads, pending/terminal snapshots, multiple failures,
presentation mutation, all retained-output rings, raw trace words, foreign
handles, eviction, malformed external input and connection retirement. Conversation
tests cover source edits without renewed edit authority, prompt replacement and
workspace teardown without late replies or automatic inference.

The actual browser/authorized HTTP/pinned Codex process workflow runs a real
two-case isolated suite, inspects it in ordinary Details, edits the current suite,
then requests the old results. Actual Responses request bodies preserve the old
failure and old source plus cleanup logs on software, WebGL2 and WebGPU. Reads
change neither the source, canonical files, test run count nor authoring machine.
These are automated offline-provider checks, not personal-account authorization,
paid-model reasoning or UI-only source authoring.
