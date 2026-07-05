import assert from 'node:assert/strict';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { CPU, RunResult, type Value } from '../../machine/ts/machine/cpu/cpu';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { compileLuaChunkToProgram } from '../../machine/ts/lua/compiler';
import type { OptimizationLevel } from '../../machine/ts/lua/compiler/optimizer';

export function parseLuaChunk(source: string, path = 'test.lua') {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

export function compileLuaSource(source: string, path = 'test.lua', optLevel: OptimizationLevel = 0) {
	return compileLuaChunkToProgram(parseLuaChunk(source, path), [], { entrySource: source, optLevel });
}

export function runCompiledLua(source: string, path = 'test.lua', optLevel: OptimizationLevel = 0): Value[] {
	const compiled = compileLuaSource(source, path, optLevel);
	const cpu = new CPU(new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) }));
	cpu.setProgram(compiled.program, compiled.metadata, compiled.metadata);
	cpu.start(compiled.entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	return Array.from(cpu.lastReturnValues);
}
