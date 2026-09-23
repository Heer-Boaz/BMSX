# Studio local platform boundary

Status: local file-transport boundary implemented. Audit baseline `d320e771c`.
The later opt-in [assistant transport](studio_assistant_transport.md) reuses this
admission owner; default serving and LAN presentation still grant no process rights.

## Scope and threat model

At the audit baseline, the HTTP server combined public static product presentation and a
workspace file API. It bound all interfaces, sent wildcard CORS, admitted writes
without session authorization and only checked lexical path containment. A
symlink could cross that boundary. These were real existing capabilities, not
reasons to preemptively add an agent endpoint.

The supported authoring boundary will be a loopback-bound local server with
exact Host/origin admission and an in-memory, per-process workspace capability.
The browser file provider owns acquiring/coalescing that capability and replacing
it after an explicit unauthorized response from a restarted server. Credentials
must not enter URLs, local storage or logs. Denied requests must reach neither
filesystem writes nor file/directory reads. Paths must remain within the chosen
workspace/static roots, including symlinks.

An explicit non-loopback binding serves static products and the ROM catalog
only; it must not expose a workspace capability, even via a local reverse proxy.
The normal development command defaults to loopback. This is not remote IDE
authentication, protection against a malicious local OS user/filesystem race,
or an admissible generic process launcher. Same-origin product JavaScript is
trusted. Agent process permissions, review and protocol lifetime are separate
gates. This original file-boundary slice introduced no subprocess endpoint.

## Implemented owners and use

- `scripts/dev/http_security.mjs`: per-process random capability, constant-time
  authorization, exact local Host/origin and Fetch Metadata admission. Bootstrap
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

Use `npm run serve:dist` for local Studio authoring (127.0.0.1 by default).
`--host 0.0.0.0` and `npm run serve:dist:wsl` are explicitly static-only LAN
presentation; Studio cannot acknowledge project-file saves through those modes.
Static ROM catalog/player presentation still works. This deliberate capability
split replaces the old implicitly writable LAN behavior.

## Validation

- Six HTTP process tests failed against the old server and now pass: denied
  unauthenticated IO; authorized CRUD/timestamps/exclusive create; hostile,
  opaque and mismatched origins; raw Host rebinding; preflight/bootstrap;
  traversal/symlink escape for read/write/delete/list/static; LAN capability
  denial; process-local tokens and static method/embedding/isolation headers.
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

- VS Code's [remote server request admission](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/server/node/remoteExtensionHostAgentServer.ts#L113-L205)
  authenticates before remote resource access and only admits selected CORS
  origins. BMSX needs no remote extension host or protocol negotiation here.
- Its [server connection token owner](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/server/node/serverConnectionToken.ts)
  owns capability creation/validation separately from workbench features.
  BMSX will use an ephemeral local capability, not persistent token files,
  URL credentials or optional authentication compatibility modes.
