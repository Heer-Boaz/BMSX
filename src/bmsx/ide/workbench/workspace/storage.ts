import { consoleCore } from '../../../core/console';
import { scheduleIdeOnce } from '../../common/background_tasks';
import { taskGate } from '../../../core/taskgate';
import type { Runtime } from '../../../machine/runtime/runtime';
import { clearWorkspaceCachedSources } from '../../workspace/cache';
import { workspaceState } from './state';
import { clearWorkspaceStorageConfiguration, configureWorkspaceStorage, isWorkspaceServerAvailable, scheduleWorkspaceServerRetry, writeWorkspaceStateFile } from './io';
import { restoreWorkspaceSessionFromDisk } from './restore';
import { buildWorkspaceAutosavePayload, buildWorkspaceAutosaveSignature, clearWorkspaceSessionStateData, collectDirtyContextEntries, persistDirtyContextEntries } from './autosave';

const WORKSPACE_AUTOSAVE_INTERVAL_MS = 2500;
const workspaceRestoreGate = taskGate.group('restore');

function detachWorkspaceExitHandler(): void {
	if (workspaceState.disposeExitListener) {
		try {
			workspaceState.disposeExitListener.unsubscribe();
		} catch {
		}
		workspaceState.disposeExitListener = null;
	}
}

function attachWorkspaceExitHandler(runtime: Runtime): void {
	detachWorkspaceExitHandler();
	workspaceState.disposeExitListener = consoleCore.platform.lifecycle.onWillExit(() => {
		if (!workspaceState.autosaveEnabled) {
			return;
		}
		void runWorkspaceAutosaveTick(runtime);
	});
}

function disableWorkspacePersistence(): void {
	workspaceState.autosaveEnabled = false;
	clearWorkspaceStorageConfiguration();
	detachWorkspaceExitHandler();
}

export function initializeWorkspaceStorage(runtime: Runtime, projectRootPath: string | null): void {
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
	attachWorkspaceExitHandler(runtime);
	const token = workspaceRestoreGate.begin({ blocking: true, tag: 'restore' });
	(async () => {
		try {
			await configureWorkspaceStorage(projectRootPath);
			const signature = await restoreWorkspaceSessionFromDisk(runtime);
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
			scheduleWorkspaceAutosaveLoop(runtime);
		}
		if (workspaceState.autosaveQueued) {
			workspaceState.autosaveQueued = false;
			void runWorkspaceAutosaveTick(runtime);
		}
	})().catch((error) => {
		console.warn('[CartEditor] Workspace restore failed:', error);
	});
}

export function scheduleWorkspaceAutosaveLoop(runtime: Runtime): void {
	if (!workspaceState.autosaveEnabled || workspaceState.autosaveHandle) {
		return;
	}
	workspaceState.autosaveHandle = scheduleIdeOnce(WORKSPACE_AUTOSAVE_INTERVAL_MS, () => {
		workspaceState.autosaveHandle = null;
		void runWorkspaceAutosaveTick(runtime);
		scheduleWorkspaceAutosaveLoop(runtime);
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

export async function runWorkspaceAutosaveTick(runtime: Runtime): Promise<void> {
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
		const payload = buildWorkspaceAutosavePayload(runtime, dirtyEntries);
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
			await runWorkspaceAutosaveTick(runtime);
		}
	}
}

export function clearWorkspaceSessionState(): void {
	stopWorkspaceAutosaveLoop();
	clearWorkspaceSessionStateData();
}
