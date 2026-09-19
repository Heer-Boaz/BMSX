import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StringMapBuilder } from '../../toolchain/ts/collections/string_map';
import { hashText } from '../../machine/ts/common/byte_hex_string';

test('persistent string lookup preserves published generations through batched mutation', () => {
	const builder = new StringMapBuilder<number>();
	const empty = builder.snapshot();
	for (let index = 0; index < 4096; index++) builder.set(`file.lua|${index}|value`, index);
	const first = builder.snapshot();
	for (let index = 0; index < 4096; index++) {
		if (index % 3 === 0) builder.delete(`file.lua|${index}|value`);
		else builder.set(`file.lua|${index}|value`, -index);
	}
	const second = builder.snapshot();
	for (let index = 0; index < 4096; index++) {
		const key = `file.lua|${index}|value`;
		assert.equal(empty.get(key), undefined);
		assert.equal(first.get(key), index);
		assert.equal(second.get(key), index % 3 === 0 ? undefined : -index);
		builder.delete(key);
	}
	const removed = builder.snapshot();
	for (let index = 0; index < 4096; index++) assert.equal(removed.get(`file.lua|${index}|value`), undefined);
	assert.equal(first.get('file.lua|4095|value'), 4095);
});

test('persistent string lookup agrees with Map across deterministic interleaved snapshots', () => {
	const builder = new StringMapBuilder<number>();
	const expected = new Map<string, number>();
	const retained: { map: ReturnType<typeof builder.snapshot>; entries: Map<string, number> }[] = [];
	let state = 713;
	for (let iteration = 0; iteration < 20000; iteration++) {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		const key = `key_${state % 1024}`;
		if (((state >>> 24) & 1) === 0) { builder.delete(key); expected.delete(key); }
		else { builder.set(key, iteration); expected.set(key, iteration); }
		assert.equal(builder.get(key), expected.get(key));
		if (iteration % 500 === 0) retained.push({ map: builder.snapshot(), entries: new Map(expected) });
	}
	for (const snapshot of retained) {
		for (let index = 0; index < 1024; index++) assert.equal(snapshot.map.get(`key_${index}`), snapshot.entries.get(`key_${index}`));
	}
});

test('complete hash collisions survive replacement, shrinking and snapshot release', () => {
	// Fixed collision in the shared UTF-16 FNV-1a hash, not a mocked hash path.
	const keys = ['9p4fsl', '1jxusol'];
	assert.equal(hashText(keys[0]), hashText(keys[1]));
	const builder = new StringMapBuilder<number>();
	builder.set(keys[0], 1);
	builder.set(keys[1], 2);
	const both = builder.snapshot();
	builder.set(keys[0], 3);
	builder.delete(keys[1]);
	builder.delete('absent');
	const one = builder.snapshot();
	assert.equal(both.get(keys[0]), 1);
	assert.equal(both.get(keys[1]), 2);
	assert.equal(one.get(keys[0]), 3);
	assert.equal(one.get(keys[1]), undefined);
	builder.delete(keys[0]);
	assert.equal(builder.snapshot().get(keys[0]), undefined);
});
