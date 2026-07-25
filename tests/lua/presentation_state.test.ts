import assert from 'node:assert/strict';
import test from 'node:test';

import { machineManager } from '../../machine/ts/core/machine_manager';
import type { GxGpuDeviceOutput } from '../../machine/ts/machine/devices/gx/device_output';
import { RenderPresentationState } from '../../ide/runtime/presentation_state';
import { runtimeWorkbenchState } from '../../ide/runtime/workbench_state';

test('PCRTC revision drives render-target changes without overwriting the IDE target', () => {
	const scanout = {
		revision: 7,
		outputActive: true,
		outputWidth: 256,
		outputHeight: 192,
	};
	const output = {
		commandBuffer: {},
		readbackPort: {},
		statusWord: 0,
		displayModeWord: 0,
		displayStartWord: 0,
		vramYAddressExtensionWord: 0,
		horizontalDisplayRangeWord: 0,
		verticalDisplayRangeWord: 0,
		pcrtcScanout: scanout,
		vramSnapshotBytes: new Uint8Array(0),
		vramSnapshotSerial: 0n,
		vramReplacementSerial: 0n,
	} as GxGpuDeviceOutput;
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
	runtimeWorkbenchState.ide = {
		overlayActive: true,
		editor: { blocksRuntimePipeline: false, isActive: false },
	} as never;
	manager.sndmaster = { finishFrame(): void {} };
	const runtime = {
		machine: {
			gxGpu: {
				readDeviceOutput: () => output,
				retirePresentedCommands(): void {},
			},
		},
	};
	const presentation = new RenderPresentationState();

	presentation.requestHeldPresentation();
	assert.equal(presentation.presentPending(runtime as never, 20), true);
	assert.deepEqual(renderTargetChanges, []);

	scanout.revision += 1;
	scanout.outputWidth = 320;
	scanout.outputHeight = 240;
	presentation.requestHeldPresentation();
	assert.equal(presentation.presentPending(runtime as never, 20), true);
	assert.deepEqual(renderTargetChanges, [[320, 240]]);
	assert.equal(view.gxGpuPcrtcScanoutRevision, scanout.revision);

	scanout.revision += 1;
	scanout.outputActive = false;
	scanout.outputWidth = 0;
	scanout.outputHeight = 0;
	presentation.requestHeldPresentation();
	assert.equal(presentation.presentPending(runtime as never, 20), true);
	assert.deepEqual(renderTargetChanges, [[320, 240]]);
	assert.equal(view.gxGpuPcrtcScanoutRevision, scanout.revision);
});
