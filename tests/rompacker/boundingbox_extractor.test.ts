import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';

import { createCanvas, loadImage } from 'canvas';

import { BoundingBoxExtractor } from '../../scripts/rompacker/boundingbox_extractor';
import { buildImgMeta } from '../../scripts/rompacker/rombuilder';
import type { ImageResource } from '../../scripts/rompacker/rompacker.rompack';

function assertIntegerPolygons(polys: number[][]): void {
	for (const poly of polys) {
		for (const value of poly) {
			assert.equal(Number.isInteger(value), true);
		}
	}
}

test('extractDetailedConvexPieces keeps opaque blocks on integer coordinates', () => {
	const canvas = createCanvas(2, 2);
	const context = canvas.getContext('2d');
	context.fillStyle = '#fff';
	context.fillRect(0, 0, 2, 2);

	const pieces = BoundingBoxExtractor.extractDetailedConvexPieces(canvas as any);
	assert.equal(pieces.length, 1);
	assert.deepEqual(pieces[0], [0, 0, 1, 0, 1, 1, 0, 1]);
});

test('@cc build path on pietious jumpslash emits no triangulation warnings', async () => {
	const filepath = join(process.cwd(), 'src/carts/pietious/res/img/pietolon/pietolon_jumpslash_r@cc.png');
	const img = await loadImage(filepath);
	const resource: ImageResource = {
		type: 'image',
		id: 1,
		name: 'pietolon_jumpslash_r',
		collisionType: 'concave',
		img: img as any,
	};
	const originalWarn = console.warn;
	const warnings: string[] = [];
	console.warn = (...args: unknown[]) => {
		warnings.push(args.map(value => String(value)).join(' '));
	};
	try {
		const imgMeta = buildImgMeta(resource);
		const polys = imgMeta.hitpolygons?.original ?? [];
		assert.ok(polys.length > 0);
		assert.ok(polys.length <= 6);
		assertIntegerPolygons(polys);
		assert.deepEqual(warnings, []);
	} finally {
		console.warn = originalWarn;
	}
});
