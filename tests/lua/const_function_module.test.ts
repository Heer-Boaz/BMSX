import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { readLE32 } from '../../machine/ts/common/endian';
import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import {
	CPU,
	RunResult,
} from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import type { ProgramMetadata } from '../../toolchain/ts/lua/compiler/program';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram, encodeCompiledProgramObject, type CompiledProgram } from '../../toolchain/ts/lua/compiler';
import type { OptimizationLevel } from '../../toolchain/ts/lua/compiler/optimizer';
import {
	disassembleTestBlua32Functions,
	linkTestBlua32Pair,
	linkTestSystemBlua32,
	runCompiledTestSystem,
} from '../helpers/blua32';

const BOOL01_PATH = 'cartlib/util/bool01';
const DIV_TOWARD_ZERO_PATH = 'cartlib/util/div_toward_zero';
const ROL8_PATH = 'cartlib/util/rol8';
const ROUND_TO_NEAREST_PATH = 'bios/util/round_to_nearest';
const CLAMP_PATH = 'cartlib/util/clamp';
const RECT_OVERLAPS_PATH = 'cartlib/util/rect_overlaps';
const SINCOS_TURN32_PATH = 'bios/util/sincos_turn32';
const STATIC_FORBIDDEN_OPCODE_PATTERN = /\b(?:GETSYS|SETSYS|GETGL|SETGL|NEWT|GETT|SETT|GETI|SETI|GETFIELD|SETFIELD|SELF|LEN|CLOSURE|VARARG|CONCAT|CONCATN)\b/;
const CART_BOOT_SOURCE = `cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]`;

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

function runColdCompiled(compiled: CompiledProgram) {
	const cpu = runCompiledTestSystem(compiled, 100000);
	return Array.from(cpu.completionValues);
}

function runColdPair(systemCompiled: CompiledProgram, cartCompiled: CompiledProgram) {
	const finalized = linkTestBlua32Pair(systemCompiled, cartCompiled);
	const memory = new Memory({ systemRom: finalized.systemRomBytes, cartridgeSlots: cartridgeSlots(finalized.cartRomBytes) }, PSX_MACHINE_SPEC.ramBytes);
	const executionAddressSpace = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, new IrqController(memory), executionAddressSpace);
	cpu.reset();
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	return Array.from(cpu.completionValues);
}

function disassembleConstExport(compiled: CompiledProgram, slotName: string): string {
	const functionId = compiled.metadata.exportProtoIdBySlot[slotName];
	const image = linkTestSystemBlua32(compiled);
	const functionIndex = image.symbols.metadata.functionIds.indexOf(functionId);
	assert.notEqual(functionIndex, -1);
	return disassembleTestBlua32Functions(image, [image.symbols.functionAddresses[functionIndex]]);
}

test('rect_overlaps compiles as a const function module and calls through export-proto', () => {
	const moduleSource = readFileSync('cartlib/util/rect_overlaps.lua', 'utf8');
	const entrySource = `
local rect_overlaps<const> = require("${RECT_OVERLAPS_PATH}")
return rect_overlaps(0, 0, 10, 10, 5, 5, 1, 1), rect_overlaps(0, 0, 2, 2, 3, 3, 1, 1)
`;
	const compiled = compileWithModule(entrySource, RECT_OVERLAPS_PATH, moduleSource);
	assert.equal(compiled.moduleProtoMap.has(RECT_OVERLAPS_PATH), false);
	assert.equal(compiled.metadata.exportProtoIdBySlot.cartlib__util__rect_overlaps?.includes('/static:'), true);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'cartlib__util__rect_overlaps'), true);
	const disasm = disassembleConstExport(compiled, 'cartlib__util__rect_overlaps');
	assert.doesNotMatch(disasm, STATIC_FORBIDDEN_OPCODE_PATTERN);
	assert.deepEqual(runColdCompiled(compiled), [true, false]);
});

test('clamp compiles as a const function module and calls through export-proto', () => {
	const moduleSource = readFileSync('cartlib/util/clamp.lua', 'utf8');
	const entrySource = `
local clamp<const> = require("${CLAMP_PATH}")
return clamp(-2, 0, 10), clamp(7, 0, 10), clamp(12, 0, 10)
`;
	const compiled = compileWithModule(entrySource, CLAMP_PATH, moduleSource);
	assert.equal(compiled.moduleProtoMap.has(CLAMP_PATH), false);
	assert.equal(compiled.metadata.exportProtoIdBySlot.cartlib__util__clamp?.includes('/static:'), true);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'cartlib__util__clamp'), true);
	const disasm = disassembleConstExport(compiled, 'cartlib__util__clamp');
	assert.doesNotMatch(disasm, STATIC_FORBIDDEN_OPCODE_PATTERN);
	assert.deepEqual(runColdCompiled(compiled), [0, 7, 10]);
});

test('remaining scalar helpers compile as const function modules and call through export-proto', () => {
	const cases = [
		{
			path: BOOL01_PATH,
			name: 'bool01',
			sourcePath: 'cartlib/util/bool01.lua',
			entry: `
local bool01<const> = require("${BOOL01_PATH}")
return bool01(true), bool01(false)
`,
			expected: [1, 0],
		},
		{
			path: DIV_TOWARD_ZERO_PATH,
			name: 'div_toward_zero',
			sourcePath: 'cartlib/util/div_toward_zero.lua',
			entry: `
local div_toward_zero<const> = require("${DIV_TOWARD_ZERO_PATH}")
return div_toward_zero(7, 3), div_toward_zero(-7, 3)
`,
			expected: [2, -2],
		},
		{
			path: ROL8_PATH,
			name: 'rol8',
			sourcePath: 'cartlib/util/rol8.lua',
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
		const slotName = testCase.path.replaceAll('/', '__');
		assert.equal(compiled.moduleProtoMap.has(testCase.path), false);
		assert.equal(compiled.metadata.exportProtoIdBySlot[slotName]?.includes('/static:'), true);
		assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === slotName), true);
		const disasm = disassembleConstExport(compiled, slotName);
		assert.doesNotMatch(disasm, STATIC_FORBIDDEN_OPCODE_PATTERN);
		assert.deepEqual(runColdCompiled(compiled), testCase.expected);
	}
});

test('sincos_turn32 is a const function module backed by visible rodata', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/sincos_turn32.lua', 'utf8');
	const entrySource = `
local s0<const>, c0<const> = require("${SINCOS_TURN32_PATH}")(0)
local s90<const>, c90<const> = require("${SINCOS_TURN32_PATH}")(1073741824)
local s180<const>, c180<const> = require("${SINCOS_TURN32_PATH}")(2147483648)
local s270<const>, c270<const> = require("${SINCOS_TURN32_PATH}")(3221225472)
local s360<const>, c360<const> = require("${SINCOS_TURN32_PATH}")(4294967296)
local s45<const>, c45<const> = require("${SINCOS_TURN32_PATH}")(536870912)
local sn45<const>, cn45<const> = require("${SINCOS_TURN32_PATH}")(-536870912)
return s0, c0, s90, c90, s180, c180, s270, c270, s360, c360, s45, c45, sn45, cn45
`;
	const compiled = compileWithModule(entrySource, SINCOS_TURN32_PATH, moduleSource);
	const image = encodeCompiledProgramObject(compiled);
	const slotName = 'bios__util__sincos_turn32';
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
	const disasm = disassembleConstExport(compiled, slotName);
	assert.doesNotMatch(disasm, STATIC_FORBIDDEN_OPCODE_PATTERN);
	assert.deepEqual(runColdCompiled(compiled), [
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
return require("${SINCOS_TURN32_PATH}")(0)
`;
	const compiled = compileWithModule(entrySource, SINCOS_TURN32_PATH, moduleSource, 3);
	assert.deepEqual(runColdCompiled(compiled), [0, 65536]);
});

test('const function export aliases stay compile-time call targets', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/sincos_turn32.lua', 'utf8');
	const entrySource = `
local sincos_turn32<const> = require("${SINCOS_TURN32_PATH}")
return sincos_turn32(0)
`;
	const compiled = compileWithModule(entrySource, SINCOS_TURN32_PATH, moduleSource, 3);
	const slotName = 'bios__util__sincos_turn32';
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === slotName), true);
	const disasm = disassembleConstExport(compiled, slotName);
	assert.doesNotMatch(disasm, /\bGETGL\b|\bGETFIELD\b/);
	assert.deepEqual(runColdCompiled(compiled), [0, 65536]);
});

test('const function modules do not materialize Lua function values', () => {
	const moduleSource = readFileSync('cartlib/util/clamp.lua', 'utf8');
	assert.throws(
		() => compileWithModule(`
local required = require("${CLAMP_PATH}")
return required(-0.25, 0, 1)
`, CLAMP_PATH, moduleSource),
		/call target, not a Lua runtime value/,
	);
	assert.throws(
		() => compileWithModule(`
local clamp<const> = require("${CLAMP_PATH}")
local aliased = clamp
return aliased(1.25, 0, 1)
`, CLAMP_PATH, moduleSource),
		/call target, not a Lua runtime value/,
	);
});

test('static function exports do not enter const table materialization', () => {
	const clampSource = readFileSync('cartlib/util/clamp.lua', 'utf8');
	assert.throws(
		() => compileWithModule(`
local clamp<const> = require("${CLAMP_PATH}")
local easing<const> = { clamp = clamp }
return easing.clamp(1.2, 0, 1)
`, CLAMP_PATH, clampSource, 3),
		/call target, not a Lua runtime value/,
	);
});

test('cart const-function calls link to system export protos', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/round_to_nearest.lua', 'utf8');
	const module = { path: ROUND_TO_NEAREST_PATH, chunk: parseSource(moduleSource, `${ROUND_TO_NEAREST_PATH}.lua`), source: moduleSource };
	const systemCompiled = compileLuaChunkToProgram(
		parseSource(CART_BOOT_SOURCE, 'system.lua'),
		[module],
		{ entrySource: CART_BOOT_SOURCE, programDomain: 'system' },
	);
	const cartSource = `
local round_to_nearest<const> = require("${ROUND_TO_NEAREST_PATH}")
return round_to_nearest(1.6)
`;
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(cartSource, 'cart.lua'),
		[],
		{ entrySource: cartSource, externalModules: [module] },
	);
	assert.deepEqual(runColdPair(systemCompiled, cartCompiled), [2]);
});

test('installed const-function modules stay call targets without Lua value materialization', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/round_to_nearest.lua', 'utf8');
	const module = { path: ROUND_TO_NEAREST_PATH, chunk: parseSource(moduleSource, `${ROUND_TO_NEAREST_PATH}.lua`), source: moduleSource };
	const systemCompiled = compileLuaChunkToProgram(
		parseSource(CART_BOOT_SOURCE, 'system.lua'),
		[module],
		{ entrySource: CART_BOOT_SOURCE, programDomain: 'system' },
	);
	const source = `
local round_to_nearest<const> = require("${ROUND_TO_NEAREST_PATH}")
return round_to_nearest(1.6)
`;
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(source, 'cart.lua'),
		[],
		{ entrySource: source, externalModules: [module], programDomain: 'cart' },
	);
	assert.deepEqual(runColdPair(systemCompiled, cartCompiled), [2]);
	const dynamicSource = `
local round_to_nearest<const> = require("${ROUND_TO_NEAREST_PATH}")
local dynamic = round_to_nearest
return dynamic(1.6)
`;
	assert.throws(
		() => compileLuaChunkToProgram(
			parseSource(dynamicSource, 'cart.lua'),
			[],
			{ entrySource: dynamicSource, externalModules: [module], programDomain: 'cart' },
		),
		/call target, not a Lua runtime value/,
	);
});

test('installed nested const-function modules reject root runtime values', () => {
	const modulePath = 'bios/util/nested_clamp';
	const moduleSource = `
module<const>
local function clamp(value, low, high)
	if value < low then return low end
	if value > high then return high end
	return value
end
return { math = { clamp = clamp } }
`;
	const module = { path: modulePath, chunk: parseSource(moduleSource, `${modulePath}.lua`), source: moduleSource };
	const systemCompiled = compileLuaChunkToProgram(
		parseSource(CART_BOOT_SOURCE, 'system.lua'),
		[module],
		{ entrySource: CART_BOOT_SOURCE, programDomain: 'system' },
	);
	const callSource = `
local api<const> = require("${modulePath}")
return api.math.clamp(12, 0, 10)
`;
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(callSource, 'cart.lua'),
		[],
		{ entrySource: callSource, externalModules: [module], programDomain: 'cart' },
	);
	assert.deepEqual(runColdPair(systemCompiled, cartCompiled), [10]);
	const rootSource = `return require("${modulePath}")`;
	assert.throws(
		() => compileLuaChunkToProgram(
			parseSource(rootSource, 'cart.lua'),
			[],
			{ entrySource: rootSource, externalModules: [module], programDomain: 'cart' },
		),
		/Module 'bios\/util\/nested_clamp' root is compile-time only/,
	);
	const aliasSource = `
local api<const> = require("${modulePath}")
local dynamic = api
return dynamic
`;
	assert.throws(
		() => compileLuaChunkToProgram(
			parseSource(aliasSource, 'cart.lua'),
			[],
			{ entrySource: aliasSource, externalModules: [module], programDomain: 'cart' },
		),
		/Module 'bios\/util\/nested_clamp' root is compile-time only/,
	);
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
		/Static function export '.*' cannot emit forbidden static opcode NEWT \(table allocation\)/,
	);
});
