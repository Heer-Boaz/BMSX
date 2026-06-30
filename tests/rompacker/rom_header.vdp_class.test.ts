import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { parseCartridgeIndex, parseCartHeader } from '../../machine/ts/rompack/loader';
import { encodeRomToc } from '../../machine/ts/rompack/tooling/toc_encode';
import { CART_ROM_HEADER_SIZE, CART_ROM_MAGIC_BYTES, CART_VDP_CLASS_PSX } from '../../machine/ts/rompack/format';
import { VDP_MODE_MSX1_WORD, VDP_MODE_PSX_WORD } from '../../machine/ts/machine/model_registry';

test('ROM header carries the psx VDP-class marker', () => {
	const rom = new Uint8Array(CART_ROM_HEADER_SIZE);
	rom.set(CART_ROM_MAGIC_BYTES, 0);
	const view = new DataView(rom.buffer);
	view.setUint32(4, CART_ROM_HEADER_SIZE, true);
	view.setUint32(72, CART_VDP_CLASS_PSX, true);

	assert.equal(parseCartHeader(rom).vdpClass, 'psx');
});

test('ROM header rejects unsupported VDP-class markers', () => {
	const rom = new Uint8Array(CART_ROM_HEADER_SIZE);
	rom.set(CART_ROM_MAGIC_BYTES, 0);
	const view = new DataView(rom.buffer);
	view.setUint32(4, CART_ROM_HEADER_SIZE, true);
	view.setUint32(72, CART_VDP_CLASS_PSX + 1, true);

	assert.throws(() => parseCartHeader(rom), /Unsupported ROM VDP class marker/);
});


function makeIndexedRom(machine: { vdp_mode: number; namespace: string; vdp_class: 'psx' }): Uint8Array {
	const manifest = encodeBinary({
		rom_name: 'test',
		machine,
		lua: { entry_path: 'cart.lua' },
	});
	const toc = encodeRomToc({ entries: [] });
	const rom = new Uint8Array(CART_ROM_HEADER_SIZE + manifest.byteLength + toc.byteLength);
	rom.set(CART_ROM_MAGIC_BYTES, 0);
	rom.set(manifest, CART_ROM_HEADER_SIZE);
	rom.set(toc, CART_ROM_HEADER_SIZE + manifest.byteLength);
	const view = new DataView(rom.buffer);
	view.setUint32(4, CART_ROM_HEADER_SIZE, true);
	view.setUint32(8, CART_ROM_HEADER_SIZE, true);
	view.setUint32(12, manifest.byteLength, true);
	view.setUint32(16, CART_ROM_HEADER_SIZE + manifest.byteLength, true);
	view.setUint32(20, toc.byteLength, true);
	view.setUint32(24, CART_ROM_HEADER_SIZE + manifest.byteLength + toc.byteLength, true);
	view.setUint32(72, CART_VDP_CLASS_PSX, true);
	return rom;
}

test('ROM manifest VDP mode derives the effective render size', async () => {
	const msx1 = await parseCartridgeIndex(makeIndexedRom({ vdp_mode: VDP_MODE_MSX1_WORD, namespace: 'msx1_cart', vdp_class: 'psx' }));
	assert.equal(msx1.machine.vdp_mode, VDP_MODE_MSX1_WORD);
	assert.deepEqual(msx1.machine.render_size, { width: 256, height: 192 });

	const psx = await parseCartridgeIndex(makeIndexedRom({ vdp_mode: VDP_MODE_PSX_WORD, namespace: 'psx_cart', vdp_class: 'psx' }));
	assert.equal(psx.machine.vdp_mode, VDP_MODE_PSX_WORD);
	assert.deepEqual(psx.machine.render_size, { width: 320, height: 240 });
});
