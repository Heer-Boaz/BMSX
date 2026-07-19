import assert from 'node:assert/strict';
import test from 'node:test';

import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { RenderPassInstanceHandle } from '../../machine/ts/render/backend/backend';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import type { GameView } from '../../machine/ts/render/gameview';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';

class LifecycleBackend extends HeadlessGPUBackend {
	readonly destroyedPipelines: RenderPassInstanceHandle[] = [];

	override destroyRenderPassInstance(pipeline: RenderPassInstanceHandle): void {
		this.destroyedPipelines.push(pipeline);
	}
}

test('render pass disposal tears down in reverse order and destroys a shared pipeline once', () => {
	const backend = new LifecycleBackend();
	const view = {
		gxGpuCommandBuffer: null,
		gxGpuReadbackPort: null,
		gxGpuPcrtcScanout: null,
		gxGpuVramSnapshotBytes: new Uint8Array(0),
		gxGpuVramSnapshotSerial: 0n,
		gxGpuVramReplacementSerial: 0n,
		gxGpuStatusWord: 0,
		gxGpuDisplayModeWord: 0,
		gxGpuDisplayStartWord: 0,
		gxGpuVramYAddressExtensionWord: 0,
	} as unknown as GameView;
	const registry = new RenderPassLibrary(backend, null as Runtime, view);
	const teardownOrder: string[] = [];

	registry.register({
		id: 'presentation_history_a',
		name: 'LifecycleOwner',
		vsCode: 'owner vertex shader',
		fsCode: 'owner fragment shader',
		teardown: () => { teardownOrder.push('owner'); },
		exec: () => { },
	});
	registry.register({
		id: 'presentation_history_b',
		name: 'LifecycleBorrower',
		sharedPipelineWith: 'presentation_history_a',
		teardown: () => { teardownOrder.push('borrower'); },
		exec: () => { },
	});

	registry.dispose();

	assert.deepEqual(teardownOrder, ['borrower', 'owner']);
	assert.equal(backend.destroyedPipelines.length, 1);
});
