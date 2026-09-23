# Studio development-server boundary

Status: local file-transport boundary implemented. Audit baseline `d320e771c`.
The [assistant transport](studio_assistant_transport.md) reuses this admission
owner in the ordinary server, including LAN bindings. The initial static-only LAN
restriction was removed on 2026-09-24 to preserve the user's network workflow.

## Scope and threat model

At the audit baseline, the HTTP server combined public static product presentation and a
workspace file API. It bound all interfaces, sent wildcard CORS, admitted writes
without session authorization and only checked lexical path containment. A
symlink could cross that boundary. These were real existing capabilities, not
reasons to preemptively add an agent endpoint.

The authoring boundary is the existing development server, with admitted
Host/exact origin checks and an in-memory, per-process workspace capability.
The browser file provider owns acquiring/coalescing that capability and replacing
it after an explicit unauthorized response from a restarted server. Credentials
must not enter URLs, local storage or logs. Denied requests must reach neither
filesystem writes nor file/directory reads. Paths must remain within the chosen
workspace/static roots, including symlinks.

Binding to the LAN exposes Studio source IO and explicit Codex connections as
well as static products. The normal development command still defaults to
loopback; the existing WSL/LAN launcher binds all IPv4 interfaces. This is a
trusted-network development server, not remote user authentication: a client
that can reach the server can request its platform capability. Same-origin
checks prevent unrelated browser origins from reading it; they do not identify
or isolate LAN users. No new login gate or public multi-user hosting is implied.
Agent process permissions, review and lease lifetime remain separate owners.

## Implemented owners and use

- `scripts/dev/http_security.mjs`: per-process random capability, constant-time
  authorization, Host/origin and Fetch Metadata admission. Literal IPv4/IPv6
  addresses, localhost, the machine hostname (including its `.local` spelling) and the configured bind hostname
  are admitted at the listening port; arbitrary DNS names remain rejected to
  prevent rebinding. This supports LAN/WSL forwarding without per-request DNS or
  interface scans. Bootstrap
  requires a non-simple Studio request. No wildcard CORS or embedding permission.
- `scripts/dev/workspace_api.mjs`: authorized file/directory IO; exclusive create
  remains a filesystem operation, not a read-before-write check. File handles
  close after reads/writes; source timestamps and record semantics are unchanged.
- `scripts/dev/rooted_path.mjs`: shared workspace/static path admission rejects
  traversal and symlink components. Final file opens use `O_NOFOLLOW`. This is not
  an OS sandbox against concurrent hostile changes to ancestor directories.
- `StudioHttpSession`: coalesced admission shared by browser platform consumers,
  capability held in memory. The file provider can renew/replay once after 401 because the server rejected it before
  any file operation; transport/500 errors are never automatically replayed.
  Local-only persistence/reconnect feedback remains owned by workspace records.

Use the existing `npm run serve:dist` (127.0.0.1 by default), its normal
`--host 0.0.0.0` binding or `npm run serve:dist:wsl`. All use the same source and
Codex endpoints. HTTP URLs and static serving are retained, with no additional
server, assistant startup flag or automatically started Codex process.

## Browser scope, including phones

Removing the LAN API restriction is not proof of a complete phone workflow.
The existing browser runtime requires a secure, cross-origin-isolated context
for its shared-memory audio backend; assistant source handles also use the
browser's secure-context UUID API. Chromium on plain HTTP at the actual LAN
address reports neither secure context nor isolation, despite COOP/COEP headers.
The mobile transport regression deliberately records that distinction rather
than overriding browser security and reporting a full Studio pass. This slice
does not change the audio/runtime, force HTTPS, install certificates or establish
physical-phone/Safari coverage.

## Validation

- HTTP process tests cover denied
  unauthenticated IO; authorized CRUD/timestamps/exclusive create; hostile,
  opaque and mismatched origins; raw Host rebinding; preflight/bootstrap;
  traversal/symlink escape for read/write/delete/list/static; real LAN source IO
  and shared assistant admission; IPv4/IPv6/machine host admission; process-local
  tokens and static method/embedding/isolation headers.
  Tests run against actual listeners and disposable files, not handler mocks.
- Three browser-provider cases cover coalesced admission, concurrent expired
  sessions, exact-once accepted writes, failed admission reconnect and bounded
  retry. Provider plus workspace persistence/recovery: **60 passed**.
- Full Lua suite **2293 passed, 1 skipped**. IDE/browser/Node typechecks and
  browser Studio product build pass; strict architecture audit **0 issues**.
  Full tests-project baseline remains **112 diagnostics**, not a green check.
- Real WebGL2 source-save workflow passes Lua/YAML/AEM project acknowledgement,
  HTTP write failure/local-only feedback and reconnect through the authorized
  provider. Visual-only resource context/Problems/navigation/shutdown, cold page
  session reload, and isolated test-runner workflows also pass. These are
  automated browser workflows, not UI-only authoring or remote-access proof.
- Changed-file indentation and `git diff --check` pass. No guest/runtime or
  frame-time changes; session negotiation happens on file IO, not per frame.

## Production references studied

- Vite's pinned [development Host admission](https://github.com/vitejs/vite/blob/v6.3.5/packages/vite/src/node/server/middlewares/hostCheck.ts#L54-L117)
  permits literal IP addresses and explicitly known names without allowing
  arbitrary rebinding domains. BMSX uses Node's URL/IP primitives at the shared
  HTTP owner, not a local parser in the assistant feature.
- VS Code's [server composition](https://github.com/microsoft/vscode/blob/1.104.0/src/server-main.ts#L52-L100)
  routes tooling through the existing server owner rather than requiring another
  user-facing server. BMSX retains its narrower fixed-operation/process contract.
- VS Code's [remote server request admission](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/server/node/remoteExtensionHostAgentServer.ts#L113-L205)
  authenticates before remote resource access and only admits selected CORS
  origins. BMSX needs no remote extension host or protocol negotiation here.
- Its [server connection token owner](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/server/node/serverConnectionToken.ts)
  owns capability creation/validation separately from workbench features.
  BMSX will use an ephemeral local capability, not persistent token files,
  URL credentials or optional authentication compatibility modes.
