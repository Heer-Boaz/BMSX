# Codex process admission: measured protocol, not a privileged RPC tunnel

Audit at `52a655924`; local executable **codex-cli 0.156.1**. The source/context/
review foundation is implemented. This document and its executable probes do
**not** expose an agent endpoint or attach a process to the workbench yet.

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

The real stdio process accepts initialize/initialized, an ephemeral read-only
thread with experimental dynamic tools, and turn/start. A dynamic request names
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
   Disable shell/unified execution, code-mode host, plugins/apps, browser/computer
   use, image generation, hooks, workspace dependencies, memories, multi-agent
   and goal features for this profile. Admit only the measured version and
   actual read-only/no-network sandbox result, with no permission escalation.
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

No endpoint should be added until the adapter implements the owned profile,
capability admission and connection lifetime above. The existing loopback file
capability is not permission to turn `serve-dist` into a general process proxy.
