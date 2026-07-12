import { setOverlayResolutionMode } from '../runtime/state';
import { machineManager } from '../../core/machine_manager';
import { Input } from '../../input/manager';
import type { Runtime } from '../../machine/runtime/runtime';

const EDITOR_TARGET_WIDTH = 384;
const EDITOR_TARGET_HEIGHT = 288;

function enterEditorRenderTargets(): void {
	const state = machineManager.ideState;
	if (state.editorRenderTargetBaselineActive) {
		return;
	}
	const view = machineManager.view;
	state.editorRenderTargetBaselineWidth = view.viewportSize.x;
	state.editorRenderTargetBaselineHeight = view.viewportSize.y;
	state.editorRenderTargetBaselineActive = true;
	view.setRenderTargetSize(EDITOR_TARGET_WIDTH, EDITOR_TARGET_HEIGHT);
	setOverlayResolutionMode(state, view, 'viewport');
}

function leaveEditorRenderTargets(): void {
	const state = machineManager.ideState;
	if (!state.editorRenderTargetBaselineActive) {
		return;
	}
	const view = machineManager.view;
	view.setRenderTargetSize(state.editorRenderTargetBaselineWidth, state.editorRenderTargetBaselineHeight);
	setOverlayResolutionMode(state, view, 'viewport');
	state.editorRenderTargetBaselineActive = false;
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
