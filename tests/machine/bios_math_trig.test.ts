import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { f32BitsToNumber, numberToF32Bits } from '../../machine/ts/common/float32';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import * as v from '../../machine/ts/machine/cpu/value';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { TRIG32_INPUT_WORDS, TRIG32_ROM_SOURCE } from '../helpers/trig32';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure, runGuestToHalt } from '../helpers/cpu_test_harness';

const modules = ['math', 'math/trig', 'math/trig/reduce'].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, `${path}.lua`) };
});
const bootSource = 'return { pcall = __bmsx_pcall, error = __bmsx_error }';
modules.push({ path: 'test/boot', source: bootSource, chunk: parseLuaChunk(bootSource, 'test/boot.lua') });

for (const optLevel of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`BIOS binary32 trigonometry O${optLevel} ${backend}: edge magnitudes, quadrant cancellation and IEEE edges`, t => {
		const entrySource = `local math<const> = require('math')
local boot<const> = require('test/boot')
trig_roots = { math.sin, math.cos, math.tan, function(fn, value) return boot.pcall(fn, value) end }
return trig_roots[1], trig_roots[2], trig_roots[3], trig_roots[4]`;
		const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules,
			{ entrySource, optLevel, programDomain: 'system' });
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compiled), backend);
		runGuestToHalt(cpu, 100000);
		const completed = materializeCpuCompletionValues(cpu);
		const functions = completed.slice(0, 3).map(value => v.asClosure(value, cpu.gc));
		const protectedCall = v.asClosure(completed[3], cpu.gc);
		const maximum = [0, 0, 0];
		for (const [index, reference] of [Math.sin, Math.cos, Math.tan].entries()) {
			for (const word of TRIG32_INPUT_WORDS) {
				const input = f32BitsToNumber(word);
				try { runCompletionClosure(cpu, functions[index], [v.valueFloatBits(word)]); }
				catch (cause) { throw new Error(`function ${index}(0x${word.toString(16)}) failed`, { cause }); }
				const actual = materializeCpuCompletionValues(cpu)[0];
				assert.equal(v.valueTag(actual), v.ValueTag.Float);
				const expected = numberToF32Bits(reference(input));
				const distance = Math.abs(v.valuePayload(actual) - expected);
				assert.ok(distance <= 3, `function ${index}(0x${word.toString(16)}): 0x${v.valuePayload(actual).toString(16)} versus 0x${expected.toString(16)}, ${distance} ULP`);
				maximum[index] = Math.max(maximum[index], distance);
			}
			for (const word of [0x7f800000, 0xff800000, 0x7fc00000, 0xffc12345, 0x7fa12345]) {
				try { runCompletionClosure(cpu, functions[index], [v.valueFloatBits(word)]); }
				catch (cause) { throw new Error(`function ${index}(0x${word.toString(16)}) failed`, { cause }); }
				assert.deepEqual(materializeCpuCompletionValues(cpu), [v.valueFloatBits(0x7fc00000)]);
			}
			for (const integer of [0, 1, -1, 16777217, -2147483648, 2147483647]) {
				runCompletionClosure(cpu, functions[index], [v.valueInteger(integer)]);
				const actual = materializeCpuCompletionValues(cpu)[0];
				assert.equal(v.valueTag(actual), v.ValueTag.Float);
				const expected = numberToF32Bits(reference(Math.fround(integer)));
				assert.ok(Math.abs(v.valuePayload(actual) - expected) <= 3);
			}
			for (const value of [v.valueNil(), v.valueBool(false), v.valueString(cpu.stringPool.intern('2'))]) {
				runCompletionClosure(cpu, protectedCall, [completed[index], value]);
				assert.equal(materializeCpuCompletionValues(cpu)[0], v.valueBool(false));
			}
		}
		for (const fn of functions) runCompletionClosure(cpu, fn, [v.valueFloat(200)]);
		const reserve = t.mock.method(cpu.luaHeap, 'admit');
		for (let repeat = 0; repeat < 32; ++repeat) for (const fn of functions) {
			for (const value of [0.125, -0.125, 200, -200]) runCompletionClosure(cpu, fn, [v.valueFloat(value)]);
		}
		assert.equal(reserve.mock.callCount(), 0, 'small and medium angles allocate no guest storage after warmup');
		console.log(JSON.stringify({ optLevel, backend, finiteInputs: TRIG32_INPUT_WORDS.length, maximumUlp: maximum }));
	});
}

for (const optLevel of [3] as const) test(`BIOS trig O${optLevel}: physical ROM checks every reference and native raw results/cycles`, () => {
	const program = compileTestSystemWithHeap(parseLuaChunk(TRIG32_ROM_SOURCE, 'trig32-rom.lua'), modules,
		{ entrySource: TRIG32_ROM_SOURCE, optLevel, programDomain: 'system' });
	const image = linkTestSystemBlua32(program), { cpu } = createTestSystemCpu(image);
	const budget = 100_000_000;
	runGuestToHalt(cpu, budget);
	const results = materializeCpuCompletionValues(cpu);
	assert.equal(results.length, 12);
	assert.deepEqual(results.slice(3, 6), [v.valueFloatBits(0x80000000), v.valueFloat(1), v.valueFloatBits(0x80000000)]);
	assert.deepEqual(results.slice(9), [v.valueFloatBits(0x7fc00000), v.valueFloatBits(0x7fc00000), v.valueFloatBits(0x7fc00000)]);
	if (process.env.BMSX_CPU32_RUNNER) {
		const expected = [`budget ${cpu.instructionBudgetRemaining} fault 0`, ...results.map(value =>
			`${v.valueTag(value).toString(16)} ${v.valuePayload(value).toString(16)}`)].join('\n') + '\n';
		assert.equal(execFileSync(process.env.BMSX_CPU32_RUNNER,
			['--execute-rom', String(budget)], { input: image.romBytes, encoding: 'utf8' }), expected);
	}
});
