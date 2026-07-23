import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import {
	CARTRIDGE_BOARD_MAILBOX,
	CARTRIDGE_BOARD_RAM,
} from '../../machine/ts/machine/devices/cartridge/contracts';
import { CART_RAM_SIZE } from '../../machine/ts/machine/memory/map';
import { parseCartHeader } from '../../machine/ts/rompack/format';
import { parseCartridgeIndex } from '../../machine/ts/rompack/loader';
import { writeCartRomHeader } from '../../machine/ts/rompack/tooling/header_encode';
import { encodeRomToc } from '../../machine/ts/rompack/tooling/toc_encode';
import {
	CART_ROM_HEADER_SIZE,
	CART_VDP_CLASS_PSX,
	resolveCartridgeHeaderWords,
	type CartManifest,
	type CartRomHeader,
} from '../../machine/ts/rompack/format';

const EMPTY_CART_HEADER: CartRomHeader = {
	headerSize: CART_ROM_HEADER_SIZE,
	manifestOffset: 0,
	manifestLength: 0,
	tocOffset: 0,
	tocLength: 0,
	dataOffset: 0,
	dataLength: 0,
	programBootVersion: 0,
	programBootFlags: 0,
	programEntryProtoIndex: 0,
	programCodeByteCount: 0,
	programConstPoolCount: 0,
	programProtoCount: 0,
	programReserved0: 0,
	programConstRelocCount: 0,
	metadataOffset: 0,
	metadataLength: 0,
	vdpClass: 'psx',
	cartridgeBoardWord: 0,
	cartridgeRamByteCount: 0,
};

test('ROM header carries the psx VDP-class marker', () => {
	const rom = new Uint8Array(CART_ROM_HEADER_SIZE);
	writeCartRomHeader(rom, EMPTY_CART_HEADER);

	assert.equal(parseCartHeader(rom).vdpClass, 'psx');
});

test('ROM header parser rejects every truncated current header', () => {
	for (const byteLength of [32, 76, CART_ROM_HEADER_SIZE - 1]) {
		assert.throws(
			() => parseCartHeader(new Uint8Array(byteLength)),
			/too small for cart header/,
		);
	}
});

test('ROM header rejects unsupported VDP-class markers', () => {
	const rom = new Uint8Array(CART_ROM_HEADER_SIZE);
	writeCartRomHeader(rom, EMPTY_CART_HEADER);
	new DataView(rom.buffer).setUint32(72, CART_VDP_CLASS_PSX + 1, true);

	assert.throws(() => parseCartHeader(rom), /Unsupported ROM VDP class marker/);
});

test('ROM header accepts data-only and current program images only', () => {
	const rom = new Uint8Array(CART_ROM_HEADER_SIZE);
	writeCartRomHeader(rom, EMPTY_CART_HEADER);
	assert.equal(parseCartHeader(rom).programBootVersion, 0);

	new DataView(rom.buffer).setUint32(32, 2, true);
	assert.throws(() => parseCartHeader(rom), /Unsupported ROM program boot version/);
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
		machine: { namespace: 'test', vdp_class: 'psx' },
		lua: { entry_path: 'cart.lua' },
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


function makeIndexedRom(machine: { namespace: string; vdp_class: 'psx' }): Uint8Array {
	const manifest = encodeBinary({
		rom_name: 'test',
		machine,
		lua: { entry_path: 'cart.lua' },
	});
	const toc = encodeRomToc({ entries: [] });
	const dataOffset = CART_ROM_HEADER_SIZE + manifest.byteLength + toc.byteLength;
	const rom = new Uint8Array(dataOffset);
	rom.set(manifest, CART_ROM_HEADER_SIZE);
	rom.set(toc, CART_ROM_HEADER_SIZE + manifest.byteLength);
	writeCartRomHeader(rom, {
		...EMPTY_CART_HEADER,
		manifestOffset: CART_ROM_HEADER_SIZE,
		manifestLength: manifest.byteLength,
		tocOffset: CART_ROM_HEADER_SIZE + manifest.byteLength,
		tocLength: toc.byteLength,
		dataOffset,
	});
	return rom;
}

test('ROM manifest carries only the VDP class marker', async () => {
	const cart = await parseCartridgeIndex(makeIndexedRom({ namespace: 'psx_cart', vdp_class: 'psx' }));
	assert.equal(cart.machine.namespace, 'psx_cart');
	assert.equal(cart.machine.vdp_class, 'psx');
});
