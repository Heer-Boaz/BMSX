import { $ } from '../../core/engine_core';
import { Input } from '../../input/input';
import { KeyModifier } from '../../input/playerinput';
import { LuaError, LuaRuntimeError, LuaSyntaxError } from '../../lua/luaerrors';
import type { ExecutionSignal, LuaCallFrame } from '../../lua/luaruntime';
import {
	convertToError,
	extractErrorMessage,
	type LuaDebuggerPauseSignal,
	type StackTraceFrame,
} from '../../lua/luavalue';
import { publishOverlayFrame } from '../../render/editor/editor_overlay_queue';
import { clamp_fallback } from '../../common/clamp';
import * as constants from '../common/constants';
import { TERMINAL_TOGGLE_KEY, EDITOR_TOGGLE_GAMEPAD_BUTTONS, EDITOR_TOGGLE_KEY, GAME_PAUSE_KEY } from '../common/constants';
import { editorDebuggerState } from '../workbench/contrib/debugger/debugger_state';
import { showEditorWarningBanner } from '../workbench/common/feedback_state';
import type { RuntimeErrorDetails } from '../common/types';
import { setEditorCaseInsensitivity } from '../editor/render/text_renderer';
import { buildLuaStackFrames } from '../../machine/firmware/lua_globals';
import { seedDefaultLuaBuiltins } from '../../machine/firmware/lua_builtins';
import {
	buildErrorStackString,
	buildLuaFrameRawLabel,
	convertLuaCallFrames,
	parseJsStackFrames,
	sanitizeLuaErrorMessage,
} from '../editor/contrib/runtime_error/runtime_error_util';
import { logDebugState } from '../../machine/runtime/runtime_debug';
import { TerminalMode } from '../terminal/ui/terminal_mode';
import type { Runtime } from '../../machine/runtime/runtime';
import type { RuntimeOptions } from '../../machine/runtime/types';
import { resolveWorkspacePath } from '../workspace/workspace_path';
import { shallowcopy } from '../../common/shallowcopy';
import { api as overlay_api } from '../editor/ui/view/overlay_api';
import { createCartEditor } from '../cart_editor';
import { clearExecutionStopHighlights, setExecutionStopHighlight } from '../editor/contrib/runtime_error/runtime_error_navigation';

class DebugPauseCoordinator {
	private suspension: LuaDebuggerPauseSignal = null;
	private pendingException: LuaRuntimeError | LuaError = null;

	public capture(suspension: LuaDebuggerPauseSignal, pendingException: LuaRuntimeError | LuaError): void {
		this.suspension = suspension;
		this.pendingException = pendingException;
	}

	public hasSuspension(): boolean {
		return this.suspension !== null;
	}

	public getSuspension(): LuaDebuggerPauseSignal {
		return this.suspension;
	}

	public getPendingException(): LuaRuntimeError | LuaError {
		return this.pendingException;
	}

	public clearSuspension(): void {
		this.suspension = null;
		this.pendingException = null;
	}
}

type DebuggerStepOrigin = { path: string; line: number; depth: number };
type RenderTargetVec2 = { x: number; y: number };
type RenderTargetSnapshot = {
	viewportSize: RenderTargetVec2;
	canvasSize: RenderTargetVec2;
	offscreenSize: RenderTargetVec2;
};
type TargetOwner = 'editor';
type RenderTargetState = {
	baseline?: RenderTargetSnapshot;
	stack: TargetOwner[];
};

export const EDITOR_TARGET: RenderTargetVec2 = { x: 384, y: 288 };
// export const EDITOR_TARGET: RenderTargetVec2 = { x: 768, y: 576 };
// export const EDITOR_TARGET: RenderTargetVec2 = { x: 512, y: 384 };
const RT_STATE = new WeakMap<Runtime, RenderTargetState>();

function getRenderTargetState(runtime: Runtime): RenderTargetState {
	let state = RT_STATE.get(runtime);
	if (!state) {
		state = { stack: [] };
		RT_STATE.set(runtime, state);
	}
	return state;
}

function captureCurrentTargets(): RenderTargetSnapshot {
	const view = $.view;
	return {
		viewportSize: shallowcopy(view.viewportSize),
		canvasSize: shallowcopy(view.canvasSize),
		offscreenSize: shallowcopy(view.offscreenCanvasSize),
	};
}

function applyFixedEditorTargets(runtime: Runtime): void {
	$.view.configureRenderTargets({
		viewportSize: EDITOR_TARGET,
		canvasSize: EDITOR_TARGET,
		offscreenSize: EDITOR_TARGET,
	});
	runtime.overlayResolutionMode = 'viewport';
}

function restoreTargets(runtime: Runtime, snapshot: RenderTargetSnapshot): void {
	$.view.configureRenderTargets({
		viewportSize: snapshot.viewportSize,
		canvasSize: snapshot.canvasSize,
		offscreenSize: snapshot.offscreenSize,
	});
	runtime.overlayResolutionMode = 'viewport';
}

function pushRenderTargetOwner(runtime: Runtime, owner: TargetOwner): void {
	const state = getRenderTargetState(runtime);
	if (!state.baseline) {
		state.baseline = captureCurrentTargets();
	}
	if (state.stack.includes(owner)) {
		return;
	}
	state.stack.push(owner);
	switch (owner) {
		case 'editor':
			applyFixedEditorTargets(runtime);
			return;
	}
}

function popRenderTargetOwner(runtime: Runtime, owner: TargetOwner): void {
	const state = RT_STATE.get(runtime);
	if (!state) {
		return;
	}
	for (let i = state.stack.length - 1; i >= 0; i -= 1) {
		if (state.stack[i] === owner) {
			state.stack.splice(i, 1);
		}
	}
	if (state.stack.length === 0) {
		restoreTargets(runtime, state.baseline!);
		RT_STATE.delete(runtime);
		return;
	}
	const top = state.stack[state.stack.length - 1];
	switch (top) {
		case 'editor':
			applyFixedEditorTargets(runtime);
			return;
	}
}

function editorBlocksRuntimePipeline(runtime: Runtime): boolean {
	return runtime.editor !== null && runtime.editor.blocksRuntimePipeline === true;
}

function isManagedOverlayEditorActive(runtime: Runtime): boolean {
	if (!editorBlocksRuntimePipeline(runtime)) {
		return false;
	}
	return runtime.editor!.isActive;
}

function resolveEditorSourceWorkspacePath(runtime: Runtime, source: string): string {
	const cart = runtime.cartLuaSources;
	if (cart && cart.path2lua[source]) {
		return resolveWorkspacePath(source, $.cart_project_root_path);
	}
	const engine = runtime.engineLuaSources;
	if (engine && engine.path2lua[source]) {
		const engineRoot = $.engine_layer.index.projectRootPath || 'src/bmsx';
		return resolveWorkspacePath(source, engineRoot);
	}
	return resolveWorkspacePath(source, $.cart_project_root_path);
}

export function createPauseCoordinator(): DebugPauseCoordinator {
	return new DebugPauseCoordinator();
}

export function initializeIdeFeatures(runtime: Runtime, options: RuntimeOptions): void {
	constants.setIdeThemeVariant(constants.DEFAULT_THEME);
	runtime.terminal = new TerminalMode(runtime);
	runtime.editor = createCartEditor(options.viewport);
	runtime.overlayResolutionMode = 'viewport';
	Input.instance.setKeyboardCapture(EDITOR_TOGGLE_KEY, true);
	seedDefaultLuaBuiltins();
	flushLuaWarnings(runtime);
	registerRuntimeShortcuts(runtime);
	setDebuggerBreakpoints(runtime, editorDebuggerState.breakpoints);
	updateGamePipelineExts(runtime);
}

export function applyCanonicalization(canonicalization: boolean): void {
	setEditorCaseInsensitivity(canonicalization);
}

export function setActiveIdeFontVariant(runtime: Runtime, variant: Runtime['activeIdeFontVariant']): void {
	runtime._activeIdeFontVariant = variant;
	runtime.terminal.setFontVariant(variant);
	runtime.editor!.setFontVariant(variant);
}

export function updateGamePipelineExts(runtime: Runtime): void {
	const overlayActive = runtime.terminal.isActive || isManagedOverlayEditorActive(runtime);
	runtime.executionOverlayActive = overlayActive;
	Input.instance.setGameplayCaptureEnabled(!overlayActive);
	updateOverlayAudioSuspension(runtime);
}

export function updateOverlayAudioSuspension(runtime: Runtime): void {
	if (!$.sndmaster.isRuntimeAudioReady()) {
		return;
	}
	if (isOverlayActive(runtime)) {
		$.sndmaster.suspendAll('overlay');
	} else {
		$.sndmaster.resumeAll('overlay');
	}
}

export function toggleTerminalMode(runtime: Runtime): void {
	if (runtime.terminal.isActive) {
		deactivateTerminalMode(runtime);
		return;
	}
	activateTerminalMode(runtime);
}

export function activateTerminalMode(runtime: Runtime): void {
	if (runtime.terminal.isActive) {
		return;
	}
	deactivateEditor(runtime);
	runtime.terminal.activate();
	updateGamePipelineExts(runtime);
}

export function deactivateTerminalMode(runtime: Runtime): void {
	if (!runtime.terminal.isActive) {
		return;
	}
	runtime.terminal.deactivate();
	updateGamePipelineExts(runtime);
}

export function isOverlayActive(runtime: Runtime): boolean {
	return runtime.executionOverlayActive;
}

export function toggleEditor(runtime: Runtime): void {
	if (runtime.editor!.isActive) {
		deactivateEditor(runtime);
		return;
	}
	activateEditor(runtime);
}

export function activateEditor(runtime: Runtime): void {
	if (!runtime.hasProgramSymbols) {
		return;
	}
	if (runtime.terminal.isActive) {
		runtime.terminal.deactivate();
	}
	const wasActive = runtime.editor!.isActive;
	if (!wasActive) {
		pushRenderTargetOwner(runtime, 'editor');
	}
	try {
		if (!runtime.editor!.isActive) {
			runtime.editor!.activate();
		}
	} catch (error) {
		if (!wasActive) {
			popRenderTargetOwner(runtime, 'editor');
		}
		throw error;
	}
	if (!runtime.editor!.isActive && !wasActive) {
		popRenderTargetOwner(runtime, 'editor');
	}
	updateGamePipelineExts(runtime);
}

export function deactivateEditor(runtime: Runtime): void {
	if (runtime.editor!.isActive === true) {
		runtime.editor!.deactivate();
	}
	popRenderTargetOwner(runtime, 'editor');
	updateGamePipelineExts(runtime);
}

export function registerRuntimeShortcuts(runtime: Runtime): void {
	disposeShortcutHandlers(runtime);
	const registry = Input.instance.getGlobalShortcutRegistry();
	const disposers: Array<() => void> = [];
	disposers.push(registry.registerKeyboardShortcut(1, EDITOR_TOGGLE_KEY, () => {
		$.consume_button(1, EDITOR_TOGGLE_KEY, 'keyboard');
		toggleEditor(runtime);
	}));
	disposers.push(registry.registerKeyboardShortcut(1, TERMINAL_TOGGLE_KEY, () => toggleTerminalMode(runtime)));
	disposers.push(registry.registerGamepadChord(1, EDITOR_TOGGLE_GAMEPAD_BUTTONS, () => toggleEditor(runtime)));
	disposers.push(registry.registerKeyboardShortcut(1, GAME_PAUSE_KEY, () => $.toggleDebuggerControls()));
	disposers.push(registry.registerKeyboardShortcut(1, 'KeyT', () => {
		$.consume_button(1, 'KeyT', 'keyboard');
		const next = runtime._activeIdeFontVariant === 'tiny' ? 'msx' : 'tiny';
		setActiveIdeFontVariant(runtime, next);
	}, KeyModifier.ctrl | KeyModifier.shift));
	disposers.push(registry.registerKeyboardShortcut(1, 'F8', () => {
		const modifiers = $.input.getPlayerInput(1).getModifiersState();
		if (modifiers.ctrl) {
			return;
		}
		if (runtime.debuggerSuspendSignal) {
			stepOverLuaDebugger(runtime);
		} else {
			runtime.debuggerController.requestStepInto();
		}
	}));
	runtime.shortcutDisposers = disposers;
}

export function disposeShortcutHandlers(runtime: Runtime): void {
	if (runtime.shortcutDisposers.length === 0) {
		return;
	}
	for (let i = 0; i < runtime.shortcutDisposers.length; i++) {
		runtime.shortcutDisposers[i]();
	}
	runtime.shortcutDisposers = [];
}

export function toggleOverlayResolutionMode(runtime: Runtime): 'offscreen' | 'viewport' {
	const next = runtime.overlayResolutionMode === 'offscreen' ? 'viewport' : 'offscreen';
	runtime.overlayResolutionMode = next;
	return next;
}

export function tickIdeInput(runtime: Runtime): void {
	if (!editorBlocksRuntimePipeline(runtime) || !runtime.editor!.isActive) {
		return;
	}
	const pollFrame = $.input.getPlayerInput(1).pollFrame;
	if (pollFrame === runtime.lastIdeInputFrame) {
		return;
	}
	runtime.lastIdeInputFrame = pollFrame;
	runtime.editor!.tickInput();
}

export function tickTerminalInput(runtime: Runtime): void {
	if (!runtime.terminal.isActive) {
		return;
	}
	const pollFrame = $.input.getPlayerInput(1).pollFrame;
	if (pollFrame === runtime.lastTerminalInputFrame) {
		return;
	}
	runtime.lastTerminalInputFrame = pollFrame;
	void runtime.terminal.handleInput();
}

export function recordLuaWarning(runtime: Runtime, message: string): void {
	runtime.pendingLuaWarnings.push(message);
	console.warn(message);
	flushLuaWarnings(runtime);
}

export function flushLuaWarnings(runtime: Runtime): void {
	if (runtime.pendingLuaWarnings.length === 0) {
		return;
	}
	const messages = runtime.pendingLuaWarnings;
	runtime.pendingLuaWarnings = [];
	for (const warning of messages) {
		showEditorWarningBanner(warning, 6.0);
	}
}

export function setDebuggerBreakpoints(runtime: Runtime, breakpoints: Map<string, Set<number>>): void {
	runtime.debuggerController.setBreakpoints(breakpoints);
}

export function setDebuggerPaused(runtime: Runtime, paused: boolean): void {
	runtime.debuggerPaused = paused;
	editorDebuggerState.controls.executionState = paused ? 'paused' : 'inactive';
	editorDebuggerState.controls.sessionMetrics = runtime.debuggerMetrics;
	if (!paused) {
		clearExecutionStopHighlights();
	}
}

export function applyDebuggerStopLocation(signal: LuaDebuggerPauseSignal): void {
	const normalizedLine = clamp_fallback(signal.location.line, 1, Number.MAX_SAFE_INTEGER, 1);
	setExecutionStopHighlight(normalizedLine - 1);
}

export function onLuaDebuggerPause(runtime: Runtime, signal: LuaDebuggerPauseSignal): void {
	if (signal.reason === 'exception' && !isManagedOverlayEditorActive(runtime)) {
		runtime.interpreter.markFaultEnvironment();
		handleLuaError(runtime, signal.exception);
		return;
	}
	runtime.debuggerController.handlePause(signal);
	const pendingException = runtime.interpreter.pendingDebuggerException;
	runtime.pauseCoordinator.capture(signal, pendingException);
	runtime.debuggerSuspendSignal = signal;
	runtime.debuggerMetrics = runtime.debuggerController.getSessionMetrics();
	setDebuggerPaused(runtime, true);
	applyDebuggerStopLocation(signal);
	if (signal.reason === 'exception') {
		recordDebuggerExceptionFault(runtime, signal);
		if (runtime.programMetadata && isManagedOverlayEditorActive(runtime)) {
			const message = runtime.faultSnapshot.message;
			runtime.editor!.showRuntimeErrorInChunk(runtime.faultSnapshot.path, runtime.faultSnapshot.line, runtime.faultSnapshot.column, message);
		}
	}
}

export function clearActiveDebuggerPause(runtime: Runtime): void {
	runtime.pauseCoordinator.clearSuspension();
	runtime.debuggerSuspendSignal = null;
	setDebuggerPaused(runtime, false);
	clearRuntimeFault(runtime);
	runtime.debuggerController.clearPauseContext();
	if (runtime.editor !== null) {
		runtime.editor.clearRuntimeErrorOverlay();
	}
}

export function handleDebuggerResumeResult(runtime: Runtime, result: ExecutionSignal): void {
	if (result && result.kind === 'pause') {
		onLuaDebuggerPause(runtime, result as LuaDebuggerPauseSignal);
		return;
	}
	clearActiveDebuggerPause(runtime);
}

function buildDebuggerStepOrigin(suspension: LuaDebuggerPauseSignal): DebuggerStepOrigin {
	return {
		path: suspension.location.path,
		line: suspension.location.line,
		depth: suspension.callStack.length,
	};
}

function resolveResumeStrategy(suspension: LuaDebuggerPauseSignal): 'propagate' | 'skip_statement' {
	return suspension.reason === 'exception' ? 'skip_statement' : 'propagate';
}

function resumeDebugger(runtime: Runtime, options: { mode: 'continue' | 'step_into' | 'step_out'; strategy: 'propagate' | 'skip_statement' }): void {
	const suspension = runtime.pauseCoordinator.getSuspension();
	const stepOrigin = buildDebuggerStepOrigin(suspension);
	if (options.mode === 'step_into') {
		runtime.debuggerController.requestStepInto(stepOrigin);
	}
	if (options.mode === 'step_out') {
		runtime.debuggerController.requestStepOut(suspension.callStack.length, stepOrigin);
	}
	if (options.strategy === 'skip_statement' && suspension.reason === 'exception') {
		runtime.debuggerController.markSkippedException();
	}
	runtime.interpreter.debuggerResumeStrategy = options.strategy;
	const result = suspension.resume();
	handleDebuggerResumeResult(runtime, result);
}

export function continueLuaDebugger(runtime: Runtime): void {
	resumeDebugger(runtime, { mode: 'continue', strategy: 'propagate' });
}

export function stepOverLuaDebugger(runtime: Runtime): void {
	stepIntoLuaDebugger(runtime);
}

export function stepIntoLuaDebugger(runtime: Runtime): void {
	const suspension = runtime.pauseCoordinator.getSuspension();
	resumeDebugger(runtime, { mode: 'step_into', strategy: resolveResumeStrategy(suspension) });
}

export function stepOutLuaDebugger(runtime: Runtime): void {
	const suspension = runtime.pauseCoordinator.getSuspension();
	resumeDebugger(runtime, { mode: 'step_out', strategy: resolveResumeStrategy(suspension) });
}

export function ignoreLuaException(runtime: Runtime): void {
	resumeDebugger(runtime, { mode: 'continue', strategy: 'skip_statement' });
}

export function clearEditorErrorOverlaysIfNoFault(runtime: Runtime): void {
	if (runtime.luaRuntimeFailed) return;
	if (runtime.editor !== null) {
		runtime.editor.clearRuntimeErrorOverlay();
	}
	publishOverlayFrame(null);
}

export function clearFaultSnapshot(runtime: Runtime): void {
	runtime.faultSnapshot = null;
	runtime.lastCpuFaultSnapshot = [];
	runtime.faultOverlayNeedsFlush = false;
}

export function clearRuntimeFault(runtime: Runtime): void {
	runtime.luaRuntimeFailed = false;
	clearFaultSnapshot(runtime);
}

export function setRuntimeFault(runtime: Runtime, payload: {
	message: string;
	path: string;
	line: number;
	column: number;
	details: RuntimeErrorDetails;
	fromDebugger: boolean;
}): void {
	runtime.luaRuntimeFailed = true;
	runtime.faultSnapshot = payload;
	runtime.faultSnapshot.timestampMs = $.platform.clock.dateNow();
	runtime.faultOverlayNeedsFlush = true;
}

export function clearFaultState(runtime: Runtime): { cleared: boolean; resumedDebugger: boolean } {
	const hadFault = runtime.luaRuntimeFailed || runtime.faultSnapshot !== null || runtime.debuggerSuspendSignal !== null;
	const wasPaused = runtime.debuggerSuspendSignal !== null || runtime.debuggerPaused;
	clearRuntimeFault(runtime);
	if (wasPaused) {
		clearActiveDebuggerPause(runtime);
	}
	return { cleared: hadFault, resumedDebugger: wasPaused };
}

export function recordDebuggerExceptionFault(runtime: Runtime, signal: LuaDebuggerPauseSignal): void {
	const exception = runtime.pauseCoordinator.getPendingException();
	if (runtime.faultSnapshot && runtime.luaRuntimeFailed) {
		runtime.faultOverlayNeedsFlush = true;
		return;
	}
	const signalLine = clamp_fallback(signal.location.line, 1, Number.MAX_SAFE_INTEGER, null);
	const signalColumn = clamp_fallback(signal.location.column, 1, Number.MAX_SAFE_INTEGER, null);
	if (!exception) {
		setRuntimeFault(runtime, {
			message: 'Runtime error',
			path: signal.location.path,
			line: signalLine,
			column: signalColumn,
			details: buildRuntimeErrorDetailsForEditor(runtime, null, 'Runtime error', signal.callStack),
			fromDebugger: true,
		});
		return;
	}
	const message = sanitizeLuaErrorMessage(extractErrorMessage(exception));
	let path: string = exception.path;
	if (!path || path.length === 0) {
		path = signal.location.path;
	}
	const normalizedLine = clamp_fallback(exception.line, 1, Number.MAX_SAFE_INTEGER, null);
	const normalizedColumn = clamp_fallback(exception.column, 1, Number.MAX_SAFE_INTEGER, null);
	setRuntimeFault(runtime, {
		message,
		path,
		line: normalizedLine ?? signalLine,
		column: normalizedColumn ?? signalColumn,
		details: buildRuntimeErrorDetailsForEditor(runtime, exception, message, signal.callStack),
		fromDebugger: true,
	});
}

function extractErrorLocation(runtime: Runtime, error: unknown): { line: number; column: number; path: string } {
	if (error instanceof LuaError) {
		const rawChunk = typeof error.path === 'string' && error.path.length > 0 ? error.path : null;
		const path = rawChunk && rawChunk.startsWith('@') ? rawChunk.slice(1) : rawChunk;
		return {
			line: Number.isFinite(error.line) && error.line > 0 ? Math.floor(error.line) : null,
			column: Number.isFinite(error.column) && error.column > 0 ? Math.floor(error.column) : null,
			path: path,
		};
	}
	if (runtime.lastLuaCallStack.length > 0) {
		const frame = runtime.lastLuaCallStack[0];
		return {
			line: frame.line,
			column: frame.column,
			path: frame.source,
		};
	}
	return { line: null, column: null, path: null };
}

export function handleLuaError(runtime: Runtime, whatever: unknown): void {
	const error = convertToError(whatever);
	if (runtime.handledLuaErrors.has(error)) {
		return;
	}
	runtime.lastCpuFaultSnapshot = runtime.cpu.snapshotCallStack();
	runtime.lastLuaCallStack = buildLuaStackFrames(runtime);
	const message = sanitizeLuaErrorMessage(extractErrorMessage(error));
	const { line, column, path } = extractErrorLocation(runtime, error);
	const innermostFrame = runtime.lastLuaCallStack.length > 0 ? runtime.lastLuaCallStack[0] : null;
	const resolvedPath = innermostFrame ? innermostFrame.source : (path ?? runtime.currentPath);
	const resolvedLine = innermostFrame ? innermostFrame.line : line;
	const resolvedColumn = innermostFrame ? innermostFrame.column : column;
	const runtimeDetails = buildRuntimeErrorDetailsForEditor(runtime, error, message);
	const stackText = buildErrorStackString(
		error instanceof Error && error.name ? error.name : 'Error',
		message,
		runtimeDetails,
		runtime.jsStackEnabled,
	);
	setRuntimeFault(runtime, {
		message,
		path: resolvedPath,
		line: resolvedLine,
		column: resolvedColumn,
		details: runtimeDetails,
		fromDebugger: false,
	});
	if (error instanceof Error) {
		error.message = message;
		error.stack = stackText;
	}
	console.error(stackText);
	logDebugState(runtime);
	runtime.terminal.appendError(error);
	activateTerminalMode(runtime);
	runtime.handledLuaErrors.add(error);
}

export function buildRuntimeErrorDetailsForEditor(runtime: Runtime, error: unknown, message: string, callStack?: ReadonlyArray<LuaCallFrame>): RuntimeErrorDetails {
	if (error instanceof LuaSyntaxError) {
		return null;
	}
	const useInterpreterStack = callStack !== undefined;
	const callFrames = useInterpreterStack ? callStack : null;
	let luaFrames: StackTraceFrame[] = [];
	if (useInterpreterStack) {
		luaFrames = callFrames.length > 0 ? convertLuaCallFrames(callFrames) : [];
	} else if (runtime.lastLuaCallStack.length > 0) {
		luaFrames = runtime.lastLuaCallStack.slice();
	}
	if (error instanceof LuaError) {
		const src = typeof error.path === 'string' && error.path.length > 0 ? error.path : null;
		const line = Number.isFinite(error.line) && error.line > 0 ? Math.floor(error.line) : null;
		const col = Number.isFinite(error.column) && error.column > 0 ? Math.floor(error.column) : null;
		const innermostCall = callFrames && callFrames.length > 0 ? callFrames[callFrames.length - 1] : null;
		const innermostFrame = luaFrames.length > 0 ? luaFrames[0] : null;
		const effectiveSource = src !== null ? src : innermostFrame ? innermostFrame.source : null;
		const resolvedLine = line !== null ? line : (innermostFrame ? innermostFrame.line : null);
		const resolvedColumn = col !== null ? col : (innermostFrame ? innermostFrame.column : null);
		const alreadyCaptured =
			!!innermostFrame &&
			innermostFrame.source === (effectiveSource ?? '') &&
			innermostFrame.line === (resolvedLine ?? 0) &&
			innermostFrame.column === (resolvedColumn ?? 0);
		if (!alreadyCaptured) {
			const fnName =
				innermostCall && innermostCall.functionName && innermostCall.functionName.length > 0
					? innermostCall.functionName
					: innermostFrame && innermostFrame.functionName && innermostFrame.functionName.length > 0
						? innermostFrame.functionName
						: null;
			if (innermostFrame && effectiveSource && innermostFrame.source === effectiveSource) {
				const hint = effectiveSource;
				const updated: StackTraceFrame = {
					origin: innermostFrame.origin,
					functionName: fnName,
					source: effectiveSource,
					line: resolvedLine,
					column: resolvedColumn,
					raw: buildLuaFrameRawLabel(fnName, effectiveSource),
					pathPath: innermostFrame.pathPath,
				};
				updated.pathPath = hint;
				luaFrames[0] = updated;
			} else {
				const frameSource = src !== null ? src : effectiveSource;
				const top: StackTraceFrame = {
					origin: 'lua',
					functionName: fnName,
					source: frameSource,
					line: resolvedLine,
					column: resolvedColumn,
					raw: buildLuaFrameRawLabel(fnName, frameSource),
				};
				if (frameSource && frameSource.length > 0) {
					const hint = frameSource;
					if (hint) {
						top.pathPath = hint;
					}
				}
				luaFrames.unshift(top);
			}
		}
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

export function tickTerminalMode(runtime: Runtime): void {
	if (!runtime.terminal.isActive) {
		return;
	}
	if (!runtime.tickEnabled) {
		return;
	}
	if (runtime.currentFrameState !== null || runtime.drawFrameState !== null) {
		return;
	}
	const state = runtime.beginFrameState();
	const deltaSeconds = runtime.frameDeltaMs / 1000;
	runtime.terminal.update(deltaSeconds);
	runtime.vdp.flushAssetEdits();
	runtime.drawFrameState = state;
	runtime.abandonFrameState();
}

export function tickTerminalModeDraw(runtime: Runtime): void {
	if (!runtime.terminal.isActive) {
		return;
	}
	if (!runtime.tickEnabled) {
		return;
	}
	const state = runtime.drawFrameState;
	if (state !== null) {
		runtime.currentFrameState = state;
	}
	try {
		drawTerminal(runtime);
	} finally {
		if (state !== null) {
			runtime.drawFrameState = null;
			runtime.abandonFrameState();
		}
	}
}

export function tickIDE(runtime: Runtime): void {
	if (!editorBlocksRuntimePipeline(runtime) || !runtime.editor!.isActive) {
		return;
	}
	if (!runtime.tickEnabled) {
		return;
	}
	if (runtime.currentFrameState !== null || runtime.drawFrameState !== null) {
		return;
	}
	const state = runtime.beginFrameState();
	const deltaSeconds = runtime.frameDeltaMs / 1000;
	runtime.editor!.update(deltaSeconds);
	runtime.vdp.flushAssetEdits();
	runtime.drawFrameState = state;
	runtime.abandonFrameState();
}

export function tickIDEDraw(runtime: Runtime): void {
	if (!editorBlocksRuntimePipeline(runtime) || !runtime.editor!.isActive) {
		return;
	}
	if (!runtime.tickEnabled) {
		return;
	}
	const state = runtime.drawFrameState;
	if (state !== null) {
		runtime.currentFrameState = state;
	}
	try {
		drawIde(runtime);
	} finally {
		if (state !== null) {
			runtime.drawFrameState = null;
			runtime.abandonFrameState();
		}
	}
}

export function drawIde(runtime: Runtime): void {
	try {
		overlay_api.beginFrame(runtime.overlayRenderer);
		runtime.overlayRenderer.beginFrame();
		runtime.overlayRenderer.setDefaultLayer('ide');
		runtime.editor!.draw();
	} catch (error) {
		handleLuaError(runtime, error);
	} finally {
		overlay_api.endFrame();
		runtime.overlayRenderer.endFrame();
	}
}

export function drawTerminal(runtime: Runtime): void {
	try {
		overlay_api.beginFrame(runtime.overlayRenderer);
		runtime.overlayRenderer.beginFrame();
		runtime.overlayRenderer.setDefaultLayer('ide');
		runtime.terminal.draw(runtime.overlayRenderer, runtime.overlayRenderer.viewportSize);
		runtime.overlayRenderer.setDefaultLayer('world');
	} catch (error) {
		handleLuaError(runtime, error);
	} finally {
		overlay_api.endFrame();
		runtime.overlayRenderer.endFrame();
	}
}
