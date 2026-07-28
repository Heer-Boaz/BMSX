import { editorRuntimeState } from '../editor/common/runtime_state';
import { scheduleRuntimeTask } from '../common/background_tasks';
import { applyAllWorkspaceSourceOverrides, applyLuaCodeTabSources } from '../workspace/workspace';
import { workspaceDirtyRecords } from '../workbench/workspace/state';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../machine/ts/input/manager';
import type {
	LogOutput,
	MicrotaskQueue,
	StorageService,
} from '../../machine/ts/platform/platform';
import { hotResume } from '../runtime/hot_resume';
import { deactivateEditor } from '../workbench/overlay_modes';
import { handleLuaError } from '../workbench/runtime_errors';
import { rebootPreparedRuntime } from '../workbench/blua32_boot';
import type { ActionPromptAction } from '../common/models';
import { clearExecutionStopHighlights } from '../runtime_error/navigation';
import * as constants from '../common/constants';
import { setEditorCaseInsensitivity } from '../editor/render/text_renderer';
import { editorViewState } from '../editor/ui/view/state';
import { capturePendingLuaCodeTabSources, markLuaCodeTabsAppliedToRuntime } from '../workbench/ui/code_tab/activation';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { GateGroup } from '../../machine/ts/common/taskgate';
import type { OverlayRenderer } from '../runtime/overlay_renderer';

export function performEditorAction(
	editor: CartEditor,
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	luaGate: GateGroup,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	input: Input,
	audioOutput: HostAudioOutput,
	microtasks: MicrotaskQueue,
	storage: StorageService,
	logOutput: LogOutput,
	action: ActionPromptAction,
): boolean {
	switch (action) {
		case 'hot-resume':
			return performHotResume(
				editor,
				sources,
				fault,
				luaTooling,
				overlayRenderer,
				runtime,
				input,
				audioOutput,
				microtasks,
				storage,
				logOutput,
			);
		case 'reboot':
			return performReboot(
				editor,
				sources,
				fault,
				luaTooling,
				luaGate,
				overlayRenderer,
				runtime,
				input,
				audioOutput,
				microtasks,
				storage,
				logOutput,
			);
		case 'close':
			deactivateEditor(editor, overlayRenderer, input, audioOutput);
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
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	input: Input,
	audioOutput: HostAudioOutput,
	microtasks: MicrotaskQueue,
	storage: StorageService,
	logOutput: LogOutput,
): boolean {
	clearExecutionStopHighlights();
	deactivateEditor(editor, overlayRenderer, input, audioOutput);
	console.log('Performing hot resume.');
	const pendingSources = capturePendingLuaCodeTabSources(sources);
	scheduleRuntimeTask(microtasks, audioOutput, async () => {
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
			editor,
			runtime,
			sources.systemBlua32MediaDirty,
			sources.cartridgeBlua32MediaDirty,
		);
		markLuaCodeTabsAppliedToRuntime(pendingSources);
	}, (error) => {
		console.error(error);
		handleLuaError(logOutput, fault, sources, runtime, error);
		editor.handleRuntimeTaskError(error, 'Failed to resume game');
	});
	return true;
}

export function performReboot(
	editor: CartEditor,
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	luaGate: GateGroup,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	input: Input,
	audioOutput: HostAudioOutput,
	microtasks: MicrotaskQueue,
	storage: StorageService,
	logOutput: LogOutput,
): boolean {
	clearExecutionStopHighlights();
	deactivateEditor(editor, overlayRenderer, input, audioOutput);
	const pendingSources = capturePendingLuaCodeTabSources(sources);
	scheduleRuntimeTask(microtasks, audioOutput, async () => {
		console.info('[IDE] Performing cold reboot through bootrom');
		applyLuaCodeTabSources(sources, pendingSources);
		await rebootPreparedRuntime(
			sources,
			fault,
			luaTooling,
			editor,
			luaGate,
			overlayRenderer,
			runtime,
			input,
			audioOutput,
			storage,
			logOutput,
		);
		markLuaCodeTabsAppliedToRuntime(pendingSources);
	}, (error) => {
		handleLuaError(logOutput, fault, sources, runtime, error);
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
