import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';

import { createCanvas, loadImage } from 'canvas';

import { BoundingBoxExtractor } from '../../scripts/rompacker/boundingbox_extractor';
import { buildImgMeta } from '../../scripts/rompacker/rombuilder';
import type { ImageResource } from '../../scripts/rompacker/rompacker.rompack';

test('extractDetailedConvexPieces keeps single opaque pixel non-degenerate', () => {
	const canvas = createCanvas(1, 1);
	const context = canvas.getContext('2d');
	context.fillStyle = '#fff';
	context.fillRect(0, 0, 1, 1);

	const pieces = BoundingBoxExtractor.extractDetailedConvexPieces(canvas as any);
	assert.equal(pieces.length, 1);
	assert.deepEqual(pieces[0], [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
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
		assert.ok((imgMeta.hitpolygons?.original.length ?? 0) > 0);
		assert.deepEqual(warnings, []);
	} finally {
		console.warn = originalWarn;
	}
});
