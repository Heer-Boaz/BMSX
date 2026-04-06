import { $ } from '../../core/engine_core';
import { ide_state } from './ide_state';
import { toggleThemeMode } from './ide_input';
import { scheduleRuntimeTask } from './background_tasks';
import { applyWorkspaceOverridesToCart } from '../workspace';
import { Runtime } from '../runtime';
import * as runtimeLuaPipeline from '../runtime_lua_pipeline';
import * as runtimeIde from '../runtime_ide';
import type { PendingActionPrompt } from './types';
import { save } from './editor_tabs';
import { handleRuntimeTaskError } from './editor_runtime';
import { clearExecutionStopHighlights } from './runtime_error_navigation';

export async function handleActionPromptSelection(choice: 'save-continue' | 'continue' | 'cancel'): Promise<void> {
	if (!ide_state.pendingActionPrompt) {
		return;
	}
	if (choice === 'cancel') {
		resetActionPromptState();
		return;
	}
	if (choice === 'save-continue') {
		const saved = await attemptPromptSave(ide_state.pendingActionPrompt.action);
		if (!saved) {
			return;
		}
	}
	if (performAction(ide_state.pendingActionPrompt.action)) {
		resetActionPromptState();
	}
}

export async function attemptPromptSave(action: PendingActionPrompt['action']): Promise<boolean> {
	if (action === 'close') {
		await save();
		return ide_state.dirty === false;
	}
	await save();
	return ide_state.dirty === false;
}

export function performAction(action: PendingActionPrompt['action']): boolean {
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

export function resetActionPromptState(): void {
	ide_state.pendingActionPrompt = null;
	ide_state.actionPromptButtons.saveAndContinue = null;
	ide_state.actionPromptButtons.continue = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.actionPromptButtons.cancel = { left: 0, top: 0, right: 0, bottom: 0 };
}

export function hasPendingRuntimeReload(): boolean {
	return ide_state.saveGeneration > ide_state.appliedGeneration;
}
