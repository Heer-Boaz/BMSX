# Studio Codex conversation lifecycle

Implemented 2026-09-24. This supersedes the earlier ephemeral-thread and permanent
account-toolbar scope; the existing server/LAN admission and source-review owners
remain unchanged. The assistant and review panes hold ordinary Studio gameplay
pause, not a separate runtime or assistant-specific pause latch.

## Production references and measured protocol

Before implementation, the matching production owners were inspected:

- VS Code [ChatServiceImpl](https://github.com/microsoft/vscode/blob/90591ef039095c4dddad34b6e07ce9a080b04464/src/vs/workbench/contrib/chat/common/chatService/chatServiceImpl.ts):
  queue admission belongs to conversation state, not rendering; a server-managed
  queue must not also be dequeued by the browser. Cancellation and steering are
  distinct operations rather than resubmission of the same prompt.
- Codex [queue processor](https://github.com/openai/codex/blob/b4b055cfc8fccc0040d13aa4304cf9ba61c2e27e/codex-rs/app-server/src/request_processors/thread_queue_processor.rs)
  and [queue tests](https://github.com/openai/codex/blob/b4b055cfc8fccc0040d13aa4304cf9ba61c2e27e/codex-rs/app-server/tests/suite/v2/thread_queue.rs):
  durable native submissions, explicit queue start and paged reads.
- Codex [turn processor](https://github.com/openai/codex/blob/b4b055cfc8fccc0040d13aa4304cf9ba61c2e27e/codex-rs/app-server/src/request_processors/turn_processor.rs),
  [steering tests](https://github.com/openai/codex/blob/b4b055cfc8fccc0040d13aa4304cf9ba61c2e27e/codex-rs/app-server/tests/suite/v2/turn_steer.rs)
  and [resume tests](https://github.com/openai/codex/blob/b4b055cfc8fccc0040d13aa4304cf9ba61c2e27e/codex-rs/app-server/tests/suite/v2/thread_resume.rs):
  exact active-turn steering, thread interruption and native persisted history.

These are pinned source snapshots, **not a claim that GitHub's source commit is
the installed release**. The actual admitted CLI is still exactly `0.156.1`.
Its generated experimental TypeScript contract and executed real-process tests
determine supported fields and semantics. In particular:

- Queue operations require a persisted, not ephemeral, thread.
- New work on a running thread is `thread/queue/add`; native Codex dispatches FIFO.
  Editing replaces the queued input while preserving its review observations.
- Direct uses `turn/steer` with `expectedTurnId`. A stale direct request fails;
  it never becomes a new turn or silently retargets another one.
- Stop uses the measured thread/startup form of `turn/interrupt` (`turnId: ''`),
  which pauses the native queue as well as active work. Interrupted waiting text
  survives cold process replacement. `/continue` explicitly calls queue/start.
- `thread/list`, `thread/read`, `thread/turns/list` and `thread/queue/list` do not
  start inference. Selecting history does not call thread/resume. Execution
  resumes the actual selected thread only on explicit send/continue.
- The process reports source `vscode`, not an invented `appServer` list filter.
- Cold resume reintroduces a local default environment even if thread/start
  used `environments: []`. The first resumed-request regression exposed builtin
  `view_image`; launch policy now disables that feature explicitly. Actual fresh
  and resumed requests advertise only the admitted Studio tools. We did not
  relax the capability assertion or conceal the extra tool in the browser.

## Ownership

`hosts/node/codex/history.ts` is the external durable-state boundary: thread
listing, paginated transcript/queue reads, thread selection/loading and native
representation conversion. It never parses home-directory JSONL or synthesizes
assistant history. `input.ts` owns the provider text-input representation,
including review observations beside the unchanged user prompt.

`session.ts` owns process/thread/turn lifetimes and fixed operations. It admits
configuration at explicit start/queue boundaries, cancels Studio tool authority
immediately on Stop/close, and persists queue suspension before joining process
exit. Repeated Stop calls share the pending operation. Queue snapshots refresh
on native change notifications or explicit mutations of an unloaded history
selection (which has no subscription), coalesced per selected thread; old selection
responses cannot overwrite a replacement. No timer polls history, account or queue.

`AssistantConversation` owns connection admission, the selected thread, transcript
projection input and current Studio source/test capabilities. Connection/history
requests coalesce, submission stays latched while admission is pending, and late
operations cannot submit into a replacement connection. The model never advances
the native queue itself. User transcript entries come from native consumption
events, not optimistic insertion of queued or merely accepted steering text.

Ordinary turns capture source context before submission. Queued turns capture
fresh context at their native start event; source edits made while text waits are
therefore visible. Direct messages keep the current turn context and cannot
refresh already invalidated source receipts. Historical tool records are text,
not reconstructed review/proposal objects. Selection, account changes, workspace
clear and connection close retire old rights. Resumption always requires fresh
source reads before new proposals; it does not replay old tool results.

## UI and reusable workbench improvements

Only Send is permanent. Queue/Direct/Stop and selected-proposal Review are
contextual. Account operations are composer commands, not permanent toolbars.
The first ordinary submission connects implicitly; if sign-in is needed the
browser opens on the admitted authorization page and the draft stays unsent.
Authorization never automatically submits that draft. There is no reconnect loop.

- `/history [title search]`: existing shared Quick Pick, native pages of 40.
  Filtering the open page is local; only explicit search/page navigation does IO.
- `/older`: previous 20 turns; retains existing message buffers and selection
  identity while revealing the newly loaded page.
- `/new`: distinct conversation, without deleting the previous one.
- `/queue`: native waiting text; edit via the multiline composer or remove.
- `/continue`, `/stop`: explicit native queue execution/cancellation.
- `/login`, `/logout`, `/open`, `/copy-code`, `/cancel`: incidental account work.
- `/` and `/help`: discover commands and submission semantics.

Ctrl/Meta+Enter sends/queues, Ctrl/Meta+Shift+Enter steers, Enter inserts a newline.
These shortcuts remain composer-scoped. Submission never clears a newer draft
typed while a command was in flight. Closing the tab retires the connection;
reopening alone neither starts a process nor retries old work.

The shared workbench action bar now has retained item visibility. Hidden items
take no geometry, drawing, hit testing or keyboard focus. Hiding cancels a pressed
gesture before release. This improves ordinary Studio controls too, without a
second assistant-only button system. Quick Pick, multiline editing, clipboard,
text buffers, review and Undo remain the existing shared implementations.

## Scope and evidence

History belongs to the **server's private Studio Codex profile**. It survives
browser/process replacement and is available through the same existing server,
including its trusted LAN binding. There is still one active browser/process
lease: this is not live multi-client takeover or collaborative editing.

This does **not** import a separate VS Code/CLI conversation or ChatGPT history.
The installed thread/resume/fork contract does not offer dynamic-tool rebinding;
the memory-history overload is explicitly marked cloud-only. We do not copy
credentials, edit rollouts or use that unsupported overload to fake resumption.
Full physical-phone Studio boot and the browser runtime's plain-LAN HTTP
secure-context limitations remain separate from tested LAN API reachability.

Validation:

- Real-process session tests cover native queue order/edit/removal, steering,
  interrupted/cold-resumed text, unloaded queue editing without execution, close
  while busy, Stop at the native next-turn
  boundary, 22-turn pagination, preserved capabilities and no inference on browse.
- Fifteen browser workflows across software/WebGL2/WebGPU include actual composer
  and picker navigation, draft retention, implicit sign-in, queue edit/remove,
  Direct, Stop, cold history, continuation, New and source review. They count real
  HTTP/model requests and assert no requests during 120-frame idle, stopped and
  locally filtered-history intervals. Source edited after enqueue is read by the
  actual queued turn; cold resume receives fresh receipts. Screenshots are retained
  under `/tmp/bmsx-studio-chat` in the validation environment.
- Unit regressions cover duplicate admission, late pre-connect submission,
  fresh queued versus retained direct context, text-only history, older-page
  buffers and hidden-action pointer/keyboard retirement.

These are **automated browser and contract tests**, not UI-only development,
personal account authorization or paid inference. Model/issuer fixtures stay
local; real CLI processes, browser controls, HTTP leases and Studio owners run.
