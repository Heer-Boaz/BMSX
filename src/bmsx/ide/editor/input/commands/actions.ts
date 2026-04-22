import { $ } from '../../../../core/engine';
import { editorRuntimeState } from '../../common/runtime_state';
import { scheduleRuntimeTask } from '../../../common/background_tasks';
import { applyWorkspaceOverridesToCart, applyWorkspaceOverridesToRegistry, DEFAULT_ENGINE_PROJECT_ROOT_PATH } from '../../../workspace/workspace';
import { Runtime } from '../../../../machine/runtime/runtime';
import * as luaPipeline from '../../../runtime/lua_pipeline';
import * as workbenchMode from '../../../runtime/workbench_mode';
import type { ActionPromptAction } from '../../../common/models';
import { handleRuntimeTaskError } from '../../ui/runtime';
import { clearExecutionStopHighlights } from '../../../runtime/error/navigation';
import * as constants from '../../../common/constants';
import { setEditorCaseInsensitivity } from '../../render/text_renderer';
import { editorDocumentState } from '../../editing/document_state';
import { getCodeTabContexts } from '../../../workbench/ui/code_tab/contexts';
import { editorViewState } from '../../ui/view/state';

export function performEditorAction(action: ActionPromptAction): boolean {
	switch (action) {
		case 'hot-resume':
			return performHotResume();
		case 'reboot':
			return performReboot();
		case 'close':
			workbenchMode.deactivateEditor(Runtime.instance);
			return true;
		case 'theme-toggle':
			toggleThemeMode();
			return true;
		default:
			return false;
	}
}

function hasPendingEngineModuleReload(runtime: Runtime): boolean {
	if (!runtime.cartLuaSources) {
		return false;
	}
	for (const context of getCodeTabContexts()) {
		if (context.mode !== 'lua') {
			continue;
		}
		if (context.saveGeneration <= context.appliedGeneration) {
			continue;
		}
		if (runtime.engineLuaSources.path2lua[context.descriptor.path]) {
			return true;
		}
	}
	return false;
}

export function performHotResume(): boolean {
	const runtime = Runtime.instance;
	const targetGeneration = editorDocumentState.saveGeneration;
	const shouldUpdateGeneration = hasPendingRuntimeReload();
	clearExecutionStopHighlights();
	workbenchMode.deactivateEditor(Runtime.instance);
	console.log('[IDE] Performing hot-resume');
	scheduleRuntimeTask(async () => {
		console.log('[IDE] Applying workspace overrides to cart before resume');
		if (runtime.cartLuaSources) {
			await applyWorkspaceOverridesToCart({ cart: runtime.cartLuaSources, storage: $.platform.storage, includeServer: true });
		}
		console.log('[IDE] Applying workspace overrides to BIOS before resume');
		const engineChanged = await applyWorkspaceOverridesToRegistry({
			registry: runtime.engineLuaSources,
			storage: $.platform.storage,
			includeServer: true,
			projectRootPath: $.engine_layer.index.projectRootPath || DEFAULT_ENGINE_PROJECT_ROOT_PATH,
		});
		const preserveEngineModules =
				$.sources !== runtime.engineLuaSources
			&& engineChanged.size === 0
			&& !hasPendingEngineModuleReload(runtime);
		console.log('[IDE] Capturing runtime snapshot for resume');
		const snapshot = luaPipeline.captureCurrentState(runtime);
		console.log('[IDE] Clear execution stop highlights before resume');
		workbenchMode.clearFaultState(runtime);
		console.log('[IDE] Resuming from snapshot after hot-resume');
			await luaPipeline.resumeFromSnapshot(runtime, snapshot, preserveEngineModules);
		if (shouldUpdateGeneration) {
			console.log('[IDE] Updating applied generation after resume');
			editorDocumentState.appliedGeneration = targetGeneration;
		}
		$.paused = false;
	}, (error) => {
		console.error(error);
		handleRuntimeTaskError(error, 'Failed to resume game');
	});
	return true;
}

export function performReboot(): boolean {
	const runtime = Runtime.instance;
	const targetGeneration = editorDocumentState.saveGeneration;
	clearExecutionStopHighlights();
	workbenchMode.deactivateEditor(Runtime.instance);
	scheduleRuntimeTask(async () => {
		console.info('[IDE] Performing cold reboot through bootrom');
		await runtime.rebootToBootRom();
		editorDocumentState.appliedGeneration = targetGeneration;
		$.paused = false;
	}, (error) => {
		handleRuntimeTaskError(error, 'Failed to reboot game');
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
