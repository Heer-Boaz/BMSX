import { consoleCore } from '../../core/console';
import { Input } from '../../input/manager';
import { shallowcopy } from '../../common/shallowcopy';
import type { Runtime } from '../../machine/runtime/runtime';

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

const EDITOR_TARGET: RenderTargetVec2 = { x: 384, y: 288 };
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
	const view = consoleCore.view;
	return {
		viewportSize: shallowcopy(view.viewportSize),
		canvasSize: shallowcopy(view.canvasSize),
		offscreenSize: shallowcopy(view.offscreenCanvasSize),
	};
}

function applyFixedEditorTargets(runtime: Runtime): void {
	consoleCore.view.configureRenderTargets({
		viewportSize: EDITOR_TARGET,
		canvasSize: EDITOR_TARGET,
		offscreenSize: EDITOR_TARGET,
	});
	runtime.overlayResolutionMode = 'viewport';
}

function restoreTargets(runtime: Runtime, snapshot: RenderTargetSnapshot): void {
	consoleCore.view.configureRenderTargets({
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

export function editorBlocksRuntimePipeline(runtime: Runtime): boolean {
	return runtime.editor.blocksRuntimePipeline;
}

export function isManagedOverlayEditorActive(runtime: Runtime): boolean {
	if (!editorBlocksRuntimePipeline(runtime)) {
		return false;
	}
	return runtime.editor.isActive;
}

export function updateGamePipelineExts(runtime: Runtime): void {
	const overlayActive = runtime.terminal.isActive || isManagedOverlayEditorActive(runtime);
	runtime.executionOverlayActive = overlayActive;
	Input.instance.setGameplayCaptureEnabled(!overlayActive);
	updateOverlayAudioSuspension(runtime);
}

function updateOverlayAudioSuspension(runtime: Runtime): void {
	if (!consoleCore.sndmaster.isRuntimeAudioReady()) {
		return;
	}
	if (isOverlayActive(runtime)) {
		consoleCore.sndmaster.suspendAll('overlay');
	} else {
		consoleCore.sndmaster.resumeAll('overlay');
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

function isOverlayActive(runtime: Runtime): boolean {
	return runtime.executionOverlayActive;
}

export function toggleEditor(runtime: Runtime): void {
	if (runtime.editor.isActive) {
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
	const editor = runtime.editor;
	const wasActive = editor.isActive;
	if (!wasActive) {
		pushRenderTargetOwner(runtime, 'editor');
	}
	try {
		if (!editor.isActive) {
			editor.activate();
		}
	} catch (error) {
		if (!wasActive) {
			popRenderTargetOwner(runtime, 'editor');
		}
		throw error;
	}
	if (!editor.isActive && !wasActive) {
		popRenderTargetOwner(runtime, 'editor');
	}
	updateGamePipelineExts(runtime);
}

export function deactivateEditor(runtime: Runtime): void {
	const editor = runtime.editor;
	if (editor.isActive) {
		editor.deactivate();
	}
	popRenderTargetOwner(runtime, 'editor');
	updateGamePipelineExts(runtime);
}
