import { runtimeWorkbenchState } from './workbench_state';
import { LuaError, LuaSyntaxError } from '../../machine/ts/lua/errors';
import { machineManager } from '../../machine/ts/core/machine_manager';
import type { LuaCallFrame } from '../../machine/ts/lua/runtime';
import {
	convertToError,
	extractErrorMessage,
	type LuaDebuggerPauseSignal,
	type StackTraceFrame,
} from '../../machine/ts/lua/value';
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


export function resetHandledLuaErrors(): void {
	runtimeWorkbenchState.fault.handledLuaErrors = new WeakSet<object>();
}

function resolveEditorSourceWorkspacePath(source: string): string {
	const sources = runtimeWorkbenchState.sources;
	for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
		const cartridge = sources.cartridgeSlots[slot];
		if (cartridge !== null && cartridge.luaSources.path2lua[source]) {
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

function resolveRuntimeErrorLocation(error: Error): RuntimeErrorLocation {
	const state = runtimeWorkbenchState.fault;
	if (state.lastLuaCallStack.length > 0) {
		return runtimeStackFrameLocation(state.lastLuaCallStack[0]);
	}
	if (error instanceof LuaError) {
		return runtimeLuaErrorLocation(error);
	}
	return { path: runtimeWorkbenchState.sources.activeLuaSources.entry_path, line: 0, column: 0 };
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

export function clearFaultSnapshot(): void {
	const state = runtimeWorkbenchState.fault;
	state.faultSnapshot = null;
	state.lastCpuFaultSnapshot = [];
	state.faultOverlayNeedsFlush = false;
}

export function clearRuntimeFault(runtime: Runtime): void {
	runtime.luaRuntimeFailed = false;
	clearFaultSnapshot();
}

function setRuntimeFault(runtime: Runtime, payload: {
	message: string;
	path: string;
	line: number;
	column: number;
	details: RuntimeErrorDetails;
	fromDebugger: boolean;
}): void {
	const state = runtimeWorkbenchState.fault;
	runtime.luaRuntimeFailed = true;
	state.faultSnapshot = payload;
	state.faultSnapshot.timestampMs = machineManager.platform.clock.dateNow();
	state.faultOverlayNeedsFlush = true;
}

export function recordDebuggerExceptionFault(runtime: Runtime, signal: LuaDebuggerPauseSignal): void {
	const exception = runtimeWorkbenchState.ide.debugger.pauseCoordinator.getPendingException();
	const state = runtimeWorkbenchState.fault;
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
			details: buildRuntimeErrorDetailsForEditor(null, 'Runtime error', signal.callStack),
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
		details: buildRuntimeErrorDetailsForEditor(exception, message, signal.callStack),
		fromDebugger: true,
	});
}

export function recordLuaError(runtime: Runtime, whatever: unknown): RecordedRuntimeLuaError | null {
	const error = convertToError(whatever);
	const state = runtimeWorkbenchState.fault;
	if (state.handledLuaErrors.has(error)) {
		return null;
	}
	state.lastCpuFaultSnapshot = runtime.machine.cpu.snapshotCallStack();
	state.lastLuaCallStack = buildLuaStackFrames(runtime);
	const message = sanitizeLuaErrorMessage(extractErrorMessage(error));
	const location = resolveRuntimeErrorLocation(error);
	const runtimeDetails = buildRuntimeErrorDetailsForEditor(error, message);
	const stackText = buildErrorStackString(
		error instanceof Error && error.name ? error.name : 'Error',
		message,
		runtimeDetails,
		false,
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

function buildRuntimeErrorDetailsForEditor(error: unknown, message: string, callStack?: ReadonlyArray<LuaCallFrame>): RuntimeErrorDetails {
	if (error instanceof LuaSyntaxError) {
		return null;
	}
	const useInterpreterStack = callStack !== undefined;
	const callFrames = callStack === undefined ? EMPTY_LUA_CALL_FRAMES : callStack;
	let luaFrames: StackTraceFrame[] = [];
	if (useInterpreterStack) {
		luaFrames = callFrames.length > 0 ? convertLuaCallFrames(callFrames) : [];
	} else {
		const state = runtimeWorkbenchState.fault;
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
			frame.pathPath = resolveEditorSourceWorkspacePath(source);
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
