import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { CPU, RunResult, type Value } from '../../machine/ts/machine/cpu/cpu';
import { disassembleProgram } from '../../machine/ts/machine/cpu/disassembler';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PROGRAM_BSS_BASE } from '../../machine/ts/machine/memory/map';
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

function runColdCompiled(compiled: CompiledProgram, memory = new Memory({ systemRom: new Uint8Array(0) })): { memory: Memory; values: Value[] } {
	const image = encodeCompiledProgramImage(compiled);
	const cpu = new CPU(memory);
	cpu.setProgram(inflateExecutableProgramImage(image, compiled.metadata), compiled.metadata);
	cpu.start(image.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	cpu.start(image.entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	return { memory, values: Array.from(cpu.lastReturnValues) };
}

function runCold(source: string, memory = new Memory({ systemRom: new Uint8Array(0) })): { memory: Memory; values: Value[] } {
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

	const memory = new Memory({ systemRom: new Uint8Array(0) });
	memory.writeMappedU32LE(PROGRAM_BSS_BASE, 0x11223344);
	const result = runCold(source, memory);
	assert.equal(result.memory.readMappedU32LE(PROGRAM_BSS_BASE), 0);
	assert.deepEqual(result.values, [0, PROGRAM_BSS_BASE]);
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

	assert.deepEqual(result.values, [99, 12, PROGRAM_BSS_BASE + 12, 12]);
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
	const disasm = disassembleProgram(compiled.program, compiled.metadata, { showProtoHeaders: true });
	assert.doesNotMatch(disasm, /\bCALL\b/);
	assert.doesNotMatch(disasm, /\bNEWT\b/);

	const memory = new Memory({ systemRom: new Uint8Array(0) });
	memory.writeMappedU32LE(PROGRAM_BSS_BASE, 0x11223344);
	const result = runColdCompiled(compiled, memory);
	assert.deepEqual(result.values, [77, PROGRAM_BSS_BASE]);
	assert.equal(result.memory.readMappedU32LE(PROGRAM_BSS_BASE), 77);
});

test('const modules export static functions without runtime module state', () => {
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
local read<const> = state.read
*counter = 41
return read(), state.read()
`;
	const compiled = compileWithConstModule(entrySource, 'state', moduleSource);
	const image = encodeCompiledProgramImage(compiled);
	assert.equal(compiled.moduleProtoMap.has('state'), false);
	assert.equal(compiled.staticModulePaths.includes('state'), false);
	assert.match(compiled.metadata.exportProtoIdBySlot.state__read, /\/static:/);
	const disasm = disassembleProgram(compiled.program, compiled.metadata, { showProtoHeaders: true });
	assert.doesNotMatch(disasm, /\bNEWT\b/);
	assert.doesNotMatch(disasm, /\bGET(GL|SYS)\b.*state__read/);
	assert.equal(image.link.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'state__read'), true);

	const result = runColdCompiled(compiled);
	assert.deepEqual(result.values, [41, 41]);
	assert.equal(result.memory.readMappedU32LE(PROGRAM_BSS_BASE), 41);
});

test('const module static functions cannot capture module locals', () => {
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

test('const module static functions use module compile-time constants without captures', () => {
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

test('external const modules cannot export static functions', () => {
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
		/Const module 'state' exports static functions but is not compiled as a source module/,
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
	assert.deepEqual(result.values, [11, 22, PROGRAM_BSS_BASE, PROGRAM_BSS_BASE + 4]);
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
	assert.equal(linked.systemBssBaseAddress, PROGRAM_BSS_BASE);
	assert.equal(linked.cartBssBaseAddress, PROGRAM_BSS_BASE + 4);
	assert.equal(linked.programImage.sections.bss.byteCount, 8);
	assert.deepEqual(linked.programImage.sections.bss.symbols, [
		{ name: 'module:sys_state/bss:counter', offset: 0, byteCount: 4, alignment: 4 },
		{ name: 'module:cart_state/bss:counter', offset: 4, byteCount: 4, alignment: 4 },
	]);
	assert.equal(linked.programImage.sections.rodata.constPool.includes(PROGRAM_BSS_BASE), true);
	assert.equal(linked.programImage.sections.rodata.constPool.includes(PROGRAM_BSS_BASE + 4), true);
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
