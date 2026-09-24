import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { TestInput } from '../../ide/testing/input';
import { DEFAULT_TEST_BUDGETS, TestExecution } from '../../ide/testing/execution';
import { RuntimeDebuggerResumeMode as Mode } from '../../ide/runtime/source_debugger';
import { ScenarioResultService } from '../../ide/testing/scenario/result_service';
import type { ScenarioTestItem } from '../../ide/testing/scenario/test_collection';
import { captureRuntimeMachineState } from '../../machine/ts/machine/runtime/machine_state';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { ALL_EXECUTION_DOMAINS_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { buildTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import { blua32SourceRangeAtPc } from '../../toolchain/ts/rompack/blua32_symbols';
import { buildScenarioMediaFixture, SCENARIO_FIXTURE_TEST_SOURCE_PATH as PATH } from '../helpers/scenario_media';

async function fixture(t: TestContext, source: string, optLevel: 0 | 3, cartSource = "module<entry>\nerror('game entry must not run in a unit target')") {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-test-debugger-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const media = await buildScenarioMediaFixture(directory, [{ path: PATH, source }], {
		systemSource: "module<entry>\nrequire('base')\ncoroutine = require('coroutine')\ncop0.exec = mem[0x10000028]",
		systemModules: [{ path: 'base', source: 'local raise<const> = __bmsx_error\nassert = function(value, message) if not value then raise(message) end return value end\nerror = raise\nsetmetatable = __bmsx_setmetatable' },
			{ path: 'coroutine', source: await readFile('machine/bios/coroutine.lua', 'utf8') }],
		cartSource, cartModules: [{ path: 'game', source: 'return { after_publication = 0 }' }],
	});
	const program = await buildTestCartridge({ systemRom: media.systemRom, cartridge: media.cartRom,
		test: { sourcePath: PATH, source }, ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel });
	const target = new OffscreenMachine(media.systemRom, [program.layer.bytes, null], PSX_MACHINE_SPEC, new TestInput());
	const results = new ScenarioResultService();
	const item: ScenarioTestItem = { kind: 'test', id: 'scenario:1:debug-probe', parentId: 'scenario-module:1:debug', label: 'probe', caseName: 'probe',
		assetId: 'probe', sourceTimestamp: 0, resource: { domain: 1, path: PATH }, range: program.suite.tests[0].range };
	const run = results.beginRun(item.id, [{ test: item, source, sourceRevision: 0 }]), result = results.startItem(run, 0, 0);
	const execution = new TestExecution(target, program, results, result,
		{ ...DEFAULT_TEST_BUDGETS, phaseCycles: 100_000, quantumCycles: 2048 }, undefined, 'debug');
	t.after(() => execution.dispose());
	const debug = execution.debugger!;
	const advance = () => {
		for (let grant = 0; execution.active && !debug.stopped && grant < 10000; grant++) execution.advance();
		assert.ok(!execution.active || debug.stopped, 'a bounded target reaches a real stop or terminal result');
	};
	const line = () => {
		const image = program.debugImages[debug.source.stopDomain + 1]!.image;
		return blua32SourceRangeAtPc(image.symbols!, image.layout.header.textAddress, debug.source.stopPc)!.start.line;
	};
	return { media, program, target, result, execution, debug, advance, line };
}

for (const optLevel of [0, 3] as const) {
	test(`O${optLevel}: isolated test debugging admits before bind, steps actual phase coroutines and leaves authoring untouched`, async t => {
		const source = `local shared = { value = 0 }
local child<const> = function(amount)
 shared.value = amount
 shared.value = shared.value + 1
 return shared.value
end
return { kind = 'unit',
 setup = function() shared.value = 10 end,
 teardown = function(t) t:log('cleanup') end,
 tests = { probe = function()
  local result = child(20)
  shared.value = result + 1
  assert(shared.value == 22)
 end },
}`;
		const f = await fixture(t, source, optLevel), { debug, target, execution } = f;
		const authoring = new OffscreenMachine(f.media.systemRom, [f.media.cartRom, null], PSX_MACHINE_SPEC, new TestInput());
		t.after(() => authoring.dispose());
		let authoringStops = 0;
		authoring.runtime.machine.cpu.setExecutionHook(() => { authoringStops++; return true; }, ALL_EXECUTION_DOMAINS_MASK, 0);
		const original = captureRuntimeMachineState(authoring.runtime);
		const admitted = debug.wait(); f.advance(); assert.equal((await admitted).reason, 'entry');
		assert.equal(f.result.state, 'preparing'); assert.equal(debug.canResume(Mode.StepInto), false);
		assert.throws(() => debug.resume(Mode.StepInto), /cannot resume/);
		const paused = captureRuntimeMachineState(target.runtime);
		for (let frame = 0; frame < 32; frame++) execution.advance();
		assert.deepEqual(captureRuntimeMachineState(target.runtime), paused, 'a stopped test gets no guest time or grants');
		const compiled = debug.sources.catalog.find(entry => entry.path === PATH)!;
		assert.equal(compiled.domain, 0); assert.equal(compiled.sourceDomain, 1);
		assert.equal(debug.sources.read(compiled.source).text, source);
		const points = debug.sources.setBreakpoints(compiled.source, [11, 6]);
		assert.deepEqual(points.map(point => point.status), ['no-statement', 'bound']);
		assert.equal(debug.sources.setBreakpoints(compiled.source, [6, 11]), points, 'unchanged requests reuse exact bindings');
		debug.resume(Mode.Continue); const stopped = debug.wait(); f.advance();
		assert.equal((await stopped).reason, 'breakpoint'); assert.equal(f.line(), 11); assert.equal(debug.phase, 'body');
		const thread = target.runtime.machine.cpu.activeThread;
		assert.notEqual(thread, target.runtime.machine.cpu.rootThread, 'the guest testlib owns a real phase coroutine');
		debug.resume(Mode.StepInto); f.advance();
		assert.equal(f.line(), 3); assert.equal(debug.source.stopThread, thread);
		debug.resume(Mode.StepOver); f.advance(); assert.equal(f.line(), 4);
		debug.resume(Mode.StepOut); f.advance(); assert.equal(f.line(), 12);
		debug.sources.setBreakpoints(compiled.source, []);
		debug.resume(Mode.Continue); const finished = debug.wait(); f.advance();
		assert.equal((await finished).status, 'finished'); assert.equal(execution.active, false);
		assert.equal(f.result.state, 'passed', JSON.stringify(f.result.failures)); assert.equal(f.result.logs.at(0).text, 'cleanup');
		assert.deepEqual(captureRuntimeMachineState(authoring.runtime), original);
		assert.equal(authoringStops, 0); assert.equal(authoring.runtime.machine.cpu.runUntilDepth(0, 1000), RunResult.ExecutionStopped);
		assert.equal(authoringStops, 1, 'binding the test debugger never overwrites the authoring hook');
	});

	test(`O${optLevel}: source stepping preserves the runner's publication stop before gameplay continues`, async t => {
		const source = `local game<const> = require('game')
return { kind = 'integration', tests = { probe = function(t)
 local receipt = { reached = false }
 game.receipt = receipt
 t:at_boundary(receipt, 10)
 assert(game.after_publication == 0)
 t:wait_ticks(2)
 assert(game.after_publication == 1)
end } }`;
		const game = `module<entry>
local game<const> = require('game')
function irq(flags) mem[0x08000004] = flags end
mem[0x08000008] = 4
while true do
 if game.receipt ~= nil then
  game.receipt.reached = true
  game.after_publication = 1
  game.receipt = nil
 end
 halt_until_irq
end`;
		const f = await fixture(t, source, optLevel, game), { debug } = f;
		f.advance();
		const compiled = debug.sources.catalog.find(entry => entry.domain === 0 && entry.path === 'entry.lua')!;
		assert.equal(debug.sources.setBreakpoints(compiled.source, [7])[0].status, 'bound');
		debug.resume(Mode.Continue); f.advance(); assert.equal(debug.reason, 'breakpoint'); assert.equal(f.line(), 7);
		debug.resume(Mode.StepOver); f.advance();
		assert.equal(debug.reason, 'test-boundary', 'publication wins before the next game statement or test resume');
		debug.resume(Mode.Continue); f.advance();
		assert.equal(f.result.state, 'passed', JSON.stringify(f.result.failures));
	});

	for (const cancelAt of ['body', 'teardown'] as const) test(`O${optLevel}: cancelling a ${cancelAt} stop preserves bounded cleanup policy`, async t => {
		const source = `return { kind = 'unit',
 teardown = function(t)
  t:log('cleanup')
 end,
 tests = { probe = function(t, fixture)
  fixture.value = 42
  assert(fixture.value == 42)
 end },
}`;
		const f = await fixture(t, source, optLevel), { debug, execution } = f;
		f.advance(); const compiled = debug.sources.catalog.find(entry => entry.path === PATH)!;
		assert.equal(debug.sources.setBreakpoints(compiled.source, [cancelAt === 'body' ? 6 : 3])[0].status, 'bound');
		debug.resume(Mode.Continue); f.advance(); assert.equal(debug.phase, cancelAt);
		const cpu = f.target.runtime.machine.cpu, thread = cpu.activeThread, frame = thread.frames.at(-1)!, pc = frame.pc;
		execution.cancel(); const completion = debug.wait();
		if (cancelAt === 'body') {
			assert.equal(execution.active, false); assert.equal(frame.pc, pc); assert.ok(thread.frames.includes(frame));
			assert.match(f.result.failures[0].message, /outside a cooperative phase boundary/);
		} else {
			assert.equal(debug.status, 'cancelling'); assert.equal(execution.active, true);
			assert.equal(debug.canResume(Mode.Continue), false);
			debug.pause(); assert.equal(debug.status, 'cancelling', 'UI pause cannot re-enable source stops during cleanup');
			f.advance(); assert.equal(f.result.logs.at(0).text, 'cleanup');
		}
		assert.equal((await completion).status, 'finished'); assert.equal(f.result.state, 'cancelled');
	});

	for (const failure of [false, true]) test(`O${optLevel}: stepping out of a phase ${failure ? 'failure' : 'return'} stops before the runner consumes it`, async t => {
		const source = `return { kind = 'unit', tests = { probe = function()
 test_value = 42
 ${failure ? "error('authored failure')" : 'return true'}
end } }`;
		const f = await fixture(t, source, optLevel), { debug } = f;
		f.advance(); const compiled = debug.sources.catalog.find(entry => entry.path === PATH)!;
		assert.equal(debug.sources.setBreakpoints(compiled.source, [3])[0].status, 'bound');
		debug.resume(Mode.Continue); f.advance(); assert.equal(debug.reason, 'breakpoint');
		debug.resume(Mode.StepOut); f.advance();
		assert.equal(debug.reason, 'thread-completed'); assert.equal(f.result.state, 'running');
		const completed = debug.inspect();
		assert.equal(completed.state.stack.status, failure ? 'available' : 'thread-closed');
		assert.equal(completed.state.thread, completed.state.stack.thread);
		if (failure) {
			const stack = completed.readStack(completed.state.stack.reference!, 0, 100);
			assert.equal(stack.origin, 'failed-thread');
			assert.ok(stack.frames.some(frame => frame.kind === 'source' && frame.workspacePath === PATH && frame.line === 3));
		}
		completed.dispose();
		assert.equal(f.result.failures.length, 0, 'the guest runner has not consumed the phase outcome yet');
		debug.resume(Mode.Continue); f.advance();
		assert.equal(f.result.state, failure ? 'failed' : 'passed');
		if (failure) {
			assert.equal(f.result.failures.length, 1); assert.equal(f.result.failures[0].message, 'authored failure');
			const retained = f.execution.inspect();
			assert.equal(retained.state.failures[0].origin, 'failed-thread');
			assert.ok(retained.readStack(retained.state.failures[0].reference!, 0, 10).frames.length > 0);
			retained.dispose();
		}
	});
}

test('a debug continuation still exhausts its ordinary phase budget and retains the quarantined target', async t => {
	const f = await fixture(t, `return { kind = 'unit', tests = { probe = function() while true do end end } }`, 0);
	f.advance(); f.debug.resume(Mode.Continue); const finished = f.debug.wait(); f.advance();
	assert.equal((await finished).status, 'finished'); assert.equal(f.result.state, 'failed');
	assert.match(f.result.failures[0].message, /Phase exceeded its cycle budget/);
	const retained = f.execution.inspect(); assert.equal(retained.state.failures[0].origin, 'quarantined-cpu'); retained.dispose();
});

test('an ordinary run allocates no debugger and an uninstrumented debug Continue preserves physical execution', async t => {
	const source = `return { kind = 'unit', tests = { probe = function(t)
 local value = 0
 for index = 1, 1000 do value = value + index end
 assert(value == 500500)
 t:log(value)
end } }`;
	const f = await fixture(t, source, 3);
	const target = new OffscreenMachine(f.media.systemRom, [f.program.layer.bytes, null], PSX_MACHINE_SPEC, new TestInput());
	const results = new ScenarioResultService(), run = results.beginRun(f.result.test.id, [{ test: f.result.test, source, sourceRevision: 0 }]);
	const normal = new TestExecution(target, f.program, results, results.startItem(run, 0, 0),
		{ ...DEFAULT_TEST_BUDGETS, phaseCycles: 100_000, quantumCycles: 2048 });
	t.after(() => normal.dispose());
	assert.equal(normal.debugger, undefined);
	for (let grant = 0; normal.active && grant < 10000; grant++) normal.advance();
	assert.equal(normal.result.state, 'passed');
	f.advance(); f.debug.resume(Mode.Continue); f.advance(); assert.equal(f.result.state, 'passed');
	assert.equal(f.target.runtime.machine.scheduler.nowCycles, target.runtime.machine.scheduler.nowCycles);
	assert.deepEqual(captureRuntimeMachineState(f.target.runtime), captureRuntimeMachineState(target.runtime),
		'admission, control receipts and empty source policy neither execute Lua nor alter heap/devices/time');
});

test('test-debugger wait cancellation, pause, runner failure and disposal settle without polling or running a private loop', async t => {
	const f = await fixture(t, `return { kind = 'unit', tests = { probe = function() while true do end end } }`, 0), { debug, execution } = f;
	f.advance(); const cycles = f.target.runtime.machine.scheduler.nowCycles;
	debug.resume(Mode.Continue);
	const abort = new AbortController(), detached = debug.wait(abort.signal);
	abort.abort(new Error('detached')); await assert.rejects(detached, /detached/);
	assert.equal(debug.status, 'running'); assert.equal(f.target.runtime.machine.scheduler.nowCycles, cycles);
	const paused = debug.wait(); debug.pause(); assert.equal((await paused).reason, 'pause');
	debug.resume(Mode.Continue); const failed = debug.wait(); execution.failRunner(new Error('host target failed'));
	assert.equal((await failed).status, 'finished'); assert.equal(f.result.failures[0].phase, 'runner');
	assert.equal(f.result.state, 'failed'); assert.equal(execution.active, false);
	assert.equal(f.target.runtime.machine.scheduler.nowCycles, cycles);
	const source = debug.sources.catalog[0].source;
	debug.dispose(); assert.equal((await debug.wait()).status, 'closed');
	assert.throws(() => debug.sources.read(source), /does not belong/);
});
