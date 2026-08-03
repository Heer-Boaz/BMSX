import { editorRuntimeState } from '../editor/common/runtime_state';
import { applyAllWorkspaceSourceOverrides, applyLuaCodeTabSources } from '../workspace/workspace';
import { workspaceDirtyRecords } from '../workbench/workspace/state';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../hosts/common/input/manager';
import type { LogOutput } from '../../hosts/common/log';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import { hotResume } from '../runtime/hot_resume';
import { deactivateEditor } from '../workbench/overlay_modes';
import { handleLuaError } from '../workbench/runtime_errors';
import { rebootPreparedRuntime } from '../workbench/blua32_boot';
import type { ActionPromptAction } from '../common/models';
import * as constants from '../common/constants';
import { setEditorCaseInsensitivity } from '../editor/render/text_renderer';
import { editorViewState } from '../editor/ui/view/state';
import { capturePendingLuaCodeTabSources, markLuaCodeTabsAppliedToRuntime } from '../workbench/ui/code_tab/activation';
import { persistWorkspaceSessionLocally } from '../workbench/workspace/storage';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import type { RuntimeTaskQueue } from '../runtime/task_queue';
import type { RuntimeDebuggerState } from '../runtime/debugger_state';

export function performEditorAction(
	editor: CartEditor,
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	debuggerState: RuntimeDebuggerState,
	input: Input,
	runtimeTasks: RuntimeTaskQueue,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
	logOutput: LogOutput,
	action: ActionPromptAction,
): boolean {
	switch (action) {
		case 'hot-resume':
			performHotResume(
				editor,
				sources,
				fault,
				luaTooling,
				debuggerState,
				input,
				runtimeTasks,
				overlayRenderer,
				runtime,
				audioOutput,
				storage,
				logOutput,
			);
			return true;
		case 'reboot':
			return performReboot(
				editor,
				sources,
				fault,
				luaTooling,
				debuggerState,
				runtimeTasks,
				overlayRenderer,
				runtime,
				audioOutput,
				storage,
				logOutput,
			);
		case 'close':
			deactivateEditor(editor, overlayRenderer, audioOutput);
			return true;
		case 'theme-toggle':
			toggleThemeMode();
			return true;
		default:
			return false;
	}
}

export function performHotResume(
	editor: CartEditor,
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	debuggerState: RuntimeDebuggerState,
	input: Input,
	runtimeTasks: RuntimeTaskQueue,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
	logOutput: LogOutput,
): Promise<void> {
	deactivateEditor(editor, overlayRenderer, audioOutput);
	console.log('Performing hot resume.');
	const pendingSources = capturePendingLuaCodeTabSources(sources);
	persistWorkspaceSessionLocally();
	const handleHotResumeError = (error: unknown): void => {
		console.error(error);
		handleLuaError(
			logOutput,
			fault,
			sources,
			runtime,
			luaTooling.suspendedGuest,
			error,
		);
		editor.handleRuntimeTaskError(error, 'Failed to resume game');
	};
	return runtimeTasks.schedule(async () => {
		await applyAllWorkspaceSourceOverrides(
			storage,
			sources,
			workspaceDirtyRecords,
		);
		applyLuaCodeTabSources(sources, pendingSources);
		hotResume(
			sources,
			luaTooling,
			fault,
			debuggerState,
			input,
			runtimeTasks,
			editor,
			runtime,
			sources.systemBlua32MediaDirty,
			sources.cartridgeBlua32MediaDirty,
			handleHotResumeError,
			() => {
				markLuaCodeTabsAppliedToRuntime(pendingSources);
			},
		);
	}, handleHotResumeError);
}

export function performReboot(
	editor: CartEditor,
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	debuggerState: RuntimeDebuggerState,
	runtimeTasks: RuntimeTaskQueue,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
	logOutput: LogOutput,
): boolean {
	deactivateEditor(editor, overlayRenderer, audioOutput);
	const pendingSources = capturePendingLuaCodeTabSources(sources);
	persistWorkspaceSessionLocally();
	runtimeTasks.schedule(async () => {
		console.info('[IDE] Performing cold reboot through bootrom');
		applyLuaCodeTabSources(sources, pendingSources);
		await rebootPreparedRuntime(
			sources,
			fault,
			luaTooling,
			debuggerState,
			editor,
			overlayRenderer,
			runtime,
			audioOutput,
			storage,
		);
		markLuaCodeTabsAppliedToRuntime(pendingSources);
	}, (error) => {
		handleLuaError(
			logOutput,
			fault,
			sources,
			runtime,
			luaTooling.suspendedGuest,
			error,
		);
		editor.handleRuntimeTaskError(error, 'Failed to reboot game');
	});
	return true;
}

function toggleThemeMode(): void {
	const currentVariant = constants.getActiveIdeThemeVariant();
	let nextVariant: string;
	switch (currentVariant) {
		case 'light':
			nextVariant = 'dark';
			break;
		case 'dark':
			nextVariant = 'light';
			break;
		default:
			throw new Error(`[IDE] Unknown theme variant: ${currentVariant}`);
	}
	constants.setIdeThemeVariant(nextVariant);
	editorRuntimeState.themeVariant = constants.getActiveIdeThemeVariant();
	setEditorCaseInsensitivity(editorRuntimeState.uppercaseDisplay);
	editorViewState.layout.invalidateAllHighlights();
}
