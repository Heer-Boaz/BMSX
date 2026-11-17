import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { VALUE_STORAGE_SLOT_BYTES, ValueStorage } from '../../machine/ts/machine/cpu/value_storage';

test('dense slots use one 5N-byte buffer, including odd capacities', () => {
	assert.equal(VALUE_STORAGE_SLOT_BYTES, 5);
	for (const count of [0, 1, 2, 3, 8, 127, 1024]) {
		const storage = new ValueStorage(count);
		assert.equal(storage.capacity, count);
		assert.equal(storage.byteLength, count * 5);
		assert.equal(storage.tags.buffer, storage.words.buffer);
		assert.equal(storage.floats.buffer, storage.words.buffer);
		assert.equal(storage.tags.byteOffset, count * 4);
		assert.deepEqual([...storage.words], Array(count).fill(0));
		assert.deepEqual([...storage.tags], Array(count).fill(0));
		const views = [storage.words, storage.tags, storage.floats];
		storage.resize(count);
		assert.deepEqual([storage.words, storage.tags, storage.floats], views);
		assert.equal(storage.words, views[0]);
	}
});

test('integer word bits and the Float32 view share payloads, not the tag plane', () => {
	const storage = new ValueStorage(7);
	storage.tags.fill(0xff);
	storage.words[0] = -1;
	storage.floats[1] = -0;
	storage.floats[2] = 16777217;
	storage.words[3] = 1;
	assert.equal(storage.words[0], 0xffffffff);
	assert.equal(storage.words[0] | 0, -1);
	assert.equal(storage.words[1], 0x80000000);
	assert.equal(storage.words[2], 0x4b800000);
	assert.equal(storage.floats[3], 2 ** -149);
	assert.deepEqual([...storage.tags], Array(7).fill(0xff));
});

test('growth, shrink and overlap preserve payload bits and tags without materializing values', () => {
	const words = [0, 0xffffffff, 0x80000000, 0x7fc00001, 0xffc00000, 0x7f800000, 0xff800000, 1, 0x007fffff, 0x3f800000, 0x4b800001];
	const storage = new ValueStorage(words.length);
	for (let i = 0; i < words.length; ++i) { storage.words[i] = words[i]; storage.tags[i] = (i * 29) & 0xff; }
	storage.resize(19);
	assert.deepEqual([...storage.words], [...words, ...Array(8).fill(0)]);
	assert.deepEqual([...storage.tags], [...words.map((_, i) => (i * 29) & 0xff), ...Array(8).fill(0)]);
	storage.resize(3); storage.resize(13);
	assert.deepEqual([...storage.words], [...words.slice(0, 3), ...Array(10).fill(0)]);
	assert.deepEqual([...storage.tags], [0, 29, 58, ...Array(10).fill(0)]);
	const source = new ValueStorage(13);
	for (let i = 0; i < 13; ++i) { source.words[i] = 0x7fc00000 + i; source.tags[i] = 0xff; }
	const views = [storage.words, storage.tags, storage.floats];
	for (let i = 0; i < 10000; ++i) {
		storage.copyFrom(source, 0, 0, 13); storage.copyWithin(2, 0, 11);
		storage.copyWithin(0, 2, 11); storage.clear(11, 2);
	}
	assert.equal(storage.words, views[0]); assert.equal(storage.tags, views[1]);
	assert.equal(storage.floats, views[2]);
	assert.deepEqual([...storage.words], [...Array.from({ length: 11 }, (_, i) => 0x7fc00000 + i), 0, 0]);
	assert.deepEqual([...storage.tags], [...Array(11).fill(0xff), 0, 0]);
	storage.resize(0); storage.clear(0, 0); storage.copyWithin(0, 0, 0); storage.copyFrom(source, 0, 0, 0);
	assert.equal(storage.byteLength, 0);
	storage.resize(3);
	assert.deepEqual([...storage.words], [0, 0, 0]);
	assert.deepEqual([...storage.tags], [0, 0, 0]);
});

function trace(): number[][] {
	const storage = new ValueStorage(17), source = new ValueStorage(32);
	const expectedWords = Array(32).fill(0), expectedTags = Array(32).fill(0);
	for (let i = 0; i < 32; ++i) { source.words[i] = 0x7f800001 + i; source.tags[i] = (i * 37) & 0xff; }
	let seed = 0x12345678;
	for (let iteration = 0; iteration < 4096; ++iteration) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		const count = (seed >>> 24) % 6;
		const first = (seed >>> 8) % (storage.capacity - count + 1);
		const destination = (seed >>> 16) % (storage.capacity - count + 1);
		switch (seed & 3) {
			case 0: {
				const words = expectedWords.slice(), tags = expectedTags.slice();
				storage.copyWithin(destination, first, count);
				for (let i = 0; i < count; ++i) { expectedWords[destination+i] = words[first+i]; expectedTags[destination+i] = tags[first+i]; }
				break;
			}
			case 1:
				storage.copyFrom(source, destination, first, count);
				for (let i = 0; i < count; ++i) { expectedWords[destination+i] = source.words[first+i]; expectedTags[destination+i] = source.tags[first+i]; }
				break;
			case 2:
				storage.clear(first, count);
				for (let i = 0; i < count; ++i) { expectedWords[first+i] = 0; expectedTags[first+i] = 0; }
				break;
			case 3: {
				const next = 6 + ((seed >>> 24) % 27);
				for (let i = Math.min(next, storage.capacity); i < 32; ++i) { expectedWords[i] = 0; expectedTags[i] = 0; }
				storage.resize(next); break;
			}
		}
		assert.deepEqual([...storage.words], expectedWords.slice(0, storage.capacity));
		assert.deepEqual([...storage.tags], expectedTags.slice(0, storage.capacity));
	}
	return Array.from(storage.words, (word, i) => [word, storage.tags[i]]);
}

test('4096 mixed storage operations agree with an independent slot-pair model', () => { trace(); });

const nativeRunner = process.env.BMSX_VALUE_STORAGE_RUNNER;
test('C++ and TS execute the same raw storage trace', { skip: !nativeRunner }, () => {
	const native = JSON.parse(execFileSync(nativeRunner!, ['--trace'], { encoding: 'utf8' }));
	assert.deepEqual(native, trace());
});
