import { $ } from '../../core/game';
import type { EditorSnapshot } from '../editor';
import type { ConsoleResourceDescriptor } from '../types';
import { createEntryTabContext, findResourceDescriptorByAssetId, ide_state, initializeTabs, openDebugPanelTab, openLuaCodeTab, openResourceViewerTab, restoreSnapshot, setActiveTab, setTabDirty, updateActiveContextDirtyFlag } from './console_cart_editor';
import { WORKSPACE_AUTOSAVE_INTERVAL_MS, workspaceDirtyCache } from './ide_state';
import type { DebugPanelKind, EditorTabDescriptor, CodeTabContext, Position } from './types';
import { clamp } from '../../utils/utils';

const WORKSPACE_FILE_ENDPOINT = '/__bmsx__/lua';
const METADATA_DIR_NAME = '.bmsx';
const DIRTY_DIR_NAME = 'dirty';
const STATE_FILE_NAME = 'ide-state.json';
const MARKER_FILE_NAME = '~workspace';

export type WorkspaceStoragePaths = {
	projectRootPath: string;
	metadataDir: string;
	dirtyDir: string;
	stateFile: string;
};

let storagePaths: WorkspaceStoragePaths | null = null;

export function getWorkspaceStoragePaths(): WorkspaceStoragePaths | null {
	return storagePaths;
}

export async function configureWorkspaceStorage(projectRootPath: string | null): Promise<void> {
	if (!projectRootPath) {
		storagePaths = null;
		return;
	}
	const normalizedRoot = normalizeRelativePath(projectRootPath);
	if (normalizedRoot.length === 0) {
		storagePaths = null;
		return;
	}
	const metadataDir = joinRelativePaths(normalizedRoot, METADATA_DIR_NAME);
	const dirtyDir = joinRelativePaths(metadataDir, DIRTY_DIR_NAME);
	const stateFile = joinRelativePaths(metadataDir, STATE_FILE_NAME);
	storagePaths = {
		projectRootPath: normalizedRoot,
		metadataDir,
		dirtyDir,
		stateFile,
	};
	try {
		await ensureWorkspaceDirectory(normalizedRoot);
	} catch (error) {
		console.warn('[WorkspaceStorage] Unable to pre-create workspace directory.', error);
	}
}

export function buildDirtyFilePath(resourcePath: string): string {
	if (!storagePaths) {
		throw new Error('[WorkspaceStorage] Workspace storage not configured.');
	}
	const normalizedResource = normalizeRelativePath(resourcePath);
	if (normalizedResource.length === 0) {
		throw new Error('[WorkspaceStorage] Resource path is required to build dirty file path.');
	}
	const segments = normalizedResource.split('/');
	const baseName = segments.pop() ?? normalizedResource;
	const tempName = baseName.startsWith('~') ? baseName : `~${baseName}`;
	segments.push(tempName);
	return joinRelativePaths(storagePaths.dirtyDir, ...segments);
}

export function buildScratchDirtyFilePath(contextId: string): string {
	if (!storagePaths) {
		throw new Error('[WorkspaceStorage] Workspace storage not configured.');
	}
	const sanitized = sanitizeFilenameSegment(contextId);
	const baseName = sanitized.endsWith('.lua') ? sanitized : `${sanitized}.lua`;
	const tempName = baseName.startsWith('~') ? baseName : `~${baseName}`;
	return joinRelativePaths(storagePaths.dirtyDir, '__scratch__', tempName);
}

export async function readWorkspaceStateFile(): Promise<string | null> {
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

export async function readDirtyBuffer(relativePath: string): Promise<string | null> {
	return await readWorkspaceFile(relativePath);
}

export async function writeDirtyBuffer(relativePath: string, contents: string): Promise<void> {
	await writeWorkspaceFile(relativePath, contents);
}

export async function deleteDirtyBuffer(relativePath: string): Promise<void> {
	const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(relativePath)}`;
	const response = await fetchOrThrow(url, { method: 'DELETE' });
	if (!response.ok && response.status !== 404) {
		const message = await safeReadText(response);
		throw new Error(`[WorkspaceStorage] Failed to delete dirty buffer (${relativePath}): ${message}`);
	}
}

async function ensureWorkspaceDirectory(projectRootPath: string): Promise<void> {
	const metadataDir = joinRelativePaths(projectRootPath, METADATA_DIR_NAME);
	const markerPath = joinRelativePaths(metadataDir, MARKER_FILE_NAME);
	await writeWorkspaceFile(markerPath, '');
}

async function readWorkspaceFile(relativePath: string): Promise<string | null> {
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

async function writeWorkspaceFile(relativePath: string, contents: string): Promise<void> {
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

function normalizeRelativePath(input: string): string {
	const replaced = input.replace(/\\/g, '/').trim();
	if (replaced.length === 0) {
		return '';
	}
	const parts = replaced.split('/');
	const stack: string[] = [];
	for (const part of parts) {
		if (!part || part === '.') {
			continue;
		}
		if (part === '..') {
			if (stack.length > 0) {
				stack.pop();
			}
			continue;
		}
		stack.push(part);
	}
	return stack.join('/');
}

function joinRelativePaths(...segments: string[]): string {
	return segments
		.filter(segment => segment.length > 0)
		.join('/')
		.replace(/\/+/g, '/');
}

function sanitizeFilenameSegment(value: string): string {
	const replaced = value.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_');
	const trimmed = replaced.replace(/^[_\.]+/, '');
	return trimmed.length > 0 ? trimmed : 'untitled';
}

type SnapshotMetadata = {
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position | null;
};

export type SerializedDescriptor = {
	assetId: string;
	path: string;
	type: string;
};

export type PersistedTabEntry = {
	id: string;
	kind: 'lua_editor' | 'resource_view' | 'debug';
	descriptor: SerializedDescriptor | null;
};

export type PersistedDirtyEntry = {
	contextId: string;
	descriptor: SerializedDescriptor | null;
	dirtyPath: string;
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position | null;
};

export type WorkspaceAutosavePayload = {
	version: 1;
	savedAt: number;
	entryTabId: string | null;
	activeTabId: string | null;
	tabs: PersistedTabEntry[];
	dirtyFiles: PersistedDirtyEntry[];
};

export type DirtyContextEntry = PersistedDirtyEntry & { text: string };

export function setupWorkspacePersistence(projectRootPath: string | null): void {
	stopWorkspaceAutosaveLoop();
	ide_state.workspaceAutosaveSignature = null;
	workspaceDirtyCache.clear();
	if (!projectRootPath || projectRootPath.length === 0) {
		ide_state.workspaceAutosaveEnabled = false;
		return;
	}
	ide_state.workspaceAutosaveEnabled = true;
	ide_state.workspaceRestorePromise = (async () => {
		try {
			await configureWorkspaceStorage(projectRootPath);
			await restoreWorkspaceSessionFromDisk();
		} catch (error) {
			console.warn('[ConsoleCartEditor] Workspace persistence disabled:', error);
			ide_state.workspaceAutosaveEnabled = false;
			return;
		} finally {
			ide_state.workspaceRestorePromise = null;
		}
		if (ide_state.workspaceAutosaveEnabled) {
			scheduleWorkspaceAutosaveLoop();
		}
	})();
}

export function scheduleWorkspaceAutosaveLoop(): void {
	if (!ide_state.workspaceAutosaveEnabled || ide_state.workspaceAutosaveHandle) {
		return;
	}
	const scheduleOnce = $.platform.clock.scheduleOnce;
	if (typeof scheduleOnce === 'function') {
		ide_state.workspaceAutosaveHandle = scheduleOnce.call($.platform.clock, WORKSPACE_AUTOSAVE_INTERVAL_MS, () => {
			ide_state.workspaceAutosaveHandle = null;
			void runWorkspaceAutosaveTick();
			scheduleWorkspaceAutosaveLoop();
		});
		return;
	}
	const timeoutId = setTimeout(() => {
		ide_state.workspaceAutosaveHandle = null;
		void runWorkspaceAutosaveTick();
		scheduleWorkspaceAutosaveLoop();
	}, WORKSPACE_AUTOSAVE_INTERVAL_MS);
	ide_state.workspaceAutosaveHandle = {
		cancel: () => clearTimeout(timeoutId),
	};
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
	let payload: WorkspaceAutosavePayload | null = null;
	try {
		payload = JSON.parse(stateText) as WorkspaceAutosavePayload;
	} catch (error) {
		console.warn('[ConsoleCartEditor] Failed to parse workspace session state:', error);
		return;
	}
	if (!payload || payload.version !== 1) {
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
	initializeTabs(entryContext ?? null);
	if (entryContext) {
		ide_state.activeCodeTabContextId = entryContext.id;
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

export function extractDebugPanelKindFromTabId(tabId: string): DebugPanelKind | null {
	if (!tabId.startsWith('debug:')) {
		return null;
	}
	const suffix = tabId.slice('debug:'.length);
	if (suffix === 'objects' || suffix === 'events' || suffix === 'registry') {
		return suffix as DebugPanelKind;
	}
	return null;
}

export function serializeTabEntry(tab: EditorTabDescriptor): PersistedTabEntry | null {
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
		const context = ide_state.codeTabContexts.get(tab.id) ?? null;
		const descriptor = context?.descriptor ? serializeDescriptor(context.descriptor) : null;
		return { id: tab.id, kind: 'lua_editor', descriptor };
	}
	return null;
}

export function serializeDescriptor(descriptor: ConsoleResourceDescriptor | null): SerializedDescriptor | null {
	if (!descriptor) {
		return null;
	}
	return {
		assetId: descriptor.assetId,
		path: descriptor.path,
		type: descriptor.type,
	};
}

export function resolveSerializedDescriptor(serialized: SerializedDescriptor | null): ConsoleResourceDescriptor | null {
	if (!serialized) {
		return null;
	}
	return findResourceDescriptorByAssetId(serialized.assetId);
}

export async function hydrateDirtyFiles(entries: PersistedDirtyEntry[]): Promise<void> {
	for (const entry of entries) {
		const descriptor = resolveSerializedDescriptor(entry.descriptor);
		let context = ide_state.codeTabContexts.get(entry.contextId) ?? null;
		if (!context && descriptor) {
			openLuaCodeTab(descriptor);
			context = ide_state.codeTabContexts.get(entry.contextId) ?? null;
		}
		if (!context) {
			continue;
		}
			const contents = await readDirtyBuffer(entry.dirtyPath);
			if (contents === null) {
				continue;
			}
			workspaceDirtyCache.set(entry.dirtyPath, contents);
			const snapshot = buildSnapshotFromSource(contents, entry);
		context.snapshot = snapshot;
		context.dirty = true;
		setTabDirty(context.id, true);
		if (ide_state.activeCodeTabContextId === context.id && ide_state.activeTabId === context.id) {
			restoreSnapshot(snapshot);
			updateActiveContextDirtyFlag();
		}
	}
}

export function buildSnapshotFromSource(source: string, metadata?: SnapshotMetadata): EditorSnapshot {
	const normalized = source.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const lastRow = lines.length > 0 ? lines.length - 1 : 0;
	const cursorRow = clampRow(metadata?.cursorRow ?? 0, lastRow);
	const cursorColumn = clampColumn(metadata?.cursorColumn ?? 0, lines[cursorRow] ?? '');
	return {
		lines,
		cursorRow,
		cursorColumn,
		scrollRow: clampRow(metadata?.scrollRow ?? 0, lastRow),
		scrollColumn: Math.max(0, metadata?.scrollColumn ?? 0),
		selectionAnchor: clampSelection(metadata?.selectionAnchor ?? null, lines),
		dirty: true,
	};
}

function clampRow(value: number, maxRow: number): number {
	const normalized = Number.isFinite(value) ? value : 0;
	return clamp(normalized, 0, Math.max(0, maxRow));
}

function clampColumn(value: number, line: string): number {
	const normalized = Number.isFinite(value) ? value : 0;
	return clamp(normalized, 0, Math.max(0, line.length));
}

function clampSelection(anchor: Position | null, lines: string[]): Position | null {
	if (!anchor) {
		return null;
	}
	const row = clampRow(anchor.row ?? 0, Math.max(0, lines.length - 1));
	const line = lines[row] ?? '';
	const column = clampColumn(anchor.column ?? 0, line);
	return { row, column };
}

export function collectDirtyContextEntries(): Map<string, DirtyContextEntry> {
	if (!getWorkspaceStoragePaths()) {
		return new Map();
	}
	const entries = new Map<string, DirtyContextEntry>();
	for (const context of ide_state.codeTabContexts.values()) {
		if (!context.dirty) {
			continue;
		}
		const descriptor = serializeDescriptor(context.descriptor ?? null);
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

export function captureContextText(context: CodeTabContext): string | null {
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

export function buildWorkspaceAutosavePayload(entries: Map<string, DirtyContextEntry>): WorkspaceAutosavePayload | null {
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
	return {
		version: 1,
		savedAt: Date.now(),
		entryTabId: ide_state.entryTabId ?? null,
		activeTabId: ide_state.activeTabId ?? null,
		tabs,
		dirtyFiles,
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

export async function runWorkspaceAutosaveTick(): Promise<void> {
	if (!ide_state.workspaceAutosaveEnabled) {
		return;
	}
	if (ide_state.workspaceRestorePromise) {
		try {
			await ide_state.workspaceRestorePromise;
		} catch {
			// ignore restore failure
		}
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
			void runWorkspaceAutosaveTick();
		}
	}
}
