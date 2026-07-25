import './test_setup';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { CodeTabContext } from '../../ide/common/models';
import { type ResourceDomain, type ResourceIdentity } from '../../ide/common/resource';
import type { StorageService } from '../../machine/ts/platform/platform';
import { machineManager } from '../../machine/ts/core/machine_manager';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { getTextSnapshot } from '../../ide/editor/text/source_text';
import {
	clearWorkspaceSourceCaches,
	setWorkspaceLuaSourceOverride,
	workspaceFileCache,
} from '../../ide/workspace/cache';
import {
	WORKSPACE_METADATA_DIR,
	WORKSPACE_MARKER_FILE,
	applyWorkspaceSourceOverrides,
	buildWorkspaceDirtyEntryPath,
	buildWorkspaceStorageKey,
	joinWorkspacePaths,
	loadWorkspaceSourceFile,
	readWorkspaceLuaSourceText,
} from '../../ide/workspace/files';
import {
	clearOpenWorkspaceDocumentDirtyState,
	collectUnsavedWorkspaceSources,
	setOpenWorkspaceDocumentDirty,
} from '../../ide/workspace/open_dirty';
import { codeTabSessionState } from '../../ide/workbench/ui/code_tab/session_state';
import { buildCodeTabId } from '../../ide/workbench/ui/code_tab/contexts';
import { tabSessionState } from '../../ide/workbench/ui/tab/session_state';
import { collectDirtyContextEntries, persistDirtyContextEntries } from '../../ide/workbench/workspace/autosave';
import {
	buildDirtyFilePath,
	configureWorkspaceStorage,
	readWorkspaceFile,
	readWorkspaceStateFile,
	writeWorkspaceFile,
	writeWorkspaceStateFile,
} from '../../ide/workbench/workspace/io';
import { hydrateDirtyFiles } from '../../ide/workbench/workspace/restore';
import { captureActiveCodeTabSource, capturePendingLuaCodeTabSources, markLuaCodeTabsAppliedToRuntime } from '../../ide/workbench/ui/code_tab/activation';
import { captureContextText } from '../../ide/workbench/workspace/context_snapshot';
import { editorDocumentState } from '../../ide/editor/editing/document_state';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../machine/ts/lua/source_registry';
import { applyWorkspaceOverridesToRegistry, saveLuaResourceSource } from '../../ide/workspace/workspace';
import { resolveRuntimeLuaSource } from '../../ide/runtime/sources';
import {
	primeRuntimeSemanticWorkspaceProjectSources,
} from '../../ide/editor/contrib/intellisense/semantic/workspace/runtime';
import {
	getOrCreateSemanticWorkspace,
	resetSemanticWorkspaces,
} from '../../ide/editor/contrib/intellisense/semantic/workspace/state';

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
			now: () => 0,
			perf_now: () => 0,
			dateNow: () => 42,
			scheduleOnce: () => ({ cancel() { /* noop */ }, isActive: () => false }),
		},
	} as const;
}

const ORIGINAL_PLATFORM = (machineManager as any).platform;
const ORIGINAL_SOURCE_STATE = (machineManager as any).sourceState;
const ORIGINAL_FETCH = globalThis.fetch;
const TEST_DOMAIN = 0;
// disable-next-line legacy_sentinel_string_pattern -- seeds and verifies removal of the obsolete local-only workspace marker.
const LEGACY_LOCAL_WORKSPACE_MARKER = '__marker__';

function useOfflinePlatform(storage: MockStorage): void {
	const platformStub = createPlatformStub(storage);
	(machineManager as any).platform = platformStub;
	const offlineFetch: typeof globalThis.fetch = async () => {
		throw new Error('offline');
	};
	globalThis.fetch = offlineFetch;
}

async function resetEnvironment(storage: MockStorage): Promise<void> {
	await configureWorkspaceStorage(null);
	storage.clear();
	clearWorkspaceSourceCaches();
	clearOpenWorkspaceDocumentDirtyState();
	codeTabSessionState.contexts.clear();
	codeTabSessionState.activeContextId = null;
	codeTabSessionState.activeContextReadOnly = false;
	tabSessionState.tabs = [];
	tabSessionState.activeTabId = null;
	editorDocumentState.buffer = new PieceTreeBuffer('');
	(machineManager as any).platform = ORIGINAL_PLATFORM;
	(machineManager as any).sourceState = ORIGINAL_SOURCE_STATE;
	globalThis.fetch = ORIGINAL_FETCH;
}

function installOfflineWorkspace(t: TestContext, storage: MockStorage): void {
	useOfflinePlatform(storage);
	t.after(() => resetEnvironment(storage));
}

function installCodeContext(path: string, source: string, domain: ResourceDomain = TEST_DOMAIN): CodeTabContext {
	const buffer = new PieceTreeBuffer(source);
	const descriptor = { domain, path, type: 'lua' };
	const context: CodeTabContext = {
		id: buildCodeTabId(descriptor),
		title: path,
		descriptor,
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

function sourceRegistry(source: string): LuaSourceRegistry {
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entry_path: 'entry.lua',
		namespace: 'test',
		projectRootPath: 'offline-cart',
		can_boot_from_source: true,
		revision: 0,
	};
	registerLuaSourceRecord(registry, {
		resid: 'entry',
		type: 'lua',
		src: source,
		base_src: source,
		base_update_timestamp: 0,
		source_path: 'entry.lua',
		module_path: 'entry',
		update_timestamp: 0,
		generated: false,
	});
	return registry;
}

test('resource identity keeps identical cartridge paths isolated by slot', (t) => {
	const slot0Sources = sourceRegistry('return "slot 0"');
	const slot1Sources = sourceRegistry('return "slot 1"');
	(machineManager as any).sourceState = {
		systemLuaSources: sourceRegistry('return "system"'),
		cartridgeSlots: [
			{ domain: 0, luaSources: slot0Sources },
			{ domain: 1, luaSources: slot1Sources },
		],
		activeLuaSources: slot0Sources,
		activeCartridgeSlot: 0,
	};
	t.after(() => {
		(machineManager as any).sourceState = ORIGINAL_SOURCE_STATE;
		codeTabSessionState.contexts.clear();
		resetSemanticWorkspaces();
		clearWorkspaceSourceCaches();
	});

	assert.equal(resolveRuntimeLuaSource(machineManager.sourceState, { domain: 0, path: 'entry.lua' })!.record.src, 'return "slot 0"');
	assert.equal(resolveRuntimeLuaSource(machineManager.sourceState, { domain: 1, path: 'entry.lua' })!.record.src, 'return "slot 1"');

	const slot0Context = installCodeContext('entry.lua', 'return "slot 0"', 0);
	const slot1Context = installCodeContext('entry.lua', 'return "slot 1"', 1);
	assert.notEqual(slot0Context.id, slot1Context.id);
	assert.equal(codeTabSessionState.contexts.get(slot0Context.id)!.buffer.getText(), 'return "slot 0"');
	assert.equal(codeTabSessionState.contexts.get(slot1Context.id)!.buffer.getText(), 'return "slot 1"');

	assert.notEqual(
		buildWorkspaceDirtyEntryPath('offline-cart', 0, 'entry.lua'),
		buildWorkspaceDirtyEntryPath('offline-cart', 1, 'entry.lua'),
	);
	const slot0Workspace = primeRuntimeSemanticWorkspaceProjectSources(0);
	const slot1Workspace = primeRuntimeSemanticWorkspaceProjectSources(1);
	assert.notEqual(slot0Workspace, slot1Workspace);
	assert.equal(slot0Workspace.getFileData('entry.lua')!.source, 'return "slot 0"');
	assert.equal(slot1Workspace.getFileData('entry.lua')!.source, 'return "slot 1"');

	setWorkspaceLuaSourceOverride(slot0Sources, 'entry.lua', 'return "slot 0 edit"');
	primeRuntimeSemanticWorkspaceProjectSources(0, getOrCreateSemanticWorkspace(0));
	assert.equal(slot0Workspace.getFileData('entry.lua')!.source, 'return "slot 0 edit"');
	assert.equal(slot1Workspace.getFileData('entry.lua')!.source, 'return "slot 1"');
});

test('workspace file cache keys identical resource paths by physical project path', async (t) => {
	workspaceFileCache.set('cart0/entry.lua', 'return "slot 0"');
	const requestedPaths: string[] = [];
	globalThis.fetch = async (input: RequestInfo | URL) => {
		const url = new URL(String(input), 'http://workspace.local');
		requestedPaths.push(url.searchParams.get('path')!);
		return new Response(JSON.stringify({ contents: 'return "slot 1"' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	};
	t.after(() => {
		globalThis.fetch = ORIGINAL_FETCH;
		clearWorkspaceSourceCaches();
	});

	assert.equal(await loadWorkspaceSourceFile('entry.lua', 'cart1'), 'return "slot 1"');
	assert.deepEqual(requestedPaths, ['cart1/entry.lua']);
});

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

test('open dirty workspace paths expose unsaved buffers until dirty storage exists', (t) => {
	const storage = new MockStorage();
	clearOpenWorkspaceDocumentDirtyState();
	t.after(() => clearOpenWorkspaceDocumentDirtyState());

	const identity: ResourceIdentity = { domain: TEST_DOMAIN, path: 'src/foo.lua' };
	setOpenWorkspaceDocumentDirty(identity, true);
	assert.deepEqual([...collectUnsavedWorkspaceSources('offline-cart', storage)], [identity]);

	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	storage.setItem(buildWorkspaceStorageKey('offline-cart', dirtyPath), '-- autosaved edit');
	assert.deepEqual([...collectUnsavedWorkspaceSources('offline-cart', storage)], []);
});

test('open dirty workspace paths clear when the code tab becomes clean', (t) => {
	const storage = new MockStorage();
	clearOpenWorkspaceDocumentDirtyState();
	t.after(() => clearOpenWorkspaceDocumentDirtyState());

	const identity: ResourceIdentity = { domain: TEST_DOMAIN, path: '/src/foo.lua' };
	setOpenWorkspaceDocumentDirty(identity, true);
	setOpenWorkspaceDocumentDirty(identity, false);
	assert.deepEqual([...collectUnsavedWorkspaceSources('offline-cart', storage)], []);
});

test('dirty buffers persist via local storage between offline sessions', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);

	await configureWorkspaceStorage('offline-cart');

	const identity: ResourceIdentity = { domain: TEST_DOMAIN, path: 'src/foo.lua' };
	const dirtyPath = buildDirtyFilePath(identity);
	await writeWorkspaceFile(dirtyPath, '-- offline cached');
	const stored = await readWorkspaceFile(dirtyPath);
	assert.equal(stored, '-- offline cached');

	await configureWorkspaceStorage(null);
	await configureWorkspaceStorage('offline-cart');

	const dirtyPathAfterRestart = buildDirtyFilePath(identity);
	const restored = await readWorkspaceFile(dirtyPathAfterRestart);
	assert.equal(restored, '-- offline cached');
});

test('dirty autosave writes storage before marking source cache', async (t) => {
	const storage = new MockStorage();
	await openOfflineDirtyContext(t, storage, 'src/foo.lua', '-- dirty edit');

	const dirtyPath = buildDirtyFilePath({ domain: TEST_DOMAIN, path: 'src/foo.lua' });
	const entries = collectDirtyContextEntries();
	assert.equal(workspaceFileCache.get(dirtyPath), undefined);

	await persistDirtyContextEntries(entries);

	assert.equal(storage.getItem(buildWorkspaceStorageKey('offline-cart', dirtyPath)), '-- dirty edit');
	assert.equal(workspaceFileCache.get(dirtyPath), '-- dirty edit');
	assert.equal(workspaceFileCache.get('src/foo.lua'), undefined);
});

test('dirty autosave leaves source cache untouched when storage write fails', async (t) => {
	const storage = new MockStorage();
	await openOfflineDirtyContext(t, storage, 'src/foo.lua', '-- dirty edit');

	const dirtyPath = buildDirtyFilePath({ domain: TEST_DOMAIN, path: 'src/foo.lua' });
	storage.failWriteKey = buildWorkspaceStorageKey('offline-cart', dirtyPath);
	await assert.rejects(async () => persistDirtyContextEntries(collectDirtyContextEntries()), /write failed/);

	assert.equal(storage.getItem(buildWorkspaceStorageKey('offline-cart', dirtyPath)), null);
	assert.equal(workspaceFileCache.get(dirtyPath), undefined);
	assert.equal(workspaceFileCache.get('src/foo.lua'), undefined);
});

test('dirty restore keeps autosave contents authoritative over canonical source', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);

	await configureWorkspaceStorage('offline-cart');
	const context = installCodeContext('src/foo.lua', '-- clean source');
	const dirtyPath = buildDirtyFilePath({ domain: TEST_DOMAIN, path: 'src/foo.lua' });
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

	await hydrateDirtyFiles([{
		descriptor: { domain: TEST_DOMAIN, path: 'src/foo.lua', type: 'lua' },
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
	assert.equal(workspaceFileCache.get('src/foo.lua'), undefined);
});

test('workspace override application keeps dirty and canonical in separate namespaces', async () => {
	const storage = new MockStorage();
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entry_path: 'src/foo.lua',
		namespace: 'test',
		projectRootPath: 'offline-cart',
		can_boot_from_source: true,
		revision: 0,
	};
	const asset = {
		resid: 'foo',
		type: 'lua' as const,
		src: '-- rom source',
		base_src: '-- rom source',
		base_update_timestamp: 15,
		source_path: 'src/foo.lua',
		module_path: 'src.foo',
		update_timestamp: 15,
	};
	registerLuaSourceRecord(registry, asset);
	storage.setItem(buildWorkspaceStorageKey('offline-cart', 'src/foo.lua'), JSON.stringify({
		contents: '-- saved source',
		updatedAt: 25,
	}));
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	storage.setItem(buildWorkspaceStorageKey('offline-cart', dirtyPath), JSON.stringify({
		contents: '-- dirty source',
		updatedAt: 30,
	}));

	await applyWorkspaceSourceOverrides({
		domain: TEST_DOMAIN,
		registry,
		storage,
		includeServer: false,
		projectRootPath: 'offline-cart',
		timestampNow: 30,
	});

	assert.equal(asset.src, '-- dirty source');
	assert.equal(JSON.parse(storage.getItem(buildWorkspaceStorageKey('offline-cart', 'src/foo.lua'))).contents, '-- saved source');
	assert.equal(JSON.parse(storage.getItem(buildWorkspaceStorageKey('offline-cart', dirtyPath))).contents, '-- dirty source');
	assert.equal(workspaceFileCache.get(dirtyPath), '-- dirty source');
	assert.equal(workspaceFileCache.get('src/foo.lua'), undefined);
	workspaceFileCache.clear();

	storage.removeItem(buildWorkspaceStorageKey('offline-cart', dirtyPath));
	await applyWorkspaceSourceOverrides({
		domain: TEST_DOMAIN,
		registry,
		storage,
		includeServer: false,
		projectRootPath: 'offline-cart',
		timestampNow: 31,
	});

	assert.equal(asset.src, '-- saved source');
	assert.equal(asset.base_src, '-- saved source');
	assert.equal(asset.base_update_timestamp, 25);
	assert.equal(workspaceFileCache.get(dirtyPath), undefined);
	assert.equal(workspaceFileCache.get('src/foo.lua'), '-- saved source');

	await applyWorkspaceSourceOverrides({
		domain: TEST_DOMAIN,
		registry,
		storage,
		includeServer: false,
		projectRootPath: 'offline-cart',
		timestampNow: 32,
	});

	assert.equal(asset.src, '-- saved source');
});

test('generated compiler sources ignore workspace state', async () => {
	const storage = new MockStorage();
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entry_path: 'src/foo.lua',
		namespace: 'test',
		projectRootPath: 'offline-cart',
		can_boot_from_source: true,
		revision: 0,
	};
	const asset = {
		resid: 'bmsx/gx_texture_layout',
		type: 'lua' as const,
		src: 'return { source_addr = 1 }',
		base_src: 'return { source_addr = 1 }',
		base_update_timestamp: 0,
		source_path: 'bmsx/gx_texture_layout.lua',
		module_path: 'bmsx/gx_texture_layout',
		update_timestamp: 0,
		generated: true,
	};
	registerLuaSourceRecord(registry, asset);
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, asset.source_path);
	storage.setItem(buildWorkspaceStorageKey('offline-cart', asset.source_path), JSON.stringify({
		contents: 'return { source_addr = 2 }',
		updatedAt: 1,
	}));
	storage.setItem(buildWorkspaceStorageKey('offline-cart', dirtyPath), JSON.stringify({
		contents: 'return { source_addr = 3 }',
		updatedAt: 2,
	}));
	workspaceFileCache.set(dirtyPath, 'return { source_addr = 4 }');

	await applyWorkspaceSourceOverrides({
		domain: TEST_DOMAIN,
		registry,
		storage,
		includeServer: false,
		projectRootPath: 'offline-cart',
		timestampNow: 3,
	});

	assert.equal(asset.src, 'return { source_addr = 1 }');
	assert.equal(readWorkspaceLuaSourceText(registry, asset), 'return { source_addr = 1 }');
	workspaceFileCache.clear();
});

test('stale dirty buffers never win over newer cart code', async () => {
	const storage = new MockStorage();
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entry_path: 'src/foo.lua',
		namespace: 'test',
		projectRootPath: 'offline-cart',
		can_boot_from_source: true,
		revision: 0,
	};
	const asset = {
		resid: 'foo',
		type: 'lua' as const,
		src: '-- rom source',
		base_src: '-- rom source',
		base_update_timestamp: 100,
		source_path: 'src/foo.lua',
		module_path: 'src.foo',
		update_timestamp: 100,
	};
	registerLuaSourceRecord(registry, asset);
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	storage.setItem(buildWorkspaceStorageKey('offline-cart', dirtyPath), JSON.stringify({
		contents: '-- stale dirty source',
		updatedAt: 50,
	}));

	await applyWorkspaceSourceOverrides({
		domain: TEST_DOMAIN,
		registry,
		storage,
		includeServer: false,
		projectRootPath: 'offline-cart',
		timestampNow: 101,
	});

	assert.equal(asset.src, '-- rom source');
	assert.equal(storage.getItem(buildWorkspaceStorageKey('offline-cart', dirtyPath)), null);
	assert.equal(workspaceFileCache.get(dirtyPath), undefined);
	assert.equal(workspaceFileCache.get('src/foo.lua'), undefined);
});

test('active source capture only trusts the editor buffer while the code tab is foregrounded', () => {
	const context = installCodeContext('src/foo.lua', '-- tab buffer');
	codeTabSessionState.activeContextId = context.id;
	editorDocumentState.buffer = new PieceTreeBuffer('-- editor buffer');
	tabSessionState.activeTabId = context.id;

	assert.equal(captureContextText(context), '-- editor buffer');
	assert.equal(captureActiveCodeTabSource(), '-- editor buffer');

	tabSessionState.activeTabId = 'resource:other';
	assert.equal(captureContextText(context), '-- tab buffer');
	assert.equal(captureActiveCodeTabSource(), '-- tab buffer');
});

test('runtime source capture detects changed code when editor epochs collide', (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const context = installCodeContext('src/foo.lua', '-- revision 2');
	context.saveGeneration = 4;
	context.appliedGeneration = 4;
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entry_path: 'src/foo.lua',
		namespace: 'test',
		projectRootPath: 'offline-cart',
		can_boot_from_source: true,
		revision: 0,
	};
	registerLuaSourceRecord(registry, {
		resid: 'foo',
		type: 'lua',
		src: '-- revision 2',
		base_src: '-- revision 2',
		base_update_timestamp: 2,
		source_path: 'src/foo.lua',
		module_path: 'src.foo',
		update_timestamp: 2,
		generated: false,
	});
	const systemRegistry = { records: [], path2lua: {}, module2lua: {}, revision: 0 };
	(machineManager as any).sourceState = {
		cartridgeSlots: [{
			domain: TEST_DOMAIN,
			luaSources: registry,
			installedBlua32Sources: new Map([['src.foo', '-- revision 1']]),
		}, null],
		systemLuaSources: systemRegistry,
		activeLuaSources: registry,
		activeCartridgeSlot: TEST_DOMAIN,
		systemInstalledBlua32Sources: new Map(),
	};

	assert.deepEqual(capturePendingLuaCodeTabSources(), [{
		contextId: context.id,
		generation: 4,
		domain: TEST_DOMAIN,
		path: 'src/foo.lua',
		source: '-- revision 2',
	}]);
});

test('successful runtime update applies only captured Lua generations without touching AEM state', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const activeLua = installCodeContext('src/foo.lua', '-- saved source');
	activeLua.saveGeneration = 3;
	activeLua.appliedGeneration = 2;
	activeLua.runtimeSyncState = 'runtime_update_pending';
	const backgroundLua: CodeTabContext = {
		...activeLua,
		id: 'code:src/bar.lua',
		title: 'src/bar.lua',
		descriptor: { domain: TEST_DOMAIN, path: 'src/bar.lua', type: 'lua' },
		saveGeneration: 5,
		appliedGeneration: 4,
	};
	const aem: CodeTabContext = {
		...activeLua,
		id: 'code:audio.aem',
		title: 'audio.aem',
		descriptor: { domain: TEST_DOMAIN, path: 'audio.aem', type: 'aem' },
		mode: 'aem',
		saveGeneration: 7,
		appliedGeneration: 6,
	};
	codeTabSessionState.contexts.set(backgroundLua.id, backgroundLua);
	codeTabSessionState.contexts.set(aem.id, aem);
	tabSessionState.tabs.push(
		{ id: backgroundLua.id, kind: 'code_editor', title: backgroundLua.title, closable: true, dirty: false, runtimeSyncState: 'runtime_update_pending' },
		{ id: aem.id, kind: 'code_editor', title: aem.title, closable: true, dirty: false, runtimeSyncState: 'runtime_update_pending' },
	);
	codeTabSessionState.activeContextId = activeLua.id;
	editorDocumentState.appliedGeneration = 2;

	const appliedSnapshots = [
		{ contextId: activeLua.id, generation: 3, domain: TEST_DOMAIN, path: activeLua.descriptor.path, source: '-- saved source' },
		{ contextId: backgroundLua.id, generation: 5, domain: TEST_DOMAIN, path: backgroundLua.descriptor.path, source: '-- saved source' },
	];
	backgroundLua.saveGeneration = 6;
	markLuaCodeTabsAppliedToRuntime(appliedSnapshots);

	assert.equal(activeLua.appliedGeneration, 3);
	assert.equal(activeLua.runtimeSyncState, 'synced');
	assert.equal(backgroundLua.appliedGeneration, 5);
	assert.equal(backgroundLua.runtimeSyncState, 'runtime_update_pending');
	assert.equal(aem.appliedGeneration, 6);
	assert.equal(aem.runtimeSyncState, 'runtime_update_pending');
	assert.equal(tabSessionState.tabs[0].runtimeSyncState, 'synced');
	assert.equal(tabSessionState.tabs[1].runtimeSyncState, 'runtime_update_pending');
	assert.equal(tabSessionState.tabs[2].runtimeSyncState, 'runtime_update_pending');
	assert.equal(editorDocumentState.appliedGeneration, 3);
});

test('explicit lua save promotes canonical source and removes dirty entry', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const systemRegistry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entry_path: 'bios/bootrom.lua',
		namespace: 'system',
		projectRootPath: 'machine/ts',
		can_boot_from_source: true,
		revision: 0,
	};
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entry_path: 'src/foo.lua',
		namespace: 'test',
		projectRootPath: 'offline-cart',
		can_boot_from_source: true,
		revision: 0,
	};
	const asset = {
		resid: 'foo',
		type: 'lua' as const,
		src: '-- old source',
		base_src: '-- rom source',
		base_update_timestamp: 1,
		source_path: 'src/foo.lua',
		module_path: 'src.foo',
		update_timestamp: 1,
	};
	registerLuaSourceRecord(registry, asset);
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	storage.setItem(buildWorkspaceStorageKey('offline-cart', dirtyPath), JSON.stringify({
		contents: '-- dirty source',
		updatedAt: 2,
	}));
	workspaceFileCache.set(dirtyPath, '-- dirty source');
	const requests: Array<{ method: string; path: string }> = [];
	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const rawUrl = String(input);
		const request = new Request(rawUrl.startsWith('http') ? rawUrl : `http://workspace.local${rawUrl}`, init);
		const path = request.method === 'POST'
			? JSON.parse(await request.text()).path
			: new URL(request.url, 'http://workspace.local').searchParams.get('path')!;
		requests.push({ method: request.method, path });
		return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
	};
	(machineManager as any).sourceState = {
		cartridgeSlots: [{ domain: TEST_DOMAIN, luaSources: registry }, null],
		systemLuaSources: systemRegistry,
		activeLuaSources: registry,
		activeCartridgeSlot: TEST_DOMAIN,
		systemProjectRootPath: 'machine/ts',
		systemBlua32MediaDirty: false,
		cartridgeBlua32MediaDirty: [false, false],
	};

	await saveLuaResourceSource({ domain: TEST_DOMAIN, path: 'src/foo.lua' }, '-- saved source');

	assert.equal(asset.src, '-- saved source');
	assert.equal(asset.base_src, '-- saved source');
	assert.equal(asset.base_update_timestamp, 42);
	assert.equal(asset.update_timestamp, 42);
	assert.equal(JSON.parse(storage.getItem(buildWorkspaceStorageKey('offline-cart', 'src/foo.lua'))).contents, '-- saved source');
	assert.equal(storage.getItem(buildWorkspaceStorageKey('offline-cart', dirtyPath)), null);
	assert.equal(workspaceFileCache.get(dirtyPath), undefined);
	assert.equal(workspaceFileCache.get('src/foo.lua'), '-- saved source');
	assert.equal((machineManager as any).sourceState.systemBlua32MediaDirty, false);
	assert.equal((machineManager as any).sourceState.cartridgeBlua32MediaDirty[0], true);
	await applyWorkspaceOverridesToRegistry({
		registry,
		storage,
		includeServer: false,
		projectRootPath: 'offline-cart',
	});
	assert.equal(asset.src, '-- saved source');
	assert.deepEqual(requests, [
		{ method: 'POST', path: 'src/foo.lua' },
		{ method: 'DELETE', path: dirtyPath },
	]);
});
