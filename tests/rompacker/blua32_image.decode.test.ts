import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readLE32, writeLE32 } from '../../machine/ts/common/endian';
import {
	BLUA32_CONSTANT_RECORD_SIZE, BLUA32_CONSTANT_PAYLOAD_OFFSET,
	BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET,
	BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_NEXT_OFFSET,
	BLUA32_STRING_RECORD_KIND, BLUA32_STRING_RECORD_ROM_FLAG, BLUA32_STRING_RECORD_HEADER_SIZE,
} from '../../machine/ts/spec/blua32/image_format';
import { decodeBlua32Image } from '../../toolchain/ts/rompack/blua32_image';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';

test('BLua32 image byte count immediately follows the signature', () => {
	const { image } = linkRawTestSystemBlua32({
		text: new Uint8Array(INSTRUCTION_BYTES),
		functions: [{ firstWord: 0, wordCount: 1 }],
	});
	assert.equal(readLE32(image.bytes, 4), image.bytes.byteLength);
});

test('BLua32 decoder rejects function text above the image text span', () => {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.RET, 0, 0, 0, 0);
	const linked = linkRawTestSystemBlua32({
		text,
		functions: [{ firstWord: 0, wordCount: 1 }],
	});
	const image = linked.image;
	const bytes = image.bytes.slice();
	const functionRecordOffset = image.header.functionTableAddress - image.address;
	writeLE32(
		bytes,
		functionRecordOffset,
		image.header.textAddress + image.header.textByteCount + INSTRUCTION_BYTES,
	);

	assert.throws(
		() => decodeBlua32Image(bytes, image.address),
		/BLua32 function text range is invalid/,
	);
});


test('ROM String records share constants with names and link collisions by address', () => {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.RET, 0, 0, 0, 0);
	const { image } = linkRawTestSystemBlua32({
		text,
		functions: [{ firstWord: 0, wordCount: 1 }],
		constants: ['a', 'i', '\0\xff', ''],
		globalNames: ['a'],
	});
	const { bytes, address, header } = image;
	const record = (index: number) => readLE32(bytes,
		header.constantTableAddress - address + index * BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_PAYLOAD_OFFSET);
	const a = record(0), i = record(1), binary = record(2) - address;
	assert.deepEqual(image.constants, ['a', 'i', '\0\xff', '']);
	assert.equal(header.stringBucketCount, 4);
	assert.equal(readLE32(bytes, header.globalNameTableAddress - address), a);
	assert.equal(a & 7, 0);
	assert.equal(readLE32(bytes, a - address), BLUA32_STRING_RECORD_KIND | BLUA32_STRING_RECORD_ROM_FLAG);
	assert.equal(readLE32(bytes, a - address + BLUA32_STRING_HASH_OFFSET), 0xe40c292c);
	assert.equal(readLE32(bytes, i - address + BLUA32_STRING_NEXT_OFFSET), a);
	assert.equal(readLE32(bytes, binary + BLUA32_STRING_LENGTH_OFFSET), 2);
	assert.deepEqual(bytes.slice(binary + BLUA32_STRING_RECORD_HEADER_SIZE, binary + BLUA32_STRING_RECORD_HEADER_SIZE + 2),
		Uint8Array.of(0, 255));
	const malformed = bytes.slice();
	writeLE32(malformed, BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET, 3);
	assert.throws(() => decodeBlua32Image(malformed, address), /String bucket table is invalid/);
	malformed.set(bytes);
	writeLE32(malformed, binary + BLUA32_STRING_LENGTH_OFFSET, 0xffff_ffff);
	assert.throws(() => decodeBlua32Image(malformed, address), /outside the executable image/);
});
