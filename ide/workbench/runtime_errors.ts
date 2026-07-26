import { machineManager } from '../../machine/ts/core/machine_manager';
import {
	describeBlua32InstructionAtPc,
	type InstructionOperandDebugInfo,
} from '../../machine/ts/machine/cpu/disassembler';
import type { SourceRange } from '../../machine/ts/machine/cpu/blua32_symbols';
import { valueToString, type Value } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { LogLevel } from '../../machine/ts/platform/platform';
import { recordLuaError } from '../runtime/fault_state';
import { blua32ToolingImageForDomain } from '../runtime/blua32_media';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeFaultState } from '../runtime/fault_state';

function formatInstructionOperandDebug(
	runtime: Runtime,
	operand: InstructionOperandDebugInfo,
	registers: ReadonlyArray<Value>,
): string {
	let text = `${operand.label}=${operand.text}`;
	if (operand.registerIndex >= 0 && operand.registerIndex < registers.length) {
		text += `(${valueToString(registers[operand.registerIndex], runtime.machine.cpu.stringPool)})`;
	}
	return text;
}

function formatDebugSourceLine(range: SourceRange): string {
	return `${range.path}:${range.start.line}:${range.start.column}`;
}

function logDebugState(sources: RuntimeSourceState, runtime: Runtime): void {
	const cpu = runtime.machine.cpu;
	const debug = cpu.getDebugState();
	const image = blua32ToolingImageForDomain(sources.currentBlua32Media, debug.slot);
	if (!image) {
		return;
	}
	const instruction = describeBlua32InstructionAtPc(
		image.layout,
		image.symbols,
		debug.pc,
	);
	const operandSummary = instruction.operands
		.map(operand => formatInstructionOperandDebug(runtime, operand, debug.registers))
		.join(' ');
	machineManager.platform.log(
		LogLevel.Error,
		`\tpc=${instruction.pcText} op=${instruction.opName}${operandSummary.length > 0 ? ` ${operandSummary}` : ''}`,
	);
	machineManager.platform.log(LogLevel.Error, `\tinstr=${instruction.pcText}: ${instruction.instructionText}`);
	if (instruction.sourceRange) {
		machineManager.platform.log(LogLevel.Error, `\tsource=${formatDebugSourceLine(instruction.sourceRange)}`);
	}
}

export function handleLuaError(
	fault: RuntimeFaultState,
	sources: RuntimeSourceState,
	runtime: Runtime,
	whatever: unknown,
): void {
	const recorded = recordLuaError(fault, sources, runtime, whatever);
	if (recorded) {
		machineManager.platform.log(LogLevel.Error, recorded.stackText);
		logDebugState(sources, runtime);
	}
}
