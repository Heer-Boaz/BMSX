import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCartHeader } from '../../machine/ts/rompack/format';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import { CART_ROM_HEADER_SIZE } from '../../machine/ts/spec/bmsx/rom_package';
import type { CartRomHeader } from '../../machine/ts/rompack/format';

const EMPTY_CART_HEADER: CartRomHeader = {
	headerSize: CART_ROM_HEADER_SIZE,
	manifestOffset: 0,
	manifestLength: 0,
	tocOffset: 0,
	tocLength: 0,
	dataOffset: 0,
	dataLength: 0,
	blua32ImageOffset: 0,
	blua32ImageByteCount: 0,
	blua32StartupFunctionAddress: 0,
	blua32IrqFunctionAddress: 0,
	blua32ExceptionFunctionAddress: 0,
	blua32StaticLayoutTokenLo: 0,
	blua32StaticLayoutTokenHi: 0,
	blua32DiagnosticDirectoryOffset: 0,
	metadataOffset: 0,
	metadataLength: 0,
};

test('ROM header parser rejects every truncated current header', () => {
	for (const byteLength of [0, 32, CART_ROM_HEADER_SIZE - 1]) {
		assert.throws(
			() => parseCartHeader(new Uint8Array(byteLength)),
			/too small for cart header/,
		);
	}
});

test('ROM header carries raw BLua32 image and vector words', () => {
	const rom = new Uint8Array(CART_ROM_HEADER_SIZE);
	writeCartRomHeader(rom, {
		...EMPTY_CART_HEADER,
		blua32ImageOffset: 0x100,
		blua32ImageByteCount: 0x200,
		blua32StartupFunctionAddress: 0x01000300,
		blua32IrqFunctionAddress: 0x01000320,
		blua32ExceptionFunctionAddress: 0x01000340,
		blua32StaticLayoutTokenLo: 0x11223344,
		blua32StaticLayoutTokenHi: 0x55667788,
	});
	const header = parseCartHeader(rom);
	assert.deepEqual({
		imageOffset: header.blua32ImageOffset,
		imageByteCount: header.blua32ImageByteCount,
		startupFunctionAddress: header.blua32StartupFunctionAddress,
		irqFunctionAddress: header.blua32IrqFunctionAddress,
		exceptionFunctionAddress: header.blua32ExceptionFunctionAddress,
		staticLayoutTokenLo: header.blua32StaticLayoutTokenLo,
		staticLayoutTokenHi: header.blua32StaticLayoutTokenHi,
	}, {
		imageOffset: 0x100,
		imageByteCount: 0x200,
		startupFunctionAddress: 0x01000300,
		irqFunctionAddress: 0x01000320,
		exceptionFunctionAddress: 0x01000340,
		staticLayoutTokenLo: 0x11223344,
		staticLayoutTokenHi: 0x55667788,
	});
});

test('ROM header parser rejects the retired 84-byte hardware-header format', () => {
	const rom = new Uint8Array(84);
	writeCartRomHeader(rom, {
		...EMPTY_CART_HEADER,
		headerSize: 84,
	});
	assert.throws(() => parseCartHeader(rom), /does not match the current/);
});
