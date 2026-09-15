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
	const pixels = backend.framebufferPixels;
	const configuration = presenter.deviceQuantizeConfigurationRevision;
	presentation.requestRestoredPresentation();
	presentation.presentPending(presenter, runtime, 100, 20);
	assert.deepEqual(presenter.viewportSize, { x: 384, y: 288 });
	assert.equal(backend.framebufferPixels, pixels);
	assert.equal(presenter.deviceQuantizeConfigurationRevision, configuration, 'restore did not rebuild unchanged host targets');

	scanout.revision += 1;
	scanout.outputWidth = 320;
	scanout.outputHeight = 240;
	presentation.requestHeldPresentation();
	presentation.presentPending(presenter, runtime, 120, 20);
	assert.deepEqual(presenter.viewportSize, { x: 384, y: 288 });
	assert.equal(backend.framebufferPixels, pixels);
	assert.deepEqual(presenter.offscreenCanvasSize, { x: 320, y: 240 });
	assert.equal(presenter.deviceQuantizeConfigurationRevision, configuration + 1, 'only native geometry rebuilds the graph');
	presenter.useScanoutRenderTargetSize();
	assert.equal(presenter.deviceQuantizeConfigurationRevision, configuration + 1, 'host release retains native graph');
	assert.deepEqual(presenter.viewportSize, { x: 320, y: 240 });
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
