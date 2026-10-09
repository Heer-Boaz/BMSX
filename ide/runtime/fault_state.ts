import {
	buildErrorStackString,
	sanitizeLuaErrorMessage,
} from './error_format';
import {
	buildLuaStackFrames,
	createLuaSourceStackTraceFrame,
	type SourceStackTraceFrame,
	type StackTraceFrame,
} from './stack_trace';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import type { Blua32ToolingImage } from '../../toolchain/ts/rompack/blua32_media';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type {
	SuspendedGuestSession,
	SuspendedGuestValue,
} from './suspended_guest';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import type { RuntimeSourceState } from './sources';
import type { ResourceIdentity } from '../common/resource';
import {
	CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD,
	CPU_CAUSE_CODE_ADDRESS_ERROR_STORE,
	CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR,
	CPU_CAUSE_CODE_DATA_BUS_ERROR,
	CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE,
	CPU_CAUSE_CODE_MASK,
	CPU_CAUSE_CODE_TRAP,
} from '../../machine/ts/spec/blua32/cop0';
import { formatNumberAsHex } from '../../machine/ts/common/byte_hex_string';
import {
	IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS,
	IO_SYS_SUPERVISOR_FAULT_CAUSE,
	IO_SYS_SUPERVISOR_FAULT_DOMAIN,
	IO_SYS_SUPERVISOR_FAULT_EPC,
} from '../../machine/ts/spec/bmsx/io';
import {
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
	BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
} from '../../machine/ts/spec/blua32/image_format';

type RuntimeErrorLocation = {
	resource: ResourceIdentity;
	line: number;
	column: number;
};

export type RuntimeErrorDetails = {
	luaStack: ReadonlyArray<StackTraceFrame>;
};

export type FaultSnapshot = {
	message: string;
	resource: ResourceIdentity;
	line: number;
	column: number;
	details: RuntimeErrorDetails;
};

export type RuntimeCpuFaultFrame = {
	readonly executionDomainId: ExecutionDomainId;
	readonly toolingImage: Blua32ToolingImage;
	readonly functionAddress: number;
	readonly functionIndex: number;
	readonly codeAddress: number;
	readonly codeByteCount: number;
	readonly tracePc: number;
	readonly registers: readonly SuspendedGuestValue[];
	readonly upvalues: readonly SuspendedGuestValue[];
};

export type RuntimeFaultState = {
	supervisorFaultSequence: number;
	lastLuaCallStack: StackTraceFrame[];
	lastCpuFaultSnapshot: RuntimeCpuFaultFrame[];
	lastCpuFaultExecutionDomainId: ExecutionDomainId;
	lastCpuFaultPc: number;
	faultSnapshot: FaultSnapshot;
	faultOverlayNeedsFlush: boolean;
	/** Original host diagnostic, never a guest stack. Cleared only by accepted recovery. */
	hostFrameFailure: string | undefined;
};

export function createRuntimeFaultState(): RuntimeFaultState {
	return {
		supervisorFaultSequence: 0,
		lastLuaCallStack: [],
		lastCpuFaultSnapshot: [],
		lastCpuFaultExecutionDomainId: -1,
		lastCpuFaultPc: 0,
		faultSnapshot: null,
		faultOverlayNeedsFlush: false,
		hostFrameFailure: undefined,
	};
}

function firstSourceStackFrame(
	frames: ReadonlyArray<StackTraceFrame>,
): SourceStackTraceFrame | null {
	for (let index = 0; index < frames.length; index += 1) {
		const frame = frames[index];
		if (frame.kind === 'source') {
			return frame;
		}
	}
	return null;
}

export function clearFaultSnapshot(fault: RuntimeFaultState): void {
	fault.faultSnapshot = null;
	fault.lastLuaCallStack = [];
	fault.lastCpuFaultSnapshot = [];
	fault.lastCpuFaultExecutionDomainId = -1;
	fault.lastCpuFaultPc = 0;
	fault.faultOverlayNeedsFlush = false;
}

function captureRuntimeCpuFaultFrames(
	sources: RuntimeSourceState,
	runtime: Runtime,
	frameDepth: number,
	lastExecutionDomainId: ExecutionDomainId,
	lastPc: number,
): RuntimeCpuFaultFrame[] {
	const cpu = runtime.machine.cpu;
	const memory = runtime.machine.memory;
	const frames = new Array<RuntimeCpuFaultFrame>(frameDepth);
	for (let frameIndex = 0; frameIndex < frameDepth; frameIndex += 1) {
		const executionDomainId = cpu.readFrameExecutionDomain(frameIndex);
		const image = blua32ToolingImageForDomain(sources.currentBlua32Media, executionDomainId);
		if (!image) {
			throw new Error('Active BLua32 frame has no tooling image.');
		}
		const functionAddress = cpu.readFrameFunctionAddress(frameIndex);
		const functionIndex = blua32FunctionIndexAtAddress(image.layout, functionAddress);
		const codeAddress = memory.readMappedU32LE(
			(functionAddress + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET) >>> 0,
		);
		const codeByteCount = memory.readMappedU32LE(
			(functionAddress + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET) >>> 0,
		);
		const registerCount = cpu.getFrameRegisterCount(frameIndex);
		const registers = new Array<SuspendedGuestValue>(registerCount);
		for (let registerIndex = 0; registerIndex < registerCount; registerIndex += 1) {
			registers[registerIndex] = cpu.readFrameRegister(frameIndex, registerIndex);
		}
		const upvalueCount = cpu.getFrameUpvalueCount(frameIndex);
		const upvalues = new Array<SuspendedGuestValue>(upvalueCount);
		for (let upvalueIndex = 0; upvalueIndex < upvalueCount; upvalueIndex += 1) {
			upvalues[upvalueIndex] = cpu.readFrameUpvalue(frameIndex, upvalueIndex);
		}
		frames[frameIndex] = {
			executionDomainId,
			toolingImage: image,
			functionAddress,
			functionIndex,
			codeAddress,
			codeByteCount,
			tracePc: frameIndex + 1 < frameDepth && !cpu.readFrameReturnsToCompletionLatch(frameIndex + 1)
				? cpu.readFrameCallSitePc(frameIndex + 1)
				: lastExecutionDomainId === executionDomainId
					&& lastPc >= codeAddress
					&& lastPc < codeAddress + codeByteCount
					? lastPc
					: cpu.readFramePc(frameIndex),
			registers,
			upvalues,
		};
	}
	return frames;
}

export function recordSupervisorFault(
	fault: RuntimeFaultState,
	sources: RuntimeSourceState,
	runtime: Runtime,
	session: SuspendedGuestSession,
): string {
	const cpu = runtime.machine.cpu;
	const memory = runtime.machine.memory;
	const causeWord = memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_CAUSE);
	const causeCode = causeWord & CPU_CAUSE_CODE_MASK;
	const exceptionFunctionAddress = sources.systemRom.header.blua32ExceptionFunctionAddress;
	let exceptionFrameIndex = cpu.getFrameDepth() - 1;
	while (!cpu.isExceptionFrame(exceptionFrameIndex)
		|| cpu.isNonMaskableExceptionFrame(exceptionFrameIndex)
		|| cpu.readFrameFunctionAddress(exceptionFrameIndex) !== exceptionFunctionAddress) {
		exceptionFrameIndex -= 1;
	}
	const executionDomainId = (memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_DOMAIN) | 0) as ExecutionDomainId;
	const pc = memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_EPC);
	fault.lastCpuFaultExecutionDomainId = executionDomainId;
	fault.lastCpuFaultPc = pc;
	fault.lastCpuFaultSnapshot = captureRuntimeCpuFaultFrames(
		sources,
		runtime,
		exceptionFrameIndex,
		executionDomainId,
		pc,
	);
	fault.lastLuaCallStack = buildLuaStackFrames(fault.lastCpuFaultSnapshot,
		(domain, path, line, column, name) => createLuaSourceStackTraceFrame(sources, domain, path, line, column, name));
	let name = 'CPU exception';
	let message: string;
	switch (causeCode) {
		case CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD:
			message = `Address error load at ${formatNumberAsHex(memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS), 8)}.`;
			break;
		case CPU_CAUSE_CODE_ADDRESS_ERROR_STORE:
			message = `Address error store at ${formatNumberAsHex(memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS), 8)}.`;
			break;
		case CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR:
			message = 'Instruction bus error.';
			break;
		case CPU_CAUSE_CODE_DATA_BUS_ERROR:
			message = 'Data bus error.';
			break;
		case CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE:
			message = 'Coprocessor unusable.';
			break;
		case CPU_CAUSE_CODE_TRAP:
			name = 'Error';
			message = sanitizeLuaErrorMessage(
				session.formatValue(cpu.readFrameRegister(exceptionFrameIndex, 0)),
			);
			break;
		default:
			message = `Cause ${formatNumberAsHex(causeWord, 8)}.`;
			break;
	}
	const sourceFrame = firstSourceStackFrame(fault.lastLuaCallStack);
	let location: RuntimeErrorLocation;
	if (sourceFrame) {
		location = {
			resource: sourceFrame.resource,
			line: sourceFrame.line,
			column: sourceFrame.column,
		};
	} else {
		location = {
			resource: {
				domain: sources.activeCartridgeSlot,
				path: sources.activeLuaSources.entrySourcePath,
			},
			line: 0,
			column: 0,
		};
	}
	const details: RuntimeErrorDetails = { luaStack: fault.lastLuaCallStack };
	const stackText = buildErrorStackString(name, message, details.luaStack);
	fault.faultSnapshot = {
		message,
		resource: location.resource,
		line: location.line,
		column: location.column,
		details,
	};
	fault.faultOverlayNeedsFlush = true;
	return stackText;
}
