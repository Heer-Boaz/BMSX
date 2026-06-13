import assert from 'node:assert/strict';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { CPU, RunResult, type Value } from '../../machine/ts/machine/cpu/cpu';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { compileLuaChunkToProgram } from '../../machine/ts/machine/program/compiler';
import type { OptimizationLevel } from '../../machine/ts/machine/program/optimizer';

export function runCompiledLua(source: string, path = 'test.lua', optLevel: OptimizationLevel = 0): Value[] {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	const compiled = compileLuaChunkToProgram(parser.parseChunk(), [], { entrySource: source, optLevel });
	const cpu = new CPU(new Memory({ systemRom: new Uint8Array(0) }));
	cpu.setProgram(compiled.program, compiled.metadata);
	cpu.start(compiled.entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	return Array.from(cpu.lastReturnValues);
}
