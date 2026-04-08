import { $ } from '../../core/engine_core';
import type { ResourceDescriptor } from './types';
import { ide_state, WORKSPACE_AUTOSAVE_INTERVAL_MS } from './ide_state';
import type { CodeTabContext, Position, EditorSnapshot } from './types';
import { clamp_safe } from '../../utils/clamp';
import type { StorageService, TimerHandle } from '../../platform/platform';
import { restoreBreakpointsFromPayload, serializeBreakpoints, type SerializedBreakpointMap } from '../contrib/debugger/ide_debugger';
import { scheduleIdeOnce } from './background_tasks';
import { taskGate } from '../../core/taskgate';
import { Runtime } from '../../emulator/runtime';
import * as runtimeLuaPipeline from '../../emulator/runtime_lua_pipeline';
import * as runtimeIde from '../../emulator/runtime_ide';
import {
	WORKSPACE_FILE_ENDPOINT,
	WORKSPACE_MARKER_FILE,
	buildWorkspaceDirtyDir,
	buildWorkspaceDirtyEntryPath,
	buildWorkspaceMetadataPath,
	buildWorkspaceStateFilePath,
	buildWorkspaceStorageKey,
	joinWorkspacePaths,
	fetchWorkspaceFile,
	WORKSPACE_DIRTY_DIR,
} from '../../emulator/workspace';
import { setFontVariant } from '../browser/editor_view';
import { findCodeTabContext, initializeTabs, openCodeTabForDescriptor, setTabDirty, updateActiveContextDirtyFlag } from '../browser/editor_tabs';
import { FontVariant } from '../../emulator/font';
import { getTextSnapshot } from '../text/source_text';
import { clearWorkspaceCachedSources, deleteWorkspaceCachedSources, getWorkspaceCachedSource, listWorkspaceCachedPaths, setWorkspaceCachedSources } from '../../emulator/workspace_cache';
import { restoreSnapshot } from '../editing/undo_controller';

export type WorkspaceStoragePaths = {
	projectRootPath: string;
	metadataDir: string;
	dirtyDir: string;
	stateFile: string;
};

type SnapshotMetadata = {
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position;
	textVersion?: number;
};

export type SerializedDescriptor = {
	path: string;
	type: string;
	asset_id?: string;
	readOnly?: boolean;
};

export type PersistedDirtyEntry = {
	contextId: string;
	descriptor: SerializedDescriptor;
	dirtyPath: string;
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position;
};

export type WorkspaceAutosavePayload = {
	savedAt: number;
	dirtyFiles: PersistedDirtyEntry[];
	breakpoints?: SerializedBreakpointMap;
	fontVariant?: FontVariant;
	overlayResolutionMode?: 'offscreen' | 'viewport';
};

export type DirtyContextEntry = PersistedDirtyEntry & { text: string };

let storagePaths: WorkspaceStoragePaths = null;
let serverBackend: ServerWorkspaceBackend = null;
let serverBackendAvailable = false;
let serverBackendFailureNotified = false;
let localBackend: LocalWorkspaceBackend = null;
let serverRetryScheduled = false;
let serverRetryHandle: TimerHandle = null;
const workspaceRestoreGate = taskGate.group('workspace_restore');

function resetWorkspaceBackends(): void {
	serverBackend = null;
	localBackend = null;
	serverBackendAvailable = false;
	serverBackendFailureNotified = false;
	serverRetryHandle?.cancel();
	ide_state.serverWorkspaceConnected = false;
}

export async function configureWorkspaceStorage(projectRootPath: string): Promise<void> {
	if (!projectRootPath) {
		storagePaths = null;
		resetWorkspaceBackends();
		return;
	}
	resetWorkspaceBackends();
	const metadataDir = buildWorkspaceMetadataPath(projectRootPath);
	const dirtyDir = buildWorkspaceDirtyDir(projectRootPath);
	const stateFile = buildWorkspaceStateFilePath(projectRootPath);
	storagePaths = {
		projectRootPath: projectRootPath,
		metadataDir,
		dirtyDir,
		stateFile,
	};
	localBackend = null;
	const storage = $.platform.storage ;
	if (storage) {
		try {
			const backend = new LocalWorkspaceBackend(projectRootPath, storage);
			await backend.ensureReady();
			localBackend = backend;
		} catch {
			// Ignore storage failures; rely on server backend if available.
			localBackend = null;
		}
	}
	serverBackendFailureNotified = false;
	serverBackendAvailable = false;
	try {
		const backend = new ServerWorkspaceBackend(projectRootPath);
		await backend.ensureReady();
		serverBackend = backend;
		serverBackendAvailable = true;
	} catch (error) {
		serverBackend = null;
		serverBackendAvailable = false;
		serverBackendFailureNotified = true;
		ide_state.serverWorkspaceConnected = false;
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

function attachWorkspaceExitHandler(): void {
	detachWorkspaceExitHandler();
	ide_state.disposeWorkspaceExitListener = $.platform.lifecycle.onWillExit(() => {
		if (!ide_state.workspaceAutosaveEnabled) {
			return;
		}
		void runWorkspaceAutosaveTick();
	});
}

function detachWorkspaceExitHandler(): void {
	if (ide_state.disposeWorkspaceExitListener) {
		try {
			ide_state.disposeWorkspaceExitListener.unsubscribe();
		} catch {
			// ignore
		}
		ide_state.disposeWorkspaceExitListener = null;
	}
}

export function initializeWorkspaceStorage(projectRootPath: string): void {
	stopWorkspaceAutosaveLoop();
	ide_state.workspaceAutosaveSignature = null;
	clearWorkspaceCachedSources();
	if (!projectRootPath || projectRootPath.length === 0) {
		ide_state.workspaceAutosaveEnabled = false;
		storagePaths = null;
		resetWorkspaceBackends();
		detachWorkspaceExitHandler();
		ide_state.serverWorkspaceConnected = false;
		return;
	}
	ide_state.workspaceAutosaveEnabled = true;
	attachWorkspaceExitHandler();
	const token = workspaceRestoreGate.begin({ blocking: true, tag: 'workspace_restore' });
	(async () => {
		try {
			await configureWorkspaceStorage(projectRootPath);
			await restoreWorkspaceSessionFromDisk();
			ide_state.serverWorkspaceConnected = serverBackendAvailable;
		} catch (error) {
			console.warn('[CartEditor] Workspace persistence disabled:', error);
			ide_state.workspaceAutosaveEnabled = false;
			storagePaths = null;
			resetWorkspaceBackends();
			detachWorkspaceExitHandler();
			return;
		} finally {
			workspaceRestoreGate.end(token);
		}
		if (ide_state.workspaceAutosaveEnabled) {
			scheduleWorkspaceAutosaveLoop();
			// console.info('Workspace autosave loop started.')
		}
		if (ide_state.workspaceAutosaveQueued) {
			ide_state.workspaceAutosaveQueued = false;
			void runWorkspaceAutosaveTick();
			// console.info('Workspace autosave triggered.')
		}
	})().catch((error) => {
		console.warn('[CartEditor] Workspace restore failed:', error);
	});
	// console.info('Workspace initialized.')
}

export function scheduleWorkspaceAutosaveLoop(): void {
	if (!ide_state.workspaceAutosaveEnabled || ide_state.workspaceAutosaveHandle) {
		return;
	}
	ide_state.workspaceAutosaveHandle = scheduleIdeOnce(WORKSPACE_AUTOSAVE_INTERVAL_MS, () => {
		ide_state.workspaceAutosaveHandle = null;
		void runWorkspaceAutosaveTick();
		scheduleWorkspaceAutosaveLoop();
	});
}

export function stopWorkspaceAutosaveLoop(): void {
	if (!ide_state.workspaceAutosaveHandle) {
		return;
	}
	try {
		ide_state.workspaceAutosaveHandle.cancel();
	} catch {
		// ignore cancellation errors
	}
	ide_state.workspaceAutosaveHandle = null;
}

export async function restoreWorkspaceSessionFromDisk(): Promise<void> {
	const stateText = await readWorkspaceStateFile();
	if (!stateText) {
		return;
	}
	let payload: WorkspaceAutosavePayload = null;
	try {
		payload = JSON.parse(stateText) as WorkspaceAutosavePayload;
	} catch (error) {
		console.warn('[CartEditor] Failed to parse workspace session state:', error);
		return;
	}
	if (!payload) {
		return;
	}
	const signature = buildWorkspaceAutosaveSignature(payload);
	await applyWorkspaceAutosavePayload(payload);
	ide_state.workspaceAutosaveSignature = signature;
}

export async function applyWorkspaceAutosavePayload(payload: WorkspaceAutosavePayload): Promise<void> {
	ide_state.codeTabContexts.clear();
	initializeTabs();
	const runtime = Runtime.instance;
	if (payload.fontVariant) {
		if (runtime) {
			runtimeIde.setActiveIdeFontVariant(runtime, payload.fontVariant);
		} else {
			setFontVariant(payload.fontVariant);
		}
	}
	await hydrateDirtyFiles(payload.dirtyFiles);
	restoreBreakpointsFromPayload(payload.breakpoints );
}

export async function hydrateDirtyFiles(entries: PersistedDirtyEntry[]): Promise<void> {
	for (const entry of entries) {
		const descriptor: ResourceDescriptor = {
			path: entry.descriptor.path,
			type: entry.descriptor.type,
			asset_id: entry.descriptor.asset_id,
			readOnly: entry.descriptor.readOnly,
		};
		let context = ide_state.codeTabContexts.get(entry.contextId);
		if (!context) {
			context = findCodeTabContext(descriptor.path);
		}
		if (!context) {
			await openCodeTabForDescriptor(descriptor);
			context = findCodeTabContext(descriptor.path);
		}
		if (!context) {
			throw new Error(`Failed to restore code tab context for '${descriptor.path}'.`);
		}
		const contents = await readDirtyBuffer(entry.dirtyPath);
		if (contents === null) {
			continue;
		}
		const saved = await fetchWorkspaceFile(descriptor.path);
		if (saved && saved.contents !== contents) {
			await deleteDirtyBuffer(entry.dirtyPath);
			deleteWorkspaceCachedSources([entry.dirtyPath, descriptor.path]);
			applySourceToContext(context, saved.contents, entry);
			context.lastSavedSource = saved.contents;
			context.dirty = false;
			context.savePointDepth = context.undoStack.length;
			setTabDirty(context.id, false);
			if (ide_state.activeCodeTabContextId === context.id && ide_state.activeTabId === context.id) {
				restoreSnapshot(buildSnapshotFromBuffer(context, entry), { preserveScroll: true });
				ide_state.savePointDepth = context.savePointDepth;
				ide_state.dirty = false;
				updateActiveContextDirtyFlag();
			}
			continue;
		}
		setWorkspaceCachedSources([entry.dirtyPath, descriptor.path], contents);
		applySourceToContext(context, contents, entry);
		context.dirty = true;
		context.savePointDepth = -1;
		setTabDirty(context.id, true);
		if (ide_state.activeCodeTabContextId === context.id && ide_state.activeTabId === context.id) {
			restoreSnapshot(buildSnapshotFromBuffer(context, entry), { preserveScroll: true });
			ide_state.savePointDepth = context.savePointDepth;
			ide_state.dirty = true;
			updateActiveContextDirtyFlag();
		}
	}
}

function applySourceToContext(context: CodeTabContext, source: string, metadata?: SnapshotMetadata): void {
	context.buffer.replace(0, context.buffer.length, source);
	context.textVersion = context.buffer.version;
	context.undoStack.length = 0;
	context.redoStack.length = 0;
	context.lastHistoryKey = null;
	context.lastHistoryTimestamp = 0;
	context.savePointDepth = 0;
	if (ide_state.activeCodeTabContextId === context.id && ide_state.activeTabId === context.id) {
		ide_state.undoStack.length = 0;
		ide_state.redoStack.length = 0;
		ide_state.lastHistoryKey = null;
		ide_state.lastHistoryTimestamp = 0;
		ide_state.savePointDepth = 0;
	}
	const snapshot = buildSnapshotFromBuffer(context, metadata);
	context.cursorRow = snapshot.cursorRow;
	context.cursorColumn = snapshot.cursorColumn;
	context.scrollRow = snapshot.scrollRow;
	context.scrollColumn = snapshot.scrollColumn;
	context.selectionAnchor = snapshot.selectionAnchor;
}

function buildSnapshotFromBuffer(context: CodeTabContext, metadata?: SnapshotMetadata): EditorSnapshot {
	const buffer = context.buffer;
	const lastRow = Math.max(0, buffer.getLineCount() - 1);
	const cursorRow = clamp_safe(metadata?.cursorRow, 0, lastRow);
	const cursorLen = buffer.getLineEndOffset(cursorRow) - buffer.getLineStartOffset(cursorRow);
	const cursorColumn = clamp_safe(metadata?.cursorColumn, 0, cursorLen);
	const anchor = metadata?.selectionAnchor;
	let selectionAnchor: Position = null;
	if (anchor) {
		const anchorRow = clamp_safe(anchor.row ?? 0, 0, lastRow);
		const anchorLen = buffer.getLineEndOffset(anchorRow) - buffer.getLineStartOffset(anchorRow);
		const anchorColumn = clamp_safe(anchor.column ?? 0, 0, anchorLen);
		selectionAnchor = { row: anchorRow, column: anchorColumn };
	}
	return {
		cursorRow,
		cursorColumn,
		scrollRow: clamp_safe(metadata?.scrollRow, 0, lastRow),
		scrollColumn: Math.max(0, metadata?.scrollColumn ?? 0),
		selectionAnchor,
		textVersion: metadata?.textVersion ?? buffer.version,
	};
}

function handleServerBackendFailure(error: unknown): void {
	if (!serverBackendAvailable) return;
	serverBackendAvailable = false;
	serverBackend = null;
	serverRetryHandle?.cancel();
	ide_state.serverWorkspaceConnected = false;
	if (!serverBackendFailureNotified) {
		serverBackendFailureNotified = true;
		console.warn('[WorkspaceStorage] Remote workspace became unavailable; persisting locally only.', error);
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

export function collectDirtyContextEntries(): Map<string, DirtyContextEntry> {
	if (!storagePaths) {
		return new Map();
	}
	const entries = new Map<string, DirtyContextEntry>();
	for (const context of ide_state.codeTabContexts.values()) {
		if (!context.dirty) {
			continue;
		}
		const descriptor: SerializedDescriptor = {
			path: context.descriptor.path,
			type: context.descriptor.type,
			asset_id: context.descriptor.asset_id,
			readOnly: context.descriptor.readOnly,
		};
		const metadata = captureContextSnapshotMetadata(context);
		const dirtyPath = buildDirtyFilePath(descriptor.path);
		const text = captureContextText(context);
		setWorkspaceCachedSources([dirtyPath, descriptor.path], text);
		entries.set(dirtyPath, {
			contextId: context.id,
			descriptor,
			dirtyPath,
			cursorRow: metadata.cursorRow,
			cursorColumn: metadata.cursorColumn,
			scrollRow: metadata.scrollRow,
			scrollColumn: metadata.scrollColumn,
			selectionAnchor: metadata.selectionAnchor ? { row: metadata.selectionAnchor.row, column: metadata.selectionAnchor.column } : null,
			text,
		});
	}
	return entries;
}

export function captureContextText(context: CodeTabContext): string {
	if (context.id === ide_state.activeCodeTabContextId) {
		return getTextSnapshot(ide_state.buffer);
	}
	return getTextSnapshot(context.buffer);
}

function captureContextSnapshotMetadata(context: CodeTabContext): SnapshotMetadata {
	if (context.id === ide_state.activeCodeTabContextId) {
		return {
			cursorRow: ide_state.cursorRow,
			cursorColumn: ide_state.cursorColumn,
			scrollRow: ide_state.scrollRow,
			scrollColumn: ide_state.scrollColumn,
			selectionAnchor: ide_state.selectionAnchor ? { row: ide_state.selectionAnchor.row, column: ide_state.selectionAnchor.column } : null,
			textVersion: ide_state.textVersion,
		};
	}
	return {
		cursorRow: context.cursorRow,
		cursorColumn: context.cursorColumn,
		scrollRow: context.scrollRow,
		scrollColumn: context.scrollColumn,
		selectionAnchor: context.selectionAnchor ? { row: context.selectionAnchor.row, column: context.selectionAnchor.column } : null,
		textVersion: context.textVersion,
	};
}

export function buildWorkspaceAutosavePayload(entries: Map<string, DirtyContextEntry>): WorkspaceAutosavePayload {
	if (!ide_state.workspaceAutosaveEnabled) {
		return null;
	}
	const dirtyFiles: PersistedDirtyEntry[] = [];
	for (const entry of entries.values()) {
		dirtyFiles.push({
			contextId: entry.contextId,
			descriptor: entry.descriptor,
			dirtyPath: entry.dirtyPath,
			cursorRow: entry.cursorRow,
			cursorColumn: entry.cursorColumn,
			scrollRow: entry.scrollRow,
			scrollColumn: entry.scrollColumn,
			selectionAnchor: entry.selectionAnchor ? { row: entry.selectionAnchor.row, column: entry.selectionAnchor.column } : null,
		});
	}
	const runtime = Runtime.instance;
	return {
		savedAt: $.platform.clock.dateNow(),
		dirtyFiles,
		breakpoints: serializeBreakpoints(),
		fontVariant: ide_state.fontVariant,
		overlayResolutionMode: runtime ? runtime.overlayResolutionMode : undefined,
	};
}

function buildWorkspaceAutosaveSignature(payload: WorkspaceAutosavePayload): string {
	const dirtyParts = payload.dirtyFiles
		.map((dirty) => {
			const selection = dirty.selectionAnchor ? `${dirty.selectionAnchor.row}:${dirty.selectionAnchor.column}` : '';
			const descriptorKey = `${dirty.descriptor.path}:${dirty.descriptor.type}`;
			return [
				dirty.dirtyPath,
				descriptorKey,
				dirty.cursorRow,
				dirty.cursorColumn,
				dirty.scrollRow,
				dirty.scrollColumn,
				selection,
			].join(':');
		})
		.sort();
	const breakpointEntries = payload.breakpoints
		? Object.keys(payload.breakpoints)
			.sort()
			.map(path => `${path}:${payload.breakpoints[path].join(',')}`)
		: [];
	return [
		payload.fontVariant ?? '',
		payload.overlayResolutionMode ?? '',
		dirtyParts.join('|'),
		breakpointEntries.join('|'),
	].join('#');
}

export async function persistDirtyContextEntries(entries: Map<string, DirtyContextEntry>): Promise<void> {
	const activeDirtyPaths = new Set<string>();
	for (const [dirtyPath, entry] of entries) {
		activeDirtyPaths.add(dirtyPath);
		const cached = getWorkspaceCachedSource(dirtyPath);
		if (cached === entry.text) {
			continue;
		}
		await writeDirtyBuffer(dirtyPath, entry.text);
		setWorkspaceCachedSources([dirtyPath, entry.descriptor.path], entry.text);
	}
	for (const cachedPath of Array.from(listWorkspaceCachedPaths())) {
		const isDirtyPath = cachedPath.includes(`/${WORKSPACE_DIRTY_DIR}/`);
		if (!isDirtyPath) {
			continue;
		}
		if (activeDirtyPaths.has(cachedPath)) {
			continue;
		}
		await deleteDirtyBuffer(cachedPath);
		deleteWorkspaceCachedSources([cachedPath]);
	}
}

export function loadCleanSrc(path: string) {
	const context = findCodeTabContext(path);
	if (context && context.mode === 'aem') {
		return context.lastSavedSource;
	}
	return runtimeLuaPipeline.resourceSourceForChunk(Runtime.instance, path);
}

export function clearWorkspaceDirtyBuffers(): void {
	clearWorkspaceCachedSources();
	ide_state.workspaceAutosaveSignature = null;
	ide_state.saveGeneration = ide_state.appliedGeneration;
	ide_state.dirty = false;
	ide_state.undoStack.length = 0;
	ide_state.redoStack.length = 0;
	ide_state.lastHistoryKey = null;
	ide_state.lastHistoryTimestamp = 0;
	ide_state.savePointDepth = 0;
	for (const context of ide_state.codeTabContexts.values()) {
		const source = loadCleanSrc(context.descriptor.path);
		applySourceToContext(context, source);
		context.dirty = false;
		context.saveGeneration = ide_state.saveGeneration;
		context.appliedGeneration = ide_state.appliedGeneration;
		context.lastSavedSource = source;
		context.undoStack.length = 0;
		context.redoStack.length = 0;
		context.lastHistoryKey = null;
		context.lastHistoryTimestamp = 0;
		context.savePointDepth = 0;
		setTabDirty(context.id, false);
		if (ide_state.activeCodeTabContextId === context.id && ide_state.activeTabId === context.id) {
			restoreSnapshot(buildSnapshotFromBuffer(context), { preserveScroll: false });
			updateActiveContextDirtyFlag();
		}
	}
	updateActiveContextDirtyFlag();
}

export async function runWorkspaceAutosaveTick(): Promise<void> {
	if (!ide_state.workspaceAutosaveEnabled) {
		return;
	}
	if (!serverBackendAvailable && !serverRetryScheduled) {
		scheduleServerBackendRetry();
	}
	if (!workspaceRestoreGate.ready) {
		ide_state.workspaceAutosaveQueued = true;
		return;
	}
	if (ide_state.workspaceAutosaveRunning) {
		ide_state.workspaceAutosaveQueued = true;
		return;
	}
	ide_state.workspaceAutosaveRunning = true;
	try {
		const dirtyEntries = collectDirtyContextEntries();
		const payload = buildWorkspaceAutosavePayload(dirtyEntries);
		if (payload) {
			const signature = buildWorkspaceAutosaveSignature(payload);
			if (signature !== ide_state.workspaceAutosaveSignature) {
				await writeWorkspaceStateFile(JSON.stringify(payload));
				ide_state.workspaceAutosaveSignature = signature;
			}
		}
		await persistDirtyContextEntries(dirtyEntries);
	} catch (error) {
		console.warn('[CartEditor] Workspace autosave failed:', error);
	} finally {
		ide_state.workspaceAutosaveRunning = false;
		if (ide_state.workspaceAutosaveQueued) {
			ide_state.workspaceAutosaveQueued = false;
			await runWorkspaceAutosaveTick();
		}
	}
}

export function clearWorkspaceSessionState(): void {
	stopWorkspaceAutosaveLoop();
	ide_state.undoStack.length = 0;
	ide_state.redoStack.length = 0;
	ide_state.lastHistoryKey = null;
	ide_state.lastHistoryTimestamp = 0;
	ide_state.savePointDepth = 0;
	ide_state.dirty = false;
	for (const context of ide_state.codeTabContexts.values()) {
		context.undoStack.length = 0;
		context.redoStack.length = 0;
		context.lastHistoryKey = null;
		context.lastHistoryTimestamp = 0;
		context.savePointDepth = 0;
		context.dirty = false;
		setTabDirty(context.id, false);
	}
	ide_state.navigationHistory.back = [];
	ide_state.navigationHistory.forward = [];
	ide_state.navigationHistory.current = null;
	ide_state.breakpoints.clear();
	ide_state.workspaceAutosaveSignature = null;
	ide_state.workspaceAutosaveQueued = false;
	ide_state.workspaceAutosaveRunning = false;
}

function scheduleServerBackendRetry(): void {
	if (serverBackendAvailable || serverRetryScheduled || !storagePaths) {
		return;
	}
	serverRetryScheduled = true;
	const delayMs = WORKSPACE_AUTOSAVE_INTERVAL_MS * 4;
	serverRetryHandle = scheduleIdeOnce(delayMs, async () => {
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
		ide_state.serverWorkspaceConnected = true;
		serverRetryHandle?.cancel();
	} catch {
		scheduleServerBackendRetry();
	}
}
