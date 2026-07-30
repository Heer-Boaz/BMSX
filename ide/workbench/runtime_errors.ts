import {
	describeBlua32InstructionAtPc,
	type InstructionOperandDebugInfo,
} from '../../toolchain/ts/rompack/disassembler';
import type { SourceRange } from '../../toolchain/ts/lua/source_range';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import {
	type SuspendedGuestSession,
	type SuspendedGuestValue,
} from '../../tooling/ts/runtime/suspended_guest';
import { LogLevel, type LogOutput } from '../../hosts/common/log';
import { recordLuaError, type RuntimeFaultState } from '../runtime/fault_state';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import type { RuntimeSourceState } from '../runtime/sources';

const EMPTY_REGISTER_VALUES: readonly SuspendedGuestValue[] = [];

function formatInstructionOperandDebug(
	session: SuspendedGuestSession,
	operand: InstructionOperandDebugInfo,
	registers: ReadonlyArray<SuspendedGuestValue>,
): string {
	let text = `${operand.label}=${operand.text}`;
	if (operand.registerIndex >= 0 && operand.registerIndex < registers.length) {
		text += `(${session.formatValue(registers[operand.registerIndex])})`;
	}
	return text;
}

function formatDebugSourceLine(range: SourceRange): string {
	return `${range.path}:${range.start.line}:${range.start.column}`;
}

function logFaultInstruction(
	logOutput: LogOutput,
	fault: RuntimeFaultState,
	sources: RuntimeSourceState,
	session: SuspendedGuestSession,
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
		.map(operand => formatInstructionOperandDebug(session, operand, registers))
		.join(' ');
	logOutput.log(
		LogLevel.Error,
		`\tpc=${instruction.pcText} op=${instruction.opName}${operandSummary.length > 0 ? ` ${operandSummary}` : ''}`,
	);
	logOutput.log(LogLevel.Error, `\tinstr=${instruction.pcText}: ${instruction.instructionText}`);
	if (instruction.sourceRange) {
		logOutput.log(LogLevel.Error, `\tsource=${formatDebugSourceLine(instruction.sourceRange)}`);
	}
}

export function handleLuaError(
	logOutput: LogOutput,
	fault: RuntimeFaultState,
	sources: RuntimeSourceState,
	runtime: Runtime,
	session: SuspendedGuestSession,
	whatever: unknown,
): void {
	const recorded = recordLuaError(fault, sources, runtime, whatever);
	if (recorded) {
		logOutput.log(LogLevel.Error, recorded.stackText);
		logFaultInstruction(logOutput, fault, sources, session);
	}
}
