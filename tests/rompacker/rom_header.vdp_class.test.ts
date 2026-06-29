import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCartHeader } from '../../machine/ts/rompack/loader';
import { CART_ROM_HEADER_SIZE, CART_ROM_MAGIC_BYTES, CART_VDP_CLASS_PSX } from '../../machine/ts/rompack/format';

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
