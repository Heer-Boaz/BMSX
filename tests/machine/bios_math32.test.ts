import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import * as v from '../../machine/ts/machine/cpu/value';

const bootSource = 'return {pcall=__bmsx_pcall,error=__bmsx_error,select=__bmsx_select}';
const modules = ['math', 'math/trig', 'math/trig/reduce'].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, `${path}.lua`).chunk };
});
modules.push({ path: 'test/boot', source: bootSource, chunk: parseLuaChunk(bootSource, 'test/boot.lua').chunk });
function compile(source: string, optLevel: 0 | 3) {
	const program = compileLuaChunkToProgram(parseLuaChunk(source, 'math32.lua').chunk, modules,
		{ entrySource: source, programDomain: 'system', optLevel });
	return linkTestSystemBlua32(program);
}
function run(source: string, opt: 0 | 3, backend: CpuExecutionBackend) {
	const image = compile(source, opt), { cpu } = createTestSystemCpu(image, backend);
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const results: v.Value[] = []; cpu.readCompletionValues(results);
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	return { image, cpu, results };
}
const math = "local boot<const> = require('test/boot'); error=boot.error; select=boot.select; local math<const> = require('math')\n";
const numericSource = readFileSync(new URL('../fixtures/compiler32/math.lua', import.meta.url), 'utf8');
const numericExpected = [v.valueInteger(2147483647), v.valueInteger(-2147483648),
'integer', 'float', 'float', 'float', v.valueNil(),
v.valueInteger(2), v.valueInteger(-2147483648), v.valueNil(), v.valueNil(), v.valueNil(), v.valueNil(),
v.valueInteger(-2147483648), v.valueFloat(0), v.valueFloat(2.5),
v.valueInteger(-2147483648), v.valueInteger(-2147483648), v.valueInteger(-2147483648),
v.valueInteger(2), v.valueInteger(-2), v.valueInteger(-3), v.valueInteger(3),
v.valueInteger(8388607), v.valueInteger(8388608), v.valueFloat(2147483648),
v.valueInteger(-1), v.valueInteger(1), v.valueInteger(0),
v.valueFloat(-1), v.valueFloat(1), v.valueFloatBits(0x80000000),
v.valueBool(true), v.valueBool(false), v.valueInteger(0),
v.valueFloat(0), v.valueFloatBits(0x80000000), v.valueFloatBits(0x80000000), v.valueFloat(0), v.valueFloat(0), v.valueInteger(-2), v.valueFloat(-0.5)];

for (const opt of [0, 3] as const) for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`BIOS math O${opt} ${backend}: stored subtypes, signed limits and elementary Number32 operations`, () => {
		const { cpu, results } = run(numericSource, opt, backend);
		assert.deepEqual(results.map(value => v.valueIsString(value) ? cpu.stringPool.toString(v.asStringId(value)) : value), numericExpected);
	});
	test(`BIOS math O${opt} ${backend}: exact unsigned RNG mapping, whole interval and explicit nil return`, () => {
		const source = readFileSync(new URL('../fixtures/compiler32/random.lua', import.meta.url), 'utf8');
		const { results } = run(source, opt, backend);
		const state = 1013904223n;
		assert.deepEqual(results, [v.valueFloat(Number(state >> 8n) / 16777216), v.valueInteger(Number(state * 6n >> 32n) + 1),
			v.valueInteger(Number(state) - 2147483648), v.valueInteger(-2000000000 + Number(state * 4000000001n >> 32n)), v.valueNil()]);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`BIOS math ${backend}: errors reject invalid numeric inputs and do not consume random state`, () => {
		const { results } = run(math + `local pcall<const> = boot.pcall
math.randomseed(0)
local a = pcall(math.random, 1.5)
local b = pcall(math.random, -1)
local c = pcall(math.random, 3, 2)
local d = pcall(math.randomseed, '2')
local e = pcall(math.abs, {})
local f = pcall(math.sign, {})
local g = pcall(math.atan, false, 0)
local h = pcall(math.atan, 1, false)
return a,b,c,d,e,f,g,h,math.random(6)`, 3, backend);
		assert.deepEqual(results, [v.valueBool(false), v.valueBool(false), v.valueBool(false), v.valueBool(false), v.valueBool(false), v.valueBool(false), v.valueBool(false), v.valueBool(false), v.valueInteger(2)]);
	});
	test(`BIOS math ${backend}: range mapping is an exact high-word product, not Float scaling`, () => {
		let seed = 0x12345678;
		const lines: string[] = [math], names: string[] = [], expected: v.Value[] = [];
		const ranges = [[1, 2147483647], [-2147483648, -2147483648], [-2147483648, 2147483647], [-2147483648, 2147483646], [-2000000000, 2000000000], [-1, 1], [-2147483647, 2147483647], [0, 2147483647]];
		for (let index = 0; index < 64; ++index) {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			const [lo, hi] = ranges[index % ranges.length], state = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			expected.push(v.valueInteger(lo + Number(BigInt(state) * (BigInt(hi) - BigInt(lo) + 1n) >> 32n)));
			names.push(`result${index}`);
			lines.push(`math.randomseed(0x${seed.toString(16)}); local result${index}=math.random(0x${(lo >>> 0).toString(16)},0x${(hi >>> 0).toString(16)})`);
		}
		lines.push('return ' + names.join(','));
		assert.deepEqual(run(lines.join('\n'), 3, backend).results, expected);
	});
}

const native = process.env.BMSX_CPU32_RUNNER;
for (const fixture of ['math', 'random']) for (const opt of [0, 3] as const) test(`BIOS ${fixture} O${opt}: C++ runs the same guest BIOS and charges the same cycles`, { skip: !native }, () => {
	const source = readFileSync(new URL(`../fixtures/compiler32/${fixture}.lua`, import.meta.url), 'utf8');
	const { image, cpu, results } = run(source, opt, CpuExecutionBackend.Interpreter);
	const expected = [`budget ${cpu.instructionBudgetRemaining} fault 0`, ...results.map(value => v.valueIsString(value)
		? 'S ' + cpu.stringPool.toString(v.asStringId(value)) : `${v.valueTag(value).toString(16)} ${v.valuePayload(value).toString(16)}`)].join('\n') + '\n';
	assert.equal(execFileSync(native!, ['--execute-rom', '--boot-primitives'], { input: image.romBytes, encoding: 'utf8' }), expected);
});
