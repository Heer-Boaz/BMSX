import assert from 'node:assert/strict';
import test from 'node:test';

import { machineManager } from '../../machine/ts/core/machine_manager';
import { RenderPresentationState } from '../../runtime/presentation_state';
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
	const renderTargetChanges: Array<[number, number]> = [];
	const view = {
		gxGpuPcrtcScanoutRevision: scanout.revision,
		offscreenCanvasSize: { x: 384, y: 288 },
		setRenderTargetSize(width: number, height: number): void {
			renderTargetChanges.push([width, height]);
		},
		configurePresentation(): void {},
		drawgame(): void {},
	};
	const manager = machineManager as unknown as {
		deltatime: number;
		paused: boolean;
		view: typeof view;
		sndmaster: { finishFrame(): void };
	};
	manager.paused = false;
	manager.view = view;
	manager.sndmaster = { finishFrame(): void {} };
	const presentation = new RenderPresentationState();

	presentation.requestHeldPresentation();
	assert.equal(presentation.presentPending(runtime, 20), true);
	assert.deepEqual(renderTargetChanges, []);

	scanout.revision += 1;
	scanout.outputWidth = 320;
	scanout.outputHeight = 240;
	presentation.requestHeldPresentation();
	assert.equal(presentation.presentPending(runtime, 20), true);
	assert.deepEqual(renderTargetChanges, [[320, 240]]);
	assert.equal(view.gxGpuPcrtcScanoutRevision, scanout.revision);

	scanout.revision += 1;
	scanout.outputActive = false;
	scanout.outputWidth = 0;
	scanout.outputHeight = 0;
	presentation.requestHeldPresentation();
	assert.equal(presentation.presentPending(runtime, 20), true);
	assert.deepEqual(renderTargetChanges, [[320, 240]]);
	assert.equal(view.gxGpuPcrtcScanoutRevision, scanout.revision);
});
