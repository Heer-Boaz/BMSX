import { $ } from '../core/engine_core';
import { describeInstructionAtPc, formatSourceSnippet, type InstructionOperandDebugInfo } from './disassembler';
import { valueToString } from './lua_globals';
import { Table, isNativeObject, type LocalSlotDebug, type SourceRange, type Value } from './cpu';
import type { LuaSourceRecord } from './lua_sources';
import type { Runtime } from './runtime';
import { getWorkspaceCachedSource } from './workspace_cache';
import { isStringValue, stringValueToString } from './string_pool';

const DEBUG_EXPR_PATTERN = /\b[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*\b/g;
const MAX_DEBUG_EXPRESSIONS = 8;
const LUA_KEYWORDS = new Set([
	'and',
	'break',
	'do',
	'else',
	'elseif',
	'end',
	'false',
	'for',
	'function',
	'if',
	'in',
	'local',
	'nil',
	'not',
	'or',
	'repeat',
	'return',
	'then',
	'true',
	'until',
	'while',
]);

function comparePosition(line: number, column: number, otherLine: number, otherColumn: number): number {
	if (line < otherLine) {
		return -1;
	}
	if (line > otherLine) {
		return 1;
	}
	if (column < otherColumn) {
		return -1;
	}
	if (column > otherColumn) {
		return 1;
	}
	return 0;
}

function positionWithinRange(line: number, column: number, range: SourceRange): boolean {
	return comparePosition(line, column, range.start.line, range.start.column) >= 0
		&& comparePosition(line, column, range.end.line, range.end.column) <= 0;
}

function positionAfterOrEqual(line: number, column: number, otherLine: number, otherColumn: number): boolean {
	return comparePosition(line, column, otherLine, otherColumn) >= 0;
}

function rangeArea(range: SourceRange): number {
	return ((range.end.line - range.start.line) * 1_000_000) + (range.end.column - range.start.column);
}

function extractRawSourceFragment(range: SourceRange, sourceText: string): string {
	const lines = sourceText.split(/\r?\n/);
	const startLineIndex = range.start.line - 1;
	const endLineIndex = range.end.line - 1;
	if (startLineIndex < 0 || endLineIndex < startLineIndex || endLineIndex >= lines.length) {
		return '';
	}
	const parts: string[] = [];
	for (let index = startLineIndex; index <= endLineIndex; index += 1) {
		parts.push(lines[index]);
	}
	return parts.join(' ');
}

function extractExpressionCandidates(range: SourceRange, sourceText: string): string[] {
	const fragment = extractRawSourceFragment(range, sourceText);
	const matches = fragment.match(DEBUG_EXPR_PATTERN);
	if (!matches) {
		return [];
	}
	const seen = new Set<string>();
	const result: string[] = [];
	for (let index = 0; index < matches.length; index += 1) {
		const expression = matches[index];
		if (LUA_KEYWORDS.has(expression)) {
			continue;
		}
		if (seen.has(expression)) {
			continue;
		}
		seen.add(expression);
		result.push(expression);
		if (result.length >= MAX_DEBUG_EXPRESSIONS) {
			break;
		}
	}
	return result;
}

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
		text += `(${formatDebugValue(registers[operand.registerIndex])})`;
	}
	return text;
}

function formatDebugSourceLine(range: SourceRange, source: string | null): string {
	const location = `${range.path}:${range.start.line}:${range.start.column}`;
	if (source === null) {
		return location;
	}
	return `${location} ${formatSourceSnippet(range, source)}`;
}

function formatDebugValue(value: Value): string {
	if (isStringValue(value)) {
		return JSON.stringify(stringValueToString(value));
	}
	return valueToString(value);
}

function selectLocalSlot(slots: ReadonlyArray<LocalSlotDebug>, name: string, range: SourceRange): LocalSlotDebug | null {
	let best: LocalSlotDebug = null;
	for (let index = 0; index < slots.length; index += 1) {
		const slot = slots[index];
		if (slot.name !== name) {
			continue;
		}
		if (!positionWithinRange(range.start.line, range.start.column, slot.scope)) {
			continue;
		}
		if (!positionAfterOrEqual(range.start.line, range.start.column, slot.definition.start.line, slot.definition.start.column)) {
			continue;
		}
		if (!best || rangeArea(slot.scope) < rangeArea(best.scope)) {
			best = slot;
		}
	}
	return best;
}

function resolveRootExpressionValue(
	runtime: Runtime,
	frameIndex: number,
	protoIndex: number,
	range: SourceRange,
	registers: ReadonlyArray<Value>,
	rootName: string,
): { found: boolean; value: Value } {
	const metadata = runtime.programMetadata;
	const canonicalName = runtime.canonicalizeIdentifier(rootName);
	const slots = metadata?.localSlotsByProto?.[protoIndex];
	if (slots && slots.length > 0) {
		const slot = selectLocalSlot(slots, canonicalName, range);
		if (slot) {
			return {
				found: true,
				value: slot.register < registers.length ? registers[slot.register] : runtime.cpu.readFrameRegister(frameIndex, slot.register),
			};
		}
	}
	const upvalueNames = metadata?.upvalueNamesByProto?.[protoIndex];
	if (upvalueNames) {
		const upvalueIndex = upvalueNames.indexOf(canonicalName);
		if (upvalueIndex >= 0) {
			return { found: true, value: runtime.cpu.readFrameUpvalue(frameIndex, upvalueIndex) };
		}
	}
	const globalValue = runtime.cpu.globals.get(runtime.canonicalKey(rootName));
	if (globalValue !== null) {
		return { found: true, value: globalValue };
	}
	return { found: false, value: null };
}

function resolveExpressionValue(
	runtime: Runtime,
	frameIndex: number,
	protoIndex: number,
	range: SourceRange,
	registers: ReadonlyArray<Value>,
	expression: string,
): { found: boolean; value: Value } {
	const parts = expression.split('.');
	const root = resolveRootExpressionValue(runtime, frameIndex, protoIndex, range, registers, parts[0]);
	if (!root.found) {
		return root;
	}
	let current = root.value;
	for (let index = 1; index < parts.length; index += 1) {
		if (current instanceof Table) {
			current = current.get(runtime.canonicalKey(parts[index]));
		} else if (isNativeObject(current)) {
			current = current.get(runtime.canonicalKey(parts[index]));
		} else {
			return { found: false, value: null };
		}
		if (current === null && index < parts.length - 1) {
			return { found: false, value: null };
		}
	}
	return { found: true, value: current };
}

function collectSourceExpressionDebug(runtime: Runtime, range: SourceRange, source: string, registers: ReadonlyArray<Value>): string[] {
	const callStack = runtime.cpu.getCallStack();
	if (callStack.length === 0) {
		return [];
	}
	const frameIndex = callStack.length - 1;
	const protoIndex = callStack[frameIndex].protoIndex;
	const expressions = extractExpressionCandidates(range, source);
	const result: string[] = [];
	for (let index = 0; index < expressions.length; index += 1) {
		const expression = expressions[index];
		const resolved = resolveExpressionValue(runtime, frameIndex, protoIndex, range, registers, expression);
		if (!resolved.found) {
			continue;
		}
		result.push(`${expression}=${formatDebugValue(resolved.value)}`);
	}
	return result;
}

export function logDebugState(runtime: Runtime): void {
	const debug = runtime.cpu.getDebugState();
	const instruction = describeInstructionAtPc(runtime.cpu.getProgram(), debug.pc, runtime.programMetadata, { formatStyle: 'assembly' });
	const operandSummary = instruction.operands.map(operand => formatInstructionOperandDebug(operand, debug.registers)).join(' ');
	console.error(`[Runtime] debug: pc=${instruction.pcText} op=${instruction.opName}${operandSummary.length > 0 ? ` ${operandSummary}` : ''}`);
	console.error(`[Runtime] debug: instr=${instruction.pcText}: ${instruction.instructionText}`);
	if (instruction.sourceRange) {
		const source = resourceSourceForPath(runtime, instruction.sourceRange.path);
		console.error(`[Runtime] debug: source=${formatDebugSourceLine(instruction.sourceRange, source)}`);
		if (source !== null) {
			const expressions = collectSourceExpressionDebug(runtime, instruction.sourceRange, source, debug.registers);
			if (expressions.length > 0) {
				console.error(`[Runtime] debug: exprs=${expressions.join(' ')}`);
			}
		}
	}
}
