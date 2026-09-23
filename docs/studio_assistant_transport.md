# Studio assistant connection: a local lease, not an RPC proxy

The browser and Node transport are composed with the
[workspace conversation and account controls](studio_assistant_contribution.md). `npm run serve:studio` explicitly enables the
adapter on the loopback Studio server. Ordinary `serve:dist` does not enable it;
`--assistant` on a non-loopback binding fails before opening a profile/process.
Enabling the endpoint alone starts no Codex process or model request.

## Owners and authority

- `StudioHttpSession` owns one coalesced local-platform admission and keeps its
  capability in memory. Files and assistant transport can share that instance.
  A late rejection cannot expire a newer admission. The existing file provider
  retains its single retry after an explicit pre-operation 401; assistant
  commands never inherit that retry policy.
- `scripts/serve-dist.mjs` authorizes Host, origin, Fetch Metadata and capability
  with the existing platform owner **before** invoking `CodexHttpApi`. There is
  no CORS, URL token, alternate unauthenticated listener or public Codex stdio.
  Its opt-in shutdown joins both the process and accepted HTTP IO, rather than
  killing an in-flight source-save socket.
- `CodexHttpApi` owns one process/stream lease. The platform chooses the private
  profile under `$XDG_STATE_HOME/bmsx/studio-codex` (or the normal per-user local
  state directory), and fixes the four source/diagnostic/review tools. No browser-supplied cwd,
  provider, executable, configuration, permissions or method name is forwarded.
- `AssistantHttpConnection` owns the browser lease's AbortSignal. Workspace/view
  composition must bind its lifetime before connecting. Closing it retires
  local tool/review rights immediately; its `closed` promise joins local stream
  consumption, not remote process exit. The server independently joins actual
  exit and releases the private process lease before admitting a replacement.
- `hosts/common/assistant_protocol.ts` describes Studio operations/events.
  `json_lines.ts` owns incremental UTF-8/JSON framing: fragments are joined once
  per message, including split Unicode; corrupt/truncated frames end the stream,
  never skip or repair an event. No per-frame/game/runtime polling is involved.

## Wire and lifetime

`POST /__bmsx__/assistant/connect` returns an NDJSON event stream. The first event
contains a new opaque connection lease and account availability, never tokens.
A competing live connection gets 409. An explicitly requested replacement may
wait for an already retired process to drain; it cannot take over a live lease.

`POST /__bmsx__/assistant/command` additionally requires that lease in
`X-BMSX-Assistant-Lease`. Only start, interrupt, tool-result, login-start, login-cancel and sign-out
operations exist. Login IDs remain process-owned; the browser receives only a
one-time code and a public account snapshot, never credentials or arbitrary URLs.
Each tool request receives a new one-shot reply identity, not the external
provider's RPC/call ID. Interrupt/disconnect removes pending reply rights; a late,
duplicate, foreign-connection or retargeted reply is rejected.

Start carries the user's prompt plus typed review observations captured by the
workbench. The process owner converts those observations to a separate text input
item beside the unchanged prompt, with explicit historical-outcome versus current
source/Save semantics. These are not injected provider methods or edit rights.
Review actions never send start; only an explicit prompt can submit observations.
Acknowledgement means prompt admission, not proof that the model used that context.

There is no reconnect/replay queue. Even a 401 does not automatically renew and
repeat an assistant command. A lost response **or interrupted response body**
may follow an accepted prompt; the client retires its lease rather than guessing
whether it was accepted. Known operation rejection can leave the connection live.

Stdio responses keep draining independently of tool waits and browser output.
If the Node event writer's queued bytes exceed 8 MiB, the whole connection is
retired. This also rejects a single oversized event; it is not a claim that the
browser was necessarily slow. Events are neither silently dropped nor replayed.
Source proposals remain governed by the [source-tool context](studio_source_tools.md)
and [ordinary review](studio_workspace_edit_review.md), not by transport IDs.

## Evidence and limits

- `npm run test:assistant-http`: **13 passing tests**, including the actual CLI
  with an offline Responses fixture, real listeners and a real Chromium client.
  They cover origin/lease admission, tool exchange, interruption, disconnect and
  explicit replacement, duplicate replies, lost headers/body, expired capability,
  stream-budget termination and process/profile shutdown. Chromium shares one
  admission with ordinary file IO and saves after assistant disconnect.
  Structured review observations and the unchanged Unicode/multiline prompt are
  verified in the actual Responses request produced by the pinned process.
- The actual production entry is separately spawned: LAN opt-in is rejected;
  unauthorized requests cannot touch the profile; an intentionally wrong private
  executable is rejected and the entry completes joined shutdown. Default static
  serving still rejects authorized assistant access as disabled.
- Three framing/admission unit cases cover fragmented Unicode, malformed EOF
  and cancellation during delayed platform admission. Existing process tests
  (**19**), independent contract tests (**5**), source-workbench exchange (**1**)
  and workspace HTTP tests (**6**) remain green.
- Full Lua suite: **2322 passed, 1 skipped**. IDE/browser/Node typechecks and both
  Studio product builds pass; strict architecture audit reports **0 issues**.
  The full tests-project typecheck still has its **96 baseline diagnostics**,
  with none in the new transport owners/fixtures; it is not reported as green.
- Actual WebGL2 Studio source-save acknowledgement/local-only/reconnect,
  cold-page session restoration and Lua/YAML edit-review/Undo/disconnect flows
  pass. The YAML local-only and pending/stale review screenshots were inspected.
  This is automated browser evidence, not UI-only authoring. Changed-file
  indentation and `git diff --check` pass.

These transport tests alone are **not** a chat-pane, real account authorization,
paid-inference or OS-sandbox demonstration. The separate
[contribution tests](studio_assistant_contribution.md) cover the visible pane
and the device-code protocol with offline fixtures. No credentials were
copied and no remote model requests were made. The pinned process capability
limits and same-user threat model remain in the [process contract](studio_codex_process_contract.md).

Before implementation, the pinned Codex [App Server client](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/app-server-client/src/lib.rs)
was studied for independent response/event processing and shutdown, and VS Code's
[IPC process owner](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/base/parts/ipc/node/ipc.cp.ts)
for request/listener retirement. BMSX deliberately adopts neither an unbounded
consumer queue nor lazy reconnect for source-edit authority.
