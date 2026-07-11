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

export function updateGamePipelineExts(): void {
	const state = machineManager.ideState;
	const overlayActive = state.terminal.isActive || (state.editor.blocksRuntimePipeline && state.editor.isActive);
	state.overlayActive = overlayActive;
	Input.instance.setGameplayCaptureEnabled(!overlayActive);
	updateOverlayAudioSuspension();
}

function updateOverlayAudioSuspension(): void {
	if (!machineManager.sndmaster.isRuntimeAudioReady()) {
		return;
	}
	if (isOverlayActive()) {
		machineManager.sndmaster.suspendAll('overlay');
	} else {
		machineManager.sndmaster.resumeAll('overlay');
	}
}

export function toggleTerminalMode(): void {
	const state = machineManager.ideState;
	if (state.terminal.isActive) {
		deactivateTerminalMode();
		return;
	}
	activateTerminalMode();
}

export function activateTerminalMode(): void {
	const state = machineManager.ideState;
	const terminal = state.terminal;
	if (terminal.isActive) {
		return;
	}
	deactivateEditor();
	terminal.activate();
	updateGamePipelineExts();
}

export function deactivateTerminalMode(): void {
	const state = machineManager.ideState;
	const terminal = state.terminal;
	if (!terminal.isActive) {
		return;
	}
	terminal.deactivate();
	if (state.overlayDrawFrameOwner === 'terminal') {
		state.overlayDrawFrameOwner = null;
	}
	updateGamePipelineExts();
}

function isOverlayActive(): boolean {
	return machineManager.ideState.overlayActive;
}

export function toggleEditor(runtime: Runtime): void {
	const state = machineManager.ideState;
	if (state.editor.isActive) {
		deactivateEditor();
		return;
	}
	activateEditor(runtime);
}

export function activateEditor(runtime: Runtime): void {
	if (!runtime.programMetadata) {
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
	updateGamePipelineExts();
}

export function deactivateEditor(): void {
	const state = machineManager.ideState;
	const editor = state.editor;
	if (editor.isActive) {
		editor.deactivate();
	}
	if (state.overlayDrawFrameOwner === 'ide') {
		state.overlayDrawFrameOwner = null;
	}
	leaveEditorRenderTargets();
	updateGamePipelineExts();
}
