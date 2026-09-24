import { COROUTINE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { getEventListeners } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { buildScenarioMediaFixture, SCENARIO_FIXTURE_TEST_SOURCE_PATH as PATH } from '../helpers/scenario_media';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { createRuntimeSourceState, enterCartridgeSources } from '../../ide/runtime/sources';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { RuntimeDebuggerResumeMode as Mode } from '../../ide/runtime/source_debugger';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { ScenarioRunService } from '../../ide/workbench/services/testing/scenario_runs';
import { WorkspaceTestTools } from '../../ide/workbench/services/assistant/test_tools';
import { MemoryStorage } from '../../ide/workspace/memory_storage';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { TestInput } from '../../ide/testing/input';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { captureRuntimeMachineState } from '../../machine/ts/machine/runtime/machine_state';
import { TestTargetInspectionModel } from '../../ide/workbench/contrib/scenario_lab/target_inspection_model';
import { decodeTestToolRequest } from '../../ide/workbench/services/assistant/test_tool_protocol';

const SOURCE = `local shared = { value = 0 }
test_global = shared
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

async function fixture(t: TestContext, slot: 0 | 1 = 0, optLevel: 0 | 3 = 0) {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-debug-tools-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const media = await buildScenarioMediaFixture(directory, [{ path: PATH, source: SOURCE }], {
		systemSource: "module<entry>\nrequire('base')\ncoroutine = require('coroutine')\ncop0.exec = mem[0x10000028]",
		systemModules: [{ path: 'base', source: 'local raise<const> = __bmsx_error\nassert = function(value, message) if not value then raise(message) end return value end\nerror = raise\nsetmetatable = __bmsx_setmetatable' },
			...COROUTINE_FIRMWARE_MODULES],
		cartSource: 'module<entry>\nwhile true do halt_until_irq end',
	});
	const loaded = await loadRomToolingMedia(media.systemRom, [media.cartRom, media.cartRom]);
	const sources = createRuntimeSourceState(loaded.system, loaded.cartridgeSlots), models = new EditorTextModelService();
	enterCartridgeSources(sources, slot); sources.realtimeCompileOptLevel = optLevel;
	const authoring = new OffscreenMachine(media.systemRom, [media.cartRom, media.cartRom], PSX_MACHINE_SPEC, new TestInput());
	const initial = captureRuntimeMachineState(authoring.runtime), installed = sources.currentBlua32Media;
	const service = new ScenarioRunService(models, sources, new RuntimeLuaTooling(sources, new SuspendedGuestSession(authoring.runtime)),
		new MemoryStorage(), new Map(), PSX_MACHINE_SPEC, (bios, carts, model, input) => new OffscreenMachine(bios, carts, model, input));
	const connection = new AbortController(), tools = new WorkspaceTestTools(service, connection.signal);
	t.after(() => { tools.dispose(); service.dispose(); models.clear(); authoring.dispose(); });
	async function settle<T>(work: T | Promise<T>): Promise<T> {
		let settled = false;
		const completion = Promise.resolve(work).finally(() => { settled = true; });
		for (let grant = 0; !settled && grant < 10000; grant++) { service.advance(); await setImmediate(); }
		assert.ok(settled, 'bounded host driver must reach a real event, without model read polling');
		return completion;
	}
	const document = models.retain(sources.luaResources.find(resource => resource.domain === slot && resource.path === PATH)!, 'lua', SOURCE);
	const discovery = await tools.execute('studio_list_tests', {}); assert.ok(discovery.kind === 'tests');
	const module = discovery.data.roots[0].modules[0], scope = module.cases[0].scope;
	return { service, tools, connection, document, models, sources, authoring, initial, installed, module, scope, settle };
}

for (const [slot, optLevel] of [[0, 0], [1, 3]] as const) test(`socket ${slot}, O${optLevel}: conversation and ordinary inspection share live stops, compiled sources and isolated execution`, async t => {
	const f = await fixture(t, slot, optLevel), { tools, service, settle } = f;
	assert.throws(() => tools.execute('studio_debug_test', { scope: f.module.scope }), /one named test case/);
	assert.equal(service.results.runs.length, 0);
	const start = await tools.execute('studio_debug_test', { scope: f.scope }); assert.ok(start.kind === 'test-run');
	assert.equal(start.data.mode, 'debug'); assert.equal(start.data.state, 'running');
	const run = start.data.run, record = service.results.liveRun!;
	let runFinished = false;
	const terminal = service.wait(record).then(() => { runFinished = true; });
	f.document.pushEditOperations([{ offset: 0, deleteLength: f.document.buffer.length, text: SOURCE.replace('child(20)', 'child(500)') }]);
	const entry = await settle(tools.execute('studio_wait_test_debugger', { run })); assert.ok(entry.kind === 'test-debugger');
	assert.equal(entry.data.reason, 'entry'); assert.equal(entry.data.canStep, false); assert.equal(runFinished, false);
	const debug = service.debugger!, runtime = service.session!.execution!.target.runtime;
	const paused = captureRuntimeMachineState(runtime);
	let services = 0;
	const target = service.session!.execution!.target, serviceBackend = target.serviceBackend.bind(target);
	t.mock.method(target, 'serviceBackend', () => { services++; serviceBackend(); });
	for (let frame = 0; frame < 50; frame++) service.advance();
	assert.equal(services, 50, 'paused host frames service backend once, not sixteen no-op grants');
	assert.deepEqual(captureRuntimeMachineState(runtime), paused);
	const catalog = await tools.execute('studio_list_test_debug_sources', { run }); assert.ok(catalog.kind === 'test-debug-sources');
	const source = catalog.data.sources.find(source => source.path === PATH)!;
	assert.equal(source.domain, 0); assert.equal(source.sourceDomain, slot);
	const compiled = await tools.execute('studio_read_test_debug_source', { run, source: source.source }); assert.ok(compiled.kind === 'test-debug-source');
	assert.equal(compiled.data.text, SOURCE);
	const points = await tools.execute('studio_set_test_breakpoints', { run, source: source.source, lines: [7, 12] }); assert.ok(points.kind === 'test-breakpoints');
	assert.equal('text' in points.data, false, 'breakpoint receipts do not retransmit the complete compiled source');
	assert.deepEqual(points.data.breakpoints.map(point => point.status), ['no-statement', 'bound']);
	const first = await settle(tools.execute('studio_resume_test_debugger', { run, revision: entry.data.revision, mode: 'continue' })); assert.ok(first.kind === 'test-debugger');
	assert.equal(first.data.reason, 'breakpoint'); assert.equal(first.data.phase, 'body'); assert.equal(runFinished, false);
	assert.throws(() => tools.execute('studio_resume_test_debugger', { run, revision: entry.data.revision, mode: 'into' }), /changed since/);
	const second = await settle(tools.execute('studio_resume_test_debugger', { run, revision: first.data.revision, mode: 'into' })); assert.ok(second.kind === 'test-debugger');
	assert.equal(second.data.reason, 'step');
	const stopped = captureRuntimeMachineState(runtime);
	const attached = await tools.execute('studio_inspect_test_stop', { run, revision: second.data.revision }); assert.ok(attached.kind === 'test-stop-inspection');
	assert.equal(attached.data.heap, 'stopped'); assert.equal(attached.data.thread, debug.source.stopThread!.hashId);
	const stack = await tools.execute('studio_read_test_stack', { stack: attached.data.stack.reference, start: 0, count: 100 }); assert.ok(stack.kind === 'test-stack');
	assert.equal(stack.data.origin, 'stopped-thread');
	const frame = stack.data.frames[0]; assert.ok(frame.kind === 'source');
	assert.equal(frame.line, 4); assert.equal(frame.resource.domain, slot); assert.equal(frame.domain, 0);
	const scopes = await tools.execute('studio_read_test_frame_scopes', { frame: frame.reference }); assert.ok(scopes.kind === 'test-frame-scopes');
	const locals = await tools.execute('studio_read_test_values', { reference: scopes.data.scopes.find(scope => scope.kind === 'locals')!.reference, start: 0, count: 100 }); assert.ok(locals.kind === 'test-values');
	assert.equal(locals.data.entries.find(entry => entry.key.display === 'amount')!.value.display, '20');
	const globals = attached.data.globals.find(scope => scope.domain === 0)!;
	const values = await tools.execute('studio_read_test_values', { reference: globals.reference, start: 0, count: globals.count }); assert.ok(values.kind === 'test-values');
	const shared = values.data.entries.find(entry => entry.key.display === 'test_global')!.value.reference!;
	const table = await tools.execute('studio_read_test_values', { reference: shared, start: 0, count: 100 }); assert.ok(table.kind === 'test-values');
	assert.equal(table.data.entries[0].value.display, '10', 'the first child assignment has not executed');
	const exact = await tools.execute('studio_read_test_frame_source', { frame: frame.reference }); assert.ok(exact.kind === 'test-frame-source'); assert.equal(exact.data.text, SOURCE);
	const ordinary = debug.inspect(), model = new TestTargetInspectionModel(ordinary), root = model.tree.roots[0];
	assert.equal(root.children.length, 0); root.collapsed = false; model.resolve(root);
	assert.equal(root.children[0].element.value, `${PATH}:4:2`);
	assert.deepEqual(captureRuntimeMachineState(runtime), stopped, 'inspection is a host borrow, never Lua execution or guest allocation');
	let expiredBeforeExecution = false; const stoppedCycles = runtime.machine.scheduler.nowCycles;
	ordinary.onDidDispose(() => { expiredBeforeExecution = true; assert.equal(runtime.machine.scheduler.nowCycles, stoppedCycles); });
	const next = tools.execute('studio_resume_test_debugger', { run, revision: second.data.revision, mode: 'over' });
	assert.equal(expiredBeforeExecution, true); assert.equal(ordinary.available, false);
	assert.throws(() => tools.execute('studio_read_test_values', { reference: shared, start: 0, count: 1 }), /expired/);
	const third = await settle(next); assert.ok(third.kind === 'test-debugger');
	assert.equal(third.data.reason, 'step');
	const fourth = await settle(tools.execute('studio_resume_test_debugger', { run, revision: third.data.revision, mode: 'out' })); assert.ok(fourth.kind === 'test-debugger');
	assert.equal(fourth.data.reason, 'step');
	await tools.execute('studio_set_test_breakpoints', { run, source: source.source, lines: [] });
	const done = await settle(tools.execute('studio_resume_test_debugger', { run, revision: fourth.data.revision, mode: 'continue' })); assert.ok(done.kind === 'test-debugger');
	assert.equal(done.data.status, 'finished'); await terminal; assert.equal(record.state, 'passed');
	assert.equal(record.items[0].logs.at(0).text, 'cleanup');
	assert.throws(() => tools.execute('studio_list_test_debug_sources', { run }), /no live test debugger/);
	assert.deepEqual(captureRuntimeMachineState(f.authoring.runtime), f.initial); assert.equal(f.sources.currentBlua32Media, f.installed);
});

test('manual debug observation is read-only; request cancellation pauses only its own execution; prompt retirement cancels its run', async t => {
	const f = await fixture(t), { service, tools, settle } = f;
	const manual = service.start(service.collection.roots[0].children[0].children[0].id, 'debug');
	const listed = await tools.execute('studio_list_test_runs', {}); assert.ok(listed.kind === 'test-runs'); const run = listed.data.runs[0].run;
	const stop = await settle(tools.execute('studio_wait_test_debugger', { run })); assert.ok(stop.kind === 'test-debugger');
	const debug = service.debugger!, inspection = debug.inspect();
	await tools.execute('studio_inspect_test_stop', { run, revision: stop.data.revision });
	assert.throws(() => tools.execute('studio_resume_test_debugger', { run, revision: stop.data.revision, mode: 'continue' }), /only debug runs it started/);
	assert.throws(() => tools.execute('studio_pause_test_debugger', { run }), /only debug runs it started/);
	tools.dispose(); assert.equal(manual.state, 'running'); assert.equal(inspection.available, true);
	const abort = new AbortController(), pending = debug.execute(Mode.Continue, abort.signal);
	abort.abort(); assert.equal((await pending).reason, 'pause'); assert.equal(inspection.available, false);
	assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
	const old = new AbortController(), superseded = debug.execute(Mode.Continue, old.signal);
	debug.pause(); debug.resume(Mode.Continue); old.abort();
	assert.equal((await superseded).reason, 'pause'); assert.equal(debug.status, 'running', 'old command cancellation cannot pause a newer manual Continue');
	await settle(service.wait(manual)); assert.equal(manual.state, 'passed');
	const own = new WorkspaceTestTools(service, f.connection.signal); t.after(() => own.dispose());
	const discovery = await own.execute('studio_list_tests', {}); assert.ok(discovery.kind === 'tests');
	const started = await own.execute('studio_debug_test', { scope: discovery.data.roots[0].modules[0].cases[0].scope }); assert.ok(started.kind === 'test-run');
	const admitted = await settle(own.execute('studio_wait_test_debugger', { run: started.data.run })); assert.ok(admitted.kind === 'test-debugger');
	const resumed = own.execute('studio_resume_test_debugger', { run: started.data.run, revision: admitted.data.revision, mode: 'continue' });
	const paused = await own.execute('studio_pause_test_debugger', { run: started.data.run }); assert.ok(paused.kind === 'test-debugger');
	assert.equal(paused.data.reason, 'pause'); assert.equal(paused.data.canContinue, true);
	assert.deepEqual((await resumed).data, paused.data);
	const active = service.results.liveRun!, borrowed = service.debugger!.inspect();
	own.dispose(); assert.equal(borrowed.available, false, 'borrow retires synchronously before cancellation cleanup');
	await settle(service.wait(active)); assert.equal(active.state, 'cancelled');
});

test('debugger admission waits settle on cancelled preparation, failed build and workspace retirement', async t => {
	const f = await fixture(t), { tools, service, settle } = f;
	const first = await tools.execute('studio_debug_test', { scope: f.scope }); assert.ok(first.kind === 'test-run');
	const waiting = tools.execute('studio_wait_test_debugger', { run: first.data.run });
	service.cancel(service.results.liveRun!);
	const cancelled = await waiting; assert.ok(cancelled.kind === 'test-run'); assert.equal(cancelled.data.state, 'cancelled');
	f.models.retain(f.sources.luaResources.find(resource => resource.path === 'testlib/fixture.lua')!, 'lua', 'end end');
	f.document.pushEditOperations([{ offset: 0, deleteLength: 0, text: "local helper<const> = require('testlib/fixture')\n" }]);
	const failed = await tools.execute('studio_debug_test', { scope: f.scope }); assert.ok(failed.kind === 'test-run');
	const finished = await settle(tools.execute('studio_wait_test_debugger', { run: failed.data.run })); assert.ok(finished.kind === 'test-run'); assert.equal(finished.data.state, 'failed');
	f.models.clear();
	const final = await tools.execute('studio_debug_test', { scope: f.scope }); assert.ok(final.kind === 'test-run');
	await settle(tools.execute('studio_wait_test_debugger', { run: final.data.run }));
	const inspection = service.debugger!.inspect(); f.models.clear();
	assert.equal(inspection.available, false); assert.equal(service.active, false); assert.equal(service.debugger, undefined);
});

test('debug tools reject malformed external identity/coordinates instead of guessing a test target', () => {
	for (const revision of [-1, 1.5, '1', true]) assert.throws(() => decodeTestToolRequest('studio_inspect_test_stop', { run: 'run', revision }));
	assert.throws(() => decodeTestToolRequest('studio_debug_test', { scope: 'case', mode: 'run' }));
	assert.throws(() => decodeTestToolRequest('studio_resume_test_debugger', { run: 'run', revision: 0, mode: 'rewind' }));
	for (const lines of [[0], [1, 1], [1.5], ['1']]) assert.throws(() => decodeTestToolRequest('studio_set_test_breakpoints', { run: 'run', source: 'source', lines }));
	assert.throws(() => decodeTestToolRequest('studio_read_test_stack', { failure: 'not-a-stack', start: 0, count: 1 }));
});
