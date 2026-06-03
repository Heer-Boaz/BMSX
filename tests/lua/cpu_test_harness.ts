import assert from 'node:assert/strict';

import { splitText } from '../../machine/ts/src/common/text_lines';
import { LuaLexer } from '../../machine/ts/src/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/src/lua/syntax/parser';
import { CPU, RunResult, type Value } from '../../machine/ts/src/machine/cpu/cpu';
import { Memory } from '../../machine/ts/src/machine/memory/memory';
import { compileLuaChunkToProgram } from '../../machine/ts/src/machine/program/compiler';

export function runCompiledLua(source: string, path = 'test.lua'): Value[] {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	const compiled = compileLuaChunkToProgram(parser.parseChunk(), [], { entrySource: source });
	const cpu = new CPU(new Memory({ systemRom: new Uint8Array(0) }));
	cpu.setProgram(compiled.program, compiled.metadata);
	cpu.start(compiled.entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	return Array.from(cpu.lastReturnValues);
}
