import './test_setup';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { CodeTabContext } from '../../ide/workbench/ui/code_tab/model';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import {
	SYSTEM_RESOURCE_DOMAIN,
	resourceIdentityKey,
	type ResourceDomain,
	type RuntimeResource,
} from '../../ide/common/resource';
import type { RuntimeBreakpointState } from '../../ide/runtime/debugger_state';
import type { KeyValueStorage } from '../../ide/workspace/key_value_storage';
import type { TimerHandle } from '../../hosts/common/clock';
import { getTextSnapshot } from '../../ide/editor/text/source_text';
import {
	clearWorkspaceSourceCaches,
	setWorkspaceLuaSourceOverride,
	workspaceCanonicalSourceCache,
} from '../../ide/workspace/cache';
import {
	applyWorkspaceSourceOverrides,
	buildWorkspaceDirtyEntryPath,
	buildWorkspaceDirtyRecordPath,
	loadWorkspaceSourceFile,
} from '../../ide/workspace/files';
import {
	WORKSPACE_METADATA_DIR,
	WORKSPACE_MARKER_FILE,
	WORKSPACE_STATE_FILE,
	buildWorkspaceStorageKey,
	closeWorkspaceRecords,
	readLocalWorkspaceRecord,
	readWorkspaceRecord,
	reconnectWorkspaceRecords,
	workspaceRecordState,
	writeLocalWorkspaceRecord,
	writeWorkspaceRecord,
	type WorkspaceRecord,
} from '../../ide/workspace/records';
import { joinWorkspacePaths, resolveWorkspacePath } from '../../ide/workspace/path';
import {
	buildCodeTabId,
	createCodeEditorInput,
	findCodeTabContext,
	registerCodeTabContext,
} from '../../ide/workbench/ui/code_tab/contexts';
import { codeEditorInputManager } from '../../ide/workbench/ui/code_tab/input_manager';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import {
	applyWorkspaceAutosavePayload,
	hydrateDirtyFiles,
} from '../../ide/workbench/workspace/restore';
import {
	cancelWorkspaceAutosave,
	initializeWorkspaceStorage,
	persistWorkspaceSessionLocally,
	requestWorkspaceAutosave,
	restoreWorkspaceStorageSession,
	runWorkspaceAutosaveTick,
	shutdownWorkspaceStorage,
} from '../../ide/workbench/workspace/storage';
import {
	workspaceDirtyRecords,
	workspaceState,
} from '../../ide/workbench/workspace/state';
import {
	capturePendingLuaTextModelSources,
	captureCurrentLuaSource,
	markLuaTextModelsAppliedToRuntime,
	type LuaTextModelSourceSnapshot,
} from '../../ide/workbench/ui/code_tab/activation';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { DEFAULT_FONT_VARIANT } from '../../machine/ts/render/shared/bmsx_font';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import {
	applyAllWorkspaceSourceOverrides,
	saveLuaResourceSource,
} from '../../ide/workspace/workspace';
import {
	resolveRuntimeLuaSource,
	resolveRuntimeResource,
} from '../../ide/runtime/sources';
import {
	getOrCreateSemanticProject,
	resetSemanticProjects,
} from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import {
	WorkspaceAutosaveChange,
	type WorkspaceAutosavePayload,
} from '../../ide/workbench/workspace/models';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';
import { createResourceEditorResolver } from '../../ide/workbench/contrib/resources/editor_contributions';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
import { ResourceEditorResolver } from '../../ide/workbench/services/editor/resource_editor_resolver';
import { createTestEditorPanes } from '../helpers/editor_panes';

class MockStorage implements KeyValueStorage {
	private readonly store = new Map<string, string>();
	public failWriteKey: string = null;
	public failWritePrefix: string = null;

	getItem(key: string): string {
		return this.store.has(key) ? this.store.get(key)! : null;
	}

	setItem(key: string, value: string): void {
		if (key === this.failWriteKey || (this.failWritePrefix && key.startsWith(this.failWritePrefix))) {
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

type ScheduledCallback = {
	active: boolean;
	callback: (timestampMs: number) => void;
};

class MockClock {
	private timestamp = 42;
	public readonly scheduled: ScheduledCallback[] = [];

	public constructor(private readonly fixedDate = false) {}

	now(): number { return 0; }
	dateNow(): number {
		const timestamp = this.timestamp;
		if (!this.fixedDate) {
			this.timestamp += 1;
		}
		return timestamp;
	}

	scheduleOnce(_delayMs: number, callback: (timestampMs: number) => void): TimerHandle {
		const scheduled = { active: true, callback };
		this.scheduled.push(scheduled);
		return {
			cancel(): void { scheduled.active = false; },
			isActive(): boolean { return scheduled.active; },
		};
	}

	get activeCount(): number {
		let count = 0;
		for (const scheduled of this.scheduled) {
			if (scheduled.active) count += 1;
		}
		return count;
	}
}

function createWorkspaceEnvironment(
	storage: MockStorage,
	clock = new MockClock(),
) {
	return {
		storage,
		clock: {
			now: () => clock.now(),
			dateNow: () => clock.dateNow(),
			scheduleOnce: (delayMs: number, callback: (timestampMs: number) => void) => clock.scheduleOnce(delayMs, callback),
		},
	} as const;
}

type WorkspaceRequest = { method: string; path: string };

class MockWorkspaceServer {
	public readonly files = new Map<string, WorkspaceRecord>();
	public readonly requests: WorkspaceRequest[] = [];
	private readonly failures = new Map<string, number>();
	private readonly blockedReads = new Map<string, Promise<void>>();
	private readonly blockedWrites = new Map<string, Promise<void>>();

	fail(method: string, path: string, count = 1): void {
		this.failures.set(`${method}:${path}`, count);
	}

	blockWrite(path: string, blocked: Promise<void>): void {
		this.blockedWrites.set(path, blocked);
	}

	blockRead(path: string, blocked: Promise<void>): void {
		this.blockedReads.set(path, blocked);
	}

	async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		const method = init?.method || 'GET';
		const url = new URL(String(input), 'http://workspace.local');
		let path = url.searchParams.get('path');
		let record: WorkspaceRecord = null;
		if (method === 'PUT') {
			const payload = JSON.parse(String(init!.body)) as WorkspaceRecord & { path: string };
			path = payload.path;
			record = { contents: payload.contents, updatedAt: payload.updatedAt };
		}
		this.requests.push({ method, path: path! });
			const failureKey = `${method}:${path}`;
			let configuredFailureKey = failureKey;
			let remainingFailures = this.failures.get(failureKey) || 0;
			if (remainingFailures === 0) {
				for (const [candidateKey, candidateFailures] of this.failures) {
					if (failureKey.startsWith(`${candidateKey}.`)) {
						configuredFailureKey = candidateKey;
						remainingFailures = candidateFailures;
						break;
					}
				}
			}
			if (remainingFailures > 0) {
				this.failures.set(configuredFailureKey, remainingFailures - 1);
			return new Response('forced failure', { status: 500 });
			}
			if (method === 'GET') {
				const blocked = this.blockedReads.get(path!);
				if (blocked) await blocked;
				const file = this.files.get(path!);
			return file
				? new Response(JSON.stringify(file), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				})
				: new Response(null, { status: 404 });
		}
			if (method === 'PUT') {
				let blocked = this.blockedWrites.get(path!);
				if (!blocked) {
					for (const [candidatePath, candidateBlock] of this.blockedWrites) {
						if (path!.startsWith(`${candidatePath}.`)) {
							blocked = candidateBlock;
							break;
						}
					}
				}
			if (blocked) await blocked;
			this.files.set(path!, record!);
			return new Response(null, { status: 204 });
		}
		if (method === 'DELETE') {
			this.files.delete(path!);
			return new Response(null, { status: 204 });
		}
		throw new Error(`Unexpected workspace request method '${method}'.`);
	}
}

const ORIGINAL_FETCH = globalThis.fetch;
const TEST_DOMAIN = 0;
let workspaceEnvironment = createWorkspaceEnvironment(new MockStorage());

function installOfflineWorkspace(t: TestContext, storage: MockStorage, clock = new MockClock()): MockClock {
	workspaceEnvironment = createWorkspaceEnvironment(storage, clock);
	globalThis.fetch = async () => { throw new Error('offline'); };
	t.after(() => resetEnvironment(storage));
	return clock;
}

function installWorkspaceServer(
	t: TestContext,
	storage: MockStorage,
	clock = new MockClock(),
): { clock: MockClock; server: MockWorkspaceServer } {
	const server = new MockWorkspaceServer();
	workspaceEnvironment = createWorkspaceEnvironment(storage, clock);
	globalThis.fetch = (input, init) => server.fetch(input, init);
	t.after(() => resetEnvironment(storage));
	return { clock, server };
}

async function resetEnvironment(storage: MockStorage): Promise<void> {
	await shutdownWorkspaceStorage();
	storage.clear();
	clearWorkspaceSourceCaches();
	editorTabGroup.clear();
	codeEditorInputManager.clear();
	editorTextModelService.clear();
	globalThis.fetch = ORIGINAL_FETCH;
}

function installWorkspaceRestoreView(): void {
	configureFontVariant(workspaceEnvironment.clock, DEFAULT_FONT_VARIANT, null);
}

function testResource(
	path: string,
	domain: ResourceDomain = TEST_DOMAIN,
	type: RuntimeResource['source']['type'] = 'lua',
): RuntimeResource {
	return {
		domain,
		path,
		source: {
			resid: path,
			type,
			source_path: path,
			generated: false,
		},
	};
}

function installCodeContext(path: string, source: string, domain: ResourceDomain = TEST_DOMAIN): CodeTabContext {
	const resource = testResource(path, domain);
	const model = editorTextModelService.retain(resource, 'lua', '');
	model.restoreDirtySource(source);
	const context: CodeTabContext = {
		id: buildCodeTabId(resource),
		title: path,
		model,
		view: createCodeEditorViewState(),
		runtimeErrorOverlay: null,
		executionStopRow: null,
	};
	registerCodeTabContext(context);
	return context;
}

function sourceRegistry(
	source: string,
	projectRootPath = 'offline-cart',
	sourcePath = 'entry.lua',
): LuaSourceRegistry {
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entrySourcePath: sourcePath,
		projectRootPath,
		can_boot_from_source: true,
		revision: 0,
	};
	registerLuaSourceRecord(registry, {
		resid: 'entry',
		type: 'lua',
		src: source,
		base_src: source,
		base_update_timestamp: 0,
		source_path: sourcePath,
		normalized_source_path: resolveWorkspacePath(sourcePath, projectRootPath),
		module_path: sourcePath.endsWith('.lua') ? sourcePath.slice(0, -4).replaceAll('/', '.') : sourcePath,
		update_timestamp: 0,
		generated: false,
		program_module: true,
	});
	return registry;
}

function workspaceStatePath(root: string): string {
	return joinWorkspacePaths(root, WORKSPACE_METADATA_DIR, WORKSPACE_STATE_FILE);
}

function writeRecord(
	storage: MockStorage,
	root: string,
	path: string,
	contents: string,
	updatedAt: number,
): void {
	writeLocalWorkspaceRecord(storage, root, path, { contents, updatedAt });
}

function payload(
	dirtyFiles: WorkspaceAutosavePayload['dirtyFiles'] = [],
	codeEditorViews: WorkspaceAutosavePayload['codeEditorViews'] = [],
): WorkspaceAutosavePayload {
	return {
		dirtyFiles,
		codeEditorViews,
		breakpoints: [],
		fontVariant: DEFAULT_FONT_VARIANT,
	};
}

function editorStub(
	storage: KeyValueStorage,
	sources: RuntimeSourceState,
	resourceEditors = createResourceEditorResolver(storage, sources),
) {
	return {
		fontVariant: DEFAULT_FONT_VARIANT,
		resourcePanel: null,
		resourceEditors,
		editorPanes: createTestEditorPanes(),
		setFontVariant() { /* noop */ },
		updateViewport() { /* noop */ },
	};
}

async function startAutosaveSession(t: TestContext, storage: MockStorage, root = 'offline-cart') {
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source', root), null],
		TEST_DOMAIN,
	);
	const restored = await initializeWorkspaceStorage(storage, workspaceEnvironment.clock, root, sources);
	await restoreWorkspaceStorageSession(
		editorStub(storage, sources) as any,
		sources,
		{ breakpoints: [new Map(), new Map(), new Map()] },
		restored,
		new Set(),
	);
	t.after(() => resetSemanticProjects());
	return sources;
}

async function flushRequestedAutosave(): Promise<void> {
	cancelWorkspaceAutosave();
	await runWorkspaceAutosaveTick();
}

test('resource identity keeps identical cartridge paths isolated by slot', (t) => {
	const slot0Sources = sourceRegistry('return "slot 0"');
	const slot1Sources = sourceRegistry('return "slot 1"');
	const sources = createTestRuntimeSourceState(
		sourceRegistry('return "system"'),
		[slot0Sources, slot1Sources],
		0,
	);
	t.after(() => {
		editorTabGroup.clear();
		codeEditorInputManager.clear();
		editorTextModelService.clear();
		resetSemanticProjects();
		clearWorkspaceSourceCaches();
	});

	assert.equal(resolveRuntimeLuaSource(sources, { domain: 0, path: 'entry.lua' })!.record.src, 'return "slot 0"');
	assert.equal(resolveRuntimeLuaSource(sources, { domain: 1, path: 'entry.lua' })!.record.src, 'return "slot 1"');
	const slot0Context = installCodeContext('entry.lua', 'return "slot 0"', 0);
	const slot1Context = installCodeContext('entry.lua', 'return "slot 1"', 1);
	assert.notEqual(slot0Context.id, slot1Context.id);
	assert.notEqual(
		buildWorkspaceDirtyEntryPath('offline-cart', 0, 'entry.lua'),
		buildWorkspaceDirtyEntryPath('offline-cart', 1, 'entry.lua'),
	);
	const slot0Project = getOrCreateSemanticProject(0);
	const slot1Project = getOrCreateSemanticProject(1);
	slot0Project.synchronizeRuntimeSources(sources);
	slot1Project.synchronizeRuntimeSources(sources);
	assert.notEqual(slot0Project, slot1Project);
	setWorkspaceLuaSourceOverride(slot0Sources, 'entry.lua', 'return "slot 0 edit"');
	slot0Project.synchronizeRuntimeSources(sources);
	assert.equal(slot0Project.getFileData('entry.lua')!.source, 'return "slot 0 edit"');
	assert.equal(slot1Project.getFileData('entry.lua')!.source, 'return "slot 1"');
});

test('workspace restore keeps dirty system tabs behind the development cartridge entry', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const systemRoot = 'machine/bios';
	const cartridgeRoot = 'offline-cart';
	const systemPath = 'system/main.lua';
	const cartridgePath = 'cart.lua';
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source', systemRoot, systemPath),
		[sourceRegistry('-- cartridge source', cartridgeRoot, cartridgePath), null],
		SYSTEM_RESOURCE_DOMAIN,
	);
	sources.cartridgeSlots[0]!.rom.header.blua32ImageOffset = 64;
	const dirtyPath = buildWorkspaceDirtyEntryPath(
		systemRoot,
		SYSTEM_RESOURCE_DOMAIN,
		systemPath,
	);
	workspaceDirtyRecords.set(dirtyPath, {
		contents: '-- dirty system source',
		updatedAt: 80,
	});
	installWorkspaceRestoreView();
	await applyWorkspaceAutosavePayload(
		editorStub(storage, sources) as any,
		sources,
		{ breakpoints: [new Map(), new Map(), new Map()] },
		payload(
			[{
				domain: SYSTEM_RESOURCE_DOMAIN,
				path: systemPath,
				updatedAt: 80,
			}],
			[{
				domain: SYSTEM_RESOURCE_DOMAIN,
				path: systemPath,
				cursorRow: 0,
				cursorColumn: 7,
				scrollRow: 0,
				scrollColumn: 3,
				selectionAnchor: { row: 0, column: 2 },
			}],
		),
	);

	const activeTab = editorTabGroup.activeTab!;
	assert.equal(activeTab.kind, 'code_editor');
	const activeContext = activeTab.kind === 'code_editor' ? activeTab.context : null;
	assert.equal(activeContext.model.resource.domain, 0);
	assert.equal(activeContext.model.resource.path, cartridgePath);
	assert.equal(activeTab.id, activeContext.id);
	const systemContext = findCodeTabContext({
		domain: SYSTEM_RESOURCE_DOMAIN,
		path: systemPath,
	})!;
	assert.equal(systemContext.model.dirty, true);
	assert.equal(getTextSnapshot(systemContext.model.buffer), '-- dirty system source');
	assert.equal(systemContext.view.cursorColumn, 7);
	assert.equal(systemContext.view.scrollColumn, 3);
	assert.deepEqual(systemContext.view.selectionAnchor, { row: 0, column: 2 });
	assert.equal(editorTabGroup.tabs.some(tab => tab.id === systemContext.id), true);
});

test('canonical source cache keys identical resource paths by physical project path', async (t) => {
	assert.equal(resolveWorkspacePath('src/entry.lua', 'cart0'), 'cart0/src/entry.lua');
	workspaceCanonicalSourceCache.set('cart0/entry.lua', 'return "slot 0"');
	const requestedPaths: string[] = [];
	globalThis.fetch = async (input: RequestInfo | URL) => {
		const url = new URL(String(input), 'http://workspace.local');
		requestedPaths.push(url.searchParams.get('path')!);
		return new Response(JSON.stringify({ contents: 'return "slot 1"', updatedAt: 1 }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	};
	workspaceRecordState.connected = true;
	t.after(() => {
		closeWorkspaceRecords();
		globalThis.fetch = ORIGINAL_FETCH;
		clearWorkspaceSourceCaches();
	});
	workspaceEnvironment = createWorkspaceEnvironment(new MockStorage());

	assert.equal(await loadWorkspaceSourceFile(workspaceEnvironment.storage, 'cart1/entry.lua', 'cart1'), 'return "slot 1"');
	assert.deepEqual(requestedPaths, ['cart1/entry.lua']);
});

test('remote record transport serializes operations for one resource', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source'), null],
		TEST_DOMAIN,
	);
	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources);
	const path = 'offline-cart/src/foo.lua';
	let releaseWrite: () => void;
	const blocked = new Promise<void>(resolve => { releaseWrite = resolve; });
	server.blockWrite(path, blocked);

	const firstWrite = writeWorkspaceRecord(
		storage,
		'offline-cart',
		path,
		{ contents: '-- A', updatedAt: 1000 },
	);
	await Promise.resolve();
	const secondWrite = writeWorkspaceRecord(
		storage,
		'offline-cart',
		path,
		{ contents: '-- B', updatedAt: 1001 },
	);
	await Promise.resolve();
	assert.equal(
		server.requests.filter(request => request.method === 'PUT' && request.path === path).length,
		1,
	);
	releaseWrite!();
	await Promise.all([firstWrite, secondWrite]);
	assert.deepEqual(server.files.get(path), { contents: '-- B', updatedAt: 1001 });
});

test('remote read convergence cannot overwrite a newer local write', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source'), null],
		TEST_DOMAIN,
	);
	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources);
	const path = 'offline-cart/src/foo.lua';
	writeLocalWorkspaceRecord(
		storage,
		'offline-cart',
		path,
		{ contents: '-- A', updatedAt: 1000 },
	);
	server.files.set(path, { contents: '-- B', updatedAt: 1001 });
	let releaseRead: () => void;
	const blocked = new Promise<void>(resolve => { releaseRead = resolve; });
	server.blockRead(path, blocked);

	const read = readWorkspaceRecord(storage, 'offline-cart', path);
	while (!server.requests.some(request => request.method === 'GET' && request.path === path)) {
		await Promise.resolve();
	}
	const write = writeWorkspaceRecord(
		storage,
		'offline-cart',
		path,
		{ contents: '-- C', updatedAt: 1002 },
	);
	releaseRead!();
	assert.deepEqual(await read, { contents: '-- C', updatedAt: 1002 });
	await write;
	assert.deepEqual(
		readLocalWorkspaceRecord(storage, 'offline-cart', path),
		{ contents: '-- C', updatedAt: 1002 },
	);
	assert.deepEqual(server.files.get(path), { contents: '-- C', updatedAt: 1002 });
});

test('reconnect drains a pending record replaced during its active PUT', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const path = 'offline-cart/src/foo.lua';
	closeWorkspaceRecords();
	await writeWorkspaceRecord(
		storage,
		'offline-cart',
		path,
		{ contents: '-- A', updatedAt: 1000 },
	);
	let releaseWrite: () => void;
	const blocked = new Promise<void>(resolve => { releaseWrite = resolve; });
	server.blockWrite(path, blocked);
	const reconnect = reconnectWorkspaceRecords(workspaceEnvironment.clock, 'offline-cart');
	while (!server.requests.some(request => request.method === 'PUT' && request.path === path)) {
		await Promise.resolve();
	}
	await writeWorkspaceRecord(
		storage,
		'offline-cart',
		path,
		{ contents: '-- B', updatedAt: 1001 },
	);
	releaseWrite!();
	await reconnect;
	assert.equal(workspaceRecordState.connected, true);
	assert.equal(
		server.requests.filter(request => request.method === 'PUT' && request.path === path).length,
		2,
	);
	assert.deepEqual(server.files.get(path), { contents: '-- B', updatedAt: 1001 });
});

test('reconnect keeps a newer remote record over stale pending local work', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const path = 'offline-cart/src/foo.lua';
	closeWorkspaceRecords();
	await writeWorkspaceRecord(
		storage,
		'offline-cart',
		path,
		{ contents: '-- stale local', updatedAt: 1000 },
	);
	server.files.set(path, { contents: '-- newer remote', updatedAt: 1001 });

	await reconnectWorkspaceRecords(workspaceEnvironment.clock, 'offline-cart');

	assert.equal(workspaceRecordState.connected, true);
	assert.deepEqual(
		readLocalWorkspaceRecord(storage, 'offline-cart', path),
		{ contents: '-- newer remote', updatedAt: 1001 },
	);
	assert.deepEqual(server.files.get(path), { contents: '-- newer remote', updatedAt: 1001 });
	assert.deepEqual(
		server.requests.filter(request => request.path === path),
		[{ method: 'GET', path }],
	);
});

test('required local workspace storage remains authoritative while remote is offline', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const session = payload();
	writeRecord(storage, 'offline-cart', workspaceStatePath('offline-cart'), JSON.stringify(session), 30);
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source'), null],
		TEST_DOMAIN,
	);

	const restored = await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources);
	assert.deepEqual(restored, session);
	const markerPath = joinWorkspacePaths('offline-cart', WORKSPACE_METADATA_DIR, WORKSPACE_MARKER_FILE);
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', markerPath)!.contents, '');
	assert.equal(workspaceRecordState.connected, false);
});

test('workspace records own their local namespace and session path', () => {
	assert.equal(
		buildWorkspaceStorageKey('cart', 'cart/.bmsx/workspace.json'),
		'bmsx.workspace.records:cart:cart/.bmsx/workspace.json',
	);
	assert.equal(WORKSPACE_STATE_FILE, 'session.json');
});

test('workspace state selects the newest exact local or remote record', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const statePath = workspaceStatePath('offline-cart');
	const localPayload = payload();
	localPayload.fontVariant = 'msx';
	writeRecord(storage, 'offline-cart', statePath, JSON.stringify(localPayload), 30);
	server.files.set(statePath, { contents: JSON.stringify(payload()), updatedAt: 20 });
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source'), null],
		TEST_DOMAIN,
	);

	assert.deepEqual(await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources), localPayload);
	assert.equal(workspaceState.remoteRevision, -1);
	await shutdownWorkspaceStorage();

	writeRecord(storage, 'offline-cart', statePath, JSON.stringify(payload()), 20);
	const remotePayload = payload();
	remotePayload.fontVariant = 'msx';
	server.files.set(statePath, { contents: JSON.stringify(remotePayload), updatedAt: 40 });
	assert.deepEqual(await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources), remotePayload);
	assert.deepEqual(
		JSON.parse(readLocalWorkspaceRecord(storage, 'offline-cart', statePath)!.contents),
		remotePayload,
	);
});

test('remote manifest adoption publishes after referenced records and releases the replaced local generation', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'entry.lua');
	const localPayload = payload([{
		domain: TEST_DOMAIN,
		path: 'entry.lua',
		updatedAt: 10,
	}]);
	const remotePayload = payload([{
		...localPayload.dirtyFiles[0],
		updatedAt: 30,
	}]);
	const statePath = workspaceStatePath('offline-cart');
	const localStateRecord = { contents: JSON.stringify(localPayload), updatedAt: 20 };
	writeLocalWorkspaceRecord(
		storage,
		'offline-cart',
		buildWorkspaceDirtyRecordPath(dirtyPath, 10),
		{ contents: '-- local dirty', updatedAt: 10 },
	);
	writeLocalWorkspaceRecord(storage, 'offline-cart', statePath, localStateRecord);
	server.files.set(statePath, { contents: JSON.stringify(remotePayload), updatedAt: 40 });
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source'), null],
		TEST_DOMAIN,
	);

	await assert.rejects(
		() => initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources),
		/Persisted dirty file .* does not match the workspace session/,
	);
	assert.deepEqual(
		readLocalWorkspaceRecord(storage, 'offline-cart', statePath),
		localStateRecord,
	);
	assert.equal(
		readLocalWorkspaceRecord(
			storage,
			'offline-cart',
			buildWorkspaceDirtyRecordPath(dirtyPath, 10),
		)!.contents,
		'-- local dirty',
	);

	const remoteDirtyPath = buildWorkspaceDirtyRecordPath(dirtyPath, 30);
	server.files.set(remoteDirtyPath, { contents: '-- remote dirty', updatedAt: 30 });
	assert.deepEqual(
		await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources),
		remotePayload,
	);
	assert.equal(
		readLocalWorkspaceRecord(
			storage,
			'offline-cart',
			buildWorkspaceDirtyRecordPath(dirtyPath, 10),
		),
		null,
	);
	assert.equal(
		readLocalWorkspaceRecord(storage, 'offline-cart', remoteDirtyPath)!.contents,
		'-- remote dirty',
	);
});

test('malformed BMSX-owned workspace records reject without deletion', () => {
	const storage = new MockStorage();
	const key = buildWorkspaceStorageKey('offline-cart', 'src/foo.lua');
	storage.setItem(key, '{broken');
	assert.throws(() => readLocalWorkspaceRecord(storage, 'offline-cart', 'src/foo.lua'));
	assert.equal(storage.getItem(key), '{broken');
});

test('raw session JSON under a workspace record key rejects without legacy interpretation', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const statePath = workspaceStatePath('offline-cart');
	const key = buildWorkspaceStorageKey('offline-cart', statePath);
	storage.setItem(key, JSON.stringify(payload()));
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source'), null],
		TEST_DOMAIN,
	);
	await assert.rejects(() => initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources));
	assert.notEqual(storage.getItem(key), null);
});

test('cold boot uses one manifest-indexed dirty snapshot for source arbitration and editor hydration', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'entry.lua');
	const session = payload([{
		domain: TEST_DOMAIN,
		path: 'entry.lua',
		updatedAt: 80,
	}]);
	writeRecord(
		storage,
		'offline-cart',
		buildWorkspaceDirtyRecordPath(dirtyPath, 80),
		'-- dirty edit',
		80,
	);
	writeRecord(storage, 'offline-cart', workspaceStatePath('offline-cart'), JSON.stringify(session), 90);
	const registry = sourceRegistry('-- rom source');
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[registry, null],
		TEST_DOMAIN,
	);

	const restored = await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources);
	const rejected = await applyAllWorkspaceSourceOverrides(workspaceEnvironment.storage, sources, workspaceDirtyRecords);
	assert.equal(registry.records[0].src, '-- dirty edit');
	assert.equal(rejected.size, 0);

	installWorkspaceRestoreView();
	await restoreWorkspaceStorageSession(
		editorStub(storage, sources) as any,
		sources,
		{ breakpoints: [new Map(), new Map(), new Map()] },
		restored,
		rejected,
	);
	const context = findCodeTabContext({ domain: TEST_DOMAIN, path: 'entry.lua' })!;
	assert.equal(getTextSnapshot(context.model.buffer), '-- dirty edit');
	assert.equal(context.model.dirty, true);
});

test('manifest dirty timestamp rejects an uncommitted record generation', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'entry.lua');
	const session = payload([{
		domain: TEST_DOMAIN,
		path: 'entry.lua',
		updatedAt: 80,
	}]);
	const uncommittedPath = buildWorkspaceDirtyRecordPath(dirtyPath, 81);
	writeRecord(storage, 'offline-cart', uncommittedPath, '-- uncommitted edit', 81);
	writeRecord(storage, 'offline-cart', workspaceStatePath('offline-cart'), JSON.stringify(session), 90);
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- rom source'), null],
		TEST_DOMAIN,
	);

	await assert.rejects(
		() => initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources),
		/Persisted dirty file .* does not match the workspace session/,
	);
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', uncommittedPath)!.updatedAt, 81);
});

test('manifest dirty entry rejected by newer ROM is not hydrated', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const registry = sourceRegistry('-- newer rom source');
	registry.records[0].base_update_timestamp = 100;
	registry.records[0].update_timestamp = 100;
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[registry, null],
		TEST_DOMAIN,
	);
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'entry.lua');
	const session = payload([{
		domain: TEST_DOMAIN,
		path: 'entry.lua',
		updatedAt: 50,
	}]);
	const dirtyRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, 50);
	writeRecord(storage, 'offline-cart', dirtyRecordPath, '-- stale dirty edit', 50);
	writeRecord(storage, 'offline-cart', workspaceStatePath('offline-cart'), JSON.stringify(session), 60);

	const restored = await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources);
	const rejected = await applyAllWorkspaceSourceOverrides(workspaceEnvironment.storage, sources, workspaceDirtyRecords);
	assert.deepEqual([...rejected], [dirtyPath]);
	installWorkspaceRestoreView();
	await restoreWorkspaceStorageSession(
		editorStub(storage, sources) as any,
		sources,
		{ breakpoints: [new Map(), new Map(), new Map()] },
		restored,
		rejected,
	);
	assert.equal(registry.records[0].src, '-- newer rom source');
	assert.equal(findCodeTabContext({ domain: TEST_DOMAIN, path: 'entry.lua' })!.model.dirty, false);
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', dirtyRecordPath)!.contents, '-- stale dirty edit');
});

test('dirty records follow the physical project root owned by each resource domain', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const systemRoot = 'system-root';
	const slot0Root = 'cart0-root';
	const slot1Root = 'cart1-root';
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source', systemRoot),
		[sourceRegistry('-- slot 0 source', slot0Root), sourceRegistry('-- slot 1 source', slot1Root)],
		TEST_DOMAIN,
	);
	const entries = [
		{ domain: -1 as ResourceDomain, path: 'entry.lua', root: systemRoot, source: '-- system edit' },
		{ domain: 0 as ResourceDomain, path: 'entry.lua', root: slot0Root, source: '-- slot 0 edit' },
		{ domain: 1 as ResourceDomain, path: 'entry.lua', root: slot1Root, source: '-- slot 1 edit' },
	];
	const session = payload(entries.map((entry, index) => ({
		domain: entry.domain,
		path: entry.path,
		updatedAt: 70 + index,
	})));
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		writeRecord(
			storage,
			entry.root,
			buildWorkspaceDirtyRecordPath(
				buildWorkspaceDirtyEntryPath(entry.root, entry.domain, entry.path),
				70 + index,
			),
			entry.source,
			70 + index,
		);
	}
	writeRecord(storage, slot0Root, workspaceStatePath(slot0Root), JSON.stringify(session), 90);

	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, slot0Root, sources);
	assert.equal(workspaceDirtyRecords.size, 3);
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const dirtyPath = buildWorkspaceDirtyEntryPath(entry.root, entry.domain, entry.path);
		const dirtyRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, 70 + index);
		assert.equal(readLocalWorkspaceRecord(storage, entry.root, dirtyRecordPath)!.contents, entry.source);
		if (entry.root !== slot0Root) {
			assert.equal(readLocalWorkspaceRecord(storage, slot0Root, dirtyRecordPath), null);
		}
	}
});

test('idle workspace has no periodic autosave callback or materialization work', async (t) => {
	const storage = new MockStorage();
	const { clock, server } = installWorkspaceServer(t, storage);
	await startAutosaveSession(t, storage);
	const requestCount = server.requests.length;
	assert.equal(clock.activeCount, 0);
	assert.equal(runWorkspaceAutosaveTick(), undefined);
	assert.equal(server.requests.length, requestCount);
	assert.equal(clock.activeCount, 0);
});

test('cursor-only autosave reuses retained dirty content and background metadata', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	await startAutosaveSession(t, storage);
	const activeContext = installCodeContext('src/foo.lua', '-- dirty foreground');
	const backgroundContext = installCodeContext('src/bar.lua', '-- dirty background');
	const activeTab = createCodeEditorInput(activeContext);
	const backgroundTab = createCodeEditorInput(backgroundContext);
	editorTabGroup.initialize(activeTab);
	editorTabGroup.add(backgroundTab);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	const firstGeneration = workspaceState.localGeneration!;
	const activeIndex = firstGeneration.payload.codeEditorViews.findIndex(entry =>
		entry.domain === activeContext.model.resource.domain && entry.path === activeContext.model.resource.path);
	const backgroundIndex = firstGeneration.payload.codeEditorViews.findIndex(entry =>
		entry.domain === backgroundContext.model.resource.domain && entry.path === backgroundContext.model.resource.path);
	const dirtyPutCount = server.requests.filter(request =>
		request.method === 'PUT' && request.path.includes('/.bmsx/dirty/')).length;

	activeContext.view.cursorColumn = 1;
	requestWorkspaceAutosave(WorkspaceAutosaveChange.ActiveEditor);
	editorTabGroup.activate(backgroundTab);
	await flushRequestedAutosave();
	const secondGeneration = workspaceState.localGeneration!;
	assert.strictEqual(secondGeneration.dirtyRecords, firstGeneration.dirtyRecords);
	assert.strictEqual(secondGeneration.payload.dirtyFiles, firstGeneration.payload.dirtyFiles);
	assert.strictEqual(secondGeneration.payload.breakpoints, firstGeneration.payload.breakpoints);
	assert.notStrictEqual(
		secondGeneration.payload.codeEditorViews[activeIndex],
		firstGeneration.payload.codeEditorViews[activeIndex],
	);
	assert.equal(secondGeneration.payload.codeEditorViews[activeIndex].cursorColumn, 1);
	assert.strictEqual(
		secondGeneration.payload.codeEditorViews[backgroundIndex],
		firstGeneration.payload.codeEditorViews[backgroundIndex],
	);
	assert.equal(
		server.requests.filter(request =>
			request.method === 'PUT' && request.path.includes('/.bmsx/dirty/')).length,
		dirtyPutCount,
	);
});

test('record generation stays unique when the host clock does not advance', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage, new MockClock(true));
	await startAutosaveSession(t, storage);
	const context = installCodeContext('src/foo.lua', '-- dirty A');
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	const firstTimestamp = workspaceDirtyRecords.get(dirtyPath)!.updatedAt;
	const firstRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, firstTimestamp);

	context.model.pushEditOperations([{
		offset: 0,
		deleteLength: context.model.buffer.length,
		text: '-- dirty B',
	}]);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	const secondTimestamp = workspaceDirtyRecords.get(dirtyPath)!.updatedAt;
	const secondRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, secondTimestamp);
	assert.equal(server.files.get(secondRecordPath)!.contents, '-- dirty B');
	assert.ok(secondTimestamp > firstTimestamp);
	assert.equal(server.files.has(firstRecordPath), false);
});

test('local dirty write failure does not advance retained records or local revision', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const sources = await startAutosaveSession(t, storage);
	installCodeContext('src/foo.lua', '-- dirty edit');
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	storage.failWritePrefix = buildWorkspaceStorageKey('offline-cart', dirtyPath);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	cancelWorkspaceAutosave();
	assert.throws(() => runWorkspaceAutosaveTick(), /write failed/);
	assert.equal(workspaceDirtyRecords.has(dirtyPath), false);
	assert.notEqual(workspaceState.requestedRevision, workspaceState.localRevision);
	storage.failWritePrefix = null;
	void sources;
});

test('failed local state write preserves the previous manifest and immutable dirty generation', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	await startAutosaveSession(t, storage);
	const context = installCodeContext('src/foo.lua', '-- dirty A');
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	const statePath = workspaceStatePath('offline-cart');
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	const previousRecord = workspaceDirtyRecords.get(dirtyPath)!;
	const previousRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, previousRecord.updatedAt);
	const previousStateRecord = readLocalWorkspaceRecord(storage, 'offline-cart', statePath)!;

	context.model.pushEditOperations([{
		offset: 0,
		deleteLength: context.model.buffer.length,
		text: '-- dirty B',
	}]);
	storage.failWriteKey = buildWorkspaceStorageKey('offline-cart', statePath);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	cancelWorkspaceAutosave();
	assert.throws(() => runWorkspaceAutosaveTick(), /write failed/);
	const nextRecord = workspaceDirtyRecords.get(dirtyPath)!;
	const nextRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, nextRecord.updatedAt);
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', previousRecordPath)!.contents, '-- dirty A');
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', nextRecordPath)!.contents, '-- dirty B');
	assert.deepEqual(
		readLocalWorkspaceRecord(storage, 'offline-cart', statePath),
		previousStateRecord,
	);

	storage.failWriteKey = null;
	await runWorkspaceAutosaveTick();
	const committedPayload = JSON.parse(
		readLocalWorkspaceRecord(storage, 'offline-cart', statePath)!.contents,
	) as WorkspaceAutosavePayload;
	assert.equal(committedPayload.dirtyFiles[0].updatedAt, nextRecord.updatedAt);
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', previousRecordPath), null);
});

test('failed dirty PUT retains the local generation and converges after reconnect', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	await startAutosaveSession(t, storage);
	installCodeContext('src/foo.lua', '-- dirty edit');
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	const statePath = workspaceStatePath('offline-cart');
	server.fail('PUT', dirtyPath);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	cancelWorkspaceAutosave();
	const sync = runWorkspaceAutosaveTick() as Promise<void>;
	const dirtyRecord = workspaceDirtyRecords.get(dirtyPath)!;
	const dirtyRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, dirtyRecord.updatedAt);
	await sync;
	assert.equal(server.files.has(dirtyRecordPath), false);
	assert.equal(server.files.has(statePath), false);
	assert.equal(workspaceRecordState.connected, false);

	await reconnectWorkspaceRecords(workspaceEnvironment.clock, 'offline-cart');
	await runWorkspaceAutosaveTick();
	assert.equal(server.files.get(dirtyRecordPath)!.contents, '-- dirty edit');
	assert.deepEqual(JSON.parse(server.files.get(statePath)!.contents).dirtyFiles, [{
		domain: TEST_DOMAIN,
		path: 'src/foo.lua',
		updatedAt: server.files.get(dirtyRecordPath)!.updatedAt,
	}]);
});

test('failed state PUT leaves the previous remote generation recoverable and retries the new generation', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	await startAutosaveSession(t, storage);
	const context = installCodeContext('src/foo.lua', '-- dirty A');
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	const statePath = workspaceStatePath('offline-cart');
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	const previousRecord = workspaceDirtyRecords.get(dirtyPath)!;
	const previousRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, previousRecord.updatedAt);
	const previousStateRecord = server.files.get(statePath)!;

	context.model.pushEditOperations([{
		offset: 0,
		deleteLength: context.model.buffer.length,
		text: '-- dirty B',
	}]);
	server.fail('PUT', statePath);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	cancelWorkspaceAutosave();
	const sync = runWorkspaceAutosaveTick() as Promise<void>;
	const dirtyRecord = workspaceDirtyRecords.get(dirtyPath)!;
	const dirtyRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, dirtyRecord.updatedAt);
	await sync;
	assert.equal(server.files.get(dirtyRecordPath)!.contents, '-- dirty B');
	assert.equal(server.files.get(previousRecordPath)!.contents, '-- dirty A');
	assert.strictEqual(server.files.get(statePath), previousStateRecord);

	await reconnectWorkspaceRecords(workspaceEnvironment.clock, 'offline-cart');
	await runWorkspaceAutosaveTick();
	const remotePayload = JSON.parse(server.files.get(statePath)!.contents) as WorkspaceAutosavePayload;
	assert.equal(remotePayload.dirtyFiles[0].updatedAt, dirtyRecord.updatedAt);
	assert.equal(server.files.has(previousRecordPath), false);
});

test('remote sync publishes the exact dirty records retained with its state generation', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	await startAutosaveSession(t, storage);
	installCodeContext('src/a.lua', '-- A1');
	const contextB = installCodeContext('src/b.lua', '-- B1');
	const dirtyPathA = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/a.lua');
	const dirtyPathB = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/b.lua');
	const statePath = workspaceStatePath('offline-cart');
	let releaseWrite: () => void;
	const blocked = new Promise<void>(resolve => { releaseWrite = resolve; });
	server.blockWrite(dirtyPathA, blocked);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	cancelWorkspaceAutosave();
	const firstSync = runWorkspaceAutosaveTick() as Promise<void>;
	const firstGeneration = workspaceState.localGeneration!;
	const firstEntryA = firstGeneration.payload.dirtyFiles.find(entry => entry.path === 'src/a.lua')!;
	const firstEntryB = firstGeneration.payload.dirtyFiles.find(entry => entry.path === 'src/b.lua')!;
	const dirtyRecordPathA = buildWorkspaceDirtyRecordPath(dirtyPathA, firstEntryA.updatedAt);
	const dirtyRecordPathB = buildWorkspaceDirtyRecordPath(dirtyPathB, firstEntryB.updatedAt);
	await Promise.resolve();

	contextB.model.pushEditOperations([{
		offset: 0,
		deleteLength: contextB.model.buffer.length,
		text: '-- B2',
	}]);
	persistWorkspaceSessionLocally();
	const secondGenerationB = workspaceState.localGeneration!.payload.dirtyFiles.find(
		entry => entry.path === 'src/b.lua',
	)!;
	releaseWrite!();
	await firstSync;

	const remoteDirtyA = server.files.get(dirtyRecordPathA)!;
	const remoteDirtyB = server.files.get(dirtyRecordPathB)!;
	const remotePayload = JSON.parse(server.files.get(statePath)!.contents) as WorkspaceAutosavePayload;
	const remoteEntryA = remotePayload.dirtyFiles.find(entry => entry.path === 'src/a.lua')!;
	const remoteEntryB = remotePayload.dirtyFiles.find(entry => entry.path === 'src/b.lua')!;
	assert.equal(remoteDirtyA.contents, '-- A1');
	assert.equal(remoteDirtyB.contents, '-- B1');
	assert.equal(remoteEntryA.updatedAt, remoteDirtyA.updatedAt);
	assert.equal(remoteEntryB.updatedAt, remoteDirtyB.updatedAt);
	assert.notEqual(remoteEntryB.updatedAt, secondGenerationB.updatedAt);
});

test('failed dirty DELETE retries after reconnect and stale orphan cannot resurrect', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const sources = await startAutosaveSession(t, storage);
	const context = installCodeContext('entry.lua', '-- dirty edit');
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'entry.lua');
	const statePath = workspaceStatePath('offline-cart');
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	const dirtyRecordPath = buildWorkspaceDirtyRecordPath(
		dirtyPath,
		workspaceDirtyRecords.get(dirtyPath)!.updatedAt,
	);
	assert.equal(server.files.has(dirtyRecordPath), true);

	context.model.completeSave(context.model.createSnapshot());
	server.fail('DELETE', dirtyPath);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	cancelWorkspaceAutosave();
	await runWorkspaceAutosaveTick();
	assert.deepEqual(JSON.parse(server.files.get(statePath)!.contents).dirtyFiles, []);
	assert.equal(server.files.has(dirtyRecordPath), true);

	await reconnectWorkspaceRecords(workspaceEnvironment.clock, 'offline-cart');
	await runWorkspaceAutosaveTick();
	assert.equal(server.files.has(dirtyRecordPath), false);

	server.files.set(
		buildWorkspaceDirtyRecordPath(dirtyPath, 999),
		{ contents: '-- unreachable orphan', updatedAt: 999 },
	);
	await shutdownWorkspaceStorage();
	storage.clear();
	clearWorkspaceSourceCaches();
	const rebootedRegistry = sourceRegistry('-- rom source');
	const rebootedSources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[rebootedRegistry, null],
		TEST_DOMAIN,
	);
	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', rebootedSources);
	await applyAllWorkspaceSourceOverrides(workspaceEnvironment.storage, rebootedSources, workspaceDirtyRecords);
	assert.equal(rebootedRegistry.records[0].src, '-- rom source');
	assert.equal(workspaceDirtyRecords.size, 0);
	void sources;
});

test('workspace reconfiguration waits for the active autosave task', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const sources = await startAutosaveSession(t, storage, 'root-a');
	installCodeContext('src/foo.lua', '-- dirty edit');
	const dirtyPath = buildWorkspaceDirtyEntryPath('root-a', TEST_DOMAIN, 'src/foo.lua');
	let releaseWrite: () => void;
	const blocked = new Promise<void>(resolve => { releaseWrite = resolve; });
	server.blockWrite(dirtyPath, blocked);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	cancelWorkspaceAutosave();
	const autosave = runWorkspaceAutosaveTick() as Promise<void>;
	await Promise.resolve();
	let reconfigured = false;
	const reconfiguration = initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'root-b', sources).then(() => { reconfigured = true; });
	await Promise.resolve();
	assert.equal(reconfigured, false);
	releaseWrite!();
	await autosave;
	await reconfiguration;
	assert.equal(reconfigured, true);
});

test('workspace reconfiguration is not blocked by an old remote replica failure', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	await startAutosaveSession(t, storage, 'root-a');
	installCodeContext('src/foo.lua', '-- locally recoverable edit');
	const statePath = workspaceStatePath('root-a');
	server.fail('PUT', statePath);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	cancelWorkspaceAutosave();
	await runWorkspaceAutosaveTick();
	assert.equal(workspaceRecordState.connected, false);
	assert.notEqual(readLocalWorkspaceRecord(storage, 'root-a', statePath), null);

	const rootBSources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source', 'root-b'), null],
		TEST_DOMAIN,
	);
	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'root-b', rootBSources);
	assert.equal(workspaceState.projectRootPath, 'root-b');
});

test('workspace reconfiguration commits a pending debounced edit locally', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const sources = await startAutosaveSession(t, storage, 'root-a');
	installCodeContext('src/foo.lua', '-- pending edit');
	const dirtyPath = buildWorkspaceDirtyEntryPath('root-a', TEST_DOMAIN, 'src/foo.lua');
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);

	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'root-b', sources);
	const sessionRecord = readLocalWorkspaceRecord(storage, 'root-a', workspaceStatePath('root-a'))!;
	const sessionPayload = JSON.parse(sessionRecord.contents) as WorkspaceAutosavePayload;
	const dirtyRecord = readLocalWorkspaceRecord(
		storage,
		'root-a',
		buildWorkspaceDirtyRecordPath(dirtyPath, sessionPayload.dirtyFiles[0].updatedAt),
	)!;
	assert.equal(dirtyRecord.contents, '-- pending edit');
	assert.equal(JSON.parse(sessionRecord.contents).dirtyFiles[0].updatedAt, dirtyRecord.updatedAt);
});

test('dirty restore consumes retained snapshot content without a second transport read', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source'), null],
		TEST_DOMAIN,
	);
	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources);
	const context = installCodeContext('src/foo.lua', '-- clean source');
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	workspaceDirtyRecords.set(dirtyPath, { contents: '-- restored dirty edit', updatedAt: 1 });
	const requests = server.requests.length;
	hydrateDirtyFiles(sources, [{
		domain: TEST_DOMAIN,
		path: 'src/foo.lua',
		updatedAt: 1,
	}]);
	assert.equal(server.requests.length, requests);
	assert.equal(getTextSnapshot(context.model.buffer), '-- restored dirty edit');
	assert.equal(context.model.dirty, true);
});

test('workspace restore resolves persisted identity to the retained runtime resource', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source'), null],
		TEST_DOMAIN,
	);
	const retained = resolveRuntimeResource(sources, { domain: TEST_DOMAIN, path: 'entry.lua' })!;
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', retained.domain, retained.path);
	workspaceDirtyRecords.set(dirtyPath, { contents: '-- restored edit', updatedAt: 1 });
	installWorkspaceRestoreView();
	const debuggerState: RuntimeBreakpointState = {
		breakpoints: [
			new Map(),
			new Map(),
			new Map([['stale.lua', new Set([1])]]),
		],
	};
	const restoredPayload = payload([{
		domain: TEST_DOMAIN,
		path: retained.path,
		updatedAt: 1,
	}]);
	restoredPayload.breakpoints = [
		{ domain: SYSTEM_RESOURCE_DOMAIN, path: 'base.lua', lines: [4] },
		{ domain: TEST_DOMAIN, path: retained.path, lines: [3, 9] },
	];
	await applyWorkspaceAutosavePayload(
		editorStub(storage, sources) as any,
		sources,
		debuggerState,
		restoredPayload,
	);
	const context = findCodeTabContext(retained)!;
	assert.strictEqual(context.model.resource, retained);
	assert.equal(context.model.buffer.getText(), '-- restored edit');
	assert.deepEqual(debuggerState.breakpoints[0].get('base.lua'), new Set([4]));
	assert.deepEqual(debuggerState.breakpoints[1].get(retained.path), new Set([3, 9]));
	assert.equal(debuggerState.breakpoints[2].size, 0);
});

test('workspace recovery hydrates a dirty model retained by a non-code editor input', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source'), null],
		TEST_DOMAIN,
	);
	const resource = testResource('res/enemy_guard.bt.jsonc', TEST_DOMAIN, 'data');
	sources.resourceByIdentity.set(resourceIdentityKey(resource), resource);
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', resource.domain, resource.path);
	workspaceDirtyRecords.set(dirtyPath, { contents: '{ "version": 1 }', updatedAt: 1 });
	const resourceInput = new ResourceViewerInput({
			resource,
			lines: [],
			error: '',
			title: 'enemy_guard.bt.jsonc',
			scroll: 0,
	});
	const resourceEditors = new ResourceEditorResolver([{
		id: 'test.behaviourTree',
		selector: { kind: 'filename_suffix', suffix: '.bt.jsonc' },
		createEditorInput: (target) => {
			editorTextModelService.retain(target, 'behaviour_tree', '{ "version": 1, "root": {} }');
			editorTabGroup.add(resourceInput);
			return resourceInput;
		},
	}]);
	installWorkspaceRestoreView();
	await applyWorkspaceAutosavePayload(
		editorStub(storage, sources, resourceEditors) as any,
		sources,
		{ breakpoints: [new Map(), new Map(), new Map()] },
		payload([{
			domain: resource.domain,
			path: resource.path,
			updatedAt: 1,
		}]),
	);

	const model = editorTextModelService.get(resource)!;
	assert.equal(model.mode, 'behaviour_tree');
	assert.equal(model.buffer.getText(), '{ "version": 1 }');
	assert.equal(model.dirty, true);
	assert.equal(findCodeTabContext(resource), null);
	assert.strictEqual(editorTabGroup.findById(resourceInput.id), resourceInput);
});

test('workspace override arbitration keeps dirty and canonical namespaces separate', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const registry = sourceRegistry('-- rom source');
	const asset = registry.records[0];
	asset.base_update_timestamp = 15;
	asset.update_timestamp = 15;
	const canonicalPath = resolveWorkspacePath('entry.lua', 'offline-cart');
	writeRecord(storage, 'offline-cart', canonicalPath, '-- saved source', 25);
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'entry.lua');
	const dirtyRecords = new Map([[dirtyPath, { contents: '-- dirty source', updatedAt: 30 }]]);

	await applyWorkspaceSourceOverrides({
		dirtyRecords,
		domain: TEST_DOMAIN,
		registry,
		storage,
		projectRootPath: 'offline-cart',
	});
	assert.equal(asset.src, '-- dirty source');
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', canonicalPath)!.contents, '-- saved source');

	dirtyRecords.clear();
	await applyWorkspaceSourceOverrides({
		dirtyRecords,
		domain: TEST_DOMAIN,
		registry,
		storage,
		projectRootPath: 'offline-cart',
	});
	assert.equal(asset.src, '-- saved source');
	assert.equal(asset.base_src, '-- saved source');
	assert.equal(asset.base_update_timestamp, 25);
});

test('generated compiler sources ignore manifest dirty records', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const registry = sourceRegistry('return { source_addr = 1 }');
	const asset = registry.records[0];
	asset.generated = true;
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, asset.source_path);
	await applyWorkspaceSourceOverrides({
		dirtyRecords: new Map([[dirtyPath, { contents: 'return { source_addr = 99 }', updatedAt: 50 }]]),
		domain: TEST_DOMAIN,
		registry,
		storage,
		projectRootPath: 'offline-cart',
	});
	assert.equal(asset.src, 'return { source_addr = 1 }');
});

test('runtime source capture reads the resource model independently of the active input', (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const registry = sourceRegistry('-- packed source', 'offline-cart', 'src/foo.lua');
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[registry, null],
		TEST_DOMAIN,
	);
	const context = installCodeContext('src/foo.lua', '-- tab buffer');
	const codeTab = createCodeEditorInput(context);
	editorTabGroup.initialize(codeTab);
	assert.equal(captureCurrentLuaSource(sources, context.model.resource).source, '-- tab buffer');
	const resource = testResource('image.png', TEST_DOMAIN, 'image');
	const resourceTab = new ResourceViewerInput({
			resource,
			lines: [],
			error: '',
			title: 'image.png',
			scroll: 0,
	});
	editorTabGroup.add(resourceTab);
	editorTabGroup.activate(resourceTab);
	assert.equal(captureCurrentLuaSource(sources, context.model.resource).source, '-- tab buffer');
});

test('runtime source capture detects changed code when editor epochs collide', (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const context = installCodeContext('src/foo.lua', '-- revision 2');
	context.model.markApplied(context.model.version);
	const registry = sourceRegistry('-- revision 2', 'offline-cart', 'src/foo.lua');
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system source'), [registry, null], TEST_DOMAIN);
	sources.cartridgeSlots[TEST_DOMAIN]!.installedBlua32Sources = new Map([['src.foo', '-- revision 1']]);
	assert.deepEqual(capturePendingLuaTextModelSources(sources), [{
		version: context.model.version,
		domain: TEST_DOMAIN,
		path: 'src/foo.lua',
		source: '-- revision 2',
	}]);
});

test('runtime source capture excludes source-only Lua documents', (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	installCodeContext('tests/example_assert.lua', '-- edited test');
	const registry = sourceRegistry('-- packed test', 'offline-cart', 'tests/example_assert.lua');
	registry.records[0].program_module = false;
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[registry, null],
		TEST_DOMAIN,
	);

	assert.deepEqual(capturePendingLuaTextModelSources(sources), []);
});

test('successful runtime update applies only captured Lua model versions without touching AEM state', (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const activeLua = installCodeContext('src/foo.lua', '-- saved source');
	activeLua.model.setRuntimeSyncState('runtime_update_pending', null);
	const backgroundLua = installCodeContext('src/bar.lua', '-- saved source');
	const aemResource = testResource('audio.aem', TEST_DOMAIN, 'aem');
	const aemModel = editorTextModelService.retain(aemResource, 'aem', '');
	aemModel.restoreDirtySource('-- audio source');
	aemModel.setRuntimeSyncState('runtime_update_pending', null);
	const aem: CodeTabContext = {
		id: buildCodeTabId(aemResource),
		title: 'audio.aem',
		model: aemModel,
		view: createCodeEditorViewState(),
		runtimeErrorOverlay: null,
		executionStopRow: null,
	};
	registerCodeTabContext(aem);
	const appliedSnapshots: LuaTextModelSourceSnapshot[] = [
		{ version: activeLua.model.version, domain: TEST_DOMAIN, path: activeLua.model.resource.path, source: '-- saved source' },
		{ version: backgroundLua.model.version, domain: TEST_DOMAIN, path: backgroundLua.model.resource.path, source: '-- saved source' },
	];
	backgroundLua.model.pushEditOperations([{
		offset: backgroundLua.model.buffer.length,
		deleteLength: 0,
		text: '\n-- newer edit',
	}]);
	markLuaTextModelsAppliedToRuntime(appliedSnapshots);
	assert.equal(activeLua.model.appliedVersion, appliedSnapshots[0].version);
	assert.equal(activeLua.model.runtimeSyncState, 'synced');
	assert.equal(backgroundLua.model.appliedVersion, appliedSnapshots[1].version);
	assert.equal(backgroundLua.model.runtimeSyncState, 'runtime_update_pending');
	assert.equal(aemModel.appliedVersion, 1);
	assert.equal(aemModel.runtimeSyncState, 'runtime_update_pending');
});

test('offline canonical save remains local and replicates on reconnect', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const registry = sourceRegistry('-- old source', 'offline-cart', 'src/foo.lua');
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source', 'machine/bios'),
		[registry, null],
		TEST_DOMAIN,
	);
	await saveLuaResourceSource(
		workspaceEnvironment.storage,
		workspaceEnvironment.clock,
		sources,
		{ domain: TEST_DOMAIN, path: 'src/foo.lua' },
		'-- saved offline',
	);
	const canonicalPath = resolveWorkspacePath('src/foo.lua', 'offline-cart');
	assert.equal(canonicalPath, 'offline-cart/src/foo.lua');
	assert.equal(
		readLocalWorkspaceRecord(storage, 'offline-cart', canonicalPath)!.contents,
		'-- saved offline',
	);

	const server = new MockWorkspaceServer();
	globalThis.fetch = (input, init) => server.fetch(input, init);
	await reconnectWorkspaceRecords(workspaceEnvironment.clock, 'offline-cart');
	assert.equal(server.files.get(canonicalPath)!.contents, '-- saved offline');
});

test('source-only Lua saves without scheduling a BLua media rebuild', async (t) => {
	const storage = new MockStorage();
	installOfflineWorkspace(t, storage);
	const registry = sourceRegistry('-- packed test', 'offline-cart', 'tests/example_assert.lua');
	registry.records[0].program_module = false;
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source', 'machine/bios'),
		[registry, null],
		TEST_DOMAIN,
	);

	const programModule = await saveLuaResourceSource(
		workspaceEnvironment.storage,
		workspaceEnvironment.clock,
		sources,
		{ domain: TEST_DOMAIN, path: 'tests/example_assert.lua' },
		'-- saved test',
	);

	assert.equal(programModule, false);
	assert.equal(sources.cartridgeBlua32MediaDirty[TEST_DOMAIN], false);
	assert.equal(registry.records[0].src, '-- saved test');
});

test('explicit Lua save promotes one exact canonical record without deleting manifest recovery early', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const registry = sourceRegistry('-- old source', 'offline-cart', 'src/foo.lua');
	const systemRegistry = sourceRegistry('-- system source', 'machine/ts');
	const sources = createTestRuntimeSourceState(systemRegistry, [registry, null], TEST_DOMAIN);
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	const dirtyRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, 2);
	writeRecord(storage, 'offline-cart', dirtyRecordPath, '-- dirty source', 2);
	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources);

	await saveLuaResourceSource(workspaceEnvironment.storage, workspaceEnvironment.clock, sources, { domain: TEST_DOMAIN, path: 'src/foo.lua' }, '-- saved source');
	const canonicalPath = resolveWorkspacePath('src/foo.lua', 'offline-cart');
	assert.equal(registry.records[0].src, '-- saved source');
	assert.equal(registry.records[0].base_src, '-- saved source');
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', canonicalPath)!.contents, '-- saved source');
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', dirtyRecordPath)!.contents, '-- dirty source');
	assert.equal(server.files.get(canonicalPath)!.contents, '-- saved source');
	assert.deepEqual(server.requests.at(-1), { method: 'PUT', path: canonicalPath });
});
