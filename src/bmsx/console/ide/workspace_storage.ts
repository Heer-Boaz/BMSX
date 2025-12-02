import { $ } from '../../core/game';
import type { ConsoleResourceDescriptor } from '../types';
import { ide_state, WORKSPACE_AUTOSAVE_INTERVAL_MS, workspaceDirtyCache } from './ide_state';
import type { NavigationHistoryEntry } from './ide_state';
import type { DebugPanelKind, EditorTabDescriptor, CodeTabContext, Position, EditorSnapshot } from './types';
import { safeclamp } from '../../utils/clamp';
import type { StorageService, TimerHandle } from '../../platform/platform';
import { restoreBreakpointsFromPayload, serializeBreakpoints, type SerializedBreakpointMap } from './ide_debugger';
import { scheduleIdeOnce } from './background_tasks';
import { taskGate } from '../../core/taskgate';
import { BmsxConsoleRuntime } from '../runtime';
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
} from '../workspace';
import { openDebugPanelTab, openLuaCodeTab, openResourceViewerTab, restoreSnapshot, setFontVariant } from './console_cart_editor';
import { createEntryTabContext, initializeTabs, setActiveTab, setTabDirty, updateActiveContextDirtyFlag } from './editor_tabs';
import { ConsoleFontVariant } from '../font';

export type WorkspaceStoragePaths = {
	projectRootPath: string;
	metadataDir: string;
	dirtyDir: string;
	stateFile: string;
};

let storagePaths: WorkspaceStoragePaths = null;
let serverBackend: ServerWorkspaceBackend = null;
let serverBackendAvailable = false;
let serverBackendFailureNotified = false;
let localBackend: LocalWorkspaceBackend = null;
let serverRetryScheduled = false;
let serverRetryHandle: TimerHandle | NodeJS.Timeout = null;
const workspaceRestoreGate = taskGate.group('workspace_restore');

function resetWorkspaceBackends(): void {
	serverBackend = null;
	localBackend = null;
	serverBackendAvailable = false;
	serverBackendFailureNotified = false;
	clearServerRetryHandle();
	ide_state.serverWorkspaceConnected = false;
}

export function workspaceStoragePaths(): WorkspaceStoragePaths {
	return storagePaths;
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

type SnapshotMetadata = {
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position;
};

export type SerializedDescriptor = {
	asset_id: string;
	path: string;
	type: string;
};

export type PersistedTabEntry = {
	id: string;
	kind: 'lua_editor' | 'resource_view' | 'debug';
	descriptor: SerializedDescriptor;
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
	version: 1 | 2;
	savedAt: number;
	entryTabId: string;
	activeTabId: string;
	tabs: PersistedTabEntry[];
	dirtyFiles: PersistedDirtyEntry[];
	undoStack: EditorSnapshot[];
	redoStack: EditorSnapshot[];
	lastHistoryKey: string;
	lastHistoryTimestamp: number;
	navigationHistory: {
		back: NavigationHistoryEntry[];
		forward: NavigationHistoryEntry[];
		current: NavigationHistoryEntry;
	};
	breakpoints?: SerializedBreakpointMap;
	fontVariant?: ConsoleFontVariant;
	overlayResolutionMode?: 'offscreen' | 'viewport';
};

export type DirtyContextEntry = PersistedDirtyEntry & { text: string };

export function initializeWorkspaceStorage(projectRootPath: string): void {
	stopWorkspaceAutosaveLoop();
	ide_state.workspaceAutosaveSignature = null;
	workspaceDirtyCache.clear();
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
			console.warn('[ConsoleCartEditor] Workspace persistence disabled:', error);
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
		}
		if (ide_state.workspaceAutosaveQueued) {
			ide_state.workspaceAutosaveQueued = false;
			void runWorkspaceAutosaveTick();
		}
	})().catch((error) => {
		console.warn('[ConsoleCartEditor] Workspace restore failed:', error);
	});
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
		console.warn('[ConsoleCartEditor] Failed to parse workspace session state:', error);
		return;
	}
	if (!payload || (payload.version !== 1 && payload.version !== 2)) {
		return;
	}
	await applyWorkspaceAutosavePayload(payload);
	ide_state.workspaceAutosaveSignature = stateText;
}

export async function applyWorkspaceAutosavePayload(payload: WorkspaceAutosavePayload): Promise<void> {
	const entryContext = createEntryTabContext();
	ide_state.codeTabContexts.clear();
	if (entryContext) {
		ide_state.entryTabId = entryContext.id;
		ide_state.codeTabContexts.set(entryContext.id, entryContext);
	} else {
		ide_state.entryTabId = null;
	}
	initializeTabs(entryContext );
	if (entryContext) {
		ide_state.activeCodeTabContextId = entryContext.id;
	}
	const runtime = BmsxConsoleRuntime.instance;
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
	for (const tabEntry of payload.tabs) {
		restorePersistedTab(tabEntry);
	}
	await hydrateDirtyFiles(payload.dirtyFiles);
	if (payload.activeTabId) {
		setActiveTab(payload.activeTabId);
	} else if (ide_state.entryTabId) {
		setActiveTab(ide_state.entryTabId);
	} else if (ide_state.tabs.length > 0) {
		setActiveTab(ide_state.tabs[0].id);
	}
	ide_state.undoStack = Array.isArray(payload.undoStack)
		? payload.undoStack.map(cloneEditorSnapshot)
		: [];
	ide_state.redoStack = Array.isArray(payload.redoStack)
		? payload.redoStack.map(cloneEditorSnapshot)
		: [];
	ide_state.lastHistoryKey = typeof payload.lastHistoryKey === 'string' ? payload.lastHistoryKey : null;
	ide_state.lastHistoryTimestamp = Number.isFinite(payload.lastHistoryTimestamp)
		? payload.lastHistoryTimestamp
		: 0;
	if (payload.navigationHistory) {
		ide_state.navigationHistory.back = payload.navigationHistory.back.map(entry => ({ ...entry }));
		ide_state.navigationHistory.forward = payload.navigationHistory.forward.map(entry => ({ ...entry }));
		ide_state.navigationHistory.current = payload.navigationHistory.current
			? { ...payload.navigationHistory.current }
			: null;
	} else {
		ide_state.navigationHistory.back = [];
		ide_state.navigationHistory.forward = [];
		ide_state.navigationHistory.current = null;
	}
	restoreBreakpointsFromPayload(payload.breakpoints );
}

export function restorePersistedTab(entry: PersistedTabEntry): void {
	if (entry.kind === 'debug') {
		const debugKind = extractDebugPanelKindFromTabId(entry.id);
		if (debugKind) {
			openDebugPanelTab(debugKind);
		}
		return;
	}
	const descriptor = resolveSerializedDescriptor(entry.descriptor);
	if (!descriptor) {
		return;
	}
	if (entry.kind === 'resource_view') {
		openResourceViewerTab(descriptor);
		return;
	}
	openLuaCodeTab(descriptor);
}

export function extractDebugPanelKindFromTabId(tabId: string): DebugPanelKind {
	if (!tabId.startsWith('debug:')) {
		return null;
	}
	const suffix = tabId.slice('debug:'.length);
	if (suffix === 'objects' || suffix === 'events' || suffix === 'registry') {
		return suffix as DebugPanelKind;
	}
	return null;
}

export function serializeTabEntry(tab: EditorTabDescriptor): PersistedTabEntry {
	if (tab.kind === 'resource_view' && tab.resource) {
		const descriptor = serializeDescriptor(tab.resource.descriptor);
		if (!descriptor) {
			return null;
		}
		return { id: tab.id, kind: 'resource_view', descriptor };
	}
	if (tab.id.startsWith('debug:')) {
		return { id: tab.id, kind: 'debug', descriptor: null };
	}
	if (tab.kind === 'lua_editor') {
		const context = ide_state.codeTabContexts.get(tab.id) ;
		const descriptor = context?.descriptor ? serializeDescriptor(context.descriptor) : null;
		return { id: tab.id, kind: 'lua_editor', descriptor };
	}
	return null;
}

export function serializeDescriptor(descriptor: ConsoleResourceDescriptor): SerializedDescriptor {
	if (!descriptor) {
		return null;
	}
	return {
		asset_id: descriptor.asset_id,
		path: descriptor.path,
		type: descriptor.type,
	};
}

export function resolveSerializedDescriptor(serialized: SerializedDescriptor): ConsoleResourceDescriptor {
	if (!serialized) {
		return null;
	}
	const asset = $.rompack.cart.lua[serialized.asset_id];
	return asset ? { asset_id: asset.resid, path: serialized.path, type: serialized.type } : null;
}

export async function hydrateDirtyFiles(entries: PersistedDirtyEntry[]): Promise<void> {
	for (const entry of entries) {
		const descriptor = resolveSerializedDescriptor(entry.descriptor);
		let context = ide_state.codeTabContexts.get(entry.contextId) ;
		if (!context && descriptor) {
			openLuaCodeTab(descriptor);
			context = ide_state.codeTabContexts.get(entry.contextId) ;
		}
		if (!context) {
			continue;
		}
		const contents = await readDirtyBuffer(entry.dirtyPath);
		if (contents === null) {
			continue;
		}
		const saved = descriptor ? await fetchWorkspaceFile(descriptor.path) : null;
		const savedContents = saved?.contents ?? null;
		if (savedContents !== null && savedContents !== contents) {
			await deleteDirtyBuffer(entry.dirtyPath);
			workspaceDirtyCache.delete(entry.dirtyPath);
			const cleanSnapshot = buildSnapshotFromSource(savedContents, entry);
			context.snapshot = cleanSnapshot;
			context.dirty = false;
			setTabDirty(context.id, false);
			if (ide_state.activeCodeTabContextId === context.id && ide_state.activeTabId === context.id) {
				restoreSnapshot(cleanSnapshot, { preserveScroll: true });
				updateActiveContextDirtyFlag();
			}
			continue;
		}
		workspaceDirtyCache.set(entry.dirtyPath, contents);
		const snapshot = buildSnapshotFromSource(contents, entry);
		context.snapshot = snapshot;
		context.dirty = true;
		setTabDirty(context.id, true);
		if (ide_state.activeCodeTabContextId === context.id && ide_state.activeTabId === context.id) {
			restoreSnapshot(snapshot, { preserveScroll: true });
			updateActiveContextDirtyFlag();
		}
	}
}

export function buildSnapshotFromSource(source: string, metadata?: SnapshotMetadata): EditorSnapshot {
	const normalized = source.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const lastRow = lines.length > 0 ? lines.length - 1 : 0;
	const cursorRow = safeclamp(metadata?.cursorRow, 0, lastRow);
	const cursorColumn = safeclamp(metadata?.cursorColumn, 0, lines[cursorRow].length ?? 0);
	return {
		lines,
		cursorRow,
		cursorColumn,
		scrollRow: safeclamp(metadata?.scrollRow, 0, lastRow),
		scrollColumn: Math.max(0, metadata?.scrollColumn ?? 0),
		selectionAnchor: clampSelection(metadata?.selectionAnchor , lines),
		dirty: ide_state.dirty,
	};
}

function cloneEditorSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
	return {
		lines: snapshot.lines.slice(),
		cursorRow: snapshot.cursorRow,
		cursorColumn: snapshot.cursorColumn,
		scrollRow: snapshot.scrollRow,
		scrollColumn: snapshot.scrollColumn,
		selectionAnchor: snapshot.selectionAnchor
			? { row: snapshot.selectionAnchor.row, column: snapshot.selectionAnchor.column }
			: null,
		dirty: snapshot.dirty,
	};
}

function clampSelection(anchor: Position, lines: string[]): Position {
	if (!anchor) {
		return null;
	}
	const row = safeclamp(anchor.row ?? 0, 0, lines.length - 1);
	const line = lines[row] ?? '';
	const column = safeclamp(anchor.column ?? 0, 0, line.length);
	return { row, column };
}

function handleServerBackendFailure(error: unknown): void {
	if (!serverBackendAvailable) {
		return;
	}
	serverBackendAvailable = false;
	serverBackend = null;
	clearServerRetryHandle();
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
	if (!workspaceStoragePaths()) {
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
		} catch {
			continue;
		}
		const text = captureContextText(context);
		if (text === null) {
			continue;
		}
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
		return ide_state.lines.join('\n');
	}
	if (context.snapshot) {
		return context.snapshot.lines.join('\n');
	}
	return null;
}

function captureContextSnapshotMetadata(context: CodeTabContext): SnapshotMetadata {
	if (context.id === ide_state.activeCodeTabContextId) {
		return {
			cursorRow: ide_state.cursorRow,
			cursorColumn: ide_state.cursorColumn,
			scrollRow: ide_state.scrollRow,
			scrollColumn: ide_state.scrollColumn,
			selectionAnchor: ide_state.selectionAnchor ? { row: ide_state.selectionAnchor.row, column: ide_state.selectionAnchor.column } : null,
		};
	}
	const snapshot = context.snapshot;
	if (snapshot) {
		return {
			cursorRow: snapshot.cursorRow,
			cursorColumn: snapshot.cursorColumn,
			scrollRow: snapshot.scrollRow,
			scrollColumn: snapshot.scrollColumn,
			selectionAnchor: snapshot.selectionAnchor ? { row: snapshot.selectionAnchor.row, column: snapshot.selectionAnchor.column } : null,
		};
	}
	return {
		cursorRow: 0,
		cursorColumn: 0,
		scrollRow: 0,
		scrollColumn: 0,
		selectionAnchor: null,
	};
}

export function buildWorkspaceAutosavePayload(entries: Map<string, DirtyContextEntry>): WorkspaceAutosavePayload {
	if (!ide_state.workspaceAutosaveEnabled) {
		return null;
	}
	const tabs: PersistedTabEntry[] = [];
	for (const tab of ide_state.tabs) {
		const serialized = serializeTabEntry(tab);
		if (serialized) {
			tabs.push(serialized);
		}
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
	const undoStack = ide_state.undoStack.map(cloneEditorSnapshot);
	const redoStack = ide_state.redoStack.map(cloneEditorSnapshot);
	const navigationHistory = {
		back: ide_state.navigationHistory.back.map(entry => ({ ...entry })),
		forward: ide_state.navigationHistory.forward.map(entry => ({ ...entry })),
		current: ide_state.navigationHistory.current ? { ...ide_state.navigationHistory.current } : null,
	};
	const runtime = BmsxConsoleRuntime.instance;
	return {
		version: 2,
		savedAt: $.platform.clock.now(),
		entryTabId: ide_state.entryTabId ,
		activeTabId: ide_state.activeTabId ,
		tabs,
		dirtyFiles,
		undoStack,
		redoStack,
		lastHistoryKey: ide_state.lastHistoryKey ,
		lastHistoryTimestamp: ide_state.lastHistoryTimestamp ?? 0,
		navigationHistory,
		breakpoints: serializeBreakpoints(),
		fontVariant: ide_state.fontVariant,
		overlayResolutionMode: runtime ? runtime.overlayResolutionMode : undefined,
	};
}

export async function persistDirtyContextEntries(entries: Map<string, DirtyContextEntry>): Promise<void> {
	for (const [dirtyPath, entry] of entries) {
		if (workspaceDirtyCache.get(dirtyPath) === entry.text) {
			continue;
		}
		await writeDirtyBuffer(dirtyPath, entry.text);
		workspaceDirtyCache.set(dirtyPath, entry.text);
	}
	for (const cachedPath of Array.from(workspaceDirtyCache.keys())) {
		if (!entries.has(cachedPath)) {
			await deleteDirtyBuffer(cachedPath);
			workspaceDirtyCache.delete(cachedPath);
		}
	}
}

export function clearWorkspaceDirtyBuffers(): void {
	workspaceDirtyCache.clear();
	ide_state.workspaceAutosaveSignature = null;
	ide_state.saveGeneration = ide_state.appliedGeneration;
	ide_state.dirty = false;
	for (const context of ide_state.codeTabContexts.values()) {
		const source = context.load();
		const snapshot = buildSnapshotFromSource(source);
		context.snapshot = snapshot;
		context.dirty = false;
		context.saveGeneration = ide_state.saveGeneration;
		context.appliedGeneration = ide_state.appliedGeneration;
		context.lastSavedSource = source;
		setTabDirty(context.id, false);
		if (ide_state.activeCodeTabContextId === context.id && ide_state.activeTabId === context.id) {
			restoreSnapshot(snapshot, { preserveScroll: false });
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
			const serialized = JSON.stringify(payload);
			if (serialized !== ide_state.workspaceAutosaveSignature) {
				await writeWorkspaceStateFile(serialized);
				ide_state.workspaceAutosaveSignature = serialized;
			}
		}
		await persistDirtyContextEntries(dirtyEntries);
	} catch (error) {
		console.warn('[ConsoleCartEditor] Workspace autosave failed:', error);
	} finally {
		ide_state.workspaceAutosaveRunning = false;
		if (ide_state.workspaceAutosaveQueued) {
			ide_state.workspaceAutosaveQueued = false;
			await runWorkspaceAutosaveTick();
		}
	}
}

function scheduleServerBackendRetry(): void {
	if (serverBackendAvailable || serverRetryScheduled || !storagePaths) {
		return;
	}
	serverRetryScheduled = true;
	const delayMs = WORKSPACE_AUTOSAVE_INTERVAL_MS * 4;
	serverRetryHandle = scheduleIdeOnce(delayMs, async () => {
		clearServerRetryHandle();
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
		clearServerRetryHandle();
	} catch {
		scheduleServerBackendRetry();
	}
}

function clearServerRetryHandle(): void {
	if (!serverRetryHandle) {
		serverRetryScheduled = false;
		return;
	}
	if (typeof (serverRetryHandle as TimerHandle).cancel === 'function') {
		(serverRetryHandle as TimerHandle).cancel();
	} else {
		clearTimeout(serverRetryHandle as NodeJS.Timeout);
	}
	serverRetryHandle = null;
	serverRetryScheduled = false;
}
