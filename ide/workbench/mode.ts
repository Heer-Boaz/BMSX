import { KeyModifier } from '../../hosts/common/input/player';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../hosts/common/input/manager';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { Clipboard } from '../common/clipboard';
import type { HostClock } from '../../hosts/common/clock';
import type { LogOutput } from '../../hosts/common/log';
import type { MicrotaskQueue } from '../common/microtask_queue';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { EditorDisplay, Viewport } from '../common/viewport';
import * as constants from '../common/constants';
import { EDITOR_TOGGLE_CONTROLS } from '../common/constants';
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

export async function initializeIdeFeatures(
	runtime: Runtime,
	presenter: VideoPresenter,
	display: EditorDisplay,
	input: Input,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
	clock: HostClock,
	clipboard: Clipboard,
	microtasks: MicrotaskQueue,
	logOutput: LogOutput,
	resourcePanelWidthRatio: number,
	viewport: Viewport,
	sources: RuntimeSourceState,
): Promise<RuntimeIdeState> {
	constants.setIdeThemeVariant(constants.DEFAULT_THEME);
	const editorAvailable = runtimeSourcesSupportIde(sources);
	let workspacePayload = null;
	if (editorAvailable) {
		const cartridge = developmentCartridgeSource(sources);
		workspacePayload = await initializeWorkspaceStorage(
			storage,
			clock,
			cartridge ? cartridge.projectRootPath : sources.systemProjectRootPath,
			sources,
		);
	} else {
		await shutdownWorkspaceStorage();
	}
	const rejectedDirtyPaths = await applyAllWorkspaceSourceOverrides(
		storage,
		sources,
		workspaceDirtyRecords,
	);
	const state = new RuntimeIdeState(
		runtime,
		presenter,
		display,
		input,
		audioOutput,
		storage,
		clock,
		clipboard,
		microtasks,
		logOutput,
		resourcePanelWidthRatio,
		viewport,
		sources,
	);
	seedDefaultLuaBuiltins();
	updateGamePipelineExts(state.editor, state.overlayRenderer, audioOutput);
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
	registerRuntimeShortcuts(state, runtime, input, audioOutput);
	return state;
}

export function registerRuntimeShortcuts(
	state: RuntimeIdeState,
	runtime: Runtime,
	input: Input,
	audioOutput: HostAudioOutput,
): void {
	disposeShortcutHandlers(state);
	const registry = input.getGlobalShortcutRegistry();
	const disposers: Array<() => void> = [];
	disposers.push(registry.registerControlChord(
		1,
		EDITOR_TOGGLE_CONTROLS,
		() => toggleEditor(
			state.editor,
			state.sources,
			state.overlayRenderer,
			runtime,
			audioOutput,
		),
	));
	disposers.push(registry.registerKeyboardShortcut(1, 'KeyT', () => {
		input.getPlayerInput(1).consumeRawButton('KeyT', 'keyboard');
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

export function tickIdeInput(state: RuntimeIdeState, input: Input): void {
	if (!editorBlocksRuntimePipeline(state.editor) || !state.editor.isActive) {
		return;
	}
	const pollFrame = input.getPlayerInput(1).pollFrame;
	if (pollFrame === state.lastIdeInputFrame) {
		return;
	}
	state.lastIdeInputFrame = pollFrame;
	state.editor.tickInput();
}

export function surfaceHostFrameError(
	state: RuntimeIdeState,
	logOutput: LogOutput,
	runtime: Runtime,
	error: unknown,
): void {
	state.overlayRenderer.abandonFrame();
	state.fault.hostFrameFailed = true;
	handleLuaError(
		logOutput,
		state.fault,
		state.sources,
		runtime,
		state.luaTooling.suspendedGuest,
		error,
	);
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

export function tickIDEDraw(
	state: RuntimeIdeState,
	presenter: VideoPresenter,
): void {
	if (!editorBlocksRuntimePipeline(state.editor) || !state.editor.isActive) {
		return;
	}
	try {
		drawIde(state, presenter);
	} finally {
		state.overlayRenderer.drawFramePending = false;
	}
}

export function drawIde(state: RuntimeIdeState, presenter: VideoPresenter): void {
	const overlayRenderer = state.overlayRenderer;
	try {
		overlayRenderer.beginFrame(presenter);
		overlay_api.beginFrame(overlayRenderer);
		state.editor.draw();
	} finally {
		overlayRenderer.endFrame();
	}
}
