# Scenario Lab execution from conversations

## Ownership and reference gate

The execution tools use the existing workspace `ScenarioRunService`, not a
Scenario Lab pane, a second runner or the authoring machine. Before this change,
the live service, serial runner, collection, accepted-source result owner and
their ordinary UI callers were audited against VS Code's
[run identity and targeted cancellation](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/testing/common/testServiceImpl.ts#L139-L151),
[run dispatch](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/testing/common/testServiceImpl.ts#L251-L296)
and [completion events](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/testing/common/testResult.ts#L281-L293).
Those lifecycle boundaries are the reference, not its extension-host service
registry or optional save-before-test policy. BMSX executes pinned working copies
on fresh physical targets without implicitly saving or installing them.

| Concern | Owner / representation | Native counterpart |
| --- | --- | --- |
| Declaration selection | `ScenarioTestCollection`: source-derived project/module/case identities and one-based Lua ranges | Tooling only; no new guest ABI |
| Admission | `ScenarioRunService`: current selection, captured documents, returned `ScenarioRun` identity | Studio adapter is TypeScript |
| Execution | `TestRun` / `TestExecution`: existing budgets, media and independent per-case `TestTarget` | Guest Lua/coroutines and machine semantics unchanged |
| Completion / cancellation | Run-identified service events and exact live-run identity | No new CPU flags, opcodes or MMIO |
| Historical evidence | `ScenarioResultService`: accepted suite bytes, outcomes and bounded output | No invented native test/debugger session |
| Conversation authority | `WorkspaceTestTools`: prompt-local scope/run/case handles and the runs that prompt started | Host transport only |

No mirrored runtime or compiler representation changes are made. Existing hot
execution callsites remain `runWorkbenchHostFrame` → `ScenarioRunService.advance`
→ `TestRun.advance` → `TestExecution.advance`. They gain no polling, parsing,
allocations or instruction hooks. Discovery snapshots rebuild only on the
collection revision; evidence snapshots only on the result revision. Completion
listeners exist only for outstanding wait requests. The provider receives one
reply per request, not progress polling or automatically submitted prompts.
Fresh admissions/listings release evicted run/case projections, so old tool
snapshots do not extend result retention. Rediscovery releases removed scopes.

## Shared service contract

`start(scopeId)` now synchronously returns the accepted `ScenarioRun`. This is
**admission, not completion**. The old preparation-only promise no longer looks
like an awaitable test outcome. Current declarations and all retained Lua
document snapshots are captured before asynchronous preparation. The ordinary
Scenario Lab commands use this same method.

`wait(run, signal?)` resolves on that run's actual terminal event, including
preparation failure or bounded cancellation cleanup. Already terminal runs can
be read immediately. Completion retires the waiter; abort retires only that
waiter, without mutating any run. There is no timeout that fabricates success
and no alternate CPU-driving loop.

`cancel(run)` compares the exact live-run identity. A retained old run cannot
cancel a newer run. It requests the existing cooperative cleanup; its boolean
return is cancellation admission, not cleanup completion. `wait` observes the
eventual outcome. Workspace restoration/shutdown still retires preparation and
releases targets. Cancelling during preparation cannot publish its late target.

## Tools

- `studio_list_tests`: current declaration tree, suite kinds, source revisions,
  case ranges and diagnostics. No registration code executes. Handles authorize
  a stable selection in this source owner, not the old source bytes. A removed
  case, invalid declaration or replaced cartridge cannot silently select another
  test. A subsequent explicit discovery admits a new source owner.
- `studio_start_test_run {scope}`: start that current selection and return its
  admission snapshot plus case handles. One active workspace run; no implicit
  queue, retries, Save, Hot Resume or authoring media installation.
- `studio_wait_test_run {run}`: await completion once, rather than repeatedly
  reading a running record. It can also observe a manually started run.
- `studio_cancel_test_run {run}`: cancel only a run this prompt started, then
  wait for cleanup/completion. An already finished owned run retains its outcome.
- Existing `studio_list_test_runs`, `studio_read_test_run` and
  `studio_read_test_result` share these handles and the ordinary history owner.
  An explicit history listing admits currently retained observation handles;
  it does **not** confer cancellation authority over manual/other-prompt runs.
  `canCancel` reports that distinction.

Prompt completion, Stop, disconnection and workspace retirement cancel unfinished
runs owned by that prompt and detach its waiters. They do not dispose the
workspace test service or cancel someone else's newer run. Cancellation can
continue bounded cleanup on normal host frames after the conversation stops.
Cancelling one wait request does not end the prompt or cancel the observed run.
No late request reply can re-enter a retired conversation.

New tool names are admitted by Codex when a thread is created. Rebuild/reload
Studio and restart the existing development server to load the updated catalog;
use a new conversation for these added capabilities. Resuming an older thread
preserves its native tool catalog. No second Studio server is introduced.

Historical `sourceCoverage: accepted-suite-only` remains unchanged. A rerun uses
current source; an earlier failure still exposes its accepted text. A passing
test does not certify a matching current dependency graph, successful source
save/install, or an attached debugger. Test captures remain retained metadata,
not pixels. [Post-mortem test inspection](studio_test_inspection.md) now attaches
the real retained target for frame/value/compiled-source reads. Live test
breakpoint/step/debug-rerun and semantic builder tools remain
[open](studio_runtime_tools.md); authoring-runtime inspection is not substituted.

## Validation surfaces

Owner tests exercise discovery invalidation, malformed external requests,
revision caching, source-owner replacement, preparation versus completion,
actual compiled guest cases, current-source rerun, immutable accepted evidence,
preparation failures, per-case physical isolation, wait cancellation, repeated
run cancellation, cooperative teardown, connection retirement, and protection
of newer/manual runs. Authoring machine state and installed media are compared.

The browser integration drives the existing authorized HTTP transport, actual
Codex app-server process and deterministic offline Responses fixture. The model
requests discovery, run, wait, failure reads, a current-source rerun and explicit
cancellation. A second real prompt starts a waiting case; the visible chat Stop
cancels its own run and permits teardown. Ordinary Scenario Lab displays the same
history. Request counts detect polling or extra inference. Canonical files must
remain unchanged. Fixture source edits are automated setup: this is not UI-only
authoring or a claim about live-model reasoning/account authorization.

Validated on 2026-09-24:

- Full Lua suite: **2463 passed, 1 skipped**; full rompacker suite: **159 passed**.
  Final focused owner/protocol/conversation checks: **52 passed**, plus **3**
  real target/service execution checks.
- Full assistant integration: **33 passed**. The new scenario workflow passes
  on software, WebGL2 and WebGPU. Each backend uses **13 model requests, 2 explicit
  prompts, 1 connection and 1 interrupt**; no provider polling. Actual request
  bodies carry the old failed suite and newer passing suite separately.
- Full ordinary Studio workflow passes on WebGL2 (**9023 host frames**), including
  manual test execution/cancellation, debugger, rewind and authoring controls.
  Captures of the assistant results and ordinary Scenario Lab history were
  visually inspected. This remains automated evidence, not UI-only development.
- Browser Studio / Node tooling builds and IDE/common/browser/Node typechecks
  pass. The tests-project typecheck retains **96 baseline diagnostics**, with
  no added/removed diagnostic after normalizing line positions; it is not clean.
- Strict architecture audit: zero issues. Core parity audit, changed-file
  indentation and `git diff --check` pass. No native machine/BIOS code changed;
  this does not claim a native Scenario Lab adapter or throughput benchmark.

Evidence logs are `/tmp/scenario-{lua,rompacker,focused,assistant,studio}-final.log`;
browser request JSON and screenshots are in `/tmp/bmsx-studio-chat/test-tools-*`.
