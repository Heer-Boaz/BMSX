import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCanvas } from 'canvas';

import { BoundingBoxExtractor } from '../../scripts/rompacker/boundingbox_extractor';

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

test('concave sample extraction respects its explicit piece budget and integer-coordinate contract', () => {
	const canvas = createCanvas(24, 24), context = canvas.getContext('2d');
	context.fillStyle = '#fff';
	context.fillRect(1, 1, 4, 20);
	context.fillRect(1, 17, 20, 4);
	context.fillRect(17, 1, 4, 20);
	const polys = BoundingBoxExtractor.extractDetailedConvexPieces(canvas as any, { maxPiecesPerComponent: 4 });
	assert.ok(polys.length > 1 && polys.length <= 4);
	assertIntegerPolygons(polys);
});
