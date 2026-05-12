import { LuaError, LuaSyntaxError } from '../../lua/errors';
import type { LuaCallFrame } from '../../lua/runtime';
import {
	convertToError,
	extractErrorMessage,
	type LuaDebuggerPauseSignal,
	type StackTraceFrame,
} from '../../lua/value';
import type { FaultSnapshot, RuntimeErrorDetails } from '../common/models';
import {
	buildErrorStackString,
	buildLuaFrameRawLabel,
	convertLuaCallFrames,
	parseJsStackFrames,
	sanitizeLuaErrorMessage,
} from '../common/runtime_error_format';
import { buildLuaStackFrames } from '../../machine/firmware/globals';
import type { CpuFrameSnapshot } from '../../machine/cpu/cpu';
import type { Runtime } from '../../machine/runtime/runtime';
import { resolveWorkspacePath } from '../workspace/path';

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

export function createRuntimeFaultState(): RuntimeFaultState {
	return {
		handledLuaErrors: new WeakSet<object>(),
		lastLuaCallStack: [],
		lastCpuFaultSnapshot: [],
		faultSnapshot: null,
		faultOverlayNeedsFlush: false,
	};
}

export function resetHandledLuaErrors(runtime: Runtime): void {
	runtime.workbenchFaultState.handledLuaErrors = new WeakSet<object>();
}

function resolveEditorSourceWorkspacePath(runtime: Runtime, source: string): string {
	const cart = runtime.cartLuaSources;
	if (cart && cart.path2lua[source]) {
		return resolveWorkspacePath(source, runtime.cartProjectRootPath);
	}
	const engine = runtime.systemLuaSources;
	if (engine && engine.path2lua[source]) {
		return resolveWorkspacePath(source, runtime.systemProjectRootPath);
	}
	return resolveWorkspacePath(source, runtime.cartProjectRootPath);
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

function resolveRuntimeErrorLocation(runtime: Runtime, error: Error): RuntimeErrorLocation {
	const state = runtime.workbenchFaultState;
	if (state.lastLuaCallStack.length > 0) {
		return runtimeStackFrameLocation(state.lastLuaCallStack[0]);
	}
	if (error instanceof LuaError) {
		return runtimeLuaErrorLocation(error);
	}
	return { path: runtime.currentPath, line: 0, column: 0 };
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

export function clearFaultSnapshot(runtime: Runtime): void {
	const state = runtime.workbenchFaultState;
	state.faultSnapshot = null;
	state.lastCpuFaultSnapshot = [];
	state.faultOverlayNeedsFlush = false;
}

export function clearRuntimeFault(runtime: Runtime): void {
	runtime.luaRuntimeFailed = false;
	clearFaultSnapshot(runtime);
}

function setRuntimeFault(runtime: Runtime, payload: {
	message: string;
	path: string;
	line: number;
	column: number;
	details: RuntimeErrorDetails;
	fromDebugger: boolean;
}): void {
	const state = runtime.workbenchFaultState;
	runtime.luaRuntimeFailed = true;
	state.faultSnapshot = payload;
	state.faultSnapshot.timestampMs = runtime.clock.dateNow();
	state.faultOverlayNeedsFlush = true;
}

export function recordDebuggerExceptionFault(runtime: Runtime, signal: LuaDebuggerPauseSignal): void {
	const exception = runtime.pauseCoordinator.getPendingException();
	const state = runtime.workbenchFaultState;
	if (state.faultSnapshot && runtime.luaRuntimeFailed) {
		state.faultOverlayNeedsFlush = true;
		return;
	}
	if (!exception) {
		setRuntimeFault(runtime, {
			message: 'Runtime error',
			path: signal.location.path,
			line: signal.location.line,
			column: signal.location.column,
			details: buildRuntimeErrorDetailsForEditor(runtime, null, 'Runtime error', signal.callStack),
			fromDebugger: true,
		});
		return;
	}
	const message = sanitizeLuaErrorMessage(extractErrorMessage(exception));
	const location = runtimeLuaErrorLocation(exception);
	setRuntimeFault(runtime, {
		message,
		path: location.path,
		line: location.line,
		column: location.column,
		details: buildRuntimeErrorDetailsForEditor(runtime, exception, message, signal.callStack),
		fromDebugger: true,
	});
}

export function recordLuaError(runtime: Runtime, whatever: unknown): RecordedRuntimeLuaError | null {
	const error = convertToError(whatever);
	const state = runtime.workbenchFaultState;
	if (state.handledLuaErrors.has(error)) {
		return null;
	}
	state.lastCpuFaultSnapshot = runtime.machine.cpu.snapshotCallStack();
	state.lastLuaCallStack = buildLuaStackFrames(runtime);
	const message = sanitizeLuaErrorMessage(extractErrorMessage(error));
	const location = resolveRuntimeErrorLocation(runtime, error);
	const runtimeDetails = buildRuntimeErrorDetailsForEditor(runtime, error, message);
	const stackText = buildErrorStackString(
		error instanceof Error && error.name ? error.name : 'Error',
		message,
		runtimeDetails,
		runtime.jsStackEnabled,
	);
	setRuntimeFault(runtime, {
		message,
		path: location.path,
		line: location.line,
		column: location.column,
		details: runtimeDetails,
		fromDebugger: false,
	});
	if (error instanceof Error) {
		error.message = message;
		error.stack = stackText;
	}
	state.handledLuaErrors.add(error);
	return { error, stackText };
}

function buildRuntimeErrorDetailsForEditor(runtime: Runtime, error: unknown, message: string, callStack?: ReadonlyArray<LuaCallFrame>): RuntimeErrorDetails {
	if (error instanceof LuaSyntaxError) {
		return null;
	}
	const useInterpreterStack = callStack !== undefined;
	const callFrames = callStack === undefined ? EMPTY_LUA_CALL_FRAMES : callStack;
	let luaFrames: StackTraceFrame[] = [];
	if (useInterpreterStack) {
		luaFrames = callFrames.length > 0 ? convertLuaCallFrames(callFrames) : [];
	} else {
		const state = runtime.workbenchFaultState;
		if (state.lastLuaCallStack.length > 0) {
			luaFrames = state.lastLuaCallStack.slice();
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
			frame.pathPath = resolveEditorSourceWorkspacePath(runtime, source);
		}
	}
	let stackText: string = null;
	if (runtime.jsStackEnabled && error instanceof Error && typeof error.stack === 'string') {
		stackText = error.stack;
	}
	const jsFrames = runtime.jsStackEnabled ? parseJsStackFrames(stackText) : [];
	if (luaFrames.length === 0 && jsFrames.length === 0) {
		return null;
	}
	return {
		message,
		luaStack: luaFrames,
		jsStack: jsFrames,
	};
}
