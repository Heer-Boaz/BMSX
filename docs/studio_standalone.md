# Standalone IDE / Studio

Studio does not require the BMSX development server or Codex. Use the ordinary
`studio.html` / `studio.debug.html` product with its BIOS, cartridge and browser
assets. The minimal `index.html` player remains a separate product; it does not
acquire the IDE or an agent dependency.

## Composition, not a failed connection

The built page contains `bmsx-studio-services=standalone`. The existing
`serve-dist.mjs` substitutes `server` in the response, without changing the file
on disk. Browser startup consumes that declaration once; there is no server
probe, heartbeat, hostname guess or catch-and-switch fallback.

| Capability | Standalone Studio | Development-server Studio |
| --- | --- | --- |
| Source editor, Undo/Redo, diagnostics, source-based execution | Existing local owners | Same owners |
| Lua Terminal, debugger, frame controls, Actor/Scene/Scenario tools | Existing local owners | Same owners |
| Canonical source Save and new Lua files | Browser IndexedDB | Project filesystem through authorized HTTP |
| Recovery / editor session | Browser-local, standalone namespace | Existing local/project recovery |
| Embedded assistant, native CLI history, external MCP window | Not connected; Codex view commands disabled | Existing independent transports |

Server-backed transport loss keeps the original workspace and recovery semantics;
it does **not** silently switch Save to another project. Ordinary connection
failures are still reported. This change neither copies accounts nor starts a
native Codex daemon. Local and trusted-LAN server composition remain identical.

Restart an already running development server once after updating the HTML
bootstrap code. Otherwise that older process still serves the static standalone
declaration. There is no new server command or assistant flag.

## Browser source persistence

`IndexedDbWorkspaceRecordProvider` implements the existing record-provider
contract, not a second text-model or source-history service. ROM-packaged authored
source is the initial base. Saved overrides, new files and session records live
in the `bmsx-studio-workspace` database. Source discovery admits newly created Lua
files independently of restored tabs and ROM membership.

Writes complete only when their IndexedDB transaction commits. Exclusive create
uses `add`, not a racy read-before-write. Indexed key cursors enumerate immediate
children and skip descendants without reading their text. No frame-time storage
or network work was added.

Save says **in this browser**, and its acknowledgement has `status: browser`.
This is distinct from `workspace` (project filesystem) and `local-only`
(recovery after a failed/disconnected canonical Save). Ordinary local recovery
still checkpoints before page exit; its standalone namespace cannot be replayed
into the filesystem when the same origin is later served by the development
server. No implicit migration/import joins these two authorities.

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

`npm run test:studio-standalone` exercises real Chromium IndexedDB, concurrent
exclusive creation, committed reads after reopen, directory discovery and
delete. Its product workflow uses actual keyboard/native clipboard input to
execute Lua (`6 * 7` returns `42`), create/edit/Save source, reload and copy the
restored source, then edit/Save with networking disabled. It records all browser
attempts to reach Studio endpoints, including offline attempts, and waits beyond
the previous reconnect interval: **zero requests and zero application errors**.

Screenshots in `/tmp/bmsx-studio-standalone/` cover the Terminal result, disabled
Codex menu alongside active local tools, browser Save and restored/offline source.
They are inspected visually, not asserted against exact message/row strings.
Two previously unhandled viewer commands found during this workflow now follow
the ordinary focus-scoped dispatch and enablement, instead of being globally
available outside their pane.

Targeted results (2026-09-29): standalone **2/2**, source Save/storage/provider
regressions **88/88**, workspace HTTP **7/7**, ordinary-server entry **5/5**, native
conversation browser product **1/1**, and real MCP browser product **1/1**.
IDE/Node/common-host typechecks and Studio debug/release, player and headless
tooling builds pass; the strict boundary audit reports zero issues.
These do not imply paid-model inference or physical-phone coverage.

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
