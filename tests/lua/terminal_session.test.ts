import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { TerminalEvaluation } from '../../ide/workbench/services/terminal/session';
import { RuntimeGuestCallPlan } from '../../ide/runtime/guest_call';
import { applyRuntimeDebuggerHotResume } from '../../ide/runtime/debugger_state';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { createFrameRuntime } from '../helpers/frame_runtime';
import { decodeTerminalToolRequest } from '../../ide/workbench/services/assistant/terminal_tool_protocol';

/** Lifecycle tests use a real plan manager; actual guest evaluation is covered in browser/native conformance. */
function fixture(t: TestContext, running = true) {
	const f = createRuntimeInspectionFixture(createFrameRuntime(), createScenarioTestSourceState([]));
	const operation = new TerminalEvaluation('return 42', 'session', 1, f.terminal.transcript.next, f.execution.revision);
	f.terminal.active = operation;
	if (running) {
		operation.status = 'running';
		f.debuggerState.plans.pushControlPlan(new RuntimeGuestCallPlan(f.runtime, 0, 'completion', true, () => {}), 'workbench');
	}
	t.after(() => { f.terminal.didReplaceMachine(); f.presenter.dispose(); });
	return { ...f, operation };
}

test('a real plan pause settles tool observation, not the physical completion', async t => {
	const f = fixture(t), controller = new AbortController();
	const waiting = f.terminal.waitForStop(f.operation, controller.signal);
	f.terminal.receiveOutput('before the stop');
	f.debuggerState.plans.setControlSuspended(true);
	f.terminal.afterHostFrame();
	const result = await waiting;
	assert.equal(result.status, 'paused'); assert.equal(result.context, 'session');
	assert.equal(result.output[0].text, 'before the stop'); assert.equal(result.outputTruncated, false);
	assert.equal(f.operation.result, undefined); assert.equal(f.operation.listeners.size, 0);
	f.terminal.setPaused(f.operation, false);
	controller.abort();
	assert.equal(f.terminal.paused, false, 'settled observers detach cancellation authority');
});

test('Stop suspends admitted execution and releases its waiter without discarding frames', async t => {
	const f = fixture(t), controller = new AbortController();
	const waiting = f.terminal.waitForStop(f.operation, controller.signal);
	controller.abort(); await assert.rejects(waiting, { name: 'AbortError' });
	assert.equal(f.terminal.paused, true); assert.equal(f.operation.result, undefined);
	assert.equal(f.debuggerState.plans.mutationActive, true); assert.equal(f.operation.listeners.size, 0);
});

test('accepted Hot Resume resumes a paused physical evaluation without discarding its observer', t => {
	const f = fixture(t);
	f.terminal.setPaused(f.operation, true);
	const plan = f.debuggerState.plans.activeControlPlan;
	applyRuntimeDebuggerHotResume(f.debuggerState, f.debuggerState.breakpoints.bindings);
	assert.equal(f.debuggerState.plans.activeControlPlan, plan);
	assert.equal(f.debuggerState.plans.controlExecutionRequested, true);
	assert.equal(f.operation.result, undefined);
});

test('Stop before admission retires the call instead of leaving queued work', async t => {
	const f = fixture(t, false), controller = new AbortController();
	const waiting = f.terminal.waitForStop(f.operation, controller.signal);
	controller.abort(); await assert.rejects(waiting, { name: 'AbortError' });
	assert.equal(f.terminal.active, undefined); assert.equal(f.operation.result!.status, 'interrupted');
});

for (const intent of ['terminal-continue', 'debugger-continue'] as const) test(`late cancellation preserves newer ${intent} intent`, async t => {
	const f = fixture(t), controller = new AbortController();
	const waiting = f.terminal.waitForStop(f.operation, controller.signal);
	if (intent === 'terminal-continue') f.terminal.setPaused(f.operation, false);
	else f.execution.requestExecution(false);
	controller.abort(); await assert.rejects(waiting, { name: 'AbortError' });
	assert.equal(f.terminal.paused, false); assert.equal(f.operation.result, undefined);
});

test('machine replacement settles observers, reports bounded output loss and invalidates controls', async t => {
	const f = fixture(t), controller = new AbortController();
	const waiting = f.terminal.waitForStop(f.operation, controller.signal);
	for (let i = 0; i < 2100; i++) f.terminal.receiveOutput(String(i));
	f.terminal.didReplaceMachine();
	const result = await waiting;
	assert.equal(result.status, 'interrupted'); assert.equal(result.outputTruncated, true);
	assert.equal(result.output.length, 2048); assert.equal(f.operation.listeners.size, 0);
	assert.throws(() => f.terminal.setPaused(f.operation, false), /no longer active/);
});

test('Terminal tool boundary requires explicit supported context and exact evaluation identities', () => {
	for (const context of ['cart', 'session']) assert.deepEqual(decodeTerminalToolRequest('studio_evaluate_lua', { target: 'runtime', context, source: '1 + 2' }),
		{ name: 'studio_evaluate_lua', target: 'runtime', context, source: '1 + 2' });
	for (const context of ['frame', 'unknown', undefined]) assert.throws(() => decodeTerminalToolRequest('studio_evaluate_lua',
		{ target: 'runtime', context, source: 'x' }));
	for (const evaluation of [-1, 0, 1.5, '1']) assert.throws(() => decodeTerminalToolRequest('studio_control_lua',
		{ target: 'runtime', evaluation, action: 'continue' }));
});
