import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import type { Value } from '../../machine/ts/machine/cpu/value';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import type { OptimizationLevel } from '../../toolchain/ts/lua/compiler/optimizer';
import { runCompiledTestSystem } from '../helpers/blua32';

export function parseLuaChunk(source: string, path = 'test.lua') {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

export function compileLuaSource(source: string, path = 'test.lua', optLevel: OptimizationLevel = 0) {
	return compileLuaChunkToProgram(parseLuaChunk(source, path), [], {
		entrySource: source,
		optLevel,
		programDomain: 'system',
	});
}

export function runCompiledLua(source: string, path = 'test.lua', optLevel: OptimizationLevel = 0): Value[] {
	const compiled = compileLuaSource(source, path, optLevel);
	const cpu = runCompiledTestSystem(compiled, 100000);
	return materializeCpuCompletionValues(cpu);
}

export function materializeCpuCompletionValues(cpu: CPU): Value[] {
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	return values;
}
