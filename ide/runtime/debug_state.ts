import {
	describeBlua32InstructionAtPc,
	type InstructionOperandDebugInfo,
} from '../../machine/ts/machine/cpu/disassembler';
import { valueToString } from '../../machine/ts/machine/firmware/globals';
import type { Value } from '../../machine/ts/machine/cpu/cpu';
import type { SourceRange } from '../../machine/ts/machine/cpu/blua32_symbols';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { LogLevel, type Platform } from '../../machine/ts/platform/platform';

function formatInstructionOperandDebug(
	runtime: Runtime,
	operand: InstructionOperandDebugInfo,
	registers: ReadonlyArray<Value>,
): string {
	let text = `${operand.label}=${operand.text}`;
	if (operand.registerIndex !== undefined && operand.registerIndex < registers.length) {
		text += `(${valueToString(registers[operand.registerIndex], runtime.machine.cpu.stringPool)})`;
	}
	return text;
}

function formatDebugSourceLine(range: SourceRange): string {
	return `${range.path}:${range.start.line}:${range.start.column}`;
}

export function logDebugState(runtime: Runtime, platform: Platform): void {
	const cpu = runtime.machine.cpu;
	const debug = cpu.getDebugState();
	if (debug.image === null) {
		return;
	}
	const instruction = describeBlua32InstructionAtPc(
		debug.image,
		debug.symbols,
		debug.pc,
	);
	const operandSummary = instruction.operands
		.map(operand => formatInstructionOperandDebug(runtime, operand, debug.registers))
		.join(' ');
	platform.log(
		LogLevel.Error,
		`\tpc=${instruction.pcText} op=${instruction.opName}${operandSummary.length > 0 ? ` ${operandSummary}` : ''}`,
	);
	platform.log(LogLevel.Error, `\tinstr=${instruction.pcText}: ${instruction.instructionText}`);
	if (instruction.sourceRange) {
		platform.log(LogLevel.Error, `\tsource=${formatDebugSourceLine(instruction.sourceRange)}`);
	}
}
