import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import {
	decodeCartManifest,
	parseCartManifest,
} from '../../machine/ts/rompack/manifest';
import type { CartRomHeader } from '../../machine/ts/rompack/format';
import { CART_RAM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { CART_ROM_HEADER_SIZE } from '../../machine/ts/spec/bmsx/rom_package';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';

const EMPTY_HEADER: CartRomHeader = {
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

test('cartridge manifest parses concrete hardware devices in declaration order', () => {
	assert.deepEqual(parseCartManifest({
		title: 'Expansion test',
		hardware: [
			{ type: 'rom' },
			{ type: 'ram', bytes: 0x20000 },
			{ type: 'mailbox' },
		],
	}, 'manifest'), {
		title: 'Expansion test',
		hardware: [
			{ type: 'rom' },
			{ type: 'ram', bytes: 0x20000 },
			{ type: 'mailbox' },
		],
	});
});

test('cartridge manifest requires the current hardware schema', () => {
	assert.throws(
		() => parseCartManifest({ title: 'Missing hardware' }, 'manifest'),
		/manifest\.hardware.*required/,
	);
	assert.throws(
		() => parseCartManifest({
			title: 'Retired board schema',
			cartridge: { board: 'ram_mailbox', ram_bytes: 256 },
		}, 'manifest'),
		/manifest\.cartridge is not part/,
	);
});

test('cartridge manifest rejects invalid concrete device declarations', () => {
	for (const hardware of [
		[{ type: 'rom' }, { type: 'rom' }],
		[{ type: 'rom', bytes: 1 }],
		[{ type: 'ram', bytes: 0 }],
		[{ type: 'ram', bytes: CART_RAM_SIZE + 1 }],
		[{ type: 'ram', bytes: 1 }, { type: 'ram', bytes: 2 }],
		[{ type: 'mailbox' }, { type: 'mailbox' }],
		[{ type: 'mailbox', bytes: 1 }],
		[{ type: 'math' }],
	]) {
		assert.throws(() => parseCartManifest({ hardware }, 'manifest'));
	}
});

test('binary cartridge manifest is decoded through the shared package owner', () => {
	const payload = encodeBinary({
		title: 'Binary expansion',
		hardware: [
			{ type: 'rom' },
			{ type: 'mailbox' },
			{ type: 'ram', bytes: 256 },
		],
	});
	const rom = new Uint8Array(CART_ROM_HEADER_SIZE + payload.byteLength);
	rom.set(payload, CART_ROM_HEADER_SIZE);
	const header: CartRomHeader = {
		...EMPTY_HEADER,
		manifestOffset: CART_ROM_HEADER_SIZE,
		manifestLength: payload.byteLength,
	};
	writeCartRomHeader(rom, header);

	assert.deepEqual(decodeCartManifest(rom, header), {
		title: 'Binary expansion',
		hardware: [
			{ type: 'rom' },
			{ type: 'mailbox' },
			{ type: 'ram', bytes: 256 },
		],
	});
});

test('binary cartridge manifest requires the integer wire tag for RAM bytes', () => {
	const payload = encodeBinary({
		hardware: [{ type: 'ram', bytes: 256.5 }],
	});
	const floatingTagOffset = payload.lastIndexOf(10); // BinTag.F32.
	assert.notEqual(floatingTagOffset, -1);
	new DataView(
		payload.buffer,
		payload.byteOffset + floatingTagOffset + 1,
		4,
	).setFloat32(0, 256, true);
	const header: CartRomHeader = {
		...EMPTY_HEADER,
		manifestOffset: 0,
		manifestLength: payload.byteLength,
	};
	assert.throws(
		() => decodeCartManifest(payload, header),
		/floating-point values are not accepted/,
	);
});
