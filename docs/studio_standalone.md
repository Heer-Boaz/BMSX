# Standalone IDE / Studio

Studio does not require the BMSX development server or Codex. Use the ordinary
`studio.html` / `studio.debug.html` product with its BIOS, cartridge and browser
assets. The minimal `index.html` player remains a separate product; it does not
acquire the IDE or an agent dependency.

## Composition, not a failed connection

`StudioConfiguration` is the deployment contract. The product builder emits
both a usable standalone page and a Studio application template. The existing
server renders **only** `/studio.html` and `/studio.debug.html` from that template,
with its configuration. Its generic static-file handler streams HTML unchanged;
it neither searches for nor replaces a mode flag. The minimal player has no
Studio configuration.

The workspace provider, embedded assistant, native-conversation viewer and
external-tool registration are declared independently. Missing agent services
have no connection factory. Protocols at the same base URL share one admission
session, not each other's availability or lifetime. Bootstrap values are JSON
in an attribute encoded by the existing `entities` dependency. Both deployment
producers use the same product-owned renderer; the browser consumes their typed
representation directly, once. There is no endpoint probe, heartbeat, hostname
guess, runtime DTO validator or catch-and-switch fallback.

| Capability | Standalone Studio | Development-server Studio |
| --- | --- | --- |
| Source editor, Undo/Redo, diagnostics, source-based execution | Existing local owners | Same owners |
| Lua Terminal, debugger, frame controls, Actor/Scene/Scenario tools | Existing local owners | Same owners |
| Canonical source Save and new Lua files | Browser IndexedDB | Project filesystem through authorized HTTP |
| Recovery / editor session | Browser-local, standalone namespace | Existing local/project recovery |
| Embedded assistant, native CLI history, external MCP window | Not connected; Codex view commands disabled | Existing independent transports |

Server-backed transport loss keeps the selected file authority;
it does **not** silently switch Save to another project. Ordinary connection
failures are still reported. This change neither copies accounts nor starts a
native Codex daemon. Local and trusted-LAN server composition remain identical.

Restart an already running development server after updating its application
route. Build the normal Studio product, including its template, before using
that route. There is no new server command or assistant flag.

## Browser source persistence

`IndexedDbWorkspaceRecordProvider` implements the existing record-provider
contract, not a second text-model or source-history service. ROM-packaged authored
source is the initial base. Saved overrides, new files and session records live
in the `bmsx-studio-workspace` database. Source discovery admits newly created Lua
files independently of restored tabs and ROM membership.

Debug ROMs retain the original YAML, JSON and AEM text in the existing per-asset
tooling metadata, separately from the cooked payload. Release ROMs omit it.
Opening YAML/AEM resolves a canonical workspace file first, including an empty
file; an absent file uses that packaged authored base. Read failures propagate,
never select another authority. Opening does not seed IndexedDB, and consumers
do not reconstruct source from cooked data. Both paths use the same retained
text model, diagnostics, Undo/Redo and Save service.

The resource picker/tree enumerate all loaded authoring domains, including cart
data while the BIOS is executing. Resource identity remains `(domain, path)`;
CPU execution-domain changes neither hide files nor rebuild/sort the catalog.
AEM Save persists independently of runtime availability. Live application is
admitted at the serialized runtime boundary only when that resource's domain is
executing. Otherwise Save reports that application is pending, without changing
media or calling another domain's globals. Once the cart is active, an explicit
Save can request application; there is no background retry loop.

Cart and BIOS incremental builds both track the packer/compiler/configuration
inputs. An ordinary build therefore regenerates debug source metadata when its
producer changes; it does not require a manual `--force`. Unchanged builds skip.

Writes complete only when their IndexedDB transaction commits. File/directory
admission and content writes use the **same** transaction, including competing
windows. A path cannot be both a file and a directory. Namespace entries have a
parent index: enumeration reads immediate child metadata, not descendants or
source bodies. Empty directories survive file deletion. Ordinary Save of an
existing file does not re-walk its parent directories. The schema upgrade indexes
the previous content store without rewriting or discarding its files. No
frame-time storage or network work was added.

Every provider implements the same canonical file operations. HTTP admission
belongs to its transport; the shared file owner has no global connected flag,
probe file, reconnect timer or pending source-replay queue. `WorkspaceRecords`
orders operations per path and drains them before workspace replacement. A
failed Save remains failed for every provider and keeps the model dirty. A read
never uploads recovery. The code-editor footer no longer represents a failed
file operation as a disconnected server.

Save says **in this browser**, and its acknowledgement has `status: browser`.
`workspace` acknowledges a project-file write. Recovery does not acknowledge
Save at all: it checkpoints dirty documents and session state separately. A
provider checkpoint failure reports through the existing log and workbench
warning surfaces, retaining local recovery without a blind retry loop. A future
mutation or explicit checkpoint can retry. Missing/corrupt recovery is reported,
not silently discarded. Ordinary local recovery still checkpoints before page
exit. Its standalone namespace remains separate from server-backed recovery;
no implicit migration/import joins these two authorities.

Browser files belong to this origin and browser profile, not a directory on the
computer. Clearing site data removes them; browser quota/eviction rules apply.
This is not a filesystem export or cloud backup. It does not add asset-ROM
repacking to the browser; existing asset-rebuild requirements still apply.

## Browser deployment limits

"No development server" is not a claim that double-clicking `file://` bypasses
browser security. Packaged assets still need normal browser delivery and the
runtime's secure-context/cross-origin-isolation requirements. Validation uses
an assets-only static host with **no BMSX API implementation**, then disables
network access after loading. No offline installer/service worker or cold-start
asset cache was added. Native host runtime/Terminal ownership is unchanged.

The mobile fixed-canvas limitation remains explicit in the
[platform backlog](studio_architecture_foundation.md#open-platform-usability-work-2026-09-29).

## Validation

`npm run test:studio-standalone` exercises real Chromium IndexedDB, content-store
upgrade, concurrent exclusive creation and file/directory conflicts, committed
reads after reopen, indexed directory discovery and delete. Its product workflow
uses actual keyboard/native clipboard input to
execute Lua (`6 * 7` returns `42`), create/edit/Save source, reload and copy the
restored source, then edit/Save with networking disabled. It records all browser
attempts to reach Studio endpoints, including offline attempts, and waits beyond
the previous reconnect interval: **zero requests and zero application errors**.
It then applies a real Chromium storage-quota limit, edits and tries Save again:
canonical bytes remain unchanged, the editor keeps the edit, and lifting the
limit lets an explicit Save commit it. Screenshots cover both outcomes. This
found a native `QuotaExceededError` with an empty message; the storage boundary
now translates that code into a visible failure instead of an empty status line.

The same product workflow opens previously unopened YAML/AEM directly from the
ROM with networking disabled, compares copied document text to the authored
files, edits through the native clipboard, exercises Undo/Redo, saves and reloads
the browser-owned documents. It also opens them during BIOS startup. Visual
inspection found an AEM runtime-apply TypeError despite successful persistence;
the runtime-domain admission above fixes that separately. The saved document now
shows pending application, including after reload, rather than an internal error
or a false installation acknowledgement.

Screenshots in `/tmp/bmsx-studio-standalone/` cover the Terminal result, disabled
Codex menu alongside active local tools, browser Save and restored/offline source.
They are inspected visually, not asserted against exact message/row strings.
Two previously unhandled viewer commands found during this workflow now follow
the ordinary focus-scoped dispatch and enablement, instead of being globally
available outside their pane.

Targeted results (2026-09-29): standalone **2/2**, source Save/storage/provider
regressions **87/87**, workspace HTTP **7/7**, ordinary-server entry **6/6**, native
conversation browser product **1/1**, and real MCP browser product **1/1**.
The server-entry coverage also checks the actual application route, independent
capability serialization, matching GET/HEAD bodies, and unchanged static files.
Storage-failure coverage checks dirty-source retention and absence of reconnect
timers, not exact presentation strings.
The existing source-Save conformance workflow also passes on software, WebGL2
and WebGPU, exercising real HTTP file writes, failed-Save acknowledgements after
rejected writes and explicit Save retries for Lua, YAML and AEM.
IDE/Node/common-host typechecks and Studio debug/release, player and headless
tooling builds pass; the strict boundary audit reports zero issues.
These do not imply paid-model inference or physical-phone coverage.

Authored-source follow-through (2026-09-29): full rompacker **189/189**, targeted
source/catalog/storage/build regressions **114/114**, server/history/MCP/assistant
HTTP bundle **27/27**, and standalone Chromium **2/2** with the extended workflow
above. Source-Save conformance passes on all three renderers; the screenshots
show both rejected writes and the subsequent successful explicit retries.
The full Studio workflow also passes on software, including source navigation,
AEM application, Hot Resume, Scene Editor and Scenario Lab.
The full Lua suite has **2846 passed, 1 skipped, 2 failed**; both existing
menu-order failures also occur at the pre-change HEAD. Diagnostic comparison
against that HEAD finds no additions: the tests project retains **98** diagnostics
and scripts retains **2**. These pre-existing failures are not counted as
successful validation.

## Production references studied before implementation

- VS Code [web workbench bootstrap](https://github.com/microsoft/vscode/blob/main/src/vs/code/browser/workbench/workbench.ts)
  and [server-supplied configuration](https://github.com/microsoft/vscode/blob/main/src/vs/server/node/webClientServer.ts):
  composition declares services rather than discovering them by failed requests.
- [Remote agent composition](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/remote/common/abstractRemoteAgentService.ts):
  no remote authority means no remote-agent connection.
- [Browser filesystem provider](https://github.com/microsoft/vscode/blob/main/src/vs/platform/files/browser/indexedDBFileSystemProvider.ts)
  and [IndexedDB transaction owner](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/indexedDB.ts):
  browser storage behind the ordinary file boundary, transaction-completion
  acknowledgement. BMSX retains its smaller existing record contract; it does
  not copy upstream's fallback providers or introduce a second source model.

- [Working-copy Save](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.ts)
  and [browser backups](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/workingCopy/browser/workingCopyBackupService.ts):
  canonical write acknowledgement and recovery have independent owners. See
  [source-save contract](studio_source_save_acknowledgements.md).
- VS Code's [source-map source admission](https://github.com/microsoft/vscode-js-debug/blob/main/src/adapter/sourceContainer.ts)
  and esbuild's [original-source representation](https://github.com/evanw/esbuild/blob/main/internal/sourcemap/sourcemap.go):
  retain authored text at the producer instead of reconstructing it from output.
- VS Code's [Explorer model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/common/explorerModel.ts):
  workspace membership is independent of the debugger's active execution scope.
- esbuild's [build dependency tracking](https://github.com/evanw/esbuild/blob/main/internal/bundler/bundler.go):
  producer file/directory inputs participate in incremental invalidation.
