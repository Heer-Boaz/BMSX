import assert from 'node:assert/strict';
import test from 'node:test';

import type { RenderPassStateRegistry } from '../../machine/ts/render/backend/backend';
import { writeDeviceQuantizeUniforms } from '../../machine/ts/render/post/device_quantize/webgpu/pipeline';

test('WebGPU device quantize uniforms retain vec4 alignment between source and levels', () => {
	const state = {
		sourcePixelScaleX: 0.5,
		sourcePixelScaleY: 0.25,
		sourcePixelTargetHeight: 384,
		quantizeLevels: new Float32Array([31, 63, 31]),
	} as RenderPassStateRegistry['device_quantize'];
	const uniforms = new Float32Array(8);

	writeDeviceQuantizeUniforms(uniforms, state);

	assert.deepEqual(Array.from(uniforms), [0.5, 0.25, 384, 0, 31, 63, 31, 0]);
});
