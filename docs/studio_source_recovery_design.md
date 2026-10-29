# Source recovery and editor-session storage

## Owners

Canonical text, dirty state, versions, saved baselines and Undo/Redo belong to
`EditorTextModel`. Source and visual editor inputs retain views of that model;
opening Source is not an edit and does not establish document ownership.
`TextFileSaveService` persists canonical files through their admitted addresses.
Recovery checkpoints are separate records, not canonical source or Save receipts.

Frontend workspace storage owns editor-group restoration, font choice,
breakpoints and dirty-source generations. Native `WorkspaceSourceRecovery`
owns source-only recovery for its isolated Studio, without reading or writing
the human frontend's editor session. Both consume the shared dirty-source
capture, publication, loading and pruning owners.

## Admission and namespace

Workspace attachment supplies a source context and a recovery-session identity.
The context has an opaque, persisted ID and an admitted project root. Its ID is
not the root, a cartridge socket, a build artifact or a hash of configuration.
The root supplies a persistence location; it does not prove identity equality.

A raw-media open selects its initial source folder in platform composition and
follows that folder's explicit source-open selection. Node metadata persists
the selection and context atomically in SQLite; standalone browser metadata
uses one IndexedDB transaction. This selection is separate from named-project
admission, even when both have the same root.

Published Studio opening retains the build-request receipt. Its completed
receipt supplies the exact project admission before any artifact or media is
read. The immutable artifact supplies bytes, not source identity. Native Studio
uses the same distinction. Historical artifact-only receipts cannot supply an
authoring admission.

Each frontend session owns an additional recovery UUID. The browser retains its
selection in sessionStorage and admits exclusive ownership through a Web Lock.
Reload can reuse the selection; a cloned tab cannot claim a live document's
namespace. Explicitly created Studio windows select a fresh session before
navigation. The lease lasts until document destruction, including any cached
lifetime: releasing it on pagehide and blindly resuming would permit two owners.
Retained Web Locks can affect browser back/forward-cache eligibility; namespace
ownership is not weakened to avoid that platform tradeoff.

The namespace is `<source-context-id>/<recovery-session-id>`. Frontend
`session.json` and native `sources.json` live below the admitted root's
`.bmsx/studio/<namespace>/` directory. Immutable dirty versions use that same
namespace at their owning resource roots. Local and remote replicas use the
same addresses. Different contexts or sessions cannot prune each other's
versions, including when their source files and roots coincide.

Root-only legacy session and dirty records have no admitted identity. They
remain untouched; a new context does not claim them by matching a root.
Canonical source files are unaffected by this namespace boundary.

## Generations and lifetime

Capture reads dirty canonical models, not only open Source tabs. Each changed
buffer produces an immutable record and retains its saved/persisted baseline.
Unchanged text reuses the preceding record. In-memory dirty maps keep their
source keys; the recovery owner supplies persistent namespace addresses.

Publication writes referenced versions before publishing the manifest, and
prunes superseded versions only afterwards. Loading reads every referenced
version before admitting a generation. An incomplete generation is an error,
not permission to rewrite the manifest or discard a draft. The local replica
can preserve an acknowledged generation while its configured remote provider
is unavailable; it never selects another file authority.

Restoration recreates dirty working copies and their baselines independently
of view creation. The manifest retains the last saved source and the acknowledged
persisted baseline, including an absent file. Current file timestamps and the
compiler's source choice do not discard or rebase that working copy. The model
owner admits the complete recovered generation before notifying source clients;
each model is already dirty and contains its final draft and Save authority.
Source retirement ends that publication and subsequent view restoration without
undoing newer admitted work.
A subsequent Save uses the ordinary admitted file address and
expected-source boundary. Only successful canonical persistence advances that
model's saved baseline. Source navigation, cursor movement and metadata capture
do not add Undo entries or make clean text dirty.

Workspace replacement joins accepted persistence before retiring its storage
namespace and source owners. Closing an editor view does not dispose a shared
working copy. Editor-part and document identity follow the
[workspace contract](studio_workspace_design.md), not recovery filenames.

## Production references

VS Code separates [workspace-scoped backups](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/services/workingCopy/browser/workingCopyBackupService.ts)
from [resource/group editor mementos](https://github.com/microsoft/vscode/blob/ada39222f5f2fb65f3aea23d95496629a8bbf697/src/vs/workbench/browser/parts/editor/editorPane.ts#L243-L270).
Its [text-file model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/textfile/common/textFileEditorModel.ts)
restores backup content with its saved file metadata and retains conflict
admission separately from dirty text.
BMSX's per-frontend recovery lease uses the Web Locks
[document-editor ownership primitive](https://github.com/w3c/web-locks/blob/main/EXPLAINER.md#use-case-examples),
not a heartbeat, stale-process probe or compatibility fallback.
