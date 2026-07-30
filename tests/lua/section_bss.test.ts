import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import type { Value } from '../../machine/ts/machine/cpu/value';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { CART_ROM_BASE, DYNAMIC_RAM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram, encodeCompiledProgramObject, type CompiledProgram } from '../../toolchain/ts/lua/compiler';
import { readLE32 } from '../../machine/ts/common/endian';
import {
	disassembleTestBlua32Functions,
	linkTestBlua32Pair,
	linkTestSystemBlua32,
} from '../helpers/blua32';
import { materializeCpuCompletionValues } from './cpu_test_harness';

function parseSource(source: string, path: string) {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

function compileSource(source: string, path = 'section_bss.lua') {
	return compileLuaChunkToProgram(parseSource(source, path), [], { entrySource: source });
}

function constModule(path: string, source: string) {
	const declaredSource = `module<const>\n${source}`;
	return { path, chunk: parseSource(declaredSource, `${path}.lua`), source: declaredSource };
}

function compileWithConstModule(entrySource: string, modulePath: string, moduleSource: string): CompiledProgram {
	return compileLuaChunkToProgram(
		parseSource(entrySource, 'entry.lua'),
		[constModule(modulePath, moduleSource)],
		{ entrySource },
	);
}


function disassembleEntryFunction(compiled: CompiledProgram): string {
	const image = linkTestSystemBlua32(compiled);
	return disassembleTestBlua32Functions(image, [image.vectors.entryFunctionAddress]);
}

function runColdCompiled(compiled: CompiledProgram, memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes)): { memory: Memory; values: Value[]; image: ReturnType<typeof linkTestSystemBlua32>['image'] } {
	const finalized = linkTestSystemBlua32(compiled);
	memory.installSystemRom(finalized.romBytes);
	const executionAddressSpace = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, new IrqController(memory), executionAddressSpace);
	cpu.reset();
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	return { memory, values: materializeCpuCompletionValues(cpu), image: finalized.image };
}

function runCold(source: string, memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes)): { memory: Memory; values: Value[] } {
	return runColdCompiled(compileSource(source), memory);
}

test('BLua .bss declarations emit RAM section symbols and cold startup zeroes them as code', () => {
	const source = `
bss counter: word
return *counter, &counter
`;
	const compiled = compileSource(source);
	const image = encodeCompiledProgramObject(compiled);
	assert.equal(image.sections.bss.byteCount, 4);
	assert.deepEqual(image.sections.bss.symbols, [{
		name: 'module:section_bss.lua/bss:counter',
		offset: 0,
		byteCount: 4,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.every(reloc => reloc.kind === 'bss_addr'), true);

	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	memory.writeMappedU32LE(DYNAMIC_RAM_BASE, 0x11223344);
	const result = runCold(source, memory);
	assert.equal(result.memory.readMappedU32LE(DYNAMIC_RAM_BASE), 0);
	assert.deepEqual(result.values, [0, DYNAMIC_RAM_BASE]);
});

test('BLua .bss storage is consumed through typed pointers and struct fields', () => {
	const result = runCold(`
struct actor
	hp: word
	xy: word[2]
end
bss actors: actor[2]
actors[1].hp = 99
actors[1].xy[0] = 12
return actors[1].hp, actors[1].xy[0], &actors[1], sizeof(actor)
`);

	assert.deepEqual(result.values, [99, 12, DYNAMIC_RAM_BASE + 12, 12]);
});

test('const modules export .bss storage symbols without runtime module state', () => {
	const moduleSource = `
bss counter: word
return { counter = counter }
`;
	const entrySource = `
local state<const> = require("state")
local counter<const>: *word = state.counter
*counter = 77
return *counter, state.counter
`;
	const compiled = compileWithConstModule(entrySource, 'state', moduleSource);
	const image = encodeCompiledProgramObject(compiled);
	assert.equal(compiled.moduleProtoMap.has('state'), false);
	assert.equal(compiled.staticModulePaths.includes('state'), false);
	assert.deepEqual(image.sections.bss.symbols, [{
		name: 'module:state/bss:counter',
		offset: 0,
		byteCount: 4,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'bss_addr' && reloc.symbol === 'module:state/bss:counter'), true);
	const disasm = disassembleEntryFunction(compiled);
	assert.doesNotMatch(disasm, /\bCALL\b/);
	assert.doesNotMatch(disasm, /\bNEWT\b/);

	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	memory.writeMappedU32LE(DYNAMIC_RAM_BASE, 0x11223344);
	const result = runColdCompiled(compiled, memory);
	assert.deepEqual(result.values, [77, DYNAMIC_RAM_BASE]);
	assert.equal(result.memory.readMappedU32LE(DYNAMIC_RAM_BASE), 77);
});

test('const modules export function call targets without runtime module state', () => {
	const moduleSource = `
bss counter: word
local function read()
	return *counter
end
return { counter = counter, read = read }
`;
	const entrySource = `
local state<const> = require("state")
local counter<const>: *word = state.counter
*counter = 41
return state.read()
`;
	const compiled = compileWithConstModule(entrySource, 'state', moduleSource);
	const image = encodeCompiledProgramObject(compiled);
	assert.equal(compiled.moduleProtoMap.has('state'), false);
	assert.equal(compiled.staticModulePaths.includes('state'), false);
	assert.match(compiled.metadata.exportProtoIdBySlot.state__read, /\/static:/);
	const disasm = disassembleEntryFunction(compiled);
	assert.doesNotMatch(disasm, /\bNEWT\b/);
	assert.doesNotMatch(disasm, /\bGET(GL|SYS)\b.*state__read/);
	assert.equal(image.link.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'state__read'), true);

	const result = runColdCompiled(compiled);
	assert.deepEqual(result.values, [41]);
	assert.equal(result.memory.readMappedU32LE(DYNAMIC_RAM_BASE), 41);
});

test('const module function export aliases stay call targets', () => {
	const moduleSource = `
local function read()
	return 1
end
return { read = read }
`;
	const compiled = compileWithConstModule('local state<const> = require("state")\nlocal read<const> = state.read\nreturn read()', 'state', moduleSource);
	const disasm = disassembleEntryFunction(compiled);
	assert.equal(compiled.moduleProtoMap.has('state'), false);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'state__read'), true);
	assert.doesNotMatch(disasm, /\bGET(GL|SYS)\b.*state__read/);
	assert.deepEqual(runColdCompiled(compiled).values, [1]);
});

test('const module value exports are not lowered as call-target symbols', () => {
	const moduleSource = `
local answer<const> = 7
return { answer = answer }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.answer()', 'state', moduleSource),
		/value export 'answer' is not a call target/,
	);
});

test('const module function call targets cannot capture module locals', () => {
	const moduleSource = `
local value = 7
local function read()
	return value
end
return { read = read }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.read()', 'state', moduleSource),
		/captures runtime local 'value'/,
	);
});

test('const module function call targets use module compile-time constants without captures', () => {
	const moduleSource = `
local tile_size<const> = 8
local function tiles_per_row()
	return 256 // tile_size
end
return { tiles_per_row = tiles_per_row }
`;
	const result = runColdCompiled(compileWithConstModule('local state<const> = require("state")\nreturn state.tiles_per_row()', 'state', moduleSource));
	assert.deepEqual(result.values, [32]);
});

test('const module function call targets call sibling function exports through link symbols', () => {
	const moduleSource = `
bss counter: word
local function increment(value)
	return value + 1
end
local function read_next()
	return increment(*counter)
end
return { counter = counter, increment = increment, read_next = read_next }
`;
	const entrySource = `
local state<const> = require("state")
local counter<const>: *word = state.counter
*counter = 40
return state.read_next()
`;
	const compiled = compileWithConstModule(entrySource, 'state', moduleSource);
	const image = encodeCompiledProgramObject(compiled);
	assert.equal(image.link.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'state__increment'), true);
	assert.deepEqual(runColdCompiled(compiled).values, [41]);
});

test('const module function call targets reject sibling function exports used as values', () => {
	const moduleSource = `
local function increment(value)
	return value + 1
end
local function leak()
	local fn = increment
	return fn(1)
end
return { increment = increment, leak = leak }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.leak()', 'state', moduleSource),
		/cannot call a dynamic value/,
	);
});

test('const module function call targets reject table allocation opcodes', () => {
	const moduleSource = `
local function make()
	return {}
end
return { make = make }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.make()', 'state', moduleSource),
		/forbidden static opcode NEWT \(table allocation\)/,
	);
});

test('const module function call targets reject table dispatch opcodes', () => {
	const moduleSource = `
local function read(record)
	return record.value
end
return { read = read }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.read({ value = 3 })', 'state', moduleSource),
		/forbidden static opcode GETFIELD \(table dispatch\)/,
	);
});

test('const module function call targets reject runtime closure allocation opcodes', () => {
	const moduleSource = `
local function outer()
	local function inner() return 1 end
	return inner()
end
return { outer = outer }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.outer()', 'state', moduleSource),
		/forbidden static opcode CLOSURE \(runtime closure allocation\)/,
	);
});

test('const module function call targets reject vararg opcodes', () => {
	const moduleSource = `
local function first(...)
	return ...
end
return { first = first }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.first(1)', 'state', moduleSource),
		/forbidden static opcode VARARG \(vararg dispatch\)/,
	);
});

test('const module function call targets reject dynamic concat opcodes', () => {
	const moduleSource = `
local function suffix(prefix)
	return prefix .. "_x"
end
return { suffix = suffix }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.suffix("a")', 'state', moduleSource),
		/forbidden static opcode CONCAT \(dynamic string concatenation\)/,
	);
});

test('const module function call targets reject Lua object constants', () => {
	const moduleSource = `
local function label()
	return "enemy"
end
return { label = label }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.label()', 'state', moduleSource),
		/forbidden static opcode LOADK \(Lua string constant\)/,
	);
});

test('const module function call targets reject runtime globals', () => {
	const moduleSource = `
local function leaked_global()
	return print
end
return { leaked_global = leaked_global }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.leaked_global()', 'state', moduleSource),
		/forbidden static opcode GET(?:SYS|GL) \(runtime global slot\)/,
	);
});

test('const module function call targets reject dynamic calls', () => {
	const moduleSource = `
local function invoke(fn)
	return fn(1)
end
return { invoke = invoke }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.invoke(function(value) return value end)', 'state', moduleSource),
		/cannot call a dynamic value/,
	);
});

test('const module function call targets reject Lua object length', () => {
	const moduleSource = `
local function count(value)
	return #value
end
return { count = count }
`;
	assert.throws(
		() => compileWithConstModule('local state<const> = require("state")\nreturn state.count("abc")', 'state', moduleSource),
		/forbidden static opcode LEN \(Lua object length\)/,
	);
});

test('external const-module function exports remain pack-time link targets', () => {
	const moduleSource = 'local function read() return 1 end\nreturn { read = read }';
	const compiled = compileLuaChunkToProgram(
		parseSource('return require("state").read()', 'entry.lua'),
		[],
		{
			entrySource: 'return require("state").read()',
			externalModules: [constModule('state', moduleSource)],
		},
	);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'state__read'), true);
});

test('multiple const modules reserve distinct .bss storage symbols in one program', () => {
	const entrySource = `
local a<const> = require("state_a")
local b<const> = require("state_b")
local ap<const>: *word = a.counter
local bp<const>: *word = b.counter
*ap = 11
*bp = 22
return *ap, *bp, a.counter, b.counter
`;
	const compiled = compileLuaChunkToProgram(
		parseSource(entrySource, 'entry.lua'),
		[
			constModule('state_a', 'bss counter: word\nreturn { counter = counter }'),
			constModule('state_b', 'bss counter: word\nreturn { counter = counter }'),
		],
		{ entrySource },
	);
	const image = encodeCompiledProgramObject(compiled);
	assert.deepEqual(image.sections.bss.symbols, [
		{ name: 'module:state_a/bss:counter', offset: 0, byteCount: 4, alignment: 4 },
		{ name: 'module:state_b/bss:counter', offset: 4, byteCount: 4, alignment: 4 },
	]);
	const result = runColdCompiled(compiled);
	assert.deepEqual(result.values, [11, 22, DYNAMIC_RAM_BASE, DYNAMIC_RAM_BASE + 4]);
});

test('linked system and cart const-module .bss symbols resolve against their own VMA bases', () => {
	const systemSource = 'local s<const> = require("sys_state")\nreturn s.counter';
	const systemCompiled = compileLuaChunkToProgram(
		parseSource(systemSource, 'system.lua'),
		[constModule('sys_state', 'bss counter: word\nreturn { counter = counter }')],
		{ entrySource: systemSource, programDomain: 'system' },
	);
	const cartSource = 'local s<const> = require("cart_state")\nreturn s.counter';
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(cartSource, 'cart.lua'),
		[constModule('cart_state', 'bss counter: word\nreturn { counter = counter }')],
		{ entrySource: cartSource },
	);
	const finalized = linkTestBlua32Pair(systemCompiled, cartCompiled);
	assert.equal(finalized.systemImage.header.bssAddress, DYNAMIC_RAM_BASE);
	assert.equal(finalized.cartImage.header.bssAddress, DYNAMIC_RAM_BASE + 4);
	assert.equal(finalized.systemImage.header.bssByteCount, 4);
	assert.equal(finalized.cartImage.header.bssByteCount, 4);
	assert.deepEqual(encodeCompiledProgramObject(systemCompiled).sections.bss.symbols, [
		{ name: 'module:sys_state/bss:counter', offset: 0, byteCount: 4, alignment: 4 },
	]);
	assert.deepEqual(encodeCompiledProgramObject(cartCompiled).sections.bss.symbols, [
		{ name: 'module:cart_state/bss:counter', offset: 0, byteCount: 4, alignment: 4 },
	]);
	assert.equal(finalized.systemImage.constants.some(
		constant => constant === DYNAMIC_RAM_BASE,
	), true);
	assert.equal(finalized.cartImage.constants.some(
		constant => constant === DYNAMIC_RAM_BASE + 4,
	), true);
});

test('external const modules cannot declare .bss storage', () => {
	const moduleSource = 'bss counter: word\nreturn { counter = counter }';
	assert.throws(
		() => compileLuaChunkToProgram(
			parseSource('return require("state").counter', 'entry.lua'),
			[],
			{
				entrySource: 'return require("state").counter',
				externalModules: [constModule('state', moduleSource)],
			},
		),
		/Const module 'state' declares \.bss storage but is not compiled as a source module/,
	);
});



test('BLua .data declarations emit initialized RAM symbols and cold startup copies them as code', () => {
	const source = `
data counter: word = 17
return *counter, &counter
`;
	const compiled = compileSource(source, 'section_data.lua');
	const image = encodeCompiledProgramObject(compiled);
	assert.deepEqual(Array.from(image.sections.data.bytes), [17, 0, 0, 0]);
	assert.deepEqual(image.sections.data.symbols, [{
		name: 'module:section_data.lua/data:counter',
		offset: 0,
		byteCount: 4,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'data_addr' && reloc.symbol === 'module:section_data.lua/data:counter'), true);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'data_lma_addr' && reloc.symbol === 'module:section_data.lua/data:counter'), true);

	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	memory.writeMappedU32LE(DYNAMIC_RAM_BASE, 0x11223344);
	const result = runColdCompiled(compiled, memory);
	assert.deepEqual(result.values, [17, DYNAMIC_RAM_BASE]);
	assert.equal(result.memory.readMappedU32LE(DYNAMIC_RAM_BASE), 17);
});

test('BLua static declaration words remain identifiers outside declaration shape', () => {
	const result = runCold(`
local struct = { [0] = 1 }
local bss = { [0] = 2 }
local data = { [0] = 1 }
local rodata = { [0] = 4 }
struct[0] = struct[0] + 1
bss[0] = bss[0] + 1
data[0] = data[0] + 1
rodata[0] = rodata[0] + 1
return struct[0], bss[0], data[0], rodata[0]
`, new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes));
	assert.deepEqual(result.values, [2, 3, 2, 5]);
});

test('BLua .data storage is mutable through typed pointers and shifts .bss after initialized RAM', () => {
	const result = runCold(`
data value: word = 9
bss scratch: word
*scratch = *value + 5
*value = 21
return *value, *scratch, value, scratch
`);
	assert.deepEqual(result.values, [21, 14, DYNAMIC_RAM_BASE, DYNAMIC_RAM_BASE + 4]);
	assert.equal(result.memory.readMappedU32LE(DYNAMIC_RAM_BASE), 21);
	assert.equal(result.memory.readMappedU32LE(DYNAMIC_RAM_BASE + 4), 14);
});

test('const modules export .data storage symbols without runtime module state', () => {
	const moduleSource = `
data counter: word = 12
return { counter = counter }
`;
	const entrySource = `
local state<const> = require("state")
local counter<const>: *word = state.counter
local before = *counter
*counter = 88
return before, *counter, state.counter
`;
	const compiled = compileWithConstModule(entrySource, 'state', moduleSource);
	const image = encodeCompiledProgramObject(compiled);
	assert.equal(compiled.moduleProtoMap.has('state'), false);
	assert.equal(compiled.staticModulePaths.includes('state'), false);
	assert.deepEqual(image.sections.data.symbols, [{
		name: 'module:state/data:counter',
		offset: 0,
		byteCount: 4,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'data_addr' && reloc.symbol === 'module:state/data:counter'), true);
	const disasm = disassembleEntryFunction(compiled);
	assert.doesNotMatch(disasm, /\bCALL\b/);
	assert.doesNotMatch(disasm, /\bNEWT\b/);
	assert.deepEqual(runColdCompiled(compiled).values, [12, 88, DYNAMIC_RAM_BASE]);
});

test('linked system and cart const-module .data symbols resolve VMA and LMA ranges', () => {
	const systemSource = 'local s<const> = require("sys_data")\nreturn s.value';
	const systemCompiled = compileLuaChunkToProgram(
		parseSource(systemSource, 'system.lua'),
		[constModule('sys_data', 'data value: word = 10\nreturn { value = value }')],
		{ entrySource: systemSource, programDomain: 'system' },
	);
	const cartSource = 'local s<const> = require("cart_data")\nreturn s.value';
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(cartSource, 'cart.lua'),
		[constModule('cart_data', 'data value: word = 20\nreturn { value = value }')],
		{ entrySource: cartSource },
	);
	const finalized = linkTestBlua32Pair(systemCompiled, cartCompiled);
	const systemDataLma = finalized.systemImage.header.dataLoadAddress;
	const cartDataLma = finalized.cartImage.header.dataLoadAddress;
	assert.equal(finalized.systemImage.header.dataAddress, DYNAMIC_RAM_BASE);
	assert.equal(finalized.cartImage.header.dataAddress, DYNAMIC_RAM_BASE + 4);
	assert.equal(finalized.cartImage.header.bssAddress, DYNAMIC_RAM_BASE + 8);
	assert.deepEqual(Array.from(finalized.systemImage.dataLoadBytes), [10, 0, 0, 0]);
	assert.deepEqual(Array.from(finalized.cartImage.dataLoadBytes), [20, 0, 0, 0]);
	assert.deepEqual(encodeCompiledProgramObject(systemCompiled).sections.data.symbols, [
		{ name: 'module:sys_data/data:value', offset: 0, byteCount: 4, alignment: 4 },
	]);
	assert.deepEqual(encodeCompiledProgramObject(cartCompiled).sections.data.symbols, [
		{ name: 'module:cart_data/data:value', offset: 0, byteCount: 4, alignment: 4 },
	]);
	assert.equal(finalized.systemImage.constants.some(
		constant => constant === DYNAMIC_RAM_BASE,
	), true);
	assert.equal(finalized.cartImage.constants.some(
		constant => constant === DYNAMIC_RAM_BASE + 4,
	), true);
	assert.equal(finalized.systemImage.constants.some(
		constant => constant === systemDataLma,
	), true);
	assert.equal(finalized.cartImage.constants.some(
		constant => constant === cartDataLma,
	), true);
});

test('external const modules cannot declare .data storage', () => {
	const moduleSource = 'data counter: word = 1\nreturn { counter = counter }';
	assert.throws(
		() => compileLuaChunkToProgram(
			parseSource('return require("state").counter', 'entry.lua'),
			[],
			{
				entrySource: 'return require("state").counter',
				externalModules: [constModule('state', moduleSource)],
			},
		),
		/Const module 'state' declares \.data storage but is not compiled as a source module/,
	);
});

test('BLua .rodata declarations emit CPU-readable ROM section symbols', () => {
	const source = `
rodata values: word[3] = { 11, 22, 33 }
return values[0], values[1], values[2], values
`;
	const compiled = compileSource(source, 'section_rodata.lua');
	const image = encodeCompiledProgramObject(compiled);
	assert.deepEqual(image.sections.rodata.symbols, [{
		name: 'module:section_rodata.lua/rodata:values',
		offset: 0,
		byteCount: 12,
		alignment: 4,
	}]);
	assert.deepEqual(Array.from(image.sections.rodata.bytes), [11, 0, 0, 0, 22, 0, 0, 0, 33, 0, 0, 0]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'rodata_addr' && reloc.symbol === 'module:section_rodata.lua/rodata:values'), true);
	const result = runColdCompiled(compiled);
	assert.deepEqual(result.values, [11, 22, 33, result.image.header.rodataAddress]);
});

test('BLua .rodata typed storage preserves byte and halfword layout', () => {
	const source = `
rodata bytes: u8[3] = { 1, 2, 3 }
rodata halves: u16[2] = { 258, 772 }
return bytes[0], bytes[1], bytes[2], halves[0], halves[1], bytes, halves
`;
	const compiled = compileSource(source, 'section_rodata_widths.lua');
	const image = encodeCompiledProgramObject(compiled);
	assert.deepEqual(Array.from(image.sections.rodata.bytes), [1, 2, 3, 0, 2, 1, 4, 3]);
	assert.deepEqual(image.sections.rodata.symbols, [
		{ name: 'module:section_rodata_widths.lua/rodata:bytes', offset: 0, byteCount: 3, alignment: 1 },
		{ name: 'module:section_rodata_widths.lua/rodata:halves', offset: 4, byteCount: 4, alignment: 2 },
	]);
	const result = runColdCompiled(compiled);
	const bytesAddress = result.image.header.rodataAddress;
	assert.deepEqual(result.values, [1, 2, 3, 258, 772, bytesAddress, bytesAddress + 4]);
});

test('BLua static storage derives dimensions and initializer values from local constants', () => {
	const result = runCold(`
local count<const> = 3
rodata values: word[count] = { count, count + 1, count + 2 }
return #values, values[0], values[1], values[2]
`);
	assert.deepEqual(result.values, [3, 3, 4, 5]);
});

test('BLua static storage derives dimensions from const-module fields', () => {
	const compiled = compileWithConstModule(`
local layout<const> = require('layout')
local cell_count<const> = layout.columns * layout.rows
bss cells: word[cell_count]
return #cells
`, 'layout', `
local columns<const> = 4
local rows<const> = 3
return { columns = columns, rows = rows }
`);
	assert.deepEqual(runColdCompiled(compiled).values, [12]);
});

test('BLua .rodata records infer array length and load immutable string fields without tables', () => {
	const source = `
struct monitor_command
	name: string
	usage: string
	kind: u8
end
rodata commands: monitor_command[] = {
	{ name = 'CLS', usage = 'CLS', kind = 1 },
	{ name = 'MEM', usage = 'MEM <HEX ADDRESS> [WORDS]', kind = 2 },
}
return #commands, commands[0].name == 'CLS', #commands[1].usage, commands[1].kind, sizeof(monitor_command)
`;
	const compiled = compileSource(source, 'rodata_records.lua');
	const image = encodeCompiledProgramObject(compiled);
	assert.deepEqual(image.link.rodataConstRelocs, [
		{ byteOffset: 0, constIndex: readLE32(image.sections.rodata.bytes, 0) },
		{ byteOffset: 4, constIndex: readLE32(image.sections.rodata.bytes, 4) },
		{ byteOffset: 12, constIndex: readLE32(image.sections.rodata.bytes, 12) },
		{ byteOffset: 16, constIndex: readLE32(image.sections.rodata.bytes, 16) },
	]);
	const disassembly = disassembleEntryFunction(compiled);
	assert.match(disassembly, /LOADKR/);
	assert.doesNotMatch(disassembly, /\bNEWT\b/);
	assert.deepEqual(runColdCompiled(compiled).values, [2, true, 25, 2, 12]);
});

test('cart linking remaps const references stored in physical cart .rodata', () => {
	const compileRecord = (text: string, path: string): CompiledProgram => compileSource(`
struct label
	text: string
end
rodata labels: label[] = { { text = '${text}' } }
return labels[0].text
`, path);
	const system = compileRecord('SYSTEM', 'system_rodata_record.lua');
	const cart = compileRecord('CART', 'cart_rodata_record.lua');
	const finalized = linkTestBlua32Pair(system, cart);
	const systemConstIndex = readLE32(finalized.systemImage.rodataBytes, 0);
	const systemConstant = finalized.systemImage.constants[systemConstIndex];
	assert.equal(systemConstant, 'SYSTEM');
	const cartConstIndex = readLE32(finalized.cartImage.rodataBytes, 0);
	const cartConstant = finalized.cartImage.constants[cartConstIndex];
	assert.equal(cartConstant, 'CART');
});

test('const modules export .rodata storage symbols without runtime module state', () => {
	const moduleSource = `
rodata values: word[2] = { 5, 6 }
return { values = values }
`;
	const entrySource = `
local data<const> = require("data")
local values<const>: *word = data.values
return values[0], values[1], data.values
`;
	const compiled = compileWithConstModule(entrySource, 'data', moduleSource);
	const image = encodeCompiledProgramObject(compiled);
	assert.equal(compiled.moduleProtoMap.has('data'), false);
	assert.equal(compiled.staticModulePaths.includes('data'), false);
	assert.deepEqual(image.sections.rodata.symbols, [{
		name: 'module:data/rodata:values',
		offset: 0,
		byteCount: 8,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'rodata_addr' && reloc.symbol === 'module:data/rodata:values'), true);
	const disasm = disassembleEntryFunction(compiled);
	assert.doesNotMatch(disasm, /\bCALL\b/);
	assert.doesNotMatch(disasm, /\bNEWT\b/);
	const result = runColdCompiled(compiled);
	assert.deepEqual(result.values, [5, 6, result.image.header.rodataAddress]);
});

test('linked system and cart const-module .rodata symbols resolve against their ROM ranges', () => {
	const systemSource = 'local s<const> = require("sys_data")\nreturn s.values';
	const systemCompiled = compileLuaChunkToProgram(
		parseSource(systemSource, 'system.lua'),
		[constModule('sys_data', 'rodata values: word[1] = { 10 }\nreturn { values = values }')],
		{ entrySource: systemSource, programDomain: 'system' },
	);
	const cartSource = 'local s<const> = require("cart_data")\nreturn s.values';
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(cartSource, 'cart.lua'),
		[constModule('cart_data', 'rodata values: word[1] = { 20 }\nreturn { values = values }')],
		{ entrySource: cartSource },
	);
	const finalized = linkTestBlua32Pair(systemCompiled, cartCompiled);
	const systemRodataAddr = finalized.systemImage.header.rodataAddress;
	const cartRodataAddr = finalized.cartImage.header.rodataAddress;
	assert.deepEqual(Array.from(finalized.systemImage.rodataBytes), [10, 0, 0, 0]);
	assert.deepEqual(Array.from(finalized.cartImage.rodataBytes), [20, 0, 0, 0]);
	assert.deepEqual(encodeCompiledProgramObject(systemCompiled).sections.rodata.symbols, [
		{ name: 'module:sys_data/rodata:values', offset: 0, byteCount: 4, alignment: 4 },
	]);
	assert.deepEqual(encodeCompiledProgramObject(cartCompiled).sections.rodata.symbols, [
		{ name: 'module:cart_data/rodata:values', offset: 0, byteCount: 4, alignment: 4 },
	]);
	assert.equal(finalized.systemImage.constants.some(
		constant => constant === systemRodataAddr,
	), true);
	assert.equal(finalized.cartImage.constants.some(
		constant => constant === cartRodataAddr,
	), true);
});

test('external const modules cannot declare .rodata storage', () => {
	const moduleSource = 'rodata values: word[1] = { 1 }\nreturn { values = values }';
	assert.throws(
		() => compileLuaChunkToProgram(
			parseSource('return require("data").values', 'entry.lua'),
			[],
			{
				entrySource: 'return require("data").values',
				externalModules: [constModule('data', moduleSource)],
			},
		),
		/Const module 'data' declares \.rodata storage but is not compiled as a source module/,
	);
});

test('BLua .rodata storage rejects writes at compile time', () => {
	assert.throws(
		() => compileSource('rodata values: word[1] = { 1 }\nvalues[0] = 2\nreturn values[0]', 'rodata_write.lua'),
		/Cannot assign to \.rodata storage/,
	);
});
