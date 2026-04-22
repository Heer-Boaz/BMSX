import { $ } from '../../core/engine';
import { describeInstructionAtPc, formatSourceSnippet, type InstructionOperandDebugInfo } from '../cpu/disassembler';
import { valueToString } from '../firmware/globals';
import { Table, isNativeObject, type LocalSlotDebug, type SourceRange, type Value } from '../cpu/cpu';
import type { LuaSourceRecord } from '../program/sources';
import type { Runtime } from './runtime';
import { getWorkspaceCachedSource } from '../../ide/workspace/cache';
import { isStringValue, stringValueToString } from '../memory/string/pool';
import { KEYWORDS } from '../../lua/syntax/token';

const DEBUG_EXPR_PATTERN = /\b[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*\b/g;
const MAX_DEBUG_EXPRESSIONS = 8;

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
	// disable-next-line newline_normalization_pattern -- debugger maps source ranges to logical source lines.
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
		if (KEYWORDS.has(expression)) {
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

function resolveLuaSourceRecord(runtime: Runtime, path: string): LuaSourceRecord | undefined {
	return $.sources.path2lua[path]
		?? runtime.cartLuaSources?.path2lua[path]
		?? runtime.engineLuaSources?.path2lua[path];
}

function resourceSourceForPath(runtime: Runtime, path: string): string | null {
	const binding = resolveLuaSourceRecord(runtime, path);
	if (!binding) {
		return null;
	}
	const cached = getWorkspaceCachedSource(binding.source_path);
	if (cached === null) {
		return binding.src;
	}
	return cached;
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
	const cpu = runtime.machine.cpu;
	const metadata = runtime.programMetadata;
	const slots = metadata?.localSlotsByProto?.[protoIndex];
	if (slots && slots.length > 0) {
		const slot = selectLocalSlot(slots, rootName, range);
		if (slot) {
			return {
				found: true,
				value: slot.register < registers.length ? registers[slot.register] : cpu.readFrameRegister(frameIndex, slot.register),
			};
		}
	}
	const upvalueNames = metadata?.upvalueNamesByProto?.[protoIndex];
	if (upvalueNames) {
		const upvalueIndex = upvalueNames.indexOf(rootName);
		if (upvalueIndex >= 0 && cpu.hasFrameUpvalue(frameIndex, upvalueIndex)) {
			return { found: true, value: cpu.readFrameUpvalue(frameIndex, upvalueIndex) };
		}
	}
	const globalValue = cpu.getGlobalByKey(runtime.luaKey(rootName));
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
			current = current.get(runtime.luaKey(parts[index]));
		} else if (isNativeObject(current)) {
			current = current.get(runtime.luaKey(parts[index]));
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
	const callStack = runtime.machine.cpu.getCallStack();
	if (callStack.length === 0) {
		return [];
	}
	const frameIndex = callStack.length - 1;
	const expressions = extractExpressionCandidates(range, source);
	const result: string[] = [];
	for (let index = 0; index < expressions.length; index += 1) {
		const expression = expressions[index];
		const resolved = resolveExpressionValue(runtime, frameIndex, callStack[frameIndex].protoIndex, range, registers, expression);
		if (!resolved.found) {
			continue;
		}
		result.push(`${expression}=${formatDebugValue(resolved.value)}`);
	}
	return result;
}

export function logDebugState(runtime: Runtime): void {
	const program = runtime.machine.cpu.getProgram();
	if (!program || program.code.length === 0) {
		return;
	}
	const debug = runtime.machine.cpu.getDebugState();
	if (debug.pc < 0 || debug.pc >= program.code.length) {
		return;
	}
	const instruction = describeInstructionAtPc(program, debug.pc, runtime.programMetadata, { formatStyle: 'assembly' });
	const operandSummary = instruction.operands.map(operand => formatInstructionOperandDebug(operand, debug.registers)).join(' ');
	console.error(`\tpc=${instruction.pcText} op=${instruction.opName}${operandSummary.length > 0 ? ` ${operandSummary}` : ''}`);
	console.error(`\tinstr=${instruction.pcText}: ${instruction.instructionText}`);
	if (instruction.sourceRange) {
		const source = resourceSourceForPath(runtime, instruction.sourceRange.path);
		console.error(`\tsource=${formatDebugSourceLine(instruction.sourceRange, source)}`);
		if (source !== null) {
			const expressions = collectSourceExpressionDebug(runtime, instruction.sourceRange, source, debug.registers);
			if (expressions.length > 0) {
				console.error(`\texprs=${expressions.join(' ')}`);
			}
		}
	}
}
