import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { numberHighWord, numberLowWord } from '../../machine/ts/common/float64';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { runCompiledTestSystem } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) {
	test(`BIOS radian trigonometry preserves binary64 results and IEEE edges at O${optLevel}`, () => {
		const entrySource = `local math<const> = require('math')
return math.sin, math.cos, math.tan, 1 / math.sin(-0.0), 1 / math.tan(-0.0), math.cos(-0.0)`;
		const modules = ['math', 'math/trig'].map(path => {
			const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
			return { path, source, chunk: parseLuaChunk(source, `${path}.lua`) };
		});
		const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules,
			{ entrySource, optLevel, programDomain: 'system' });
		const cpu = runCompiledTestSystem(compiled, 1_000_000);
		const completed = materializeCpuCompletionValues(cpu);
		assert.deepEqual(completed.slice(3), [-Infinity, -Infinity, 1]);
		const functions = completed.slice(0, 3) as Closure[];
		const vectors = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, 1e-300, -1e-300,
			1e-20, -1e-20, 1e-6, -1e-6, 0.5, 1, -1, Math.PI / 4, Math.PI / 2,
			Math.PI, -Math.PI, 1e6, 1647098.9, 1647099, 1647100,
			2 ** 53, 2 ** 100, 1e20, -1e20, 1e100, -1e100, Number.MAX_VALUE, -Number.MAX_VALUE];
		for (let quadrant = -20; quadrant <= 20; quadrant++) {
			for (const offset of [-1e-12, 0, 1e-12]) vectors.push(quadrant * (Math.PI / 2) + offset);
		}
		let random = 0x12345678;
		for (let i = 0; i < 128; i++) {
			random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
			vectors.push((1 + random / 4294967296) * 2 ** ((i * 37) % 1024));
		}
		for (const [index, reference] of [Math.sin, Math.cos, Math.tan].entries()) {
			for (const input of vectors) {
				runCompletionClosure(cpu, functions[index], [input]);
				const actual = materializeCpuCompletionValues(cpu)[0] as number;
				const expected = reference(input);
				const actualBits = (BigInt(numberHighWord(actual) >>> 0) << 32n) | BigInt(numberLowWord(actual));
				const expectedBits = (BigInt(numberHighWord(expected) >>> 0) << 32n) | BigInt(numberLowWord(expected));
				const distance = actualBits >= expectedBits ? actualBits - expectedBits : expectedBits - actualBits;
				assert.ok(distance <= 3n, `function ${index}(${input}): ${actual} versus ${expected}, ${distance} ULP`);
			}
			for (const input of [Infinity, -Infinity, NaN]) {
				runCompletionClosure(cpu, functions[index], [input]);
				assert.equal(materializeCpuCompletionValues(cpu)[0], NaN);
			}
		}
	});
}
