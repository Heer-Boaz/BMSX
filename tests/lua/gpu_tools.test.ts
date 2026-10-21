import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { WorkspaceRuntimeTools } from '../../ide/workbench/services/assistant/runtime_tools';
import { decodeGpuToolRequest, STUDIO_GPU_TOOLS } from '../../ide/workbench/services/assistant/gpu_tool_protocol';
import { STUDIO_TOOL_NAMES } from '../../ide/workbench/services/assistant/tool_catalog';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { eventHistoryRuntime } from '../helpers/event_history';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';

function fixture(t: TestContext) {
	const { images } = createCartlibProgramHarness('return true'), { runtime, sources } = eventHistoryRuntime(images);
	const f = createRuntimeInspectionFixture(runtime, sources), lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.luaEvaluation,
		f.debuggerExecution, f.actorExecution, f.boots, f.hotResumes, f.events, f.gteHistory, f.gpuHistory, lifetime.signal);
	const triangle = (color = 0x123456) => {
		runtime.machine.scheduler.setNowCycles(runtime.machine.scheduler.nowCycles + 10000);
		for (const word of [0x20000000 | color, 0x00100010, 0x00100020, 0x00200010]) runtime.machine.gxGpu.writeGp0(word);
	};
	t.after(() => { lifetime.abort(); f.gpuHistory.dispose(); f.events.dispose(); f.gteHistory.dispose(); f.presenter.dispose(); });
	return { ...f, lifetime, tools, triangle, target: f.inspection.target };
}

test('GPU tools own optional context leases and export metadata separately from exact paged words', async t => {
	const f = fixture(t), { tools, target, gpuHistory } = f;
	const cold = await tools.execute('studio_gpu_history', { target, action: 'status' });
	assert.ok('observing' in cold.data); assert.equal(cold.data.observing, false);
	assert.throws(() => tools.execute('studio_gpu_history', { target: 'foreign', action: 'start' }), /authoring target/);
	await tools.execute('studio_gpu_history', { target, action: 'start' }); const generation = gpuHistory.generation;
	await tools.execute('studio_gpu_history', { target, action: 'start' }); assert.equal(gpuHistory.generation, generation);
	const pane = gpuHistory.observe(); f.triangle();
	const request = { target, generation, sequence: gpuHistory.firstSequence };
	const cpu = f.runtime.machine.cpu.captureRuntimeState(), cycle = f.runtime.machine.scheduler.currentNowCycles();
	const metadata = await tools.execute('studio_read_gpu_operations', { ...request, count: 2 });
	assert.ok('operations' in metadata.data); assert.equal(metadata.data.operations.length, 1);
	const operation = metadata.data.operations[0];
	assert.equal(operation.wordCount, 4); assert.equal(operation.opcode, 0x20);
	assert.equal(Object.hasOwn(operation, 'words'), false); assert.equal(Object.hasOwn(operation, 'source'), false);
	assert.equal(Object.hasOwn(operation, 'checkpoint'), false); assert.equal(Object.hasOwn(operation, 'wordOffset'), false);
	const first = await tools.execute('studio_read_gpu_words', { ...request, offset: 0, count: 2 });
	assert.ok('words' in first.data); assert.deepEqual(first.data.words, [0x20123456, 0x00100010]); assert.equal(first.data.nextOffset, 2);
	const tail = await tools.execute('studio_read_gpu_words', { ...request, offset: 2, count: 20 });
	assert.ok('words' in tail.data); assert.deepEqual(tail.data.words, [0x00100020, 0x00200010]); assert.equal(tail.data.nextOffset, 4);
	const end = await tools.execute('studio_read_gpu_words', { ...request, offset: 4, count: 1 });
	assert.ok('words' in end.data); assert.deepEqual(end.data.words, []);
	assert.throws(() => tools.execute('studio_read_gpu_words', { ...request, offset: 5, count: 1 }), /beyond/);
	assert.deepEqual(f.runtime.machine.cpu.captureRuntimeState(), cpu); assert.equal(f.runtime.machine.scheduler.currentNowCycles(), cycle);
	assert.throws(() => tools.execute('studio_seek_gpu_operation', request), /retained physical recording/);
	await tools.execute('studio_gpu_history', { target, action: 'stop' }); assert.equal(gpuHistory.observing, true);
	pane.dispose(); assert.equal(gpuHistory.observing, false);
	await tools.execute('studio_gpu_history', { target, action: 'start' });
	assert.throws(() => tools.execute('studio_read_gpu_operations', { ...request, count: 1 }), /generation changed/);
	assert.deepEqual(first.data.words, [0x20123456, 0x00100010]);
	f.lifetime.abort(); assert.equal(gpuHistory.observing, false);
});

test('GPU navigation retains admitted identity when the ring changes before cancellation completes', async t => {
	const f = fixture(t), { tools, target, gpuHistory, runtime } = f;
	await tools.execute('studio_gpu_history', { target, action: 'start' });
	runtime.history.start({ checkpointCapacity: 2, inputCapacity: 8, checkpointIntervalCycles: 1000000 });
	runtime.history.captureCheckpoint(); f.triangle();
	const record = gpuHistory.at(0), sequence = record.sequence, cycles = record.cycles;
	runtime.machine.scheduler.advanceTo(runtime.machine.scheduler.nowCycles + 10000); runtime.history.recordInputBoundary(true);
	assert.equal(gpuHistory.canSeek(record), true);
	const request = { target, generation: gpuHistory.generation, sequence }, abort = new AbortController();
	const reply = tools.execute('studio_seek_gpu_operation', request, abort.signal);
	assert.deepEqual(f.frameNavigation.active!.request, { kind: 'seek', cycles });
	await tools.execute('studio_gpu_history', { target, action: 'clear' });
	abort.abort(); f.frameNavigation.afterHostFrame();
	const receipt = await reply;
	assert.ok('requestedObservationCycles' in receipt.data && 'sequence' in receipt.data && 'status' in receipt.data); assert.equal(receipt.data.sequence, sequence);
	assert.equal(receipt.data.requestedObservationCycles, cycles); assert.equal(receipt.data.status, 'interrupted');
	assert.equal(f.execution.userPaused, true); assert.equal(gpuHistory.observing, true);
	assert.throws(() => tools.execute('studio_seek_gpu_operation', request), /generation changed/);
});

test('GPU protocol admits external pages through the shared tool catalog', () => {
	for (const tool of STUDIO_GPU_TOOLS) assert.equal(STUDIO_TOOL_NAMES.has(tool.name), true);
	const request = { target: 'runtime', generation: 0, sequence: 0, offset: 0, count: 1 };
	for (const field of ['generation', 'sequence', 'offset', 'count']) for (const value of [-1, 0.5, '1', Infinity]) assert.throws(() => decodeGpuToolRequest('studio_read_gpu_words', { ...request, [field]: value }));
	assert.throws(() => decodeGpuToolRequest('studio_read_gpu_words', { ...request, count: 0 }));
	assert.throws(() => decodeGpuToolRequest('studio_gpu_history', { target: 'runtime', action: 'resume' }));
	assert.throws(() => decodeGpuToolRequest('studio_read_gpu_words', { ...request, pc: 123 }));
});
