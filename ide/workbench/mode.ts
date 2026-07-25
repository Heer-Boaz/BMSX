import { runtimeWorkbenchState } from '../runtime/workbench_state';
import { machineManager } from '../../machine/ts/core/machine_manager';
import { Input } from '../../machine/ts/input/manager';
import { KeyModifier } from '../../machine/ts/input/player';
import type { ExecutionSignal } from '../../machine/ts/lua/runtime';
import type { LuaDebuggerPauseSignal } from '../../machine/ts/lua/value';
import * as constants from '../common/constants';
import { EDITOR_TOGGLE_GAMEPAD_BUTTONS, EDITOR_TOGGLE_KEY, GAME_PAUSE_KEY } from '../common/constants';
import { editorDebuggerState } from './contrib/debugger/state';
import { seedDefaultLuaBuiltins } from '../runtime/lua_builtins';
import { blua32SymbolsForSlot, activeBlua32MediaSymbols } from '../runtime/lua_pipeline';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { RenderPresentationState } from '../runtime/presentation_state';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import type { Viewport } from '../../machine/ts/rompack/format';
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
	runtimeWorkbenchState.ide = createRuntimeIdeState(runtime, viewport);
	runtimeWorkbenchState.fault = createRuntimeFaultState();
	seedDefaultLuaBuiltins();
	runtimeWorkbenchState.ide.debugger.controller.setBreakpoints(editorDebuggerState.breakpoints);
	updateGamePipelineExts();
	const editorAvailable = runtimeWorkbenchState.ide.editor.isAvailable;
	Input.instance.setKeyboardCapture(EDITOR_TOGGLE_KEY, editorAvailable);
	if (!editorAvailable) {
		disposeShortcutHandlers();
		return;
	}
	registerRuntimeShortcuts(runtime);
}

export function setActiveIdeFontVariant(variant: FontVariant): void {
	const state = runtimeWorkbenchState.ide;
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
		const next = runtimeWorkbenchState.ide.activeFontVariant === 'tiny' ? 'msx' : 'tiny';
		setActiveIdeFontVariant(next);
	}, KeyModifier.ctrl | KeyModifier.shift));
	disposers.push(registry.registerKeyboardShortcut(1, 'F8', () => {
		const modifiers = machineManager.input.getPlayerInput(1).getModifiersState();
		if (modifiers.ctrl) {
			return;
		}
		if (runtimeWorkbenchState.ide.debugger.suspendSignal) {
			stepOverLuaDebugger(runtime);
		} else {
			runtimeWorkbenchState.ide.debugger.controller.requestStepInto();
		}
	}));
	runtimeWorkbenchState.ide.shortcutDisposers = disposers;
}

export function disposeShortcutHandlers(): void {
	if (runtimeWorkbenchState.ide.shortcutDisposers.length === 0) {
		return;
	}
	for (let i = 0; i < runtimeWorkbenchState.ide.shortcutDisposers.length; i++) {
		runtimeWorkbenchState.ide.shortcutDisposers[i]();
	}
	runtimeWorkbenchState.ide.shortcutDisposers = [];
}

export function tickIdeInput(): void {
	const state = runtimeWorkbenchState.ide;
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
	runtimeWorkbenchState.ide.debugger.paused = paused;
	editorDebuggerState.controls.executionState = paused ? 'paused' : 'inactive';
	editorDebuggerState.controls.sessionMetrics = runtimeWorkbenchState.ide.debugger.metrics;
	if (!paused) {
		clearExecutionStopHighlights();
	}
}

export function applyDebuggerStopLocation(signal: LuaDebuggerPauseSignal): void {
	setExecutionStopHighlightForCurrentContext(signal.location.line - 1);
}

export function onLuaDebuggerPause(runtime: Runtime, signal: LuaDebuggerPauseSignal): void {
	if (signal.reason === 'exception' && !isManagedOverlayEditorActive()) {
		runtimeWorkbenchState.ide.nativeBridge.luaInterpreter.markFaultEnvironment();
		handleLuaError(runtime, signal.exception);
		return;
	}
	runtimeWorkbenchState.ide.debugger.controller.handlePause(signal);
	const pendingException = runtimeWorkbenchState.ide.nativeBridge.luaInterpreter.pendingDebuggerException;
	runtimeWorkbenchState.ide.debugger.pauseCoordinator.capture(signal, pendingException);
	runtimeWorkbenchState.ide.debugger.suspendSignal = signal;
	runtimeWorkbenchState.ide.debugger.metrics = runtimeWorkbenchState.ide.debugger.controller.getSessionMetrics();
	setDebuggerPaused(true);
	applyDebuggerStopLocation(signal);
	if (signal.reason === 'exception') {
		recordDebuggerExceptionFault(runtime, signal);
		const hasActiveSymbols = blua32SymbolsForSlot(activeBlua32MediaSymbols(), runtime.machine.cpu.activeCartridgeSlot()) !== null;
		if (hasActiveSymbols && isManagedOverlayEditorActive()) {
			const faultSnapshot = runtimeWorkbenchState.fault.faultSnapshot;
			const message = faultSnapshot.message;
			runtimeWorkbenchState.ide.editor.showRuntimeErrorInChunk(faultSnapshot.path, faultSnapshot.line, faultSnapshot.column, message);
		}
	}
}

export function clearActiveDebuggerPause(runtime: Runtime): void {
	clearRuntimeDebuggerPause(runtime);
	setDebuggerPaused(false);
	runtimeWorkbenchState.ide.editor.clearRuntimeErrorOverlay();
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
	const suspension = runtimeWorkbenchState.ide.debugger.pauseCoordinator.getSuspension();
	const stepOrigin = buildDebuggerStepOrigin(suspension);
	if (options.mode === 'step_into') {
		runtimeWorkbenchState.ide.debugger.controller.requestStepInto(stepOrigin);
	}
	if (options.mode === 'step_over') {
		runtimeWorkbenchState.ide.debugger.controller.requestStepOver(suspension.callStack.length, stepOrigin);
	}
	if (options.mode === 'step_out') {
		runtimeWorkbenchState.ide.debugger.controller.requestStepOut(suspension.callStack.length, stepOrigin);
	}
	if (options.strategy === 'skip_statement' && suspension.reason === 'exception') {
		runtimeWorkbenchState.ide.debugger.controller.markSkippedException();
	}
	runtimeWorkbenchState.ide.nativeBridge.luaInterpreter.debuggerResumeStrategy = options.strategy;
	const result = suspension.resume();
	handleDebuggerResumeResult(runtime, result);
}

export function continueLuaDebugger(runtime: Runtime): void {
	resumeDebugger(runtime, { mode: 'continue', strategy: 'propagate' });
}

export function stepOverLuaDebugger(runtime: Runtime): void {
	const suspension = runtimeWorkbenchState.ide.debugger.pauseCoordinator.getSuspension();
	resumeDebugger(runtime, { mode: 'step_over', strategy: resolveResumeStrategy(suspension) });
}

export function stepIntoLuaDebugger(runtime: Runtime): void {
	const suspension = runtimeWorkbenchState.ide.debugger.pauseCoordinator.getSuspension();
	resumeDebugger(runtime, { mode: 'step_into', strategy: resolveResumeStrategy(suspension) });
}

export function stepOutLuaDebugger(runtime: Runtime): void {
	const suspension = runtimeWorkbenchState.ide.debugger.pauseCoordinator.getSuspension();
	resumeDebugger(runtime, { mode: 'step_out', strategy: resolveResumeStrategy(suspension) });
}

export function ignoreLuaException(runtime: Runtime): void {
	resumeDebugger(runtime, { mode: 'continue', strategy: 'skip_statement' });
}

export function clearFaultState(runtime: Runtime): { cleared: boolean; resumedDebugger: boolean } {
	const hadFault = runtime.luaRuntimeFailed || runtimeWorkbenchState.fault.faultSnapshot !== null || runtimeWorkbenchState.ide.debugger.suspendSignal !== null;
	const wasPaused = runtimeWorkbenchState.ide.debugger.suspendSignal !== null || runtimeWorkbenchState.ide.debugger.paused;
	clearRuntimeFault(runtime);
	if (wasPaused) {
		clearActiveDebuggerPause(runtime);
	}
	return { cleared: hadFault, resumedDebugger: wasPaused };
}

export function surfaceHostFrameError(runtime: Runtime, error: unknown, hostDeltaMs: number, screen: RenderPresentationState): void {
	runtime.frameLoop.abandonFrameState();
	const state = runtimeWorkbenchState.ide;
	state.overlayDrawFrameOwner = null;
	state.overlayRenderer.abandonFrame();
	handleLuaError(runtime, error);
	screen.presentErrorOverlay(runtime, hostDeltaMs);
}

export function tickIDE(runtime: Runtime): void {
	const state = runtimeWorkbenchState.ide;
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
	runtime.frameLoop.beginFrameState(0, 0);
	return true;
}

function finishOverlayUpdateFrame(runtime: Runtime, state: RuntimeIdeState): void {
	state.overlayDrawFrameOwner = 'ide';
	runtime.frameLoop.abandonFrameState();
}

export function tickIDEDraw(runtime: Runtime): void {
	const state = runtimeWorkbenchState.ide;
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
	const state = runtimeWorkbenchState.ide;
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
