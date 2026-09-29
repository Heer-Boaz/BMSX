# Studio connection lifetime and recovery: design review

Status: proposal, not an implemented transport contract. Reviewed 2026-09-29
against `407a6cd72`. The socket crash fix and permanent indicator remain
valid; they do not provide reconnect, mobile lifecycle recovery or silent-link
failure detection. No application behavior changes are part of this review.

## Three independent quality gates

The request covers both features individually, as well as their integration:

| Workstream | Must be valuable without the other features |
| --- | --- |
| Cartridge build/deploy | A correct, efficient CLI producer and packager, without Studio, a running server or an assistant. See the [build design](studio_cart_build_design.md), including a measured option-invalidation defect in the current CLI. |
| Connection/recovery | Accurate server status, bounded recovery and preserved local work, without build jobs or an assistant daemon/account. A standalone deployment opens no server connection. |
| Cooperation | Build state survives loss of its observer; recovery obtains current state without repeating work; installing an exact result remains an explicit target-scoped action. |

Neither a server endpoint around the current packer nor a retry loop around the
current chat stream meets these gates. Correct their actual ownership instead.
These are separate workstreams, not an instruction to create three new layers.

## Findings in the current implementation

- `ide/browser/studio.ts` opens the external-tool channel once. Its registration
  and closure drive the status icon. There is no recovery after closure.
- The icon currently describes that particular channel, not every server
  capability. `StudioConfiguration` can independently configure HTTP files,
  assistant, conversation viewing and external tools. No external-tool channel
  does not necessarily mean that every part of the deployment is standalone.
- `StudioToolHttpConnection` and `StudioSessions` have no heartbeat. An idle
  connection that silently stops delivering data need not produce an immediate
  close/error. The current green icon is not a bounded-time liveness guarantee.
- `pagehide` aborts tool registration and disconnects both conversation clients.
  There is no matching `pageshow` recovery. If the browser retains the page in
  its back/forward cache, that existing page has already retired its transports.
  Phone suspension and actual back/forward-cache eligibility still need device
  verification; a desktop viewport test does not establish either.
- `CodexHttpApi.connect()` binds its process lifetime to the HTTP response.
  Losing the embedded chat's stream aborts that session. In contrast, closing
  the native conversation viewer does not own or stop the CLI daemon.
- File IO has its own correct authority boundary: it only renews and retries
  after explicit pre-operation admission rejection. A transport error is not
  permission to repeat a write. The icon must not replace that boundary.

These are source-inspection findings, not new fault-injection measurements.

## Production references and what to adopt

| Reference | Applicable principle | Do not copy blindly |
| --- | --- | --- |
| [VS Code remote connections](https://github.com/microsoft/vscode/blob/main/src/vs/platform/remote/common/remoteAgentConnection.ts) | One reconnect attempt loop, explicit transient/permanent states, bounded recovery lifetime. | Its precise delays, global failure propagation and remote-host assumptions. |
| [VS Code persistent IPC](https://github.com/microsoft/vscode/blob/main/src/vs/base/parts/ipc/common/ipc.net.ts) | Keepalive and acknowledgement belong to the protocol; timeout handling accounts for event-loop load. | Its message replay requires its own acknowledgement/sequence protocol. BMSX cannot gain those guarantees by retrying HTTP commands. |
| [VS Code status indicator](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/remote/browser/remoteIndicator.ts) | Display consumes connection events and distinguishes connecting/reconnecting/disconnected. | Status UI is not the owner of connection or operation authority. |
| [JupyterLab kernel connection](https://github.com/jupyterlab/jupyterlab/blob/main/packages/services/src/kernel/default.ts) | Connection state is distinct from execution state; reconnect and kernel shutdown are different operations. Reconnect delays use jitter. | Its queued message policy and kernel/subshell ownership do not define safe BMSX tool replay. |
| [ws broken-connection handling](https://github.com/websockets/ws#how-to-detect-and-close-broken-connections) | A socket can remain apparently open after the link breaks; protocol heartbeat detects this. | The browser Studio channel is HTTP/NDJSON, not the native Codex WebSocket. A ws-specific ping cannot simply be inserted there. |
| [Browser page lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) | Suspension, cached navigation and final teardown need different lifecycle handling. | Hidden does not mean terminated; timers are not guaranteed to run while a page is frozen. |
| [HTTP idempotency](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2) | Automatic retry needs operation-specific grounds. | A lost response does not prove that an operation was rejected or never executed. |

## Proposed ownership

**Recover observation and registration, not previous authority or commands.**

1. **Deployment composition** declares whether a workspace server connection is
   available. Standalone starts no transport, heartbeat, discovery or retries.
   Do not infer deployment from failed fetches or from Codex installation.
2. **The live Studio window channel** owns registration, liveness, connection
   attempts and closure. General workspace observation must not depend on MCP
   tools being enabled. Evolve the existing window registration protocol if it
   acquires this responsibility; do not hide the old lifetime behind a generic
   connection facade or give each pane its own probe.
3. **Server admission** remains with `StudioHttpSession`. It neither owns
   conversation state nor decides whether a source write succeeded.
4. **Tool contexts, conversations, files and build jobs** retain their domain
   owners. Reconnecting one subscriber neither reconnects every provider nor
   grants access to a replacement runtime/window.
5. **Workbench chrome** renders the current window-connection state. Add an
   accessible hover/tap explanation with last failure and a contextual retry
   action; do not add a permanent Connect/Disconnect toolbar. Keep transport
   health, assistant availability and account state distinguishable.

The current independent deployment capabilities must be preserved. A general
workspace channel requires an explicit configuration/protocol change, not just
renaming the external-tool connection or its display flag.

## Recovery policy

- Explicit states: absent/standalone, connecting, connected, reconnecting and
  disconnected with a reason. A recovered transport is ready only after its
  registration and required observation snapshot are complete.
- At most one connection attempt and one scheduled retry per window channel.
  Recover transient transport failures with increasing, capped delays and
  jitter, within a finite recovery period. Persistent admission/protocol failure
  stops recovery and remains visible. Choose timing from LAN/mobile measurements,
  not by adopting another application's constants.
- Detect silent loss on the actual channel, with lightweight heartbeat and
  acknowledgement/deadline semantics owned by that protocol. This is not
  polling Codex account/history/model endpoints. An idle channel should not
  repeatedly allocate full snapshots or start another service.
- Browser suspension and restored navigation retire the old connection lifetime
  and explicitly re-establish current registration when appropriate. An old
  connection's completion cannot overwrite a newer connection's status. Local
  editor models and accepted workspace checkpoints survive this transition.
  Visibility/online events are hints to that same owner, not proof of connection
  health or reasons for another reconnect loop. Merely hiding a tab does not
  terminate it; a frozen page cannot meet active-page timer assumptions.
- Every replacement registration gets a new server-issued session identity.
  Old contexts, inspection handles and pending replies stay retired. An agent
  must select/open a current tool context rather than being redirected to a
  different live window. Reattachment must identify a surviving domain session;
  a new connection alone is not such proof.
- Never automatically resend a prompt, Lua call, step, Save, build request or
  install operation after ambiguous transport failure. The result may be
  **unknown**, not definitely failed. Reconcile through its owner using current
  state or an operation receipt before offering a meaningful next action.
- Keep the existing explicit pre-operation 401 renewal for file IO. It is not a
  precedent for retrying accepted or ambiguously acknowledged mutations.

Do not migrate every protocol to WebSocket merely to add recovery. Start with
the existing HTTP framing and explicit control messages; change transport only
if measured lifecycle, backpressure or bidirectional requirements justify it.

## Embedded chat lifetime

The embedded assistant needs a separate lifecycle decision before promising
mobile continuity. Recommended direction: Node owns the account/process session;
a browser owns its subscription and current tool attachment. Keep conversation
and login identity across a temporary subscription loss. Browser-scoped tool
authority still expires, and queued prompts must not silently advance because
the UI disappeared. Retaining a process is not permission for unattended work.
Define interruption/detachment and reattachment behavior explicitly before
changing `CodexHttpApi`; a reconnect timer cannot repair this ownership issue.

This does not imply that an embedded process survives a server restart or that
the server may take over the independent CLI daemon. Reconcile actual retained
conversation state; do not manufacture continuation or start a replacement turn.

## Build observation and installation

The [cartridge build proposal](studio_cart_build_design.md) separates the producer,
admitted job, publication and runtime installation. The connection observes these
owners; it does not own their work. In particular:

- A new subscriber receives an authoritative snapshot followed by ordered changes
  without a gap. Identify the server incarnation and snapshot revision explicitly;
  a restarted server does not continue an old in-memory event sequence. This uses
  the snapshot/watch principle in [client-go](https://github.com/kubernetes/client-go/blob/master/tools/cache/reflector.go),
  not its distributed-controller infrastructure.
- Reconnection retrieves state, not all historical progress. Keep the general
  workspace channel small: registration, liveness and current state updates.
  Fetch ROMs, images and bounded log ranges separately, so large payloads do not
  obstruct connection control. Coalescible job progress and non-replayable tool
  requests must not share an indiscriminate drop/replay policy.
- A lost build response is reconciled through its original request receipt.
  Server restart reconciles stored admission and publication records; unfinished
  jobs become interrupted, not successful, cancelled or automatically rerun.
  Do not promise this using only an in-memory job ID. The producer/publication
  design owns those records, not the connection layer.
- "Build published", "new media available" and "installed in this target" are
  different facts. Availability never installs media, resumes gameplay or starts
  a Codex turn. Build-and-Load retains an explicit intent naming the result and
  target generation; connection loss/replacement revokes automatic installation.
  A recovered window can still offer the completed artifact for explicit loading.

The existing server hosts these optional capabilities. Do not force a server
build through a browser tool context or introduce another server for jobs.

| Event | Connection/tool attachment | Accepted server build | Media and local authoring |
| --- | --- | --- | --- |
| Transient link loss | Retire old tool authority; recover observation within policy | Continues under its job owner | Running media and drafts remain; no queued automatic install |
| Window closes or enters cached navigation | Dispose that subscription; restored page establishes a new one | Continues | Final close uses existing workspace persistence; a retained page keeps its local models |
| Server restarts | New server incarnation and registration | Reconcile committed outputs; mark other admitted jobs interrupted | Published artifacts remain; runtime is not reset by reconnection |
| User cancels build | Other observation and services remain connected | Cancel producer; report completion if publication already won | Keep installed media; revoke the requesting Build-and-Load intent |
| Build finishes with multiple windows open | All authorized subscribers may observe availability | One completed job/result | Only an explicit, still-current target intent can install it |
| Standalone deployment | No server channel, retries or admission requests | Not available through Studio | Local IDE, Terminal and source workflows remain usable |

## Implementation order and acceptance evidence

The independent workstreams can advance separately:

1. **Connection:** define workspace/window registration and absent-service
   semantics, then implement liveness, bounded recovery and browser lifecycle
   handling at that owner. Make status UI a consumer, not a parallel state
   machine. This must be usable without building anything or launching Codex.
2. **Build/deploy:** correct producer input/recipe identity, invalidation and
   complete publication, then migrate CLI and packaging onto that producer. Its
   standalone acceptance does not wait for reconnect or chat-continuity work.
3. **Integration:** add admitted server jobs and snapshot/update observation,
   full-media installation through the execution owner, then the Studio and
   agent actions. The endpoint does not define the producer's contract.

Embedded process/subscription ownership is a separate connection-domain slice.
Do not claim chat continuity from successful window-channel recovery alone, or
make standalone build quality depend on completing that assistant work.

Connection evidence must exercise the product, not fixed UI strings: absent CLI
daemon with a live Studio server; server stop/restart; silent link loss; phone
background and return; cached back navigation; stale tool replies; and an
operation whose response is lost after admission. Measure detection/recovery
latency and attempt counts, and check cleanup across repeated cycles. Confirm no
duplicated mutation, unbounded timers/listeners, account/model polling or lost
editor work. Inspect the visible states in both themes. A missing response must
not be reported as proof of non-execution.

Build evidence is specified independently in the build design: changed options,
removed inputs, no-op efficiency, coherent dependencies, cancellation, exact
packaging and useful diagnostics, all through the real CLI. Integration evidence
adds restart between publication and completion reporting, lost acceptance,
concurrent windows, changed target generation and source edits during a build.
Passing integration scenarios cannot excuse a defective standalone producer or
connection lifecycle. This review has not performed those future acceptance runs.
