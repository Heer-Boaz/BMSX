import { compileTestSystemWithHeap } from '../helpers/heap_service_system';
import { runGuestToHalt } from '../helpers/cpu_execution';
import { readLuaNumberLiteral, formatLuaNumberExpression } from '../../toolchain/ts/lua/syntax/number_expression';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { integerConstant, parseNumberConstant } from '../../toolchain/ts/lua/number';
import { parseDecimalFloat32Bits, parseHexFloat32Bits } from '../../machine/ts/common/parse_float32';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { applyBlua32LinkValues, linkSystemBlua32Image } from '../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../helpers/blua32';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import * as v from '../../machine/ts/machine/cpu/value';

function compile(source: string, optLevel: 0 | 1 | 2 | 3) {
	return compileLuaChunkToProgram(parseLuaChunk(source, 'numbers.lua').chunk, [], { entrySource: source, programDomain: 'system', optLevel });
}
function execute(source: string, opt: 0 | 1 | 2 | 3, backend: CpuExecutionBackend) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(source, 'numbers.lua').chunk, [],
		{ entrySource: source, optLevel: opt, programDomain: 'system' });
	const image = linkTestSystemBlua32(compiled);
	const { cpu } = createTestSystemCpu(image, backend);
	runGuestToHalt(cpu, 100_000);
	const results: v.Value[] = []; cpu.readCompletionValues(results); return { cpu, results, image };
}

test('numeric spelling, not integrality, selects the Integer/Float constant representation', () => {
	for (const text of ['0', '2', '2147483647', '0xffffffff', '0x123456789abcdef012345678']) {
		const expected = text.startsWith('0x') ? Number(BigInt(text) & 0xffffffffn) : Number(text);
		assert.deepEqual(parseNumberConstant(text), integerConstant(expected));
	}
	for (const [text, word] of [['2.0', 0x40000000], ['2e0', 0x40000000], ['0x2p0', 0x40000000], ['2147483648', 0x4f000000], ['.5', 0x3f000000], ['1e-10000', 0]] as const)
		assert.deepEqual(parseNumberConstant(text), { kind: 'float', word });
	for (const text of ['1e39', '0x1p128']) assert.equal(parseNumberConstant(text), null);
});

test('scalar source entry follows word negation and retains Float negative zero', () => {
	const parsed = parseLuaChunk('return -0, -0.0, -0x80000000', 'entry.lua').chunk;
	const statement = parsed.body.get(0);
	assert.ok(statement.kind === LuaSyntaxKind.ReturnStatement);
	const values = statement.expressions.map(readLuaNumberLiteral);
	assert.deepEqual(values, [0, -0, -2147483648]);
	assert.equal(formatLuaNumberExpression(-0), '-0.0');
});

test('decimal and hexadecimal literals round directly to binary32, including midpoint tails', () => {
	assert.equal(parseDecimalFloat32Bits('1.00000005960464477539062500000001'), 0x3f800001);
	assert.equal(parseDecimalFloat32Bits('1.00000005960464477539062499999999'), 0x3f800000);
	assert.equal(parseDecimalFloat32Bits('1.000000178813934326171875'), 0x3f800002);
	assert.equal(parseHexFloat32Bits('0x1.000001000000000000001p0'), 0x3f800001);
	assert.equal(parseHexFloat32Bits('0x1.000001p0'), 0x3f800000);
	assert.equal(parseHexFloat32Bits('0x1p-150'), 0);
	assert.equal(parseHexFloat32Bits('0x1'+'0'.repeat(500)+'p-2000'),0x3f800000);
	assert.equal(parseHexFloat32Bits('0x1.000000000000001p-150'), 1);
	assert.equal(parseHexFloat32Bits('0x1.ffffffp127'), 0x7f800000);
	// An independent exact-decimal producer places each input immediately below,
	// at and above a known adjacent-float midpoint, over all exponent classes.
	for (let exponent = 0; exponent < 255; ++exponent) for (const mantissa of [0, 1, 0x3fffff, 0x7ffffe, 0x7fffff]) {
		const lower = (exponent << 23) | mantissa, significand = exponent === 0 ? mantissa : mantissa | 0x800000;
		const shift = exponent === 0 ? -150 : exponent - 151, places = Math.max(0, -shift) + 40;
		let middle = BigInt(significand * 2 + 1) * 10n ** BigInt(places);
		if (shift < 0) middle >>= BigInt(-shift); else middle <<= BigInt(shift);
		for (const delta of [-1n, 0n, 1n]) {
			const digits = (middle + delta).toString().padStart(places + 1, '0');
			const text = digits.slice(0, -places) + '.' + digits.slice(-places);
			const expected = delta < 0n ? lower : delta > 0n ? lower + 1 : (lower & 1) === 0 ? lower : lower + 1;
			assert.equal(parseDecimalFloat32Bits(text), expected, text);
		}
	}
});

const source = readFileSync('tests/fixtures/compiler32/numbers.lua', 'utf8');
const expected = [v.valueInteger(2), v.valueFloat(2), v.valueInteger(0), v.valueFloatBits(0x80000000), v.valueInteger(-2147483648), v.valueFloatBits(0x4f000000), v.valueInteger(0),
v.valueFloat(16777216), v.valueInteger(1), v.valueInteger(0), v.valueInteger(0), v.valueFloatBits(0x7f800000), v.valueFloatBits(0x7fc00000), v.valueFloatBits(0xffc00000),
v.valueInteger(100000000), v.valueFloat(100000000), v.valueInteger(-2147483648), v.valueInteger(-2147483648), v.valueInteger(2), v.valueInteger(-2), v.valueBool(true), v.valueBool(false), v.valueBool(true),
	v.valueFloat(1),v.valueInteger(1),v.valueInteger(0xedcba987),v.valueInteger(-1),v.valueInteger(511),v.valueFloat(1),v.valueFloat(2),v.valueFloatBits(0x80000000)];
for (const opt of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`O${opt} backend ${backend}: real source, linker and CPU retain subtype, rounding and word arithmetic`, () => {
		const { results, cpu, image } = execute(source, opt, backend);
		assert.deepEqual(results.slice(0, -1), expected);
		assert.equal(cpu.stringPool.toString(v.asStringId(results.at(-1)!)), '3.0/3');
		assert.ok(image.image.constants.some(c => c !== null && typeof c !== 'boolean' && typeof c !== 'string' && c.kind === 'integer' && c.word === 100000000));
		assert.ok(image.image.constants.some(c => c !== null && typeof c !== 'boolean' && typeof c !== 'string' && c.kind === 'float' && c.word === v.valuePayload(v.valueFloat(100000000))));
	});
}

const nativeRunner = process.env.BMSX_CPU32_RUNNER;
const functions = readFileSync('tests/fixtures/compiler32/functions.lua', 'utf8');
for (const [name, program] of [['numbers', source], ['functions', functions]] as const) for (const opt of [3] as const) test(`O${opt} ${name}: native scalar CPU executes the same frontend-produced image`, { skip: !nativeRunner }, () => {
	const { image, cpu, results } = execute(program, opt, CpuExecutionBackend.Interpreter);
	const expected = [`budget ${cpu.instructionBudgetRemaining} fault ${cpu.readLuaFaultReasonWord()}`, ...results.map(value => v.valueIsString(value) ? 'S ' + cpu.stringPool.toString(v.asStringId(value)) : `${v.valueTag(value).toString(16)} ${v.valuePayload(value).toString(16)}`)].join('\n') + '\n';
	assert.equal(execFileSync(nativeRunner!, ['--execute-rom'], { input: image.romBytes, encoding: 'utf8' }), expected);
});

for (const opt of [3] as const) test(`O${opt}: invalid constant operations remain guest faults, not fabricated constants`, () => {
	for (const expression of ['1//0', '1%0', '2.5&1', '1<<0x80000000.0']) {
		const image = linkTestSystemBlua32(compile('return ' + expression, opt));
		const { cpu } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
		cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, image.vectors.entryFunctionAddress); cpu.runUntilDepth(1, 1);
		assert.equal(cpu.readLuaFaultReasonWord(), 10, expression);
	}
});

for (const opt of [3] as const) test(`O${opt}: f32 and external f64 data initializers use the computed subtype`, () => {
	const compiled = compile('rodata values: f64[2]={16777217,16777217.0}\nrodata floats:f32[2]={-0.0,-(0/0)}\nreturn values', opt);
	const data = encodeCompiledProgramObject(compiled).sections.rodata.bytes;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	assert.equal(view.getFloat64(0, true), 16777217); assert.equal(view.getFloat64(8, true), 16777216);
	assert.equal(view.getUint32(16, true), 0x80000000); assert.equal(view.getUint32(20, true), 0xffc00000);
});

for (const opt of [3] as const) test(`O${opt}: late ROM-address relocations update raw Integer/Float records`, () => {
	const source = "local assets<const> = require('assets')\nreturn assets.start+4,assets.start/2";
	const moduleSource = 'module<const>\nreturn {start=0}';
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'entry.lua').chunk, [{ path: 'assets', source: moduleSource, chunk: parseLuaChunk(moduleSource, 'assets.lua').chunk, linkValues: new Map([['start', 0x7ffffffc]]) }], { entrySource: source, programDomain: 'system', optLevel: opt });
	const linked = linkSystemBlua32Image(encodeCompiledProgramObject(compiled), compiled.metadata, 0x100, PSX_MACHINE_SPEC.ramBytes, []);
	for (const address of [0x7ffffffc, 0x1000000, 0xffffffff]) {
		applyBlua32LinkValues(linked, compiled.constValueRelocs, 'assets', new Map([['start', address]]));
		const { cpu } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(linked) }); cpu.runUntilDepth(0, 100000);
		const results: v.Value[] = []; cpu.readCompletionValues(results);
		assert.deepEqual(results, [v.valueInteger((address + 4) | 0), v.valueFloat(Math.fround(address | 0) / 2)]);
	}
});

for (const opt of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter])
	test(`O${opt} backend ${backend}: source calls, captures, tables and loops consume compact values`, () => {
		const { results } = execute(functions, opt, backend);
		assert.deepEqual(results, [v.valueInteger(11), v.valueFloat(3), v.valueFloat(2 / 3), v.valueInteger(87), v.valueInteger(3)]);
	});

for (const opt of [3] as const) test(`O${opt}: loop unrolling follows wrapping Integer and binary32 additions`, () => {
	for (const range of ['0x7ffffffe,0x7fffffff,1', '16777216.0,16777218.0,1.0']) {
		const image = linkTestSystemBlua32(compile(`ticks=0;for i=${range} do ticks=ticks+1 end;return ticks`, opt));
		const { cpu } = createTestSystemCpu(image, CpuExecutionBackend.JavaScript);
		assert.equal(cpu.runUntilDepth(0, 20000), RunResult.Yielded);
		assert.ok(v.asInteger(cpu.getGlobalByKey(cpu.stringPool.find('ticks')!)) > 3);
	}
});

test('a faulting closed link expression is rejected, never encoded as a replacement Number', () => {
	const source = "local assets<const> = require('assets')\nreturn 1//assets.start";
	const moduleSource = 'module<const>\nreturn {start=1}';
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'entry.lua').chunk, [{ path: 'assets', source: moduleSource, chunk: parseLuaChunk(moduleSource, 'assets.lua').chunk, linkValues: new Map([['start', 1]]) }], { entrySource: source, programDomain: 'system', optLevel: 0 });
	const linked = linkSystemBlua32Image(encodeCompiledProgramObject(compiled), compiled.metadata, 0x100, PSX_MACHINE_SPEC.ramBytes, []);
	assert.throws(() => applyBlua32LinkValues(linked, compiled.constValueRelocs, 'assets', new Map([['start', 0]])), /Invalid numeric operation/);
});
