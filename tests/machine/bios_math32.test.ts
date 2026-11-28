import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createTestSystemCpu, writeTestBlua32Rom } from '../helpers/blua32';
import { linkManagedTestSystem } from '../helpers/managed_system';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { runGuestToHalt } from '../helpers/cpu_test_harness';
import * as v from '../../machine/ts/machine/cpu/value';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import { nativeConformanceRunner } from '../helpers/native_conformance.mjs';

const bootSource = `local startup<const> = require('bmsx/startup')
return {pcall=blua32.closure(startup.protected_call),error=__bmsx_error}`;
const modules = ['math', 'math/trig', 'math/trig/reduce'].map(path =>
	({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') }));
modules.push({ path: 'test/boot', source: bootSource });
function run(source: string, opt: 0 | 3, backend: CpuExecutionBackend, budget = 1_000_000) {
	const romBytes = writeTestBlua32Rom(linkManagedTestSystem(source, opt, modules));
	const { cpu } = createTestSystemCpu({ romBytes }, backend);
	runGuestToHalt(cpu, budget);
	const results: v.Value[] = []; cpu.readCompletionValues(results);
	return { romBytes, cpu, results };
}
const math = "local boot<const> = require('test/boot'); error=boot.error; local math<const> = require('math')\n";
for (const opt of [0, 3] as const) test(`BIOS log O${opt} branches to one natural-log body with two distinct continuations`, t => {
	const source = math + 'return math.log(1), math.log(8, 4), math.log(16, 4), math.log(8, 2), math.log(0, 3)';
	const linked = linkManagedTestSystem(source, opt, modules);
	const fn = linked.layout.functions[linked.symbols.metadata.functionDisplayNames.indexOf('log')];
	assert.ok(fn);
	const linkRegisters: number[] = [], returnRegisters: number[] = [];
	const labelSlots: number[] = [];
	let previous: ReturnType<typeof decodeBlua32InstructionAtPc> | undefined;
	for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount;) {
		const decoded = decodeBlua32InstructionAtPc(linked.bytes, linked.layout.address, pc);
		assert.notEqual(decoded.op, OpCode.CALL, 'the natural-log kernel does not create a language frame');
		assert.notEqual(decoded.op, OpCode.SVC);
		if (decoded.op === OpCode.JREG) {
			if (decoded.c === 1) {
				assert.ok(previous?.op === OpCode.LOADK && previous.a === decoded.a);
				assert.equal(decoded.b, decoded.a);
				labelSlots.push(previous.bx);
				linkRegisters.push(decoded.a);
			} else returnRegisters.push(decoded.a);
		}
		pc = decoded.pc + INSTRUCTION_BYTES;
		previous = decoded;
	}
	assert.equal(returnRegisters.length, 1);
	assert.deepEqual(linkRegisters, [returnRegisters[0], returnRegisters[0]]);
	assert.equal(labelSlots[0], labelSlots[1]);

	const romBytes = writeTestBlua32Rom(linked);
	const expected = [0, 1.5, 2, 3, -Infinity].map(v.valueFloat);
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const { cpu } = createTestSystemCpu({ romBytes }, backend);
		runGuestToHalt(cpu, 1_000_000);
		const results: v.Value[] = [];
		cpu.readCompletionValues(results);
		assert.deepEqual(results, expected);
	}
	const temp = mkdtempSync(join(tmpdir(), 'bmsx-firmware-log-'));
	t.after(() => rmSync(temp, { recursive: true, force: true }));
	const rom = join(temp, 'system.rom'), trace = join(temp, 'trace');
	writeFileSync(rom, romBytes);
	writeFileSync(trace, 'E 1000000\n'.repeat(8) + 'c\n');
	const nativeMachine = nativeConformanceRunner('bmsx_machine_conformance_runner');
	const rows = execFileSync(nativeMachine, [rom, trace, join(temp, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
	assert.equal(rows.at(-1), [expected.length, ...expected.flatMap(value => [v.valueTag(value), v.valuePayload(value)])].join(' '));
});

const numericSource = readFileSync('tests/fixtures/compiler32/math.lua', 'utf8');
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

for (const opt of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`BIOS math O${opt} ${backend}: stored subtypes, signed limits and elementary Number32 operations`, () => {
		const { cpu, results } = run(numericSource, opt, backend);
		assert.deepEqual(results.map(value => v.valueIsString(value) ? cpu.stringPool.toString(v.asStringId(value)) : value), numericExpected);
	});
	test(`BIOS math O${opt} ${backend}: exact unsigned RNG mapping, whole interval and explicit nil return`, () => {
		const source = readFileSync('tests/fixtures/compiler32/random.lua', 'utf8');
		const { results } = run(source, opt, backend);
		const state = 1013904223n;
		assert.deepEqual(results, [v.valueFloat(Number(state >> 8n) / 16777216), v.valueInteger(Number(state * 6n >> 32n) + 1),
			v.valueInteger(Number(state) - 2147483648), v.valueInteger(-2000000000 + Number(state * 4000000001n >> 32n)), v.valueNil()]);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter]) {
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
		assert.deepEqual(run(lines.join('\n'), 3, backend, 1_000_000).results, expected);
	});
}

const native = process.env.BMSX_CPU32_RUNNER;
for (const fixture of ['math', 'random']) for (const opt of [3] as const) test(`BIOS ${fixture} O${opt}: C++ runs the same guest BIOS and charges the same cycles`, { skip: !native }, () => {
	const source = readFileSync(`tests/fixtures/compiler32/${fixture}.lua`, 'utf8');
	const { romBytes, cpu, results } = run(source, opt, CpuExecutionBackend.Interpreter);
	const expected = [`budget ${cpu.instructionBudgetRemaining} fault 0`, ...results.map(value => v.valueIsString(value)
		? 'S ' + cpu.stringPool.toString(v.asStringId(value)) : `${v.valueTag(value).toString(16)} ${v.valuePayload(value).toString(16)}`)].join('\n') + '\n';
	assert.equal(execFileSync(native!, ['--execute-rom', '1000000'], { input: romBytes, encoding: 'utf8' }), expected);
});
