import { describeInstructionAtPc, type InstructionOperandDebugInfo } from '../../machine/cpu/disassembler';
import { valueToString } from '../../machine/firmware/globals';
import type { SourceRange, Value } from '../../machine/cpu/cpu';
import type { Runtime } from '../../machine/runtime/runtime';

function formatInstructionOperandDebug(runtime: Runtime, operand: InstructionOperandDebugInfo, registers: ReadonlyArray<Value>): string {
	let text = `${operand.label}=${operand.text}`;
	if (operand.registerIndex !== undefined && operand.registerIndex < registers.length) {
		text += `(${valueToString(registers[operand.registerIndex], runtime.machine.cpu.stringPool)})`;
	}
	return text;
}

function formatDebugSourceLine(range: SourceRange): string {
	return `${range.path}:${range.start.line}:${range.start.column}`;
}

export function logDebugState(runtime: Runtime): void {
	const program = runtime.machine.cpu.program;
	if (!program || program.code.length === 0) {
		return;
	}
	const debug = runtime.machine.cpu.getDebugState();
	if (debug.pc < 0 || debug.pc >= program.code.length) {
		return;
	}
	const instruction = describeInstructionAtPc(program, debug.pc, runtime.programMetadata);
	const operandSummary = instruction.operands.map(operand => formatInstructionOperandDebug(runtime, operand, debug.registers)).join(' ');

	console.error(`\tpc=${instruction.pcText} op=${instruction.opName}${operandSummary.length > 0 ? ` ${operandSummary}` : ''}`);
	console.error(`\tinstr=${instruction.pcText}: ${instruction.instructionText}`);
	if (instruction.sourceRange) {
		console.error(`\tsource=${formatDebugSourceLine(instruction.sourceRange)}`);
	}
}
