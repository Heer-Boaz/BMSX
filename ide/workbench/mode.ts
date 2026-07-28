import { machineManager } from '../../machine/ts/core/machine_manager';
import { Input } from '../../machine/ts/input/manager';
import { KeyModifier } from '../../machine/ts/input/player';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { Viewport } from '../../machine/ts/rompack/format';
import * as constants from '../common/constants';
import { EDITOR_TOGGLE_GAMEPAD_BUTTONS, EDITOR_TOGGLE_KEY, GAME_PAUSE_KEY } from '../common/constants';
import { toggleDebuggerControls } from '../debugger_activation';
import { seedDefaultLuaBuiltins } from '../runtime/lua_builtins';
import { api as overlay_api } from '../runtime/overlay_api';
import {
	developmentCartridgeSource,
	runtimeSourcesSupportIde,
	type RuntimeSourceState,
} from '../runtime/sources';
import { RuntimeIdeState } from '../runtime/state';
import {
	initializeWorkspaceStorage,
	restoreWorkspaceStorageSession,
	shutdownWorkspaceStorage,
} from './workspace/storage';
import {
	applyAllWorkspaceSourceOverrides,
} from '../workspace/workspace';
import {
	workspaceDirtyRecords,
} from './workspace/state';
import { handleLuaError } from './runtime_errors';
import {
	editorBlocksRuntimePipeline,
	toggleEditor,
	updateGamePipelineExts,
} from './overlay_modes';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';

export async function initializeIdeFeatures(
	runtime: Runtime,
	presenter: VideoPresenter,
	viewport: Viewport,
	sources: RuntimeSourceState,
): Promise<RuntimeIdeState> {
	constants.setIdeThemeVariant(constants.DEFAULT_THEME);
	const editorAvailable = runtimeSourcesSupportIde(sources);
	let workspacePayload = null;
	if (editorAvailable) {
		const cartridge = developmentCartridgeSource(sources);
		workspacePayload = await initializeWorkspaceStorage(
			cartridge ? cartridge.projectRootPath : sources.systemProjectRootPath,
			sources,
		);
	} else {
		await shutdownWorkspaceStorage();
	}
	const rejectedDirtyPaths = await applyAllWorkspaceSourceOverrides(
		sources,
		workspaceDirtyRecords,
	);
	const state = new RuntimeIdeState(runtime, presenter, viewport, sources);
	seedDefaultLuaBuiltins();
	updateGamePipelineExts(state.editor, state.overlayRenderer);
	Input.instance.setKeyboardCapture(EDITOR_TOGGLE_KEY, editorAvailable);
	if (!editorAvailable) {
		disposeShortcutHandlers(state);
		return state;
	}
	await restoreWorkspaceStorageSession(
		state.editor,
		sources,
		state.debugger,
		workspacePayload,
		rejectedDirtyPaths,
	);
	registerRuntimeShortcuts(state, runtime);
	return state;
}

export function registerRuntimeShortcuts(state: RuntimeIdeState, runtime: Runtime): void {
	disposeShortcutHandlers(state);
	const registry = Input.instance.getGlobalShortcutRegistry();
	const disposers: Array<() => void> = [];
	disposers.push(registry.registerKeyboardShortcut(1, EDITOR_TOGGLE_KEY, () => {
		Input.instance.getPlayerInput(1).consumeRawButton(EDITOR_TOGGLE_KEY, 'keyboard');
		toggleEditor(state.editor, state.sources, state.overlayRenderer, runtime);
	}));
	disposers.push(registry.registerGamepadChord(
		1,
		EDITOR_TOGGLE_GAMEPAD_BUTTONS,
		() => toggleEditor(state.editor, state.sources, state.overlayRenderer, runtime),
	));
	disposers.push(registry.registerKeyboardShortcut(1, GAME_PAUSE_KEY, () => toggleDebuggerControls()));
	disposers.push(registry.registerKeyboardShortcut(1, 'KeyT', () => {
		Input.instance.getPlayerInput(1).consumeRawButton('KeyT', 'keyboard');
		const next = state.editor.fontVariant === 'tiny' ? 'msx' : 'tiny';
		state.editor.setFontVariant(next);
	}, KeyModifier.ctrl | KeyModifier.shift));
	state.shortcutDisposers = disposers;
}

export function disposeShortcutHandlers(state: RuntimeIdeState): void {
	if (state.shortcutDisposers.length === 0) {
		return;
	}
	for (let i = 0; i < state.shortcutDisposers.length; i += 1) {
		state.shortcutDisposers[i]();
	}
	state.shortcutDisposers = [];
}

export function tickIdeInput(state: RuntimeIdeState): void {
	if (!editorBlocksRuntimePipeline(state.editor) || !state.editor.isActive) {
		return;
	}
	const pollFrame = machineManager.input.getPlayerInput(1).pollFrame;
	if (pollFrame === state.lastIdeInputFrame) {
		return;
	}
	state.lastIdeInputFrame = pollFrame;
	state.editor.tickInput();
}

export function surfaceHostFrameError(state: RuntimeIdeState, runtime: Runtime, error: unknown): void {
	state.overlayRenderer.abandonFrame();
	state.fault.hostFrameFailed = true;
	handleLuaError(state.fault, state.sources, runtime, error);
}

export function tickIDE(state: RuntimeIdeState, deltaSeconds: number): void {
	if (!editorBlocksRuntimePipeline(state.editor) || !state.editor.isActive) {
		return;
	}
	if (state.overlayRenderer.drawFramePending) {
		return;
	}
	state.editor.update(deltaSeconds);
	state.overlayRenderer.drawFramePending = true;
}

export function tickIDEDraw(state: RuntimeIdeState, runtime: Runtime): void {
	if (!editorBlocksRuntimePipeline(state.editor) || !state.editor.isActive) {
		return;
	}
	try {
		drawIde(state, runtime);
	} finally {
		state.overlayRenderer.drawFramePending = false;
	}
}

export function drawIde(state: RuntimeIdeState, runtime: Runtime): void {
	const overlayRenderer = state.overlayRenderer;
	try {
		overlayRenderer.beginFrame(state.presenter);
		overlay_api.beginFrame(overlayRenderer);
		state.editor.draw();
	} catch (error) {
		handleLuaError(state.fault, state.sources, runtime, error);
	} finally {
		overlayRenderer.endFrame();
	}
}
