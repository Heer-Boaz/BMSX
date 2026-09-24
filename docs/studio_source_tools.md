# Studio source tools: receipts, not filesystem authority

The workbench's `services/assistant/source_tools.ts` admits external source
requests through the existing working-copy/context/review owners. It imports no
Node process, HTTP transport, account, guest CPU, or chat pane. Codex is one
client of this capability, not a second document/history implementation.

## Ownership and protocol

- Create `WorkspaceSourceTools` **before** starting a prompt's asynchronous model
  work. It owns one `WorkspaceSourceContext`, not a context refreshed on each tool
  invocation. Any intervening model/dependency/catalog change retires that
  authority, even before the first read and even if ordinary Undo restores bytes.
- `studio_list_sources` enumerates authored text resources without reading files
  or opening views. `textFileMode` belongs to the shared text-file admission
  owner; binary/cooked assets have no source-writing capability.
- `studio_read_source` resolves through the explicit `EditorTextModelService`.
  Existing unsaved models win; unopened Lua, YAML and AEM use the ordinary source
  admission path. Concurrent/repeated reads coalesce to one immutable receipt and
  cached source string. Reads create no Save/Undo boundary or hidden code input.
- `studio_read_diagnostics` requires one of those source receipts. It asks the
  existing `ResourceDiagnosticsService` to finish its pending batch and returns
  that resource's exact revision, coverage and markers. Problems and the tool
  consume the same result, including unsaved source. No new parser, hidden code
  tab, build or guest execution is involved. Rows/columns are zero-based UTF-16
  source positions. Unsupported/pending/failed is not a clean result; only a
  ready result with no markers means no reported problems. Listing sources never
  claims anything about unopened/unrequested diagnostic coverage.
- Resource handles and read receipts belong to a unique prompt context. A path
  is just a label. Neither filesystem paths, matching path/version numbers, nor
  receipts from an earlier connection can authorize reads/edits in this context.
- `studio_propose_edits` requires actual read receipts and exact original-source
  UTF-16 offsets. Every edit includes the exact deleted text. The external
  protocol boundary rejects wrong types, extra fields, missing receipts, duplicate
  files, out-of-range/overlapping/unsorted edits and mismatched expected text.
  It never searches for a near match, coerces offsets, repairs source or falls
  back to cooked data. These checks do **not** enter the text model/history path.
- The complete admitted edit set produces one `WorkspaceEditProposal`. The tool
  response says **review-required** with an opaque review identifier, never
  applied/saved/installed. This identifier grants no source authority. The caller
  hands the proposal to the ordinary `WorkspaceEditReviewInput`. Only visible
  explicit Apply owns the shared-history mutation. Save is a separate explicit
  operation requiring fresh source receipts after Apply, not a review bypass.
  Build/run/test keep their own owners and outcomes.
- The conversation snapshots outstanding review states on the next explicit
  user prompt. The provider sees actual owner observations, not a guessed result
  or another automatic inference turn. The tool itself completes immediately;
  review does not depend on a waiting model/tool call. Applied does not mean
  saved or still present after Undo. The next prompt must read fresh source
  receipts before proposing further changes. Account/connection retirement clears
  these observations; retained transcript previews are not replay authority.
- Proposal construction transfers the captured context exactly once. Ending the
  inference turn releases reading rights but leaves an already offered review
  pending. The connection's AbortSignal remains linked to that review until
  Apply/Discard/Close/staleness. Disconnect retires pending edit rights, without
  disposing the shared source documents. Callers also dispose untransferred
  reading contexts on interruption or prompt completion.
- `studio_save_source` uses the same `TextFileSaveService` as ordinary Ctrl+S.
  It accepts only the exact current receipt's model. Local persistence, project
  provider acknowledgement and format-specific application remain distinct.
  Admitted writes finish even when a prompt is retired; no cancelled reply is
  sent to a newer conversation. Later typing stays dirty.
- `studio_read_source_status` reads dirty state, the shared installed-source
  comparison and the Save owner's latest operation. Pending, failed, locally
  saved and project-acknowledged are different evidence. `matchesCurrentSource`
  compares the historical saved snapshot with the current receipt; neither a
  saved model nor a connected provider implies current project-file equality.
  The latest acknowledgement belongs to the model's Save owner, not the prompt,
  and includes ordinary manual Saves. See [source lifecycle](studio_source_lifecycle.md).

`source_tool_protocol.ts` owns the external schema/argument conversion, using the
shared external argument-object admission in `tool_input.ts`. Consumers
use admitted editor edits directly. Text-file resolution now takes its concrete
model owner explicitly for ordinary restoration and source-view callers too.
`WorkspaceSourceContext` also checks replacement of the complete resource
catalog, so YAML/data resource replacement cannot escape Lua-only invalidation.
Diagnostic transport projections are retained against the resource-result
identity; repeated reads do not copy the marker array or recompute analysis.
Source admission is rechecked after diagnostic publication because ordinary
listeners can synchronously edit source. Dependency changes retire the whole
prompt context even when the requested file's own version is unchanged. A
diagnostic read cannot refresh an old receipt or rearm a transferred proposal.

Before this capability was exposed, a reproduced global-project ownership leak
was repaired at the [shared semantic registry](studio_resource_context.md#follow-through-semantic-projects-belong-to-their-document-owner).
Diagnostics now analyze their actual model owner, not matching global editor
paths. Ordinary code, visual views, highlighting and Rename share that correction.

The separate [test evidence capability](studio_test_evidence.md) consumes recorded
results, not current source receipts. A result handle never authorizes a proposal
or refreshes this source context after an edit.

## Evidence

- Ten focused source-tool cases cover exact unsaved/canonical bytes, concurrent
  receipts, explicit model ownership, multi-file review and joint Undo/Redo,
  connection retirement, stale/foreign handles, delayed YAML resolution past
  teardown, data catalog replacement, malformed/unproven edits and read-only
  participants. Source/proposal/storage bundle: **81 passed**.
- `npm run test:codex-workbench` runs the **real pinned Codex process** against a
  deterministic local Responses SSE fixture. The model lists resources, reads
  two files (including unsaved text), reads their actual diagnostics and offers
  edits through these tools.
  Its response is pending review; Apply/Undo/Redo use the real shared owners.
  This is automated process-to-workbench evidence without an account, external
  model request or paid inference, not a connected chat UI claim.
- `--studio-edit-review` additionally exercises tool-origin **Lua and YAML**
  proposals through visible pointer Apply, ordinary source Undo and disconnect
  staleness, on **software, WebGL2 and WebGPU**. Source reads create no source
  tabs; no Save or installation occurs. WebGL2 pending/disconnected screenshots
  were inspected. The first browser probe correctly rejected an unavailable
  YAML source; the fixture was fixed to copy the real authored YAML, not the
  product changed to synthesize it. Cold session reload also passes.
- Full Lua suite: **2319 passed, 1 skipped**. Existing Codex session/stdio **19**,
  independent protocol **5**, real process/workbench **1**, and HTTP **6** pass.
  IDE/browser/Node typechecks, browser Studio build and strict architecture audit
  pass (zero issues). Tests-project typecheck remains at **96 pre-existing
  diagnostics**, with none in these new owners/fixtures. Indentation/diff checks
  pass. No TS/C++ machine representation or frame loop was changed.
- Explicit size probe (`profile_workspace_source_tools.ts`), 16/256/4096 edits:
  context/list/read median **0.012/0.016/0.025 ms**; external admission plus preview
  **0.022/0.134/0.954 ms**. Each source string is materialized once across all 30
  capture/proposal samples. This is one size-scaling measurement, not inference
  latency, a before/after comparison or a universal performance claim.

Primary production references studied before implementation: VS Code's
[bulk text edit owner](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/bulkEdit/browser/bulkTextEdits.ts)
resolves models independently of views and admits versions before application;
its [conflict detector](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/bulkEdit/browser/conflicts.ts)
ties proposals to live models/files. BMSX retains its own stronger one-shot
  context and canonical-byte contract rather than adopting fallback range repair.

## Diagnostic capability evidence

- Six additional source-tool cases cover unsaved CRLF/astral source coordinates,
  shared results, unsupported YAML versus ready-empty Lua, explicit provider
  failure without automatic retries, malformed/unread/foreign receipts, dependency
  invalidation and source edits during result publication. The source-tool suite
  now has **16** passing cases. One thousand repeated reads retain the exact
  transport result with **zero parses, source-string reads or result publications**.
- The real-process workbench test now reads diagnostics before offering its
  two-file review. The actual Studio conversation does the same for Lua/YAML on
  software, WebGL2 and WebGPU; the inserted unsaved Lua error is also shown in the
  ordinary Problems panel, and YAML reports unsupported. The shared-diagnostics
  screenshot was inspected. The fixture's first probe incorrectly placed a
  statement before `module<entry>` and correctly got a syntax diagnostic; the
  keyboard fixture was fixed, not the compiler or result admission weakened.
- Full Lua suite: **2354 passed, 1 skipped**. The nine browser assistant cases,
  account **9**, process/stdio **19**, independent contract **5**, HTTP assistant
  **12**, process/workbench **1** and workspace HTTP **6** pass. The ordinary
  multi-file-review workflow passes on all three renderers; WebGL2 cold-session
  restoration passes. Product typechecks/builds and strict architecture audit
  pass; the tests-project still has the same **96** diagnostic baseline, not a
  passing typecheck. Indentation and diff checks pass.
- Repeating the existing source-tool size probe at 16/256/4096 edits measured
  context/list/read medians **0.019/0.010/0.028 ms** and admission/preview medians
  **0.028/0.098/1.015 ms**, still materializing each source string once across
  30 samples. This measures source admission, not diagnostic query or inference
  latency; it is not a before/after performance claim.

The pinned production reference studied was Copilot's
[GetErrorsTool](https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/extension/tools/node/getErrorsTool.tsx),
which consumes the language diagnostics service and document snapshots rather
than running a tool-private analyzer. BMSX deliberately keeps stronger
receipt/lifetime and explicit-coverage contracts: it does not copy missing-file
fallbacks, approximate ranges or the reference's diagnostic-count cap.

Browser connection leases and the visible conversation/account composition are
now covered by [assistant contribution](studio_assistant_contribution.md). None of these
tools grant a general-purpose RPC tunnel, shell, file writer or permission to
rewrite source outside the shared review/history path.
