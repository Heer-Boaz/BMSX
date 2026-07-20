import { machineManager } from '../../core/machine_manager';
import { editorRuntimeState } from '../editor/common/runtime_state';
import { scheduleRuntimeTask } from '../common/background_tasks';
import { applyWorkspaceOverridesToRegistry } from '../workspace/workspace';
import type { Runtime } from '../../machine/runtime/runtime';
import { hotResume } from '../runtime/hot_resume';
import { deactivateEditor } from '../workbench/overlay_modes';
import { handleLuaError } from '../workbench/runtime_errors';
import type { ActionPromptAction } from '../common/models';
import { clearExecutionStopHighlights } from '../runtime_error/navigation';
import * as constants from '../common/constants';
import { setEditorCaseInsensitivity } from '../editor/render/text_renderer';
import { editorDocumentState } from '../editor/editing/document_state';
import { editorViewState } from '../editor/ui/view/state';

export function performEditorAction(runtime: Runtime, action: ActionPromptAction): boolean {
	switch (action) {
		case 'hot-resume':
			return performHotResume(runtime);
		case 'reboot':
			return performReboot();
		case 'close':
			deactivateEditor();
			return true;
		case 'theme-toggle':
			toggleThemeMode();
			return true;
		default:
			return false;
	}
}

export function performHotResume(runtime: Runtime): boolean {
	const targetGeneration = editorDocumentState.saveGeneration;
	const shouldUpdateGeneration = hasPendingRuntimeReload();
	clearExecutionStopHighlights();
	deactivateEditor();
	console.log('[IDE] Performing hot-resume');
	scheduleRuntimeTask(async () => {
		const sources = machineManager.sourceState;
		if (sources.cartLuaSources) {
			await applyWorkspaceOverridesToRegistry({
				registry: sources.cartLuaSources,
				storage: machineManager.platform.storage,
				includeServer: true,
				projectRootPath: sources.cartProjectRootPath!,
			});
		}
		await applyWorkspaceOverridesToRegistry({
			registry: sources.systemLuaSources,
			storage: machineManager.platform.storage,
			includeServer: true,
			projectRootPath: sources.systemProjectRootPath,
		});
		hotResume(runtime, sources.systemProgramMediaDirty, sources.cartProgramMediaDirty);
		if (shouldUpdateGeneration) {
			editorDocumentState.appliedGeneration = targetGeneration;
		}
		machineManager.paused = false;
	}, (error) => {
		console.error(error);
		handleLuaError(runtime, error);
		machineManager.ideState.editor.handleRuntimeTaskError(error, 'Failed to resume game');
	});
	return true;
}

export function performReboot(): boolean {
	const targetGeneration = editorDocumentState.saveGeneration;
	clearExecutionStopHighlights();
	deactivateEditor();
	scheduleRuntimeTask(async () => {
		console.info('[IDE] Performing cold reboot through bootrom');
		await machineManager.rebootToBootRom();
		editorDocumentState.appliedGeneration = targetGeneration;
		machineManager.paused = false;
	}, (error) => {
		machineManager.ideState.editor.handleRuntimeTaskError(error, 'Failed to reboot game');
	});
	return true;
}

export function hasPendingRuntimeReload(): boolean {
	return editorDocumentState.saveGeneration > editorDocumentState.appliedGeneration;
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
