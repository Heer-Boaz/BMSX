import { $ } from '../../../../core/engine_core';
import { ide_state } from '../../ide_state';
import { scheduleRuntimeTask } from '../../background_tasks';
import { applyWorkspaceOverridesToCart } from '../../../workspace';
import { Runtime } from '../../../runtime';
import * as runtimeLuaPipeline from '../../../runtime_lua_pipeline';
import * as runtimeIde from '../../../runtime_ide';
import type { PendingActionPrompt } from '../../types';
import { handleRuntimeTaskError } from '../../editor_runtime';
import { clearExecutionStopHighlights } from '../../contrib/runtime_error/runtime_error_navigation';
import * as constants from '../../constants';
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

export function performHotResume(): boolean {
	const runtime = Runtime.instance;
	const targetGeneration = ide_state.saveGeneration;
	const shouldUpdateGeneration = hasPendingRuntimeReload();
	clearExecutionStopHighlights();
	runtimeIde.deactivateEditor(Runtime.instance);
	console.log('[IDE] Performing hot-resume');
	scheduleRuntimeTask(async () => {
		console.log('[IDE] Applying workspace overrides to cart before resume');
		await applyWorkspaceOverridesToCart({ cart: runtime.cartLuaSources ? runtime.cartLuaSources : $.lua_sources, storage: $.platform.storage, includeServer: true });
		console.log('[IDE] Capturing runtime snapshot for resume');
		const snapshot = runtimeLuaPipeline.captureCurrentState(runtime);
		console.log('[IDE] Clear execution stop highlights before resume');
		runtimeIde.clearFaultState(runtime);
		console.log('[IDE] Resuming from snapshot after hot-resume');
		await runtimeLuaPipeline.resumeFromSnapshot(runtime, snapshot);
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
