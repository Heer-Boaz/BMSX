import assert from 'node:assert/strict';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { WorkspaceRuntimeTools } from '../../ide/workbench/services/assistant/runtime_tools';
import { decodeEventToolRequest } from '../../ide/workbench/services/assistant/event_tool_protocol';
import { compileEventHistoryFixture, eventHistoryRuntime } from '../helpers/event_history';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';

test('Studio tools share automatic history with the viewer, page snapshots and reject cleared generations', async t => {
	const { cpu, runtime, sources } = eventHistoryRuntime(compileEventHistoryFixture());
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const f = createRuntimeInspectionFixture(runtime, sources), lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.terminal,
		f.debuggerExecution, f.actorExecution, f.boots, f.hotResumes, f.events, lifetime.signal);
	const events = f.events, target = f.inspection.target;
	t.after(() => { lifetime.abort(); events.dispose(); });
	assert.throws(() => tools.execute('studio_event_history', { target: 'foreign', action: 'status' }), /authoring target/);
	const started = await tools.execute('studio_event_history', { target, action: 'status' });
	assert.ok('status' in started.data);
	assert.equal(started.data.status, 'live');
	const fn = cpu.getGlobalByKey(cpu.stringPool.find('emit_for_viewer')!) as Closure;
	cpu.beginCompletionCall(fn, [3]);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, 10_000_000), RunResult.Halted);
	const request = { target, generation: events.generation, sequence: 1, count: 1 };
	const page = await tools.execute('studio_read_events', request);
	assert.ok('events' in page.data);
	assert.deepEqual(page.data.events, [events.at(1)]);
	const payload = page.data.events[0].payload;
	assert.ok(payload.kind === 'table');
	assert.deepEqual(payload.entries.find(entry => entry.key.kind === 'string' && entry.key.value === 'value')!.value, { kind: 'number', value: 2 });
	await tools.execute('studio_event_history', { target, action: 'clear' });
	assert.throws(() => tools.execute('studio_read_events', request), /cleared/);
	assert.equal(events.count, 0);
	const generation = events.generation, sequence = events.endSequence;
	cpu.beginCompletionCall(fn, [events.capacity + 1]); cpu.runUntilDepth(0, 10_000_000);
	assert.throws(() => tools.execute('studio_read_events', { target, generation, sequence, count: 1 }), /expired/);
	await tools.execute('studio_event_history', { target, action: 'status' });
	lifetime.abort();
	assert.equal(events.status, 'live', 'a prompt ending does not end the workspace history');
	assert.throws(() => tools.execute('studio_event_history', { target, action: 'status' }), /disposed/);
});

test('event tool arguments are admitted once at the model boundary', () => {
	const read = { target: 'runtime', generation: 0, sequence: 0, count: 1 };
	for (const field of ['generation', 'sequence', 'count']) {
		for (const value of [-1, 0.5, '1']) assert.throws(() => decodeEventToolRequest('studio_read_events', { ...read, [field]: value }));
	}
	assert.throws(() => decodeEventToolRequest('studio_read_events', { ...read, count: 0 }));
	assert.throws(() => decodeEventToolRequest('studio_event_history', { target: 'runtime', action: 'resume' }));
	assert.throws(() => decodeEventToolRequest('studio_event_history', { target: 'runtime', action: 'status', arbitrary: true }));
});
