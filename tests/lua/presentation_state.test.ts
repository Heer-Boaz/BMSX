import assert from 'node:assert/strict';
import test from 'node:test';

import { machineManager } from '../../machine/ts/core/machine_manager';
import { RenderPresentationState } from '../../runtime/presentation_state';
import { RuntimeIdeState } from '../../ide/runtime/state';
import type { LuaSourceRegistry } from '../../machine/ts/lua/source_registry';
import {
	createTestRuntime,
	createTestRuntimeRomPayload,
	createTestRuntimeSourceState,
} from '../helpers/runtime_sources';
import { SYSTEM_RESOURCE_DOMAIN } from '../../ide/common/resource';

test('PCRTC revision drives render-target changes without overwriting the IDE target', () => {
	const systemLuaSources: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entry_path: '',
		namespace: 'test',
		projectRootPath: '',
		can_boot_from_source: false,
		revision: 0,
	};
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const ide = new RuntimeIdeState(
		runtime,
		{ width: 384, height: 288 },
		createTestRuntimeSourceState(systemLuaSources, [null, null], SYSTEM_RESOURCE_DOMAIN),
	);
	ide.overlayRenderer.active = true;
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
	const presentation = new RenderPresentationState(ide);

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
