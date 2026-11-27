import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import assert from 'node:assert/strict';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import type { Value } from '../../machine/ts/machine/cpu/value';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import type { OptimizationLevel } from '../../toolchain/ts/lua/compiler/optimizer';
import { runGuestToHalt } from './cpu_execution';
import { bootManagedTestSystem, linkManagedTestSystem } from './managed_system';
export { runGuestToHalt } from './cpu_execution';

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

/** Execute an authored System ROM, keeping firmware work outside the subject's original grant. */
export function runCompiledLua(source: string, path = 'test.lua', optLevel: OptimizationLevel = 0): Value[] {
	const linked = linkManagedTestSystem(source, optLevel, [], [], path);
	const { cpu } = bootManagedTestSystem(linked, path);
	runGuestToHalt(cpu, 100_000);
	assert.equal(cpu.getFrameDepth(), 0, 'the compiled System entry returned');
	return materializeCpuCompletionValues(cpu);
}

export function materializeCpuCompletionValues(cpu: CPU): Value[] {
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	return values;
}

/** Complete one actual guest call and report its machine-cycle charge. */
export function runCompletionClosure(cpu: CPU, closure: number, args: Value[], budget = 10_000_000): number {
	cpu.beginCompletionCall(closure, args);
	runGuestToHalt(cpu, budget);
	return budget - cpu.instructionBudgetRemaining;
}
