import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRomImage } from '../../machine/ts/rompack/image';
import { decodeRomToc } from '../../machine/ts/rompack/toc';
import { decodeCartManifest } from '../../toolchain/ts/rompack/manifest';
import { buildCartridgeDeviceImage } from '../../toolchain/ts/rompack/device_image';

test('device image carries board identity without an executable domain', () => {
	const bytes = buildCartridgeDeviceImage({
		title: 'Studio expansion board',
		cartridge: {
			board: 'ram_mailbox',
			board_id: 0x53545544,
			ram_bytes: 0x00100000,
		},
	});
	const image = parseRomImage(bytes, 'cart');
	const manifest = decodeCartManifest(bytes, image.header);
	const toc = decodeRomToc(bytes.subarray(
		image.header.tocOffset,
		image.header.tocOffset + image.header.tocLength,
	));

	assert.equal(image.header.cartridgeBoardId, 0x53545544);
	assert.equal(image.header.cartridgeBoardWord, 3);
	assert.equal(image.header.cartridgeRamByteCount, 0x00100000);
	assert.equal(image.header.blua32ImageOffset, 0);
	assert.equal(manifest.title, 'Studio expansion board');
	assert.deepEqual(toc.entries, []);
});
