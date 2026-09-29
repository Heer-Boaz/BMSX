# Studio source-save acknowledgements

Implemented; ownership corrected 2026-09-29. Shared by ordinary commands and
assistant tools, independent of an agent or server.

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

Lua/YAML Save does not execute or install code. AEM performs its normal
build/install and `reload_from_rom` only after canonical persistence succeeds;
application failure is reported separately from source persistence. Authored
bytes are never reconstructed from cooked assets.

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

## Validation

- Changed-file unit/integration bundle: **206/206**. It covers source ownership,
  delayed writes, shutdown, Lua/YAML/AEM acknowledgement, independent failures,
  explicit retry, backups, tool receipts, Hot Resume and Scenario Lab.
- Standalone Chromium product: **2/2**. Terminal, source creation, Save, reload,
  offline editing, absent assistant services and actual IndexedDB quota denial.
- Existing `--studio-source-saves` workflow: **software, WebGL2 and WebGPU pass**.
  It runs Nemesis and Ctrl+S against the actual product file API in a disposable
  workspace. Injected HTTP 503 responses reject PUTs; reads verify the project
  bytes remain unchanged, the document stays dirty and only explicit retry writes
  later edits. AEM runs only after a successful write.
- Existing server/history/MCP product bundle: **15/15**; assistant HTTP: **12/12**.
- Product typechecks and strict boundary audit pass. The broad tests-project
  typecheck has the same **98** diagnostics as HEAD, with no additions. Full Lua:
  **2843 passed, 1 skipped, 2 failed**; both menu-order failures reproduce against
  HEAD (`editor_context_menu` and `workbench_context_menu`), independently of this
  storage revision. They are not counted as successful validation.
- Screenshots were inspected for both browser quota failure and HTTP failures,
  dirty tabs, successful retries and standalone service availability. No exact
  text/row layout contracts were added. The conformance workflow uses source
  harness input and UI commands; it is not a claim of UI-only authoring.

Reproduction (requires debug BIOS/Nemesis ROMs, graph worker and Playwright):

```sh
npm run test:studio-standalone
node tests/conformance/runtime_replay/browser.mjs --studio-source-saves \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/source-saves.png
npm run audit:architecture-boundaries:strict
```
