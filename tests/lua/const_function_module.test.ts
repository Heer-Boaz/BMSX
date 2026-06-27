import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { readLE32 } from '../../machine/ts/common/endian';
import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { CPU, RunResult, type ProgramMetadata } from '../../machine/ts/machine/cpu/cpu';
import { disassembleProgram } from '../../machine/ts/machine/cpu/disassembler';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { compileLuaChunkToProgram, encodeCompiledProgramImage, type CompiledProgram } from '../../machine/ts/machine/program/compiler';
import type { ProgramImage } from '../../machine/ts/machine/program/loader';
import { inflateExecutableProgramImage, linkProgramImages } from '../../machine/ts/machine/program/linker';
import type { OptimizationLevel } from '../../machine/ts/machine/program/optimizer';

const BOOL01_PATH = 'bios/util/bool01';
const DIV_TOWARD_ZERO_PATH = 'bios/util/div_toward_zero';
const ROL8_PATH = 'bios/util/rol8';
const ROUND_TO_NEAREST_PATH = 'bios/util/round_to_nearest';
const CLAMP_PATH = 'bios/util/clamp';
const RECT_OVERLAPS_PATH = 'bios/util/rect_overlaps';
const SINCOS_TURN32_PATH = 'bios/util/sincos_turn32';
const STATIC_FORBIDDEN_OPCODE_PATTERN = /\b(?:NEWT|GETT|SETT|GETI|SETI|GETFIELD|SETFIELD|SELF|CLOSURE|VARARG|CONCAT|CONCATN)\b/;

const buildExpectedSineQuarter = (): number[] => {
	const out: number[] = [];
	for (let index = 0; index <= 256; index += 1) {
		out.push(Math.trunc(Math.sin((Math.PI * index) / 512) * 65536));
	}
	return out;
};

function parseSource(source: string, path: string) {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

function compileWithModule(entrySource: string, modulePath: string, moduleSource: string, optLevel: OptimizationLevel = 0): CompiledProgram {
	return compileLuaChunkToProgram(
		parseSource(entrySource, 'entry.lua'),
		[{ path: modulePath, chunk: parseSource(moduleSource, `${modulePath}.lua`), source: moduleSource }],
		{ entrySource, optLevel },
	);
}

function runColdImage(image: ProgramImage, metadata: ProgramMetadata | null) {
	const cpu = new CPU(new Memory({ systemRom: new Uint8Array(0) }));
	cpu.setProgram(inflateExecutableProgramImage(image, metadata), metadata);
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	cpu.start(image.vectors.resetProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	return Array.from(cpu.lastReturnValues);
}

function runColdCompiled(compiled: CompiledProgram) {
	const image = encodeCompiledProgramImage(compiled);
	return runColdImage(image, compiled.metadata);
}

function disassembleWithoutBootVectors(compiled: CompiledProgram): string {
	return disassembleProgram(compiled.program, compiled.metadata, { showProtoHeaders: true })
		.split('\n\n')
		.filter(block => !block.includes('/irq entry=') && !block.includes('/section_init entry='))
		.join('\n\n');
}

test('rect_overlaps compiles as a const function module and calls through export-proto', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/rect_overlaps.lua', 'utf8');
	const entrySource = `
local rect_overlaps<const> = require("${RECT_OVERLAPS_PATH}")
return rect_overlaps(0, 0, 10, 10, 5, 5, 1, 1), rect_overlaps(0, 0, 2, 2, 3, 3, 1, 1)
`;
	const compiled = compileWithModule(entrySource, RECT_OVERLAPS_PATH, moduleSource);
	assert.equal(compiled.moduleProtoMap.has(RECT_OVERLAPS_PATH), false);
	assert.equal(compiled.metadata.exportProtoIdBySlot.bios__util__rect_overlaps?.includes('/static:'), true);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'bios__util__rect_overlaps'), true);
	const disasm = disassembleWithoutBootVectors(compiled);
	assert.doesNotMatch(disasm, STATIC_FORBIDDEN_OPCODE_PATTERN);
	assert.deepEqual(runColdCompiled(compiled), [true, false]);
});

test('clamp compiles as a const function module and calls through export-proto', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/clamp.lua', 'utf8');
	const entrySource = `
local clamp<const> = require("${CLAMP_PATH}")
return clamp(-2, 0, 10), clamp(7, 0, 10), clamp(12, 0, 10)
`;
	const compiled = compileWithModule(entrySource, CLAMP_PATH, moduleSource);
	assert.equal(compiled.moduleProtoMap.has(CLAMP_PATH), false);
	assert.equal(compiled.metadata.exportProtoIdBySlot.bios__util__clamp?.includes('/static:'), true);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'bios__util__clamp'), true);
	const disasm = disassembleWithoutBootVectors(compiled);
	assert.doesNotMatch(disasm, STATIC_FORBIDDEN_OPCODE_PATTERN);
	assert.deepEqual(runColdCompiled(compiled), [0, 7, 10]);
});

test('remaining scalar helpers compile as const function modules and call through export-proto', () => {
	const cases = [
		{
			path: BOOL01_PATH,
			name: 'bool01',
			sourcePath: 'machine/firmware/bios/util/bool01.lua',
			entry: `
local bool01<const> = require("${BOOL01_PATH}")
return bool01(true), bool01(false)
`,
			expected: [1, 0],
		},
		{
			path: DIV_TOWARD_ZERO_PATH,
			name: 'div_toward_zero',
			sourcePath: 'machine/firmware/bios/util/div_toward_zero.lua',
			entry: `
local div_toward_zero<const> = require("${DIV_TOWARD_ZERO_PATH}")
return div_toward_zero(7, 3), div_toward_zero(-7, 3)
`,
			expected: [2, -2],
		},
		{
			path: ROL8_PATH,
			name: 'rol8',
			sourcePath: 'machine/firmware/bios/util/rol8.lua',
			entry: `
local rol8<const> = require("${ROL8_PATH}")
return rol8(5), rol8(128)
`,
			expected: [10, 1],
		},
		{
			path: ROUND_TO_NEAREST_PATH,
			name: 'round_to_nearest',
			sourcePath: 'machine/firmware/bios/util/round_to_nearest.lua',
			entry: `
local round_to_nearest<const> = require("${ROUND_TO_NEAREST_PATH}")
return round_to_nearest(1.4), round_to_nearest(1.6), round_to_nearest(-1.4), round_to_nearest(-1.6)
`,
			expected: [1, 2, -1, -2],
		},
	];
	for (let index = 0; index < cases.length; index += 1) {
		const testCase = cases[index];
		const moduleSource = readFileSync(testCase.sourcePath, 'utf8');
		const compiled = compileWithModule(testCase.entry, testCase.path, moduleSource);
		const slotName = `bios__util__${testCase.name}`;
		assert.equal(compiled.moduleProtoMap.has(testCase.path), false);
		assert.equal(compiled.metadata.exportProtoIdBySlot[slotName]?.includes('/static:'), true);
		assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === slotName), true);
		const disasm = disassembleWithoutBootVectors(compiled);
		assert.doesNotMatch(disasm, STATIC_FORBIDDEN_OPCODE_PATTERN);
		assert.deepEqual(runColdCompiled(compiled), testCase.expected);
	}
});

test('sincos_turn32 is a const function module backed by visible rodata', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/sincos_turn32.lua', 'utf8');
	const entrySource = `
local s0<const>, c0<const> = require("${SINCOS_TURN32_PATH}").sincos_turn32(0)
local s90<const>, c90<const> = require("${SINCOS_TURN32_PATH}").sincos_turn32(1073741824)
local s180<const>, c180<const> = require("${SINCOS_TURN32_PATH}").sincos_turn32(2147483648)
local s270<const>, c270<const> = require("${SINCOS_TURN32_PATH}").sincos_turn32(3221225472)
local s360<const>, c360<const> = require("${SINCOS_TURN32_PATH}").sincos_turn32(4294967296)
local s45<const>, c45<const> = require("${SINCOS_TURN32_PATH}").sincos_turn32(536870912)
local sn45<const>, cn45<const> = require("${SINCOS_TURN32_PATH}").sincos_turn32(-536870912)
return s0, c0, s90, c90, s180, c180, s270, c270, s360, c360, s45, c45, sn45, cn45
`;
	const compiled = compileWithModule(entrySource, SINCOS_TURN32_PATH, moduleSource);
	const image = encodeCompiledProgramImage(compiled);
	const slotName = 'bios__util__sincos_turn32__sincos_turn32';
	assert.equal(compiled.moduleProtoMap.has(SINCOS_TURN32_PATH), false);
	assert.equal(compiled.metadata.exportProtoIdBySlot[slotName]?.includes('/static:'), true);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === slotName), true);
	assert.deepEqual(image.sections.rodata.symbols, [{
		name: 'module:bios/util/sincos_turn32/rodata:sin_quarter_lut',
		offset: 0,
		byteCount: 257 * 4,
		alignment: 4,
	}]);
	const expectedQuarter = buildExpectedSineQuarter();
	assert.equal(image.sections.rodata.bytes.byteLength, expectedQuarter.length * 4);
	for (let index = 0; index < expectedQuarter.length; index += 1) {
		assert.equal(readLE32(image.sections.rodata.bytes, index * 4), expectedQuarter[index] >>> 0);
	}
	const disasm = disassembleWithoutBootVectors(compiled);
	assert.doesNotMatch(disasm, STATIC_FORBIDDEN_OPCODE_PATTERN);
	assert.deepEqual(runColdImage(image, compiled.metadata), [
		0, 65536,
		65536, 0,
		0, -65536,
		-65536, 0,
		0, 65536,
		46340, 46340,
		-46340, 46340,
	]);
});

test('sincos_turn32 rodata relocations survive O3 constant folding', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/sincos_turn32.lua', 'utf8');
	const entrySource = `
return require("${SINCOS_TURN32_PATH}").sincos_turn32(0)
`;
	const compiled = compileWithModule(entrySource, SINCOS_TURN32_PATH, moduleSource, 3);
	assert.deepEqual(runColdCompiled(compiled), [0, 65536]);
});

test('const function export aliases stay compile-time call targets', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/sincos_turn32.lua', 'utf8');
	const entrySource = `
local sincos_turn32<const> = require("${SINCOS_TURN32_PATH}").sincos_turn32
return sincos_turn32(0)
`;
	const compiled = compileWithModule(entrySource, SINCOS_TURN32_PATH, moduleSource, 3);
	const slotName = 'bios__util__sincos_turn32__sincos_turn32';
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === slotName), true);
	const disasm = disassembleWithoutBootVectors(compiled);
	assert.doesNotMatch(disasm, /\bGETGL\b|\bGETFIELD\b/);
	assert.deepEqual(runColdCompiled(compiled), [0, 65536]);
});

test('const function modules materialize Lua function values without runtime module tables', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/clamp.lua', 'utf8');
	const entrySource = `
local required = require("${CLAMP_PATH}")
local clamp<const> = require("${CLAMP_PATH}")
local aliased = clamp
return required(-0.25, 0, 1), aliased(1.25, 0, 1)
`;
	const compiled = compileWithModule(entrySource, CLAMP_PATH, moduleSource);
	const slotName = 'bios__util__clamp';
	assert.equal(compiled.moduleProtoMap.has(CLAMP_PATH), false);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === slotName), true);
	const disasm = disassembleWithoutBootVectors(compiled);
	assert.doesNotMatch(disasm, /\bGETGL\b|\bGETFIELD\b/);
	assert.doesNotMatch(disasm, /\bLOADNIL\b/);
	assert.deepEqual(runColdCompiled(compiled), [0, 1]);
});

test('static function values survive O3 table materialization', () => {
	const clampSource = readFileSync('machine/firmware/bios/util/clamp.lua', 'utf8');
	const entrySource = `
local clamp<const> = require("${CLAMP_PATH}")
local easing<const> = { clamp = clamp }
return easing.clamp(1.2, 0, 1)
`;
	const compiled = compileWithModule(entrySource, CLAMP_PATH, clampSource, 3);
	const slotName = 'bios__util__clamp';
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === slotName), true);
	assert.deepEqual(runColdCompiled(compiled), [1]);
});

test('cart const-function calls link to system export protos', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/rect_overlaps.lua', 'utf8');
	const module = { path: RECT_OVERLAPS_PATH, chunk: parseSource(moduleSource, `${RECT_OVERLAPS_PATH}.lua`), source: moduleSource };
	const systemCompiled = compileLuaChunkToProgram(
		parseSource('return nil', 'system.lua'),
		[module],
		{ entrySource: 'return nil' },
	);
	const cartSource = `
local rect_overlaps<const> = require("${RECT_OVERLAPS_PATH}")
return rect_overlaps(2, 2, 4, 4, 5, 5, 2, 2)
`;
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(cartSource, 'cart.lua'),
		[],
		{ entrySource: cartSource, externalModules: [module] },
	);
	const linked = linkProgramImages(
		encodeCompiledProgramImage(systemCompiled),
		systemCompiled.metadata,
		encodeCompiledProgramImage(cartCompiled),
		cartCompiled.metadata,
	);
	assert.deepEqual(runColdImage(linked.programImage, linked.metadata), [true]);
});

test('dynamic table-return function modules remain runtime modules', () => {
	const moduleSource = `
return {
	make = function()
		return {}
	end,
}
`;
	const compiled = compileWithModule('return true', 'dyn', moduleSource);
	assert.equal(compiled.moduleProtoMap.has('dyn'), true);
});

test('const function modules reject dynamic opcodes across their protos', () => {
	const moduleSource = `
return function()
	local t = {}
	return t
end
`;
	assert.throws(
		() => compileWithModule('return require("bad")()', 'bad', moduleSource),
		/Module function export 'bad:.*' emits forbidden static opcode NEWT \(table allocation\).*static-compatible bare-function modules must compile to scalar\/static code/,
	);
});
