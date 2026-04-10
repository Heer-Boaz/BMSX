import { $ } from '../../../core/engine_core';
import { ide_state } from '../../core/ide_state';
import { scheduleRuntimeTask } from '../../core/background_tasks';
import { applyWorkspaceOverridesToCart, applyWorkspaceOverridesToRegistry, DEFAULT_ENGINE_PROJECT_ROOT_PATH } from '../../../emulator/workspace';
import { Runtime } from '../../../emulator/runtime';
import * as runtimeLuaPipeline from '../../../emulator/runtime_lua_pipeline';
import * as runtimeIde from '../../../emulator/runtime_ide';
import type { PendingActionPrompt } from '../../core/types';
import { handleRuntimeTaskError } from '../../ui/editor_runtime';
import { clearExecutionStopHighlights } from '../../contrib/runtime_error/runtime_error_navigation';
import * as constants from '../../core/constants';
import { setEditorCaseInsensitivity } from '../../render/text_renderer';

export function performEditorAction(action: PendingActionPrompt['action']): boolean {
	switch (action) {
		case 'hot-resume':
			return performHotResume();
		case 'reboot':
			return performReboot();
		case 'close':
			runtimeIde.deactivateEditor(Runtime.instance);
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
	for (const context of ide_state.codeTabContexts.values()) {
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
	const targetGeneration = ide_state.saveGeneration;
	const shouldUpdateGeneration = hasPendingRuntimeReload();
	clearExecutionStopHighlights();
	runtimeIde.deactivateEditor(Runtime.instance);
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
			!runtime.isEngineProgramActive()
			&& engineChanged.size === 0
			&& !hasPendingEngineModuleReload(runtime);
		console.log('[IDE] Capturing runtime snapshot for resume');
		const snapshot = runtimeLuaPipeline.captureCurrentState(runtime);
		console.log('[IDE] Clear execution stop highlights before resume');
		runtimeIde.clearFaultState(runtime);
		console.log('[IDE] Resuming from snapshot after hot-resume');
		await runtimeLuaPipeline.resumeFromSnapshot(runtime, snapshot, { preserveEngineModules });
		if (shouldUpdateGeneration) {
			console.log('[IDE] Updating applied generation after resume');
			ide_state.appliedGeneration = targetGeneration;
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
	const targetGeneration = ide_state.saveGeneration;
	clearExecutionStopHighlights();
	runtimeIde.deactivateEditor(Runtime.instance);
	scheduleRuntimeTask(async () => {
		console.info('[IDE] Performing cold reboot through bootrom');
		await runtime.rebootToBootRom();
		ide_state.appliedGeneration = targetGeneration;
		$.paused = false;
	}, (error) => {
		handleRuntimeTaskError(error, 'Failed to reboot game');
	});
	return true;
}

export function hasPendingRuntimeReload(): boolean {
	return ide_state.saveGeneration > ide_state.appliedGeneration;
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
	ide_state.themeVariant = constants.getActiveIdeThemeVariant();
	setEditorCaseInsensitivity(ide_state.caseInsensitive);
	ide_state.layout.invalidateAllHighlights();
}
