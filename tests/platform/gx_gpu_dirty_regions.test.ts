import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GxGpuDirtyRegions } from '../../machine/ts/render/backend/gx_gpu_dirty_regions';

type Rect = [number, number, number, number];
const record = (out: Rect[], left: number, top: number, right: number, bottom: number): void => {
	out.push([left, top, right, bottom]);
};

test('dirty cells coalesce, preserve disjoint writes and consume only requested regions', () => {
	const dirty = new GxGpuDirtyRegions();
	const copies: Rect[] = [];
	dirty.mark(0, 0, 320, 240);
	dirty.mark(640, 512, 768, 768);
	assert.equal(dirty.consume(384, 256, 512, 384, copies, record), false);
	assert.equal(dirty.consume(0, 0, 320, 240, copies, record), true);
	assert.deepEqual(copies, [[0, 0, 320, 240]]);
	copies.length = 0;
	dirty.consume(0, 0, 1024, 1024, copies, record);
	assert.deepEqual(copies, [[640, 512, 768, 768]]);
	assert.equal(dirty.consume(0, 0, 1024, 1024, copies, record), false);
});

test('partial consumption retains both sides of a split mask and later writes re-dirty cells', () => {
	const dirty = new GxGpuDirtyRegions();
	const copies: Rect[] = [];
	dirty.mark(0, 0, 1024, 1024);
	dirty.consume(511, 511, 513, 513, copies, record);
	assert.deepEqual(copies, [[496, 496, 528, 528]]);
	copies.length = 0;
	dirty.mark(512, 512, 513, 513);
	dirty.consume(511, 511, 513, 513, copies, record);
	assert.deepEqual(copies, [[512, 512, 528, 528]]);
	dirty.clear();
	assert.equal(dirty.consume(0, 0, 1024, 1024, copies, record), false);
	dirty.mark(0, 0, 1024, 1024);
	copies.length = 0;
	dirty.consume(0, 0, 1024, 1024, copies, record);
	assert.deepEqual(copies, [[0, 0, 1024, 1024]]);
});

test('spatial consumption matches independent cell ownership across word and surface boundaries', () => {
	const dirty = new GxGpuDirtyRegions();
	const expected = new Uint8Array(64 * 64);
	const copies: Rect[] = [];
	let random = 0x31b872a9;
	const next = (): number => random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
	for (let operation = 0; operation < 3000; ++operation) {
		const x0 = next() & 1023, y0 = next() & 1023;
		const x1 = Math.min(1024, x0 + 1 + (next() & 255));
		const y1 = Math.min(1024, y0 + 1 + (next() & 255));
		if ((operation % 3) !== 0) {
			dirty.mark(x0, y0, x1, y1);
			for (let y = y0 >>> 4; y < (y1 + 15) >>> 4; ++y)
				for (let x = x0 >>> 4; x < (x1 + 15) >>> 4; ++x) expected[y * 64 + x] = 1;
		} else {
			copies.length = 0;
			dirty.consume(x0, y0, x1, y1, copies, record);
			for (const [left, top, right, bottom] of copies) {
				assert.ok(left < x1 && right > x0 && top < y1 && bottom > y0);
				for (let y = top >>> 4; y < bottom >>> 4; ++y) for (let x = left >>> 4; x < right >>> 4; ++x) {
					assert.equal(expected[y * 64 + x], 1);
					expected[y * 64 + x] = 0;
				}
			}
			for (let y = y0 >>> 4; y < (y1 + 15) >>> 4; ++y)
				for (let x = x0 >>> 4; x < (x1 + 15) >>> 4; ++x) assert.equal(expected[y * 64 + x], 0);
		}
	}
});
