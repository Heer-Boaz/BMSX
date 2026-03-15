import { $ } from '../core/engine_core';
import { describeInstructionAtPc, formatSourceSnippet, type InstructionOperandDebugInfo } from './disassembler';
import { valueToString } from './lua_globals';
import type { SourceRange, Value } from './cpu';
import type { LuaSourceRecord } from './lua_sources';
import type { Runtime } from './runtime';
import { getWorkspaceCachedSource } from './workspace_cache';

function resolveLuaSourceRecord(runtime: Runtime, path: string): LuaSourceRecord | null {
	return $.lua_sources?.path2lua[path]
		?? runtime.cartLuaSources?.path2lua[path]
		?? runtime.engineLuaSources?.path2lua[path]
		?? null;
}

function resourceSourceForPath(runtime: Runtime, path: string): string | null {
	const binding = resolveLuaSourceRecord(runtime, path);
	if (!binding) {
		return null;
	}
	const cached = getWorkspaceCachedSource(binding.source_path);
	return cached !== null ? cached : binding.src;
}

function formatInstructionOperandDebug(operand: InstructionOperandDebugInfo, registers: ReadonlyArray<Value>): string {
	let text = `${operand.label}=${operand.text}`;
	if (operand.registerIndex !== undefined && operand.registerIndex < registers.length) {
		text += `(${valueToString(registers[operand.registerIndex])})`;
	}
	return text;
}

function formatDebugSourceLine(runtime: Runtime, range: SourceRange): string {
	const location = `${range.path}:${range.start.line}:${range.start.column}`;
	const source = resourceSourceForPath(runtime, range.path);
	if (source === null) {
		return location;
	}
	return `${location} ${formatSourceSnippet(range, source)}`;
}

export function logDebugState(runtime: Runtime): void {
	const debug = runtime.cpu.getDebugState();
	const instruction = describeInstructionAtPc(runtime.cpu.getProgram(), debug.pc, runtime.programMetadata, { formatStyle: 'assembly' });
	const operandSummary = instruction.operands.map(operand => formatInstructionOperandDebug(operand, debug.registers)).join(' ');
	console.error(`[Runtime] debug: pc=${instruction.pcText} op=${instruction.opName}${operandSummary.length > 0 ? ` ${operandSummary}` : ''}`);
	console.error(`[Runtime] debug: instr=${instruction.pcText}: ${instruction.instructionText}`);
	if (instruction.sourceRange) {
		console.error(`[Runtime] debug: source=${formatDebugSourceLine(runtime, instruction.sourceRange)}`);
	}
}
