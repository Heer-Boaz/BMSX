import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { CPU, RunResult, type Value } from '../../machine/ts/machine/cpu/cpu';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PROGRAM_BSS_BASE } from '../../machine/ts/machine/memory/map';
import { compileLuaChunkToProgram, encodeCompiledProgramImage } from '../../machine/ts/machine/program/compiler';
import { inflateExecutableProgramImage } from '../../machine/ts/machine/program/linker';

function compileSource(source: string, path = 'section_bss.lua') {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return compileLuaChunkToProgram(parser.parseChunk(), [], { entrySource: source });
}

function runCold(source: string, memory = new Memory({ systemRom: new Uint8Array(0) })): { memory: Memory; values: Value[] } {
	const compiled = compileSource(source);
	const image = encodeCompiledProgramImage(compiled);
	const cpu = new CPU(memory);
	cpu.setProgram(inflateExecutableProgramImage(image, compiled.metadata), compiled.metadata);
	cpu.start(image.sectionInitProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	cpu.start(image.entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	return { memory, values: Array.from(cpu.lastReturnValues) };
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
