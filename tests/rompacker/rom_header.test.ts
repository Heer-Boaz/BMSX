import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	CARTRIDGE_BOARD_MAILBOX,
	CARTRIDGE_BOARD_RAM,
} from '../../machine/ts/spec/bmsx/cartridge';
import { CART_RAM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { parseCartHeader } from '../../machine/ts/rompack/format';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import { CART_ROM_HEADER_SIZE } from '../../machine/ts/spec/bmsx/rom_package';
import {
	resolveCartridgeHeaderWords,
	type CartManifest,
} from '../../toolchain/ts/rompack/manifest';
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
	cartridgeBoardWord: 0,
	cartridgeRamByteCount: 0,
};

test('ROM header parser rejects every truncated current header', () => {
	for (const byteLength of [32, 76, CART_ROM_HEADER_SIZE - 1]) {
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

test('ROM header carries the physical cartridge board words', () => {
	const rom = new Uint8Array(CART_ROM_HEADER_SIZE);
	writeCartRomHeader(rom, {
		...EMPTY_CART_HEADER,
		cartridgeBoardWord: CARTRIDGE_BOARD_RAM | CARTRIDGE_BOARD_MAILBOX,
		cartridgeRamByteCount: 0x00123456,
	});

	const header = parseCartHeader(rom);
	assert.equal(header.cartridgeBoardWord, CARTRIDGE_BOARD_RAM | CARTRIDGE_BOARD_MAILBOX);
	assert.equal(header.cartridgeRamByteCount, 0x00123456);
});

test('ROM header rejects cartridge RAM beyond the physical socket aperture', () => {
	const rom = new Uint8Array(CART_ROM_HEADER_SIZE);
	writeCartRomHeader(rom, {
		...EMPTY_CART_HEADER,
		cartridgeRamByteCount: CART_RAM_SIZE + 1,
	});

	assert.throws(() => parseCartHeader(rom), /socket aperture/);
});

test('manifest cartridge semantics resolve once into raw header words', () => {
	const manifest: CartManifest = {
		cartridge: {
			board: 'ram_mailbox',
			ram_bytes: 0x20000,
		},
	};

	assert.deepEqual(resolveCartridgeHeaderWords(manifest), {
		cartridgeBoardWord: CARTRIDGE_BOARD_RAM | CARTRIDGE_BOARD_MAILBOX,
		cartridgeRamByteCount: 0x20000,
	});
	manifest.cartridge = { board: 'mailbox', ram_bytes: 1 };
	assert.throws(() => resolveCartridgeHeaderWords(manifest), /RAM bytes require a RAM board/);
});
