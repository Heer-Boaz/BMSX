import assert from 'node:assert/strict';

import { splitText } from '../../packages/bmsx-console/src/common/text_lines';
import { LuaLexer } from '../../packages/bmsx-console/src/lua/syntax/lexer';
import { LuaParser } from '../../packages/bmsx-console/src/lua/syntax/parser';
import { CPU, RunResult, type Value } from '../../packages/bmsx-console/src/machine/cpu/cpu';
import { Memory } from '../../packages/bmsx-console/src/machine/memory/memory';
import { compileLuaChunkToProgram } from '../../packages/bmsx-console/src/machine/program/compiler';

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
