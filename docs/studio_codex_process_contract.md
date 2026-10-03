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

- `profile.ts` prepares the persistent account directory and admits a native
  process scope with private cwd/HOME/tmp directories. The scope owns their
  creation/removal and kernel lock. Environment inheritance is an explicit
  platform allowlist, not a `process.env` spread. No user credentials or global
  configuration are copied. Account data and the lock file survive process exit;
  scratch does not. The platform composition chooses these paths, never a
  browser or model.
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

A native startup probe reproduced a Git checkout still running after App Server
EOF and a successful direct-child exit. The plugin startup thread does not join
that checkout at main-process exit. A recursive-delete retry cannot establish
that the writer has stopped. Likewise, a dead controller or an available file
lock is not proof that all descendants are gone.

Ownership now uses a **named kernel process scope**, not a persistent
"unfinished" flag. The native controller owns the OS lock and scratch filesystem
mutations together. Node owns RPC and account/session policy; it no longer
removes or creates disposable directories asynchronously after lock admission.
This closes a second race: Node IO could otherwise continue deleting the fixed
scratch path after controller death and race a new owner.

| Responsibility | Node | Native / OS owner |
| --- | --- | --- |
| Account and explicit launch environment | `CodexProfile` | Account directory is never disposable |
| Workload argv/cwd/env | Binary launch record | Direct `execvp` / `CreateProcessW`, no command shell |
| Exclusive admission | Awaits `locked` | `flock` / `LockFileEx` on the persistent inode/file |
| Descendant identity | No process-tree snapshots | Named systemd scope / named Job Object |
| Disposable filesystem | Supplies root and directory names | Prepared and removed under the native lock |
| RPC retirement | Synchronous pending-request rejection | Independent status pipe; no RPC relay |
| Recovery | Next explicit connection | Join previous kernel membership before scratch reuse |

### Linux / WSL

The controller uses the systemd user-manager API, as in `systemd-run` and runc's
rootless cgroup owner. A scope name is derived from the locked file's device and
inode, not a PID. Before reporting admission, it stops and joins any previous
scope with that identity. Empty/collected scopes are already joined; systemd
retains units that still have living cgroup members.

A newly forked child waits on a launch pipe. `StartTransientUnit` admits that
unreaped child to its cgroup before the controller permits exec. If the controller
dies during admission, pipe EOF exits the still-blocked child without launching
work. `setsid`, double-forking and stdio closure do not change cgroup membership.
Normal App Server exit retires the same scope as forced shutdown. systemd job
completion is correlated by the returned job object path. The controller also
waits for `cgroup.events` to report no members (or for the kernel to remove that
empty cgroup); a successful StopUnit reply alone does not prove that a task stuck
in kernel IO has exited. Unit references pin metadata while it is being read.
Bus subscriptions exist only during start/stop jobs, not throughout a chat.

Node death closes the control pipe and the controller completes cleanup. If the
**controller itself** dies, RPC closes with an explicit error. The named scope
survives it; the next connection kills/joins that scope before touching scratch
or starting Codex. Remaining Linux tasks can run until that recovery is requested;
this is not a claim that systemd immediately kills a scope when its controller
disappears. No automatic prompt retry or additional inference is introduced.

### Windows

The Job Object is named from the locked file's volume/file identity in the global
object namespace. It has `KILL_ON_JOB_CLOSE` and no breakaway flags. The startup
attribute `PROC_THREAD_ATTRIBUTE_JOB_LIST` assigns the workload as part of
`CreateProcessW` itself, eliminating the former create-suspended/assign/resume
crash window. Only the workload's three stdio handles are inherited.

After controller death, the kernel terminates job members. A new owner opens any
remaining named job, terminates it and joins its active-process count before
creating a fresh job and preparing scratch. Normal teardown uses completion-port
notifications plus the authoritative count. Recovery cannot inherit the departed
controller's completion port, so it observes the kernel count only while joining.
This is not a PID scan or a timeout-based declaration of successful cleanup.

### Release, upgrade and host requirements

`owner.lock` must not be unlinked. Its kernel lock serializes admission; new code
never writes an unfinished-state marker to it. Normal release removes scratch
only after the process scope has drained, while still holding the lock. Account
credentials, conversation history and queued messages are retained.

Stop old server versions cleanly before upgrading. A **nonempty legacy lock**
from the previous implementation has no named kernel scope to recover and is
explicitly rejected, not silently treated as a new-format owner. Only that old
format needs offline recovery: establish that its old workloads have stopped
(a full reboot also establishes this), then truncate the existing lock without
unlinking it. Crashes of the new implementation do not produce this condition.

The helper is an optional Node-host product, built by
`npm run build:product:node-host-tools`. Existing `serve:dist` and
`serve:dist:wsl` pre-lifecycles prepare it automatically. Direct server execution
and Connect never invoke a compiler. Immutable executable generations and an
atomic publication keep running binaries separate from builds.

- Linux/WSL: **cgroup v2, a running systemd user manager and libsystemd**.
  Source builds additionally need a C++17 compiler and libsystemd development
  headers/library (`libsystemd-dev` on Debian/Ubuntu). The controller receives
  the host's XDG runtime/session-bus address; the admitted Codex environment does
  not inherit those additions. An unavailable user manager is an explicit error,
  not a weaker process-group fallback. This was exercised in the current WSL
  user session without changing host services or permissions.
- Windows: **Windows 10+**, built with MSVC. Runtime installations need the
  published executable, not the compiler or source tree.
- macOS: no backend yet. Other Studio, external CLI tools, build/workspace
  services and standalone emulator features remain independent of this product.

This is process/resource lifetime ownership, not a hostile-code sandbox. It does
not claim ownership of pre-existing external services or tasks deliberately
moved out of the scope through a service manager. A stuck kernel task can prevent
safe reuse; no timeout converts that into permission to erase its files.

### References and validation

Production implementations studied before this revision:

- [systemd transient-scope launch](https://github.com/systemd/systemd/blob/main/src/run/run.c),
  [job-completion observation](https://github.com/systemd/systemd/blob/main/src/shared/bus-wait-for-jobs.c)
  and [unit collection rules](https://github.com/systemd/systemd/blob/main/src/core/unit.c).
- [runc/cgroups user-manager connection](https://github.com/opencontainers/cgroups/blob/main/systemd/user.go)
  and [scope lifecycle](https://github.com/opencontainers/cgroups/blob/main/systemd/common.go).
- [Microsoft hcsshim job ownership](https://github.com/microsoft/hcsshim/blob/main/internal/jobobject/jobobject.go)
  and [atomic process/job startup](https://github.com/microsoft/hcsshim/blob/main/internal/exec/exec.go).
- [Windows Job Object lifetime](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects),
  [startup attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
  and [Node exit versus stream closure](https://nodejs.org/api/child_process.html#event-exit).

Evidence for this revision is retained under
`.bmsx/authoring/codex-kernel-ownership-20261003/`. Linux/WSL and native Windows
checks exercise real OS processes, detached grandchildren, paused/inherited RPC
pipes, shutdown, host/controller SIGKILL, and profile reuse after recovery.
The actual existing server and installed Codex were exercised with a deliberately
held **local** plugin Git checkout: controller SIGKILL, explicit stream error,
server still available, successful reconnect, old checkout confirmed stopped,
and account sentinel retained. No account login, token copy or paid inference
was used. This is host/process evidence, not a visual Studio or model-quality
claim. The separate runtime-product probe uses a relocated bundle without build
sources/compiler and with an empty PATH.

On 2026-10-03, 84 Linux/WSL integration checks and 20 native Windows checks passed
(three POSIX-only cases skipped on Windows). A separate 250-cycle immediate-exit/
reacquisition probe reused the same kernel-scope identity successfully. A missing
user-manager probe rejected admission explicitly without a fallback or unfinished
marker. Node/tests/scripts typechecks and the architecture-boundary audit passed.
