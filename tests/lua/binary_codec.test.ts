import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VERSION, decodeBinary, decodeBinaryWithPropTable, encodeBinary, encodeBinaryWithPropTable } from '../../machine/ts/common/serializer/binencoder';

test('integer arrays encode as one count and an untagged zigzag stream', () => {
	assert.equal(VERSION, 0xa1);
	assert.deepEqual(encodeBinary([0, -1, 1]), Uint8Array.of(0xa1, 0, 12, 3, 0, 1, 2));
	assert.deepEqual(encodeBinary([]), Uint8Array.of(0xa1, 0, 12, 0));
	const values = [0, 1, -1, 63, -64, 64, -65, 8191, -8192, 8192, -8193,
		1048575, -1048576, 1048576, -1048577, 134217727, -134217728,
		134217728, -134217729, 0x7fffffff, -0x80000000];
	assert.deepEqual(decodeBinary(encodeBinary(values)), values);
	const names = ['values', 'tail'];
	const record = { values, tail: 77 };
	assert.deepEqual(decodeBinaryWithPropTable(encodeBinaryWithPropTable(record, names), names), record);
});

test('general arrays retain float bits, nested values and sparse members', () => {
	for (const values of [[0, -0], [1, 1.25], [NaN, Infinity, -Infinity, 1e100],
		[1, 0x80000000], [1, '雪🙂', { nested: [2, -3] }], [1, undefined, 3]]) {
		const names = ['nested'];
		const encoded = encodeBinaryWithPropTable(values, names);
		assert.equal(encoded[0], 5, 'a general array retains its per-element tags');
		assert.deepEqual(decodeBinaryWithPropTable(encoded, names), values.map(value => value === undefined ? null : value));
	}
});
