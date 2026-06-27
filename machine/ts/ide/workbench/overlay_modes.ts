import { setOverlayResolutionMode, type RenderTargetSnapshot } from '../runtime/state';
import { machineManager } from '../../core/machine_manager';
import { Input } from '../../input/manager';
import type { Runtime } from '../../machine/runtime/runtime';

const EDITOR_TARGET = { x: 384, y: 288 };

function captureCurrentTargets(): RenderTargetSnapshot {
	const view = machineManager.view;
	return {
		viewportSize: { x: view.viewportSize.x, y: view.viewportSize.y },
		canvasSize: { x: view.canvasSize.x, y: view.canvasSize.y },
		offscreenSize: { x: view.offscreenCanvasSize.x, y: view.offscreenCanvasSize.y },
	};
}

function applyFixedEditorTargets(): void {
	machineManager.view.configureRenderTargets({
		viewportSize: EDITOR_TARGET,
		canvasSize: EDITOR_TARGET,
		offscreenSize: EDITOR_TARGET,
	});
	setOverlayResolutionMode(machineManager.ideState, machineManager.view, 'viewport');
}

function restoreTargets(snapshot: RenderTargetSnapshot): void {
	machineManager.view.configureRenderTargets({
		viewportSize: snapshot.viewportSize,
		canvasSize: snapshot.canvasSize,
		offscreenSize: snapshot.offscreenSize,
	});
	setOverlayResolutionMode(machineManager.ideState, machineManager.view, 'viewport');
}

function enterEditorRenderTargets(): void {
	const state = machineManager.ideState;
	if (state.editorRenderTargetBaseline !== null) {
		return;
	}
	state.editorRenderTargetBaseline = captureCurrentTargets();
	applyFixedEditorTargets();
}

function leaveEditorRenderTargets(): void {
	const state = machineManager.ideState;
	const snapshot = state.editorRenderTargetBaseline;
	if (snapshot === null) {
		return;
	}
	restoreTargets(snapshot);
	state.editorRenderTargetBaseline = null;
}

export function editorBlocksRuntimePipeline(): boolean {
	const state = machineManager.ideState;
	return state.editor.blocksRuntimePipeline;
}

export function isManagedOverlayEditorActive(): boolean {
	const state = machineManager.ideState;
	if (!state.editor.blocksRuntimePipeline) {
		return false;
	}
	return state.editor.isActive;
}

export function updateGamePipelineExts(runtime: Runtime): void {
	const state = machineManager.ideState;
	const overlayActive = state.terminal.isActive || (state.editor.blocksRuntimePipeline && state.editor.isActive);
	runtime.executionOverlayActive = overlayActive;
	machineManager.view.presentWorkbenchFrameBufferTexture = overlayActive;
	Input.instance.setGameplayCaptureEnabled(!overlayActive);
	updateOverlayAudioSuspension(runtime);
}

function updateOverlayAudioSuspension(runtime: Runtime): void {
	if (!machineManager.sndmaster.isRuntimeAudioReady()) {
		return;
	}
	if (isOverlayActive(runtime)) {
		machineManager.sndmaster.suspendAll('overlay');
	} else {
		machineManager.sndmaster.resumeAll('overlay');
	}
}

export function toggleTerminalMode(runtime: Runtime): void {
	const state = machineManager.ideState;
	if (state.terminal.isActive) {
		deactivateTerminalMode(runtime);
		return;
	}
	activateTerminalMode(runtime);
}

export function activateTerminalMode(runtime: Runtime): void {
	const state = machineManager.ideState;
	const terminal = state.terminal;
	if (terminal.isActive) {
		return;
	}
	deactivateEditor(runtime);
	terminal.activate();
	updateGamePipelineExts(runtime);
}

export function deactivateTerminalMode(runtime: Runtime): void {
	const state = machineManager.ideState;
	const terminal = state.terminal;
	if (!terminal.isActive) {
		return;
	}
	terminal.deactivate();
	if (state.overlayDrawFrameOwner === 'terminal') {
		state.overlayDrawFrameOwner = null;
	}
	updateGamePipelineExts(runtime);
}

function isOverlayActive(runtime: Runtime): boolean {
	return runtime.executionOverlayActive;
}

export function toggleEditor(runtime: Runtime): void {
	const state = machineManager.ideState;
	if (state.editor.isActive) {
		deactivateEditor(runtime);
		return;
	}
	activateEditor(runtime);
}

export function activateEditor(runtime: Runtime): void {
	if (!runtime.hasProgramSymbols) {
		return;
	}
	const state = machineManager.ideState;
	if (state.terminal.isActive) {
		state.terminal.deactivate();
	}
	const editor = state.editor;
	const wasActive = editor.isActive;
	if (!wasActive) {
		enterEditorRenderTargets();
	}
	try {
		if (!editor.isActive) {
			editor.activate();
		}
	} catch (error) {
		if (!wasActive) {
			leaveEditorRenderTargets();
		}
		throw error;
	}
	if (!editor.isActive && !wasActive) {
		leaveEditorRenderTargets();
	}
	updateGamePipelineExts(runtime);
}

export function deactivateEditor(runtime: Runtime): void {
	const state = machineManager.ideState;
	const editor = state.editor;
	if (editor.isActive) {
		editor.deactivate();
	}
	if (state.overlayDrawFrameOwner === 'ide') {
		state.overlayDrawFrameOwner = null;
	}
	leaveEditorRenderTargets();
	updateGamePipelineExts(runtime);
}
