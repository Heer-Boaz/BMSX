import { $ } from '../../../core/engine_core';
import { scheduleIdeOnce } from '../../common/background_tasks';
import { taskGate } from '../../../core/taskgate';
import { clearWorkspaceCachedSources } from '../../workspace/workspace_cache';
import { workspaceState } from './workspace_state';
import { clearWorkspaceStorageConfiguration, configureWorkspaceStorage, isWorkspaceServerAvailable, scheduleWorkspaceServerRetry, writeWorkspaceStateFile } from './workspace_io';
import { restoreWorkspaceSessionFromDisk } from './workspace_restore';
import { buildWorkspaceAutosavePayload, buildWorkspaceAutosaveSignature, clearWorkspaceSessionStateData, collectDirtyContextEntries, persistDirtyContextEntries } from './workspace_autosave';

const WORKSPACE_AUTOSAVE_INTERVAL_MS = 2500;
const workspaceRestoreGate = taskGate.group('workspace_restore');

function detachWorkspaceExitHandler(): void {
	if (workspaceState.disposeExitListener) {
		try {
			workspaceState.disposeExitListener.unsubscribe();
		} catch {
		}
		workspaceState.disposeExitListener = null;
	}
}

function attachWorkspaceExitHandler(): void {
	detachWorkspaceExitHandler();
	workspaceState.disposeExitListener = $.platform.lifecycle.onWillExit(() => {
		if (!workspaceState.autosaveEnabled) {
			return;
		}
		void runWorkspaceAutosaveTick();
	});
}

function disableWorkspacePersistence(): void {
	workspaceState.autosaveEnabled = false;
	clearWorkspaceStorageConfiguration();
	detachWorkspaceExitHandler();
}

export function initializeWorkspaceStorage(projectRootPath: string): void {
	stopWorkspaceAutosaveLoop();
	workspaceState.autosaveSignature = null;
	clearWorkspaceCachedSources();
	if (!projectRootPath || projectRootPath.length === 0) {
		workspaceState.autosaveEnabled = false;
		clearWorkspaceStorageConfiguration();
		detachWorkspaceExitHandler();
		workspaceState.serverConnected = false;
		return;
	}
	workspaceState.autosaveEnabled = true;
	attachWorkspaceExitHandler();
	const token = workspaceRestoreGate.begin({ blocking: true, tag: 'workspace_restore' });
	(async () => {
		try {
			await configureWorkspaceStorage(projectRootPath);
			const signature = await restoreWorkspaceSessionFromDisk();
			workspaceState.autosaveSignature = signature;
			workspaceState.serverConnected = isWorkspaceServerAvailable();
		} catch (error) {
			console.warn('[CartEditor] Workspace persistence disabled:', error);
			disableWorkspacePersistence();
			return;
		} finally {
			workspaceRestoreGate.end(token);
		}
		if (workspaceState.autosaveEnabled) {
			scheduleWorkspaceAutosaveLoop();
		}
		if (workspaceState.autosaveQueued) {
			workspaceState.autosaveQueued = false;
			void runWorkspaceAutosaveTick();
		}
	})().catch((error) => {
		console.warn('[CartEditor] Workspace restore failed:', error);
	});
}

export function scheduleWorkspaceAutosaveLoop(): void {
	if (!workspaceState.autosaveEnabled || workspaceState.autosaveHandle) {
		return;
	}
	workspaceState.autosaveHandle = scheduleIdeOnce(WORKSPACE_AUTOSAVE_INTERVAL_MS, () => {
		workspaceState.autosaveHandle = null;
		void runWorkspaceAutosaveTick();
		scheduleWorkspaceAutosaveLoop();
	});
}

export function stopWorkspaceAutosaveLoop(): void {
	if (!workspaceState.autosaveHandle) {
		return;
	}
	try {
		workspaceState.autosaveHandle.cancel();
	} catch {
	}
	workspaceState.autosaveHandle = null;
}

export async function runWorkspaceAutosaveTick(): Promise<void> {
	if (!workspaceState.autosaveEnabled) {
		return;
	}
	if (!isWorkspaceServerAvailable()) {
		scheduleWorkspaceServerRetry(WORKSPACE_AUTOSAVE_INTERVAL_MS * 4);
	}
	if (!workspaceRestoreGate.ready) {
		workspaceState.autosaveQueued = true;
		return;
	}
	if (workspaceState.autosaveRunning) {
		workspaceState.autosaveQueued = true;
		return;
	}
	workspaceState.autosaveRunning = true;
	try {
		const dirtyEntries = collectDirtyContextEntries();
		const payload = buildWorkspaceAutosavePayload(dirtyEntries);
		if (payload) {
			const signature = buildWorkspaceAutosaveSignature(payload);
			if (signature !== workspaceState.autosaveSignature) {
				await writeWorkspaceStateFile(JSON.stringify(payload));
				workspaceState.autosaveSignature = signature;
			}
		}
		await persistDirtyContextEntries(dirtyEntries);
	} catch (error) {
		console.warn('[CartEditor] Workspace autosave failed:', error);
	} finally {
		workspaceState.autosaveRunning = false;
		if (workspaceState.autosaveQueued) {
			workspaceState.autosaveQueued = false;
			await runWorkspaceAutosaveTick();
		}
	}
}

export function clearWorkspaceSessionState(): void {
	stopWorkspaceAutosaveLoop();
	clearWorkspaceSessionStateData();
}
