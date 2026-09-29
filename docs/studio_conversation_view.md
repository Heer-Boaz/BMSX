# Follow a CLI conversation in Studio

**View → Codex CLI Conversations** opens a read-only view of native Codex
history. Choose a conversation and keep writing in the CLI. Studio shows the
same thread ID, not an imported transcript, fork or second assistant session.
The existing **Codex Assistant** pane remains available with its own composer,
login, history, tools and queue. External [Studio MCP tools](studio_mcp.md) remain
independent of both panes.

## Connection and use

The CLI and Studio must connect to the **same native shared Codex daemon** for
live updates. Studio attaches to the existing local control socket under
`$CODEX_HOME/app-server-control/app-server-control.sock` (default `~/.codex`).
The ordinary BMSX development server owns this connection; there is no additional
BMSX server command, browser-to-OpenAI login or copied `auth.json`.

If the native daemon is not running, the viewer reports that fact. Start it with
Codex's own command, then continue the existing thread on that server:

```sh
codex app-server daemon start
codex resume --remote unix:// <thread-id>
```

Use the same `CODEX_HOME` for the BMSX server and the CLI. `unix://` selects
Codex's local control socket. If the conversation is currently running in a
standalone CLI (`--no-daemon`), leave that session before resuming it on the
shared daemon. Do not run two independent owners of the same stored thread.
An already daemon-owned conversation needs no restart or second resume.

Studio never starts, restarts or stops this daemon. It never changes the CLI's
model, permissions, tools, account or queue. No prompt, stop, approval or tool
response can be sent from this view. Closing the tab, closing the browser or
losing its connection releases only the viewer; the CLI continues working.

After updating BMSX, restart the ordinary development server and reload its
Studio page. Opening the viewer does not connect the embedded assistant.

## What is shown

- A native, paged conversation picker, with title search and older pages.
- Recent messages in the existing virtualized Markdown transcript: word wrap,
  styled user/assistant text, selection, copy, deselection and image previews.
- Streamed replies and activity, with observed title/model/effort/service tier
  in the footer. Missing native metadata is not invented or shown as `--`.
- Read-only summaries of native command, tool and file-change items. This is
  not an interactive command-output viewer or a second approval UI.
- **Codex CLI: Load Older Messages** in the command palette, retaining the
  current scroll/selection anchor rather than replacing the transcript.
- **Codex CLI: Choose Conversation** to change threads or reconnect explicitly.

A thread not loaded in that daemon is labelled **Saved snapshot**. Studio reads
its stored pages through Codex; it does not resume it into a second agent runtime.
This includes history of standalone CLI sessions. Re-select after opening the
thread on the shared daemon to follow it live.

Native resume currently omits the unfinished prefix of an assistant message
already streaming when a viewer joins. Studio explicitly shows
**Responding (joined mid-message)** until the authoritative complete message
arrives. It does not pretend that subsequent suffix deltas are the entire reply.
Messages that start after attachment stream normally. No history polling is used.

Local image/audio attachments remain named references: their paths are not an
arbitrary filesystem-reading capability. URL image attachments use the existing
image-preview owner. Agent reasoning is represented by activity, not private
reasoning text. This view does not fetch account quotas or mirror agent controls.

## Ownership, trust and cost

- `CodexSocket` uses the maintained `ws` transport over the native Unix socket.
  That socket carries WebSocket frames, not stdio NDJSON. `CodexRpc` shares
  request correlation with the existing embedded-process transport.
- `CodexObserver` owns native subscription and provider-item projection. Joining
  a daemon-loaded thread uses native `thread/resume` without configuration
  overrides. Native Codex owns loading, subscription and thread lifetime.
- `CodexObserverHttpApi` admits independent viewer leases behind the existing
  Host/Origin/bearer checks. The browser can request only history, open and older;
  it cannot forward arbitrary RPC. Backpressure reaches the native socket.
- `ObservedConversation` owns retained read-only text, not execution or source
  rights. It shares `AssistantTranscript`, the Markdown projection and
  `AssistantTranscriptControl` with the embedded assistant, without inheriting
  that assistant's account, prompt or tool-context state.
- Responses install snapshots at their wire-order boundary, before subsequent
  deltas. Disconnect or native history replacement retires the view explicitly;
  no command, subscription or prompt is silently retried.

**Trusted-LAN scope:** admitted clients can now view conversation history from
the server user's selected Codex home, including other projects. This is broader
than this workspace's source tree. The existing development server is not a
multi-user authentication system; do not expose it to untrusted networks/users.
Phones attach to that server, not to a phone-local daemon or OAuth callback.

History uses native cursors: 40 thread summaries or 20 turns per request, with
older pages loaded explicitly. Thread listing uses the native state database,
not a BMSX rollout scanner. The browser retains message buffers and measures
visible Markdown lazily; unchanged metadata is not remeasured for text deltas.
These page bounds do not guarantee constant-cost native history reconstruction:
Codex can reconstruct older rollout formats internally. There is no raw-rollout
parser, account mirror, periodic refresh or per-frame network request in BMSX.

## Validation and references

`npm run test:codex-observer` runs the installed native app-server with two real
socket clients in a private home and an offline Responses fixture. It exercises
paging, settings/title updates, streaming before/mid-message attachment, saved
snapshots, interactive-owner tool execution and independent disconnection.
It checks thread identity and actual provider requests, not exact presentation
strings or a mocked native server.

`npm run test:studio-conversations` builds the product and runs the ordinary
server with Chromium. Real keyboard input opens the picker and conversation;
screenshots cover Markdown, work activity, connection loss and narrow viewports.
The canary rejects accidental embedded-agent startup. Evidence is written to
`/tmp/bmsx-studio-conversations/` for visual inspection. This is native-protocol
and browser-product evidence, not paid-model inference or a physical-phone test.

Validation of this slice (2026-09-29): native observer 4/4, browser product 1/1,
existing assistant presentation/images 6/6 across software/WebGL2/WebGPU,
Codex session 33/33, assistant HTTP 17/17, Codex workbench 1/1, retained
conversation/projection 45/45 and the full MCP product test 1/1 passed. IDE,
Node and common-host typechecks passed; debug/release Studio and debug headless
tooling built; the boundary audit reported zero issues.
The resulting desktop, working, disconnected and narrow screenshots were
inspected, as were the existing assistant and long-history views. These targeted
results do not erase the [pre-existing broad-suite failures](studio_mcp.md#validation).

The narrow-browser screenshots still show the platform's existing fixed Studio
canvas scaled down and letterboxed, including on a freshly opened mobile-sized
page. Connectivity and rendering work there, but this is **not** a claim of good
phone typography or responsive touch interaction. This slice does not redesign
the platform's canvas sizing.

Production implementations studied before implementation:

- [Codex TUI server connection](https://github.com/openai/codex/blob/main/codex-rs/tui/src/app_server_connection.rs)
  and [TUI server selection](https://github.com/openai/codex/blob/main/codex-rs/tui/src/lib.rs).
- [Native thread processor](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/thread_processor.rs):
  loaded-thread resume, ordered recent-page subscription and read-only history.
- [Native Unix transport](https://github.com/openai/codex/blob/main/codex-rs/app-server-transport/src/transport/unix_socket.rs)
  and [unsubscribe lifecycle tests](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/suite/v2/thread_unsubscribe.rs).
- [Official App Server protocol](https://developers.openai.com/codex/app-server/).

The adapter consumes native protocol capabilities; it has no pinned CLI-version
gate. An incompatible or absent native service is an explicit connection/read
error, not a reason to launch a second agent or silently copy its history.
