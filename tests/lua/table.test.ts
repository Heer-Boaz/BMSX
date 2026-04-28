import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitText } from '../../src/bmsx/common/text_lines';
import { LuaLexer } from '../../src/bmsx/lua/syntax/lexer';
import { LuaParser } from '../../src/bmsx/lua/syntax/parser';
import { CPU, RunResult, Table, type Value } from '../../src/bmsx/machine/cpu/cpu';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import { compileLuaChunkToProgram } from '../../src/bmsx/machine/program/compiler';

function runCompiledLua(source: string): Value[] {
	const lexer = new LuaLexer(source, 'table_semantics.lua');
	const parser = new LuaParser(lexer.scanTokens(), 'table_semantics.lua', splitText(source));
	const compiled = compileLuaChunkToProgram(parser.parseChunk(), [], { entrySource: source });
	const cpu = new CPU(new Memory({ systemRom: new Uint8Array(0) }));
	cpu.setProgram(compiled.program, compiled.metadata);
	cpu.start(compiled.entryProtoIndex);
	assert.equal(cpu.run(100000), RunResult.Halted);
	return Array.from(cpu.lastReturnValues);
}

test('Table stores sparse unsigned integer keys in the hash part', () => {
	const table = new Table(0, 0);
	const highKey = 0xffffffff;
	const tokenKey = 0x84222325;

	table.set(highKey, 11);
	table.set(tokenKey, 22);

	assert.equal(table.get(highKey), 11);
	assert.equal(table.get(tokenKey), 22);
	assert.equal(table.length(), 0);
	assert.ok(table.getTrackedHeapBytes() < 4096);
});

test('CPU modulus follows Lua floor-modulo semantics', () => {
	const [negativeNormalized, fnvXorNormalized] = runCompiledLua(`
return -1 % 0x100000000, (0x84222325 ~ 0x61) % 0x100000000
`);

	assert.equal(negativeNormalized, 0xffffffff);
	assert.equal(fnvXorNormalized, 0x84222344);
});
