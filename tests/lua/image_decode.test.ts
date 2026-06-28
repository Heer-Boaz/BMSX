import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { PNG } from 'pngjs';

import { decodePngToRgba } from '../../machine/ts/common/image_decode';

function assertMatchesPngjs(relativePath: string): void {
	const bytes = readFileSync(join(process.cwd(), relativePath));
	const expected = PNG.sync.read(bytes);
	const actual = decodePngToRgba(bytes);
	assert.equal(actual.width, expected.width);
	assert.equal(actual.height, expected.height);
	assert.deepEqual(actual.pixels, new Uint8Array(expected.data.buffer, expected.data.byteOffset, expected.data.byteLength));
}

test('decodePngToRgba accepts PNG color formats used by rompacker assets', () => {
	assertMatchesPngjs('carts/nemesis_s/res/img/laser.png');
	assertMatchesPngjs('carts/pietious/res/img/enemy/vlok@cx.png');
	assertMatchesPngjs('carts/2025/res/_ignore/all_out_origineel.png');
});
