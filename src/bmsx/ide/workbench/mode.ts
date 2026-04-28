import { engineCore } from '../../core/engine';
import { Input } from '../../input/manager';
import { KeyModifier } from '../../input/player';
import { LuaError, LuaRuntimeError, LuaSyntaxError } from '../../lua/errors';
import type { ExecutionSignal, LuaCallFrame } from '../../lua/runtime';
import {
	convertToError,
	extractErrorMessage,
	type LuaDebuggerPauseSignal,
	type StackTraceFrame,
} from '../../lua/value';
import { publishOverlayFrame } from '../../render/editor/overlay_queue';
import { flushHostRuntimeAssetEdits } from '../../core/host_asset_sync';
import * as constants from '../common/constants';
import { TERMINAL_TOGGLE_KEY, EDITOR_TOGGLE_GAMEPAD_BUTTONS, EDITOR_TOGGLE_KEY, GAME_PAUSE_KEY } from '../common/constants';
import { editorDebuggerState } from './contrib/debugger/state';
import { showEditorWarningBanner } from '../common/feedback_state';
import type { FaultSnapshot, RuntimeErrorDetails } from '../common/models';
import { buildLuaStackFrames } from '../../machine/firmware/globals';
import { seedDefaultLuaBuiltins } from '../../machine/firmware/builtins';
import {
	buildErrorStackString,
	buildLuaFrameRawLabel,
	convertLuaCallFrames,
	parseJsStackFrames,
	sanitizeLuaErrorMessage,
} from '../common/runtime_error_format';
import { logDebugState } from '../../machine/runtime/debug';
import { TerminalMode } from '../terminal/ui/mode';
import { FrameState, Runtime } from '../../machine/runtime/runtime';
import type { CpuFrameSnapshot } from '../../machine/cpu/cpu';
import type { Viewport } from '../../rompack/format';
import { resolveWorkspacePath } from '../workspace/path';
import { shallowcopy } from '../../common/shallowcopy';
import { api as overlay_api } from '../runtime/overlay_api';
import { createCartEditor } from '../cart_editor';
import { clearExecutionStopHighlights, setExecutionStopHighlight } from './error/navigation';
import { toggleDebuggerControls } from '../debugger_activation';

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
type RuntimeErrorLocation = { path: string; line: number; column: number };
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
export type RuntimeFaultState = {
	handledLuaErrors: WeakSet<object>;
	lastLuaCallStack: StackTraceFrame[];
	lastCpuFaultSnapshot: CpuFrameSnapshot[];
	faultSnapshot: FaultSnapshot;
	faultOverlayNeedsFlush: boolean;
};

export const EDITOR_TARGET: RenderTargetVec2 = { x: 384, y: 288 };
// export const EDITOR_TARGET: RenderTargetVec2 = { x: 768, y: 576 };
// export const EDITOR_TARGET: RenderTargetVec2 = { x: 512, y: 384 };
const RT_STATE = new WeakMap<Runtime, RenderTargetState>();
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

export function resetHandledLuaErrors(): void {
	Runtime.instance.workbenchFaultState.handledLuaErrors = new WeakSet<object>();
}

export function getFaultSnapshot(): FaultSnapshot {
	return Runtime.instance.workbenchFaultState.faultSnapshot;
}

export function hasFaultSnapshot(): boolean {
	return Runtime.instance.workbenchFaultState.faultSnapshot !== null;
}

export function getLastCpuFaultSnapshot(): CpuFrameSnapshot[] {
	return Runtime.instance.workbenchFaultState.lastCpuFaultSnapshot;
}

export function doesFaultOverlayNeedFlush(): boolean {
	return Runtime.instance.workbenchFaultState.faultOverlayNeedsFlush;
}

export function flushedFaultOverlay(): void {
	Runtime.instance.workbenchFaultState.faultOverlayNeedsFlush = false;
}

function getRenderTargetState(): RenderTargetState {
	let state = RT_STATE.get(Runtime.instance);
	if (!state) {
		state = { stack: [] };
		RT_STATE.set(Runtime.instance, state);
	}
	return state;
}

function captureCurrentTargets(): RenderTargetSnapshot {
	const view = engineCore.view;
	return {
		viewportSize: shallowcopy(view.viewportSize),
		canvasSize: shallowcopy(view.canvasSize),
		offscreenSize: shallowcopy(view.offscreenCanvasSize),
	};
}

function applyFixedEditorTargets(): void {
	engineCore.view.configureRenderTargets({
		viewportSize: EDITOR_TARGET,
		canvasSize: EDITOR_TARGET,
		offscreenSize: EDITOR_TARGET,
	});
	Runtime.instance.overlayResolutionMode = 'viewport';
}

function restoreTargets(snapshot: RenderTargetSnapshot): void {
	engineCore.view.configureRenderTargets({
		viewportSize: snapshot.viewportSize,
		canvasSize: snapshot.canvasSize,
		offscreenSize: snapshot.offscreenSize,
	});
	Runtime.instance.overlayResolutionMode = 'viewport';
}

function pushRenderTargetOwner(owner: TargetOwner): void {
	const state = getRenderTargetState();
	if (!state.baseline) {
		state.baseline = captureCurrentTargets();
	}
	if (state.stack.includes(owner)) {
		return;
	}
	state.stack.push(owner);
	switch (owner) {
		case 'editor':
			applyFixedEditorTargets();
			return;
	}
}

function popRenderTargetOwner(owner: TargetOwner): void {
	const state = RT_STATE.get(Runtime.instance);
	if (!state) {
		return;
	}
	for (let i = state.stack.length - 1; i >= 0; i -= 1) {
		if (state.stack[i] === owner) {
			state.stack.splice(i, 1);
		}
	}
	if (state.stack.length === 0) {
		restoreTargets(state.baseline!);
		RT_STATE.delete(Runtime.instance);
		return;
	}
	const top = state.stack[state.stack.length - 1];
	switch (top) {
		case 'editor':
			applyFixedEditorTargets();
			return;
	}
}

function editorBlocksRuntimePipeline(): boolean {
	return Runtime.instance.editor !== null && Runtime.instance.editor.blocksRuntimePipeline;
}

function isManagedOverlayEditorActive(): boolean {
	if (!editorBlocksRuntimePipeline()) {
		return false;
	}
	return Runtime.instance.editor!.isActive;
}

function resolveEditorSourceWorkspacePath(source: string): string {
	const cart = Runtime.instance.cartLuaSources;
	if (cart && cart.path2lua[source]) {
		return resolveWorkspacePath(source, Runtime.instance.cartProjectRootPath);
	}
	const engine = Runtime.instance.engineLuaSources;
	if (engine && engine.path2lua[source]) {
		return resolveWorkspacePath(source, Runtime.instance.engineProjectRootPath);
	}
	return resolveWorkspacePath(source, Runtime.instance.cartProjectRootPath);
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
	const state = Runtime.instance.workbenchFaultState;
	if (state.lastLuaCallStack.length > 0) {
		return runtimeStackFrameLocation(state.lastLuaCallStack[0]);
	}
	if (error instanceof LuaError) {
		return runtimeLuaErrorLocation(error);
	}
	return { path: Runtime.instance.currentPath, line: 0, column: 0 };
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

export function createPauseCoordinator(): DebugPauseCoordinator {
	return new DebugPauseCoordinator();
}

export function initializeIdeFeatures(viewport: Viewport): void {
	constants.setIdeThemeVariant(constants.DEFAULT_THEME);
	const runtime = Runtime.instance;
	Runtime.instance.terminal = new TerminalMode(runtime);
	Runtime.instance.editor = createCartEditor(viewport);
	Runtime.instance.overlayResolutionMode = 'viewport';
	Input.instance.setKeyboardCapture(EDITOR_TOGGLE_KEY, true);
	seedDefaultLuaBuiltins();
	flushLuaWarnings();
	registerRuntimeShortcuts();
	Runtime.instance.debuggerController.setBreakpoints(editorDebuggerState.breakpoints);
	updateGamePipelineExts();
}

export function setActiveIdeFontVariant(variant: Runtime['activeIdeFontVariant']): void {
	const runtime = Runtime.instance;
	runtime._activeIdeFontVariant = variant;
	runtime.terminal.setFontVariant(variant);
	runtime.editor!.setFontVariant(variant);
}

export function updateGamePipelineExts(): void {
	const runtime = Runtime.instance;
	const overlayActive = runtime.terminal.isActive || isManagedOverlayEditorActive();
	runtime.executionOverlayActive = overlayActive;
	Input.instance.setGameplayCaptureEnabled(!overlayActive);
	updateOverlayAudioSuspension();
}

export function updateOverlayAudioSuspension(): void {
	if (!engineCore.sndmaster.isRuntimeAudioReady()) {
		return;
	}
	if (isOverlayActive()) {
		engineCore.sndmaster.suspendAll('overlay');
	} else {
		engineCore.sndmaster.resumeAll('overlay');
	}
}

export function toggleTerminalMode(): void {
	if (Runtime.instance.terminal.isActive) {
		deactivateTerminalMode();
		return;
	}
	activateTerminalMode();
}

export function activateTerminalMode(): void {
	if (Runtime.instance.terminal.isActive) {
		return;
	}
	deactivateEditor();
	Runtime.instance.terminal.activate();
	updateGamePipelineExts();
}

export function deactivateTerminalMode(): void {
	const runtime = Runtime.instance;
	if (!runtime.terminal.isActive) {
		return;
	}
	runtime.terminal.deactivate();
	updateGamePipelineExts();
}

export function isOverlayActive(): boolean {
	return Runtime.instance.executionOverlayActive;
}

export function toggleEditor(): void {
	if (Runtime.instance.editor!.isActive) {
		deactivateEditor();
		return;
	}
	activateEditor();
}

export function activateEditor(): void {
	if (!Runtime.instance.hasProgramSymbols) {
		return;
	}
	if (Runtime.instance.terminal.isActive) {
		Runtime.instance.terminal.deactivate();
	}
	const editor = Runtime.instance.editor!;
	const wasActive = editor.isActive;
	if (!wasActive) {
		pushRenderTargetOwner('editor');
	}
	try {
		if (!editor.isActive) {
			editor.activate();
		}
	} catch (error) {
		if (!wasActive) {
			popRenderTargetOwner('editor');
		}
		throw error;
	}
	if (!editor.isActive && !wasActive) {
		popRenderTargetOwner('editor');
	}
	updateGamePipelineExts();
}

export function deactivateEditor(): void {
	const editor = Runtime.instance.editor!;
	if (editor.isActive) {
		editor.deactivate();
	}
	popRenderTargetOwner('editor');
	updateGamePipelineExts();
}

export function registerRuntimeShortcuts(): void {
	disposeShortcutHandlers();
	const registry = Input.instance.getGlobalShortcutRegistry();
	const disposers: Array<() => void> = [];
	disposers.push(registry.registerKeyboardShortcut(1, EDITOR_TOGGLE_KEY, () => {
		Input.instance.getPlayerInput(1).consumeRawButton(EDITOR_TOGGLE_KEY, 'keyboard');
		toggleEditor();
	}));
	disposers.push(registry.registerKeyboardShortcut(1, TERMINAL_TOGGLE_KEY, () => toggleTerminalMode()));
	disposers.push(registry.registerGamepadChord(1, EDITOR_TOGGLE_GAMEPAD_BUTTONS, () => toggleEditor()));
	disposers.push(registry.registerKeyboardShortcut(1, GAME_PAUSE_KEY, () => toggleDebuggerControls()));
	disposers.push(registry.registerKeyboardShortcut(1, 'KeyT', () => {
		Input.instance.getPlayerInput(1).consumeRawButton('KeyT', 'keyboard');
		const next = Runtime.instance._activeIdeFontVariant === 'tiny' ? 'msx' : 'tiny';
		setActiveIdeFontVariant(next);
	}, KeyModifier.ctrl | KeyModifier.shift));
	disposers.push(registry.registerKeyboardShortcut(1, 'F8', () => {
		const modifiers = engineCore.input.getPlayerInput(1).getModifiersState();
		if (modifiers.ctrl) {
			return;
		}
		if (Runtime.instance.debuggerSuspendSignal) {
			stepOverLuaDebugger();
		} else {
			Runtime.instance.debuggerController.requestStepInto();
		}
	}));
	Runtime.instance.shortcutDisposers = disposers;
}

export function disposeShortcutHandlers(): void {
	if (Runtime.instance.shortcutDisposers.length === 0) {
		return;
	}
	for (let i = 0; i < Runtime.instance.shortcutDisposers.length; i++) {
		Runtime.instance.shortcutDisposers[i]();
	}
	Runtime.instance.shortcutDisposers = [];
}

export function tickIdeInput(): void {
	if (!editorBlocksRuntimePipeline() || !Runtime.instance.editor!.isActive) {
		return;
	}
	const pollFrame = engineCore.input.getPlayerInput(1).pollFrame;
	if (pollFrame === Runtime.instance.lastIdeInputFrame) {
		return;
	}
	Runtime.instance.lastIdeInputFrame = pollFrame;
	Runtime.instance.editor!.tickInput();
}

export function tickTerminalInput(): void {
	if (!Runtime.instance.terminal.isActive) {
		return;
	}
	const pollFrame = engineCore.input.getPlayerInput(1).pollFrame;
	if (pollFrame === Runtime.instance.lastTerminalInputFrame) {
		return;
	}
	Runtime.instance.lastTerminalInputFrame = pollFrame;
	void Runtime.instance.terminal.handleInput();
}

export function flushLuaWarnings(): void {
	if (Runtime.instance.pendingLuaWarnings.length === 0) {
		return;
	}
	const messages = Runtime.instance.pendingLuaWarnings;
	Runtime.instance.pendingLuaWarnings = [];
	for (const warning of messages) {
		showEditorWarningBanner(warning, 6.0);
	}
}

export function setDebuggerPaused(paused: boolean): void {
	Runtime.instance.debuggerPaused = paused;
	editorDebuggerState.controls.executionState = paused ? 'paused' : 'inactive';
	editorDebuggerState.controls.sessionMetrics = Runtime.instance.debuggerMetrics;
	if (!paused) {
		clearExecutionStopHighlights();
	}
}

export function applyDebuggerStopLocation(signal: LuaDebuggerPauseSignal): void {
	setExecutionStopHighlight(signal.location.line - 1);
}

export function onLuaDebuggerPause(signal: LuaDebuggerPauseSignal): void {
	if (signal.reason === 'exception' && !isManagedOverlayEditorActive()) {
		Runtime.instance.interpreter.markFaultEnvironment();
		handleLuaError(signal.exception);
		return;
	}
	Runtime.instance.debuggerController.handlePause(signal);
	const pendingException = Runtime.instance.interpreter.pendingDebuggerException;
	Runtime.instance.pauseCoordinator.capture(signal, pendingException);
	Runtime.instance.debuggerSuspendSignal = signal;
	Runtime.instance.debuggerMetrics = Runtime.instance.debuggerController.getSessionMetrics();
	setDebuggerPaused(true);
	applyDebuggerStopLocation(signal);
	if (signal.reason === 'exception') {
		recordDebuggerExceptionFault(signal);
		if (Runtime.instance.programMetadata && isManagedOverlayEditorActive()) {
			const faultSnapshot = getFaultSnapshot();
			const message = faultSnapshot.message;
			Runtime.instance.editor!.showRuntimeErrorInChunk(faultSnapshot.path, faultSnapshot.line, faultSnapshot.column, message);
		}
	}
}

export function clearActiveDebuggerPause(): void {
	Runtime.instance.pauseCoordinator.clearSuspension();
	Runtime.instance.debuggerSuspendSignal = null;
	setDebuggerPaused(false);
	clearRuntimeFault();
	Runtime.instance.debuggerController.clearPauseContext();
	if (Runtime.instance.editor !== null) {
		Runtime.instance.editor.clearRuntimeErrorOverlay();
	}
}

export function handleDebuggerResumeResult(result: ExecutionSignal): void {
	if (result && result.kind === 'pause') {
		onLuaDebuggerPause(result as LuaDebuggerPauseSignal);
		return;
	}
	clearActiveDebuggerPause();
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

function resumeDebugger(options: { mode: 'continue' | 'step_into' | 'step_over' | 'step_out'; strategy: 'propagate' | 'skip_statement' }): void {
	const suspension = Runtime.instance.pauseCoordinator.getSuspension();
	const stepOrigin = buildDebuggerStepOrigin(suspension);
	if (options.mode === 'step_into') {
		Runtime.instance.debuggerController.requestStepInto(stepOrigin);
	}
	if (options.mode === 'step_over') {
		Runtime.instance.debuggerController.requestStepOver(suspension.callStack.length, stepOrigin);
	}
	if (options.mode === 'step_out') {
		Runtime.instance.debuggerController.requestStepOut(suspension.callStack.length, stepOrigin);
	}
	if (options.strategy === 'skip_statement' && suspension.reason === 'exception') {
		Runtime.instance.debuggerController.markSkippedException();
	}
	Runtime.instance.interpreter.debuggerResumeStrategy = options.strategy;
	const result = suspension.resume();
	handleDebuggerResumeResult(result);
}

export function continueLuaDebugger(): void {
	resumeDebugger({ mode: 'continue', strategy: 'propagate' });
}

export function stepOverLuaDebugger(): void {
	const suspension = Runtime.instance.pauseCoordinator.getSuspension();
	resumeDebugger({ mode: 'step_over', strategy: resolveResumeStrategy(suspension) });
}

export function stepIntoLuaDebugger(): void {
	const suspension = Runtime.instance.pauseCoordinator.getSuspension();
	resumeDebugger({ mode: 'step_into', strategy: resolveResumeStrategy(suspension) });
}

export function stepOutLuaDebugger(): void {
	const suspension = Runtime.instance.pauseCoordinator.getSuspension();
	resumeDebugger({ mode: 'step_out', strategy: resolveResumeStrategy(suspension) });
}

export function ignoreLuaException(): void {
	resumeDebugger({ mode: 'continue', strategy: 'skip_statement' });
}

export function clearEditorErrorOverlaysIfNoFault(): void {
	if (Runtime.instance.luaRuntimeFailed) return;
	if (Runtime.instance.editor !== null) {
		Runtime.instance.editor.clearRuntimeErrorOverlay();
	}
	publishOverlayFrame(null);
}

export function clearFaultSnapshot(): void {
	const state = Runtime.instance.workbenchFaultState;
	state.faultSnapshot = null;
	state.lastCpuFaultSnapshot = [];
	state.faultOverlayNeedsFlush = false;
}

export function clearRuntimeFault(): void {
	Runtime.instance.luaRuntimeFailed = false;
	clearFaultSnapshot();
}

export function setRuntimeFault(payload: {
	message: string;
	path: string;
	line: number;
	column: number;
	details: RuntimeErrorDetails;
	fromDebugger: boolean;
}): void {
	const state = Runtime.instance.workbenchFaultState;
	Runtime.instance.luaRuntimeFailed = true;
	state.faultSnapshot = payload;
	state.faultSnapshot.timestampMs = Runtime.instance.clock.dateNow();
	state.faultOverlayNeedsFlush = true;
}

export function clearFaultState(): { cleared: boolean; resumedDebugger: boolean } {
	const hadFault = Runtime.instance.luaRuntimeFailed || hasFaultSnapshot() || Runtime.instance.debuggerSuspendSignal !== null;
	const wasPaused = Runtime.instance.debuggerSuspendSignal !== null || Runtime.instance.debuggerPaused;
	clearRuntimeFault();
	if (wasPaused) {
		clearActiveDebuggerPause();
	}
	return { cleared: hadFault, resumedDebugger: wasPaused };
}

export function recordDebuggerExceptionFault(signal: LuaDebuggerPauseSignal): void {
	const exception = Runtime.instance.pauseCoordinator.getPendingException();
	const state = Runtime.instance.workbenchFaultState;
	if (state.faultSnapshot && Runtime.instance.luaRuntimeFailed) {
		state.faultOverlayNeedsFlush = true;
		return;
	}
	if (!exception) {
		setRuntimeFault({
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
	setRuntimeFault({
		message,
		path: location.path,
		line: location.line,
		column: location.column,
		details: buildRuntimeErrorDetailsForEditor(exception, message, signal.callStack),
		fromDebugger: true,
	});
}

export function handleLuaError(whatever: unknown): void {
	const error = convertToError(whatever);
	const state = Runtime.instance.workbenchFaultState;
	if (state.handledLuaErrors.has(error)) {
		return;
	}
	state.lastCpuFaultSnapshot = Runtime.instance.machine.cpu.snapshotCallStack();
	state.lastLuaCallStack = buildLuaStackFrames();
	const message = sanitizeLuaErrorMessage(extractErrorMessage(error));
	const location = resolveRuntimeErrorLocation(error);
	const runtimeDetails = buildRuntimeErrorDetailsForEditor(error, message);
	const stackText = buildErrorStackString(
		error instanceof Error && error.name ? error.name : 'Error',
		message,
		runtimeDetails,
		Runtime.instance.jsStackEnabled,
	);
	setRuntimeFault({
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
	console.error(stackText);
	logDebugState();
	Runtime.instance.terminal.appendError(error);
	activateTerminalMode();
	state.handledLuaErrors.add(error);
}

export function surfaceHostFrameError(error: unknown, hostDeltaMs: number): void {
	Runtime.instance.frameLoop.abandonFrameState();
	handleLuaError(error);
	Runtime.instance.screen.presentErrorOverlay(hostDeltaMs);
}

export function buildRuntimeErrorDetailsForEditor(error: unknown, message: string, callStack?: ReadonlyArray<LuaCallFrame>): RuntimeErrorDetails {
	if (error instanceof LuaSyntaxError) {
		return null;
	}
	const useInterpreterStack = callStack !== undefined;
	const callFrames = callStack === undefined ? EMPTY_LUA_CALL_FRAMES : callStack;
	let luaFrames: StackTraceFrame[] = [];
	if (useInterpreterStack) {
		luaFrames = callFrames.length > 0 ? convertLuaCallFrames(callFrames) : [];
	} else {
		const state = Runtime.instance.workbenchFaultState;
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
	let stackText: string = null;
	if (Runtime.instance.jsStackEnabled && error instanceof Error && typeof error.stack === 'string') {
		stackText = error.stack;
	}
	const jsFrames = Runtime.instance.jsStackEnabled ? parseJsStackFrames(stackText) : [];
	if (luaFrames.length === 0 && jsFrames.length === 0) {
		return null;
	}
	return {
		message,
		luaStack: luaFrames,
		jsStack: jsFrames,
	};
}

export function tickTerminalMode(): void {
	if (!Runtime.instance.terminal.isActive) {
		return;
	}
	const state = beginOverlayUpdateFrame();
	if (state === null) {
		return;
	}
	const deltaSeconds = Runtime.instance.frameLoop.frameDeltaMs / 1000;
	Runtime.instance.terminal.update(deltaSeconds);
	finishOverlayUpdateFrame(state);
}

export function tickTerminalModeDraw(): void {
	if (!Runtime.instance.terminal.isActive) {
		return;
	}
	if (!Runtime.instance.tickEnabled) {
		return;
	}
	const state = Runtime.instance.frameLoop.drawFrameState;
	if (state !== null) {
		Runtime.instance.frameLoop.currentFrameState = state;
	}
	try {
		drawTerminal();
	} finally {
		if (state !== null) {
			Runtime.instance.frameLoop.drawFrameState = null;
			Runtime.instance.frameLoop.abandonFrameState();
		}
	}
}

export function tickIDE(): void {
	if (!editorBlocksRuntimePipeline() || !Runtime.instance.editor!.isActive) {
		return;
	}
	const state = beginOverlayUpdateFrame();
	if (state === null) {
		return;
	}
	const deltaSeconds = Runtime.instance.frameLoop.frameDeltaMs / 1000;
	Runtime.instance.editor!.update(deltaSeconds);
	finishOverlayUpdateFrame(state);
}

function beginOverlayUpdateFrame(): FrameState | null {
	if (!Runtime.instance.tickEnabled) {
		return null;
	}
	if (Runtime.instance.frameLoop.currentFrameState !== null || Runtime.instance.frameLoop.drawFrameState !== null) {
		return null;
	}
	return Runtime.instance.frameLoop.beginFrameState();
}

function finishOverlayUpdateFrame(state: FrameState): void {
	flushHostRuntimeAssetEdits(Runtime.instance.machine.memory, engineCore.texmanager);
	Runtime.instance.frameLoop.drawFrameState = state;
	Runtime.instance.frameLoop.abandonFrameState();
}

export function tickIDEDraw(): void {
	if (!editorBlocksRuntimePipeline() || !Runtime.instance.editor!.isActive) {
		return;
	}
	if (!Runtime.instance.tickEnabled) {
		return;
	}
	const state = Runtime.instance.frameLoop.drawFrameState;
	if (state !== null) {
		Runtime.instance.frameLoop.currentFrameState = state;
	}
	try {
		drawIde();
	} finally {
		if (state !== null) {
			Runtime.instance.frameLoop.drawFrameState = null;
			Runtime.instance.frameLoop.abandonFrameState();
		}
	}
}

export function drawIde(): void {
	try {
		overlay_api.beginFrame(Runtime.instance.overlayRenderer);
		Runtime.instance.overlayRenderer.beginFrame();
		Runtime.instance.overlayRenderer.setDefaultLayer('ide');
		Runtime.instance.editor!.draw();
	} catch (error) {
		handleLuaError(error);
	} finally {
		overlay_api.endFrame();
		Runtime.instance.overlayRenderer.endFrame();
	}
}

export function drawTerminal(): void {
	try {
		overlay_api.beginFrame(Runtime.instance.overlayRenderer);
		Runtime.instance.overlayRenderer.beginFrame();
		Runtime.instance.overlayRenderer.setDefaultLayer('ide');
		Runtime.instance.terminal.draw(Runtime.instance.overlayRenderer, Runtime.instance.overlayRenderer.viewportSize);
		Runtime.instance.overlayRenderer.setDefaultLayer('world');
	} catch (error) {
		handleLuaError(error);
	} finally {
		overlay_api.endFrame();
		Runtime.instance.overlayRenderer.endFrame();
	}
}
