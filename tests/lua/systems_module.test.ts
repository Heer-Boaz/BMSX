import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { CPU, RunResult, type ProgramMetadata } from '../../machine/ts/machine/cpu/cpu';
import { disassembleProgram } from '../../machine/ts/machine/cpu/disassembler';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { compileLuaChunkToProgram, encodeCompiledProgramImage, type CompiledProgram } from '../../machine/ts/machine/program/compiler';
import type { ProgramImage } from '../../machine/ts/machine/program/loader';
import { inflateExecutableProgramImage, linkProgramImages } from '../../machine/ts/machine/program/linker';

const CLAMP_INT_PATH = 'bios/util/clamp_int';
const RECT_OVERLAPS_PATH = 'bios/util/rect_overlaps';

function parseSource(source: string, path: string) {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

function compileWithSystemsModule(entrySource: string, modulePath: string, moduleSource: string): CompiledProgram {
	return compileLuaChunkToProgram(
		parseSource(entrySource, 'entry.lua'),
		[{ path: modulePath, chunk: parseSource(moduleSource, `${modulePath}.lua`), source: moduleSource }],
		{ entrySource, systemsModulePaths: [modulePath] },
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

test('rect_overlaps compiles as a systems module and calls through export-proto', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/rect_overlaps.lua', 'utf8');
	const entrySource = `
local rect_overlaps<const> = require("${RECT_OVERLAPS_PATH}")
return rect_overlaps(0, 0, 10, 10, 5, 5, 1, 1), rect_overlaps(0, 0, 2, 2, 3, 3, 1, 1)
`;
	const compiled = compileWithSystemsModule(entrySource, RECT_OVERLAPS_PATH, moduleSource);
	assert.equal(compiled.moduleProtoMap.has(RECT_OVERLAPS_PATH), false);
	assert.equal(compiled.metadata.exportProtoIdBySlot.bios__util__rect_overlaps?.includes('/static:'), true);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'bios__util__rect_overlaps'), true);
	const disasm = disassembleWithoutBootVectors(compiled);
	assert.doesNotMatch(disasm, /\b(?:NEWT|GETT|SETT|GETI|SETI|GETFIELD|SETFIELD|SELF|CLOSURE|VARARG|CONCAT|CONCATN)\b/);
	assert.deepEqual(runColdCompiled(compiled), [true, false]);
});

test('clamp_int compiles as a systems module and calls through export-proto', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/clamp_int.lua', 'utf8');
	const entrySource = `
local clamp_int<const> = require("${CLAMP_INT_PATH}")
return clamp_int(-2, 0, 10), clamp_int(7, 0, 10), clamp_int(12, 0, 10)
`;
	const compiled = compileWithSystemsModule(entrySource, CLAMP_INT_PATH, moduleSource);
	assert.equal(compiled.moduleProtoMap.has(CLAMP_INT_PATH), false);
	assert.equal(compiled.metadata.exportProtoIdBySlot.bios__util__clamp_int?.includes('/static:'), true);
	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'export_proto' && reloc.symbol === 'bios__util__clamp_int'), true);
	const disasm = disassembleWithoutBootVectors(compiled);
	assert.doesNotMatch(disasm, /\b(?:NEWT|GETT|SETT|GETI|SETI|GETFIELD|SETFIELD|SELF|CLOSURE|VARARG|CONCAT|CONCATN)\b/);
	assert.deepEqual(runColdCompiled(compiled), [0, 7, 10]);
});

test('cart systems-module calls link to system export protos', () => {
	const moduleSource = readFileSync('machine/firmware/bios/util/rect_overlaps.lua', 'utf8');
	const module = { path: RECT_OVERLAPS_PATH, chunk: parseSource(moduleSource, `${RECT_OVERLAPS_PATH}.lua`), source: moduleSource };
	const systemCompiled = compileLuaChunkToProgram(
		parseSource('return nil', 'system.lua'),
		[module],
		{ entrySource: 'return nil', systemsModulePaths: [RECT_OVERLAPS_PATH] },
	);
	const cartSource = `
local rect_overlaps<const> = require("${RECT_OVERLAPS_PATH}")
return rect_overlaps(2, 2, 4, 4, 5, 5, 2, 2)
`;
	const cartCompiled = compileLuaChunkToProgram(
		parseSource(cartSource, 'cart.lua'),
		[],
		{ entrySource: cartSource, externalModules: [module], systemsModulePaths: [RECT_OVERLAPS_PATH] },
	);
	const linked = linkProgramImages(
		encodeCompiledProgramImage(systemCompiled),
		systemCompiled.metadata,
		encodeCompiledProgramImage(cartCompiled),
		cartCompiled.metadata,
	);
	assert.deepEqual(runColdImage(linked.programImage, linked.metadata), [true]);
});

test('systems modules reject dynamic opcodes across their protos', () => {
	const moduleSource = `
local bad<const> = function()
	local t = {}
	return t
end
return bad
`;
	assert.throws(
		() => compileWithSystemsModule('return require("bad")()', 'bad', moduleSource),
		/Systems module 'bad' proto 'function export .*' emits forbidden systems-lane opcode NEWT \(table allocation\)/,
	);
});
