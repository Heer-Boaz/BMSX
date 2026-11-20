import assert from 'node:assert/strict';
import test from 'node:test';
import { FenwickPrefix } from '../../ide/common/fenwick';

test('indexed view geometry agrees with linear prefix/range lookup after append and resize', () => {
	const index = new FenwickPrefix(), values: number[] = [];
	for (let at = 0; at < 257; at++) { values.push(at % 7 + 1); index.push(values[at]); }
	for (let at = 0; at < values.length; at += 5) { values[at] += 3; index.set(at, values[at]); }
	let sum = 0;
	for (let at = 0; at < values.length; at++) {
		assert.equal(index.prefixSum(at), sum);
		for (let row = 0; row < values[at]; row++) assert.equal(index.indexAt(sum + row + 0.5), at);
		sum += values[at];
	}
	assert.equal(index.getTotal(), sum); assert.equal(index.indexAt(sum), values.length);
	index.reset(0); index.push(3); assert.equal(index.getTotal(), 3); assert.equal(index.indexAt(2), 0);
});
