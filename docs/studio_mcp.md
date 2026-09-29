# Studio tools from an existing CLI conversation

The ordinary BMSX development server exposes Streamable HTTP MCP at
`/__bmsx__/mcp`. A live Studio window registers its workbench with that server.
The CLI keeps its own conversation, authentication and history; Studio supplies
tools, not a second model process. This is **additional** to the embedded Studio
assistant. Its login, history, queue, interruption and dynamic tools remain.

## Use

1. Build and serve Studio with the existing development-server workflow. After
   changing server code, restart that server; after changing the browser bundle,
   reload the Studio page. There is no separate MCP or Studio server command.
2. Open the desired game in Studio, including from a trusted LAN browser/phone.
   Keep the page open. Do not connect/sign into the Studio assistant merely to
   expose tools.
3. From the repository root, start Codex or `codex resume` the existing thread.
   The checked-in `.codex/config.toml` registers `bmsx` on port 8080. A running
   client must reload its MCP configuration or restart/resume; editing the file
   cannot add tools to an already negotiated model request.
4. Ask Codex to list the Studio windows, select the right one, and use its tools.
   The same conversation continues in the CLI. It is not copied or forked.

The URL and `http_headers_helper` in `.codex/config.toml` must name the same
server. Change both if using another port or host. The helper path is relative
to the CLI working directory, so the supplied configuration is for launching
from this repository's root. Project configuration requires Codex's normal
workspace trust. No user-wide configuration is modified.

The helper obtains the existing server capability from `GET /__bmsx__/session`
and returns it through Codex's native headers-helper interface. It never reads
or copies `auth.json`, logs into OpenAI, or writes a token to configuration or
disk. Do not paste the helper's output into messages or diagnostics.

**Trust boundary:** this is the existing local/trusted-LAN development server,
not a new per-user network authentication system. Everyone admitted by that
server can access its workspace and live Studio tools. Keep it off untrusted
networks. Host/origin checks and the per-server bearer capability apply to MCP
and window streams just as they apply to the workspace API. Studio on a phone
still uses the same server; it does not need a phone-local OAuth callback.

## Tool context lifecycle

1. `studio_list_sessions` returns window IDs, titles and URLs. Zero windows is a
   real empty result, not a request to start another Studio or another Codex.
2. `studio_open_context {session}` captures tool authority on the selected
   window. Its result contains `toolContext`. Opening does not pause the game,
   evaluate Lua or start an assistant.
3. Pass `toolContext` to domain tools. All existing Studio tool definitions are
   exposed from the shared catalog: authored/unsaved sources and diagnostics,
   ordinary Save/review, runtime/actors, debugger values, Terminal evaluation,
   game image capture, frame/history navigation, Scenario Lab and behavior tools.
   Availability still follows each actual runtime/editor owner's state. For
   example, Lua cannot run during BIOS startup and rewind requires retained history.
4. `studio_close_context {toolContext}` releases receipts/inspection handles,
   interrupts that context's unfinished operations and invalidates pending reviews.
   It does not undo completed execution, accepted Saves or another client's work.

Successful results are available as `structuredContent.result`, with matching
JSON text for text-only clients. The envelope allows domain arrays as well as
objects without guessing their shape. Captures use separate native MCP image
blocks, not a base64 string hidden in prose. Failures use MCP's `isError` result.
The routing field is deliberately **not** `context`: Terminal tools already use
`context` to choose cart/session evaluation.

Source authority is captured, not silently renewed. After editing a dependency,
replacing a workspace or disconnecting, open a new context and read fresh
handles. An MCP session cannot borrow another client's contexts. A window closing
cannot redirect existing calls to another open window, even for the same cart.
Multiple clients can inspect one window; the existing physical runtime owners
admit execution. There is no second scheduler, debugger or Lua execution path.

### Source review

`studio_propose_edits` opens the ordinary Source Edit Review pane even when the
embedded assistant has never connected. The user uses its normal Apply/Discard
controls; Apply reveals the source, uses shared Undo history, and invokes normal
Save. `studio_read_review {toolContext, review}` observes the proposal state.
Keep its context open while awaiting approval. Do not busy-poll.

`applied` acknowledges edits, **not** persistence or installation. Open a fresh
source context and use `studio_read_source_status` to observe the actual Save and
installed-source relationship. Closing a context does not roll back an accepted
Save. A transport failure after a mutation is not evidence that it did not happen.

### Cancellation and connection loss

MCP request cancellation reaches the exact browser operation's abort signal.
Context close and MCP session termination release that client's owned contexts.
Clients should explicitly close contexts and use standard MCP session termination
(`DELETE`) when finished. Losing the resumable HTTP event stream alone is not
session termination. Server shutdown ends its MCP sessions and registered windows.

The browser window stream is a workbench lease, independent of the assistant
stream. Losing it retires its pending calls and releases browser-owned contexts.
Reload Studio to register a new window, then select it explicitly. Commands are
not queued for replay. Disconnecting Studio chat does not disconnect external
tools, and closing an external context does not disconnect chat.

## Owners

```
CLI conversation -> official MCP HTTP transport -> StudioSessions
                                                  |
                                             live Studio window
                                                  |
Studio conversation --------------------> WorkspaceToolService
                                                  |
                           existing source/test/runtime tool contexts
                                                  |
                           editor / debugger / Terminal / runtime owners
```

- Node owns MCP sessions, window routing, request correlation and backpressure.
  It imports no IDE domain services; server composition supplies the shared catalog.
- Browser composition injects the review-opening action and connects the HTTP
  transport to the workbench's shared tool owner. The protocol carries data, not
  arbitrary provider RPC, configuration, filesystem paths or closures.
- `WorkspaceToolService` owns tool-context lifetimes. Embedded turns and external
  contexts use the same dispatch and domain implementations. Workspace teardown
  retires their execution/read authority.
- No guest ABI, cart or mirrored TS/C++ runtime behavior changed. These are host
  Studio capabilities; exposing them does not install MCP into the emulated console.

## Validation

`npm run test:studio-mcp` builds the product and ROMs, then runs the ordinary server
against an isolated authored workspace and real Chromium. It covers external Lua
execution, actual frame advancement/cancellation, game images, context/window
isolation, and a visible review's Apply/Save/Undo path. The installed Codex process
also discovers/calls MCP directly. A canary verifies that this never starts the
embedded Codex or creates its account profile. Evidence images are written to
`/tmp/bmsx-studio-mcp/` for visual inspection.

This is protocol, real-runtime and visible-UI evidence, not paid-model inference
or a physical-phone test. MCP exposes tools; the separate
[CLI conversation view](studio_conversation_view.md) displays native history and
live daemon-owned conversations. The existing embedded conversation functionality
is not removed, and the external conversation view does not take over controls.

Validation of this slice (2026-09-29): the MCP product test, Codex protocol/session/
workbench tests, assistant HTTP tests and conversation tests passed. IDE, Node
and common-host typechecks passed, debug/release Studio and headless tooling
built, and the architecture audit reported zero issues. Apply and Undo screenshots
were inspected, not just generated.

The broad `test:studio-assistant` run was **51 passed, 12 failed**, not green.
All 12 failing cases were reproduced in an isolated checkout of the unmodified
`4c7ba84f8` baseline with the same installed dependencies and ROMs:

- device-login browser tests expect the old exact device-page URL;
- successful-login tests observe three quota requests where they expect two;
- semantic-review tests assert that review never saves;
- source-Save tests fail their pending-acknowledgement assertion.

Each group runs on software, WebGL2 and WebGPU. The baseline WebGPU login had a
reconnect timeout in the combined run; its isolated rerun reproduced the quota
assertion. These existing failures were not removed or relaxed to make the MCP
slice appear green. The MCP product test independently checks actual persisted
source after visible Apply and the original source after visible Undo.

## Production references

Studied before implementation:

- [MCP SDK Streamable HTTP server](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/simpleStreamableHttp.ts):
  per-client transport lifecycle and standard session termination. BMSX uses the
  official low-level `Server` with existing domain schemas/decoders, not a parallel
  Zod catalog or handwritten MCP protocol.
- [MCP structured results and image content](https://modelcontextprotocol.io/specification/2025-06-18/server/tools):
  machine-readable result data alongside text and native image blocks.
- [VS Code main-thread MCP integration](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/mainThreadMcp.ts):
  transport/server lifecycle is separate from chat and domain execution.
- [Codex native HTTP headers helper](https://github.com/openai/codex/blob/main/codex-rs/rmcp-client/src/http_headers.rs):
  obtain headers through the supported client boundary without persisting server
  capabilities or copying account credentials.
