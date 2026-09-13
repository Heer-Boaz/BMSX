import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import assert from 'node:assert/strict';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Value } from '../../machine/ts/machine/cpu/value';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import type { OptimizationLevel } from '../../toolchain/ts/lua/compiler/optimizer';
import { runCompiledTestSystem } from '../helpers/blua32';

export function parseLuaChunk(source: string, path = 'test.lua') {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, source);
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

/** Complete one actual guest call and report its machine-cycle charge. */
export function runCompletionClosure(cpu: CPU, closure: Closure, args: Value[]): number {
	const budget = 10_000_000;
	cpu.beginCompletionCall(closure, args);
	assert.equal(cpu.runUntilDepth(0, budget), RunResult.Halted);
	return budget - cpu.instructionBudgetRemaining;
}
