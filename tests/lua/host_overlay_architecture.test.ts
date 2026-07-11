import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const BACKEND_CONSUMERS = [
	'machine/ts/render/host_overlay/headless/pipeline.ts',
	'machine/ts/render/host_overlay/webgl/pipeline.ts',
	'machine/ts/render/host_overlay/webgpu/pipeline.ts',
	'machine/cpp/render/host_overlay/pass_registration.h',
];

test('host overlay backends consume published pass state instead of the menu controller', () => {
	for (let index = 0; index < BACKEND_CONSUMERS.length; index += 1) {
		const path = BACKEND_CONSUMERS[index];
		const source = readFileSync(path, 'utf8');
		assert.equal(source.includes('core/host_overlay_menu'), false, `${path} imports the host menu controller`);
	}
	const webgpuBackend = readFileSync('machine/ts/render/backend/webgpu/backend.ts', 'utf8');
	assert.equal(webgpuBackend.includes('registerHostOverlayPassesWebGPU(registry)'), true);
});
