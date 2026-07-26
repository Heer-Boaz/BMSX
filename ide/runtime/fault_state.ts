import { LuaError, LuaSyntaxError } from '../../machine/ts/lua/errors';
import type { LuaCallFrame } from '../language/lua/interpreter/interpreter';
import {
	convertToError,
	extractErrorMessage,
	type StackTraceFrame,
} from '../language/lua/interpreter/value';
import type { FaultSnapshot, RuntimeErrorDetails } from '../common/models';
import {
	buildErrorStackString,
	buildLuaFrameRawLabel,
	convertLuaCallFrames,
	sanitizeLuaErrorMessage,
} from '../common/runtime_error_format';
import { buildLuaStackFrames } from './stack_trace';
import { blua32FunctionIndexAtAddress } from '../../machine/ts/machine/cpu/blua32_image';
import type { ExecutionDomainId } from '../../machine/ts/machine/cpu/execution_address_space';
import type { Value } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { resolveWorkspacePath } from '../workspace/path';
import { blua32ToolingImageForDomain } from './blua32_media';
import type { RuntimeSourceState } from './sources';

type RuntimeErrorLocation = { path: string; line: number; column: number };
export type RecordedRuntimeLuaError = { error: Error; stackText: string };

export type RuntimeCpuFaultFrame = {
	readonly executionDomainId: ExecutionDomainId;
	readonly functionAddress: number;
	readonly functionIndex: number;
	readonly textAddress: number;
	readonly tracePc: number;
	readonly registers: readonly Value[];
	readonly upvalues: readonly Value[];
};

export type RuntimeFaultState = {
	handledLuaErrors: WeakSet<object>;
	lastLuaCallStack: StackTraceFrame[];
	lastCpuFaultSnapshot: RuntimeCpuFaultFrame[];
	lastCpuFaultExecutionDomainId: ExecutionDomainId;
	lastCpuFaultPc: number;
	faultSnapshot: FaultSnapshot;
	faultOverlayNeedsFlush: boolean;
};

const EMPTY_LUA_CALL_FRAMES: ReadonlyArray<LuaCallFrame> = [];
const EMPTY_STACK_TRACE_FRAMES: StackTraceFrame[] = [];

export function createRuntimeFaultState(): RuntimeFaultState {
	return {
		handledLuaErrors: new WeakSet<object>(),
		lastLuaCallStack: [],
		lastCpuFaultSnapshot: [],
		lastCpuFaultExecutionDomainId: -1,
		lastCpuFaultPc: 0,
		faultSnapshot: null,
		faultOverlayNeedsFlush: false,
	};
}


export function resetHandledLuaErrors(fault: RuntimeFaultState): void {
	fault.handledLuaErrors = new WeakSet<object>();
}

function resolveEditorSourceWorkspacePath(sources: RuntimeSourceState, source: string): string {
	for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
		const cartridge = sources.cartridgeSlots[slot];
		if (cartridge && cartridge.luaSources.path2lua[source]) {
			return resolveWorkspacePath(source, cartridge.projectRootPath);
		}
	}
	if (sources.systemLuaSources.path2lua[source]) {
		return resolveWorkspacePath(source, sources.systemProjectRootPath);
	}
	return source;
}

function luaErrorSourcePath(error: LuaError): string {
	return error.path.startsWith('@') ? error.path.slice(1) : error.path;
}

function runtimeLuaErrorLocation(error: LuaError): RuntimeErrorLocation {
	return {
		path: luaErrorSourcePath(error),
		line: error.line,
		column: error.column,
	};
}

function runtimeStackFrameLocation(frame: StackTraceFrame): RuntimeErrorLocation {
	return {
		path: frame.source,
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
		return runtimeLuaErrorLocation(error);
	}
	return { path: sources.activeLuaSources.entry_path, line: 0, column: 0 };
}

function createLuaErrorStackFrame(error: LuaError, functionName: string): StackTraceFrame {
	const source = luaErrorSourcePath(error);
	return {
		origin: 'lua',
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
}

export function clearRuntimeFault(fault: RuntimeFaultState, runtime: Runtime): void {
	runtime.luaRuntimeFailed = false;
	clearFaultSnapshot(fault);
}

function setRuntimeFault(fault: RuntimeFaultState, runtime: Runtime, payload: {
	message: string;
	path: string;
	line: number;
	column: number;
	details: RuntimeErrorDetails;
}): void {
	runtime.luaRuntimeFailed = true;
	fault.faultSnapshot = payload;
	fault.faultOverlayNeedsFlush = true;
}

function captureRuntimeCpuFaultFrames(
	sources: RuntimeSourceState,
	runtime: Runtime,
	lastExecutionDomainId: ExecutionDomainId,
	lastPc: number,
): RuntimeCpuFaultFrame[] {
	const cpu = runtime.machine.cpu;
	const frameDepth = cpu.getFrameDepth();
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
		const registers = new Array<Value>(registerCount);
		for (let registerIndex = 0; registerIndex < registerCount; registerIndex += 1) {
			registers[registerIndex] = cpu.readFrameRegister(frameIndex, registerIndex);
		}
		const upvalueCount = cpu.getFrameUpvalueCount(frameIndex);
		const upvalues = new Array<Value>(upvalueCount);
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
		lastExecutionDomainId,
		lastPc,
	);
	fault.lastLuaCallStack = buildLuaStackFrames(sources, fault.lastCpuFaultSnapshot);
	const message = sanitizeLuaErrorMessage(extractErrorMessage(error));
	const location = resolveRuntimeErrorLocation(fault, sources, error);
	const runtimeDetails = buildRuntimeErrorDetailsForEditor(fault, sources, error, message);
	const stackText = buildErrorStackString(
		error instanceof Error && error.name ? error.name : 'Error',
		message,
		runtimeDetails,
		false,
	);
	setRuntimeFault(fault, runtime, {
		message,
		path: location.path,
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

function buildRuntimeErrorDetailsForEditor(
	fault: RuntimeFaultState,
	sources: RuntimeSourceState,
	error: unknown,
	message: string,
	callStack?: ReadonlyArray<LuaCallFrame>,
): RuntimeErrorDetails {
	if (error instanceof LuaSyntaxError) {
		return null;
	}
	let callFrames: ReadonlyArray<LuaCallFrame>;
	let luaFrames: StackTraceFrame[] = [];
	if (callStack) {
		callFrames = callStack;
		luaFrames = callFrames.length > 0 ? convertLuaCallFrames(callFrames) : [];
	} else {
		callFrames = EMPTY_LUA_CALL_FRAMES;
		if (fault.lastLuaCallStack.length > 0) {
			luaFrames = fault.lastLuaCallStack.slice();
		}
	}
	if (error instanceof LuaError) {
		luaFrames[0] = createLuaErrorStackFrame(error, errorStackFunctionName(callFrames, luaFrames));
	}
	if (luaFrames.length > 0) {
		for (const frame of luaFrames) {
			const source = frame.source;
			if (!source || source.length === 0) {
				continue;
			}
			frame.pathPath = resolveEditorSourceWorkspacePath(sources, source);
		}
	}
	if (luaFrames.length === 0) {
		return null;
	}
	return {
		message,
		luaStack: luaFrames,
		jsStack: EMPTY_STACK_TRACE_FRAMES,
	};
}
