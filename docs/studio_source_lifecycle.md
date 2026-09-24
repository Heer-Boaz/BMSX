# Studio source lifecycle tools

The acceptance goal remains review -> Save -> build/install -> execute/retest
with distinct evidence for each transition. This slice implements the review
handoff, explicit Save and source/persistence/installation observations. It does
**not** advertise a completed install/rerun workflow.

## Live owner audit and references

Before implementation, the current owners were checked:

- `WorkspaceEditProposal` applies one explicit multi-file review through shared
  history. Applying retires that prompt's source context; a review ID is never
  source or Save authority.
- `WorkspaceSourceContext` captures current model identities/text and retires
  on edits or catalog replacement. Saving an admitted snapshot cannot resurrect
  an expired context; the next user prompt reads new receipts.
- `TextFileSaveService` already captures exact revisions, coalesces a pending
  Save of the same revision, orders later revisions and drains on shutdown.
  `records.ts` already distinguishes local-only persistence from provider write
  acknowledgement. No assistant queue, file writer or retry policy is needed.
- `getTextFileRuntimeSourceStatus` compares current source with actual installed
  source; a successful Save does not change Lua installation. YAML requires its
  asset build. AEM retains its separate Save-time application outcome.
- `BootService` and `HotResumeService` already distinguish reset, installation,
  admission and init completion. They are not invoked by these Save tools.
  Their next integration must preserve captured sources, physical outcomes,
  cancellation before installation and retained guest state after application.
- `ScenarioRunService` builds isolated target media from accepted sources.
  Passing a test is not proof that the authoring machine installed that media.

Production references read before implementation:
[VS Code stored-file working copy](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.ts#L767-L1023)
captures versions, coalesces outstanding Saves, distinguishes cancellable
preparation from a submitted write, and acknowledges the version actually
written. Its [file working-copy manager](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/workingCopy/common/fileWorkingCopyManager.ts)
keeps Save/Save As in document ownership rather than an editor widget. BMSX uses
these ownership distinctions, not their fallback, compatibility or validation
policies.

## Contract

`studio_save_source(receipt)` saves that prompt's exact current working copy,
without opening a tab, approving a proposal or installing Lua/YAML code. The
ordinary source owner captures it before asynchronous IO. The reply names the
source receipt, accepted version and Save operation ID and carries:

- `saved` plus `workspace` or `local-only` persistence; local-only includes the
  actual disconnected/write-failed reason;
- a separate AEM application result or `not-requested` for Lua/YAML;
- `failed` if local persistence failed. It does not clean the model or fabricate
  project acknowledgement. Error values become text at the tool wire boundary.

Save admission and observer lifetime differ. A pre-cancelled request performs
no IO. Once accepted, Save remains owned by the workbench, even if its tool
request, conversation or connection ends. Stop discards the reply; it never
rolls back writes or cleans later edits. Workspace shutdown joins the existing
source-write queue. No promise waits for user review or an extra model turn.

`studio_read_source_status(receipt)` is an on-demand observation. It returns the
current receipt version, dirty state and ordinary runtime source status. It
also exposes the Save owner's latest accepted operation, whether its snapshot
matches current text, and `pending` or the exact terminal acknowledgement.
The result is not cached against the source version: Save can complete without
changing document text. It uses no provider query or background model polling.

`TextFileSaveService.save` returns the accepted operation itself (ID, snapshot,
completion promise and terminal result), including for coalesced calls. Callers
correlate their own operation, never an ambient latest pointer. The Save service
retains the latest operation per model in a WeakMap. Older admitted
operations finish for their callers but cannot overwrite a newer operation's
status. Retention is workspace-local, not a durable provider synchronization log
or cross-session filesystem equality guarantee. Historical IDs grant no write
authority. Manual and conversational Saves share this owner and coalescing.

| Representation | TypeScript owner | C++ | Change |
| --- | --- | --- | --- |
| Authored source/version | EditorTextModel snapshot | no IDE working copy | unchanged |
| Save ordering and completion | TextFileSaveService | no IDE Save service | retains latest operation outcome for all callers |
| Persistence acknowledgement | workspace record provider | no native IDE provider | unchanged |
| Installed source comparison | existing runtime-source status cache | native installed media remains unchanged | read only on explicit request |
| CPU/registers/renderer/Terminal | existing machine/runtime | existing native counterparts | no changes |

There are no mirrored-runtime edits. No instruction, renderer, host-frame or
guest-call hook changes. New result retention/allocation occurs only on explicit
Save; source-status formatting only on explicit inspection. Canonical authored
bytes flow unchanged through existing source persistence.

## Evidence

`source_save_tools.test.ts` covers exact source authority, current/foreign/stale
receipts, pre-cancelled requests, read-only models, review handoff, shared Save
coalescing, later typing and prompt retirement, pending/failed/local-only/project
outcomes, separate AEM failure and out-of-order completion observations.

`studio_source_save_tools.test.ts` uses the actual browser machine, HTTP project
file API and native Codex app-server with a deterministic local Responses
provider. The model proposes Lua/YAML comments, visible review Apply changes the
models, and the next prompt Saves through the ordinary owner. While the actual
Lua PUT is held, keyboard typing changes the model and visible Stop retires the
conversation. The accepted write completes with its original snapshot; a later
prompt sees the historical acknowledgement and still-dirty newer source.
Ordinary Ctrl+S then saves the newer revision and the next prompt observes that
same owner's result. Project bytes are checked exactly, including canonical
YAML comments, Unicode and line endings. Guest cycles and installed media stay
unchanged throughout. The provider sequence is finite: 19 requests and one
connection per workflow.

This is automated integration with visible review/typing/Stop/Save actions, not
UI-only authorship or live-model reasoning. Screenshots are retained under
`/tmp/bmsx-studio-chat/source-save-*-{review,retired-save,manual-save}.png`.

Validation at this slice boundary:

- Shared Save/source-tool owner tests: 22 pass. Full Lua suite: 2795 pass,
  one skip. Full native Codex/Studio assistant suite: 54 pass, including the
  source Save workflow on software, WebGL2 and WebGPU.
- Ordinary Lua/YAML/AEM Save workflows pass on all three renderers, including
  actual HTTP write failure and reconnect. This checks non-Codex consumers of
  the changed Save API, not merely the new tools.
- Browser/Node debug and release builds, product typechecks, strict architecture
  audit and core-parity audit pass. Tests-project typecheck retains the same
  94 pre-existing diagnostics; it is not green. Indentation checking reports
  five pre-existing files, none changed by this slice. `git diff --check` passes.
- The explicit source-context size probe still materializes one shared source
  snapshot across 30 contexts at each of 16/256/4096 edits. This is a local
  ownership/allocation check, not evidence of overall game performance gains.
