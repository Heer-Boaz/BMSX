import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { createHostOverlayFixture } from '../helpers/host_overlay';

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
	presenter.setFixedRenderTargetSize(384, 288);
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
	assert.equal(presenter.deviceQuantizeConfigurationRevision, configuration);
	presenter.useScanoutRenderTargetSize();
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
