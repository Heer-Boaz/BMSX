import { $ } from '../../../core/engine_core';
import type { StorageService, TimerHandle } from '../../../platform/platform';
import { scheduleIdeOnce } from '../../common/background_tasks';
import {
	WORKSPACE_FILE_ENDPOINT,
	WORKSPACE_MARKER_FILE,
	WORKSPACE_DIRTY_DIR,
	buildWorkspaceDirtyDir,
	buildWorkspaceDirtyEntryPath,
	buildWorkspaceMetadataPath,
	buildWorkspaceStateFilePath,
	buildWorkspaceStorageKey,
	joinWorkspacePaths,
} from '../../workspace/workspace';
import { workspaceState } from './workspace_state';
import type { WorkspaceStoragePaths } from './workspace_types';

let storagePaths: WorkspaceStoragePaths = null;
let serverBackend: ServerWorkspaceBackend = null;
let serverBackendAvailable = false;
let serverBackendFailureNotified = false;
let localBackend: LocalWorkspaceBackend = null;
let serverRetryScheduled = false;
let serverRetryHandle: TimerHandle = null;

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

async function fetchOrThrow(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	if (typeof fetch !== 'function') {
		throw new Error('[WorkspaceStorage] Fetch API is not available in this environment.');
	}
	return await fetch(input, init);
}

async function safeReadText(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return `${response.status} ${response.statusText}`;
	}
}

class LocalWorkspaceBackend {
	constructor(private readonly projectRootPath: string, private readonly storage: StorageService) { }

	private makeKey(relativePath: string): string {
		return buildWorkspaceStorageKey(this.projectRootPath, relativePath);
	}

	async ensureReady(): Promise<void> {
		this.storage.setItem(this.makeKey('__marker__'), 'ready');
	}

	async readFile(relativePath: string): Promise<string> {
		return this.storage.getItem(this.makeKey(relativePath));
	}

	async writeFile(relativePath: string, contents: string): Promise<void> {
		this.storage.setItem(this.makeKey(relativePath), contents);
	}

	async deleteFile(relativePath: string): Promise<void> {
		this.storage.removeItem(this.makeKey(relativePath));
	}
}

class ServerWorkspaceBackend {
	constructor(private readonly projectRootPath: string) { }

	async ensureReady(): Promise<void> {
		const metadataDir = buildWorkspaceMetadataPath(this.projectRootPath);
		const markerPath = joinWorkspacePaths(metadataDir, WORKSPACE_MARKER_FILE);
		await this.writeFile(markerPath, '');
	}

	async readFile(relativePath: string): Promise<string> {
		const response = await fetchOrThrow(`${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(relativePath)}`, {
			method: 'GET',
			cache: 'no-store',
		});
		if (response.status === 404) {
			return null;
		}
		if (!response.ok) {
			const detail = await safeReadText(response);
			throw new Error(`[WorkspaceStorage] Failed to read file '${relativePath}': ${detail}`);
		}
		const payload = await response.json();
		if (!payload || typeof payload.contents !== 'string') {
			throw new Error(`[WorkspaceStorage] Invalid payload while reading '${relativePath}'.`);
		}
		return payload.contents;
	}

	async writeFile(relativePath: string, contents: string): Promise<void> {
		const response = await fetchOrThrow(WORKSPACE_FILE_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: relativePath, contents }),
		});
		if (!response.ok) {
			const detail = await safeReadText(response);
			throw new Error(`[WorkspaceStorage] Failed to write file '${relativePath}': ${detail}`);
		}
	}

	async deleteFile(relativePath: string): Promise<void> {
		const response = await fetchOrThrow(`${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(relativePath)}`, {
			method: 'DELETE',
		});
		if (!response.ok && response.status !== 404) {
			const detail = await safeReadText(response);
			throw new Error(`[WorkspaceStorage] Failed to delete file '${relativePath}': ${detail}`);
		}
	}
}

async function readWorkspaceFile(relativePath: string): Promise<string> {
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

async function writeWorkspaceFile(relativePath: string, contents: string): Promise<void> {
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

async function deleteWorkspaceFile(relativePath: string): Promise<void> {
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
	const metadataDir = buildWorkspaceMetadataPath(projectRootPath);
	const dirtyDir = buildWorkspaceDirtyDir(projectRootPath);
	const stateFile = buildWorkspaceStateFilePath(projectRootPath);
	storagePaths = {
		projectRootPath,
		metadataDir,
		dirtyDir,
		stateFile,
	};
	const storage = $.platform.storage;
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

export async function readDirtyBuffer(relativePath: string): Promise<string> {
	return await readWorkspaceFile(relativePath);
}

export async function writeDirtyBuffer(relativePath: string, contents: string): Promise<void> {
	await writeWorkspaceFile(relativePath, contents);
}

export async function deleteDirtyBuffer(relativePath: string): Promise<void> {
	await deleteWorkspaceFile(relativePath);
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
	} catch {
	}
}
