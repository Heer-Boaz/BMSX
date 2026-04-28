import { engineCore } from '../../core/engine';
import { editorRuntimeState } from '../editor/common/runtime_state';
import { scheduleRuntimeTask } from '../common/background_tasks';
import { applyWorkspaceOverridesToCart, applyWorkspaceOverridesToRegistry } from '../workspace/workspace';
import type { Runtime } from '../../machine/runtime/runtime';
import { captureRuntimeResumeSnapshot } from '../../machine/runtime/resume_snapshot';
import * as luaPipeline from '../runtime/lua_pipeline';
import * as workbenchMode from '../workbench/mode';
import type { ActionPromptAction } from '../common/models';
import { clearExecutionStopHighlights } from '../runtime_error/navigation';
import * as constants from '../common/constants';
import { setEditorCaseInsensitivity } from '../editor/render/text_renderer';
import { editorDocumentState } from '../editor/editing/document_state';
import { getCodeTabContexts } from '../workbench/ui/code_tab/contexts';
import { editorViewState } from '../editor/ui/view/state';

export function performEditorAction(runtime: Runtime, action: ActionPromptAction): boolean {
	switch (action) {
		case 'hot-resume':
			return performHotResume(runtime);
		case 'reboot':
			return performReboot(runtime);
		case 'close':
			workbenchMode.deactivateEditor(runtime);
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

export function performHotResume(runtime: Runtime): boolean {
	const targetGeneration = editorDocumentState.saveGeneration;
	const shouldUpdateGeneration = hasPendingRuntimeReload();
	clearExecutionStopHighlights();
	workbenchMode.deactivateEditor(runtime);
	console.log('[IDE] Performing hot-resume');
	scheduleRuntimeTask(async () => {
		console.log('[IDE] Applying workspace overrides to cart before resume');
		if (runtime.cartLuaSources) {
			await applyWorkspaceOverridesToCart(runtime, {
				cart: runtime.cartLuaSources,
				storage: runtime.storageService,
				includeServer: true,
				projectRootPath: runtime.cartProjectRootPath,
			});
		}
		console.log('[IDE] Applying workspace overrides to BIOS before resume');
		const engineChanged = await applyWorkspaceOverridesToRegistry(runtime, {
			registry: runtime.engineLuaSources,
			storage: runtime.storageService,
			includeServer: true,
			projectRootPath: runtime.engineProjectRootPath,
		});
		const preserveEngineModules =
				runtime.activeProgramSource !== 'engine'
			&& engineChanged.size === 0
			&& !hasPendingEngineModuleReload(runtime);
		console.log('[IDE] Capturing runtime snapshot for resume');
		const snapshot = captureRuntimeResumeSnapshot(runtime);
		console.log('[IDE] Clear execution stop highlights before resume');
		workbenchMode.clearFaultState(runtime);
		console.log('[IDE] Resuming from snapshot after hot-resume');
		await luaPipeline.resumeFromSnapshot(runtime, snapshot, preserveEngineModules);
		if (shouldUpdateGeneration) {
			console.log('[IDE] Updating applied generation after resume');
			editorDocumentState.appliedGeneration = targetGeneration;
		}
		engineCore.paused = false;
	}, (error) => {
		console.error(error);
		runtime.editor.handleRuntimeTaskError(error, 'Failed to resume game');
	});
	return true;
}

export function performReboot(runtime: Runtime): boolean {
	const targetGeneration = editorDocumentState.saveGeneration;
	clearExecutionStopHighlights();
	workbenchMode.deactivateEditor(runtime);
	scheduleRuntimeTask(async () => {
		console.info('[IDE] Performing cold reboot through bootrom');
		await runtime.rebootToBootRom();
		editorDocumentState.appliedGeneration = targetGeneration;
		engineCore.paused = false;
	}, (error) => {
		runtime.editor.handleRuntimeTaskError(error, 'Failed to reboot game');
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
