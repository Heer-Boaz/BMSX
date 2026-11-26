import assert from 'node:assert/strict';
import { test } from 'node:test';
import { luaPow } from '../../machine/ts/spec/blua32/pow';
import { numberHighWord, numberLowWord } from '../../machine/ts/common/float64';
import { runCompletionClosure, materializeCpuCompletionValues } from '../helpers/cpu_test_harness';
import { runCompiledTestSystem } from '../helpers/blua32';
import { asClosure, valueFloat, valueFloatBits, valueInteger, type Value } from '../../machine/ts/machine/cpu/value';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';

test('the private fdlibm kernel retains its binary64 reference results', () => {
	for (const [x, y, high, low] of [
		[10, 0.05, 0x3ff1f3c9, 0x9f6bc436],
		[2, 1 / 12, 0x3ff0f38f, 0x92d97963],
		[1.0000000000000002, 2147483649, 0x3ff00000, 0x80000201],
		[0.1, 1.1, 0x3fb455b5, 0xa30b035c],
	]) {
		const value = luaPow(x, y);
		assert.equal(numberHighWord(value) >>> 0, high);
		assert.equal(numberLowWord(value), low);
	}
});

test('the private kernel retains subnormals and the signs of special results', () => {
	assert.equal(luaPow(2, -1074), Number.MIN_VALUE);
	assert.equal(luaPow(2, -1075), 0);
	assert.equal(luaPow(2, 1024), Infinity);
	assert.equal(luaPow(-0, 3), -0);
	assert.equal(luaPow(-0, -3), -Infinity);
	assert.equal(luaPow(-1, Infinity), NaN);
	assert.equal(luaPow(NaN, 0), 1);
	assert.equal(luaPow(-2, 0.5), NaN);
});

// The constant path gets authored literals. The callable path gets tagged
// operands independently; float words check rounding, the tag and the zero sign.
const vectors: readonly (readonly [string, string, Value, Value, number])[] = [
	['10', '0.05', valueInteger(10), valueFloat(0.05), 0x3f8f9e4d],
	['2', '(1 / 12)', valueInteger(2), valueFloat(1 / 12), 0x3f879c7d],
	['0.1', '1.1', valueFloat(0.1), valueFloat(1.1), 0x3da2adad],
	['1.00000011920928955078125', '8388608', valueFloatBits(0x3f800001), valueInteger(8388608), 0x402df854],
	['-1', '16777215', valueInteger(-1), valueInteger(16777215), 0xbf800000],
	['-1', '16777217', valueInteger(-1), valueInteger(16777217), 0x3f800000],
	['-2', '-149', valueInteger(-2), valueInteger(-149), 0x80000001],
	['2', '-150', valueInteger(2), valueInteger(-150), 0],
	['2', '128', valueInteger(2), valueInteger(128), 0x7f800000],
	['-0.0', '3', valueFloatBits(0x80000000), valueInteger(3), 0x80000000],
	['-0.0', '-3', valueFloatBits(0x80000000), valueInteger(-3), 0xff800000],
	['-2', '0.5', valueInteger(-2), valueFloat(0.5), 0x7fc00000],
];

for (const optLevel of [3] as const) test(`Float POW folding and runtime match result words at O${optLevel}`, () => {
	const source = `function dynamic_pow(x, y) return x ^ y end\nreturn ${vectors.map(([x, y]) => `(${x}) ^ (${y})`).join(', ')}`;
	const cpu = runCompiledTestSystem(compileHeapServiceSystem(source, optLevel, [], 'pow.lua'), 100000);
	const folded = materializeCpuCompletionValues(cpu);
	const fn = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('dynamic_pow')!), cpu.gc);
	for (let i = 0; i < vectors.length; ++i) {
		const [x, y, left, right, word] = vectors[i];
		runCompletionClosure(cpu, fn, [left, right]);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueFloatBits(word)], `dynamic: (${x}) ^ (${y})`);
		assert.equal(folded[i], valueFloatBits(word), `constant: (${x}) ^ (${y})`);
	}
});
