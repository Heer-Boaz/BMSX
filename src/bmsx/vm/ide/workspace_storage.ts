import { $ } from '../../core/game';
import type { VMResourceDescriptor } from '../types';
import { ide_state, WORKSPACE_AUTOSAVE_INTERVAL_MS } from './ide_state';
import type { CodeTabContext, Position, EditorSnapshot } from './types';
import { clamp_safe } from '../../utils/clamp';
import type { StorageService, TimerHandle } from '../../platform/platform';
import { restoreBreakpointsFromPayload, serializeBreakpoints, type SerializedBreakpointMap } from './ide_debugger';
import { scheduleIdeOnce } from './background_tasks';
import { taskGate } from '../../core/taskgate';
import { BmsxVMRuntime } from '../vm_runtime';
import {
	WORKSPACE_FILE_ENDPOINT,
	WORKSPACE_MARKER_FILE,
	buildWorkspaceDirtyDir,
	buildWorkspaceDirtyEntryPath,
	buildWorkspaceMetadataPath,
	buildWorkspaceScratchDirtyPath,
	buildWorkspaceStateFilePath,
	buildWorkspaceStorageKey,
	joinWorkspacePaths,
	fetchWorkspaceFile,
	WORKSPACE_DIRTY_DIR,
} from '../workspace';
import { openLuaCodeTab, restoreSnapshot, setFontVariant } from './vm_cart_editor';
import { createEntryTabContext, initializeTabs, setTabDirty, updateActiveContextDirtyFlag } from './editor_tabs';
import { VMFontVariant } from '../font';
import { getTextSnapshot } from './source_text';
import { clearWorkspaceCachedSources, deleteWorkspaceCachedSources, getWorkspaceCachedSource, listWorkspaceCachedPaths, setWorkspaceCachedSources } from '../workspace_cache';

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
	fontVariant?: VMFontVariant;
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

export function buildScratchDirtyFilePath(contextId: string): string {
	if (!storagePaths) {
		throw new Error('[WorkspaceStorage] Workspace storage not configured.');
	}
	return buildWorkspaceScratchDirtyPath(storagePaths.projectRootPath, contextId);
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
			ide_state.disposeWorkspaceExitListener();
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
			console.warn('[VMCartEditor] Workspace persistence disabled:', error);
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
			console.info('Workspace autosave loop started.')
		}
		if (ide_state.workspaceAutosaveQueued) {
			ide_state.workspaceAutosaveQueued = false;
			void runWorkspaceAutosaveTick();
			console.info('Workspace autosave triggered.')
		}
	})().catch((error) => {
		console.warn('[VMCartEditor] Workspace restore failed:', error);
	});
	console.info('Workspace initialized.')
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
		console.warn('[VMCartEditor] Failed to parse workspace session state:', error);
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
	const entryContext = createEntryTabContext();
	ide_state.codeTabContexts.clear();
	if (entryContext) {
		ide_state.codeTabContexts.set(entryContext.id, entryContext);
	}
	initializeTabs(entryContext);
	const runtime = BmsxVMRuntime.instance;
	if (payload.fontVariant) {
		if (runtime) {
			runtime.activeIdeFontVariant = payload.fontVariant;
		} else {
			setFontVariant(payload.fontVariant);
		}
	}
	if (payload.overlayResolutionMode && runtime) {
		runtime.overlayResolutionMode = payload.overlayResolutionMode;
	}
	await hydrateDirtyFiles(payload.dirtyFiles);
	restoreBreakpointsFromPayload(payload.breakpoints );
}

export function serializeDescriptor(descriptor: VMResourceDescriptor): SerializedDescriptor {
	return descriptor ? {
		path: descriptor.path,
		type: descriptor.type,
	} : null;
}

export function resolveSerializedDescriptor(serialized: SerializedDescriptor): VMResourceDescriptor {
	if (!serialized) {
		return null;
	}
	const asset = $.rompack.cart.chunk2lua[serialized.path];
	return asset ? { path: serialized.path, type: serialized.type } : null;
}

export async function hydrateDirtyFiles(entries: PersistedDirtyEntry[]): Promise<void> {
	for (const entry of entries) {
		const descriptor = resolveSerializedDescriptor(entry.descriptor);
		let context = ide_state.codeTabContexts.get(entry.contextId);
		if (!context && descriptor) {
			openLuaCodeTab(descriptor);
			context = ide_state.codeTabContexts.get(entry.contextId);
		}
		if (!context) {
			continue;
		}
		const contents = await readDirtyBuffer(entry.dirtyPath);
		if (contents === null) {
			continue;
		}
		const saved = descriptor ? await fetchWorkspaceFile(descriptor.path) : null;
		const savedContents = saved?.contents;
		if (savedContents !== null && savedContents !== contents) {
			await deleteDirtyBuffer(entry.dirtyPath);
			deleteWorkspaceCachedSources([entry.dirtyPath, descriptor?.path]);
			applySourceToContext(context, savedContents, entry);
			context.lastSavedSource = savedContents;
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
		setWorkspaceCachedSources([entry.dirtyPath, descriptor?.path], contents);
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
		const descriptor = serializeDescriptor(context.descriptor );
		const metadata = captureContextSnapshotMetadata(context);
		let dirtyPath: string;
		try {
			dirtyPath = descriptor
				? buildDirtyFilePath(descriptor.path)
				: buildScratchDirtyFilePath(context.id);
		} catch (error) {
			console.info(`[WorkspaceStorage] Failed to build dirty file path for context ${context.id}: ${error}`);
			continue;
		}
		const text = captureContextText(context);
		setWorkspaceCachedSources([dirtyPath, descriptor?.path], text);
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
	const runtime = BmsxVMRuntime.instance;
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
			const descriptorKey = dirty.descriptor ? `${dirty.descriptor.path}:${dirty.descriptor.type}` : '';
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
			.map(chunk => `${chunk}:${payload.breakpoints[chunk].join(',')}`)
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
		setWorkspaceCachedSources([dirtyPath, entry.descriptor?.path], entry.text);
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

export function loadSrc(path: string) {
	const asset = $.rompack.cart.path2lua[path];
	if (!asset) {
		return '';
	}
	return BmsxVMRuntime.instance.resourceSourceForChunk(asset.chunk_name);
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
		const source = loadSrc(context.descriptor.path);
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
		console.warn('[VMCartEditor] Workspace autosave failed:', error);
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
