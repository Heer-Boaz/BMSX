import assert from 'node:assert/strict';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { WorkspaceRuntimeTools } from '../../ide/workbench/services/assistant/runtime_tools';
import { decodeEventToolRequest } from '../../ide/workbench/services/assistant/event_tool_protocol';
import { compileEventCaptureFixture, eventCaptureRuntime } from '../helpers/event_capture';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';

test('Studio tools share recording with the viewer, page snapshots and reject cleared generations', async t => {
	const { cpu, runtime, sources } = eventCaptureRuntime(compileEventCaptureFixture());
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const f = createRuntimeInspectionFixture(runtime, sources), lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.terminal,
		f.debuggerExecution, f.actorExecution, f.boots, f.hotResumes, lifetime.signal);
	const events = f.debuggerState.events, target = f.inspection.target;
	t.after(() => { lifetime.abort(); events.stop(); });
	assert.throws(() => tools.execute('studio_event_capture', { target: 'foreign', action: 'start' }), /authoring target/);
	const started = await tools.execute('studio_event_capture', { target, action: 'start' });
	assert.ok('status' in started.data);
	assert.equal(started.data.status, 'recording');
	const fn = cpu.getGlobalByKey(cpu.stringPool.find('emit_for_viewer')!) as Closure;
	cpu.beginCompletionCall(fn, [3]);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, 10_000_000), RunResult.Halted);
	const request = { target, generation: events.generation, start: 1, count: 1 };
	const page = await tools.execute('studio_read_events', request);
	assert.ok('events' in page.data);
	assert.equal(page.data.total, 3); assert.deepEqual(page.data.events, [events.records[1]]);
	assert.equal(page.data.events[0].payload.entries.find(entry => entry.key.display === '"value"')!.value.display, '2');
	const stopped = await tools.execute('studio_event_capture', { target, action: 'stop' });
	assert.ok('status' in stopped.data); assert.equal(stopped.data.status, 'stopped');
	assert.equal(events.domainMask, 0);
	await tools.execute('studio_event_capture', { target, action: 'clear' });
	assert.throws(() => tools.execute('studio_read_events', request), /cleared/);
	assert.equal(events.records.length, 0);
	await tools.execute('studio_event_capture', { target, action: 'start' });
	lifetime.abort();
	assert.equal(events.status, 'recording', 'a prompt ending does not end the workspace recording');
	assert.throws(() => tools.execute('studio_event_capture', { target, action: 'status' }), /disposed/);
});

test('event tool arguments are admitted once at the model boundary', () => {
	const read = { target: 'runtime', generation: 0, start: 0, count: 1 };
	for (const field of ['generation', 'start', 'count']) {
		for (const value of [-1, 0.5, '1']) assert.throws(() => decodeEventToolRequest('studio_read_events', { ...read, [field]: value }));
	}
	assert.throws(() => decodeEventToolRequest('studio_read_events', { ...read, count: 0 }));
	assert.throws(() => decodeEventToolRequest('studio_event_capture', { target: 'runtime', action: 'resume' }));
	assert.throws(() => decodeEventToolRequest('studio_event_capture', { target: 'runtime', action: 'start', arbitrary: true }));
});
