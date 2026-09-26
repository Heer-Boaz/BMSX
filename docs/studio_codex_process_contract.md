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

The version gate is exact. A changed CLI needs another contract audit, not a
silent compatibility path or guessed SDK types. Generated files were inspected
outside the checkout; the test does not import a whole external DTO tree into
Studio.

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
   or a cart's project MCP/hook/plugin configuration. Source arrives through
   workbench tools, not direct reads of an out-of-date filesystem copy. Account
   connection is an explicit product capability of that profile; do not copy or
   rewrite existing CLI credentials as a shortcut.
2. **Pinned capability set.** Before thread creation, inspect the external
   process's effective configuration and reject unowned MCP/process capabilities.
   This profile grants the embedded CLI its full capability set: shell and unified
   execution, the code-mode host, plugins/apps, browser/computer use, image
   generation, hooks, workspace dependencies, multi-agent and goal features, with
   a `danger-full-access` sandbox and live web search. Two exceptions are measured,
   not stylistic: `memories` runs a second billed inference after every turn and
   breaks the guarantee that browsing starts no inference, and the startup update
   check reaches api.github.com for no capability the session asked for. Admission
   still binds: the measured CLI version, the launch policy actually in effect with
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
5. **Models remain authoritative.** Reads create resource/version receipts from
   `WorkspaceSourceContext`; proposed edits cross the external protocol's own
   boundary and produce `WorkspaceEditProposal`. Only explicit review Apply
   reaches shared history. Save/build/run/test retain their own operation rights
   and results. No process gets a second source-writing route.

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

- `profile.ts` creates an exclusive private process lease with empty HOME/XDG
  directories, private cwd/tmp and a separate persistent Codex account directory.
  Environment inheritance is an explicit platform allowlist, not `process.env`
  spread. Only the account directory (including native threads/queues) survives normal process exit. No user
  credentials/configuration are copied; conflicting leases fail rather than
  guessing that a lock is stale. The platform composition must choose this
  application-owned directory, never accept it from a browser or model.
- `policy.ts` emits the pinned external TOML launch representation and admits
  actual configuration layers. Every nonempty non-Studio layer is rejected,
  including otherwise harmless user or managed overrides. Empty-map merging is
  never treated as revocation. Admission repeats at turn start because account/
  managed configuration can change after connection. Shell/patch environments,
  MCP, skills discovery, plugins and other executable capabilities are absent
  from the measured tool surface. No permissions can escalate.
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

The actual adapter advertises only the supplied `studio_read` in the offline
fixture: disabling orchestrator skills and host skill discovery removes the
earlier `skills` namespace. This is the tested model metadata/version, **not** a
claim that all model catalogs expose identical utility tools. The CLI's own
builtins are admitted alongside the Studio tools, so a turn can write source and
run commands directly. What stays bounded is the browser boundary: the session
forwards only `item/tool/call` for a registered Studio tool and refuses every
other server request. There is no OS-wide protection against a hostile same-user process
altering the binary or directories; this is process/capability ownership, not an
OS sandbox certification.

`npm run test:codex-session` covers the real adapter against local Responses SSE,
unowned MCP and changed config, exact version rejection, profile exclusivity,
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
