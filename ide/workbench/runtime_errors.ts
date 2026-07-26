import { machineManager } from '../../machine/ts/core/machine_manager';
import {
	describeBlua32InstructionAtPc,
	type InstructionOperandDebugInfo,
} from '../../machine/ts/machine/cpu/disassembler';
import type { SourceRange } from '../../machine/ts/machine/cpu/blua32_symbols';
import { valueToString, type Value } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { LogLevel } from '../../machine/ts/platform/platform';
import { recordLuaError, type RuntimeFaultState } from '../runtime/fault_state';
import { blua32ToolingImageForDomain } from '../runtime/blua32_media';
import type { RuntimeSourceState } from '../runtime/sources';

const EMPTY_REGISTER_VALUES: readonly Value[] = [];

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

function logFaultInstruction(
	fault: RuntimeFaultState,
	sources: RuntimeSourceState,
	runtime: Runtime,
): void {
	const snapshot = fault.lastCpuFaultSnapshot;
	const executionDomainId = fault.lastCpuFaultExecutionDomainId;
	const pc = fault.lastCpuFaultPc;
	const image = blua32ToolingImageForDomain(sources.currentBlua32Media, executionDomainId);
	if (!image) {
		throw new Error('Captured BLua32 fault frame has no tooling image.');
	}
	let registers = EMPTY_REGISTER_VALUES;
	for (let frameIndex = snapshot.length - 1; frameIndex >= 0; frameIndex -= 1) {
		const frame = snapshot[frameIndex];
		if (frame.executionDomainId !== executionDomainId) {
			continue;
		}
		const functionRecord = image.layout.functions[frame.functionIndex];
		if (pc >= functionRecord.codeAddress
			&& pc < functionRecord.codeAddress + functionRecord.codeByteCount) {
			registers = frame.registers;
			break;
		}
	}
	const instruction = describeBlua32InstructionAtPc(
		image.layout,
		image.symbols,
		pc,
	);
	const operandSummary = instruction.operands
		.map(operand => formatInstructionOperandDebug(runtime, operand, registers))
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
		logFaultInstruction(fault, sources, runtime);
	}
}
