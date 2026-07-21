import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	IMGDEC_STREAM_MAGIC,
	IMGDEC_TOKEN_KIND_SHIFT,
	IMGDEC_TOKEN_KIND_ZERO,
} from '../../machine/ts/machine/devices/imgdec/contracts';
import { decodeImgDecStream, encodeImgDecStream } from '../../scripts/rompacker/imgdec';

test('IMGDEC word stream round-trips literal, repeat, zero, and overlapping back-reference runs', () => {
	const textureWordCount = 5000;
	const clutWordCount = 8;
	const payload = Buffer.alloc((textureWordCount + clutWordCount) << 2);
	for (let index = 0; index < 1024; index += 1) {
		payload.writeUInt32LE(Math.imul(index + 1, 0x9e3779b1) >>> 0, index << 2);
	}
	for (let index = 1024; index < 4096; index += 1) {
		payload.writeUInt32LE(payload.readUInt32LE((index - 1024) << 2), index << 2);
	}
	for (let index = 4096; index < 4600; index += 1) {
		payload.writeUInt32LE(0x55aa55aa, index << 2);
	}
	for (let index = 4600; index < textureWordCount; index += 1) {
		payload.writeUInt32LE(0, index << 2);
	}
	for (let index = 0; index < clutWordCount; index += 1) {
		payload.writeUInt32LE((0x80008000 | index) >>> 0, (textureWordCount + index) << 2);
	}

	const encoded = encodeImgDecStream(payload, textureWordCount, clutWordCount);
	const decoded = decodeImgDecStream(encoded);
	assert.equal(decoded.textureWordCount, textureWordCount);
	assert.equal(decoded.clutWordCount, clutWordCount);
	assert.equal(decoded.consumedWordCount, encoded.byteLength >> 2);
	assert.deepEqual(decoded.payload, payload);
	assert.ok(encoded.byteLength < payload.byteLength / 3);
});

test('IMGDEC tooling rejects a token that exceeds the declared payload', () => {
	const encoded = Buffer.alloc(4 << 2);
	encoded.writeUInt32LE(IMGDEC_STREAM_MAGIC, 0);
	encoded.writeUInt32LE(1, 4);
	encoded.writeUInt32LE(0, 8);
	encoded.writeUInt32LE(((IMGDEC_TOKEN_KIND_ZERO << IMGDEC_TOKEN_KIND_SHIFT) | 1) >>> 0, 12);

	assert.throws(
		() => decodeImgDecStream(encoded),
		/run exceeds its declared payload/,
	);
});

test('IMGDEC tooling rejects words after the declared payload', () => {
	const encoded = encodeImgDecStream(Buffer.from([0x78, 0x56, 0x34, 0x12]), 1, 0);
	const trailing = Buffer.alloc(encoded.byteLength + 4);
	encoded.copy(trailing);

	assert.throws(
		() => decodeImgDecStream(trailing),
		/has trailing words/,
	);
});
