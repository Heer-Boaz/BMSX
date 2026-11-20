# Guest testing

Current authoring and execution contract for the guest-test tools.

## Authoring

A suite can live beside cart source (for example `carts/bricklane/keyboard_assert.lua`)
or under the corresponding `tests/carts/<cart>/` directory. Both are source-only
debug assets, including suites under a cart's `res/` directory; neither enters
gameplay compilation or release media. Debug production includes the test runner
and recorder sources even before the first suite exists. Old immutable artifacts
without those sources need a new debug build, not a runtime fallback or a network
dependency injected into the isolated machine.

A debug-packaged `*_assert.lua` module returns a statically discoverable suite:

```lua
local arithmetic<const> = require('arithmetic')
return {
    kind = 'unit',
    setup = function(t, fixture) fixture.value = 7 end,
    teardown = function(t, fixture) t:log('cleanup') end,
    tests = {
        adds = function(t, fixture)
            assert(arithmetic.add(fixture.value, 2) == 9)
        end,
    },
}
```

Use a returned literal table, literal case names and function declarations.
Discovery reads source, never executes test registration. The declaration has
one kind (`unit` or `integration`), optional per-case hooks, and named tests.
It deliberately does not support dynamically generated suites. Helpers remain
ordinary `require` modules. Return values do not encode runner commands or
pass/fail: normal completion passes; an assertion/error fails.

A test that deliberately performs more work in one phase may declare a larger
machine-cycle allowance without relaxing the limit for other cases:

```lua
return {
    kind = 'unit',
    phase_cycles = { long_scan = 67737600 },
    tests = { long_scan = function(t) --[[ long bounded scan ]] end },
}
```

The names must identify cases in the suite and each allowance must be a positive
integer literal. It applies independently to each setup, body and teardown phase
of that case. Yielding to a test operation does not reset the phase allowance.
Module initialization, cleanup, total case cycles and tick limits remain separate.

Consecutive cases in a run share a physical machine. After a pass the next
case uses the ordinary console reboot with released input and a new fixture
table. If its compiled suite changed, the host installs the new ROM on the
same card before rebooting. This is not a power-on: for
example, cartridge RAM survives a console reset. Do not depend on another
case's writes or assume reset clears persistent storage. When a failure is
retained for inspection, the next case gets a separate machine. Setup and body
share a fixture table. Teardown runs after successful or
failed setup/body; failed setup skips the body. Separate retained coroutines
preserve both body and teardown failures. Unit targets initialize the BIOS and
required modules, then run the selected case without entering the game loop.
Integration targets park at the real cartridge entry until guest code waits.

```lua
return {
    kind = 'integration',
    tests = {
        starts_on_input = function(t)
            t:wait_until('title screen', function() return game.on_title end, 120)
            t:press('Space', 2)
            t:wait_until('gameplay', function() return game.running end, 60)
            assert(game.score == 0)
            t:capture('first gameplay frame')
        end,
    },
}
```

`wait_ticks(n)` advances completed machine ticks. `wait_until(label, predicate,
max_ticks)` is a normal Lua loop. `at_boundary(receipt, max_ticks)` waits for the
world owner's actual publication receipt, not a guessed frame count. The CPU
stops at its next instruction before game mutation can proceed.

`press(code, samples, gamepad)` delivers exactly that many ICU down samples and
waits for release. `down`/`up` deliver a held/released key at the next sample.
The optional gamepad index is Lua's 1-based index; omitted means keyboard.
No runner forces the ICU arm bit or consumes Studio's physical input.
Captures wait for an accepted physical presentation, not just a video tick.
FSM/action-effect observations consume their existing guest recorder rings.

## Execution and Studio

The linker already owns module export slots and generic module preloads. The
runner uses those slots; there is no authored host/test global, synthetic game
entry wrapper, ready/update callback or command-return protocol.

`ide/testing/{target,input,execution,run}.ts` owns physical targets, input,
bounded phase execution and serial run lifetime respectively. Studio and the
Node CLI use this same owner. `testlib/execution.lua` retains phase coroutines;
`testlib/context.lua` supplies sequential integration operations using ordinary
Lua yield/resume. The CPU knows nothing about tests.

Studio projects project/module/case nodes and current source ranges. Edited
and newly admitted suites refresh discovery. A run pins its sources; rerun
resolves the current selection and current sources. Test builds own editable
source records, including saved source-only helpers. They never install media,
restore state or attach a test continuation to the authoring Runtime.

`workbench/services/testing/scenario_runs.ts` owns that workspace admission,
not the Scenario Lab view. Clients pass a stable project/module/case identity;
the service resolves current declarations and captures its own document models
and source revisions before preparation yields. Later typing cannot alter an
accepted run, and unrelated document services or dirty-record maps cannot supply
its inputs. `start()` rejects stale/invalid selections synchronously and returns
the accepted run identity, **not** test completion. `wait(run, signal?)` observes
actual completion, including cancellation cleanup; aborting a wait only detaches
that observer. `cancel(run)` targets that exact live run, never a newer one.
Disposing a view leaves this workspace owner alive.
Working-copy restoration retires pending execution and permits new requests;
workbench shutdown closes admission before asynchronous source saves.

Result history retains the exact accepted suite text alongside its case identity,
range and source revision. Scenario Lab's **Details / Inspect Test Result** on a
case result reads that captured text, even after a rerun or disposal of its target
and working copy. This is historical suite evidence, not an editable source or
proof that the current workspace/dependencies match. A preparation failure may
not have executed the captured suite at all. Revision numbers are labels within
their source owner, not globally unique content identities.
Details also reports retained log/capture counts and Studio-ring eviction.
The [assistant evidence tools](studio_test_evidence.md) read these same historical
records. The separate [execution operations](studio_test_execution.md) use the
shared run service to discover/start/wait/cancel, without installing authoring
media or attaching a debugger.

A named case can also be admitted in explicit `debug` mode from ordinary
Scenario Lab or conversations. The isolated `TestDebugger` composes source
breakpoint/step matching with the runner's admission/publication hook; the
runner still owns every grant, budget and phase. Compiled-source breakpoints,
Continue/Into/Over/Out, live stop inspection and debug-rerun use this shared owner,
not the authoring debugger. Live handles expire before execution/cleanup;
failed-target attachments remain read-only case-end inspection. See the
[test-debugger contract](studio_test_debugger.md) for control authority,
prompt-scoped cancellation and the separate live/retained lifetimes.

Machine construction is supplied by Studio/CLI composition through
`TestTargetFactory`. The run owns test input and case/result policy; the concrete
`OffscreenMachine` owns physical boot, lazy rendering and disposal. The host
owner accepts ordinary ICU input and has no dependency on testing or Studio.
It directly satisfies the target contract, with no wrapper around the machine.
Socket media is decoded once at host construction through the shared player
media owner, not by the test feature.

At most one current target and one most-recent failed target are retained.
A fixture places the selected suite cartridge in physical socket 0 and the other
loaded cartridge in socket 1. Both media inputs are retained, including CLI
`--slot1`. This is an explicit new-machine socket layout, not simulated original
socket numbers: only tooling maps execution domains back to authoring source
domains. Guest registers and ROM data are never rewritten for that mapping.
Compiled media is cached only for the current module, not for every suite.
Studio advances at most sixteen CPU grants per host frame, rather than pacing
each small grant at UI refresh speed. A debugger stop ends batching after one backend service, without CPU time. Result/log/trace/capture histories are bounded. CLI screenshot writes apply
backpressure before another CPU grant.

On cancellation at a yielded phase boundary, the suspended coroutine is closed
and bounded teardown runs. Cancellation remains cancellation. If execution is
inside an uncooperative CPU continuation, initialization or physical exception,
there is no safe cleanup call boundary: the target stops without fabricating an
unwind. Machine faults and CPU-budget exhaustion similarly quarantine the
target; cancellation records incomplete cleanup explicitly. Repeated cancellation
does not interrupt already-running cleanup. Host/runner infrastructure failures
stop the batch and skip its remaining cases. Teardown cannot erase an earlier failure. Disposal releases held input
and backend resources.

Failed targets support [read-only post-mortem attachments](studio_test_inspection.md)
from Scenario Lab and conversation tools: original phase stacks, locals,
upvalues, tables and compiled source. Values are retained at case end, including
cleanup mutations; this is not a throw-time heap snapshot. Source and target
identity do not depend on the authoring CPU or current editor contents.

**Current limitations:** live breakpoint/step/debug-rerun attachment to the
separate test target is not implemented. Failed Lua threads cannot be resumed. The former command that debugged the authoring Runtime was
removed rather than preserved through a facade. No mid-case Hot Resume or test
session checkpoint restore is offered. Ordinary cartridge coroutine save-state
and TS/C++ replay are supported. Native guest execution
of the test library is covered; the CLI/Studio test adapter itself is TypeScript.

## Budgets and measured cost

Defaults are explicit in `DEFAULT_TEST_BUDGETS`:

| Bound | Default |
| --- | ---: |
| CPU grant before returning to host | 65,536 cycles |
| Cold BIOS/module initialization | 67,737,600 cycles (2 CPU seconds) |
| Each executing phase | 33,868,800 cycles (1 CPU second) |
| Cleanup, including waits | 33,868,800 cycles |
| Case elapsed physical cycles | 3,386,880,000 cycles (100 CPU seconds) |
| Case completed logical ticks | 3,000 |
| CLI process/run watchdog | 60 seconds by default |

Unit targets run the physical BIOS startup, including its boot screen. Group
checks of independent APIs in one case when neither needs another startup.
Use separate cases for independent game lifecycles and explicit reset
regressions, not individual scalar assertions.

## Running the suites

The BIOS library suite checks builtins directly on one physical BIOS boot, not
by running a demonstration cartridge per library. It advances actual console
ticks before comparing the BIOS clock to the machine timer.

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- emptycart --debug
npm run headless:test -- emptycart tests/carts/emptycart/bios_runtime_assert.lua
```

The same BIOS suite runs as part of `npm run test:headless`. Named cartridge
scenarios still run through the same host owner, with `--case` for a specific
test. For example:

```sh
npm run headless:test -- nemesis_s tests/carts/nemesis_s/nemesis_s_pause_assert.lua --case input_pause_retains_simulation_and_music
```

References studied: [Lua coroutines](https://github.com/lua/lua/blob/v5.4.8/lcorolib.c),
[LuaUnit](https://github.com/bluebird75/luaunit/blob/main/luaunit.lua),
[Neovim functional fixtures](https://github.com/neovim/neovim/blob/master/test/functional/testnvim.lua),
[VS Code test results](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/testing/common/testResult.ts).
They inform ownership and lifecycle; their frameworks are not embedded here.
