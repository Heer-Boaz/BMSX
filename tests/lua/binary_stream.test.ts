import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BinaryReader, BinarySize, BinaryWriter, type BinarySink } from '../../machine/ts/common/serializer/binary_stream';

function writeFixture(sink: BinarySink): void {
	sink.bool(true); sink.bool(false);
	sink.u8(0xfe); sink.u16(0x1234); sink.i16(-2);
	sink.u32(0x89abcdef); sink.i32(-3);
	sink.u64(2 ** 40 + 9); sink.i64(-(2 ** 40 + 9));
	sink.f64(-0);
	sink.string('ö😀\0');
}

function readFixture(reader: BinaryReader): void {
	assert.equal(reader.bool(), true); assert.equal(reader.bool(), false);
	assert.equal(reader.u8(), 0xfe); assert.equal(reader.u16(), 0x1234); assert.equal(reader.i16(), -2);
	assert.equal(reader.u32(), 0x89abcdef); assert.equal(reader.i32(), -3);
	assert.equal(reader.u64(), 2 ** 40 + 9); assert.equal(reader.i64(), -(2 ** 40 + 9));
	assert.equal(reader.f64(), -0);
	assert.equal(reader.string(), 'ö😀\0');
	reader.finish();
}

test('typed streams share the native primitive byte layout and exact sizing', () => {
	const expected = Uint8Array.from([
		1, 0, 0xfe, 0x34, 0x12, 0xfe, 0xff, 0xef, 0xcd, 0xab, 0x89, 0xfd, 0xff, 0xff, 0xff,
		9, 0, 0, 0, 0, 1, 0, 0, 0xf7, 0xff, 0xff, 0xff, 0xff, 0xfe, 0xff, 0xff,
		0, 0, 0, 0, 0, 0, 0, 0x80, 7, 0, 0, 0, 0xc3, 0xb6, 0xf0, 0x9f, 0x98, 0x80, 0,
	]);
	const size = new BinarySize();
	writeFixture(size);
	assert.equal(size.length, expected.length);
	const output = new Uint8Array(size.length + 2).fill(0xa5);
	const writer = new BinaryWriter(output.subarray(1, -1));
	writeFixture(writer);
	assert.equal(writer.length, size.length);
	assert.deepEqual(output.subarray(1, -1), expected);
	assert.equal(output[0], 0xa5); assert.equal(output.at(-1), 0xa5);
	readFixture(new BinaryReader(expected));
	for (let length = 0; length < expected.length; ++length) {
		assert.throws(() => readFixture(new BinaryReader(expected.subarray(0, length))), /Truncated/);
	}
	assert.throws(() => readFixture(new BinaryReader(output.subarray(1))), /Trailing/);
});

test('bulk reads own their bytes even when the input is a Node Buffer', () => {
	const input = Buffer.from([0x78, 0x56, 0x34, 0x12, 0xff, 0xff, 0xff, 0xff]);
	assert.deepEqual(new BinaryReader(input).u32s(2), [0x12345678, 0xffffffff]);
	assert.deepEqual(new BinaryReader(input).u32Array(2), new Uint32Array([0x12345678, 0xffffffff]));
	const bytes = new BinaryReader(input).bytes(input.length);
	input.fill(0);
	assert.deepEqual(bytes, Uint8Array.from([0x78, 0x56, 0x34, 0x12, 0xff, 0xff, 0xff, 0xff]));
});

test('measuring scalar blocks never visits their elements', () => {
	const words = { length: 1_000_000, get 0(): number { throw new Error('unexpected element visit'); } };
	const size = new BinarySize();
	size.u32s(words);
	assert.equal(size.length, 4_000_000);
});

test('integer counter I/O preserves the full exact number range without BigInt conversion', () => {
	const values = [0, 1, -1, 0xffffffff, -0xffffffff, 0x100000000, -0x100000000, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER];
	const bytes = new Uint8Array(values.length * 8);
	const writer = new BinaryWriter(bytes);
	for (const value of values) writer.i64(value);
	const reader = new BinaryReader(bytes);
	for (const value of values) assert.equal(reader.i64(), value);
	reader.finish();
});
