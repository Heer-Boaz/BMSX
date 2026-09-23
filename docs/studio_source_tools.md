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
  response says **review-required**, never applied/saved/installed. The caller
  hands the proposal to the ordinary `WorkspaceEditReviewInput`. Only visible
  explicit Apply owns the shared-history mutation; Save/build/run/test are not
  tools in this capability set.
- Proposal construction transfers the captured context exactly once. Ending the
  inference turn releases reading rights but leaves an already offered review
  pending. The connection's AbortSignal remains linked to that review until
  Apply/Discard/Close/staleness. Disconnect retires pending edit rights, without
  disposing the shared source documents. Callers also dispose untransferred
  reading contexts on interruption or prompt completion.

`source_tool_protocol.ts` owns the external schema/argument conversion. Consumers
use admitted editor edits directly. Text-file resolution now takes its concrete
model owner explicitly for ordinary restoration and source-view callers too.
`WorkspaceSourceContext` also checks replacement of the complete resource
catalog, so YAML/data resource replacement cannot escape Lua-only invalidation.

## Evidence

- Ten focused source-tool cases cover exact unsaved/canonical bytes, concurrent
  receipts, explicit model ownership, multi-file review and joint Undo/Redo,
  connection retirement, stale/foreign handles, delayed YAML resolution past
  teardown, data catalog replacement, malformed/unproven edits and read-only
  participants. Source/proposal/storage bundle: **81 passed**.
- `npm run test:codex-workbench` runs the **real pinned Codex process** against a
  deterministic local Responses SSE fixture. The model lists resources, reads
  two files (including unsaved text) and offers edits through these actual tools.
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

Browser connection leases and the visible conversation/account composition are
now covered by [assistant contribution](studio_assistant_contribution.md). None of these
tools grant a general-purpose RPC tunnel, shell, file writer or permission to
rewrite source outside the shared review/history path.
