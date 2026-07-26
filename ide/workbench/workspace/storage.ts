import { machineManager } from '../../../machine/ts/core/machine_manager';
import { scheduleIdeOnce } from '../../common/background_tasks';
import { taskGate } from '../../../machine/ts/common/taskgate';
import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { clearWorkspaceSourceCaches } from '../../workspace/cache';
import { workspaceState } from './state';
import { clearWorkspaceStorageConfiguration, configureWorkspaceStorage, isWorkspaceServerAvailable, scheduleWorkspaceServerRetry, writeWorkspaceStateFile } from './io';
import { restoreWorkspaceSessionFromDisk } from './restore';
import { buildWorkspaceAutosavePayload, buildWorkspaceAutosaveSignature, clearWorkspaceSessionStateData, collectDirtyContextEntries, persistDirtyContextEntries } from './autosave';
import type { CartEditor } from '../../cart_editor';
import type { RuntimeSourceState } from '../../runtime/sources';
import type { RuntimeDebuggerState } from '../../runtime/debugger_state';
import type { OverlayRenderer } from '../../runtime/overlay_renderer';

const WORKSPACE_AUTOSAVE_INTERVAL_MS = 2500;
const workspaceRestoreGate = taskGate.group('restore');

function detachWorkspaceExitHandler(): void {
	if (workspaceState.disposeExitListener) {
		workspaceState.disposeExitListener.unsubscribe();
		workspaceState.disposeExitListener = null;
	}
}

function attachWorkspaceExitHandler(
	editor: CartEditor,
	sources: RuntimeSourceState,
	debuggerState: RuntimeDebuggerState,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
): void {
	detachWorkspaceExitHandler();
	workspaceState.disposeExitListener = machineManager.platform.lifecycle.onWillExit(() => {
		if (!workspaceState.autosaveEnabled) {
			return;
		}
		void runWorkspaceAutosaveTick(editor, sources, debuggerState, overlayRenderer, runtime);
	});
}

function disableWorkspacePersistence(): void {
	workspaceState.autosaveEnabled = false;
	clearWorkspaceStorageConfiguration();
	detachWorkspaceExitHandler();
}

export function initializeWorkspaceStorage(
	editor: CartEditor,
	sources: RuntimeSourceState,
	debuggerState: RuntimeDebuggerState,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	projectRootPath: string | null,
): void {
	stopWorkspaceAutosaveLoop();
	workspaceState.autosaveSignature = null;
	clearWorkspaceSourceCaches();
	if (!projectRootPath || projectRootPath.length === 0) {
		workspaceState.autosaveEnabled = false;
		clearWorkspaceStorageConfiguration();
		detachWorkspaceExitHandler();
		workspaceState.serverConnected = false;
		return;
	}
	workspaceState.autosaveEnabled = true;
	attachWorkspaceExitHandler(editor, sources, debuggerState, overlayRenderer, runtime);
	const token = workspaceRestoreGate.begin({ blocking: true, tag: 'restore' });
	(async () => {
		try {
			await configureWorkspaceStorage(projectRootPath);
			const signature = await restoreWorkspaceSessionFromDisk(
				editor,
				sources,
				debuggerState,
				overlayRenderer,
				projectRootPath,
			);
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
			scheduleWorkspaceAutosaveLoop(editor, sources, debuggerState, overlayRenderer, runtime);
		}
		if (workspaceState.autosaveQueued) {
			workspaceState.autosaveQueued = false;
			void runWorkspaceAutosaveTick(editor, sources, debuggerState, overlayRenderer, runtime);
		}
	})().catch((error) => {
		console.warn('[CartEditor] Workspace restore failed:', error);
	});
}

export function scheduleWorkspaceAutosaveLoop(
	editor: CartEditor,
	sources: RuntimeSourceState,
	debuggerState: RuntimeDebuggerState,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
): void {
	if (!workspaceState.autosaveEnabled || workspaceState.autosaveHandle) {
		return;
	}
	workspaceState.autosaveHandle = scheduleIdeOnce(WORKSPACE_AUTOSAVE_INTERVAL_MS, () => {
		workspaceState.autosaveHandle = null;
		void runWorkspaceAutosaveTick(editor, sources, debuggerState, overlayRenderer, runtime);
		scheduleWorkspaceAutosaveLoop(editor, sources, debuggerState, overlayRenderer, runtime);
	});
}

export function stopWorkspaceAutosaveLoop(): void {
	if (!workspaceState.autosaveHandle) {
		return;
	}
	workspaceState.autosaveHandle.cancel();
	workspaceState.autosaveHandle = null;
}

export async function runWorkspaceAutosaveTick(
	editor: CartEditor,
	sources: RuntimeSourceState,
	debuggerState: RuntimeDebuggerState,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
): Promise<void> {
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
		const payload = buildWorkspaceAutosavePayload(editor, debuggerState, overlayRenderer, dirtyEntries);
		await persistDirtyContextEntries(dirtyEntries);
		if (payload) {
			const signature = buildWorkspaceAutosaveSignature(payload);
			if (signature !== workspaceState.autosaveSignature) {
				await writeWorkspaceStateFile(JSON.stringify(payload));
				workspaceState.autosaveSignature = signature;
			}
		}
	} catch (error) {
		console.warn('[CartEditor] Workspace autosave failed:', error);
	} finally {
		workspaceState.autosaveRunning = false;
		if (workspaceState.autosaveQueued) {
			workspaceState.autosaveQueued = false;
			await runWorkspaceAutosaveTick(editor, sources, debuggerState, overlayRenderer, runtime);
		}
	}
}

export function clearWorkspaceSessionState(debuggerState: RuntimeDebuggerState): void {
	stopWorkspaceAutosaveLoop();
	clearWorkspaceSessionStateData(debuggerState);
}
