import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { RuntimeGuestCallPlan } from '../../ide/runtime/guest_call';
import { ActorExecutionOperation } from '../../ide/workbench/contrib/actor_lab/execution';
import { decodeActorToolRequest } from '../../ide/workbench/services/assistant/actor_tool_protocol';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { createFrameRuntime } from '../helpers/frame_runtime';

/** Operation lifecycle against the real plan manager; World admission runs in browser conformance. */
function fixture(t: TestContext, phase: 'queued' | 'boundary' | 'invoked' = 'invoked') {
	const f = createRuntimeInspectionFixture(createFrameRuntime(), createScenarioTestSourceState([]));
	const operation = new ActorExecutionOperation(1, f.execution.revision), service = f.actorExecution;
	service.active = operation;
	if (phase !== 'queued') {
		operation.status = 'running'; operation.invoked = phase === 'invoked';
		f.debuggerState.plans.pushControlPlan(new RuntimeGuestCallPlan(f.runtime, 0, 'completion', true, () => {}), 'workbench');
	}
	t.after(() => { service.didReplaceMachine(); f.presenter.dispose(); });
	return { ...f, operation, service };
}

test('paused observation preserves the entered Actor call and detaches waiter cancellation', async t => {
	const f = fixture(t), controller = new AbortController();
	const waiting = f.service.waitForStop(f.operation, controller.signal);
	f.debuggerState.plans.setControlSuspended(true); f.service.afterHostFrame();
	assert.equal((await waiting).status, 'paused');
	assert.equal(f.operation.result, undefined); assert.equal(f.operation.listeners.size, 0);
	f.service.setPaused(f.operation, false); controller.abort();
	assert.equal(f.service.paused, false); assert.equal(f.operation.revoked, false);
});

test('a newer pre-invocation control waiter retains cancellation authority after reporting pause', async t => {
	const f = fixture(t, 'boundary'), controller = new AbortController();
	f.service.setPaused(f.operation, true);
	assert.equal((await f.service.waitForStop(f.operation, controller.signal)).status, 'paused');
	assert.equal(f.operation.listeners.size, 0);
	controller.abort();
	assert.equal(f.operation.revoked, true); assert.equal(f.service.paused, true);
	f.service.setPaused(f.operation, false);
	assert.equal(f.operation.revoked, true, 'a later Continue only drains the revoked admission');
});

for (const phase of ['queued', 'boundary', 'invoked'] as const) test(`Stop during ${phase} respects Actor admission and never discards physical plans`, async t => {
	const f = fixture(t, phase), controller = new AbortController();
	const waiting = f.service.waitForStop(f.operation, controller.signal);
	controller.abort(); await assert.rejects(waiting, { name: 'AbortError' });
	assert.equal(f.operation.listeners.size, 0);
	assert.equal(f.operation.revoked, phase !== 'invoked');
	if (phase === 'queued') {
		assert.equal(f.service.active, undefined); assert.equal(f.operation.result!.status, 'interrupted');
	} else {
		assert.equal(f.service.paused, true); assert.equal(f.operation.result, undefined);
		assert.equal(f.debuggerState.plans.mutationActive, true);
		f.service.setPaused(f.operation, false);
		assert.equal(f.operation.revoked, phase === 'boundary', 'Continue cannot revive a revoked invocation');
	}
});

for (const intent of ['actor-continue', 'debugger-continue'] as const) test(`late Actor cancellation cannot override newer ${intent}`, async t => {
	const f = fixture(t, 'boundary'), controller = new AbortController();
	const waiting = f.service.waitForStop(f.operation, controller.signal);
	if (intent === 'actor-continue') f.service.setPaused(f.operation, false);
	else f.execution.requestExecution(false);
	controller.abort(); await assert.rejects(waiting, { name: 'AbortError' });
	assert.equal(f.service.paused, false); assert.equal(f.operation.revoked, false); assert.equal(f.operation.result, undefined);
});

test('heap replacement settles Actor observers and rejects old controls without completing the guest call', async t => {
	const f = fixture(t), controller = new AbortController();
	const waiting = f.service.waitForStop(f.operation, controller.signal);
	f.service.didReplaceMachine();
	assert.equal((await waiting).status, 'interrupted'); assert.equal(f.operation.listeners.size, 0);
	assert.equal(f.service.lastResult, f.operation); assert.equal(f.service.active, undefined);
	assert.throws(() => f.service.setPaused(f.operation, false), /no longer active/);
});

test('Actor wire inputs admit only explicit operations, literal source and operation IDs', () => {
	assert.deepEqual(decodeActorToolRequest('studio_actor_action', { node: 'node', method: 'set_pos', arguments: '1, 2, 3' }),
		{ name: 'studio_actor_action', node: 'node', method: 'set_pos', arguments: '1, 2, 3' });
	for (const operation of [0, -1, 1.5, '1']) assert.throws(() => decodeActorToolRequest('studio_control_actor', { target: 'target', operation, action: 'continue' }));
	assert.throws(() => decodeActorToolRequest('studio_actor_action', { node: 'node', method: 'set_pos', arguments: [1, 2, 3] }));
	assert.throws(() => decodeActorToolRequest('studio_control_actor', { target: 'target', operation: 1, action: 'discard' }));
});
