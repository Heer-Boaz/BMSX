import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { scanoutGxGpuSoftwareVram } from '../../machine/ts/render/backend/software/gx_gpu_scanout';
import { LAYER_2D_IDE } from '../../machine/ts/render/shared/layers';
import { RGBA8_LINEAR_TEXTURE_PARAMS } from '../../machine/ts/render/backend/texture_params';

import { RenderPresentationState } from '../../hosts/common/presentation_state';
import {
	createTestRuntime,
	createTestRuntimeRomPayload,
} from '../helpers/runtime_sources';

test('PCRTC revision drives render-target changes', () => {
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const scanout = runtime.machine.gxGpu.readDeviceOutput().pcrtcScanout;
	scanout.revision = 7;
	scanout.outputActive = true;
	scanout.outputWidth = 256;
	scanout.outputHeight = 192;
	const { presenter, backend } = createHostOverlayFixture(384, 288);
	presenter.initialize(new RenderPassLibrary(backend, presenter));
	presenter.crt_postprocessing_enabled = false;
	const presentation = new RenderPresentationState();

	presentation.requestHeldPresentation();
	assert.equal(presentation.presentPending(presenter, runtime, 100, 20), true);
	assert.deepEqual(presenter.viewportSize, { x: 256, y: 192 });

	scanout.revision += 1;
	scanout.outputWidth = 320;
	scanout.outputHeight = 240;
	presentation.requestHeldPresentation();
	assert.equal(presentation.presentPending(presenter, runtime, 120, 20), true);
	assert.deepEqual(presenter.viewportSize, { x: 320, y: 240 });

	scanout.revision += 1;
	scanout.outputActive = false;
	scanout.outputWidth = 0;
	scanout.outputHeight = 0;
	presentation.requestHeldPresentation();
	assert.equal(presentation.presentPending(presenter, runtime, 140, 20), true);
	assert.deepEqual(presenter.viewportSize, { x: 320, y: 240 });
	presenter.dispose();
});

test('target requests retain the displayed image and coalesce allocation at presentation', t => {
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const device = runtime.machine.gxGpu.readDeviceOutput();
	device.pcrtcScanout.backgroundColor = 0x00332211;
	const { presenter, backend, output } = createHostOverlayFixture(4, 3);
	presenter.initialize(new RenderPassLibrary(backend, presenter));
	presenter.crt_postprocessing_enabled = false;
	t.after(() => presenter.dispose());
	presenter.configurePresentation('completed', true);
	presenter.present(device, 0, 0);
	const pixels = Array.from(backend.borrowPresentedPixels()), sequence = presenter.gameFrameSequence;
	const allocated = presenter.canvasSize;
	const resize = t.mock.method(backend, 'resizePresentationTarget');
	let publications = 0;
	output.geometry.onDidChange(() => publications++);
	presenter.setFixedRenderTargetSize(8, 6);
	presenter.setFixedRenderTargetSize(12, 9);
	presenter.setFixedRenderTargetSize(8, 6);
	assert.equal(resize.mock.callCount(), 0, 'size selection is not permission to clear the currently displayed image');
	assert.deepEqual(presenter.viewportSize, { x: 8, y: 6 }, 'layout can prepare the next composition');
	assert.deepEqual(allocated, { x: 4, y: 3 }, 'capture dimensions still describe the actual backing buffer');
	assert.equal(publications, 0, 'input geometry continues describing the displayed image');
	const point = { x: 0, y: 0 };
	assert.equal(presenter.mapDisplayPointToViewport(2, 1, point), true);
	assert.deepEqual(point, { x: 2, y: 1 }, 'pointer mapping uses allocated rather than requested dimensions');
	assert.deepEqual(Array.from(backend.borrowPresentedPixels()), pixels);
	presenter.configurePresentation('completed', false);
	presenter.present(device, 0, 0);
	assert.equal(resize.mock.callCount(), 1, 'only the selected size is allocated');
	assert.deepEqual(allocated, { x: 8, y: 6 });
	assert.equal(backend.borrowPresentedPixels().length, 8 * 6 * 4);
	assert.equal(publications, 1);
	assert.equal(presenter.gameFrameSequence, sequence, 'resizing a held image does not commit a game frame');
	presenter.setFixedRenderTargetSize(12, 9);
	presenter.setFixedRenderTargetSize(8, 6);
	presenter.present(device, 0, 0);
	assert.equal(resize.mock.callCount(), 1, 'a request superseded by the current size allocates nothing');
	assert.equal(publications, 1);
	presenter.useScanoutRenderTargetSize();
	assert.deepEqual(allocated, { x: 8, y: 6 }, 'leaving a host-sized surface also preserves its last frame until drawing');
	presenter.present(device, 0, 0);
	assert.deepEqual(allocated, { x: 4, y: 3 });
	assert.equal(resize.mock.callCount(), 2);
	assert.deepEqual(Array.from(backend.borrowPresentedPixels()), pixels);
});

test('a host-sized presentation survives restore and returns to the latest scanout, not its entry size', () => {
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const { presenter, backend } = createHostOverlayFixture(256, 192);
	presenter.initialize(new RenderPassLibrary(backend, presenter));
	presenter.crt_postprocessing_enabled = false;
	const presentation = new RenderPresentationState();
	const scanout = runtime.machine.gxGpu.readDeviceOutput().pcrtcScanout;
	scanout.outputActive = true;
	scanout.outputWidth = 256;
	scanout.outputHeight = 192;
	const nativeConfiguration = presenter.deviceQuantizeConfigurationRevision;
	presenter.setFixedRenderTargetSize(384, 288);
	assert.deepEqual(presenter.offscreenCanvasSize, { x: 256, y: 192 });
	assert.equal(presenter.deviceQuantizeConfigurationRevision, nativeConfiguration, 'host admission retains native graph');
	presenter.present(runtime.machine.gxGpu.readDeviceOutput(), 0, 0);
	const pixels = backend.framebufferPixels;
	const configuration = presenter.deviceQuantizeConfigurationRevision;
	presentation.requestRestoredPresentation();
	presentation.presentPending(presenter, runtime, 100, 20);
	assert.deepEqual(presenter.viewportSize, { x: 384, y: 288 });
	assert.ok(backend.framebufferPixels === pixels, 'restore retains the allocated host target');
	assert.equal(presenter.deviceQuantizeConfigurationRevision, configuration, 'restore did not rebuild unchanged host targets');

	scanout.revision += 1;
	scanout.outputWidth = 320;
	scanout.outputHeight = 240;
	presentation.requestHeldPresentation();
	presentation.presentPending(presenter, runtime, 120, 20);
	assert.deepEqual(presenter.viewportSize, { x: 384, y: 288 });
	assert.ok(backend.framebufferPixels === pixels, 'native resize retains the allocated host target');
	assert.deepEqual(presenter.offscreenCanvasSize, { x: 320, y: 240 });
	assert.equal(presenter.deviceQuantizeConfigurationRevision, configuration + 1, 'only native geometry rebuilds the graph');
	presenter.useScanoutRenderTargetSize();
	assert.equal(presenter.deviceQuantizeConfigurationRevision, configuration + 1, 'host release retains native graph');
	assert.deepEqual(presenter.viewportSize, { x: 320, y: 240 });
	assert.ok(backend.framebufferPixels === pixels, 'release retains the old image until presentation');
	presenter.present(runtime.machine.gxGpu.readDeviceOutput(), 0, 0);
	assert.equal(backend.framebufferWidth, 320);
	assert.equal(backend.framebufferHeight, 240);

	// The mode matters even when entering at exactly the current scanout size.
	presenter.setFixedRenderTargetSize(320, 240);
	presenter.setScanoutSize(256, 192);
	assert.deepEqual(presenter.viewportSize, { x: 320, y: 240 });
	presenter.setFixedRenderTargetSize(384, 288);
	presentation.reset(presenter, runtime);
	assert.deepEqual(presenter.viewportSize, { x: 384, y: 288 });
	presenter.useScanoutRenderTargetSize();
	assert.deepEqual(presenter.viewportSize, { x: 320, y: 240 }, 'reset publishes its current scanout while the host owns the target');
	presenter.dispose();
});

test('held presentation retains native pixels across host resizing and overlay composition', () => {
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const output = runtime.machine.gxGpu.readDeviceOutput();
	const scanout = output.pcrtcScanout;
	// A disabled pair of circuits displays only PCRTC background, without a cart.
	scanout.backgroundColor = 0x00332211;
	const { presenter, backend, renderer } = createHostOverlayFixture(4, 3);
	const passes = new RenderPassLibrary(backend, presenter);
	presenter.initialize(passes);
	presenter.crt_postprocessing_enabled = false;
	const committed: number[] = [];
	presenter.setGameFrameObserver({ committed(sequence) {
		assert.equal(presenter.gameFrameSequence, sequence, 'history commit precedes notification');
		committed.push(sequence);
	} });
	let presentedFrames = 0;
	let overlayExpected = false;
	backend.addPresentedFrameListener(frame => {
		presentedFrames += 1;
		assert.equal(frame.width, presenter.canvasSize.x, 'published width is the host surface, not an active offscreen target');
		assert.equal(frame.height, presenter.canvasSize.y);
		if (overlayExpected) assert.ok(backend.borrowPresentedPixels().every(byte => byte === 255), 'publication follows all host drawing');
	});
	presenter.configurePresentation('completed', true);
	presenter.present(output, 0, 0);
	const source = passes.getState('present').colorTex;
	const expected = Array.from({ length: 12 }, () => 0xff332211);
	assert.deepEqual(Array.from(backend.framebufferWords), expected);

	presenter.setFixedRenderTargetSize(8, 6);
	scanout.backgroundColor = 0x00665544;
	presenter.configurePresentation('partial', false);
	renderer.beginFrame(presenter);
	renderer.fillRect(0, 0, 8, 6, 0, 0xffffffff, LAYER_2D_IDE);
	renderer.endFrame();
	overlayExpected = true;
	presenter.present(output, 0, 0);
	overlayExpected = false;
	assert.equal(passes.getState('present').colorTex, source, 'host resize retains history texture identity');
	assert.ok(backend.framebufferWords.every(pixel => pixel === 0xffffffff), 'overlay writes host target');
	const nativePixels = new Uint8Array(4 * 3 * 4);
	backend.readTextureRegion(source, nativePixels, 4, 3, 0, 0, RGBA8_LINEAR_TEXTURE_PARAMS);
	assert.deepEqual(Array.from(new Uint32Array(nativePixels.buffer)), expected, 'overlay and partial GX output do not contaminate history');
	renderer.beginFrame(presenter);
	renderer.fillRect(0, 0, 8, 6, 0, 0xffffffff, LAYER_2D_IDE);
	renderer.pushClipRect(3, 2, 6, 4);
	renderer.drawFrame(2, 1, 6, 4);
	renderer.popClipRect();
	renderer.endFrame();
	presenter.present(output, 0, 0);
	for (let y = 0; y < 6; y += 1) for (let x = 0; x < 8; x += 1) {
		assert.equal(backend.framebufferWords[y * 8 + x], x >= 3 && x < 6 && y >= 2 && y < 4 ? 0xff332211 : 0xffffffff);
	}
	presenter.useScanoutRenderTargetSize();
	presenter.present(output, 0, 0);
	assert.deepEqual(Array.from(backend.framebufferWords), expected, 'closing the IDE re-presents the same native frame');
	presenter.configurePresentation('completed', true);
	presenter.present(output, 0, 0);
	assert.ok(backend.framebufferWords.every(pixel => pixel === 0xff665544), 'a completed frame replaces history');
	assert.equal(presentedFrames, 5, 'one publication per completed host frame');
	assert.deepEqual(committed, [1, 5], 'only new completed images notify, not partial/held repaints');
	presenter.setGameFrameObserver(null);
	presenter.present(output, 0, 0);
	assert.deepEqual(committed, [1, 5], 'detached observers receive no commits');
	presenter.dispose();
});

test('software interlace storage follows native scanout, never the host surface', () => {
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const scanout = runtime.machine.gxGpu.readDeviceOutput().pcrtcScanout;
	scanout.interlaced = true;
	const { presenter, backend } = createHostOverlayFixture(4, 3);
	presenter.initialize(new RenderPassLibrary(backend, presenter));
	const software = backend.gxGpuSoftware;
	const state = { width: 4, height: 3 };
	scanoutGxGpuSoftwareVram(software, state, scanout, 1n, new Uint32Array(12));
	const fields = software.interlacedPixels;
	presenter.setFixedRenderTargetSize(8, 6);
	assert.equal(software.interlacedPixels, fields);
	assert.equal(software.interlacedValid, true, 'host resize preserves previous field');
	state.width = 3;
	state.height = 4;
	scanoutGxGpuSoftwareVram(software, state, scanout, 1n, new Uint32Array(12));
	assert.equal(software.interlacedWidth, 3);
	assert.equal(software.interlacedHeight, 4);
	presenter.dispose();
});
