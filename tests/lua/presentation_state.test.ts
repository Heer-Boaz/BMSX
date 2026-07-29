import assert from 'node:assert/strict';
import test from 'node:test';

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
	const presenter = {
		offscreenCanvasSize: { x: 384, y: 288 },
		setRenderTargetSize(width: number, height: number): void {
			if (this.offscreenCanvasSize.x === width && this.offscreenCanvasSize.y === height) {
				return;
			}
			this.offscreenCanvasSize.x = width;
			this.offscreenCanvasSize.y = height;
			renderTargetChanges.push([width, height]);
		},
		configurePresentation(): void {},
		present(): void {},
	};
	const presentation = new RenderPresentationState();

	presentation.requestHeldPresentation();
	assert.equal(presentation.presentPending(presenter, runtime, 100, 20), true);
	assert.deepEqual(renderTargetChanges, [[256, 192]]);

	scanout.revision += 1;
	scanout.outputWidth = 320;
	scanout.outputHeight = 240;
	presentation.requestHeldPresentation();
	assert.equal(presentation.presentPending(presenter, runtime, 120, 20), true);
	assert.deepEqual(renderTargetChanges, [[256, 192], [320, 240]]);

	scanout.revision += 1;
	scanout.outputActive = false;
	scanout.outputWidth = 0;
	scanout.outputHeight = 0;
	presentation.requestHeldPresentation();
	assert.equal(presentation.presentPending(presenter, runtime, 140, 20), true);
	assert.deepEqual(renderTargetChanges, [[256, 192], [320, 240]]);
});
