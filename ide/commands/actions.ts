import { runtimeWorkbenchState } from '../runtime/workbench_state';
import { machineManager } from '../../machine/ts/core/machine_manager';
import { editorRuntimeState } from '../editor/common/runtime_state';
import { scheduleRuntimeTask } from '../common/background_tasks';
import { applyLuaCodeTabSources, applyWorkspaceOverridesToRegistry } from '../workspace/workspace';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { hotResume } from '../runtime/hot_resume';
import { deactivateEditor } from '../workbench/overlay_modes';
import { handleLuaError } from '../workbench/runtime_errors';
import type { ActionPromptAction } from '../common/models';
import { clearExecutionStopHighlights } from '../runtime_error/navigation';
import * as constants from '../common/constants';
import { setEditorCaseInsensitivity } from '../editor/render/text_renderer';
import { editorViewState } from '../editor/ui/view/state';
import { capturePendingLuaCodeTabSources, markLuaCodeTabsAppliedToRuntime } from '../workbench/ui/code_tab/activation';

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
	clearExecutionStopHighlights();
	deactivateEditor();
	console.log('Performing hot resume.');
	const pendingSources = capturePendingLuaCodeTabSources();
	scheduleRuntimeTask(async () => {
		const sources = runtimeWorkbenchState.sources;
		for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
			const cartridge = sources.cartridgeSlots[slot];
			if (cartridge === null) {
				continue;
			}
			await applyWorkspaceOverridesToRegistry({
				registry: cartridge.luaSources,
				storage: machineManager.platform.storage,
				includeServer: true,
				projectRootPath: cartridge.projectRootPath,
			});
		}
		await applyWorkspaceOverridesToRegistry({
			registry: sources.systemLuaSources,
			storage: machineManager.platform.storage,
			includeServer: true,
			projectRootPath: sources.systemProjectRootPath,
		});
		applyLuaCodeTabSources(pendingSources);
		hotResume(runtime, sources.systemBlua32MediaDirty, sources.cartridgeBlua32MediaDirty);
		markLuaCodeTabsAppliedToRuntime(pendingSources);
	}, (error) => {
		console.error(error);
		handleLuaError(runtime, error);
		runtimeWorkbenchState.ide.editor.handleRuntimeTaskError(error, 'Failed to resume game');
	});
	return true;
}

export function performReboot(): boolean {
	clearExecutionStopHighlights();
	deactivateEditor();
	const pendingSources = capturePendingLuaCodeTabSources();
	scheduleRuntimeTask(async () => {
		console.info('[IDE] Performing cold reboot through bootrom');
		applyLuaCodeTabSources(pendingSources);
		await machineManager.rebootToBootRom();
		markLuaCodeTabsAppliedToRuntime(pendingSources);
	}, (error) => {
		runtimeWorkbenchState.ide.editor.handleRuntimeTaskError(error, 'Failed to reboot game');
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
