import { machineManager } from '../../core/machine_manager';
import { Input } from '../../input/manager';
import { KeyModifier } from '../../input/player';
import type { ExecutionSignal } from '../../lua/runtime';
import type { LuaDebuggerPauseSignal } from '../../lua/value';
import * as constants from '../common/constants';
import { EDITOR_TOGGLE_GAMEPAD_BUTTONS, EDITOR_TOGGLE_KEY, GAME_PAUSE_KEY } from '../common/constants';
import { editorDebuggerState } from './contrib/debugger/state';
import { seedDefaultLuaBuiltins } from '../runtime/lua_builtins';
import type { Runtime } from '../../machine/runtime/runtime';
import type { RenderPresentationState } from '../../render/presentation_state';
import type { FontVariant } from '../../render/shared/bmsx_font';
import type { Viewport } from '../../rompack/format';
import { api as overlay_api } from '../runtime/overlay_api';
import { clearExecutionStopHighlights, setExecutionStopHighlightForCurrentContext } from '../runtime_error/navigation';
import { toggleDebuggerControls } from '../debugger_activation';
import { clearRuntimeFault, createRuntimeFaultState, recordDebuggerExceptionFault } from '../runtime/fault_state';
import { clearRuntimeDebuggerPause } from '../runtime/debug_pause';
import { createRuntimeIdeState, type RuntimeIdeState } from '../runtime/state';
import { handleLuaError } from './runtime_errors';
import {
	editorBlocksRuntimePipeline,
	isManagedOverlayEditorActive,
	toggleEditor,
	updateGamePipelineExts,
} from './overlay_modes';

type DebuggerStepOrigin = { path: string; line: number; depth: number };

export function initializeIdeFeatures(runtime: Runtime, viewport: Viewport): void {
	constants.setIdeThemeVariant(constants.DEFAULT_THEME);
	machineManager.ideState = createRuntimeIdeState(runtime, viewport);
	machineManager.faultState = createRuntimeFaultState();
	Input.instance.setKeyboardCapture(EDITOR_TOGGLE_KEY, true);
	seedDefaultLuaBuiltins();
	registerRuntimeShortcuts(runtime);
	machineManager.ideState.debugger.controller.setBreakpoints(editorDebuggerState.breakpoints);
	updateGamePipelineExts();
}

export function setActiveIdeFontVariant(variant: FontVariant): void {
	const state = machineManager.ideState;
	state.activeFontVariant = variant;
	state.editor.setFontVariant(variant);
}

export function registerRuntimeShortcuts(runtime: Runtime): void {
	disposeShortcutHandlers();
	const registry = Input.instance.getGlobalShortcutRegistry();
	const disposers: Array<() => void> = [];
	disposers.push(registry.registerKeyboardShortcut(1, EDITOR_TOGGLE_KEY, () => {
		Input.instance.getPlayerInput(1).consumeRawButton(EDITOR_TOGGLE_KEY, 'keyboard');
		toggleEditor(runtime);
	}));
	disposers.push(registry.registerGamepadChord(1, EDITOR_TOGGLE_GAMEPAD_BUTTONS, () => toggleEditor(runtime)));
	disposers.push(registry.registerKeyboardShortcut(1, GAME_PAUSE_KEY, () => toggleDebuggerControls()));
	disposers.push(registry.registerKeyboardShortcut(1, 'KeyT', () => {
		Input.instance.getPlayerInput(1).consumeRawButton('KeyT', 'keyboard');
		const next = machineManager.ideState.activeFontVariant === 'tiny' ? 'msx' : 'tiny';
		setActiveIdeFontVariant(next);
	}, KeyModifier.ctrl | KeyModifier.shift));
	disposers.push(registry.registerKeyboardShortcut(1, 'F8', () => {
		const modifiers = machineManager.input.getPlayerInput(1).getModifiersState();
		if (modifiers.ctrl) {
			return;
		}
		if (machineManager.ideState.debugger.suspendSignal) {
			stepOverLuaDebugger(runtime);
		} else {
			machineManager.ideState.debugger.controller.requestStepInto();
		}
	}));
	machineManager.ideState.shortcutDisposers = disposers;
}

export function disposeShortcutHandlers(): void {
	if (machineManager.ideState.shortcutDisposers.length === 0) {
		return;
	}
	for (let i = 0; i < machineManager.ideState.shortcutDisposers.length; i++) {
		machineManager.ideState.shortcutDisposers[i]();
	}
	machineManager.ideState.shortcutDisposers = [];
}

export function tickIdeInput(): void {
	const state = machineManager.ideState;
	if (!editorBlocksRuntimePipeline() || !state.editor.isActive) {
		return;
	}
	const pollFrame = machineManager.input.getPlayerInput(1).pollFrame;
	if (pollFrame === state.lastIdeInputFrame) {
		return;
	}
	state.lastIdeInputFrame = pollFrame;
	state.editor.tickInput();
}

export function setDebuggerPaused(paused: boolean): void {
	machineManager.ideState.debugger.paused = paused;
	editorDebuggerState.controls.executionState = paused ? 'paused' : 'inactive';
	editorDebuggerState.controls.sessionMetrics = machineManager.ideState.debugger.metrics;
	if (!paused) {
		clearExecutionStopHighlights();
	}
}

export function applyDebuggerStopLocation(signal: LuaDebuggerPauseSignal): void {
	setExecutionStopHighlightForCurrentContext(signal.location.line - 1);
}

export function onLuaDebuggerPause(runtime: Runtime, signal: LuaDebuggerPauseSignal): void {
	if (signal.reason === 'exception' && !isManagedOverlayEditorActive()) {
		machineManager.ideState.nativeBridge.luaInterpreter.markFaultEnvironment();
		handleLuaError(runtime, signal.exception);
		return;
	}
	machineManager.ideState.debugger.controller.handlePause(signal);
	const pendingException = machineManager.ideState.nativeBridge.luaInterpreter.pendingDebuggerException;
	machineManager.ideState.debugger.pauseCoordinator.capture(signal, pendingException);
	machineManager.ideState.debugger.suspendSignal = signal;
	machineManager.ideState.debugger.metrics = machineManager.ideState.debugger.controller.getSessionMetrics();
	setDebuggerPaused(true);
	applyDebuggerStopLocation(signal);
	if (signal.reason === 'exception') {
		recordDebuggerExceptionFault(runtime, signal);
		if (runtime.programMetadata && isManagedOverlayEditorActive()) {
			const faultSnapshot = machineManager.faultState.faultSnapshot;
			const message = faultSnapshot.message;
			machineManager.ideState.editor.showRuntimeErrorInChunk(faultSnapshot.path, faultSnapshot.line, faultSnapshot.column, message);
		}
	}
}

export function clearActiveDebuggerPause(runtime: Runtime): void {
	clearRuntimeDebuggerPause(runtime);
	setDebuggerPaused(false);
	machineManager.ideState.editor.clearRuntimeErrorOverlay();
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
	const suspension = machineManager.ideState.debugger.pauseCoordinator.getSuspension();
	const stepOrigin = buildDebuggerStepOrigin(suspension);
	if (options.mode === 'step_into') {
		machineManager.ideState.debugger.controller.requestStepInto(stepOrigin);
	}
	if (options.mode === 'step_over') {
		machineManager.ideState.debugger.controller.requestStepOver(suspension.callStack.length, stepOrigin);
	}
	if (options.mode === 'step_out') {
		machineManager.ideState.debugger.controller.requestStepOut(suspension.callStack.length, stepOrigin);
	}
	if (options.strategy === 'skip_statement' && suspension.reason === 'exception') {
		machineManager.ideState.debugger.controller.markSkippedException();
	}
	machineManager.ideState.nativeBridge.luaInterpreter.debuggerResumeStrategy = options.strategy;
	const result = suspension.resume();
	handleDebuggerResumeResult(runtime, result);
}

export function continueLuaDebugger(runtime: Runtime): void {
	resumeDebugger(runtime, { mode: 'continue', strategy: 'propagate' });
}

export function stepOverLuaDebugger(runtime: Runtime): void {
	const suspension = machineManager.ideState.debugger.pauseCoordinator.getSuspension();
	resumeDebugger(runtime, { mode: 'step_over', strategy: resolveResumeStrategy(suspension) });
}

export function stepIntoLuaDebugger(runtime: Runtime): void {
	const suspension = machineManager.ideState.debugger.pauseCoordinator.getSuspension();
	resumeDebugger(runtime, { mode: 'step_into', strategy: resolveResumeStrategy(suspension) });
}

export function stepOutLuaDebugger(runtime: Runtime): void {
	const suspension = machineManager.ideState.debugger.pauseCoordinator.getSuspension();
	resumeDebugger(runtime, { mode: 'step_out', strategy: resolveResumeStrategy(suspension) });
}

export function ignoreLuaException(runtime: Runtime): void {
	resumeDebugger(runtime, { mode: 'continue', strategy: 'skip_statement' });
}

export function clearFaultState(runtime: Runtime): { cleared: boolean; resumedDebugger: boolean } {
	const hadFault = runtime.luaRuntimeFailed || machineManager.faultState.faultSnapshot !== null || machineManager.ideState.debugger.suspendSignal !== null;
	const wasPaused = machineManager.ideState.debugger.suspendSignal !== null || machineManager.ideState.debugger.paused;
	clearRuntimeFault(runtime);
	if (wasPaused) {
		clearActiveDebuggerPause(runtime);
	}
	return { cleared: hadFault, resumedDebugger: wasPaused };
}

export function surfaceHostFrameError(runtime: Runtime, error: unknown, hostDeltaMs: number, screen: RenderPresentationState): void {
	runtime.frameLoop.abandonFrameState();
	const state = machineManager.ideState;
	state.overlayDrawFrameOwner = null;
	state.overlayRenderer.abandonFrame();
	handleLuaError(runtime, error);
	screen.presentErrorOverlay(runtime, hostDeltaMs);
}

export function tickIDE(runtime: Runtime): void {
	const state = machineManager.ideState;
	if (!editorBlocksRuntimePipeline() || !state.editor.isActive) {
		return;
	}
	if (!beginOverlayUpdateFrame(runtime, state)) {
		return;
	}
	const deltaSeconds = runtime.frameLoop.frameDeltaMs / 1000;
	state.editor.update(deltaSeconds);
	finishOverlayUpdateFrame(runtime, state);
}

function beginOverlayUpdateFrame(runtime: Runtime, state: RuntimeIdeState): boolean {
	if (runtime.frameLoop.frameActive || state.overlayDrawFrameOwner !== null) {
		return false;
	}
	runtime.frameLoop.beginFrameState();
	return true;
}

function finishOverlayUpdateFrame(runtime: Runtime, state: RuntimeIdeState): void {
	state.overlayDrawFrameOwner = 'ide';
	runtime.frameLoop.abandonFrameState();
}

export function tickIDEDraw(runtime: Runtime): void {
	const state = machineManager.ideState;
	if (!editorBlocksRuntimePipeline() || !state.editor.isActive) {
		return;
	}
	try {
		drawIde(runtime);
	} finally {
		if (state.overlayDrawFrameOwner === 'ide') {
			state.overlayDrawFrameOwner = null;
		}
	}
}

export function drawIde(runtime: Runtime): void {
	const state = machineManager.ideState;
	const overlayRenderer = state.overlayRenderer;
	try {
		overlayRenderer.beginFrame();
		overlay_api.beginFrame(overlayRenderer);
		state.editor.draw();
	} catch (error) {
		handleLuaError(runtime, error);
	} finally {
		overlayRenderer.endFrame();
	}
}
