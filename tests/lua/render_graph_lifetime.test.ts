import assert from 'node:assert/strict';
import test from 'node:test';

import type { GPUBackend } from '../../machine/ts/render/backend/backend';
import { RenderGraphRuntime, type RGTexHandle } from '../../machine/ts/render/graph/graph';

test('render graph does not alias frame-persistent color resources', () => {
	const graph = new RenderGraphRuntime({} as GPUBackend);
	let source: RGTexHandle = 0;
	let history: RGTexHandle = 0;
	let transient: RGTexHandle = 0;

	graph.addPass({
		name: 'Targets',
		setup: (io) => {
			source = io.createTex({ width: 320, height: 240, name: 'FrameColor' });
			history = io.createTex({ width: 320, height: 240, name: 'FrameHistory' });
			transient = io.createTex({ width: 320, height: 240, name: 'DeviceColor', transient: true });
			io.exportToBackbuffer(history);
			return 0;
		},
		execute: () => { },
	});
	graph.addPass({
		name: 'WriteFrameColor',
		setup: (io) => {
			io.writeTex(source);
			return 0;
		},
		execute: () => { },
	});
	graph.addPass({
		name: 'ResolveDeviceColor',
		setup: (io) => {
			io.readTex(source);
			io.writeTex(transient);
			return 0;
		},
		execute: () => { },
	});
	graph.addPass({
		name: 'CommitHistory',
		setup: (io) => {
			io.readTex(transient);
			io.writeTex(history);
			return 0;
		},
		execute: () => { },
	});

	graph.compile({ frameIndex: 0, time: 0, delta: 0 });

	const resources = (graph as unknown as { texResources: Array<{ physicalId: number }> }).texResources;
	assert.notEqual(resources[source].physicalId, resources[history].physicalId);
	assert.notEqual(resources[source].physicalId, resources[transient].physicalId);
	assert.notEqual(resources[history].physicalId, resources[transient].physicalId);
});
