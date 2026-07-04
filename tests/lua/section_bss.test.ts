import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { CPU, RunResult, type Value } from '../../machine/ts/machine/cpu/cpu';
import { disassembleProgram } from '../../machine/ts/machine/cpu/disassembler';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PROGRAM_STATIC_RAM_BASE, PROGRAM_ROM_BASE } from '../../machine/ts/machine/memory/map';
import { compileLuaChunkToProgram, encodeCompiledProgramImage, type CompiledProgram } from '../../machine/ts/machine/program/compiler';
import { inflateExecutableProgramImage, linkProgramImages } from '../../machine/ts/machine/program/linker';

function parseSource(source: string, path: string) {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

function compileSource(source: string, path = 'section_bss.lua') {
	return compileLuaChunkToProgram(parseSource(source, path), [], { entrySource: source });
}

function compileWithConstModule(entrySource: string, modulePath: string, moduleSource: string): CompiledProgram {
	return compileLuaChunkToProgram(
		parseSource(entrySource, 'entry.lua'),
		[{ path: modulePath, chunk: parseSource(moduleSource, `${modulePath}.lua`), source: moduleSource }],
		{ entrySource, constModulePaths: [modulePath] },
	);
}


function disassembleProgramWithoutIrqVector(compiled: CompiledProgram): string {
	return disassembleProgram(compiled.program, compiled.metadata, { showProtoHeaders: true })
		.split('\\n\\n')
		.filter(block => !block.includes('/irq entry='))
		.join('\\n\\n');
}

function runColdCompiled(compiled: CompiledProgram, memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) })): { memory: Memory; values: Value[] } {
	const image = encodeCompiledProgramImage(compiled);
	const cpu = new CPU(memory);
	cpu.setProgram(inflateExecutableProgramImage(image), image.link.symbols, compiled.metadata);
	cpu.start(image.vectors.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	cpu.start(image.vectors.resetProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	return { memory, values: Array.from(cpu.lastReturnValues) };
}

function runCold(source: string, memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) })): { memory: Memory; values: Value[] } {
	return runColdCompiled(compileSource(source), memory);
}

test('BLua .bss declarations emit RAM section symbols and cold startup zeroes them as code', () => {
	const source = `
bss counter: word
return *counter, &counter
`;
	const compiled = compileSource(source);
	const image = encodeCompiledProgramImage(compiled);
	assert.equal(image.sections.bss.byteCount, 4);
	assert.deepEqual(image.sections.bss.symbols, [{
		name: 'module:section_bss.lua/bss:counter',
		offset: 0,
		byteCount: 4,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.every(reloc => reloc.kind === 'bss_addr'), true);

	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE, 0x11223344);
	const result = runCold(source, memory);
	assert.equal(result.memory.readMappedU32LE(PROGRAM_STATIC_RAM_BASE), 0);
	assert.deepEqual(result.values, [0, PROGRAM_STATIC_RAM_BASE]);
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

	assert.deepEqual(result.values, [99, 12, PROGRAM_STATIC_RAM_BASE + 12, 12]);
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
	const image = encodeCompiledProgramImage(compiled);
	assert.equal(compiled.moduleProtoMap.has('state'), false);
	assert.equal(compiled.staticModulePaths.includes('state'), false);
	assert.deepEqual(image.sections.bss.symbols, [{
		name: 'module:state/bss:counter',
		offset: 0,
		byteCount: 4,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'bss_addr' && reloc.symbol === 'module:state/bss:counter'), true);
	const disasm = disassembleProgramWithoutIrqVector(compiled);
	assert.doesNotMatch(disasm, /\bCALL\b/);
	assert.doesNotMatch(disasm, /\bNEWT\b/);

	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE, 0x11223344);
	const result = runColdCompiled(compiled, memory);
	assert.deepEqual(result.values, [77, PROGRAM_STATIC_RAM_BASE]);
	assert.equal(result.memory.readMappedU32LE(PROGRAM_STATIC_RAM_BASE), 77);
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
	const image = encodeCompiledProgramImage(compiled);
	assert.equal(compiled.moduleProtoMap.has('state'), false);
	assert.equal(compiled.staticModulePaths.includes('state'), false);
	assert.match(compiled.metadata.exportProtoIdBySlot.state__read, /\/static:/);
	const disasm = disassembleProgramWithoutIrqVector(compiled);
	assert.doesNotMatch(disasm, /\bNEWT\b/);
	assert.doesNotMatch(disasm, /\bGET(GL|SYS)\b.*state__read/);
	assert.equal(image.link.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'state__read'), true);

	const result = runColdCompiled(compiled);
	assert.deepEqual(result.values, [41]);
	assert.equal(result.memory.readMappedU32LE(PROGRAM_STATIC_RAM_BASE), 41);
});

test('const module function export aliases stay call targets', () => {
	const moduleSource = `
local function read()
	return 1
end
return { read = read }
`;
	const compiled = compileWithConstModule('local state<const> = require("state")\nlocal read<const> = state.read\nreturn read()', 'state', moduleSource);
	const disasm = disassembleProgramWithoutIrqVector(compiled);
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
	const image = encodeCompiledProgramImage(compiled);
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

test('external const modules cannot export function call targets', () => {
	const moduleSource = 'local function read() return 1 end\nreturn { read = read }';
	assert.throws(
		() => compileLuaChunkToProgram(
			parseSource('return require("state").read()', 'entry.lua'),
			[],
			{
				entrySource: 'return require("state").read()',
				externalModules: [{ path: 'state', chunk: parseSource(moduleSource, 'state.lua'), source: moduleSource }],
				constModulePaths: ['state'],
			},
		),
		/Const module 'state' exports function call targets but is not compiled as a source module/,
	);
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
			{ path: 'state_a', chunk: parseSource('bss counter: word\nreturn { counter = counter }', 'state_a.lua'), source: 'bss counter: word\nreturn { counter = counter }' },
			{ path: 'state_b', chunk: parseSource('bss counter: word\nreturn { counter = counter }', 'state_b.lua'), source: 'bss counter: word\nreturn { counter = counter }' },
		],
		{ entrySource, constModulePaths: ['state_a', 'state_b'] },
	);
	const image = encodeCompiledProgramImage(compiled);
	assert.deepEqual(image.sections.bss.symbols, [
		{ name: 'module:state_a/bss:counter', offset: 0, byteCount: 4, alignment: 4 },
		{ name: 'module:state_b/bss:counter', offset: 4, byteCount: 4, alignment: 4 },
	]);
	const result = runColdCompiled(compiled);
	assert.deepEqual(result.values, [11, 22, PROGRAM_STATIC_RAM_BASE, PROGRAM_STATIC_RAM_BASE + 4]);
});

test('linked system and cart const-module .bss symbols resolve against their own VMA bases', () => {
	const systemSource = 'local s<const> = require("sys_state")\nreturn s.counter';
	const systemCompiled = compileLuaChunkToProgram(
		parseSource(systemSource, 'system.lua'),
		[{ path: 'sys_state', chunk: parseSource('bss counter: word\nreturn { counter = counter }', 'sys_state.lua'), source: 'bss counter: word\nreturn { counter = counter }' }],
		{ entrySource: systemSource, constModulePaths: ['sys_state'] },
	);
	const cartSource = 'local s<const> = require("cart_state")\nreturn s.counter';
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(cartSource, 'cart.lua'),
		[{ path: 'cart_state', chunk: parseSource('bss counter: word\nreturn { counter = counter }', 'cart_state.lua'), source: 'bss counter: word\nreturn { counter = counter }' }],
		{ entrySource: cartSource, constModulePaths: ['cart_state'] },
	);
	const linked = linkProgramImages(
		encodeCompiledProgramImage(systemCompiled),
		systemCompiled.metadata,
		encodeCompiledProgramImage(cartCompiled),
		cartCompiled.metadata,
	);
	assert.equal(linked.systemBssBaseAddress, PROGRAM_STATIC_RAM_BASE);
	assert.equal(linked.cartBssBaseAddress, PROGRAM_STATIC_RAM_BASE + 4);
	assert.equal(linked.programImage.sections.bss.byteCount, 8);
	assert.deepEqual(linked.programImage.sections.bss.symbols, [
		{ name: 'module:sys_state/bss:counter', offset: 0, byteCount: 4, alignment: 4 },
		{ name: 'module:cart_state/bss:counter', offset: 4, byteCount: 4, alignment: 4 },
	]);
	assert.equal(linked.programImage.sections.rodata.constPool.includes(PROGRAM_STATIC_RAM_BASE), true);
	assert.equal(linked.programImage.sections.rodata.constPool.includes(PROGRAM_STATIC_RAM_BASE + 4), true);
	assert.deepEqual(linked.programImage.link.constValueRelocs, []);
});

test('external const modules cannot declare .bss storage', () => {
	const moduleSource = 'bss counter: word\nreturn { counter = counter }';
	assert.throws(
		() => compileLuaChunkToProgram(
			parseSource('return require("state").counter', 'entry.lua'),
			[],
			{
				entrySource: 'return require("state").counter',
				externalModules: [{ path: 'state', chunk: parseSource(moduleSource, 'state.lua'), source: moduleSource }],
				constModulePaths: ['state'],
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
	const image = encodeCompiledProgramImage(compiled);
	assert.deepEqual(Array.from(image.sections.data.bytes), [17, 0, 0, 0]);
	assert.deepEqual(image.sections.data.symbols, [{
		name: 'module:section_data.lua/data:counter',
		offset: 0,
		byteCount: 4,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'data_addr' && reloc.symbol === 'module:section_data.lua/data:counter'), true);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'data_lma_addr' && reloc.symbol === 'module:section_data.lua/data:counter'), true);

	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	memory.writeMappedU32LE(PROGRAM_STATIC_RAM_BASE, 0x11223344);
	const result = runColdCompiled(compiled, memory);
	assert.deepEqual(result.values, [17, PROGRAM_STATIC_RAM_BASE]);
	assert.equal(result.memory.readMappedU32LE(PROGRAM_STATIC_RAM_BASE), 17);
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
`, new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) }));
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
	assert.deepEqual(result.values, [21, 14, PROGRAM_STATIC_RAM_BASE, PROGRAM_STATIC_RAM_BASE + 4]);
	assert.equal(result.memory.readMappedU32LE(PROGRAM_STATIC_RAM_BASE), 21);
	assert.equal(result.memory.readMappedU32LE(PROGRAM_STATIC_RAM_BASE + 4), 14);
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
	const image = encodeCompiledProgramImage(compiled);
	assert.equal(compiled.moduleProtoMap.has('state'), false);
	assert.equal(compiled.staticModulePaths.includes('state'), false);
	assert.deepEqual(image.sections.data.symbols, [{
		name: 'module:state/data:counter',
		offset: 0,
		byteCount: 4,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'data_addr' && reloc.symbol === 'module:state/data:counter'), true);
	const disasm = disassembleProgramWithoutIrqVector(compiled);
	assert.doesNotMatch(disasm, /\bCALL\b/);
	assert.doesNotMatch(disasm, /\bNEWT\b/);
	assert.deepEqual(runColdCompiled(compiled).values, [12, 88, PROGRAM_STATIC_RAM_BASE]);
});

test('linked system and cart const-module .data symbols resolve VMA and LMA ranges', () => {
	const systemSource = 'local s<const> = require("sys_data")\nreturn s.value';
	const systemCompiled = compileLuaChunkToProgram(
		parseSource(systemSource, 'system.lua'),
		[{ path: 'sys_data', chunk: parseSource('data value: word = 10\nreturn { value = value }', 'sys_data.lua'), source: 'data value: word = 10\nreturn { value = value }' }],
		{ entrySource: systemSource, constModulePaths: ['sys_data'] },
	);
	const cartSource = 'local s<const> = require("cart_data")\nreturn s.value';
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(cartSource, 'cart.lua'),
		[{ path: 'cart_data', chunk: parseSource('data value: word = 20\nreturn { value = value }', 'cart_data.lua'), source: 'data value: word = 20\nreturn { value = value }' }],
		{ entrySource: cartSource, constModulePaths: ['cart_data'] },
	);
	const linked = linkProgramImages(
		encodeCompiledProgramImage(systemCompiled),
		systemCompiled.metadata,
		encodeCompiledProgramImage(cartCompiled),
		cartCompiled.metadata,
	);
	const systemDataLma = PROGRAM_ROM_BASE + linked.programImage.sections.text.code.byteLength + linked.programImage.sections.rodata.bytes.byteLength;
	const cartDataLma = systemDataLma + 4;
	assert.equal(linked.systemDataBaseAddress, PROGRAM_STATIC_RAM_BASE);
	assert.equal(linked.cartDataBaseAddress, PROGRAM_STATIC_RAM_BASE + 4);
	assert.equal(linked.systemBssBaseAddress, PROGRAM_STATIC_RAM_BASE + 8);
	assert.deepEqual(Array.from(linked.programImage.sections.data.bytes), [10, 0, 0, 0, 20, 0, 0, 0]);
	assert.deepEqual(linked.programImage.sections.data.symbols, [
		{ name: 'module:sys_data/data:value', offset: 0, byteCount: 4, alignment: 4 },
		{ name: 'module:cart_data/data:value', offset: 4, byteCount: 4, alignment: 4 },
	]);
	assert.equal(linked.programImage.sections.rodata.constPool.includes(PROGRAM_STATIC_RAM_BASE), true);
	assert.equal(linked.programImage.sections.rodata.constPool.includes(PROGRAM_STATIC_RAM_BASE + 4), true);
	assert.equal(linked.programImage.sections.rodata.constPool.includes(systemDataLma), true);
	assert.equal(linked.programImage.sections.rodata.constPool.includes(cartDataLma), true);
	assert.deepEqual(linked.programImage.link.constValueRelocs, []);
});

test('external const modules cannot declare .data storage', () => {
	const moduleSource = 'data counter: word = 1\nreturn { counter = counter }';
	assert.throws(
		() => compileLuaChunkToProgram(
			parseSource('return require("state").counter', 'entry.lua'),
			[],
			{
				entrySource: 'return require("state").counter',
				externalModules: [{ path: 'state', chunk: parseSource(moduleSource, 'state.lua'), source: moduleSource }],
				constModulePaths: ['state'],
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
	const image = encodeCompiledProgramImage(compiled);
	const rodataAddr = PROGRAM_ROM_BASE + image.sections.text.code.byteLength;
	assert.deepEqual(image.sections.rodata.symbols, [{
		name: 'module:section_rodata.lua/rodata:values',
		offset: 0,
		byteCount: 12,
		alignment: 4,
	}]);
	assert.deepEqual(Array.from(image.sections.rodata.bytes), [11, 0, 0, 0, 22, 0, 0, 0, 33, 0, 0, 0]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'rodata_addr' && reloc.symbol === 'module:section_rodata.lua/rodata:values'), true);
	assert.deepEqual(runColdCompiled(compiled).values, [11, 22, 33, rodataAddr]);
});

test('BLua .rodata typed storage preserves byte and halfword layout', () => {
	const source = `
rodata bytes: u8[3] = { 1, 2, 3 }
rodata halves: u16[2] = { 258, 772 }
return bytes[0], bytes[1], bytes[2], halves[0], halves[1], bytes, halves
`;
	const compiled = compileSource(source, 'section_rodata_widths.lua');
	const image = encodeCompiledProgramImage(compiled);
	const bytesAddr = PROGRAM_ROM_BASE + image.sections.text.code.byteLength;
	const halvesAddr = bytesAddr + 4;
	assert.deepEqual(Array.from(image.sections.rodata.bytes), [1, 2, 3, 0, 2, 1, 4, 3]);
	assert.deepEqual(image.sections.rodata.symbols, [
		{ name: 'module:section_rodata_widths.lua/rodata:bytes', offset: 0, byteCount: 3, alignment: 1 },
		{ name: 'module:section_rodata_widths.lua/rodata:halves', offset: 4, byteCount: 4, alignment: 2 },
	]);
	assert.deepEqual(runColdCompiled(compiled).values, [1, 2, 3, 258, 772, bytesAddr, halvesAddr]);
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
	const image = encodeCompiledProgramImage(compiled);
	const rodataAddr = PROGRAM_ROM_BASE + image.sections.text.code.byteLength;
	assert.equal(compiled.moduleProtoMap.has('data'), false);
	assert.equal(compiled.staticModulePaths.includes('data'), false);
	assert.deepEqual(image.sections.rodata.symbols, [{
		name: 'module:data/rodata:values',
		offset: 0,
		byteCount: 8,
		alignment: 4,
	}]);
	assert.equal(image.link.constValueRelocs.some(reloc => reloc.kind === 'rodata_addr' && reloc.symbol === 'module:data/rodata:values'), true);
	const disasm = disassembleProgramWithoutIrqVector(compiled);
	assert.doesNotMatch(disasm, /\bCALL\b/);
	assert.doesNotMatch(disasm, /\bNEWT\b/);
	assert.deepEqual(runColdCompiled(compiled).values, [5, 6, rodataAddr]);
});

test('linked system and cart const-module .rodata symbols resolve against their ROM ranges', () => {
	const systemSource = 'local s<const> = require("sys_data")\nreturn s.values';
	const systemCompiled = compileLuaChunkToProgram(
		parseSource(systemSource, 'system.lua'),
		[{ path: 'sys_data', chunk: parseSource('rodata values: word[1] = { 10 }\nreturn { values = values }', 'sys_data.lua'), source: 'rodata values: word[1] = { 10 }\nreturn { values = values }' }],
		{ entrySource: systemSource, constModulePaths: ['sys_data'] },
	);
	const cartSource = 'local s<const> = require("cart_data")\nreturn s.values';
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(cartSource, 'cart.lua'),
		[{ path: 'cart_data', chunk: parseSource('rodata values: word[1] = { 20 }\nreturn { values = values }', 'cart_data.lua'), source: 'rodata values: word[1] = { 20 }\nreturn { values = values }' }],
		{ entrySource: cartSource, constModulePaths: ['cart_data'] },
	);
	const linked = linkProgramImages(
		encodeCompiledProgramImage(systemCompiled),
		systemCompiled.metadata,
		encodeCompiledProgramImage(cartCompiled),
		cartCompiled.metadata,
	);
	const systemRodataAddr = PROGRAM_ROM_BASE + linked.programImage.sections.text.code.byteLength;
	const cartRodataAddr = systemRodataAddr + 4;
	assert.deepEqual(Array.from(linked.programImage.sections.rodata.bytes), [10, 0, 0, 0, 20, 0, 0, 0]);
	assert.deepEqual(linked.programImage.sections.rodata.symbols, [
		{ name: 'module:sys_data/rodata:values', offset: 0, byteCount: 4, alignment: 4 },
		{ name: 'module:cart_data/rodata:values', offset: 4, byteCount: 4, alignment: 4 },
	]);
	assert.equal(linked.programImage.sections.rodata.constPool.includes(systemRodataAddr), true);
	assert.equal(linked.programImage.sections.rodata.constPool.includes(cartRodataAddr), true);
	assert.deepEqual(linked.programImage.link.constValueRelocs, []);
});

test('external const modules cannot declare .rodata storage', () => {
	const moduleSource = 'rodata values: word[1] = { 1 }\nreturn { values = values }';
	assert.throws(
		() => compileLuaChunkToProgram(
			parseSource('return require("data").values', 'entry.lua'),
			[],
			{
				entrySource: 'return require("data").values',
				externalModules: [{ path: 'data', chunk: parseSource(moduleSource, 'data.lua'), source: moduleSource }],
				constModulePaths: ['data'],
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
