import assert from 'node:assert/strict';
import test from 'node:test';

import type { RenderPassInstanceHandle } from '../../machine/ts/render/backend/backend';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import { HeadlessVideoOutput } from '../../machine/ts/render/headless/video_output';

class LifecycleBackend extends HeadlessGPUBackend {
	readonly destroyedPipelines: RenderPassInstanceHandle[] = [];

	override destroyRenderPassInstance(pipeline: RenderPassInstanceHandle): void {
		this.destroyedPipelines.push(pipeline);
	}
}

test('render pass disposal tears down in reverse order and destroys a shared pipeline once', () => {
	const backend = new LifecycleBackend(new HeadlessVideoOutput({ x: 256, y: 212 }));
	const presenter = {} as VideoPresenter;
	const registry = new RenderPassLibrary(backend, presenter);
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
