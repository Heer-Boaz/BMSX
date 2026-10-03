# Codex process admission: measured protocol, not a privileged RPC tunnel

Audit at `52a655924`; local executable **codex-cli 0.156.1**. The source/context/
review foundation and the Node process adapter below are implemented. The later
[browser transport](studio_assistant_transport.md) exposes fixed Studio operations
through fixed endpoints on the existing development server, not provider RPC. The subsequent
[contribution](studio_assistant_contribution.md) implements account connection and
the visible workbench assistant; the sections below retain the original audit
and record its account follow-through separately. Persistent history, native
queue/steering, stop/resume and cold-resume capability admission supersede the
original ephemeral-thread scope in [conversation lifecycle](studio_assistant_conversations.md).

## Protocol evidence

The installed executable supplies its own current TypeScript protocol with:

```sh
codex --version
codex app-server generate-ts --experimental --out /tmp/bmsx-codex-protocol
npm run test:codex-contract
```

The original audit used an exact version gate; that gate has been removed.
Current admission checks capabilities and effective configuration, not a CLI
version pin. `initialize.userAgent` identifies the admitted process; startup no
longer launches an independent `--version` process. Generated files are inspected
outside the checkout, not imported as an external DTO tree into Studio.

The real stdio process accepts initialize/initialized, a thread carrying the
admitted sandbox and experimental dynamic tools, and turn/start. A dynamic request names
the thread, turn, call and JSON-RPC request separately. Returning `inputText`
content reaches the next model request. `turn/interrupt` completes a turn waiting
for a client tool; EOF also drains that pending process without forced termination.

Five contract tests pass against the actual installed executable. A deterministic
local Responses SSE fixture supplies the model outputs: **no real model request,
account token, paid inference, or user Codex configuration is used**. Private test
profiles and authored canary files are removed only after actual process exit.
This is protocol/capability evidence, not an end-to-end Studio assistant claim.

## Important failed assumption

**`-c 'mcp_servers={}'` does not remove inherited MCP servers.** The real config
merge preserves them. The first admission experiment tried that override with a
deliberately configured test MCP executable; thread creation still launched it.
Read-only shell sandboxing did not prevent MCP startup. All three initial probes
failed at that exact boundary before reaching a model request.

The retained regression inspects the merged configuration before a thread exists
and proves that empty-map assumption false, without launching that process.
Likewise, the locally generated `ThreadStartResponse` explicitly describes
`disabledPluginIds` as persisted metadata that does not yet filter capabilities.
Neither field is an authorization boundary. An instruction saying "only edit
through Studio" would not repair this ownership error.

## Admitted direction for the local adapter

1. **Owned profile and process directory.** Use a dedicated Studio Codex profile
   and a private non-project working directory. Do not import the user's global
   or a cart's project MCP/hook/plugin configuration. Studio tools expose the
   current working copy; native filesystem tools operate on the workspace, not
   a separate source mirror. Account
   connection is an explicit product capability of that profile; do not copy or
   rewrite existing CLI credentials as a shortcut.
2. **Explicit capability set.** Before thread creation, inspect the external
   process's effective configuration and reject unowned MCP/process capabilities.
   This profile grants the embedded CLI its full capability set: shell and unified
   execution, the code-mode host, plugins/apps, browser/computer use, image
   generation, hooks, workspace dependencies, multi-agent and goal features, with
   a `danger-full-access` sandbox and live web search. Two exceptions are measured,
   not stylistic: `memories` runs a second billed inference after every turn and
   breaks the guarantee that browsing starts no inference, and the startup update
   check reaches api.github.com for no capability the session asked for. Admission
   still binds: the launch policy actually in effect with
   no unowned configuration layer, and the sandbox the thread reports back.
   Tool dispatch requires the code-mode host; with it off every Studio tool call
   fails in `dispatch_tool_call_with_state`. Approvals stay `never` because the
   session answers no approval request.
3. **No arbitrary JSON-RPC forwarding.** Browser requests express Studio
   operations, not Codex method names/config/cwd/permissions. The Node owner
   constructs thread/turn parameters, owns request correlation and rejects
   permission/file/command approvals. Stdio remains private to that process;
   there is no public App Server WebSocket listener.
4. **Workspace lifetime first.** A browser connection owns a process/session
   lease. Disconnect, workspace replacement and shutdown retire pending tool
   requests and captured contexts. Reconnect cannot reissue an old tool reply or
   revive an edit proposal from an old conversation. Token refresh and protocol
   reconnect are not source-edit authorization.
5. **Source owners remain authoritative.** Studio reads create resource/version receipts from
   `WorkspaceSourceContext`; proposed edits cross the external protocol's own
   boundary and produce `WorkspaceEditProposal`. Only explicit review Apply
   reaches shared history. Save/build/run/test retain their own operation rights
   and results. The explicitly enabled CLI filesystem tools can also edit the
   workspace; those writes enter Studio through its ordinary source observation.

The isolated probe's actual advertised tools are `request_user_input`, `skills`
and the supplied `studio_read`. Injecting unadvertised `apply_patch`,
`exec_command` and `shell` calls returns unsupported-tool results and leaves the
canary unchanged. This proves the tested configuration/version, not all future
versions or OS-wide confinement. Remaining read capabilities and authentication
must still be accounted for when composing a production profile.

## Primary references studied

- OpenAI Codex [`dynamic_tools.rs`](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/suite/v2/dynamic_tools.rs)
  and [`Responses test fixtures`](https://github.com/openai/codex/blob/main/codex-rs/core/tests/common/responses.rs):
  test the real App Server against deterministic local model events, rather than
  only a fake JSON-RPC process.
- Official [App Server protocol](https://learn.chatgpt.com/docs/app-server) and
  [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference):
  dynamic-tool negotiation and configurable capabilities. The installed binary
  and executed probes, not documentation alone, determine version admission.

## Owned Node adapter

`hosts/node/codex` is the process boundary, not an IDE model owner or a general
process-launch service:

- `profile.ts` acquires the supervisor-owned kernel lock and creates empty HOME/XDG
  directories, private cwd/tmp and a separate persistent Codex account directory.
  Environment inheritance is an explicit platform allowlist, not `process.env`
  spread. Account data (including native threads/queues) and the persistent lock
  file survive normal process exit; scratch does not. Admission checks the
  previous ownership interval as well as the kernel lock. No user credentials or
  configuration are copied. Conflicting live locks fail rather than guessing
  ownership from filesystem contents. The platform composition must choose this
  application-owned directory, never accept it from a browser or model.
- `policy.ts` emits the explicit external TOML launch representation and admits
  actual configuration layers. Every nonempty non-Studio layer is rejected,
  including otherwise harmless user or managed overrides. Empty-map merging is
  never treated as revocation. Admission repeats at turn start because account/
  managed configuration can change after connection. The explicitly enabled
  native capabilities include shell/patch and plugin tools; this is lifetime
  ownership and browser-operation admission, not an OS security sandbox.
- `stdio.ts` continuously drains responses, notifications and server requests.
  Outstanding requests have independent correlation and deadlines; waiting for
  a Studio tool never blocks an interrupt or other response. Protocol failure,
  timeout, EOF and shutdown retire rights synchronously. EOF gets a bounded drain;
  a hung process is killed and reported as forced, not called a graceful success.
  Stderr retention is bounded. There is no notification backlog or automatic
  reconnect/replay queue.
- `session.ts` owns one conversation and one active turn. Its public operations
  include account inspection/loopback and device-code login/cancel/logout, fixed history and
  queue operations, turn start/steer, interrupt and close, not arbitrary Codex methods. Every tool request must match the current thread, turn and admitted
  tool. Other server requests (including approvals and token refresh) are denied.
  Cancellation aborts pending tool work immediately; late results cannot answer
  a subsequent turn. A session-wide AbortSignal also covers startup. `closed`
  joins actual process exit and releases the lease, once.

The original isolated adapter audit supplied only `studio_read` in its offline
fixture. This is historical tested model metadata/version, **not** a
claim that all model catalogs expose identical utility tools. The CLI's own
builtins are admitted alongside the Studio tools, so a turn can write source and
run commands directly. What stays bounded is the browser boundary: the session
forwards only `item/tool/call` for a registered Studio tool and refuses every
other server request. There is no OS-wide protection against a hostile same-user process
altering the binary or directories; this is process/capability ownership, not an
OS sandbox certification.

`npm run test:codex-session` covers the real adapter against local Responses SSE,
unowned MCP and changed config, version metadata, profile exclusivity,
turn interruption/admission/disconnect and late replies. Faulty stdio peers also
cover out-of-order responses amid 10,000 notifications, nested requests, malformed
frames, unknown response identities, process crash, launch failure and forced
timeout teardown. These fixtures do not connect an account or make paid/remote
model requests. The original five `test:codex-contract` probes remain independent.

Adapter validation: **19 session/transport tests**, **5 independent contract
tests**, and **6 existing real HTTP tests** pass. IDE/browser/Node typechecks and
the strict architecture audit pass (zero boundary issues). Changed-file
indentation and `git diff --check` pass. This slice adds no render/frame work and
does not claim browser assistant or account-login evidence.

Before implementation, the matching pinned production references were studied:
Codex's [app-server client](https://github.com/openai/codex/blob/b4b055cfc8fccc0040d13aa4304cf9ba61c2e27e/codex-rs/app-server-client/src/lib.rs)
separates response processing from tool/event waits and joins shutdown; its
[tool plan](https://github.com/openai/codex/blob/b4b055cfc8fccc0040d13aa4304cf9ba61c2e27e/codex-rs/core/src/tools/spec_plan.rs)
and [skills extension](https://github.com/openai/codex/blob/b4b055cfc8fccc0040d13aa4304cf9ba61c2e27e/codex-rs/ext/skills/src/extension.rs)
establish capability ownership. VS Code's [child-process IPC owner](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/base/parts/ipc/node/ipc.cp.ts)
ties active requests and listeners to process lifetime. BMSX deliberately does
not adopt its lazy reconnect behavior for source-edit authority.

The [workbench source tools](studio_source_tools.md) are now exercised through
this adapter with the real process and an offline model fixture. The secured
[browser lease transport](studio_assistant_transport.md) now has its own real
HTTP/Chromium evidence. The [conversation contribution](studio_assistant_contribution.md)
now composes the pane and fixed account actions; the workspace
capability never admits a general process proxy.
The fixed [test-evidence tools](studio_test_evidence.md) now read the same retained
results as Scenario Lab through this chain, without adding execution authority.

## Account and exact-output follow-through

The adapter admits two login methods. `chatgpt` is the ordinary browser sign-in:
the app-server owns the loopback listener, steps off a port another application
holds, and its authorization URL is admitted structurally -- `https://auth.openai.com`
`/oauth/authorize` with an `http://localhost|127.0.0.1/auth/callback` redirect, with
the port deliberately unpinned. `chatgptDeviceCode` keeps the pinned official
`https://auth.openai.com/codex/device` destination, for a browser that cannot reach
the loopback callback. An unadmitted destination retires the process.

A loopback grant can only return to this host, so the browser that must receive it runs
here: Node composition supplies the opener and the process owner hands it the admitted
address, the way the Codex CLI does. The browser page never opens it, because a popup
raised from the event stream is outside a user gesture and a reusable handle would give
the sign-in page an opener. A failed open is published; the address stays in the
transcript with `/open` as the manual route.
The process owns login IDs and cancellation, including cancellation before the
start response and completion arriving before that response's continuation.
Account changes invalidate the old conversation thread and publish a fresh
`account/read` snapshot; changes during a turn terminate its connection.
The Node owner closes prompt/login/logout admission **before** publishing the
refresh notification, then reopens it only for the latest completed read. A
command arriving before the browser has disabled its controls cannot race that
transition. Older account reads cannot clear a newer refresh's admission latch.

`tool_output_token_limit` is set to `Number.MAX_SAFE_INTEGER`, a protocol setting
that disables lossy history truncation for any JS-representable source result,
not a preallocation or a larger model context. Effective configuration admission
checks it. The actual-cart browser test verifies full JSON catalog/read receipts
beyond the default truncation size. Context overflow still fails at the provider;
Studio never repairs missing source bytes or treats a shortened receipt as exact.

`test:codex-account` has fourteen passing cases. A real pinned process uses a local
issuer to exercise device-code request/poll/cancel/logout with no credentials.
An explicitly test-only relay rewrites that issuer's verification URL, substitutes
unadmitted loopback authorization URLs, and injects notification ordering for the
production session adapter tests. The loopback round trip is exercised end to end
against the local TLS proxy: admitted URL, browser callback, grant and token
exchange, the listener's success page, then a readable account. The unmodified
local URL is rejected by production admission.

Successful authorization is now tested separately through a non-forwarding local
TLS proxy with synthetic tokens. Official account URLs, CLI configuration, RPC
responses and production admission remain unchanged. The test executable alone
trusts the temporary CA generated by `openssl`; no global trust/config is changed.
Real OAuth exchange writes the private mode-0600 profile, an explicit new process
reads it, and real logout revokes the synthetic refresh token and removes the file.
Three regressions issue operations during account refresh: logout reproduced the
old admission hole, and prompt/login/logout now all reject before any RPC is sent.
The proxy has no inference endpoint or remote-forwarding path. Successful browser
login/reconnect/logout runs on all three renderers. This is not personal account
authorization, token-refresh or paid-inference verification.

## Background process shutdown

A controlled native startup reproduced a Git checkout still running after
`CodexStdio.stop()` had returned `{code: 0, signal: null, forced: false}`. The
upstream plugin manager starts its curated-repository synchronization on a
background OS thread; the Git subprocess can outlive the App Server. Retrying
recursive directory removal would race that writer rather than join it.

The initial POSIX-group fix has been replaced, not wrapped. A separate native
supervisor in `hosts/node/process_scope` owns both the kernel lock and all
descendants. It is detached from Node's own process group/job so Node's abrupt
exit or SIGKILL cannot release the profile ahead of its background writers.
Request/status pipes belong only to Node and the supervisor; workload stdio
passes directly through inherited handles. There is no RPC relay, notification
polling, global `ps` scan or emulation-frame work.

- **Linux/WSL:** `PR_SET_CHILD_SUBREAPER` adopts orphaned descendants, including
  `setsid`/double-fork children. The workload has its own process group so its
  group signals cannot kill the supervisor. Shutdown kills unreaped direct children and
  continues on `SIGCHLD` as further descendants are adopted. Only `waitpid`'s
  `ECHILD` proves completion. `/proc/self/task/<tid>/children` names children of
  this single-threaded owner; it is not a cross-process PID/ancestry heuristic.
  A PID is never reused between discovery and kill because this owner has not
  reaped it. `flock` retains exclusive ownership through the whole join.
- **Windows:** a Job Object has `KILL_ON_JOB_CLOSE` and no breakaway flags. The
  child is created suspended, assigned to that job and only then resumed.
  Nested jobs/detached grandchildren remain in the outer job. Shutdown waits
  for the kernel's active-process count to reach zero. Completion-port messages
  wake the wait; periodic count observation during teardown handles Microsoft's
  documented non-guaranteed notification delivery. `LockFileEx` retains the
  profile lock until after that barrier. Separate request/status pipe handles
  avoid synchronous Windows duplex-pipe serialization.

EOF remains normal App Server shutdown; a deadline requests forced scope
termination. Natural main-process exit also retires residual descendants. A
paused stdout is drained before RPC closure. `forced` records an App Server
timeout, not the retirement of leftover children. No capabilities, plugins or
account settings are disabled. `initialize` supplies version metadata without
an extra unsupervised version probe.

`owner.lock` is persistent and must **not** be unlinked to recover a session.
Its existence says nothing about ownership. The kernel lock serializes owners;
its length records whether the previous ownership interval completed. Admission
requires an empty file, then marks it nonempty and flushes it **before** reporting
ownership. Normal release joins descendants, removes `lease/` scratch while still
locked, then closes the supervisor's control pipe. Only joined release clears
and flushes the file. After Node host death, control-pipe EOF makes the supervisor
join independently and complete the same interval. The next acquisition can
dispose of abandoned scratch; `account/` is never removed. A live competing
owner is refused. EOF partway through a launch request creates no workload and
also completes the interval. A termination signal cannot revive a late launch
or release the lock while Node is still removing scratch.

The distinction matters: an actual supervisor-SIGKILL probe reproduced both a
connection that never settled and profile reacquisition that erased scratch
while the old workload was still running. An available OS lock did **not** prove
that those descendants had exited. Now an interrupted interval refuses reuse,
retaining account data and unjoined scratch. This is an explicit ownership
failure, not automatic recovery by deleting a lock or guessing from process IDs.
Unlike ordinary Node-server death, loss of the supervisor requires deliberate
offline recovery; there is no claim of automatically joining orphaned Linux
processes after their subreaper itself has died.

Offline recovery is a separate operator action, not a reconnect heuristic: stop
Studio servers and establish that the old workload is gone (a full host reboot
also establishes this). Then truncate **only** the existing `owner.lock` to zero
bytes, without unlinking it; retain `account/`. The next normal acquisition
removes abandoned scratch. Never clear the interval merely because the server
PID is absent. Routine Node-server restart/SIGKILL needs none of this because
the surviving supervisor completes the interval itself.

Node observes supervisor `exit` and the end of its exclusive status pipe, not
the child-process `close` event (which waits on inherited workload pipes). It
first consumes final status records, then retires the invalid RPC streams.
Closure carries an error result through the session to the browser even when
profile release fails. The main server stays available.

This is lifecycle ownership of descendants, not containment of a hostile
administrator or an existing external service. Changing workload credentials so
they are no longer killable or unlinking the lock file is outside this contract.
Stop old server versions before upgrading: their directory-only leases do not
participate in the new kernel lock.

### Native product and host support

The helper is an optional **Node host** product, not machine/runtime C++ code.
`npm run build:product:node-host-tools` prepares it through the existing product
builder. `serve:dist` and `serve:dist:wsl` npm pre-lifecycles run this preparation
automatically; no new server command is required. The account/session/HTTP test
entrypoints do the same. Direct `node scripts/serve-dist.mjs` is a runtime entry:
it does not build. A missing artifact produces an explicit build instruction
on Connect, without breaking the server's other services.

The build owner uses C++17 (Linux `CXX`/`c++`, Windows MSVC). Windows toolchain
setup supplies an environment; source paths/arguments are passed directly to
the compiler, not interpolated into a command shell. A source/recipe fingerprint
avoids repeat compilation. Each completed executable generation is immutable
under `.bmsx/host-process-scope`, outside the served browser product. An atomic
platform/architecture publication selects the generation. Running supervisors
are never overwritten, including on Windows. The runtime reads that publication;
it has no build-module dependency and needs neither a compiler nor build sources.

Supported scope backends remain Linux/WSL and native Windows. macOS has no
implementation of this stronger lifetime contract; it is not approximated with
a process-group or PID-tree scan. Optional host-tool preparation skips that
backend, and server composition omits the embedded assistant capability. Studio,
workspace/build services, external CLI history and MCP remain separate. This is
capability handling, **not** a claim that macOS process supervision was restored
or validated. Standalone player/Studio never imports this Node-only product.

References studied before implementation:
- [Codex plugin startup owner](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/core-plugins/src/manager.rs)
  and [Git subprocess lifetime](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/core-plugins/src/startup_sync.rs).
- [Codex process-group ownership](https://github.com/openai/codex/blob/604061ce51d194a3aa6aad3b3170240d096e1725/codex-rs/utils/pty/src/process_group.rs)
  and [VS Code process-tree termination](https://github.com/microsoft/vscode/blob/main/src/vs/base/node/processes.ts).
- [Tini's subreaper, signal and reaping implementation](https://github.com/krallin/tini/blob/master/src/tini.c).
- [libuv's Windows process implementation](https://github.com/libuv/libuv/blob/v1.x/src/win/process.c):
  its global job deliberately permits descendant breakaway, so it is not enough
  for this profile ownership contract.
- [Microsoft hcsshim Job Object owner](https://github.com/microsoft/hcsshim/blob/main/internal/jobobject/jobobject.go)
  and [Windows completion-port guarantees](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_associate_completion_port).
- [Node child-process lifecycle](https://nodejs.org/api/child_process.html#subprocesskillsignal):
  signaling is not proof of exit, and descendants are not joined by the parent's
  close event when they do not inherit its stdio.
- [MongoDB's POSIX lock-file lifecycle](https://github.com/mongodb/mongo/blob/master/src/mongo/db/storage/storage_engine_lock_file_posix.cpp)
  and [Windows counterpart](https://github.com/mongodb/mongo/blob/master/src/mongo/db/storage/storage_engine_lock_file_windows.cpp):
  separate live mutual exclusion from evidence of incomplete shutdown. BMSX does
  not infer safe reclamation from a stale PID or borrow database recovery logic.
- [node-pty's native build targets](https://github.com/microsoft/node-pty/blob/main/binding.gyp)
  and [installation/package boundary](https://github.com/microsoft/node-pty/blob/main/package.json):
  native helpers are built/installed artifacts, not compiled when a user opens
  a connection. This does not require adopting its PTY semantics or Node ABI.
- [Node's exit-versus-close contract](https://nodejs.org/api/child_process.html#event-exit)
  and [XNU's process-event interface](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/event.h):
  distinguish direct process exit from stream lifetimes; do not invent a portable
  descendant-ownership guarantee from generic process notifications.

The native regression uses a local Git repository and a controlled checkout
filter, with ordinary native plugin startup still enabled. Real OS peers cover
graceful exit, a crash with inherited/paused stdout, forced shutdown, detached
children, orphaned grandchildren, abrupt host exit and host SIGKILL. Reacquisition
checks descendant death and retained account data, not just a missing directory.
No personal account login, public repository download or paid inference is used.

Validation on 2026-10-03 (ownership/build revision):

- 84 Linux/WSL checks pass. Regression coverage includes workload groups, detached orphans,
  supervisor loss while running/after drain, partial launch EOF and termination
  crossing startup, alongside account/session/HTTP/entry/socket/observer checks.
- 20 checks pass under native Windows Node, exercising the same lifecycle
  adapter and compiled MSVC supervisor; three POSIX-only cases are skipped.
  Those remain Linux evidence, not claimed Windows App
  Server/login coverage.
- The actual `serve-dist.mjs` entry and installed Codex were also exercised with
  a held local Git checkout: SIGKILL of Node, a new server using the same profile,
  successful reconnect, confirmed old checkout exit, retained account sentinel
  and normal joined shutdown. This is real server/process evidence, not a UI or
  paid-model claim.
- A separate actual-server/native-Codex probe kills the supervisor: the browser
  stream receives its explicit closure error, the server still serves requests,
  reacquisition returns 503 rather than touching the unfinished profile, and
  account data is retained.
- A relocated runtime bundle with **no build sources, no compiler and empty
  PATH** launches the published supervisor, exchanges RPC and releases its
  profile. Missing publication reports a build error without attempting a build.
- `npm run test:codex-session` also exercises automatic product preparation
  and passes all 48 checks. Node, tests and scripts typechecks, the strict
  architecture-boundary audit and `git diff --check` pass.
- Evidence is retained in `.bmsx/authoring/codex-scope-architecture-20261003/`;
  the earlier `.bmsx/authoring/codex-process-scope-20261003/` records the original
  implementation, not proof that supervisor-loss handling was already correct.
