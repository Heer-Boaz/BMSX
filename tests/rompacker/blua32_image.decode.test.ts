import assert from 'node:assert/strict';
import { test } from 'node:test';

import { writeLE32 } from '../../machine/ts/common/endian';
import { decodeBlua32Image } from '../../machine/ts/machine/cpu/blua32_image';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';

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
