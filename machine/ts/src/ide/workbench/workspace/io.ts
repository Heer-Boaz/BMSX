import { consoleCore } from '../../../core/console';
import type { StorageService, TimerHandle } from '../../../platform/platform';
import { scheduleIdeOnce } from '../../common/background_tasks';
import {
	WORKSPACE_FILE_ENDPOINT,
	WORKSPACE_MARKER_FILE,
	WORKSPACE_METADATA_DIR,
	WORKSPACE_DIRTY_DIR,
	WORKSPACE_STATE_FILE,
	buildWorkspaceDirtyEntryPath,
	buildWorkspaceStorageKey,
	joinWorkspacePaths,
} from '../../workspace/files';
import { workspaceState } from './state';
import type { WorkspaceStoragePaths } from './models';

let storagePaths: WorkspaceStoragePaths = null;
let serverBackend: ServerWorkspaceBackend = null;
let serverBackendAvailable = false;
let serverBackendFailureNotified = false;
let localBackend: LocalWorkspaceBackend = null;
let serverRetryScheduled = false;
let serverRetryHandle: TimerHandle = null;
// disable-next-line legacy_sentinel_string_pattern -- removes the obsolete local-only readiness marker from older workspace storage.
const LEGACY_LOCAL_WORKSPACE_MARKER = '__marker__';

function resetWorkspaceBackends(): void {
	serverBackend = null;
	localBackend = null;
	serverBackendAvailable = false;
	serverBackendFailureNotified = false;
	serverRetryScheduled = false;
	serverRetryHandle?.cancel();
	serverRetryHandle = null;
	workspaceState.serverConnected = false;
}

function handleServerBackendFailure(error: unknown): void {
	if (!serverBackendAvailable) {
		return;
	}
	serverBackendAvailable = false;
	serverBackend = null;
	serverRetryHandle?.cancel();
	serverRetryHandle = null;
	serverRetryScheduled = false;
	workspaceState.serverConnected = false;
	if (!serverBackendFailureNotified) {
		serverBackendFailureNotified = true;
		console.warn('[WorkspaceStorage] Remote workspace became unavailable; persisting locally only.', error);
	}
}

class LocalWorkspaceBackend {
	constructor(private readonly projectRootPath: string, private readonly storage: StorageService) { }

	async ensureReady(): Promise<void> {
		const markerPath = joinWorkspacePaths(this.projectRootPath, WORKSPACE_METADATA_DIR, WORKSPACE_MARKER_FILE);
		this.storage.removeItem(buildWorkspaceStorageKey(this.projectRootPath, LEGACY_LOCAL_WORKSPACE_MARKER));
		this.storage.setItem(buildWorkspaceStorageKey(this.projectRootPath, markerPath), '');
	}

	async readFile(relativePath: string): Promise<string> {
		return this.storage.getItem(buildWorkspaceStorageKey(this.projectRootPath, relativePath));
	}

	async writeFile(relativePath: string, contents: string): Promise<void> {
		this.storage.setItem(buildWorkspaceStorageKey(this.projectRootPath, relativePath), contents);
	}

	async deleteFile(relativePath: string): Promise<void> {
		this.storage.removeItem(buildWorkspaceStorageKey(this.projectRootPath, relativePath));
	}
}

class ServerWorkspaceBackend {
	constructor(private readonly projectRootPath: string) { }

	async ensureReady(): Promise<void> {
		const markerPath = joinWorkspacePaths(this.projectRootPath, WORKSPACE_METADATA_DIR, WORKSPACE_MARKER_FILE);
		await this.writeFile(markerPath, '');
	}

	async readFile(relativePath: string): Promise<string> {
		const response = await fetch(`${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(relativePath)}`, {
			method: 'GET',
			cache: 'no-store',
		});
		if (response.status === 404) {
			return null;
		}
		if (!response.ok) {
			const detail = await response.text();
			throw new Error(`[WorkspaceStorage] Failed to read file '${relativePath}': ${detail}`);
		}
		const payload = await response.json();
		if (!payload || typeof payload.contents !== 'string') {
			throw new Error(`[WorkspaceStorage] Invalid payload while reading '${relativePath}'.`);
		}
		return payload.contents;
	}

	async writeFile(relativePath: string, contents: string): Promise<void> {
		const response = await fetch(WORKSPACE_FILE_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: relativePath, contents }),
		});
		if (!response.ok) {
			const detail = await response.text();
			throw new Error(`[WorkspaceStorage] Failed to write file '${relativePath}': ${detail}`);
		}
	}

	async deleteFile(relativePath: string): Promise<void> {
		const response = await fetch(`${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(relativePath)}`, {
			method: 'DELETE',
		});
		if (!response.ok && response.status !== 404) {
			const detail = await response.text();
			throw new Error(`[WorkspaceStorage] Failed to delete file '${relativePath}': ${detail}`);
		}
	}
}

export async function readWorkspaceFile(relativePath: string): Promise<string> {
	if (serverBackendAvailable && serverBackend) {
		try {
			const result = await serverBackend.readFile(relativePath);
			if (result !== null) {
				if (localBackend) {
					await localBackend.writeFile(relativePath, result);
				}
				return result;
			}
		} catch (error) {
			handleServerBackendFailure(error);
		}
	}
	if (!localBackend) {
		return null;
	}
	return await localBackend.readFile(relativePath);
}

export async function writeWorkspaceFile(relativePath: string, contents: string): Promise<void> {
	if (localBackend) {
		await localBackend.writeFile(relativePath, contents);
	}
	if (serverBackendAvailable && serverBackend) {
		try {
			await serverBackend.writeFile(relativePath, contents);
		} catch (error) {
			handleServerBackendFailure(error);
		}
	}
}

export async function deleteWorkspaceFile(relativePath: string): Promise<void> {
	if (localBackend) {
		await localBackend.deleteFile(relativePath);
	}
	if (serverBackendAvailable && serverBackend) {
		try {
			await serverBackend.deleteFile(relativePath);
		} catch (error) {
			handleServerBackendFailure(error);
		}
	}
}

export function clearWorkspaceStorageConfiguration(): void {
	storagePaths = null;
	resetWorkspaceBackends();
}

export async function configureWorkspaceStorage(projectRootPath: string): Promise<void> {
	if (!projectRootPath) {
		clearWorkspaceStorageConfiguration();
		return;
	}
	resetWorkspaceBackends();
	const metadataDir = joinWorkspacePaths(projectRootPath, WORKSPACE_METADATA_DIR);
	const dirtyDir = joinWorkspacePaths(projectRootPath, WORKSPACE_METADATA_DIR, WORKSPACE_DIRTY_DIR);
	const stateFile = joinWorkspacePaths(projectRootPath, WORKSPACE_METADATA_DIR, WORKSPACE_STATE_FILE);
	storagePaths = {
		projectRootPath,
		metadataDir,
		dirtyDir,
		stateFile,
	};
	const storage = consoleCore.platform.storage;
	if (storage) {
		try {
			const backend = new LocalWorkspaceBackend(projectRootPath, storage);
			await backend.ensureReady();
			localBackend = backend;
		} catch {
			localBackend = null;
		}
	}
	try {
		const backend = new ServerWorkspaceBackend(projectRootPath);
		await backend.ensureReady();
		serverBackend = backend;
		serverBackendAvailable = true;
	} catch (error) {
		serverBackend = null;
		serverBackendAvailable = false;
		serverBackendFailureNotified = true;
		workspaceState.serverConnected = false;
		console.warn('[WorkspaceStorage] Remote workspace unavailable; persisting locally only.', error);
	}
}

export function buildDirtyFilePath(resourcePath: string): string {
	if (!storagePaths) {
		throw new Error('[WorkspaceStorage] Workspace storage not configured.');
	}
	return buildWorkspaceDirtyEntryPath(storagePaths.projectRootPath, resourcePath);
}

export function hasWorkspaceStorage(): boolean {
	return storagePaths !== null;
}

export function isWorkspaceServerAvailable(): boolean {
	return serverBackendAvailable;
}

export function getWorkspaceDirtyDirSegment(): string {
	return WORKSPACE_DIRTY_DIR;
}

export async function readWorkspaceStateFile(): Promise<string> {
	if (!storagePaths) {
		return null;
	}
	return await readWorkspaceFile(storagePaths.stateFile);
}

export async function writeWorkspaceStateFile(contents: string): Promise<void> {
	if (!storagePaths) {
		return;
	}
	await writeWorkspaceFile(storagePaths.stateFile, contents);
}

export function scheduleWorkspaceServerRetry(delayMs: number): void {
	if (serverBackendAvailable || serverRetryScheduled || !storagePaths) {
		return;
	}
	serverRetryScheduled = true;
	serverRetryHandle = scheduleIdeOnce(delayMs, async () => {
		serverRetryScheduled = false;
		serverRetryHandle = null;
		await tryReconnectServerBackend();
	});
}

async function tryReconnectServerBackend(): Promise<void> {
	if (serverBackendAvailable || !storagePaths) {
		return;
	}
	try {
		const backend = new ServerWorkspaceBackend(storagePaths.projectRootPath);
		await backend.ensureReady();
		serverBackend = backend;
		serverBackendAvailable = true;
		serverBackendFailureNotified = false;
		workspaceState.serverConnected = true;
	} catch (error) {
		handleServerBackendFailure(error);
	}
}
