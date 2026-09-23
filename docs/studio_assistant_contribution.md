# Studio conversation and account contribution

Implemented on 2026-09-23, on top of the source/history/review and local process
contracts, not as a second editor or a browser tunnel to Codex RPC.

## Use

1. Build the browser Studio and debug BIOS/cart normally. Use the existing
   development server (`npm run serve:dist` or the LAN/WSL launcher).
   Codex is part of that server, without an assistant flag or separate command.
   Connect requires the admitted `codex-cli 0.156.1` on the server machine.
2. Open **View → Codex Assistant** or the command palette's
   **View: Codex Assistant**. Opening the pane starts no process or model call.
3. **Connect** opens a private local process lease. **Sign in** requests a device
   code for the separate Studio account profile. **Copy code** and **Open login**
   are explicit actions; the latter opens only the official fixed OpenAI page.
   Complete the authorization there. **Cancel** retires the pending attempt;
   **Sign out** removes that profile's account and disconnects the conversation.
4. Type a multiline prompt. Enter inserts a newline; Ctrl/Meta+Enter submits
   only while the composer has focus. **Stop** interrupts a running response.
   Prompts and requested source content are sent to the connected provider.
5. Select a proposal and use **Review**. Only the ordinary review's **Apply**
   edits working copies. Apply is not Save, build or installation. Ordinary
   source Undo/Redo spans all files in the proposal.

LAN clients use those same endpoints and the server's Studio account profile;
there is still one active process lease, not one account per device. The server
binding controls network reachability, not whether Studio functionality exists.
See [platform boundary](studio_platform_boundary.md) for the trusted-network
scope and the separate secure-context requirements of the browser runtime.

The assistant can also request the same source-bound diagnostics as Problems
after reading a file. These are shared language-service results, not a build or
test run. Unsupported coverage (including YAML) is explicit rather than reported
as a clean file. Source changes retire those receipts along with edit authority.

It can also list retained test runs and read individual run/case evidence through
the [shared result owner](studio_test_evidence.md). These are historical outcomes,
captured suite bytes and retained output, not claims about the current workspace.
This read capability never starts or cancels a test and grants no edit authority.

Pointer selection and Copy operate on transcript messages. With transcript
focus, Up/Down select messages, Enter opens the selected proposal, Ctrl/Meta+C
copies, and Page Up/Down/Home/End scroll. Tab moves between controls. The composer
has its own selection, clipboard, Undo/Redo, wrapped caret and vertical navigation.
There are no globally reserved gameplay keys or automatic guest evaluation.

## Owners and lifetimes

- `services/assistant/conversation.ts` owns the workspace conversation, account
  snapshot, connection epoch, prompt context and tool replies. It captures a
  `WorkspaceSourceTools` context **before** asynchronous prompt submission.
  Late operations from retired connections cannot update a replacement.
- `contrib/assistant/editor_input.ts` owns ephemeral draft/selection/scroll state;
  `editor_pane.ts` owns attached controls and uses the normal command/menu/focus
  routes. A tab switch does not disconnect. Closing the input does disconnect.
  Reopening does not replay previous messages; an explicit new connection marks
  earlier transcript entries as display-only.
- Account/source authority is distinct from view attachment. Turn completion
  ends read rights but can leave an explicit review pending. Connection close,
  sign-out or account-change notification invalidates pending review rights
  immediately, before waiting for the refreshed account snapshot. Prompt/account
  admission remains closed during that asynchronous read.
  Workspace clear also releases retained transcripts/proposals. Shutdown retires
  these rights before waiting for unrelated accepted saves.
- Review status is published by the ordinary `WorkspaceEditProposal` owner.
  Applied, discarded, stale and failed outcomes update the retained transcript
  even when the assistant pane was detached. Review state does not wait for a
  provider notification, and Undo does not rearm a proposal. Settlement releases
  executable edit payloads; only the inspectable preview survives.
- Provider feedback is separate from settlement. The proposal tool returns an
  opaque review identifier, not approval. At the next **explicit user prompt**,
  the conversation snapshots outstanding reviews directly from their owners.
  The Node adapter supplies these typed observations beside the unchanged prompt.
  Apply/Discard/staleness never starts inference, and no polling tool or provider
  wait holds the review open. Applied is a historical working-copy operation,
  not Save/build/run or a claim about source after Undo. Further edits require
  fresh source receipts.
  Only terminal observations included in an acknowledged prompt are released.
  Pending/applying reviews remain outstanding; settlement during asynchronous
  admission is reported on a subsequent prompt, not silently acknowledged.
  A known rejection retains the observations without retrying the prompt; an
  uncertain transport loss retires the connection. Account/connection replacement
  clears observations along with source authority. Old acknowledgements cannot
  consume replacement-session evidence. No full-transcript scan is involved.
- The assistant and review inputs are deliberately absent from session
  serialization. They cannot restore a conversation or resurrect edit rights.
- `hosts/common/assistant_protocol.ts` is a narrow platform contract, with no
  browser/Node/runtime implementation imports. Browser composition supplies the
  connection factory and shares `StudioHttpSession` with ordinary file IO.
  File retry semantics are not inherited by assistant commands.

## Account boundary

The pinned Codex browser OAuth implementation can cancel another login listener
on localhost:1455. Studio instead uses the official device-code method, which
needs no callback port. Only the Node session sees a login ID. The browser gets a
code and public account availability, not credentials, arbitrary authorization
URLs or provider RPC. Cancel-before-start-response and completion-before-start-
continuation are explicitly handled by that process owner. Credentials remain
in the private application profile; no global CLI credentials/config are copied.
The Node session closes operation admission before publishing an account refresh;
only the latest authoritative snapshot reopens it. Browser button state is not
the authority for accepting a prompt, another login or logout during that read.

## Text and work budgets

Transcript messages use the existing piece-tree buffer. Projection consumes only
the changed entry's final wrapped row on streaming append; completed rows remain
retained. Authoritative final-message replacement and font/width changes reflow
the affected content. Unchanged frames neither reread nor rewrap history. Drawing
visits visible rows only; explicit Copy may materialize the selected message.
Review settlement replaces only its heading row: it performs zero message-text
reads/measurements and retains every other row and the user's selection. Workspace
clear explicitly resets projection identity immediately, not at the next draw;
a new same-sized transcript cannot inherit offsets or pending heading updates
from an old workspace.

The shared multiline control is independent of the assistant. It uses the
existing field history/clipboard/cursor owners, retained wrap geometry and normal
pointer capture. Field coordinates now preserve CRLF bytes rather than combining
raw text with a lossy CR-stripped line split. No canonical source is reformatted.

The real-cart test found Codex truncating the large JSON source catalog in its
history. The process policy now disables that lossy tool-log truncation for
JS-representable output, and checks the effective setting. This does **not**
enlarge the provider's context window or hide context-limit failures.

## Validation and limits

- `npm run test:studio-assistant`: twelve cases, running retained test evidence, the conversation,
  pending/failed account and successful login workflows on actual software,
  WebGL2 and WebGPU Studio presentation,
  authorized HTTP leases and the pinned CLI, with offline Responses/issuer fixtures.
  Visible keyboard and
  pointer routes exercise the multiline composer and its Undo/Redo, both fonts,
  Lua/YAML proposal, review Apply and joint source Undo, pane switching, Stop of
  a waiting provider stream, Discard, stale review after an ordinary source edit,
  disabled stale Apply, and close/reopen retirement. Applied/discarded/stale
  headings are asserted and captured on all three backends.
  Actual subsequent Responses request bodies contain the corresponding applied,
  discarded and stale review observations; the applied case includes ordinary
  joint Undo before submission. Fresh reads see that Undo, while the proposal's
  one-shot historical outcome remains applied. The request count proves that no
  review action triggers another model request and acknowledged outcomes are not
  repeated after Stop.
  Guest cycles and audio stay paused while the pane waits, without a separate
  requested pause. Model/tool IO, reviews and Stop remain usable. Hiding Studio
  releases its hold and reopening the retained pane pauses again; neither action
  clears an independent user pause. This corrects the original live-guest policy
  on 2026-09-24. Authored project files remain
  unchanged. Copy is checked against the browser clipboard with explicit clipboard
  permission, not just the editor's cached clipboard. Selected-message, composer,
  account-code (both fonts) and review screenshots were inspected.
  The real process also requests Lua/YAML diagnostics before each review: the
  unsaved Lua error is visible in ordinary Problems, while YAML reports unsupported.
  The shared-diagnostics screenshot was inspected; source bytes and guest code
  remain unchanged by analysis.
  The account workflow covers pending polling, Copy code, the fixed login
  destination with popup blocking enabled and no opener/referrer, cancel after
  the code, actual polling failure, cancel before a held start response, close
  while signing in and explicit reconnect/disconnect. The login destination is
  intercepted before external navigation. No account is authorized, credentials
  created, thread started or prompt sent in those pending/failed account cases.
  The separate successful-login workflow exercises real device-code exchange,
  explicit disconnect/reconnect using the private account profile, token revocation
  and profile removal on Sign out, then reconnect requiring a new authorization.
  The unsent draft survives every account transition. Signed-in screenshots in
  both fonts and the signed-out screenshot were inspected.
- `npm run test:codex-account`: nine passing device-code/adapter contract cases,
  including actual local-issuer polling/cancel/logout and test-only protocol
  ordering injection. Successful login uses a **non-forwarding local TLS proxy**
  and synthetic account tokens, with unchanged official URLs, process configuration
  and RPC responses. `openssl` creates a temporary CA trusted only by the test
  executable; no host trust store is modified. The fixture admits only measured
  account endpoints and an empty model catalog, never inference or remote traffic.
  The real CLI persists the synthetic tokens in its private mode-0600 auth file;
  public events contain neither token. Three regressions issue prompt/login/logout
  directly during the refresh notification, before browser state could gate them.
  Logout originally succeeded in that window; the process owner now rejects all
  three until the current snapshot arrives. No personal authorization is claimed.
- Conversation tests cover source capture, shared history, close/workspace
  teardown, delayed old operations, login cancellation, account replacement and
  authoritative streamed-message completion. Projection exercises 10,000 chunks
  (50,000 source code units) with less than 450,000 units reread, then 1,000
  unchanged updates with zero additional reads/measurements. This is a bounded-
  work assertion, not a whole-application latency claim.
  Settlement tests retain a later 60,000-code-unit message and forbid any text
  read or measurement while updating an earlier proposal's heading. Five shared
  proposal cases verify one notification after authority retirement, including
  history conflict/failure. A detached-view teardown case replaces the transcript
  before another frame and verifies that no old offsets or edit state survive.
- Review-feedback tests cover all four terminal states, pending settlement during
  admission, applying-state observation during ordinary content publication,
  competing proposals, known rejection, and connection/account replacement with
  delayed acknowledgements. The real HTTP/CLI test verifies structured data and
  the unchanged multiline Unicode prompt in the actual provider request.
- Regression bundle: **2365 Lua tests passed, 1 skipped**; process/stdio **19**,
  independent Codex contract **5**, assistant HTTP **13**, workspace HTTP **6**,
  process/workbench **1**, and account **9** pass. Actual WebGL2 cold-page session
  restoration passes. Source-save/local-only/reconnect workflows pass on all
  three renderers through the same shared renderer fixture used by the assistant.
  IDE/browser/Node typechecks and both Studio product builds pass. The full
  tests-project typecheck retains **96 pre-existing diagnostics**, with no new
  diagnostics; it is not reported as green. Architecture audit: **0 issues**.
  Changed-file indentation and `git diff --check` pass.

These are automated browser/contract tests, **not UI-only authoring**, personal
account authorization or paid-model verification. There is no transcript
persistence, automatic reconnect, general shell, direct model file writer,
provider picker, background multi-agent workflow or OS-wide sandbox claim.

## Production references studied before implementation

- VS Code's pinned [chat model](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/chat/common/chatModel.ts):
  retained request/response state, independent of view attachment.
- VS Code's [editing session](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingSession.ts)
  delegates decisions to retained edit owners; Codex's pinned
  [dynamic-tool roundtrip](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/app-server/tests/suite/v2/dynamic_tools.rs)
  verifies the tool result in actual subsequent model input. BMSX keeps its own
  preview-before-Apply semantics rather than copying speculative writes/restore,
  and submits later review observations only with an explicit prompt.
- VS Code's [chat widget](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/chat/browser/chatWidget.ts)
  and Codex's [account contract tests](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/app-server/tests/suite/v2/account.rs):
  separate view/model lifetimes and exercise device-code failures/cancellation
  at the real issuer boundary, rather than replacing Codex's account RPC implementation.
- Codex's pinned [account processor](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/app-server/src/request_processors/account_processor.rs),
  [device-code owner](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/login/src/device_code_auth.rs)
  and [browser OAuth listener](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/login/src/server.rs):
  process-owned IDs/cancellation and why Studio does not borrow the callback port.
- Codex's [history owner](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/core/src/context_manager/history.rs):
  tool-output truncation is an external ABI concern, not something to repair in
  a Studio source receipt.
- Codex's pinned [auth fixtures](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/app-server/tests/common/auth_fixtures.rs),
  [custom CA owner](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/http-client/src/custom_ca.rs)
  and [token revocation](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/login/src/auth/revoke.rs):
  synthetic claims, scoped TLS trust and the real revoke-before-local-removal
  path. The fixture changes the test executable's outbound transport, not the
  production account or configuration admission contract.
