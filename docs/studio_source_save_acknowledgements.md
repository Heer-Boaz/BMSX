# Studio source-save acknowledgements

Ordinary commands and assistant tools share the same source-write owner,
independently of an agent or server.

## Canonical files and recovery are different authorities

`WorkspaceRecordProvider` owns canonical filesystem I/O: disk, authorized HTTP,
or browser IndexedDB. It has no generic connection/reconnection capability.
HTTP admission stays inside `HttpWorkspaceRecordProvider` / `StudioHttpSession`.
`WorkspaceRecords` owns per-path operation ordering and drains accepted operations
at workspace replacement; it never reads recovery storage or retries a failed
write. Different resources remain independent.

`TextFileSaveService` captures the admitted document revision, serializes each
model's saves and waits for actual persistence. Only a successful provider write
can promote the Lua catalog, canonical source cache and model saved/Undo identity.
The historical receipt names `workspace` (project files) or `browser` (IndexedDB).
A failed write returns `failed` with the original error and leaves edits dirty.
A later edit or restoration of connectivity cannot retroactively change that
receipt. Only a new Save can commit the current document. There is no
`local-only` Save outcome, canonical recovery cache or automatic source replay.
Reading a source file never writes it.

Workbench recovery owns dirty snapshots, editor-session generations and their
local/project checkpoints. A backup is not a successful source Save. Local
recovery is not injected into source resolution, serializers, execution services,
assistant tools or the command controller. Recovery publication writes immutable
dirty versions before publishing the manifest, then removes obsolete versions.
Provider checkpoint failures are reported without disabling other file operations
or scheduling a reconnect loop. Another mutation or explicit checkpoint can try
again. Corrupt JSON or a missing referenced generation is an error: recovery
records are not deleted, pruned or silently replaced with an older generation.

Lua, YAML and AEM Save persist authored text without building, executing or
installing it. AEM's explicit Apply operation selects a physical installation
and retains its exact image through queued build/runtime work. It relinks from
that installation's captured Lua sources, not pending authoring documents.
Build/runtime failures belong to that operation; they cannot turn an acknowledged
source write into a failed Save. Packaged source metadata supplies the initial
asset baseline. Authored bytes are never reconstructed from cooked assets.

Source-status observations retain one result per corresponding installation.
Aggregate `applied` means every corresponding installation matches the authored
text; matching the context identity alone does not prove source equality.
A missing asset is pending, while an installed asset without source metadata is
untracked. An asset-only installation does not require a compiled code image.

The [standalone composition](studio_standalone.md) selects browser files before
starting the workbench, not after a network error. Browser quota failure follows
the same failed-Save contract as an HTTP/disk write failure. Local storage cannot
turn an acknowledged canonical write into a failed Save either: it is not in
that operation's dependency chain.

## Production references studied

VS Code separates [working-copy backups](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/workingCopy/browser/workingCopyBackupService.ts)
from [provider writes and exact-version Save success/failure](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.ts).
BMSX adopts that ownership, not the full DI/service surface or compatibility
fallbacks. No new machine representation or frame-time work is involved.
