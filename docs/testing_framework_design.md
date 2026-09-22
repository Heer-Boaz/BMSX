# Guest test framework: target architecture

> Design proposal. For the implemented API, evidence, budgets and remaining
> capabilities, see [Guest testing](guest_testing.md).

Status: **design proposal, not an implemented contract**. Written 2026-09-22
against `master` at `99cfe4ebf`, with a clean worktree before this document.
The current behavior remains documented in [architecture.md](architecture.md).
Implementation must update that contract alongside each accepted change; this
proposal must not be mistaken for proof that a runtime capability exists.

## 1. Decision and scope

Build a test framework around **named tests, explicit fixtures, ordinary Lua
modules and resumable test bodies**. Do not wrap or rename the existing
loader/ready/setup/update protocol.

Recommended end state:

- Test modules return suites. No authored runner globals or injected `host` API.
- `setup(context, fixture)`, a named test, and `teardown(context, fixture)` are
  separately executed phases. The fixture is fresh for each case.
- Unit tests execute against the real BLua CPU without starting the game entry.
- Integration tests execute against the real cartridge and use explicit waits,
  input and captures from a test context.
- Genuine, generic Lua coroutines retain suspended Lua execution. Neither the
  author nor a test-specific compiler transform maintains a program counter.
- Testing has its own machine target. Running tests does not replace the ROM or
  heap of the authoring/playback target.
- Discovery, packaging, execution, results and Studio presentation have distinct
  owners. Studio and automation consume the same test execution contract.

The impact may include the CPU representation, BIOS, compiler, GC, snapshot
format, debugger, host composition and all existing scenario sources. Small
impact is **not** a selection criterion. Correct ownership, test semantics,
determinism, observability and measured performance are.

This design does not replace TypeScript/C++ implementation tests or UI-driven
Studio tests with guest tests. Those test different boundaries. It also does
not promise a Busted compatibility layer, arbitrary runtime test generation,
parallel case execution, automatic retries or complete Lua 5.4 compatibility.

## 2. Reference implementations and adopted principles

Reviewed on 2026-09-22:

| Reference | Specific evidence and application |
| --- | --- |
| [LuaUnit, `execOneFunction`](https://github.com/bluebird75/luaunit/blob/master/luaunit.lua) | Separates fixture setup, test execution and teardown; records errors rather than using test return values as scheduler commands. Adopt the lifecycle, not its alternative spellings or global discovery. |
| [Busted, `init.lua`](https://github.com/lunarmodules/busted/blob/master/busted/init.lua) | Named cases and distinct per-case/per-suite hooks. Adopt explicit lifecycle scope, not its environment manipulation. |
| [Lua 5.4.8, `lstate.h`](https://github.com/lua/lua/blob/6e22fedb74cf0c9b6656e9fce8b7331db847c605/lstate.h), [`ldo.c`](https://github.com/lua/lua/blob/6e22fedb74cf0c9b6656e9fce8b7331db847c605/ldo.c), [`lcorolib.c`](https://github.com/lua/lua/blob/6e22fedb74cf0c9b6656e9fce8b7331db847c605/lcorolib.c), [`lgc.c`](https://github.com/lua/lua/blob/6e22fedb74cf0c9b6656e9fce8b7331db847c605/lgc.c) | Execution stacks belong to threads; resume/yield, error propagation and collection account for those threads. Adopt language semantics and ownership, not C `longjmp` or copies of host interpreter structures. |
| [Unity Test Framework, UnityTest](https://docs.unity3d.com/Packages/com.unity.test-framework@1.4/manual/reference-attribute-unitytest.html) | A test can explicitly yield and continue after the requested operation. Use this authoring principle with machine time, not Unity's scheduler or wall-clock delays. |
| [Neovim functional test sessions](https://github.com/neovim/neovim/blob/master/test/functional/testnvim.lua) | Test control owns the tested application session and its lifetime. Use a separate real test target, not manipulation of a user's live session. |
| [VS Code test results](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/testing/common/testResult.ts) | Runs retain per-test identities, outcomes and messages. Keep that separation from explorer selection and presentation. |

The module-return API and per-case machine isolation below are BMSX design
choices derived from these concerns, not claims that every reference uses that
exact API or isolation granularity.

## 3. Verified current owners and defects

| Owner | Current fact | Consequence |
| --- | --- | --- |
| `toolchain/ts/rompack/scenario_guest_api.ts` | Defines a global test loader and generates the global `host` command constructors. | Internal transport is exposed as authored API. |
| `toolchain/ts/rompack/scenario_cartridge.ts` | Inserts the deferred loader and test source into a synthetic cartridge entry after its first line. | Definition, delayed execution and source composition are coupled. |
| `ide/testing/scenario/execution_service.ts` | Binds three mandatory callbacks; requires 50 consecutive successful readiness checks; interprets booleans, strings and tables as execution commands/results. | Gameplay scheduling leaks into every test, including synchronous tests. |
| `ide/testing/scenario/test_collection.ts` | A source asset is one leaf below a project root. | Multiple named cases in one file cannot be selected or reported separately. |
| `ide/testing/scenario/result_service.ts` | Retains run/item history, logs, captures and observations. | Useful ownership to retain, but it needs case identities and multiple phase failures. |
| `ide/workbench/contrib/scenario_lab/run_service.ts` | Installs each derived ROM in the current Runtime and boots it; later restores canonical media. | Test execution and the user's execution target are coupled. |
| `machine/{ts,cpp}/machine/runtime/runtime.*` | `callClosure` pushes a completion call above the existing stack. | Waiting in that call does not resume the game below it. |
| `machine/{ts,cpp}/machine/cpu/{value,call_state,snapshot}.*` | No thread value or independent coroutine stack representation. | Real suspension is missing; it is not a missing helper. |
| `toolchain/ts/rompack/blua32_image_builder.ts` | Already accepts `preloadModules`; module imports are statically compiled. | Suite modules can be build roots without inventing a dynamic loader. |
| `ide/runtime/lua_inspection.ts` | `readRuntimeLuaModuleExport` reads compiler-owned export slots. | No new authored global is needed to locate a suite. |
| `cartlib/world/world.lua`, `ide/runtime/guest_call.ts` | World publishes mutation-boundary receipts; generic debugger plans can wait for them. | Use the real owner boundary, not frame-count guesses or function-name matching. |

The source inventory contains 89 `tests/carts/**/*_assert.lua` files using the
old global. A textual inventory finds explicit phase-state patterns in 55 and
`host.` commands in 26; these are migration indicators, not semantic categories.
For example, `pietious_session_rebind_assert.lua` performs its assertions in
`setup`, with trivial `ready` and `update` callbacks. Each case must be classified
by what it actually tests, not by these counts or its current filename.

## 4. Authoring contract

### 4.1 Suite definition

A test resource returns a table containing:

- `kind`: `unit` or `integration`, selecting the execution environment, not a
  different assertion/result system.
- `tests`: named functions. The module path and test key form stable identity;
  declaration order determines default execution order, not dependency order.
- Optional `setup` and `teardown`, both **per case**.

The runner creates one empty fixture table for a case before entering setup.
All three phases receive that same table. This also lets teardown inspect
partial setup state after a setup error. The framework does not deep-clone Lua
graphs or reset application objects by guessing their shape.

Illustrative proposed API, using the existing session/progression modules:

```lua
local session<const> = require('session')
local progression<const> = require('cartlib/progression')

return {
    kind = 'unit',

    setup = function(t, fixture)
        local program<const> = progression.compile_program({
            rules = {}, filters = {}, handlers = {},
        })
        fixture.session = session.new(program, { x = 8, y = 16 }, {})
    end,

    tests = {
        room_rebinding_preserves_player = function(t, fixture)
            local player<const> = fixture.session.player
            player.health = 13
            fixture.session:rebind_rooms({})
            assert(fixture.session.player == player)
            assert(player.health == 13)
        end,
    },
}
```

The proposed context API is not implemented yet. A test completes by returning
normally; its returned values are ignored. Assertions or uncaught Lua errors
fail the case. No boolean means "continue polling" or "passed".

Use one spelling for each hook. Suite-wide mutable fixtures are deliberately
not part of the initial contract: sharing compiled ROM bytes is sufficient for
build reuse and must not imply sharing test state. If suite-wide hooks are
later admitted, their scope must be explicit and must not change `setup`.

### 4.2 Discovery without executing the game

Test suites have statically named declarations: the returned table or a local
suite table with statically assigned fields/functions. Computed registration,
mutation of the test set during execution and duplicate case keys are compile
diagnostics, not runtime discovery branches. Parameterized tests may later use
an explicit declaration form with stable data-derived identities.

Use the existing Lua parser, binder and module-export analysis to produce
source-derived case descriptors: module path, test key, source range, kind and
export path. Do not add a regex parser, a second editable JSON test registry or
another source database. These descriptors are tooling data, not CPU opcodes
or machine-header test fields. Compilation checks the authored contract once;
the execution owner consumes its output directly without DTO validation.

The module top level declares tests and imports dependencies; fixture effects
belong in setup. Test discovery must not evaluate arbitrary Lua to find names.
Ordinary imported production modules still have their normal static startup
semantics in the test target. Those effects are covered by target isolation.

Studio presents project -> module -> case. Run Current Test, selected cases,
module and project all resolve to one immutable case sequence. Results and
reruns retain those identities and source revisions, not selection row indices.

### 4.3 Explicit integration operations

`context` is an ordinary guest test-library object, passed as an argument. It
is not a facade over arbitrary host methods. Its responsibilities are test
suspension, input requests, captures and diagnostics. Domain fixtures remain
in the relevant test project, not in the CPU or generic test runner.

| Operation | Proposed contract |
| --- | --- |
| `t:wait_ticks(n)` | Yield until at least `n` additional completed logical machine ticks after the request. Does not mean `n` game updates. |
| `t:wait_until(label, predicate, max_ticks)` | Evaluate once immediately, then at admitted tick observations; return when true, fail at the bounded deadline. A predicate error is a failure, not "not ready". |
| `t:at_boundary(receipt, max_ticks)` | Yield to a guest-owned boundary receipt. Resume at its publication boundary before further ordinary game instructions; not polling it one whole frame later. |
| `t:press(code, ticks)` | Schedule key-down before the next ICU sample, retain it for exactly the requested sample count, then schedule release before resuming the test. |
| `t:down(code)`, `t:up(code)` | Explicit held input/release at the next sample; pending holds belong to the case and are released on cancellation. |
| `t:capture(label)` | Complete only after an actual accepted presentation for the request; retain request tick and presentation identity. |
| `t:log(message)` | Append a test diagnostic. Not a magic test return value. |

Input-player selection extends those input operations using the existing raw
ICU playback owner. Observation APIs attach the existing guest recorder modules
and retain producer sequence numbers; they do not add host-side gameplay models.
The production trace-erasure contract remains unchanged.

For example, a gameplay test can explicitly press pause, wait for the authored
pause state, obtain `world:request_mutation_boundary()`, and then compare clock
and player state before/after a tick wait. The state predicate and setup actions
belong to the game's fixture. There is no universal "gameplay ready" callback.

Illustrative body inside an integration suite whose setup starts gameplay
(`world` is the ordinary imported World module):

```lua
pause_freezes_gameplay_time = function(t, fixture)
    t:press('F2', 4)
    t:wait_until('gameplay paused', function()
        return not world.gameplay_clock_running
    end, 120)
    t:at_boundary(world:request_mutation_boundary(), 120)

    local paused_time<const> = world.gameplay_time_ms
    t:wait_ticks(10)
    assert(world.gameplay_time_ms == paused_time)

    t:press('F2', 4)
    t:wait_until('gameplay resumed', function()
        return world.gameplay_clock_running
    end, 120)
end
```

The sample demonstrates control flow, not a completed migration of the shipped
pause scenario. That scenario's animation, actor and timing assertions must
remain covered when it is split into named tests.

**A video tick is not a mutation boundary.** A hardware slice can end inside
rendering or a structural update. `at_boundary` uses the existing guest-owned
receipt contract and generic execution hook; the test adapter must also respect
GPU synchronization and IRQ-return admission. It knows no World method names.
Targets that do not publish such a boundary must provide their own legitimate
owner boundary or be tested through input/output rather than unsafe mutation.

Zero-tick waits do not advance the game. Wait arguments are defined as integer
machine-tick counts; conversion from seconds belongs at the test configuration
boundary. No wall-clock sleeps or automatic retries are test semantics.

## 5. Execution: choose real coroutines

### 5.1 Alternatives considered

| Option | Decision |
| --- | --- |
| Rename globals or wrap `ready/update` in a module | Reject: preserves the wrong execution contract. |
| A fluent list of callbacks/steps interpreted by a new runner | Reject as the default: authors still manually externalize local state and branching. Useful input timelines remain a separate tool. |
| Execute assertions in the IDE's JavaScript Lua interpreter | Reject for guest tests: it substitutes language/runtime semantics and cannot prove the compiled cartridge. Host-side tests remain valid for host boundaries. |
| Test-specific async compiler lowering | Reject: makes suspension a special test dialect and duplicates general call/error/debug semantics. |
| Generic compiler-lowered continuations | A legitimate language design, but not selected: Lua already defines a standard stackful coroutine model, including indirect calls and nested suspension. |
| Generic Lua coroutines on the real BLua CPU | Select: retains local values, loops, calls and guest identity across suspension, independently of testing. |

Coroutines are a guest-language capability, not a CPU "test mode". Regular
cartridges may use the same supported coroutine API. BIOS owns the public
`coroutine` library; only fundamental thread operations are CPU primitives.
Do not inject test/input/capture functions into cart globals. Any boot primitive
installation follows the existing system-only capture-and-clear boundary, not
the discarded authored test-global convention.

### 5.2 Phase execution and handoff

The test-library execution module retains the suite, fixture, context and phase
threads as ordinary guest roots. Each setup/body/teardown phase has its own
coroutine. The adapter starts or resumes it through a short ordinary guest call
into that module. This is execution ownership, not a cosmetic helper.

```text
test target's game continuation (or unit harness entry)
  -> admitted completion call into test execution module
     -> coroutine.resume(active phase)
        -> ordinary compiled test code and production calls
        -> context operation -> coroutine.yield(operation, operands...)
     <- suspended / returned / errored phase
  <- completion call returns
game continuation becomes runnable again
  -> actual CPU/device scheduler progress
  -> requested operation completes at its defined boundary
  -> next admitted coroutine.resume
```

The phase keeps its stack; only yielded operands/results cross the handoff.
Do not capture, truncate and later reconstruct the game's stack. CPU slice
exhaustion, HALT/IRQ, debugger suspension and Lua `coroutine.yield` are distinct
events. In particular, the existing `yieldRequested` host-execution flag is not
a Lua coroutine implementation.

The operation channel uses a closed set of discriminants defined by the test
library/protocol producer. Wait predicates run as guest code, not host callbacks.
Transport operands stay guest values until the owning boundary consumes them;
strings use the CPU string pool and functions stay closures. At most one
blocking operation belongs to an active phase. Do not allocate a command table,
Promise, timer or closure for every tick spent waiting.

Ordinary operations can use the phase's retained outbound value slots. A
boundary receipt remains rooted in that phase/runner until completion or
disposal. Neither a UI inspection borrow nor a JavaScript reference roots a
value for the native guest collector.

### 5.3 Required generic coroutine semantics

Use the [Lua coroutine contract](https://www.lua.org/manual/5.4/manual.html#6.2)
for create/resume/yield/status/running/isyieldable/wrap/close as applicable to
the admitted BLua language. This does not silently add unsupported Lua syntax
such as to-be-closed locals. The language capability must be documented and
tested as a whole before the framework depends on it.

Required behavior includes nested resumes, multiple arguments/results,
indirect calls, varargs, shared globals/heap, open upvalues, yieldable protected
calls and errors from nested functions. Closing a suspended thread releases its
execution state and closes its open upvalues; it does not roll back writes.
Failed resume preconditions must not corrupt another thread.

CPU privilege, IRQ/NMI latches, DMA state, device clocks and blocked bus writes
remain machine state, not a saved coroutine environment. An interrupt runs on
the currently executing context and returns there normally. Coroutine switching
across an active hardware-exception frame is a non-yieldable boundary: reject
the language operation deterministically, rather than carrying privileged
frames elsewhere or fixing status words. Tooling resumes only after actual
exception return. An ordinary user thread may be interrupted or blocked on
hardware; that does not mean it has yielded to its coroutine resumer.

## 6. Representation and affected runtime paths

This is the pre-implementation representation map, not a behavior-preserving
extraction prescription. Physical state stays in its real owner; only genuinely
thread-local execution storage moves into the new thread representation.

| Concern | Live TypeScript | Live C++ | Required end state |
| --- | --- | --- | --- |
| Guest value | `ValueTag`, `ValueReference`, `ValueSlots` | NaN-boxed `uint64_t Value`, `ValueTag`, `GCObject` | Central thread value/object kind, deterministic guest identity; no table-shaped fake thread. Existing TS/C++ tag encodings differ and must not be equated by ordinal. |
| Execution stack | `CPU.frames`, `stackRegisters`, `stackTop`, `CallFrame` | `m_frames`, `m_stack`, `m_stackTop`, `CallFrame` | A retained stack/register arena per thread; CPU directly selects the active arena. No per-switch stack copy. |
| Calls/errors | `ProtectedCallContinuation`, `openUpvalueHead` | Mirrored call-state structures | Continuations/upvalues refer to their owning thread/frame; suspended frames are not returned to the frame pool. |
| Completion | `returnToCompletionLatch`, result slots, depth-based executor | Mirrored flag/result/depth path | A completion boundary identifies its owner thread/root, not merely the active thread's numerical depth. |
| Heap | `LuaHeap` accounting, `CPU.collectTrackedHeapBytes` | `LuaHeap`, CPU root traversal | Trace reachable thread stacks, resumer chains, open upvalues and transfer values; account stack capacity in guest RAM. |
| Snapshot | `CpuSnapshot`, CPU frame/object records | CPU snapshot and runtime save-state codec | Thread objects, active/root/resumer identities, per-thread frames and protected calls; references use snapshot ordinals, never host pointers. |
| Hardware context | CPU status/fault/IRQ words and scheduler | Mirrored words and scheduler | One physical machine context, unchanged by a coroutine handoff. |
| Tooling views | Stack traces, inline frames, guest-call/debugger plans | Native diagnostic projections | Identify thread as well as frame/function/PC; inspect suspended and failed threads without resuming them. |

Hashing, equality, `type`, table keys, weak reachability, formatting and root
classification must consume the new central representation in both languages.
Save-state restoration must reconstruct open-upvalue ownership and resumer
relationships exactly. Bump the owning state schema rather than supply an old
reader that invents missing thread state. CPU/library operation numbers and
cycle costs must be specified centrally before the implementation diff; this
document deliberately does not invent unrelated ABI integers at callsites.

### Runtime/hot-path inventory to recheck before editing

- TS `cpu.ts`: `runUntilDepthNormal`, `runUntilDepthInstrumented`,
  `executeInstruction` CALL/RETURN/RFE paths, `runBuiltinFunction`,
  `pushFrame`/`pushFrameFromCaller`, stack growth, `closeUpvalues`, protected-call
  entry/recovery, `beginCompletionCall*`, `completionCallPending`,
  `enterPendingInterrupt`/exception entry, heap traversal and capture/restore.
- C++ `cpu.cpp`, `cpu_dispatch.inl`, `call_state.h`: the corresponding dispatch,
  stack, builtin, protected-call, completion, interrupt and root paths.
- TS/C++ `runtime/cpu_executor.*`: bounded slices and
  `runSuspendedUntilDepth`; scheduler `runCpuSlice`; runtime `callClosure` and
  ordinary frame-loop completion handling. A cross-thread call must never look
  complete because a different thread happens to have a shallower stack.
- TS/C++ `value*`, `table*`, `closure*`, `lua_heap*`, `snapshot*` and runtime
  save-state codecs; BIOS library exports and both builtin specs.
- Compiler call/effect handling, tail calls, inlining, register liveness and
  source/inline debug metadata. A coroutine switch preserves all live guest
  state and invalidates assumptions about shared-heap effects of a call.
- IDE `guest_call.ts`, `suspended_guest.ts`, `debugger_state.ts`, control plans,
  stack traces, Hot Resume and history inspection. A raw frame-depth assumption
  must not survive a thread switch unreviewed.

Do not insert a test-enabled check into opcode dispatch or a test-name lookup
into CPU execution. The existing non-instrumented path must remain free of test
policy. Current unbounded completion helpers also cannot be the new test
scheduler: a busy loop without a Lua yield must still return control at bounded
CPU grants for cancellation and diagnosis.

## 7. Isolation, packaging and target ownership

### 7.1 An independent real test target

Allocate a dedicated test target with its own Runtime, memory, cartridge RAM,
CPU/heap, devices, input, histories, fault state, debugger state and output
resources. This is the same emulator, not a second gameplay implementation or
the IDE's Lua interpreter. The workspace and captured source batch remain the
authoring owners.

One case has a cold, known execution state. No default sharing of mutable
machine state between cases. Immutable ROM/compiler products are reusable;
mutable CPU/device/fixture state is not. A future allocation-arena reuse path
must prove equivalence to a fresh target at the owning cold-reset boundary.
The current reboot method must not be assumed to clear all RAM, save media and
device state merely because its name contains "reset".

This policy intentionally costs boot work per case. Avoid **redundant** work by
building once per source snapshot and compatible dependency root set, never
once per test function. Measure boot cost separately from execution; do not
hide it by weakening isolation or adding memory rollback.

Only one test target executes at a time initially. Studio may hold the
authoring target at the host level while showing/debugging the test target;
it never changes that target's guest pause bits. Input, capture, audio and
debugger actions route explicitly to the chosen target. Case persistence uses
session-owned save media unless an explicit fixture supplies initial bytes;
it never writes the user's gameplay saves. Shared GPU backend/resources must be
reviewed for per-machine state, not assumed safe to share.

This replaces the existing canonical-ROM restore session, rather than adding
an isolated facade around writes to the same Runtime. Host composition must
support explicit target lifetime and debugger attachment. That is genuine
ownership work, not a `getRuntime()` forwarding wrapper.

Lifetimes must remain explicit:

| State | Owner/lifetime |
| --- | --- |
| Workspace documents and source registry | Project, shared as authored truth; not copied into an alternative editable workspace. |
| Case descriptors and compiled ROMs | Immutable source generation/build; reusable across cases. |
| Run selection, outcomes and artifacts | Retained run, surviving target disposal. |
| Installed-image/source correspondence, debugger plans and guest borrows | Particular execution target, never the currently selected UI row. |
| Fixture, phase threads and yielded operands | Guest execution module in that case's target. |
| Input holds, captures and backend tasks | Particular case/target; cancelled or disposed with it. |

`ide/workbench/state.ts`, the host machine-runtime/presenter composition and
`RuntimeTaskQueue` callers must be audited for captures of the single current
Runtime. Commands bind their target at submission; switching the displayed
target must not retarget a pending mutation. Source navigation still resolves
to the single workspace, while runtime inspection uses the target's installed
source generation. No writable media, debugger plan or guest object crosses
between targets.

### 7.2 Unit and integration builds

- **Unit:** a harness entry plus the selected suite/dependency closure and real
  BIOS. The game's entry loop is absent. Code executes as BLua, including normal
  guest allocations and assertions. Incidental device use is still emulated;
  a test requiring game/device lifecycle should be classified as integration.
- **Integration:** the ordinary cartridge entry plus selected suite/library
  preload roots, in the isolated target. No test code is pasted into the authored
  entry. Setup starts after genuine module initialization; game-specific
  initialization waits are written in the fixture.

The builder already has generic `preloadModules` and module-export machinery.
Retain the suite root through that machinery. Use a compiler-described module
initialization return boundary for admission; expose it generically in tooling
metadata if needed. Do not infer initialized state from the presence of an
allocated slot or introduce another global readiness flag.

The current architecture text says loading the old scenario as a module would
run it too early. That explains the old mixed definition/execution format;
it is not a reason to keep delayed string composition after the format has
been replaced by declarative suites.

Source ranges remain those of the suite and production modules. Build output
includes source-derived case descriptors, not a second authored manifest.
Debug builds retain conventional test source resources; release carts do not
compile test roots or carry test-only instrumentation. Ordinary coroutine
support is a language capability and is not stripped merely because a cart is
not under test.

## 8. Failure, cleanup, timeout and debugging contract

Lifecycle: `queued -> preparing -> setup -> test -> teardown -> terminal`.
Terminal outcomes are passed, failed, skipped or cancelled. Diagnostics retain
phase and category, including build error, assertion/Lua error, timeout,
machine fault and host infrastructure error. A case can retain multiple
diagnostics; teardown cannot erase the original failure.

| Event | Required action |
| --- | --- |
| Setup returns | Run the selected body with the existing fixture. |
| Setup errors | Do not run the body. Run teardown with the partial fixture if guest execution remains viable. |
| Body returns/errors | Run teardown; success is final only after teardown succeeds. |
| Teardown errors | Retain it as an additional failure; do not replace the earlier error. |
| Await deadline | Fail the case; no auto-retry and no conversion to success by a later normal return. Attempt bounded cleanup. |
| Cancellation while yielded | Cancel pending input/capture operations, close the suspended phase, attempt bounded teardown, then dispose the target. Cancellation stays cancellation. |
| Busy loop or non-yielding cleanup | Stop at a bounded CPU grant and dispose the target if cooperative cleanup cannot complete. Report cleanup as incomplete, not executed. |
| Physical machine fault | Preserve target/fault evidence; do not inject cleanup into a faulted machine. Dispose after inspection or automation reporting. |
| Host/backend invariant failure | Stop the run; retain infrastructure failure separately from an assertion. |

Each phase uses a coroutine resume boundary, not a `pcall` that immediately
erases the only failed stack. Generic coroutine error handling must preserve
the failed thread's frames for inspection until explicit close/disposal.
Teardown has a different phase thread, so it cannot overwrite that evidence.
Ordinary `assert` remains usable; a `testlib` assertion module can additionally
provide expected/actual diagnostics. The guest producer classifies its own
assertion records; the CPU must never recognize test messages, string prefixes
or host object shapes as exception kinds.

Debug retains the failed target before destructive cleanup. Continue/Finish
performs the remaining lifecycle when possible; Stop disposes it. The debugger
must show the test thread, the game continuation and the source snapshot that
was compiled, including O3 inline frames. Compiler/library errors before
thread creation remain build/boot failures, not fabricated test frames.

Wait deadlines use completed machine ticks. A separate CPU-cycle budget bounds
execution even when PCRTC is disabled, and a separate cleanup budget bounds
teardown. A host watchdog catches an unresponsive backend/process but reports
an infrastructure timeout, not simulated elapsed time. User debugger pauses
consume neither guest-time nor guest-cycle budgets. No fixed numeric timeout
is hidden in a readiness callback.

Generic coroutine state participates in save-state/replay. A runnable test
checkpoint would additionally need input operations, deadlines and run state;
a machine-only restore must not silently resume with stale test-control state.
The initial test runner does not offer mid-case checkpoint restore or Hot
Resume. These are explicit session capabilities, not restrictions on saving
ordinary cartridge coroutines. Rerun uses a fresh source snapshot and target.

## 9. Implementation ownership and migration

Suggested responsibility boundaries (names may change, ownership may not):

| Owner | Responsibility |
| --- | --- |
| `machine/{ts,cpp}/machine/cpu/thread.*` and existing CPU owners | Thread storage, switching, values, collection, error/completion semantics. No test policy. |
| `machine/bios/coroutine.lua`, mirrored builtin specs | Public language API and only necessary generic CPU primitives. |
| `testlib` execution/context/assertion modules | Guest fixture/phase roots, coroutine orchestration and explicit operation producers. Existing recorder domains stay separate. |
| `toolchain/ts/rompack` test discovery/build owners | Source-derived test descriptors, root selection and normal linked images. Reuse Lua analysis; no parallel parser. |
| `ide/testing` collection/execution/result owners | Case scheduling, operation consumption, target lifetime and retained results, independent of workbench UI. |
| Host/workbench composition | Construct real targets and attach input, presentation and debugger to the selected target. No second scenario state machine in a host adapter. |
| `ide/workbench/contrib/scenario_lab` | Test explorer, run/debug commands, source navigation and evidence presentation. It can later be renamed for the broader test model. |

### Ordered, coherent slices

1. **Generic thread representation and language semantics.** Implement TS/C++
   together, including root tracing, upvalues, protected calls, snapshots and
   thread-aware completion/debug boundaries. Prove nested yield/resume without
   any test-library dependency. Update the architecture/ABI/state contracts.
2. **Named suites and isolated unit execution.** Source-derived descriptors,
   unit harness build, phase/error/fixture lifecycle and isolated target owner.
   Migrate the session-rebinding test into independent named cases. Prove
   selection, order independence, setup/body/teardown failures and source lines.
3. **Resumable integration execution.** Preserve the real game entry; implement
   tick/input/presentation operations and owner receipts. Migrate one real
   pause/resume scenario, including assertions spanning multiple updates.
   Prove the game advances while the test is suspended.
4. **Studio/headless product integration.** Per-case tree/results, target
   attachment, debug/failure inspection, cancellation and rerun. Prove the
   authoring machine and saves remain untouched. Run visible Studio workflows,
   not just service harnesses.
5. **Complete scenario migration and removal.** Classify all 89 current source
   files, split unrelated assertions where meaningful, migrate recorders and
   capture consumers, and remove the old protocol/build path and obsolete docs.

Slices are substantial validated changes, committed separately. The old runner
may remain available only as a bounded migration lane for unmigrated tests; the
new runner must neither invoke it nor emulate its semantics. There are no
compatibility aliases for the old globals. Removal is part of completion, not
optional cleanup after a new UI ships.

## 10. Proof and performance gates

The first end-to-end proof is not "the old tests still pass". It must show:

1. A named synchronous unit test runs without a game boot loop or readiness
   polling; setup and teardown have their specified scopes.
2. An integration test yields from a nested production/helper call, the actual
   game advances, and the same test resumes with local values and identity
   intact. IRQ/DMA work must complete through normal instructions.
3. A failed phase retains its exact authored stack while teardown succeeds or
   fails independently; cancellation cannot leave held input or mutate the
   author's machine.

Required verification matrix:

- TS/C++ coroutine vectors: first/nested resume, deep yield, varargs, tail calls,
  status, dead/running resume errors, protected errors, upvalues shared with
  another thread, collection of unreachable cycles and tight guest RAM limits.
- HALT/IRQ, nested NMI, DMA waits and debugger stops during a resumed thread;
  no forced privilege writes, frame-depth confusion or runaway completion call.
- Save/restore with a yielded, running-interrupted and failed coroutine, shared
  objects and open upvalues; deterministic replay and native parity.
- O0/O3 source stepping, inline locals, caught/uncaught errors and completion
  returns; review ordinary Actor Lab and Hot Resume callers for regressions.
- Same named case alone, in a module, in shuffled order, and after a failed
  previous case. Verify memory, input, RNG/save fixtures and module state do
  not leak between cases.
- Fixed input holds across long guest calls, disabled PCRTC, machine faults,
  missed predicates, timeout, cancellation and teardown timeout.
- Browser software/WebGL2/WebGPU and headless execution; actual accepted captures
  and visible debugger/source navigation for UI claims.
- Release/build dependency audits: no test source, instrumentation, test
  operation channel or Studio policy in ordinary player hot paths.

Performance evidence must separate compile, cold boot, actual case execution,
coroutine switch cost and UI presentation. Measure both synchronous throughput
and a real multi-frame gameplay scenario in TS and native code. Compare against
the unchanged checkout; typechecks do not prove no regression.

Enforce structural properties as well as timings: no stack copying on yield,
no allocation per waiting tick, no per-opcode test branch, no repeated module
discovery/compilation for cases sharing a build, and no unaccounted coroutine
stack memory. A boundary hook exists only during an explicit boundary wait;
normal frames do not poll all tests. Performance problems must be fixed at the
owning representation, not by omitting isolation, fault semantics or parity.

Before each mirrored-runtime diff, refresh the representation table and exact
callsite inventory against that checkout. Stop if switching, collection,
completion or hardware ownership is still unresolved; do not ship a test-only
shortcut to get the attractive API working.

## 11. Validation of this proposal

This is a source/reference-backed design, not runtime or UI proof of the new
framework. On 2026-09-22, all nine existing tests in this focused baseline passed:

```sh
./node_modules/.bin/tsx --tsconfig tsconfig.base.json --test \
  --import ./tests/lua/test_setup.ts \
  tests/lua/scenario_lab_services.test.ts \
  tests/rompacker/scenario_cartridge.test.ts \
  tests/rompacker/scenario_run_service.test.ts \
  tests/rompacker/scenario_test_sources.test.ts
```

These collection/result, packaging and media-session tests validate current
behavior only. The implementation slices above remain unimplemented, including
the generic coroutine facility. No new runtime, native parity, performance or
visible UI claim is made by this document.
