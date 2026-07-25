import { runtimeWorkbenchState } from '../runtime/workbench_state';
import { setOverlayResolutionMode } from '../runtime/state';
import { blua32SymbolsForSlot, activeBlua32MediaSymbols } from '../runtime/lua_pipeline';
import { machineManager } from '../../machine/ts/core/machine_manager';
import { Input } from '../../machine/ts/input/manager';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';

const EDITOR_TARGET_WIDTH = 384;
const EDITOR_TARGET_HEIGHT = 288;

function enterEditorRenderTargets(): void {
	const state = runtimeWorkbenchState.ide;
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
	const state = runtimeWorkbenchState.ide;
	if (!state.editorRenderTargetBaselineActive) {
		return;
	}
	const view = machineManager.view;
	view.setRenderTargetSize(state.editorRenderTargetBaselineWidth, state.editorRenderTargetBaselineHeight);
	setOverlayResolutionMode(state, view, 'viewport');
	state.editorRenderTargetBaselineActive = false;
}

export function editorBlocksRuntimePipeline(): boolean {
	const state = runtimeWorkbenchState.ide;
	return state.editor.blocksRuntimePipeline;
}

export function isManagedOverlayEditorActive(): boolean {
	const state = runtimeWorkbenchState.ide;
	if (!state.editor.blocksRuntimePipeline) {
		return false;
	}
	return state.editor.isActive;
}

export function updateGamePipelineExts(): void {
	const state = runtimeWorkbenchState.ide;
	const overlayActive = state.editor.blocksRuntimePipeline && state.editor.isActive;
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

function isOverlayActive(): boolean {
	return runtimeWorkbenchState.ide.overlayActive;
}

export function toggleEditor(runtime: Runtime): void {
	const state = runtimeWorkbenchState.ide;
	if (state.editor.isActive) {
		deactivateEditor();
		return;
	}
	activateEditor(runtime);
}

export function activateEditor(runtime: Runtime): void {
	if (blua32SymbolsForSlot(activeBlua32MediaSymbols(), runtime.machine.cpu.activeCartridgeSlot()) === null) {
		return;
	}
	const state = runtimeWorkbenchState.ide;
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
	const state = runtimeWorkbenchState.ide;
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
