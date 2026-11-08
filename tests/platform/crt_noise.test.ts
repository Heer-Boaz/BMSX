import assert from 'node:assert/strict';
import test from 'node:test';
import { fmix32 } from '../../machine/ts/common/hash';
import { crtNoiseTextureBytes, CRT_NOISE_WIDTH, CRT_NOISE_HEIGHT } from '../../machine/ts/render/post/crt/noise';

test('CRT grain has the same immutable signal-byte representation as the native renderer', () => {
	const bytes = crtNoiseTextureBytes();
	assert.strictEqual(crtNoiseTextureBytes(), bytes, 'frame rendering reuses the generated table');
	assert.equal(bytes.length, CRT_NOISE_WIDTH * CRT_NOISE_HEIGHT * 4);
	let fingerprint = 0x12345678;
	for (const value of bytes) fingerprint = fmix32(fingerprint ^ value);
	assert.equal(fingerprint, 0xa0a78f1a, 'shared TS/C++ grain corpus fingerprint');
	const values = new Set<number>();
	for (let y = 0; y < CRT_NOISE_HEIGHT; ++y) for (let x = 0; x < CRT_NOISE_WIDTH; ++x) {
		const at = (y * CRT_NOISE_WIDTH + x) * 4;
		values.add(bytes[at]);
		assert.equal(bytes[at + 1], bytes[y * CRT_NOISE_WIDTH * 4 + 1], 'line grain is shared across its row');
	}
	assert.equal(values.size, 256, 'pixel grain retains all eight bits instead of fp16 hash patterns');
});
