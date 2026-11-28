import { asClosure } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { runGuestToHalt } from '../helpers/cpu_test_harness';
import { parseHexFloat32Bits } from '../../machine/ts/common/parse_float32';
import { BLUA32_FIRMWARE_MODULE_SOURCE } from '../../toolchain/ts/rompack/blua32_firmware_module';
import * as v from '../../machine/ts/machine/cpu/value';

const paths = ['base', 'number/decimal', 'number/parse', 'table', 'string/base',
	'compiler/api', 'compiler/arena', 'compiler/bytecode', 'compiler/compiler', 'compiler/lexer',
	'compiler/linker', 'compiler/load', 'compiler/parser', 'compiler/semantic', 'compiler/syntax', 'compiler/syntax_factory', 'compiler/token'];
const modules = paths.map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') }));
// Console output is outside this CPU/loader fixture, as in firmware_call_results.
modules.push({ path: 'tty/console', source: 'return {write=function() end,end_line=function() end}' },
	{ path: 'bmsx/blua32', source: BLUA32_FIRMWARE_MODULE_SOURCE },
	{ path: 'test/raw', source: 'return {encode=function(value) return blua32.float_bits(value) end,decode=function(word) return blua32.float_from_bits(word) end}' });
const parsedModules = modules.map(module => ({ ...module, chunk: parseLuaChunk(module.source, `${module.path}.lua`).chunk }));
const budget = 10000000;
function run(source: string, optLevel: 0 | 3, backend: CpuExecutionBackend) {
	const program = compileTestSystemWithHeap(parseLuaChunk(source, 'number32.lua').chunk, parsedModules, { entrySource: source, optLevel, programDomain: 'system' });
	const image = linkTestSystemBlua32(program), { cpu } = createTestSystemCpu(image, backend);
	runGuestToHalt(cpu, budget);
	const results: v.Value[] = []; cpu.readCompletionValues(results);
	return { image, cpu, results };
}
const source = readFileSync('tests/fixtures/compiler32/parse.lua','utf8');
const expected = [v.valueInteger(2147483647),v.valueInteger(-2147483648),v.valueFloat(2147483648),v.valueFloat(-2147483648),
	v.valueInteger(-1),v.valueInteger(1),v.valueInteger(0),v.valueFloatBits(0x80000000),v.valueInteger(2),v.valueFloat(2),v.valueFloatBits(0x7f800000),
	v.valueFloatBits(0x80000000),v.valueFloatBits(0x3f800001),v.valueFloatBits(0x3f800000),v.valueFloatBits(0x3f800002),
	v.valueFloatBits(0x3f800001),v.valueFloatBits(0x3f800000),v.valueFloat(0),v.valueFloatBits(1),v.valueFloatBits(0x7f800000)];
for (const opt of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`BIOS Number32 O${opt} ${backend}: real tonumber and literal parser round once and preserve spelling`, () => {
		assert.deepEqual(run(source,opt,backend).results,expected);
	});
}
const native = process.env.BMSX_CPU32_RUNNER;
for (const opt of [3] as const) test(`BIOS Number32 O${opt}: C++ and TS execute the same parser with identical guest cycles`, { skip: !native }, () => {
	const { image,cpu,results } = run(source,opt,CpuExecutionBackend.Interpreter);
	const expected = [`budget ${cpu.instructionBudgetRemaining} fault 0`,...results.map(value => `${v.valueTag(value).toString(16)} ${v.valuePayload(value).toString(16)}`)].join('\n')+'\n';
	assert.equal(execFileSync(native!,['--execute-rom',String(budget)],{ input:image.romBytes,encoding:'utf8' }),expected);
});

const loadSource = readFileSync('tests/fixtures/compiler32/load.lua','utf8');
const loadExpected = [v.valueFloat(3),v.valueInteger(-2147483648),v.valueInteger(2),v.valueFloat(2),v.valueFloat(2),v.valueFloatBits(0x80000000),v.valueFloat(0),v.valueInteger(0),
	v.valueInteger(-2147483648),v.valueFloat(2147483648),v.valueFloat(-2147483648),v.valueInteger(-1),v.valueFloat(6),v.valueFloat(0.25),
	v.valueFloatBits(0x3f800001),v.valueFloatBits(0x3f800001),v.valueFloatBits(0x3f800000)];
for (const opt of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`BIOS load O${opt} ${backend}: real runtime lexer, constant pool and generated RAM closure retain Integer/Float identity`, () => {
		assert.deepEqual(run(loadSource,opt,backend).results,loadExpected);
	});
	test(`BIOS tonumber O${opt} ${backend}: text grammar, exact Float bases, word overflow and parse failures`, () => {
		const source = `require('base')
return tonumber('2147483647',10.0),tonumber('ffffffff',16.0),tonumber('4294967297',10.0),tonumber('-100000000000000000000000000000001',2),
tonumber(''),tonumber('+'),tonumber('--1'),tonumber('0x'),tonumber('0x1p0'),tonumber('1..2'),tonumber('1e'),
tonumber('nan'),tonumber('infinity'),tonumber('12x'),tonumber('  +.25e1  '),tonumber(false),tonumber(2.0)`;
		assert.deepEqual(run(source,opt,backend).results,[v.valueInteger(2147483647),v.valueInteger(-1),v.valueInteger(1),v.valueInteger(-1),
			...Array(10).fill(v.valueNil()),v.valueFloat(2.5),v.valueNil(),v.valueFloat(2)]);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter]) test(`BIOS decimal ${backend}: exact midpoint tails through normal, subnormal and overflow boundaries`, () => {
	const { cpu,results } = run("require('base');return tonumber",3,backend);
	const closure = asClosure(results[0],nativeHeapReference(cpu).gc);
	const lowerWords = [0,1,0x7ffffe,0x7fffff,0x800000,0x800001,0x3f7fffff,0x3f800000,0x3f800001,0x7f7fffff];
	for (const exponent of [2,32,64,128,190,253]) lowerWords.push((exponent << 23) | 0x3fffff);
	for (const lower of lowerWords) {
		const exponent = lower >>> 23, significand = exponent === 0 ? lower : (lower & 0x7fffff) | 0x800000;
		const shift = exponent === 0 ? -150 : exponent - 151, places = Math.max(0,-shift) + 12;
		let middle = BigInt(significand * 2 + 1) * 10n ** BigInt(places);
		if (shift < 0) middle >>= BigInt(-shift); else middle <<= BigInt(shift);
		for (const delta of [-1n,0n,1n]) {
			const digits = (middle+delta).toString().padStart(places+1,'0');
			const text = digits.slice(0,-places)+'.'+digits.slice(-places);
			const expected = delta < 0n ? lower : delta > 0n ? lower+1 : (lower & 1) === 0 ? lower : lower+1;
			cpu.beginCompletionCall(closure,[v.valueString(nativeHeapReference(cpu).stringPool.intern(text))]);
			runGuestToHalt(cpu, budget);
			const actual: v.Value[] = []; cpu.readCompletionValues(actual);
			assert.deepEqual(actual,[v.valueFloatBits(expected)],text);
		}
	}
});

for (const backend of [CpuExecutionBackend.Interpreter]) test(`BIOS load ${backend}: rejects malformed and non-finite source numerals`, () => {
	const { results } = run(`require('base');local api<const> = require('compiler/api')
local a = api.load('return 1e39');local b = api.load('return 0x1p128')
local c = api.load('return 0x.p1');local d = api.load('return 1e+')
return a==nil,b==nil,c==nil,d==nil`,3,backend);
	assert.deepEqual(results,Array(4).fill(v.valueBool(true)));
});

const syntaxSource = readFileSync('tests/fixtures/compiler32/syntax.lua','utf8');
for (const backend of [CpuExecutionBackend.Interpreter]) test(`BIOS compile_syntax ${backend}: constant-pool identity includes the complete Float word`, () => {
	assert.deepEqual(run(syntaxSource,3,backend).results,[v.valueInteger(2),v.valueFloat(2),v.valueFloatBits(0x80000000),v.valueFloat(0),
		v.valueFloatBits(0x7fa12345),v.valueFloatBits(0xffa12345),v.valueFloatBits(0x7fc00000)]);
});
for (const [name,source] of [['load',loadSource],['syntax',syntaxSource]]) for (const opt of [3] as const)
	test(`BIOS ${name} O${opt}: native scalar CPU consumes the runtime-compiled RAM program`, { skip: !native }, () => {
		const { image,cpu,results } = run(source,opt,CpuExecutionBackend.Interpreter);
		const expected = [`budget ${cpu.instructionBudgetRemaining} fault 0`,...results.map(value => `${v.valueTag(value).toString(16)} ${v.valuePayload(value).toString(16)}`)].join('\n')+'\n';
		assert.equal(execFileSync(native!,['--execute-rom',String(budget)],{ input:image.romBytes,encoding:'utf8' }),expected);
	});

for (const backend of [CpuExecutionBackend.Interpreter]) test(`BIOS literal ${backend}: hexadecimal exponents and long significands cancel without a wide accumulator`, () => {
	const { cpu,results } = run("require('base');return require('number/parse').literal",3,backend);
	const closure = asClosure(results[0],nativeHeapReference(cpu).gc);
	const texts = ['0x1'+'0'.repeat(200)+'p-800','0x0.'+'0'.repeat(300)+'1p1204','0x1p-149','0x1.fffffep127'];
	let word = 0x12345678;
	for (let i=0;i<64;++i) {
		word = (Math.imul(word,1664525)+1013904223)>>>0;
		const bits = word % 0x7f800000, exponent = bits >>> 23;
		const mantissa = exponent === 0 ? bits & 0x7fffff : (bits & 0x7fffff)|0x800000;
		texts.push(`0x${mantissa.toString(16)}p${exponent === 0 ? -149 : exponent-150}`);
	}
	for (const text of texts) {
		cpu.beginCompletionCall(closure,[v.valueString(nativeHeapReference(cpu).stringPool.intern(text))]);
		runGuestToHalt(cpu, budget);
		const actual: v.Value[] = [];cpu.readCompletionValues(actual);
		assert.deepEqual(actual,[v.valueFloatBits(parseHexFloat32Bits(text))],text);
	}
});

for (const backend of [CpuExecutionBackend.Interpreter]) {
 test(`BIOS load ${backend}: nested word moves produce one result`, () => {
  const {results}=run(`require('base');local api<const> = require('compiler/api')
local f<const> = assert(api.load('return blua32.float_bits(blua32.float_from_bits(0xffa12345))'))
return f()`,3,backend);
  assert.deepEqual(results,[v.valueInteger(0xffa12345)]);
 });
 test(`BIOS load ${backend}: a local namespace is not a word move intrinsic`, () => {
  const {results}=run(`require('base');local api<const> = require('compiler/api')
local g<const> = assert(api.load('return function(blua32) return blua32.float_bits(4) end'))
return g()({float_bits=function(value) return value+1 end})`,3,backend);
  assert.deepEqual(results,[v.valueInteger(5)]);
 });
}

const wordMovesSource = readFileSync('tests/fixtures/compiler32/word-moves-load.lua','utf8');
for (const opt of [3] as const) test(`BIOS word moves O${opt}: C++ executes runtime-compiled moves and namespace shadowing`, {skip: !native}, () => {
 const {image,cpu,results} = run(wordMovesSource,opt,CpuExecutionBackend.Interpreter);
 assert.deepEqual(results,[v.valueInteger(0xffa12345),v.valueInteger(5),v.valueFloatBits(0x80000000),v.valueInteger(0x40000000)]);
 const expected = [`budget ${cpu.instructionBudgetRemaining} fault 0`,...results.map(value=>`${v.valueTag(value).toString(16)} ${v.valuePayload(value).toString(16)}`)].join('\n')+'\n';
 assert.equal(execFileSync(native!,['--execute-rom',String(budget)],{input:image.romBytes,encoding:'utf8'}),expected);
});
