import { LuaError, LuaSyntaxError } from '../../toolchain/ts/lua/errors';
import type { LuaCallFrame } from '../language/lua/interpreter/interpreter';
import {
	convertToError,
	extractErrorMessage,
} from '../language/lua/interpreter/value';
import {
	buildErrorStackString,
	buildLuaFrameRawLabel,
	convertLuaCallFrames,
	sanitizeLuaErrorMessage,
} from './error_format';
import { buildLuaStackFrames, type StackTraceFrame } from './stack_trace';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type {
	SuspendedGuestSession,
	SuspendedGuestValue,
} from '../../tooling/ts/runtime/suspended_guest';
import { resolveWorkspacePath } from '../workspace/path';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import {
	resolveRuntimeLuaSource,
	runtimeSourceProjectRootPath,
	type RuntimeSourceState,
} from './sources';
import type { ResourceDomain, ResourceIdentity } from '../common/resource';
import {
	CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD,
	CPU_CAUSE_CODE_ADDRESS_ERROR_STORE,
	CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE,
	CPU_CAUSE_CODE_DATA_BUS_ERROR,
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

type RuntimeErrorLocation = {
	resource: ResourceIdentity;
	line: number;
	column: number;
};
export type RecordedRuntimeLuaError = { error: Error; stackText: string };

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
	readonly functionAddress: number;
	readonly functionIndex: number;
	readonly textAddress: number;
	readonly tracePc: number;
	readonly registers: readonly SuspendedGuestValue[];
	readonly upvalues: readonly SuspendedGuestValue[];
};

export type RuntimeFaultState = {
	handledLuaErrors: WeakSet<object>;
	lastLuaCallStack: StackTraceFrame[];
	lastCpuFaultSnapshot: RuntimeCpuFaultFrame[];
	lastCpuFaultExecutionDomainId: ExecutionDomainId;
	lastCpuFaultPc: number;
	faultSnapshot: FaultSnapshot;
	faultOverlayNeedsFlush: boolean;
	hostFrameFailed: boolean;
};

const EMPTY_LUA_CALL_FRAMES: ReadonlyArray<LuaCallFrame> = [];
const EMPTY_STACK_TRACE_FRAMES: ReadonlyArray<StackTraceFrame> = [];

export function createRuntimeFaultState(): RuntimeFaultState {
	return {
		handledLuaErrors: new WeakSet<object>(),
		lastLuaCallStack: [],
		lastCpuFaultSnapshot: [],
		lastCpuFaultExecutionDomainId: -1,
		lastCpuFaultPc: 0,
		faultSnapshot: null,
		faultOverlayNeedsFlush: false,
		hostFrameFailed: false,
	};
}


export function resetHandledLuaErrors(fault: RuntimeFaultState): void {
	fault.handledLuaErrors = new WeakSet<object>();
}

function resolveStackFrameWorkspacePath(
	sources: RuntimeSourceState,
	resource: ResourceIdentity,
): string {
	return resolveWorkspacePath(
		resource.path,
		runtimeSourceProjectRootPath(sources, resource.domain),
	);
}

function luaErrorSourcePath(error: LuaError): string {
	return error.path.startsWith('@') ? error.path.slice(1) : error.path;
}

function runtimeLuaErrorLocation(
	sources: RuntimeSourceState,
	domain: ResourceDomain,
	error: LuaError,
): RuntimeErrorLocation {
	const match = resolveRuntimeLuaSource(sources, {
		domain,
		path: luaErrorSourcePath(error),
	})!;
	return {
		resource: { domain, path: match.record.source_path },
		line: error.line,
		column: error.column,
	};
}

function runtimeStackFrameLocation(
	frame: StackTraceFrame,
): RuntimeErrorLocation {
	return {
		resource: frame.resource,
		line: frame.line,
		column: frame.column,
	};
}

function resolveRuntimeErrorLocation(
	fault: RuntimeFaultState,
	sources: RuntimeSourceState,
	error: Error,
): RuntimeErrorLocation {
	if (fault.lastLuaCallStack.length > 0) {
		return runtimeStackFrameLocation(fault.lastLuaCallStack[0]);
	}
	if (error instanceof LuaError) {
		return runtimeLuaErrorLocation(sources, sources.activeCartridgeSlot, error);
	}
	return {
		resource: {
			domain: sources.activeCartridgeSlot,
			path: sources.activeLuaSources.entrySourcePath,
		},
		line: 0,
		column: 0,
	};
}

function createLuaErrorStackFrame(
	sources: RuntimeSourceState,
	error: LuaError,
	functionName: string,
	domain: ResourceDomain,
): StackTraceFrame {
	const source = luaErrorSourcePath(error);
	const sourceRecord = resolveRuntimeLuaSource(sources, { domain, path: source })!.record;
	return {
		resource: { domain, path: sourceRecord.source_path },
		functionName,
		source,
		line: error.line,
		column: error.column,
		raw: buildLuaFrameRawLabel(functionName, source),
	};
}

function errorStackFunctionName(callFrames: ReadonlyArray<LuaCallFrame>, luaFrames: ReadonlyArray<StackTraceFrame>): string {
	if (callFrames.length > 0) {
		return callFrames[callFrames.length - 1].functionName;
	}
	if (luaFrames.length > 0) {
		return luaFrames[0].functionName;
	}
	return null;
}

export function clearFaultSnapshot(fault: RuntimeFaultState): void {
	fault.faultSnapshot = null;
	fault.lastCpuFaultSnapshot = [];
	fault.lastCpuFaultExecutionDomainId = -1;
	fault.lastCpuFaultPc = 0;
	fault.faultOverlayNeedsFlush = false;
	fault.hostFrameFailed = false;
}

function setRuntimeFault(fault: RuntimeFaultState, payload: {
	message: string;
	resource: ResourceIdentity;
	line: number;
	column: number;
	details: RuntimeErrorDetails;
}): void {
	fault.faultSnapshot = payload;
	fault.faultOverlayNeedsFlush = true;
}

function captureRuntimeCpuFaultFrames(
	sources: RuntimeSourceState,
	runtime: Runtime,
	frameDepth: number,
	lastExecutionDomainId: ExecutionDomainId,
	lastPc: number,
): RuntimeCpuFaultFrame[] {
	const cpu = runtime.machine.cpu;
	const frames = new Array<RuntimeCpuFaultFrame>(frameDepth);
	for (let frameIndex = 0; frameIndex < frameDepth; frameIndex += 1) {
		const executionDomainId = cpu.readFrameExecutionDomain(frameIndex);
		const image = blua32ToolingImageForDomain(sources.currentBlua32Media, executionDomainId);
		if (!image) {
			throw new Error('Active BLua32 frame has no tooling image.');
		}
		const functionAddress = cpu.readFrameFunctionAddress(frameIndex);
		const functionIndex = blua32FunctionIndexAtAddress(image.layout, functionAddress);
		const functionRecord = image.layout.functions[functionIndex];
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
			functionAddress,
			functionIndex,
			textAddress: image.layout.header.textAddress,
			tracePc: frameIndex + 1 < frameDepth
				? cpu.readFrameCallSitePc(frameIndex + 1)
				: lastExecutionDomainId === executionDomainId
					&& lastPc >= functionRecord.codeAddress
					&& lastPc < functionRecord.codeAddress + functionRecord.codeByteCount
					? lastPc
					: cpu.readFramePc(frameIndex),
			registers,
			upvalues,
		};
	}
	return frames;
}

export function recordLuaError(
	fault: RuntimeFaultState,
	sources: RuntimeSourceState,
	runtime: Runtime,
	whatever: unknown,
): RecordedRuntimeLuaError | null {
	const error = convertToError(whatever);
	if (fault.handledLuaErrors.has(error)) {
		return null;
	}
	const cpu = runtime.machine.cpu;
	const lastExecutionDomainId = cpu.readLastExecutionDomain();
	const lastPc = cpu.lastPc;
	fault.lastCpuFaultExecutionDomainId = lastExecutionDomainId;
	fault.lastCpuFaultPc = lastPc;
	fault.lastCpuFaultSnapshot = captureRuntimeCpuFaultFrames(
		sources,
		runtime,
		cpu.getFrameDepth(),
		lastExecutionDomainId,
		lastPc,
	);
	fault.lastLuaCallStack = buildLuaStackFrames(sources, fault.lastCpuFaultSnapshot);
	const message = sanitizeLuaErrorMessage(extractErrorMessage(error));
	const location = resolveRuntimeErrorLocation(fault, sources, error);
	const runtimeDetails = buildRuntimeErrorDetails(fault, sources, error);
	const stackFrames = runtimeDetails ? runtimeDetails.luaStack : EMPTY_STACK_TRACE_FRAMES;
	const stackText = buildErrorStackString(
		error instanceof Error && error.name ? error.name : 'Error',
		message,
		stackFrames,
	);
	setRuntimeFault(fault, {
		message,
		resource: location.resource,
		line: location.line,
		column: location.column,
		details: runtimeDetails,
	});
	if (error instanceof Error) {
		error.message = message;
		error.stack = stackText;
	}
	fault.handledLuaErrors.add(error);
	return { error, stackText };
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
	fault.lastLuaCallStack = buildLuaStackFrames(sources, fault.lastCpuFaultSnapshot);
	let name = 'CPU exception';
	let message: string;
	switch (causeCode) {
		case CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD:
			message = `Address error load at ${formatNumberAsHex(memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS), 8)}.`;
			break;
		case CPU_CAUSE_CODE_ADDRESS_ERROR_STORE:
			message = `Address error store at ${formatNumberAsHex(memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS), 8)}.`;
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
	const location = runtimeStackFrameLocation(fault.lastLuaCallStack[0]);
	const details = buildRuntimeErrorDetails(fault, sources);
	const stackText = buildErrorStackString(name, message, details.luaStack);
	setRuntimeFault(fault, {
		message,
		resource: location.resource,
		line: location.line,
		column: location.column,
		details,
	});
	return stackText;
}

function buildRuntimeErrorDetails(
	fault: RuntimeFaultState,
	sources: RuntimeSourceState,
	error?: unknown,
	callStack?: ReadonlyArray<LuaCallFrame>,
): RuntimeErrorDetails {
	if (error instanceof LuaSyntaxError) {
		return null;
	}
	let callFrames: ReadonlyArray<LuaCallFrame>;
	let luaFrames: StackTraceFrame[] = [];
	if (callStack) {
		callFrames = callStack;
		luaFrames = callFrames.length > 0
			? convertLuaCallFrames(callFrames, sources, sources.activeCartridgeSlot)
			: [];
	} else {
		callFrames = EMPTY_LUA_CALL_FRAMES;
		if (fault.lastLuaCallStack.length > 0) {
			luaFrames = fault.lastLuaCallStack.slice();
		}
	}
	if (error instanceof LuaError) {
		luaFrames[0] = createLuaErrorStackFrame(
			sources,
			error,
			errorStackFunctionName(callFrames, luaFrames),
			luaFrames.length > 0
				? luaFrames[0].resource.domain
				: sources.activeCartridgeSlot,
		);
	}
	if (luaFrames.length > 0) {
		for (const frame of luaFrames) {
			const source = frame.source;
			if (!source || source.length === 0) {
				continue;
			}
			frame.workspacePath = resolveStackFrameWorkspacePath(sources, frame.resource);
		}
	}
	if (luaFrames.length === 0) {
		return null;
	}
	return {
		luaStack: luaFrames,
	};
}
