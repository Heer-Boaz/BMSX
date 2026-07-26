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
import type { CpuFrameSnapshot } from '../../machine/ts/machine/cpu/cpu';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { resolveWorkspacePath } from '../workspace/path';
import type { RuntimeSourceState } from './sources';

type RuntimeErrorLocation = { path: string; line: number; column: number };
export type RecordedRuntimeLuaError = { error: Error; stackText: string };

export type RuntimeFaultState = {
	handledLuaErrors: WeakSet<object>;
	lastLuaCallStack: StackTraceFrame[];
	lastCpuFaultSnapshot: CpuFrameSnapshot[];
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
	fault.lastCpuFaultSnapshot = runtime.machine.cpu.snapshotCallStack();
	fault.lastLuaCallStack = buildLuaStackFrames(sources, runtime);
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
