import { consoleCore } from '../../core/console';
import { Input } from '../../input/manager';
import { KeyModifier } from '../../input/player';
import type { ExecutionSignal } from '../../lua/runtime';
import { extractErrorMessage, type LuaDebuggerPauseSignal } from '../../lua/value';
import * as constants from '../common/constants';
import { TERMINAL_TOGGLE_KEY, EDITOR_TOGGLE_GAMEPAD_BUTTONS, EDITOR_TOGGLE_KEY, GAME_PAUSE_KEY } from '../common/constants';
import { editorDebuggerState } from './contrib/debugger/state';
import { showEditorWarningBanner } from '../common/feedback_state';
import { seedDefaultLuaBuiltins } from '../../machine/firmware/builtins';
import { TerminalMode } from '../terminal/ui/mode';
import type { FrameState, Runtime } from '../../machine/runtime/runtime';
import type { Viewport } from '../../rompack/format';
import { api as overlay_api } from '../runtime/overlay_api';
import { createCartEditor } from '../cart_editor';
import { clearExecutionStopHighlights, setExecutionStopHighlightForCurrentContext } from '../runtime_error/navigation';
import { toggleDebuggerControls } from '../debugger_activation';
import { nukeWorkspaceState, resetWorkspaceDirtyBuffersAndStorage } from '../workspace/workspace';
import { clearWorkspaceSessionState } from './workspace/storage';
import {
	clearRuntimeFault,
	recordDebuggerExceptionFault,
} from '../runtime/fault_state';
import { clearRuntimeDebuggerPause } from '../runtime/debug_pause';
import { handleLuaError } from './runtime_errors';
import {
	deactivateTerminalMode,
	editorBlocksRuntimePipeline,
	isManagedOverlayEditorActive,
	toggleEditor,
	toggleTerminalMode,
	updateGamePipelineExts,
} from './overlay_modes';

type DebuggerStepOrigin = { path: string; line: number; depth: number };

export function initializeIdeFeatures(runtime: Runtime, viewport: Viewport): void {
	constants.setIdeThemeVariant(constants.DEFAULT_THEME);
	runtime.terminal = new TerminalMode(runtime);
	runtime.editor = createCartEditor(runtime, viewport);
	runtime.initializeOverlayViewport(viewport);
	Input.instance.setKeyboardCapture(EDITOR_TOGGLE_KEY, true);
	seedDefaultLuaBuiltins(runtime);
	flushLuaWarnings(runtime);
	registerRuntimeShortcuts(runtime);
	runtime.debuggerController.setBreakpoints(editorDebuggerState.breakpoints);
	updateGamePipelineExts(runtime);
}

export function setActiveIdeFontVariant(runtime: Runtime, variant: Runtime['activeIdeFontVariant']): void {
	runtime._activeIdeFontVariant = variant;
	runtime.terminal.setFontVariant(variant);
	runtime.editor.setFontVariant(variant);
}

export function registerRuntimeShortcuts(runtime: Runtime): void {
	disposeShortcutHandlers(runtime);
	const registry = Input.instance.getGlobalShortcutRegistry();
	const disposers: Array<() => void> = [];
	disposers.push(registry.registerKeyboardShortcut(1, EDITOR_TOGGLE_KEY, () => {
		Input.instance.getPlayerInput(1).consumeRawButton(EDITOR_TOGGLE_KEY, 'keyboard');
		toggleEditor(runtime);
	}));
	disposers.push(registry.registerKeyboardShortcut(1, TERMINAL_TOGGLE_KEY, () => toggleTerminalMode(runtime)));
	disposers.push(registry.registerGamepadChord(1, EDITOR_TOGGLE_GAMEPAD_BUTTONS, () => toggleEditor(runtime)));
	disposers.push(registry.registerKeyboardShortcut(1, GAME_PAUSE_KEY, () => toggleDebuggerControls()));
	disposers.push(registry.registerKeyboardShortcut(1, 'KeyT', () => {
		Input.instance.getPlayerInput(1).consumeRawButton('KeyT', 'keyboard');
		const next = runtime._activeIdeFontVariant === 'tiny' ? 'msx' : 'tiny';
		setActiveIdeFontVariant(runtime, next);
	}, KeyModifier.ctrl | KeyModifier.shift));
	disposers.push(registry.registerKeyboardShortcut(1, 'F8', () => {
		const modifiers = consoleCore.input.getPlayerInput(1).getModifiersState();
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

export function tickIdeInput(runtime: Runtime): void {
	if (!editorBlocksRuntimePipeline(runtime) || !runtime.editor.isActive) {
		return;
	}
	const pollFrame = consoleCore.input.getPlayerInput(1).pollFrame;
	if (pollFrame === runtime.lastIdeInputFrame) {
		return;
	}
	runtime.lastIdeInputFrame = pollFrame;
	runtime.editor.tickInput();
}

export function tickTerminalInput(runtime: Runtime): void {
	if (!runtime.terminal.isActive) {
		return;
	}
	const pollFrame = consoleCore.input.getPlayerInput(1).pollFrame;
	if (pollFrame === runtime.lastTerminalInputFrame) {
		return;
	}
	runtime.lastTerminalInputFrame = pollFrame;
	void runtime.terminal.handleInput()
		.then(async action => {
			switch (action) {
				case 'deactivate_terminal':
					deactivateTerminalMode(runtime);
					return;
				case 'clear_fault': {
					const result = clearFaultState(runtime);
					if (!result.cleared) {
						runtime.terminal.appendStderr('No fault to clear');
						return;
					}
					if (result.resumedDebugger) {
						runtime.terminal.appendStdout('Fault cleared; debugger resumed');
						return;
					}
					runtime.terminal.appendStdout('Fault state cleared');
					return;
				}
				case null:
					return;
				case 'workspace_reset':
					runtime.terminal.appendStdout('Discarding dirty files...');
					await resetWorkspaceDirtyBuffersAndStorage(runtime);
					runtime.terminal.appendStdout('Dirty workspace buffers cleared');
					return;
				case 'workspace_nuke':
					runtime.terminal.appendStdout('Warning: this will erase workspace!');
					await nukeWorkspaceState(runtime);
					clearWorkspaceSessionState();
					runtime.terminal.appendStdout('Workspace data wiped');
					return;
			}
		})
		.catch(error => {
			runtime.terminal.appendStderr(extractErrorMessage(error));
		});
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

export function setDebuggerPaused(runtime: Runtime, paused: boolean): void {
	runtime.debuggerPaused = paused;
	editorDebuggerState.controls.executionState = paused ? 'paused' : 'inactive';
	editorDebuggerState.controls.sessionMetrics = runtime.debuggerMetrics;
	if (!paused) {
		clearExecutionStopHighlights();
	}
}

export function applyDebuggerStopLocation(signal: LuaDebuggerPauseSignal): void {
	setExecutionStopHighlightForCurrentContext(signal.location.line - 1);
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
			const faultSnapshot = runtime.workbenchFaultState.faultSnapshot;
			const message = faultSnapshot.message;
			runtime.editor.showRuntimeErrorInChunk(faultSnapshot.path, faultSnapshot.line, faultSnapshot.column, message);
		}
	}
}

export function clearActiveDebuggerPause(runtime: Runtime): void {
	clearRuntimeDebuggerPause(runtime);
	setDebuggerPaused(runtime, false);
	if (runtime.editor) {
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

function resumeDebugger(runtime: Runtime, options: { mode: 'continue' | 'step_into' | 'step_over' | 'step_out'; strategy: 'propagate' | 'skip_statement' }): void {
	const suspension = runtime.pauseCoordinator.getSuspension();
	const stepOrigin = buildDebuggerStepOrigin(suspension);
	if (options.mode === 'step_into') {
		runtime.debuggerController.requestStepInto(stepOrigin);
	}
	if (options.mode === 'step_over') {
		runtime.debuggerController.requestStepOver(suspension.callStack.length, stepOrigin);
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
	const suspension = runtime.pauseCoordinator.getSuspension();
	resumeDebugger(runtime, { mode: 'step_over', strategy: resolveResumeStrategy(suspension) });
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

export function clearFaultState(runtime: Runtime): { cleared: boolean; resumedDebugger: boolean } {
	const hadFault = runtime.luaRuntimeFailed || runtime.workbenchFaultState.faultSnapshot !== null || runtime.debuggerSuspendSignal !== null;
	const wasPaused = runtime.debuggerSuspendSignal !== null || runtime.debuggerPaused;
	clearRuntimeFault(runtime);
	if (wasPaused) {
		clearActiveDebuggerPause(runtime);
	}
	return { cleared: hadFault, resumedDebugger: wasPaused };
}

export function surfaceHostFrameError(runtime: Runtime, error: unknown, hostDeltaMs: number): void {
	runtime.frameLoop.abandonFrameState();
	handleLuaError(runtime, error);
	runtime.screen.presentErrorOverlay(hostDeltaMs);
}

export function tickTerminalMode(runtime: Runtime): void {
	if (!runtime.terminal.isActive) {
		return;
	}
	const state = beginOverlayUpdateFrame(runtime);
	if (state === null) {
		return;
	}
	const deltaSeconds = runtime.frameLoop.frameDeltaMs / 1000;
	runtime.terminal.update(deltaSeconds);
	finishOverlayUpdateFrame(runtime, state);
}

export function tickTerminalModeDraw(runtime: Runtime): void {
	if (!runtime.terminal.isActive) {
		return;
	}
	if (!runtime.tickEnabled) {
		return;
	}
	const state = runtime.frameLoop.drawFrameState;
	if (state !== null) {
		runtime.frameLoop.currentFrameState = state;
	}
	try {
		drawTerminal(runtime);
	} finally {
		if (state !== null) {
			runtime.frameLoop.drawFrameState = null;
			runtime.frameLoop.abandonFrameState();
		}
	}
}

export function tickIDE(runtime: Runtime): void {
	if (!editorBlocksRuntimePipeline(runtime) || !runtime.editor.isActive) {
		return;
	}
	const state = beginOverlayUpdateFrame(runtime);
	if (state === null) {
		return;
	}
	const deltaSeconds = runtime.frameLoop.frameDeltaMs / 1000;
	runtime.editor.update(deltaSeconds);
	finishOverlayUpdateFrame(runtime, state);
}

function beginOverlayUpdateFrame(runtime: Runtime): FrameState | null {
	if (!runtime.tickEnabled) {
		return null;
	}
	if (runtime.frameLoop.currentFrameState !== null || runtime.frameLoop.drawFrameState !== null) {
		return null;
	}
	return runtime.frameLoop.beginFrameState();
}

function finishOverlayUpdateFrame(runtime: Runtime, state: FrameState): void {
	runtime.frameLoop.drawFrameState = state;
	runtime.frameLoop.abandonFrameState();
}

export function tickIDEDraw(runtime: Runtime): void {
	if (!editorBlocksRuntimePipeline(runtime) || !runtime.editor.isActive) {
		return;
	}
	if (!runtime.tickEnabled) {
		return;
	}
	const state = runtime.frameLoop.drawFrameState;
	if (state !== null) {
		runtime.frameLoop.currentFrameState = state;
	}
	try {
		drawIde(runtime);
	} finally {
		if (state !== null) {
			runtime.frameLoop.drawFrameState = null;
			runtime.frameLoop.abandonFrameState();
		}
	}
}

export function drawIde(runtime: Runtime): void {
	try {
		runtime.overlayRenderer.beginFrame();
		overlay_api.beginFrame(runtime.overlayRenderer);
		runtime.editor.draw();
	} catch (error) {
		handleLuaError(runtime, error);
	} finally {
		runtime.overlayRenderer.endFrame();
	}
}

export function drawTerminal(runtime: Runtime): void {
	try {
		runtime.overlayRenderer.beginFrame();
		overlay_api.beginFrame(runtime.overlayRenderer);
		runtime.terminal.draw(runtime.overlayRenderer, runtime.overlayRenderer.viewportSize);
	} catch (error) {
		handleLuaError(runtime, error);
	} finally {
		runtime.overlayRenderer.endFrame();
	}
}
