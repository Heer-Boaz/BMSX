import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { LuaEvaluation } from '../../ide/runtime/lua_evaluation';
import { RuntimeGuestCallPlan } from '../../ide/runtime/guest_call';
import { applyRuntimeDebuggerHotResume } from '../../ide/runtime/debugger_state';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { createFrameRuntime } from '../helpers/frame_runtime';
import { decodeTerminalToolRequest } from '../../ide/workbench/services/assistant/terminal_tool_protocol';
import { RuntimeTaskKind } from '../../hosts/common/runtime_task_queue';

/** Lifecycle tests use a real plan manager; actual guest evaluation is covered in browser/native conformance. */
function fixture(t: TestContext, running = true) {
	const f = createRuntimeInspectionFixture(createFrameRuntime(), createScenarioTestSourceState([]));
	const operation = new LuaEvaluation('return 42', 'session', 1, f.execution.revision);
	f.luaEvaluation.active = operation;
	if (running) {
		operation.status = 'running';
		f.debuggerState.plans.pushControlPlan(new RuntimeGuestCallPlan(f.runtime, 0, 'completion', true, () => {}), 'workbench');
	}
	t.after(() => { f.luaEvaluation.didReplaceMachine(); f.presenter.dispose(); });
	return { ...f, operation };
}

test('a real plan pause settles tool observation, not the physical completion', async t => {
	const f = fixture(t), controller = new AbortController();
	const waiting = f.luaEvaluation.waitForStop(f.operation, controller.signal);
	f.luaEvaluation.receiveOutput('before the stop');
	f.debuggerState.plans.setControlSuspended(true);
	f.luaEvaluation.afterHostFrame();
	const result = await waiting;
	assert.equal(result.status, 'paused'); assert.equal(result.context, 'session');
	assert.equal(result.output[0], 'before the stop'); assert.equal(result.outputTruncated, false);
	assert.equal(f.operation.result, undefined); assert.equal(f.operation.listeners.size, 0);
	f.luaEvaluation.setPaused(f.operation, false);
	controller.abort();
	assert.equal(f.luaEvaluation.paused, false, 'settled observers detach cancellation authority');
});

test('Stop suspends admitted execution and releases its waiter without discarding frames', async t => {
	const f = fixture(t), controller = new AbortController();
	const waiting = f.luaEvaluation.waitForStop(f.operation, controller.signal);
	controller.abort(); await assert.rejects(waiting, { name: 'AbortError' });
	assert.equal(f.luaEvaluation.paused, true); assert.equal(f.operation.result, undefined);
	assert.equal(f.debuggerState.plans.mutationActive, true); assert.equal(f.operation.listeners.size, 0);
});

test('accepted Hot Resume resumes a paused physical evaluation without discarding its observer', t => {
	const f = fixture(t);
	f.luaEvaluation.setPaused(f.operation, true);
	const plan = f.debuggerState.plans.activeControlPlan;
	applyRuntimeDebuggerHotResume(f.debuggerState, f.debuggerState.breakpoints.bindings);
	assert.equal(f.debuggerState.plans.activeControlPlan, plan);
	assert.equal(f.debuggerState.plans.controlExecutionRequested, true);
	assert.equal(f.operation.result, undefined);
});

test('Stop before admission retires the call instead of leaving queued work', async t => {
	const f = fixture(t, false), controller = new AbortController();
	const waiting = f.luaEvaluation.waitForStop(f.operation, controller.signal);
	controller.abort(); await assert.rejects(waiting, { name: 'AbortError' });
	assert.equal(f.luaEvaluation.active, undefined); assert.equal(f.operation.result!.status, 'interrupted');
});

for (const status of ['completed', 'lua-error'] as const) test(`Terminal ${status} waits for the post-call checkpoint`, async t => {
	const f = fixture(t), hold = Promise.withResolvers<void>();
	const waiting = f.luaEvaluation.waitForStop(f.operation, new AbortController().signal);
	f.operation.outcome = { status, values: ['42'] };
	f.debuggerState.plans.didExecute();
	const checkpoint = f.tasks.schedule(() => hold.promise, assert.fail, RuntimeTaskKind.History);
	f.luaEvaluation.afterHostFrame();
	assert.equal(f.operation.result, undefined);
	assert.equal(f.luaEvaluation.active, f.operation);
	assert.equal(f.luaEvaluation.canEvaluate, false);
	hold.resolve(); await checkpoint;
	f.luaEvaluation.afterHostFrame();
	assert.equal((await waiting).status, status);
	assert.equal(f.luaEvaluation.active, undefined);
	assert.equal(f.tasks.ready, true);
});

test('cancelling the Terminal waiter after return does not discard the completed result', async t => {
	const f = fixture(t), controller = new AbortController(), hold = Promise.withResolvers<void>();
	const waiting = f.luaEvaluation.waitForStop(f.operation, controller.signal);
	f.operation.outcome = { status: 'completed', values: ['42'] };
	f.debuggerState.plans.didExecute();
	const checkpoint = f.tasks.schedule(() => hold.promise, assert.fail, RuntimeTaskKind.History);
	controller.abort(); await assert.rejects(waiting, { name: 'AbortError' });
	assert.equal(f.luaEvaluation.active, f.operation);
	hold.resolve(); await checkpoint;
	f.luaEvaluation.afterHostFrame();
	assert.deepEqual(await f.operation.completion, { status: 'completed', values: ['42'] });
});

test('failed post-call history work settles Terminal observers as host-error', async t => {
	const f = fixture(t), waiting = f.luaEvaluation.waitForStop(f.operation, new AbortController().signal);
	f.operation.outcome = { status: 'completed', values: ['42'] };
	f.debuggerState.plans.didExecute();
	await f.tasks.schedule(() => { throw new Error('capture failed'); }, () => {}, RuntimeTaskKind.History);
	f.luaEvaluation.afterHostFrame();
	assert.equal((await waiting).status, 'host-error');
	assert.equal(f.luaEvaluation.active, undefined);
});

for (const intent of ['terminal-continue', 'debugger-continue'] as const) test(`late cancellation preserves newer ${intent} intent`, async t => {
	const f = fixture(t), controller = new AbortController();
	const waiting = f.luaEvaluation.waitForStop(f.operation, controller.signal);
	if (intent === 'terminal-continue') f.luaEvaluation.setPaused(f.operation, false);
	else f.execution.requestExecution(false);
	controller.abort(); await assert.rejects(waiting, { name: 'AbortError' });
	assert.equal(f.luaEvaluation.paused, false); assert.equal(f.operation.result, undefined);
});

test('machine replacement settles observers, reports bounded output loss and invalidates controls', async t => {
	const f = fixture(t), controller = new AbortController();
	const waiting = f.luaEvaluation.waitForStop(f.operation, controller.signal);
	for (let i = 0; i < 2100; i++) f.luaEvaluation.receiveOutput(String(i));
	f.luaEvaluation.didReplaceMachine();
	const result = await waiting;
	assert.equal(result.status, 'interrupted'); assert.equal(result.outputTruncated, true);
	assert.equal(result.output.length, 2048); assert.equal(f.operation.listeners.size, 0);
	assert.throws(() => f.luaEvaluation.setPaused(f.operation, false), /no longer active/);
});

test('Terminal tool boundary requires explicit supported context and exact evaluation identities', () => {
	for (const context of ['cart', 'session']) assert.deepEqual(decodeTerminalToolRequest('studio_evaluate_lua', { target: 'runtime', context, source: '1 + 2' }),
		{ name: 'studio_evaluate_lua', target: 'runtime', context, source: '1 + 2' });
	for (const context of ['frame', 'unknown', undefined]) assert.throws(() => decodeTerminalToolRequest('studio_evaluate_lua',
		{ target: 'runtime', context, source: 'x' }));
	for (const evaluation of [-1, 0, 1.5, '1']) assert.throws(() => decodeTerminalToolRequest('studio_control_lua',
		{ target: 'runtime', evaluation, action: 'continue' }));
});
