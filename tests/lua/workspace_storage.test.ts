import './test_setup';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { CodeTabContext } from '../../src/bmsx/ide/common/models';
import type { StorageService } from '../../src/bmsx/platform/platform';
import { $ } from '../../src/bmsx/core/console';
import { PieceTreeBuffer } from '../../src/bmsx/ide/editor/text/piece_tree_buffer';
import { getTextSnapshot } from '../../src/bmsx/ide/editor/text/source_text';
import { workspaceSourceCache } from '../../src/bmsx/ide/workspace/cache';
import {
	WORKSPACE_METADATA_DIR,
	WORKSPACE_MARKER_FILE,
	buildWorkspaceStorageKey,
	joinWorkspacePaths,
} from '../../src/bmsx/ide/workspace/files';
import { codeTabSessionState } from '../../src/bmsx/ide/workbench/ui/code_tab/session_state';
import { tabSessionState } from '../../src/bmsx/ide/workbench/ui/tab/session_state';
import { collectDirtyContextEntries, persistDirtyContextEntries } from '../../src/bmsx/ide/workbench/workspace/autosave';
import {
	buildDirtyFilePath,
	configureWorkspaceStorage,
	readWorkspaceFile,
	readWorkspaceStateFile,
	writeWorkspaceFile,
	writeWorkspaceStateFile,
} from '../../src/bmsx/ide/workbench/workspace/io';
import { hydrateDirtyFiles } from '../../src/bmsx/ide/workbench/workspace/restore';

class MockStorage implements StorageService {
	private readonly store = new Map<string, string>();
	public failWriteKey: string = null;

	getItem(key: string): string {
		return this.store.has(key) ? this.store.get(key)! : null;
	}

	setItem(key: string, value: string): void {
		if (key === this.failWriteKey) {
			throw new Error(`write failed for ${key}`);
		}
		this.store.set(key, value);
	}

	removeItem(key: string): void {
		this.store.delete(key);
	}

	clear(): void {
		this.store.clear();
	}
}

function createPlatformStub(storage: MockStorage) {
	return {
		storage,
		lifecycle: {
			onWillExit: () => () => { /* noop */ },
		},
		clock: {
			scheduleOnce: () => ({ cancel() { /* noop */ } }),
		},
	} as const;
}

const ORIGINAL_PLATFORM = ($ as any).platform;
const ORIGINAL_FETCH = globalThis.fetch;
// disable-next-line legacy_sentinel_string_pattern -- seeds and verifies removal of the obsolete local-only workspace marker.
const LEGACY_LOCAL_WORKSPACE_MARKER = '__marker__';

function useOfflinePlatform(storage: MockStorage): void {
	const platformStub = createPlatformStub(storage);
	($ as any).platform = platformStub;
	const offlineFetch: typeof globalThis.fetch = async () => {
		throw new Error('offline');
	};
	globalThis.fetch = offlineFetch;
}

async function resetEnvironment(storage: MockStorage): Promise<void> {
	await configureWorkspaceStorage(null);
	storage.clear();
	workspaceSourceCache.clear();
	codeTabSessionState.contexts.clear();
	codeTabSessionState.activeContextId = null;
	codeTabSessionState.activeContextReadOnly = false;
	tabSessionState.tabs = [];
	tabSessionState.activeTabId = null;
	($ as any).platform = ORIGINAL_PLATFORM;
	globalThis.fetch = ORIGINAL_FETCH;
}

function installOfflineWorkspace(t: TestContext, storage: MockStorage): void {
	useOfflinePlatform(storage);
	t.after(() => resetEnvironment(storage));
}

function installCodeContext(path: string, source: string): CodeTabContext {
	const buffer = new PieceTreeBuffer(source);
	const context: CodeTabContext = {
		id: `code:${path}`,
		title: path,
		descriptor: { path, type: 'lua' },
		mode: 'lua',
		buffer,
		cursorRow: 0,
		cursorColumn: 0,
		scrollRow: 0,
		scrollColumn: 0,
		selectionAnchor: null,
		lastSavedSource: source,
		saveGeneration: 0,
		appliedGeneration: 0,
		undoStack: [],
		redoStack: [],
		lastHistoryKey: null,
		lastHistoryTimestamp: 0,
		savePointDepth: 0,
		dirty: true,
		runtimeErrorOverlay: null,
		executionStopRow: null,
		runtimeSyncState: 'synced',
		runtimeSyncMessage: null,
		textVersion: buffer.version,
	};
	codeTabSessionState.contexts.set(context.id, context);
	tabSessionState.tabs = [{
		id: context.id,
		kind: 'code_editor',
		title: context.title,
		closable: true,
		dirty: false,
	}];
	tabSessionState.activeTabId = 'resource:other';
	codeTabSessionState.activeContextId = 'code:other.lua';
	return context;
}

async function openOfflineDirtyContext(t: TestContext, storage: MockStorage, path: string, source: string): Promise<CodeTabContext> {
	installOfflineWorkspace(t, storage);
	await configureWorkspaceStorage('offline-cart');
	return installCodeContext(path, source);
}

test('workspace state falls back to local storage when remote backend is unavailable', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const legacyMarkerKey = buildWorkspaceStorageKey('offline-cart', LEGACY_LOCAL_WORKSPACE_MARKER);
	storage.setItem(legacyMarkerKey, 'ready');

	await configureWorkspaceStorage('offline-cart');
	const markerPath = joinWorkspacePaths('offline-cart', WORKSPACE_METADATA_DIR, WORKSPACE_MARKER_FILE);
	assert.equal(storage.getItem(buildWorkspaceStorageKey('offline-cart', markerPath)), '');
	assert.equal(storage.getItem(legacyMarkerKey), null);
	await writeWorkspaceStateFile('{"session":"offline"}');

	await configureWorkspaceStorage(null);
	await configureWorkspaceStorage('offline-cart');

	const restored = await readWorkspaceStateFile();
	assert.equal(restored, '{"session":"offline"}');
});

test('dirty buffers persist via local storage between offline sessions', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);

	await configureWorkspaceStorage('offline-cart');

	const dirtyPath = buildDirtyFilePath('src/foo.lua');
	await writeWorkspaceFile(dirtyPath, '-- offline cached');
	const stored = await readWorkspaceFile(dirtyPath);
	assert.equal(stored, '-- offline cached');

	await configureWorkspaceStorage(null);
	await configureWorkspaceStorage('offline-cart');

	const dirtyPathAfterRestart = buildDirtyFilePath('src/foo.lua');
	const restored = await readWorkspaceFile(dirtyPathAfterRestart);
	assert.equal(restored, '-- offline cached');
});

test('dirty autosave writes storage before marking source cache', async (t) => {
	const storage = new MockStorage();
	await openOfflineDirtyContext(t, storage, 'src/foo.lua', '-- dirty edit');

	const dirtyPath = buildDirtyFilePath('src/foo.lua');
	const entries = collectDirtyContextEntries();
	assert.equal(workspaceSourceCache.get(dirtyPath), undefined);

	await persistDirtyContextEntries(entries);

	assert.equal(storage.getItem(buildWorkspaceStorageKey('offline-cart', dirtyPath)), '-- dirty edit');
	assert.equal(workspaceSourceCache.get(dirtyPath), '-- dirty edit');
	assert.equal(workspaceSourceCache.get('src/foo.lua'), '-- dirty edit');
});

test('dirty autosave leaves source cache untouched when storage write fails', async (t) => {
	const storage = new MockStorage();
	await openOfflineDirtyContext(t, storage, 'src/foo.lua', '-- dirty edit');

	const dirtyPath = buildDirtyFilePath('src/foo.lua');
	storage.failWriteKey = buildWorkspaceStorageKey('offline-cart', dirtyPath);
	await assert.rejects(async () => persistDirtyContextEntries(collectDirtyContextEntries()), /write failed/);

	assert.equal(storage.getItem(buildWorkspaceStorageKey('offline-cart', dirtyPath)), null);
	assert.equal(workspaceSourceCache.get(dirtyPath), undefined);
	assert.equal(workspaceSourceCache.get('src/foo.lua'), undefined);
});

test('dirty restore keeps autosave contents authoritative over canonical source', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);

	await configureWorkspaceStorage('offline-cart');
	const context = installCodeContext('src/foo.lua', '-- clean source');
	const dirtyPath = buildDirtyFilePath('src/foo.lua');
	await writeWorkspaceFile(dirtyPath, '-- restored dirty edit');
	let canonicalFetchCalled = false;
	globalThis.fetch = async (input: RequestInfo | URL) => {
		const url = new URL(String(input), 'http://workspace.local');
		if (url.searchParams.get('path') === 'src/foo.lua') {
			canonicalFetchCalled = true;
			return new Response(JSON.stringify({ contents: '-- canonical source', updatedAt: 10 }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		throw new Error('unexpected workspace fetch');
	};

	await hydrateDirtyFiles(null, [{
		contextId: context.id,
		descriptor: { path: 'src/foo.lua', type: 'lua' },
		dirtyPath,
		cursorRow: 0,
		cursorColumn: 0,
		scrollRow: 0,
		scrollColumn: 0,
		selectionAnchor: null,
	}]);

	assert.equal(canonicalFetchCalled, false);
	assert.equal(getTextSnapshot(context.buffer), '-- restored dirty edit');
	assert.equal(context.dirty, true);
	assert.equal(storage.getItem(buildWorkspaceStorageKey('offline-cart', dirtyPath)), '-- restored dirty edit');
});
