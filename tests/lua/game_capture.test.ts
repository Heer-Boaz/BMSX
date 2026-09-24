import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PNG } from 'pngjs';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import { WorkspaceRuntimeTools } from '../../ide/workbench/services/assistant/runtime_tools';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { createTestRuntime } from '../helpers/runtime_sources';
import { compileLuaSource } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext) {
	const image = linkTestSystemBlua32(compileLuaSource('return nil', 'capture', 0));
	const f = createRuntimeInspectionFixture(createTestRuntime(image.romBytes), createScenarioTestSourceState([]));
	f.runtime.machine.cpu.reset();
	t.after(() => f.presenter.dispose());
	f.inspection.pause();
	const publish = () => {
		f.runtime.machine.gxGpu.readDeviceOutput().pcrtcScanout.backgroundColor = 0x00332211;
		f.presentation.requestRestoredPresentation();
		f.presentation.presentPending(f.presenter, f.runtime, 100, 20);
	};
	return { ...f, publish };
}

test('game capture owns pre-overlay native pixels and honest publication metadata, not a held host repaint', async t => {
	const f = fixture(t), signal = new AbortController().signal;
	await assert.rejects(f.gameCapture.capture(signal), /No completed game frame/);
	assert.equal(f.tasks.ready, true, 'unavailable frame is not a host task failure');
	f.publish();
	const before = [f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()];
	const sequence = f.presenter.gameFrameSequence;
	f.presenter.setFixedRenderTargetSize(8, 6);
	const renderer = new OverlayRenderer(f.presenter.hostOverlayQueue);
	renderer.beginFrame(f.presenter); renderer.fillRect(0, 0, 8, 6, 0, 0xffffffff, LAYER_2D_IDE); renderer.endFrame();
	f.runtime.machine.gxGpu.readDeviceOutput().pcrtcScanout.backgroundColor = 0x00665544;
	f.presentation.presentPausedFrame(f.presenter, f.runtime, 120, 20);
	assert.ok(f.backend.borrowPresentedPixels().every(byte => byte === 255));
	assert.notEqual(f.presenter.presentationSequence, sequence);
	const result = await f.gameCapture.capture(signal);
	const png = PNG.sync.read(Buffer.from(result.imageUrl.split(',')[1], 'base64'));
	assert.deepEqual([png.width, png.height], [4, 3]);
	assert.deepEqual([...png.data], Array.from({ length: 12 }, () => [0x11, 0x22, 0x33, 255]).flat());
	assert.equal(result.published.presentationSequence, sequence);
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()], before);
	const owned = await f.presenter.captureGameFrame(); owned.pixels.fill(0);
	assert.notDeepEqual((await f.presenter.captureGameFrame()).pixels, owned.pixels, 'returned pixels are not a borrow of retained history');
	f.presenter.rebuildGraph();
	await assert.rejects(f.gameCapture.capture(signal), /No completed game frame/);
	assert.equal(f.tasks.ready, true);
});

test('capture admission requires pause, rejects foreign targets and never implicitly resumes', async t => {
	const f = fixture(t); f.publish();
	const lifetime = new AbortController(), tools = new WorkspaceRuntimeTools(f.inspection, f.gameCapture, lifetime.signal);
	t.after(() => tools.dispose());
	assert.throws(() => tools.execute('studio_capture_game', { target: 'another-machine' }), /not this Studio/);
	f.execution.requestExecution(true);
	assert.throws(() => tools.execute('studio_capture_game', { target: f.inspection.target }), /paused, idle/);
	f.inspection.pause();
	await tools.execute('studio_capture_game', { target: f.inspection.target });
	lifetime.abort();
	assert.equal(f.execution.userPaused, true);
	assert.throws(() => tools.execute('studio_capture_game', { target: f.inspection.target }), /disposed/);
});

test('capture holds GPU-copy admission but prompt cancellation does not poison the task queue', async t => {
	const f = fixture(t); f.publish();
	const read = f.backend.readColorTexture.bind(f.backend);
	let finish!: () => void, started!: () => void;
	const pending = new Promise<void>(resolve => { finish = resolve; });
	const entered = new Promise<void>(resolve => { started = resolve; });
	t.mock.method(f.backend, 'readColorTexture', async (...args: Parameters<typeof read>) => { started(); await pending; return read(...args); });
	const tools = new WorkspaceRuntimeTools(f.inspection, f.gameCapture, new AbortController().signal);
	const capture = Promise.resolve(tools.execute('studio_capture_game', { target: f.inspection.target }));
	assert.equal(f.tasks.ready, false);
	await entered;
	tools.dispose();
	let mutated = false;
	const mutation = f.tasks.schedule(() => { mutated = true; }, assert.fail);
	assert.equal(mutated, false, 'machine replacement waits until the GPU copy completes');
	finish();
	await assert.rejects(capture, { name: 'AbortError' });
	await mutation;
	assert.equal(f.tasks.ready, true); assert.equal(mutated, true); assert.equal(f.execution.userPaused, true);
});

test('cancellation before admission performs no readback; GPU failures remain explicit task failures', async t => {
	const f = fixture(t); f.publish();
	const backendFailure = new Error('fixture readback failure');
	const read = t.mock.method(f.backend, 'readColorTexture', async () => { throw backendFailure; });
	const cancelled = new AbortController();
	const capture = f.gameCapture.capture(cancelled.signal); cancelled.abort();
	await assert.rejects(capture, { name: 'AbortError' });
	assert.equal(read.mock.callCount(), 0); assert.equal(f.tasks.ready, true);
	await assert.rejects(f.gameCapture.capture(new AbortController().signal), backendFailure);
	assert.equal(f.tasks.ready, false, 'GPU failures are not replaced with black or an old image');
});
