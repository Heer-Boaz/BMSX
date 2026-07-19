import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { applyHeadlessDeviceQuantize } from '../../machine/ts/render/post/device_quantize/headless/pipeline';
import {
	DEVICE_QUANTIZE_BAYER_4X4,
	DEVICE_QUANTIZE_LUTS,
} from '../../machine/ts/render/post/device_quantize/lut';
import { DeviceQuantizeMode } from '../../machine/ts/render/post/device_quantize/mode';
import webglShader from '../../machine/ts/render/post/device_quantize/webgl/shaders/device_quantize.frag.glsl';
import webgpuShader from '../../machine/ts/render/post/device_quantize/webgpu/shaders/device_quantize.frag.wgsl';

function fnv1a32(bytes: Uint8Array): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < bytes.length; index += 1) {
		hash = Math.imul(hash ^ bytes[index], 0x01000193) >>> 0;
	}
	return hash;
}

test('device quantize owner retains mirrored Bayer and LUT vectors', () => {
	assert.deepEqual(Array.from(DEVICE_QUANTIZE_BAYER_4X4), [
		0, 8, 2, 10,
		12, 4, 14, 6,
		3, 11, 1, 9,
		15, 7, 13, 5,
	]);
	assert.equal(fnv1a32(DEVICE_QUANTIZE_LUTS[0].redBlue), 0xd49c27ae);
	assert.equal(fnv1a32(DEVICE_QUANTIZE_LUTS[0].green), 0xee1a990b);
	assert.equal(fnv1a32(DEVICE_QUANTIZE_LUTS[0].texture), 0x4c180e75);
	assert.equal(fnv1a32(DEVICE_QUANTIZE_LUTS[1].redBlue), 0x6fa13cc9);
	assert.equal(fnv1a32(DEVICE_QUANTIZE_LUTS[1].green), 0x63162341);
	assert.equal(fnv1a32(DEVICE_QUANTIZE_LUTS[1].texture), 0xa8287db5);
});

test('headless device quantize indexes Bayer rows from the logical top', () => {
	const pixels = new Uint8Array(4 * 4 * 4);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		pixels[offset + 0] = 127;
		pixels[offset + 1] = 127;
		pixels[offset + 2] = 127;
		pixels[offset + 3] = 0;
	}

	applyHeadlessDeviceQuantize(pixels, 4, 4, DEVICE_QUANTIZE_LUTS[DeviceQuantizeMode.Msx10Rgb343 - DeviceQuantizeMode.Rgb565]);

	const red = new Uint8Array(16);
	for (let index = 0; index < red.length; index += 1) red[index] = pixels[index * 4];
	assert.deepEqual(Array.from(red), [
		179, 119, 119, 119,
		119, 119, 119, 119,
		119, 119, 179, 119,
		119, 119, 119, 119,
	]);
	for (let offset = 3; offset < pixels.length; offset += 4) assert.equal(pixels[offset], 255);
});

test('device quantize shader source uses LUT lookup and top-down logical coordinates', () => {
	const glesShader = readFileSync('machine/cpp/render/post/device_quantize/gles2/shaders/device_quantize.frag.glsl', 'utf8');
	assert.match(webglShader, /u_resolution\.y - gl_FragCoord\.y/);
	assert.match(glesShader, /u_resolution\.y - gl_FragCoord\.y/);
	assert.match(webgpuShader, /vec2<u32>\(position\.xy\)/);
	assert.doesNotMatch(webgpuShader, /position\.y/);
	assert.doesNotMatch(webglShader, /\bpow\s*\(/);
	assert.doesNotMatch(glesShader, /\bpow\s*\(/);
	assert.doesNotMatch(webgpuShader, /\bpow\s*\(/);
});
