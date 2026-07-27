import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	packInstructionWord,
	readInstructionWord,
	writeInstructionWord,
} from '../../machine/ts/spec/blua32/instruction_format';

test('BLua32 instruction words remain unsigned raw 32-bit words', () => {
	const word = packInstructionWord(0x3f, 0x3f, 0x3f, 0x3f, 0xff);
	assert.equal(word, 0xffffffff);

	const bytes = new Uint8Array(4);
	writeInstructionWord(bytes, 0, word);
	assert.deepEqual(bytes, new Uint8Array([0xff, 0xff, 0xff, 0xff]));
	assert.equal(readInstructionWord(bytes, 0), 0xffffffff);
});
