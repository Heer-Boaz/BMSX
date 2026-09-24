import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { HostPauseReason } from '../../hosts/common/execution_control';
import { RuntimeTaskKind } from '../../hosts/common/runtime_task_queue';
import { runtimeDebuggerExecutionRequested, resetRuntimeDebuggerExecution, resumeRuntimeDebugger, RuntimeDebuggerResumeMode } from '../../ide/runtime/debugger_state';
import type { SourceExecutionOperation } from '../../ide/runtime/debugger_execution';
import { RuntimeDebuggerPlanResult } from '../../ide/runtime/debugger_plans';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { recordLuaError } from '../../ide/runtime/fault_state';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { WorkspaceRuntimeTools } from '../../ide/workbench/services/assistant/runtime_tools';
import { DebuggerSourceContext } from '../../ide/workbench/services/assistant/debugger_sources';
import { decodeDebuggerToolRequest } from '../../ide/workbench/services/assistant/debugger_tool_protocol';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { blua32SourceRangeAtPc } from '../../toolchain/ts/rompack/blua32_symbols';
import { compileLuaSource } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';

const RESOURCE = { domain: -1 as const, path: 'debugger_probe.lua' };
const SOURCE = `local output = {}
local child<const> = function(value)
	output[1] = value
	output[2] = value + 1
	return output[2]
end
local parent<const> = function(value)
	output[3] = value
	local result = child(value)
	output[4] = result
	return result
end
return parent(41)`;
function fixture(t: TestContext, source = SOURCE, optLevel: 0 | 3 = 0) {
	const compiled = compileLuaSource(source, 'debugger_probe', optLevel), image = linkTestSystemBlua32(compiled);
	const runtime = createTestRuntime(image.romBytes);
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: RESOURCE.path, projectRootPath: '', can_boot_from_source: true, revision: 0 };
	registerLuaSourceRecord(registry, { resid: RESOURCE.path, type: 'lua', src: source, base_src: source,
		source_path: RESOURCE.path, normalized_source_path: RESOURCE.path, module_path: 'debugger_probe',
		update_timestamp: 0, base_update_timestamp: 0, generated: false, program_module: true });
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.systemInstalledBlua32Sources = new Map([['debugger_probe', source]]);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports), cartridgeSlots: [null, null] };
	const f = createRuntimeInspectionFixture(runtime, sources);
	const state = f.debuggerState, owner = f.debuggerExecution, cpu = runtime.machine.cpu;
	cpu.reset(); f.execution.setPauseReason(HostPauseReason.Workbench, true);
	t.after(() => { owner.dispose(); f.presenter.dispose(); });
	const execute = () => {
		owner.beforeHostFrame();
		if (runtimeDebuggerExecutionRequested(state) && !state.plans.controlSuspended) cpu.runUntilDepth(0, 100_000);
		owner.afterHostFrame();
	};
	const line = () => blua32SourceRangeAtPc(image.symbols!, image.image.header.textAddress, state.stopPc)!.start.line;
	const stopped = () => { state.breakpoints.set(RESOURCE, [8]); assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.ExecutionStopped); };
	return { ...f, state, owner, cpu, execute, stopped, line, image };
}

for (const level of [0, 3] as const) test(`O${level}: shared source operations await actual into/out/over stops and expire borrows`, async t => {
	const f = fixture(t, SOURCE, level);
	assert.equal(f.owner.canResume('into'), false);
	f.state.breakpoints.set(RESOURCE, [8]);
	let op = f.owner.resume('continue', 'workbench');
	assert.equal(op.result, undefined); assert.equal(f.inspection.canInspect, false); assert.equal(f.terminal.canEvaluate, false);
	assert.throws(() => f.owner.resume('continue', 'workbench'), /unavailable/);
	f.execute();
	assert.equal((await op.completion).reason, 'breakpoint'); assert.equal(f.line(), 8); assert.equal(f.execution.userPaused, true);
	const inspection = f.inspection.open(), frame = inspection.readStack(0, 1).frames[0];
	op = f.owner.resume('into', 'workbench');
	assert.throws(() => inspection.frameScopes(frame.reference), /expired/);
	f.execute(); await op.completion;
	if (level === 0) { assert.equal(f.line(), 9); op = f.owner.resume('into', 'workbench'); f.execute(); await op.completion; }
	assert.equal(f.line(), 3);
	const points = f.state.stepPcs[0], readPoints = t.mock.method(points, 'clear');
	op = f.owner.resume('out', 'workbench'); f.execute();
	assert.equal((await op.completion).reason, 'step'); assert.equal(f.line(), 10);
	op = f.owner.resume('over', 'workbench'); f.execute(); await op.completion;
	assert.equal(f.line(), 11); assert.equal(readPoints.mock.callCount(), 0, 'same installed image reuses step PCs');
	assert.equal(runtimeDebuggerExecutionRequested(f.state), false);
});

test('breakpoints have real bindings, deterministic persistence and shared change events, never a nearest-line fallback', t => {
	const f = fixture(t), model = f.state.breakpoints;
	let changed = 0; const detach = model.onDidChange(() => changed++);
	model.set(RESOURCE, [8, 6]);
	assert.deepEqual(model.read(RESOURCE).map(point => [point.line, point.status]), [[6, 'no-statement'], [8, 'bound']]);
	assert.ok(model.read(RESOURCE)[1].locations.length > 0);
	const bindings = model.bindings;
	model.set(RESOURCE, [6, 8]); assert.equal(model.bindings, bindings); assert.equal(changed, 1, 'same set does not rebind or autosave');
	model.set({ domain: 1, path: 'absent.lua' }, [2]);
	assert.equal(model.read({ domain: 1, path: 'absent.lua' })[0].status, 'image-unavailable');
	const saved = model.serialize(); model.restore(saved); assert.deepEqual(model.serialize(), saved);
	assert.equal(model.toggle(RESOURCE, 8), false); assert.deepEqual([...model.get(RESOURCE)], [6]);
	assert.equal(changed, 3); detach();
});

test('installed debug-source handles never read dirty source and expire with code installation', t => {
	const f = fixture(t), sources = new DebuggerSourceContext(f.state);
	f.sources.systemLuaSources.records[0].src = '-- dirty\n' + SOURCE;
	const handle = sources.list()[0].source;
	assert.equal(sources.read(handle).text, SOURCE);
	assert.equal(sources.setBreakpoints(handle, [8]).breakpoints[0].status, 'bound');
	f.sources.currentBlua32Media = { ...f.sources.currentBlua32Media, system: createBlua32SystemSourceImage(f.image.image, f.image.symbols, f.image.biosImports) };
	assert.throws(() => sources.read(handle), /expired/); assert.throws(() => sources.setBreakpoints(handle, []), /expired/);
	assert.deepEqual([...f.state.breakpoints.get(RESOURCE)], [8]);
	sources.dispose(); assert.throws(() => sources.read(handle), /does not belong/);
});

test('cancellation pauses owned continuation and a source step before its first instruction', async t => {
	for (const mode of ['continue', 'into'] as const) {
		const f = fixture(t); f.stopped();
		const before = f.cpu.readFramePc(f.cpu.getFrameDepth() - 1), abort = new AbortController();
		const op = f.owner.resume(mode, 'workbench', abort.signal); abort.abort();
		assert.equal(runtimeDebuggerExecutionRequested(f.state), false); assert.equal(f.execution.userPaused, true);
		f.execute(); assert.equal((await op.completion).reason, 'cancelled');
		assert.equal(f.cpu.readFramePc(f.cpu.getFrameDepth() - 1), before);
	}
});

test('older cancellation releases only its own source intent, not a newer manual Continue', async t => {
	const f = fixture(t); f.stopped();
	const op = f.owner.resume('into', 'workbench');
	f.execution.requestExecution(true);
	resumeRuntimeDebugger(f.state, RuntimeDebuggerResumeMode.Continue, 'game');
	const revision = f.state.executionRevision;
	f.owner.cancel(op);
	assert.equal((await op.completion).reason, 'superseded');
	assert.equal(f.state.executionRevision, revision); assert.equal(f.state.executionContext, 'game'); assert.equal(f.execution.userPaused, false);
});

test('manual pause retires an old step before the next CPU slice, without replacing the pause', async t => {
	const f = fixture(t); f.stopped();
	const pc = f.state.stopPc, op = f.owner.resume('into', 'workbench');
	f.execution.setPauseReason(HostPauseReason.Requested, true); f.execute();
	assert.equal((await op.completion).reason, 'superseded'); assert.equal(f.execution.userPaused, true);
	assert.equal(f.cpu.readFramePc(f.cpu.getFrameDepth() - 1), pc); assert.equal(runtimeDebuggerExecutionRequested(f.state), false);
});

test('a resumed guest-call plan is retained; its boundary stops source execution before gameplay', async t => {
	const f = fixture(t); f.stopped();
	let discards = 0;
	const plan = { honorUserStops: true, executionDomainMask: 0, preMaskableInterruptDomainMask: 0,
		shouldStop: () => false, willExecute() {}, didExecute: () => RuntimeDebuggerPlanResult.Complete,
		didFault: () => RuntimeDebuggerPlanResult.Complete, discard: () => { discards++; } };
	f.state.plans.pushControlPlan(plan, 'workbench'); f.state.plans.setControlSuspended(true);
	const op = f.owner.resume('out', 'workbench');
	assert.equal(f.state.plans.activeControlPlan, plan); assert.equal(discards, 0);
	f.state.plans.didExecute(); f.owner.afterHostFrame();
	assert.equal((await op.completion).reason, 'control-boundary'); assert.equal(f.execution.userPaused, true);
	assert.equal(runtimeDebuggerExecutionRequested(f.state), false); assert.equal(discards, 0);
});

test('cancelling a resumed Terminal call pauses its plan instead of discarding its stack', async t => {
	const f = fixture(t); f.stopped();
	f.state.plans.pushControlPlan({ honorUserStops: true, executionDomainMask: 0, preMaskableInterruptDomainMask: 0,
		shouldStop: () => false, willExecute() {}, didExecute: () => RuntimeDebuggerPlanResult.Active,
		didFault: () => RuntimeDebuggerPlanResult.Active, discard: () => assert.fail('never discard the call on Stop') }, 'workbench');
	f.state.plans.setControlSuspended(true);
	const op = f.owner.resume('continue', 'workbench'); f.owner.cancel(op); f.owner.afterHostFrame();
	assert.equal((await op.completion).reason, 'cancelled'); assert.equal(f.state.plans.controlSuspended, true);
});

test('a source-stop receipt waits for outstanding history work without running further instructions', async t => {
	const f = fixture(t); f.stopped();
	const hold = Promise.withResolvers<void>();
	const op = f.owner.resume('into', 'workbench');
	f.tasks.schedule(() => hold.promise, assert.fail, RuntimeTaskKind.History);
	f.execute(); assert.equal(f.state.stopped, true); assert.equal(op.result, undefined);
	assert.equal(runtimeDebuggerExecutionRequested(f.state), false);
	hold.resolve(); await f.tasks.join(); f.owner.afterHostFrame();
	assert.equal((await op.completion).reason, 'step'); assert.equal(f.inspection.canInspect, true);
});

test('fault, physical reset and target shutdown each settle pending operations honestly', async t => {
	for (const event of ['fault', 'reset', 'close'] as const) {
		const f = fixture(t), op = f.owner.resume('continue', 'workbench');
		if (event === 'fault') { recordLuaError(f.fault, f.sources, f.runtime, new Error('probe fault')); f.owner.afterHostFrame(); }
		else if (event === 'reset') { f.cpu.reset(); f.owner.didReset(); resetRuntimeDebuggerExecution(f.state); }
		else f.owner.dispose();
		const result = await op.completion;
		assert.equal(result.status, event === 'fault' ? 'stopped' : event === 'reset' ? 'replaced' : 'interrupted');
		assert.equal(runtimeDebuggerExecutionRequested(f.state), false);
	}
});

test('conversation lifecycle cancels its own execution and keeps persistent breakpoints', async t => {
	const f = fixture(t), lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.terminal, f.owner, lifetime.signal);
	const catalog = await tools.execute('studio_list_debug_sources', { target: f.inspection.target });
	const source = (catalog.data as { source: string }[])[0].source;
	await tools.execute('studio_set_breakpoints', { source, lines: [8] });
	const pending = tools.execute('studio_resume_debugger', { target: f.inspection.target, mode: 'continue' });
	lifetime.abort(); f.owner.afterHostFrame();
	assert.equal(((await pending).data as Awaited<SourceExecutionOperation['completion']>).reason, 'cancelled');
	assert.deepEqual([...f.state.breakpoints.get(RESOURCE)], [8]); assert.equal(f.execution.userPaused, true);
	assert.throws(() => decodeDebuggerToolRequest('studio_set_breakpoints', { source, lines: [1, 1] }), /distinct/);
	assert.throws(() => decodeDebuggerToolRequest('studio_resume_debugger', { target: 'x', mode: 'instruction' }), /continue\/into\/over\/out/);
});
