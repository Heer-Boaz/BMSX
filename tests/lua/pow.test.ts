import assert from 'node:assert/strict';
import { test } from 'node:test';
import { luaPow } from '../../machine/ts/spec/blua32/pow';
import { numberHighWord, numberLowWord } from '../../machine/ts/common/float64';
import { compileLuaSource, runCompletionClosure, materializeCpuCompletionValues } from './cpu_test_harness';
import { runCompiledTestSystem } from '../helpers/blua32';
import type { Closure } from '../../machine/ts/machine/cpu/closure';

test('POW follows the adopted fdlibm binary64 results', () => {
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

test('POW numeric limits and signed zero follow the BLua contract', () => {
	assert.equal(luaPow(2, -1074), Number.MIN_VALUE);
	assert.equal(luaPow(2, -1075), 0);
	assert.equal(luaPow(2, 1024), Infinity);
	assert.equal(luaPow(-0, 3), -0);
	assert.equal(luaPow(-0, -3), -Infinity);
	assert.equal(luaPow(-1, Infinity), NaN);
	assert.equal(luaPow(NaN, 0), 1);
	assert.equal(luaPow(-2, 0.5), NaN);
});

for (const optLevel of [0, 3] as const) test(`POW constant evaluation, folding and runtime agree bitwise at O${optLevel}`, () => {
	const cases = [[10, 0.05], [2, 1 / 12], [0.1, 1.1], [1.0000000000000002, 2147483649], [2, -1074], [-2, 3]];
	const source = `function dynamic_pow(x, y) return x ^ y end\nreturn ${cases.map(([x, y]) => `(${x}) ^ (${y})`).join(', ')}`;
	const cpu = runCompiledTestSystem(compileLuaSource(source, 'pow.lua', optLevel), 100000);
	const folded = materializeCpuCompletionValues(cpu) as number[];
	const fn = cpu.getGlobalByKey(cpu.stringPool.find('dynamic_pow')!) as Closure;
	for (let i = 0; i < cases.length; i++) {
		runCompletionClosure(cpu, fn, cases[i]);
		const actual = materializeCpuCompletionValues(cpu)[0] as number;
		const expected = luaPow(cases[i][0], cases[i][1]);
		assert.equal(numberHighWord(actual), numberHighWord(expected));
		assert.equal(numberLowWord(actual), numberLowWord(expected));
		assert.equal(numberHighWord(folded[i]), numberHighWord(expected));
		assert.equal(numberLowWord(folded[i]), numberLowWord(expected));
	}
});
