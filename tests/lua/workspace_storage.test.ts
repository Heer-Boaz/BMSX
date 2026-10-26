import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { RuntimeBreakpoints } from '../../ide/runtime/breakpoints';
import { HttpWorkspaceRecordProvider } from '../../ide/browser/workspace_records';
import type { WorkspaceRecordProvider } from '../../ide/workspace/record_provider';
import { CodeEditorInputSerializer, type SerializedCodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_serializer';
import { ResourceViewerInputSerializer } from '../../ide/workbench/contrib/resources/editor_serializer';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import type { SerializedEditorInput } from '../../ide/workbench/services/editor/editor_serialization';
import './test_setup';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
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
	readWorkspaceLuaSourceText,
} from '../../ide/workspace/files';
import {
	WORKSPACE_METADATA_DIR,
	WORKSPACE_STATE_FILE,
	buildWorkspaceStorageKey,
	closeWorkspaceRecords,
	readLocalWorkspaceRecord,
	openWorkspaceRecords,
	workspaceRecords,
	writeLocalWorkspaceRecord,
	type WorkspaceRecord,
} from '../../ide/workspace/records';
import { joinWorkspacePaths, resolveWorkspacePath } from '../../ide/workspace/path';
import { ConsoleLogOutput, LogLevel } from '../../hosts/common/log';
import { RecordingLogOutput } from '../../ide/testing/recording_log_output';

const testLogOutput = new RecordingLogOutput(new ConsoleLogOutput());
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { buildCodeTabId } from '../../ide/workbench/ui/tab/id';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { editorTextModelService } from '../../ide/editor/model/model_service';
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
	captureLuaTextModelSources,
	captureCurrentLuaSource,
} from '../../ide/workbench/services/working_copy/lua_sources';
import { getTextFileRuntimeSourceStatus } from '../../ide/workbench/services/working_copy/runtime_source_status';
import { recordAemSourceApplyFailure } from '../../ide/runtime/aem';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { DEFAULT_FONT_VARIANT } from '../../machine/ts/render/shared/bmsx_font';
import { registerLuaSourceRecord, type LuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import {
	discoverWorkspaceSources,
	createTextResource,
	prepareTextResourceCreation,
	applyAllWorkspaceSourceOverrides,
	applyLuaTextModelSources,
	saveLuaResourceSource,
} from '../../ide/workspace/workspace';
import {
	resolveRuntimeLuaSource,
	resolveRuntimeResource,
	rebuildRuntimeSourceResources,
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
import { initializeTabs, openEditorTab } from '../../ide/workbench/ui/tabs';
import { resolveTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { WORKBENCH_RESOURCE_VIEWER_ID } from '../../ide/workbench/contrib/resources/editor_input';
import { createResourceEditorResolver } from '../../ide/workbench/contrib/resources/editor_contributions';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
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
		if (url.pathname === '/__bmsx__/session') return Response.json({ workspaceToken: 'workspace-storage-test' });
		assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer workspace-storage-test');
		const directory = url.searchParams.get('directory');
		if (directory !== null) {
			const entries = new Map<string, 'file' | 'directory'>();
			for (const path of this.files.keys()) {
				if (!path.startsWith(`${directory}/`)) continue;
				const tail = path.slice(directory.length + 1);
				const slash = tail.indexOf('/');
				entries.set(slash < 0 ? tail : tail.slice(0, slash), slash < 0 ? 'file' : 'directory');
			}
			return new Response(JSON.stringify([...entries].map(([name, type]) => ({ name, type }))));
		}
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
			if (new Headers(init?.headers).get('If-None-Match') === '*' && this.files.has(path!)) return new Response(null, { status: 412 });
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
let workspaceFiles: WorkspaceRecordProvider;
const TEST_DOMAIN = 0;
let workspaceEnvironment = createWorkspaceEnvironment(new MockStorage());

function installBrowserWorkspace(t: TestContext, storage: MockStorage, clock = new MockClock()): MockClock {
	workspaceEnvironment = createWorkspaceEnvironment(storage, clock);
	workspaceFiles = new MemoryWorkspaceFiles();
	globalThis.fetch = async () => { throw new Error('Unexpected network request in a browser workspace'); };
	t.after(() => resetEnvironment(storage));
	return clock;
}

function installWorkspaceServer(
	t: TestContext,
	storage: MockStorage,
	clock = new MockClock(),
): { clock: MockClock; server: MockWorkspaceServer } {
	const server = new MockWorkspaceServer();
	workspaceFiles = new HttpWorkspaceRecordProvider();
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
	return { location: { kind: 'workspace' as const, path },
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

function installDirtyModel(path: string, source: string, domain: ResourceDomain = TEST_DOMAIN): EditorTextModel {
	const model = editorTextModelService.retain(testResource(path, domain), 'lua', '');
	model.restoreDirtySource(source);
	return model;
}

function sourceRegistry(
	source: string,
	projectRootPath = 'offline-cart',
	sourcePath = 'entry.lua',
	sourceKind: LuaSourceRecord['sourceKind'] = 'project',
	programModule = true,
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
		sourceKind,
		program_module: programModule,
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
	editorGroup: WorkspaceAutosavePayload['editorGroup'] = { inputs: [], active: null, preview: null },
): WorkspaceAutosavePayload {
	return {
		dirtyFiles,
		editorGroup,
		breakpoints: [],
		fontVariant: DEFAULT_FONT_VARIANT,
	};
}

function codeInputSnapshot(path: string, text: string, domain: ResourceDomain, cursor = 0, anchor: number | null = null, scrollLeft = 0): SerializedEditorInput {
	const model = new EditorTextModel(testResource(path, domain), 'lua', text);
	const input = new CodeEditorInput(model), context = input.context;
	context.view.cursorColumn = cursor;
	context.view.selectionAnchor = anchor === null ? null : { row: 0, column: anchor };
	context.view.scrollLeft = scrollLeft;
	const value = new CodeEditorInputSerializer(null).serialize(input);
	input.dispose(); model.dispose();
	return { kind: 'code_editor', value };
}

function codeInputState(input: SerializedEditorInput): SerializedCodeEditorInput {
	assert.equal(input.kind, 'code_editor');
	return JSON.parse(input.value);
}

test('code-input version 1 persists fractional pixel scroll with the exact source and selection', async t => {
	installBrowserWorkspace(t, new MockStorage());
	const source = '-- original source\nreturn 1';
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system'), [sourceRegistry(source), null], TEST_DOMAIN);
	const saved = codeInputState(codeInputSnapshot('entry.lua', source, TEST_DOMAIN, 7, 2, 19.75));
	assert.equal(saved.version, 1); assert.equal(saved.view.scrollLeft, 19.75);
	assert.equal('scrollColumn' in saved.view, false);
	const serializer = new CodeEditorInputSerializer(sources);
	const input = await serializer.deserialize(JSON.stringify({ ...saved, view: { ...saved.view, scrollRow: 1.25 } }));
	assert.equal(input.workingCopy.buffer.getText(), source);
	assert.equal(input.context.view.cursorColumn, 7); assert.deepEqual(input.context.view.selectionAnchor, { row: 0, column: 2 });
	assert.equal(input.context.view.scrollRow, 1.25); assert.equal(input.context.view.scrollLeft, 19.75);
	assert.deepEqual(JSON.parse(serializer.serialize(input)).view, { cursor: 7, anchor: 2, scrollRow: 1.25, scrollLeft: 19.75 });
});

for (const sameSource of [true, false]) test(`unversioned glyph-scroll migration preserves only matching source view state (${sameSource})`, async t => {
	installBrowserWorkspace(t, new MockStorage());
	const source = '-- original source\nreturn 1', current = sameSource ? source : source.replace('original', 'replaced');
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system'), [sourceRegistry(current), null], TEST_DOMAIN);
	const saved = codeInputState(codeInputSnapshot('entry.lua', source, TEST_DOMAIN, 7, 2));
	const legacy = JSON.stringify({ source: saved.source, view: { cursor: 7, anchor: 2, scrollRow: 1.25, scrollColumn: 91.75 } });
	const serializer = new CodeEditorInputSerializer(sources), input = await serializer.deserialize(legacy);
	assert.equal(input.workingCopy.buffer.getText(), current); assert.equal(input.workingCopy.dirty, false);
	assert.equal(input.context.view.cursorColumn, sameSource ? 7 : 0);
	assert.deepEqual(input.context.view.selectionAnchor, sameSource ? { row: 0, column: 2 } : null);
	assert.equal(input.context.view.scrollRow, sameSource ? 1.25 : 0);
	assert.equal(input.context.view.scrollLeft, 0, 'recognized old glyph units are not silently loaded as pixels');
	const migrated: SerializedCodeEditorInput = JSON.parse(serializer.serialize(input));
	assert.equal(migrated.version, 1); assert.equal(migrated.view.scrollLeft, 0); assert.equal('scrollColumn' in migrated.view, false);
});

test('a future code-input schema is rejected before source reconstruction, not treated as the glyph migration', async t => {
	installBrowserWorkspace(t, new MockStorage());
	const source = '-- original source', saved = codeInputState(codeInputSnapshot('entry.lua', source, TEST_DOMAIN));
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system'), [sourceRegistry(source), null], TEST_DOMAIN);
	await assert.rejects(new CodeEditorInputSerializer(sources).deserialize(JSON.stringify({ ...saved, version: 2 })),
		/Unsupported code editor view version '2'/);
	assert.equal([...editorTextModelService.models].length, 0);
});

function editorStub(
	sources: RuntimeSourceState,
) {
	return {
		fontVariant: DEFAULT_FONT_VARIANT,
		resourcePanel: null,
		editorInputSerializers: { code_editor: new CodeEditorInputSerializer(sources), resource_view: new ResourceViewerInputSerializer(sources) },
		editorPanes: createTestEditorPanes(),
		setFontVariant() { /* noop */ },
		updateViewport() { /* noop */ },
	};
}

async function startAutosaveSession(t: TestContext, storage: MockStorage, root = 'offline-cart', files: WorkspaceRecordProvider = workspaceFiles) {
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source', root), null],
		TEST_DOMAIN,
	);
	const restored = await initializeWorkspaceStorage(storage, workspaceEnvironment.clock, root, sources, files, testLogOutput);
	await restoreWorkspaceStorageSession(
		editorStub(sources) as any,
		sources,
		{ breakpoints: new RuntimeBreakpoints(sources, () => {}) },
		restored,
		new Set(),
	);
	t.after(() => resetSemanticProjects(editorTextModelService));
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
		editorTextModelService.clear();
		resetSemanticProjects(editorTextModelService);
		clearWorkspaceSourceCaches();
	});

	assert.equal(resolveRuntimeLuaSource(sources, { domain: 0, path: 'entry.lua' })!.record.src, 'return "slot 0"');
	assert.equal(resolveRuntimeLuaSource(sources, { domain: 1, path: 'entry.lua' })!.record.src, 'return "slot 1"');
	const slot0Model = installDirtyModel('entry.lua', 'return "slot 0"', 0);
	const slot1Model = installDirtyModel('entry.lua', 'return "slot 1"', 1);
	assert.notEqual(buildCodeTabId(slot0Model.resource), buildCodeTabId(slot1Model.resource));
	assert.notEqual(
		buildWorkspaceDirtyEntryPath('offline-cart', 0, 'entry.lua'),
		buildWorkspaceDirtyEntryPath('offline-cart', 1, 'entry.lua'),
	);
	const slot0Project = getOrCreateSemanticProject(editorTextModelService, 0);
	const slot1Project = getOrCreateSemanticProject(editorTextModelService, 1);
	slot0Project.synchronizeRuntimeSources(sources);
	slot1Project.synchronizeRuntimeSources(sources);
	assert.notEqual(slot0Project, slot1Project);
	setWorkspaceLuaSourceOverride(slot0Sources, 'entry.lua', 'return "slot 0 edit"');
	slot0Project.synchronizeRuntimeSources(sources);
	assert.equal(readWorkspaceLuaSourceText(slot0Sources, slot0Sources.records[0]), 'return "slot 0 edit"');
	assert.equal(readWorkspaceLuaSourceText(slot1Sources, slot1Sources.records[0]), 'return "slot 1"');
	assert.equal(slot0Project.getFileData('entry.lua')!.source, 'return "slot 0"', 'a base-cache write is not an edit of the retained model');
	slot0Model.pushEditOperations([{ offset: 14, deleteLength: 0, text: ' edit' }]);
	assert.equal(slot0Project.getFileData('entry.lua')!.source, 'return "slot 0 edit"');
	assert.equal(slot1Project.getFileData('entry.lua')!.source, 'return "slot 1"');
});

test('workspace restore preserves explicit tab order and an active dirty system view', async (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
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
		editorStub(sources) as any,
		sources,
		{ breakpoints: new RuntimeBreakpoints(sources, () => {}) },
		payload(
			[{
				domain: SYSTEM_RESOURCE_DOMAIN,
				path: systemPath,
				updatedAt: 80,
			}],
			{ inputs: [
				codeInputSnapshot(cartridgePath, '-- cartridge source', 0),
				codeInputSnapshot(systemPath, '-- dirty system source', SYSTEM_RESOURCE_DOMAIN, 7, 2, 3),
			], active: 1, preview: null },
		),
	);

	const activeTab = editorTabGroup.activeTab!;
	assert.equal(activeTab.kind, 'code_editor');
	const activeContext = activeTab.kind === 'code_editor' ? activeTab.context : null;
	assert.equal(activeContext.model.resource.domain, SYSTEM_RESOURCE_DOMAIN);
	assert.equal(activeContext.model.resource.path, systemPath);
	assert.equal(editorTabGroup.tabs.length, 2);
	const systemContext = editorTabGroup.findById(buildCodeTabId({ domain: SYSTEM_RESOURCE_DOMAIN, path: systemPath }))!.context;
	assert.equal(systemContext.model.dirty, true);
	assert.equal(getTextSnapshot(systemContext.model.buffer), '-- dirty system source');
	assert.equal(systemContext.view.cursorColumn, 7);
	assert.equal(systemContext.view.scrollLeft, 3);
	assert.deepEqual(systemContext.view.selectionAnchor, { row: 0, column: 2 });
	assert.equal(editorTabGroup.tabs.some(tab => tab.kind === 'code_editor' && tab.context === systemContext), true);
});

test('canonical source cache keys identical resource paths by physical project path', async (t) => {
	assert.equal(resolveWorkspacePath('src/entry.lua', 'cart0'), 'cart0/src/entry.lua');
	workspaceCanonicalSourceCache.set('cart0/entry.lua', { contents: 'return "slot 0"', updatedAt: 1 });
	const requestedPaths: string[] = [];
	globalThis.fetch = async (input: RequestInfo | URL) => {
		if (String(input) === '/__bmsx__/session') return Response.json({ workspaceToken: 'workspace-storage-test' });
		const url = new URL(String(input), 'http://workspace.local');
		requestedPaths.push(url.searchParams.get('path')!);
		return new Response(JSON.stringify({ contents: 'return "slot 1"', updatedAt: 1 }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	};
	await openWorkspaceRecords(new HttpWorkspaceRecordProvider());
	t.after(async () => {
		await closeWorkspaceRecords();
		globalThis.fetch = ORIGINAL_FETCH;
		clearWorkspaceSourceCaches();
	});
	workspaceEnvironment = createWorkspaceEnvironment(new MockStorage());

	assert.equal((await loadWorkspaceSourceFile('cart1/entry.lua'))!.contents, 'return "slot 1"');
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
	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources, workspaceFiles, testLogOutput);
	const path = 'offline-cart/src/foo.lua';
	let releaseWrite: () => void;
	const blocked = new Promise<void>(resolve => { releaseWrite = resolve; });
	server.blockWrite(path, blocked);

	const firstWrite = workspaceRecords.write(path,
		{ contents: '-- A', updatedAt: 1000 },
	);
	await Promise.resolve();
	const secondWrite = workspaceRecords.write(path,
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

test('canonical reads are ordered before later writes and never reconcile recovery', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source'), null],
		TEST_DOMAIN,
	);
	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources, workspaceFiles, testLogOutput);
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

	const read = workspaceRecords.read(path);
	while (!server.requests.some(request => request.method === 'GET' && request.path === path)) {
		await Promise.resolve();
	}
	const write = workspaceRecords.write(path,
		{ contents: '-- C', updatedAt: 1002 },
	);
	releaseRead!();
	assert.deepEqual(await read, { contents: '-- B', updatedAt: 1001 });
	await write;
	assert.deepEqual(
		readLocalWorkspaceRecord(storage, 'offline-cart', path),
		{ contents: '-- A', updatedAt: 1000 },
	);
	assert.deepEqual(server.files.get(path), { contents: '-- C', updatedAt: 1002 });
});

test('workspace replacement drains admitted operations and does not carry writes to the next provider', async t => {
	const storage = new MockStorage(), { server } = installWorkspaceServer(t, storage);
	await openWorkspaceRecords(workspaceFiles);
	const old = workspaceRecords, blocked = Promise.withResolvers<void>();
	server.blockWrite('file.lua', blocked.promise);
	const write = old.write('file.lua', { contents: '-- old workspace', updatedAt: 1 });
	const next = new MemoryWorkspaceFiles();
	let opened = false;
	const opening = openWorkspaceRecords(next).then(() => { opened = true; });
	await Promise.resolve(); assert.equal(opened, false);
	assert.throws(() => old.read('file.lua'), /shutdown/);
	blocked.resolve(); await write; await opening;
	assert.equal(server.files.get('file.lua')!.contents, '-- old workspace');
	assert.equal(await workspaceRecords.read('file.lua'), null);
});

test('browser workspace restores its local editor recovery without a server', async (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const session = payload();
	writeRecord(storage, 'offline-cart', workspaceStatePath('offline-cart'), JSON.stringify(session), 30);
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source'), null],
		TEST_DOMAIN,
	);

	const restored = await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources, workspaceFiles, testLogOutput);
	assert.deepEqual(restored, session);
	assert.ok(workspaceRecords);
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

	assert.deepEqual(await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources, workspaceFiles, testLogOutput), localPayload);
	assert.equal(workspaceState.remoteRevision, -1);
	await shutdownWorkspaceStorage();

	writeRecord(storage, 'offline-cart', statePath, JSON.stringify(payload()), 20);
	const remotePayload = payload();
	remotePayload.fontVariant = 'msx';
	server.files.set(statePath, { contents: JSON.stringify(remotePayload), updatedAt: 40 });
	assert.deepEqual(await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources, workspaceFiles, testLogOutput), remotePayload);
	assert.deepEqual(
		JSON.parse(readLocalWorkspaceRecord(storage, 'offline-cart', statePath)!.contents),
		remotePayload,
	);
});

test('incomplete recovery is reported and leaves the local generation intact', async (t) => {
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

	await assert.rejects(initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock,
		'offline-cart', sources, workspaceFiles, testLogOutput), /Incomplete editor recovery/);
	assert.deepEqual(readLocalWorkspaceRecord(storage, 'offline-cart', statePath), localStateRecord);

	const remoteDirtyPath = buildWorkspaceDirtyRecordPath(dirtyPath, 30);
	server.files.set(remoteDirtyPath, { contents: '-- remote dirty', updatedAt: 30 });
	assert.deepEqual(
		await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources, workspaceFiles, testLogOutput),
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

test('unreadable recovery is reported without deleting evidence', () => {
	const storage = new MockStorage();
	const key = buildWorkspaceStorageKey('offline-cart', 'src/foo.lua');
	storage.setItem(key, '{broken');
	assert.throws(() => readLocalWorkspaceRecord(storage, 'offline-cart', 'src/foo.lua'), SyntaxError);
	assert.equal(storage.getItem(key), '{broken');
});

test('cold boot uses one manifest-indexed dirty snapshot for source arbitration and editor hydration', async (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
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

	const restored = await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources, workspaceFiles, testLogOutput);
	await workspaceRecords.write('offline-cart/entry.lua', { contents: '-- saved source', updatedAt: 50 });
	const rejected = await applyAllWorkspaceSourceOverrides(sources, workspaceDirtyRecords);
	assert.equal(registry.records[0].src, '-- dirty edit');
	assert.equal(registry.records[0].base_src, '-- saved source');
	assert.equal(registry.records[0].base_update_timestamp, 50);
	assert.equal(rejected.size, 0);

	installWorkspaceRestoreView();
	await restoreWorkspaceStorageSession(
		editorStub(sources) as any,
		sources,
		{ breakpoints: new RuntimeBreakpoints(sources, () => {}) },
		restored,
		rejected,
	);
	const model = editorTextModelService.get({ domain: TEST_DOMAIN, path: 'entry.lua' })!;
	assert.equal(getTextSnapshot(model.buffer), '-- dirty edit');
	assert.equal(model.lastSavedSource, '-- saved source');
	assert.equal(model.dirty, true);
	assert.equal(editorTabGroup.tabs.length, 0);
	model.revert();
	assert.equal(model.buffer.getText(), '-- saved source');
	assert.equal(model.dirty, false);
	assert.equal((await workspaceRecords.read('offline-cart/entry.lua'))!.contents, '-- saved source');
});

test('Lua model and code-view admission preserve effective overrides without making them saved', async t => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const registry = sourceRegistry('-- saved source');
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system source'), [registry, null], TEST_DOMAIN);
	const resource = resolveRuntimeResource(sources, { domain: TEST_DOMAIN, path: 'entry.lua' })!;
	setWorkspaceLuaSourceOverride(registry, resource.path, '-- effective unsaved source');
	const model = await resolveTextFileModel(editorTextModelService, sources, resource);
	assert.equal(model.buffer.getText(), '-- effective unsaved source');
	assert.equal(model.lastSavedSource, '-- saved source');
	assert.equal(model.dirty, true);
	editorTextModelService.clear();
	const input = resolveLuaCodeEditorInput(sources, resource), context = input.context;
	t.after(() => input.dispose());
	assert.equal(context.model.buffer.getText(), '-- effective unsaved source');
	assert.equal(context.model.lastSavedSource, '-- saved source');
	assert.equal(context.model.dirty, true);
	context.model.revert();
	assert.equal(context.model.buffer.getText(), '-- saved source');
	assert.equal(context.model.dirty, false);
});

test('an uncommitted record cannot satisfy a different manifest version', async (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
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

	await assert.rejects(initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock,
		'offline-cart', sources, workspaceFiles, testLogOutput), /Incomplete editor recovery/);
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', uncommittedPath)!.updatedAt, 81);
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', workspaceStatePath('offline-cart'))!.updatedAt, 90);
});

test('manifest dirty entry rejected by newer ROM is not hydrated', async (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
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
	session.editorGroup = { inputs: [codeInputSnapshot('entry.lua', '-- stale dirty edit', TEST_DOMAIN, 9)], active: 0, preview: null };
	const dirtyRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, 50);
	writeRecord(storage, 'offline-cart', dirtyRecordPath, '-- stale dirty edit', 50);
	writeRecord(storage, 'offline-cart', workspaceStatePath('offline-cart'), JSON.stringify(session), 60);

	const restored = await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources, workspaceFiles, testLogOutput);
	const rejected = await applyAllWorkspaceSourceOverrides(sources, workspaceDirtyRecords);
	assert.deepEqual([...rejected], [dirtyPath]);
	installWorkspaceRestoreView();
	await restoreWorkspaceStorageSession(
		editorStub(sources) as any,
		sources,
		{ breakpoints: new RuntimeBreakpoints(sources, () => {}) },
		restored,
		rejected,
	);
	assert.equal(registry.records[0].src, '-- newer rom source');
	assert.equal(editorTabGroup.findById(buildCodeTabId({ domain: TEST_DOMAIN, path: 'entry.lua' }))!.context.model.dirty, false);
	assert.equal(editorTabGroup.findById(buildCodeTabId({ domain: TEST_DOMAIN, path: 'entry.lua' }))!.context.view.cursorColumn, 0);
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', dirtyRecordPath)!.contents, '-- stale dirty edit');
});

test('dirty records follow the physical project root owned by each resource domain', async (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
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

	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, slot0Root, sources, workspaceFiles, testLogOutput);
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

test('a dirty working copy can acquire its first code view after the content backup', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const sources = await startAutosaveSession(t, storage);
	const resource = resolveRuntimeResource(sources, { domain: TEST_DOMAIN, path: 'entry.lua' })!;
	const model = editorTextModelService.retain(resource, 'lua', '-- cart source');
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- visual edit' }]);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	const backup = workspaceState.localGeneration!;
	assert.equal(backup.payload.dirtyFiles.length, 1);
	assert.equal(backup.payload.editorGroup.inputs.length, 0);
	const input = new CodeEditorInput(model), context = input.context;
	editorTabGroup.initialize(input);
	context.view.cursorRow = 1;
	context.view.cursorColumn = 3;
	const version = model.version;
	const writes = server.requests.filter(request => request.method === 'PUT' && request.path.includes('/.bmsx/dirty/')).length;
	requestWorkspaceAutosave(WorkspaceAutosaveChange.EditorSession);
	await flushRequestedAutosave();
	const generation = workspaceState.localGeneration!;
	assert.equal(generation.payload.editorGroup.inputs.length, 1);
	assert.equal(codeInputState(generation.payload.editorGroup.inputs[0]).view.cursor, model.buffer.offsetAt(1, 3));
	assert.strictEqual(generation.dirtyRecords, backup.dirtyRecords);
	assert.strictEqual(generation.payload.dirtyFiles, backup.payload.dirtyFiles);
	assert.equal(model.version, version);
	assert.equal(server.requests.filter(request => request.method === 'PUT' && request.path.includes('/.bmsx/dirty/')).length, writes);
	const restored = await initializeWorkspaceStorage(storage, workspaceEnvironment.clock, 'offline-cart', sources, workspaceFiles, testLogOutput);
	installWorkspaceRestoreView();
	await restoreWorkspaceStorageSession(editorStub(sources) as any, sources,
		{ breakpoints: new RuntimeBreakpoints(sources, () => {}) }, restored, new Set());
	const restoredContext = editorTabGroup.findById(buildCodeTabId(resource))!.context;
	assert.notStrictEqual(restoredContext.model, model);
	assert.equal(restoredContext.model.buffer.getText(), '-- cart source\n-- visual edit');
	assert.equal(restoredContext.model.dirty, true);
	assert.equal(restoredContext.view.cursorRow, 1);
	assert.equal(restoredContext.view.cursorColumn, 3);
});

test('cursor-only autosave reuses retained dirty content and background metadata', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	await startAutosaveSession(t, storage);
	const activeTab = new CodeEditorInput(installDirtyModel('src/foo.lua', '-- dirty foreground'));
	const activeContext = activeTab.context;
	const backgroundTab = new CodeEditorInput(installDirtyModel('src/bar.lua', '-- dirty background'));
	editorTabGroup.initialize(activeTab);
	editorTabGroup.add(backgroundTab);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	const firstGeneration = workspaceState.localGeneration!;
	const activeIndex = firstGeneration.payload.editorGroup.inputs.findIndex(entry => codeInputState(entry).source.resource.path === activeContext.model.resource.path);
	const backgroundIndex = firstGeneration.payload.editorGroup.inputs.findIndex(entry => codeInputState(entry).source.resource.path === backgroundTab.workingCopy.resource.path);
	const dirtyPutCount = server.requests.filter(request =>
		request.method === 'PUT' && request.path.includes('/.bmsx/dirty/')).length;

	activeContext.view.cursorColumn = 1;
	requestWorkspaceAutosave(WorkspaceAutosaveChange.EditorSession);
	editorTabGroup.activate(backgroundTab);
	await flushRequestedAutosave();
	const secondGeneration = workspaceState.localGeneration!;
	assert.strictEqual(secondGeneration.dirtyRecords, firstGeneration.dirtyRecords);
	assert.strictEqual(secondGeneration.payload.dirtyFiles, firstGeneration.payload.dirtyFiles);
	assert.strictEqual(secondGeneration.payload.breakpoints, firstGeneration.payload.breakpoints);
	assert.notStrictEqual(
		secondGeneration.payload.editorGroup.inputs[activeIndex],
		firstGeneration.payload.editorGroup.inputs[activeIndex],
	);
	assert.equal(codeInputState(secondGeneration.payload.editorGroup.inputs[activeIndex]).view.cursor, 1);
	assert.strictEqual(
		secondGeneration.payload.editorGroup.inputs[backgroundIndex],
		firstGeneration.payload.editorGroup.inputs[backgroundIndex],
	);
	assert.equal(
		server.requests.filter(request =>
			request.method === 'PUT' && request.path.includes('/.bmsx/dirty/')).length,
		dirtyPutCount,
	);
});

test('view metadata belongs to the emitting model even when a different tab is active', async (t) => {
	const storage = new MockStorage();
	installWorkspaceServer(t, storage);
	await startAutosaveSession(t, storage);
	const firstInput = new CodeEditorInput(installDirtyModel('same.lua', '-- first', 0));
	const first = firstInput.context;
	const secondInput = new CodeEditorInput(installDirtyModel('same.lua', '-- second', -1));
	const second = secondInput.context;
	editorTabGroup.initialize(secondInput);
	editorTabGroup.add(firstInput);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	first.view.cursorColumn = 2;
	requestWorkspaceAutosave(WorkspaceAutosaveChange.EditorSession);
	second.view.cursorColumn = 5;
	requestWorkspaceAutosave(WorkspaceAutosaveChange.EditorSession);
	await flushRequestedAutosave();
	const views = workspaceState.localGeneration!.payload.editorGroup.inputs.map(codeInputState);
	assert.equal(views.find(view => view.source.resource.domain === 0)!.view.cursor, 2);
	assert.equal(views.find(view => view.source.resource.domain === -1)!.view.cursor, 5);
});

test('clean views persist without source backups and unchanged checkpoints do not write', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const sources = await startAutosaveSession(t, storage);
	const resource = resolveRuntimeResource(sources, { domain: TEST_DOMAIN, path: 'entry.lua' })!;
	const model = editorTextModelService.retain(resource, 'lua', '-- cart source');
	const input = new CodeEditorInput(model), context = input.context;
	editorTabGroup.initialize(input);
	context.view.cursorColumn = 3;
	const revision = workspaceState.requestedRevision;
	requestWorkspaceAutosave(WorkspaceAutosaveChange.EditorSession);
	assert.ok(workspaceState.requestedRevision > revision);
	await flushRequestedAutosave();
	assert.equal(workspaceState.localGeneration!.payload.editorGroup.inputs.length, 1);
	assert.deepEqual(workspaceState.localGeneration!.payload.dirtyFiles, []);
	assert.equal(model.version, 1);
	assert.equal(model.canUndo, false);
	assert.equal(model.dirty, false);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- edit\n' }]);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	requestWorkspaceAutosave(WorkspaceAutosaveChange.EditorSession);
	await flushRequestedAutosave();
	const generation = workspaceState.localGeneration!;
	const requestCount = server.requests.length;
	requestWorkspaceAutosave(WorkspaceAutosaveChange.EditorSession);
	await flushRequestedAutosave();
	assert.strictEqual(workspaceState.localGeneration, generation);
	assert.equal(server.requests.length, requestCount);
	// Save/Undo can make a queued view clean before the timer captures it.
	requestWorkspaceAutosave(WorkspaceAutosaveChange.EditorSession);
	model.undo();
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	assert.deepEqual(workspaceState.localGeneration!.payload.dirtyFiles, []);
	assert.equal(workspaceState.localGeneration!.payload.editorGroup.inputs.length, 1);
});

test('record generation stays unique when the host clock does not advance', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage, new MockClock(true));
	await startAutosaveSession(t, storage);
	const model = installDirtyModel('src/foo.lua', '-- dirty A');
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	const firstTimestamp = workspaceDirtyRecords.get(dirtyPath)!.updatedAt;
	const firstRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, firstTimestamp);

	model.pushEditOperations([{
		offset: 0,
		deleteLength: model.buffer.length,
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
	installBrowserWorkspace(t, storage);
	const sources = await startAutosaveSession(t, storage);
	installDirtyModel('src/foo.lua', '-- dirty edit');
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
	installBrowserWorkspace(t, storage);
	await startAutosaveSession(t, storage);
	const model = installDirtyModel('src/foo.lua', '-- dirty A');
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	const statePath = workspaceStatePath('offline-cart');
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	const previousRecord = workspaceDirtyRecords.get(dirtyPath)!;
	const previousRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, previousRecord.updatedAt);
	const previousStateRecord = readLocalWorkspaceRecord(storage, 'offline-cart', statePath)!;

	model.pushEditOperations([{
		offset: 0,
		deleteLength: model.buffer.length,
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

test('failed dirty PUT retains the local generation and converges on an explicit checkpoint', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	await startAutosaveSession(t, storage);
	installDirtyModel('src/foo.lua', '-- dirty edit');
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
	assert.equal(workspaceState.remoteRevision, -1);

	await runWorkspaceAutosaveTick();
	assert.equal(server.files.get(dirtyRecordPath)!.contents, '-- dirty edit');
	const dirtyFiles = JSON.parse(server.files.get(statePath)!.contents).dirtyFiles;
	assert.equal(dirtyFiles.length, 1);
	assert.equal(dirtyFiles[0].domain, TEST_DOMAIN);
	assert.equal(dirtyFiles[0].path, 'src/foo.lua');
	assert.equal(dirtyFiles[0].updatedAt, server.files.get(dirtyRecordPath)!.updatedAt);
});

test('local session write failure reports once, keeps recovery and schedules no reconnect or blind retry', async t => {
	const storage = new MockStorage(), clock = installBrowserWorkspace(t, storage);
	let writes = 0;
	const failure = new Error('local storage quota exhausted');
	const files: WorkspaceRecordProvider = {
		persistence: 'browser',
		async read() { return null; }, async readDirectory() { return []; }, async delete() {},
		async write() { writes++; throw failure; },
	};
	await startAutosaveSession(t, storage, 'offline-cart', files);
	const model = installDirtyModel('src/foo.lua', '-- keep this edit');
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	const previousErrors = testLogOutput.messages.filter(message => message.level === LogLevel.Error).length;
	await flushRequestedAutosave();
	assert.equal(writes, 1);
	assert.equal(model.dirty, true);
	assert.ok(workspaceRecords);
	assert.equal(clock.activeCount, 0);
	assert.equal(testLogOutput.messages.filter(message => message.level === LogLevel.Error).length, previousErrors + 1);
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	const record = workspaceDirtyRecords.get(dirtyPath)!;
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', buildWorkspaceDirtyRecordPath(dirtyPath, record.updatedAt))!.contents, '-- keep this edit');
});

test('failed state PUT leaves the previous remote generation recoverable and retries the new generation', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	await startAutosaveSession(t, storage);
	const model = installDirtyModel('src/foo.lua', '-- dirty A');
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	const statePath = workspaceStatePath('offline-cart');
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	const previousRecord = workspaceDirtyRecords.get(dirtyPath)!;
	const previousRecordPath = buildWorkspaceDirtyRecordPath(dirtyPath, previousRecord.updatedAt);
	const previousStateRecord = server.files.get(statePath)!;

	model.pushEditOperations([{
		offset: 0,
		deleteLength: model.buffer.length,
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

	await runWorkspaceAutosaveTick();
	const remotePayload = JSON.parse(server.files.get(statePath)!.contents) as WorkspaceAutosavePayload;
	assert.equal(remotePayload.dirtyFiles[0].updatedAt, dirtyRecord.updatedAt);
	assert.equal(server.files.has(previousRecordPath), false);
});

test('remote sync publishes the exact dirty records retained with its state generation', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	await startAutosaveSession(t, storage);
	installDirtyModel('src/a.lua', '-- A1');
	const modelB = installDirtyModel('src/b.lua', '-- B1');
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

	modelB.pushEditOperations([{
		offset: 0,
		deleteLength: modelB.buffer.length,
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

test('failed dirty DELETE retries on an explicit checkpoint and stale orphan cannot resurrect', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const sources = await startAutosaveSession(t, storage);
	const model = installDirtyModel('entry.lua', '-- dirty edit');
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'entry.lua');
	const statePath = workspaceStatePath('offline-cart');
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	await flushRequestedAutosave();
	const dirtyRecordPath = buildWorkspaceDirtyRecordPath(
		dirtyPath,
		workspaceDirtyRecords.get(dirtyPath)!.updatedAt,
	);
	assert.equal(server.files.has(dirtyRecordPath), true);

	model.completeSave(model.createSnapshot());
	server.fail('DELETE', dirtyPath);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	cancelWorkspaceAutosave();
	await runWorkspaceAutosaveTick();
	assert.deepEqual(JSON.parse(server.files.get(statePath)!.contents).dirtyFiles, []);
	assert.equal(server.files.has(dirtyRecordPath), true);

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
	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', rebootedSources, workspaceFiles, testLogOutput);
	await applyAllWorkspaceSourceOverrides(rebootedSources, workspaceDirtyRecords);
	assert.equal(rebootedRegistry.records[0].src, '-- rom source');
	assert.equal(workspaceDirtyRecords.size, 0);
	void sources;
});

test('workspace reconfiguration waits for the active autosave task', async (t) => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	const sources = await startAutosaveSession(t, storage, 'root-a');
	installDirtyModel('src/foo.lua', '-- dirty edit');
	const dirtyPath = buildWorkspaceDirtyEntryPath('root-a', TEST_DOMAIN, 'src/foo.lua');
	let releaseWrite: () => void;
	const blocked = new Promise<void>(resolve => { releaseWrite = resolve; });
	server.blockWrite(dirtyPath, blocked);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	cancelWorkspaceAutosave();
	const autosave = runWorkspaceAutosaveTick() as Promise<void>;
	await Promise.resolve();
	let reconfigured = false;
	const reconfiguration = initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'root-b', sources, workspaceFiles, testLogOutput).then(() => { reconfigured = true; });
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
	installDirtyModel('src/foo.lua', '-- locally recoverable edit');
	const statePath = workspaceStatePath('root-a');
	server.fail('PUT', statePath);
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
	cancelWorkspaceAutosave();
	await runWorkspaceAutosaveTick();
	assert.equal(workspaceState.remoteRevision, -1);
	assert.notEqual(readLocalWorkspaceRecord(storage, 'root-a', statePath), null);

	const rootBSources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source', 'root-b'), null],
		TEST_DOMAIN,
	);
	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'root-b', rootBSources, workspaceFiles, testLogOutput);
	assert.equal(workspaceState.projectRootPath, 'root-b');
});

test('workspace reconfiguration commits a pending debounced edit locally', async (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const sources = await startAutosaveSession(t, storage, 'root-a');
	installDirtyModel('src/foo.lua', '-- pending edit');
	const dirtyPath = buildWorkspaceDirtyEntryPath('root-a', TEST_DOMAIN, 'src/foo.lua');
	requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);

	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'root-b', sources, workspaceFiles, testLogOutput);
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
	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources, workspaceFiles, testLogOutput);
	const model = installDirtyModel('src/foo.lua', '-- clean source');
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'src/foo.lua');
	workspaceDirtyRecords.set(dirtyPath, { contents: '-- restored dirty edit', updatedAt: 1 });
	const requests = server.requests.length;
	hydrateDirtyFiles(sources, [{
		domain: TEST_DOMAIN,
		path: 'src/foo.lua',
		updatedAt: 1,
	}]);
	assert.equal(server.requests.length, requests);
	assert.equal(getTextSnapshot(model.buffer), '-- restored dirty edit');
	assert.equal(model.dirty, true);
});

test('workspace restore resolves persisted identity to the retained runtime resource', async (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
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
		breakpoints: new RuntimeBreakpoints(sources, () => {}),
	};
	debuggerState.breakpoints.set({ domain: 1, path: 'stale.lua' }, [1]);
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
		editorStub(sources) as any,
		sources,
		debuggerState,
		restoredPayload,
	);
	const model = editorTextModelService.get(retained)!;
	assert.strictEqual(model.resource, retained);
	assert.equal(model.buffer.getText(), '-- restored edit');
	assert.equal(editorTabGroup.findById(buildCodeTabId(retained)), undefined);
	assert.deepEqual(debuggerState.breakpoints.get({ domain: -1, path: 'base.lua' }), new Set([4]));
	assert.deepEqual(debuggerState.breakpoints.get(retained), new Set([3, 9]));
	assert.equal(debuggerState.breakpoints.get({ domain: 1, path: 'stale.lua' }).size, 0);
});

test('workspace recovery hydrates a dirty working copy without creating an editor input', async (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[sourceRegistry('-- cart source'), null],
		TEST_DOMAIN,
	);
	const resource = testResource('res/test_scene.aem', TEST_DOMAIN, 'aem');
	sources.resourceByIdentity.set(resourceIdentityKey(resource), resource);
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', resource.domain, resource.path);
	workspaceDirtyRecords.set(dirtyPath, { contents: '{ "version": 1 }', updatedAt: 1 });
	workspaceCanonicalSourceCache.set('offline-cart/res/test_scene.aem', { contents: '{ "events": {} }', updatedAt: 0 });
	installWorkspaceRestoreView();
	await applyWorkspaceAutosavePayload(
		editorStub(sources) as any,
		sources,
		{ breakpoints: new RuntimeBreakpoints(sources, () => {}) },
		payload([{
			domain: resource.domain,
			path: resource.path,
			updatedAt: 1,
		}]),
	);

	const model = editorTextModelService.get(resource)!;
	assert.equal(model.mode, 'aem');
	assert.equal(model.buffer.getText(), '{ "version": 1 }');
	assert.equal(model.dirty, true);
	assert.equal(editorTabGroup.findById(buildCodeTabId(resource)), undefined);
	assert.equal(editorTabGroup.tabs.length, 0);
	assert.equal(editorTabGroup.activeTab, null);
	assert.equal([...editorTextModelService.models].length, 1);
});

test('YAML dirty session recovery restores exact unsaved source into a fresh working copy', async t => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const sources = await startAutosaveSession(t, storage);
	const resource = testResource('res/data/stage.yaml', TEST_DOMAIN, 'data');
	sources.resourceByIdentity.set(resourceIdentityKey(resource), resource);
	const canonicalPath = 'offline-cart/res/data/stage.yaml';
	const original = '# Keep authored glyphs and spacing\nmap_rows:\n  - "  pM/^^\\\\  " # roof\n';
	await workspaceRecords.write(canonicalPath, { contents: original, updatedAt: 1 });
	const model = await resolveTextFileModel(editorTextModelService, sources, resource);
	model.pushEditOperations([{ offset: original.indexOf('pM'), deleteLength: 2, text: 'Pm' }]);
	const unsaved = original.replace('pM', 'Pm');
	assert.equal(model.dirty, true);
	persistWorkspaceSessionLocally();
	assert.deepEqual(workspaceState.localGeneration!.payload.dirtyFiles.map(entry => entry.path), [resource.path]);
	assert.equal((await workspaceRecords.read(canonicalPath))!.contents, original);

	await shutdownWorkspaceStorage();
	editorTextModelService.clear();
	assert.equal(editorTextModelService.get(resource), undefined);
	const restoredPayload = await initializeWorkspaceStorage(
		storage, workspaceEnvironment.clock, 'offline-cart', sources, workspaceFiles, testLogOutput,
	);
	assert.ok(restoredPayload);
	await restoreWorkspaceStorageSession(
		editorStub(sources) as any,
		sources,
		{ breakpoints: new RuntimeBreakpoints(sources, () => {}) },
		restoredPayload,
		new Set(),
	);

	const restored = editorTextModelService.get(resource)!;
	assert.notEqual(restored, model);
	assert.equal(restored.mode, 'yaml');
	assert.equal(getTextSnapshot(restored.buffer), unsaved);
	assert.equal(restored.dirty, true);
	assert.equal(await resolveTextFileModel(editorTextModelService, sources, resource), restored);
	assert.equal((await workspaceRecords.read(canonicalPath))!.contents, original);
	assert.equal(getTextFileRuntimeSourceStatus(sources, restored), 'untracked');
	assert.deepEqual(captureLuaTextModelSources(editorTextModelService, sources), []);
});

for (const type of ['data', 'aem'] as const) for (const savedAt of [10, 20, 30, null]) {
	test(`${type} recovery compares its checkpoint with the saved source (${savedAt})`, async t => {
		const storage = new MockStorage();
		installBrowserWorkspace(t, storage);
		const sources = createTestRuntimeSourceState(sourceRegistry('-- system'), [sourceRegistry('-- cart'), null], TEST_DOMAIN);
		const resource = testResource(type === 'data' ? 'res/stage.yaml' : 'res/events.aem.yaml', TEST_DOMAIN, type);
		resource.source.sourcemeta = { text: 'value: packaged\n' };
		sources.resourceByIdentity.set(resourceIdentityKey(resource), resource);
		const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', resource.domain, resource.path);
		const draft = 'value: recovered\n', saved = 'value: saved\n';
		const checkpoint = payload([{ domain: resource.domain, path: resource.path, updatedAt: 20 }]);
		writeRecord(storage, 'offline-cart', buildWorkspaceDirtyRecordPath(dirtyPath, 20), draft, 20);
		writeRecord(storage, 'offline-cart', workspaceStatePath('offline-cart'), JSON.stringify(checkpoint), 21);
		const canonicalPath = resolveWorkspacePath(resource.path, 'offline-cart');
		if (savedAt !== null) await workspaceFiles.write(canonicalPath, { contents: saved, updatedAt: savedAt }, true);
		const restoredPayload = await initializeWorkspaceStorage(storage, workspaceEnvironment.clock, 'offline-cart', sources, workspaceFiles, testLogOutput);
		installWorkspaceRestoreView();
		await restoreWorkspaceStorageSession(editorStub(sources) as any, sources,
			{ breakpoints: new RuntimeBreakpoints(sources, () => {}) }, restoredPayload, new Set());
		const restored = await resolveTextFileModel(editorTextModelService, sources, resource);
		const keepDraft = savedAt === null || savedAt <= 20;
		assert.equal(restored.buffer.getText(), keepDraft ? draft : saved);
		assert.equal(restored.dirty, keepDraft);
		assert.equal(restored.lastSavedSource, savedAt === null ? 'value: packaged\n' : saved);
		// Recovery must also retire superseded backup references, not merely skip a buffer write.
		persistWorkspaceSessionLocally();
		assert.equal(workspaceState.localGeneration!.payload.dirtyFiles.length, keepDraft ? 1 : 0);
		assert.deepEqual(await workspaceRecords.read(canonicalPath), savedAt === null ? null : { contents: saved, updatedAt: savedAt });
		restored.revert();
		assert.equal(restored.buffer.getText(), savedAt === null ? 'value: packaged\n' : saved);
		assert.equal(restored.dirty, false);
	});
}

test('workspace override arbitration keeps dirty and canonical namespaces separate', async (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const registry = sourceRegistry('-- rom source');
	const asset = registry.records[0];
	asset.base_update_timestamp = 15;
	asset.update_timestamp = 15;
	const canonicalPath = resolveWorkspacePath('entry.lua', 'offline-cart');
	await openWorkspaceRecords(workspaceFiles);
	await workspaceRecords.write(canonicalPath, { contents: '-- saved source', updatedAt: 25 });
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, 'entry.lua');
	const dirtyRecords = new Map([[dirtyPath, { contents: '-- dirty source', updatedAt: 30 }]]);

	await applyWorkspaceSourceOverrides({
		dirtyRecords,
		domain: TEST_DOMAIN,
		registry,
		installedSources: new Map([['entry', '-- rom source']]),
		projectRootPath: 'offline-cart',
	});
	assert.equal(asset.src, '-- dirty source');
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', canonicalPath), null);

	dirtyRecords.clear();
	await applyWorkspaceSourceOverrides({
		dirtyRecords,
		domain: TEST_DOMAIN,
		registry,
		installedSources: new Map([['entry', '-- rom source']]),
		projectRootPath: 'offline-cart',
	});
	assert.equal(asset.src, '-- saved source');
	assert.equal(asset.base_src, '-- saved source');
	assert.equal(asset.base_update_timestamp, 25);
});

test('generated compiler sources ignore manifest dirty records', async (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const registry = sourceRegistry('return { source_addr = 1 }');
	const asset = registry.records[0];
	asset.generated = true;
	const dirtyPath = buildWorkspaceDirtyEntryPath('offline-cart', TEST_DOMAIN, asset.source_path);
	await applyWorkspaceSourceOverrides({
		dirtyRecords: new Map([[dirtyPath, { contents: 'return { source_addr = 99 }', updatedAt: 50 }]]),
		domain: TEST_DOMAIN,
		registry,
		installedSources: new Map([['entry', '-- rom source']]),
		projectRootPath: 'offline-cart',
	});
	assert.equal(asset.src, 'return { source_addr = 1 }');
});

test('runtime source capture reads the resource model independently of the active input', (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const registry = sourceRegistry('-- packed source', 'offline-cart', 'src/foo.lua');
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[registry, null],
		TEST_DOMAIN,
	);
	const model = installDirtyModel('src/foo.lua', '-- tab buffer');
	const codeTab = new CodeEditorInput(model);
	editorTabGroup.initialize(codeTab);
	assert.equal(captureCurrentLuaSource(editorTextModelService, sources, model.resource).source, '-- tab buffer');
	const resource = testResource('image.png', TEST_DOMAIN, 'image');
	const resourceTab = new ResourceViewerInput({
			resource,
			lines: [],
			error: '',
			title: 'image.png',
	});
	editorTabGroup.add(resourceTab);
	editorTabGroup.activate(resourceTab);
	assert.equal(captureCurrentLuaSource(editorTextModelService, sources, model.resource).source, '-- tab buffer');
});

test('runtime source capture retains documents whose buffer differs from installed media', (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const model = installDirtyModel('src/foo.lua', '-- revision 2');
	const registry = sourceRegistry('-- revision 2', 'offline-cart', 'src/foo.lua');
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system source'), [registry, null], TEST_DOMAIN);
	sources.cartridgeSlots[TEST_DOMAIN]!.installedBlua32Sources = new Map([['src.foo', '-- revision 1']]);
	assert.deepEqual(captureLuaTextModelSources(editorTextModelService, sources), [{
		version: model.version,
		stateId: model.createSnapshot().stateId,
		domain: TEST_DOMAIN,
		path: 'src/foo.lua',
		source: '-- revision 2',
	}]);
});

test('runtime source capture pins available library edits before their first import', (t) => {
	installBrowserWorkspace(t, new MockStorage());
	installDirtyModel('cartlib/registry.lua', '-- edited library');
	const registry = sourceRegistry('-- packed library', '', 'cartlib/registry.lua', 'library', false);
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system source'), [registry, null], TEST_DOMAIN);
	assert.deepEqual(captureLuaTextModelSources(editorTextModelService, sources).map(source => [source.path, source.source]),
		[['cartlib/registry.lua', '-- edited library']]);
});

test('runtime source capture excludes source-only Lua documents', (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	installDirtyModel('tests/example_assert.lua', '-- edited test');
	const registry = sourceRegistry('-- packed test', 'offline-cart', 'tests/example_assert.lua', 'source-only', false);
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source'),
		[registry, null],
		TEST_DOMAIN,
	);

	assert.deepEqual(captureLuaTextModelSources(editorTextModelService, sources), []);
	assert.equal(getTextFileRuntimeSourceStatus(sources, editorTextModelService.get({ domain: TEST_DOMAIN, path: 'tests/example_assert.lua' })!), 'source_only');
});

test('captured program documents remain authoritative over a later workspace refresh', (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const model = installDirtyModel('src/foo.lua', '-- installed source');
	const registry = sourceRegistry('-- installed source', 'offline-cart', 'src/foo.lua');
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system source'), [registry, null], TEST_DOMAIN);
	const snapshots = captureLuaTextModelSources(editorTextModelService, sources);
	assert.equal(snapshots.length, 1, 'unchanged open models must also pin the request source');
	applyLuaTextModelSources(sources, snapshots);
	assert.equal(sources.cartridgeBlua32MediaDirty[TEST_DOMAIN], false, 'unchanged input must not request a rebuild');
	registry.records[0].src = '-- subsequently saved source';
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- subsequent typing' }]);
	applyLuaTextModelSources(sources, snapshots);
	assert.equal(readWorkspaceLuaSourceText(registry, registry.records[0]), snapshots[0].source);
	assert.equal(sources.cartridgeBlua32MediaDirty[TEST_DOMAIN], true);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending');
});

test('AEM status has no assumed source baseline and failed apply does not restore a previous acknowledgement', (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system source'), [sourceRegistry('-- cart source'), null], TEST_DOMAIN);
	const model = editorTextModelService.retain(testResource('audio.aem', TEST_DOMAIN, 'aem'), 'aem', 'events: {}');
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'untracked');
	sources.aemSourceApplications.set(resourceIdentityKey(model.resource), { installedSource: 'events: {}', failed: false });
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n# edited' }]);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending');
	model.undo();
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
	recordAemSourceApplyFailure(sources, model.resource);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'failed');
	assert.equal(sources.aemSourceApplications.get(resourceIdentityKey(model.resource))!.installedSource, 'events: {}');
});

test('installed source status follows actual media rather than model epochs or saved state', (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const model = installDirtyModel('src/foo.lua', '-- edited source');
	const registry = sourceRegistry('-- installed source', 'offline-cart', 'src/foo.lua');
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system source'), [registry, null], TEST_DOMAIN);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending');
	model.completeSave(model.createSnapshot());
	assert.equal(model.dirty, false);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending');

	const captured = captureLuaTextModelSources(editorTextModelService, sources);
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- newer edit' }]);
	sources.cartridgeSlots[TEST_DOMAIN]!.installedBlua32Sources = new Map([['src.foo', captured[0].source]]);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending');
	model.undo();
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
	assert.equal(model.dirty, false);
	model.redo();
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending');
	model.undo();
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- other branch' }]);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending');
	model.revert();
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
});

test('source status follows a replaced source record under the same retained resource', (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const registry = sourceRegistry('-- source', 'offline-cart', 'src/foo.lua');
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system source'), [registry, null], TEST_DOMAIN);
	const resource = resolveRuntimeResource(sources, { domain: TEST_DOMAIN, path: 'src/foo.lua' })!;
	const model = editorTextModelService.retain(resource, 'lua', '-- source');
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
	registerLuaSourceRecord(registry, { ...registry.records[0], program_module: false });
	rebuildRuntimeSourceResources(sources);
	assert.equal(resolveRuntimeResource(sources, model.resource), resource);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
	sources.cartridgeSlots[TEST_DOMAIN]!.installedBlua32Sources = new Map();
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending');
});

test('source application status keeps equal module paths in their physical execution domains', (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system', 'machine/bios', 'src/foo.lua'),
		[sourceRegistry('-- slot zero', 'cart-zero', 'src/foo.lua'), sourceRegistry('-- slot one', 'cart-one', 'src/foo.lua')],
		TEST_DOMAIN,
	);
	const system = installDirtyModel('src/foo.lua', '-- system', -1);
	const zero = installDirtyModel('src/foo.lua', '-- slot zero', 0);
	const one = installDirtyModel('src/foo.lua', '-- slot one', 1);
	assert.equal(getTextFileRuntimeSourceStatus(sources, system), 'applied');
	assert.equal(getTextFileRuntimeSourceStatus(sources, zero), 'applied');
	assert.equal(getTextFileRuntimeSourceStatus(sources, one), 'applied');
	sources.cartridgeSlots[1]!.installedBlua32Sources = new Map([['src.foo', '-- slot zero']]);
	assert.equal(getTextFileRuntimeSourceStatus(sources, system), 'applied');
	assert.equal(getTextFileRuntimeSourceStatus(sources, zero), 'applied');
	assert.equal(getTextFileRuntimeSourceStatus(sources, one), 'pending');
});

test('browser canonical Save persists only to its configured file provider', async t => {
	const storage = new MockStorage(); installBrowserWorkspace(t, storage);
	await openWorkspaceRecords(workspaceFiles);
	const registry = sourceRegistry('-- old source', 'offline-cart', 'src/foo.lua');
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system source', 'machine/bios'), [registry, null], TEST_DOMAIN);
	const result = await saveLuaResourceSource(workspaceEnvironment.clock, sources,
		{ domain: TEST_DOMAIN, path: 'src/foo.lua' }, '-- saved in browser');
	assert.equal(result.persistence.status, 'browser');
	assert.equal((await workspaceRecords.read('offline-cart/src/foo.lua'))!.contents, '-- saved in browser');
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', 'offline-cart/src/foo.lua'), null);
});

test('library source status and saves follow installed membership rather than packed provenance', async t => {
	installBrowserWorkspace(t, new MockStorage());
	await openWorkspaceRecords(workspaceFiles);
	for (const installed of [false, true]) {
		const path = installed ? 'cartlib/imported.lua' : 'cartlib/unused.lua';
		const registry = sourceRegistry('-- library', '', path, 'library', false);
		const sources = createTestRuntimeSourceState(sourceRegistry('-- system source', 'machine/bios'), [registry, null], TEST_DOMAIN);
		if (installed) sources.cartridgeSlots[TEST_DOMAIN]!.installedBlua32Sources = new Map([[registry.records[0].module_path, '-- library']]);
		const model = installDirtyModel(path, '-- library');
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), installed ? 'applied' : 'source_only');
		await saveLuaResourceSource(workspaceEnvironment.clock, sources, { domain: TEST_DOMAIN, path }, '-- changed library');
		assert.equal(registry.records[0].program_module, false);
		assert.equal(sources.cartridgeBlua32MediaDirty[TEST_DOMAIN], installed);
	}
});

test('source-only Lua saves without scheduling a BLua media rebuild', async (t) => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const registry = sourceRegistry('-- packed test', 'offline-cart', 'tests/example_assert.lua', 'source-only', false);
	const sources = createTestRuntimeSourceState(
		sourceRegistry('-- system source', 'machine/bios'),
		[registry, null],
		TEST_DOMAIN,
	);

	await openWorkspaceRecords(workspaceFiles);
	const result = await saveLuaResourceSource(
		workspaceEnvironment.clock,
		sources,
		{ domain: TEST_DOMAIN, path: 'tests/example_assert.lua' },
		'-- saved test',
	);

	assert.equal(result.persistence.status, 'browser');
	assert.equal(result.record.contents, '-- saved test');
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
	await initializeWorkspaceStorage(workspaceEnvironment.storage, workspaceEnvironment.clock, 'offline-cart', sources, workspaceFiles, testLogOutput);

	await saveLuaResourceSource(workspaceEnvironment.clock, sources, { domain: TEST_DOMAIN, path: 'src/foo.lua' }, '-- saved source');
	const canonicalPath = resolveWorkspacePath('src/foo.lua', 'offline-cart');
	assert.equal(registry.records[0].src, '-- saved source');
	assert.equal(registry.records[0].base_src, '-- saved source');
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', canonicalPath), null);
	assert.equal(readLocalWorkspaceRecord(storage, 'offline-cart', dirtyRecordPath)!.contents, '-- dirty source');
	assert.equal(server.files.get(canonicalPath)!.contents, '-- saved source');
	assert.deepEqual(server.requests.at(-1), { method: 'PUT', path: canonicalPath });
});


test('built-in resolution admits source without opening tabs or stealing the preview', async t => {
	const storage = new MockStorage(); installBrowserWorkspace(t, storage); installWorkspaceRestoreView();
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system'), [sourceRegistry('-- cart'), null], 0);
	const panes = createTestEditorPanes(); t.after(() => panes.dispose());
	initializeTabs(panes);
	openEditorTab(panes, resolveLuaCodeEditorInput(sources, resolveRuntimeResource(sources, { domain: TEST_DOMAIN, path: 'entry.lua' })!));
	const entry = editorTabGroup.activeTab;
	const aem = testResource('res/cue.aem.yaml', 0, 'aem');
	workspaceCanonicalSourceCache.set('offline-cart/res/cue.aem.yaml', { contents: 'events: {}', updatedAt: 0 });
	const resolver = createResourceEditorResolver(sources);
	const revision = editorTabGroup.revision;
	const [first, second] = await Promise.all([resolver.resolveEditorInput(aem), resolver.resolveEditorInput(aem)]);
	assert.equal(editorTabGroup.revision, revision);
	assert.equal(editorTabGroup.activeTab, entry);
	assert.equal(panes.activePane!.input, entry);
	assert.equal(editorTabGroup.tabs.length, 1);
	assert.equal(first.kind, 'aem_editor'); assert.equal(second.kind, 'aem_editor');
	if (first.kind !== 'aem_editor' || second.kind !== 'aem_editor') throw new Error('audio event map contribution');
	assert.equal(first.workingCopy, second.workingCopy, 'both contributions bind the one admitted working copy');
	openEditorTab(panes, first, { pinned: false });
	assert.equal(editorTabGroup.previewTab, first);
	let discarded = 0; second.onWillDispose(() => { discarded += 1; });
	openEditorTab(panes, second, { pinned: false });
	assert.equal(editorTabGroup.activeTab, first);
	assert.equal(editorTabGroup.previewTab, first);
	assert.equal(discarded, 1, 'group admission releases the unused candidate');
	assert.equal(editorTabGroup.tabs.length, 2);
	const system = resolveRuntimeResource(sources, { domain: -1, path: 'entry.lua' })!;
	const previewRevision = editorTabGroup.revision;
	const viewer = await resolver.resolveEditorInput(system, WORKBENCH_RESOURCE_VIEWER_ID);
	assert.equal(editorTabGroup.revision, previewRevision);
	assert.equal(editorTabGroup.previewTab, first);
	assert.equal(viewer.kind, 'resource_view');
	if (viewer.kind !== 'resource_view') throw new Error('resource contribution');
	openEditorTab(panes, viewer);
	viewer.view.scroll = 3;
	assert.equal(await resolver.resolveEditorInput(system, WORKBENCH_RESOURCE_VIEWER_ID), viewer);
	assert.equal(viewer.view.scroll, 3, 'resolving an existing preview preserves its view state');
	assert.equal(editorTabGroup.activeTab, viewer);
	assert.equal(editorTabGroup.tabs.length, 3);
	assert.equal(await resolveTextFileModel(editorTextModelService, sources, aem), first.workingCopy);
	assert.equal(first.workingCopy.mode, 'aem', 'the YAML suffix does not replace AEM source ownership');
});

test('YAML data opens one authored working copy with shared edit history and no Lua installation', async t => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	await openWorkspaceRecords(workspaceFiles);
	t.after(() => resetSemanticProjects(editorTextModelService));
	const registry = sourceRegistry('-- cart');
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system'), [registry, null], 0);
	const project = getOrCreateSemanticProject(editorTextModelService, 0);
	project.synchronizeRuntimeSources(sources);
	const semanticSnapshot = project.getSnapshot();
	const registryRevision = registry.revision;
	const resolver = createResourceEditorResolver(sources);
	const original = '# Authored map: keep comments and spacing\nmap_rows:\n  - "  pM/^^\\\\  " # actor and roof glyphs\nobjects:\n  - type: rock\n    x: 13\n    y: 17\n';

	for (const path of ['res/data/room.yaml', 'res/data/stage.YML']) {
		const resource = testResource(path, 0, 'data');
		server.files.set(`offline-cart/${path}`, { contents: original, updatedAt: 10 });
		sources.cartridgeSlots[0]!.package.data[path] = { cooked: true };
		const [first, second] = await Promise.all([resolver.resolveEditorInput(resource), resolver.resolveEditorInput(resource)]);
		assert.equal(first.kind, 'code_editor');
		assert.equal(second.kind, 'code_editor');
		if (first.kind !== 'code_editor' || second.kind !== 'code_editor') throw new Error('YAML text contribution');
		const model = first.workingCopy;
		assert.equal(model, second.workingCopy);
		assert.equal(model, await resolveTextFileModel(editorTextModelService, sources, resource));
		assert.equal(model.mode, 'yaml');
		assert.equal(model.resource.source.type, 'data');
		assert.equal(getTextSnapshot(model.buffer), original);
		assert.equal(model.dirty, false);
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'untracked');

		const edited = original.replace('x: 13', 'x: 14');
		model.pushEditOperations([{ offset: original.indexOf('13'), deleteLength: 2, text: '14' }]);
		assert.equal(getTextSnapshot(second.workingCopy.buffer), edited);
		assert.equal(model.dirty, true);
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'untracked');
		model.undo();
		assert.equal(getTextSnapshot(model.buffer), original);
		assert.equal(model.dirty, false);
		model.redo();
		assert.equal(getTextSnapshot(model.buffer), edited);
		model.completeSave(model.createSnapshot());
		assert.equal(model.dirty, false);
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'untracked', 'saving source is not installing cooked assets');
		assert.equal(project.getSnapshot().getFileData(path), undefined);
	}
	assert.equal(project.getSnapshot(), semanticSnapshot, 'YAML edits do not invalidate Lua semantics');
	assert.equal(registry.revision, registryRevision);
	assert.equal(registry.records.length, 1);
	assert.deepEqual(captureLuaTextModelSources(editorTextModelService, sources), []);
	assert.equal(sources.cartridgeBlua32MediaDirty[0], false);
});

test('non-YAML data retains its cooked resource preview', async t => {
	const storage = new MockStorage();
	installBrowserWorkspace(t, storage);
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system'), [sourceRegistry('-- cart'), null], 0);
	const resource = testResource('res/data/stage.json', 0, 'data');
	sources.cartridgeSlots[0]!.package.data[resource.source.resid] = { tile_size: 8 };
	const input = await createResourceEditorResolver(sources).resolveEditorInput(resource);
	assert.equal(input.kind, 'resource_view');
	assert.equal(editorTextModelService.get(resource), undefined);
	assert.throws(() => resolveTextFileModel(editorTextModelService, sources, resource), /no editable text format/);
});

test('missing authored YAML fails rather than reconstructing source from cooked data', async t => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	await openWorkspaceRecords(workspaceFiles);
	const sources = createTestRuntimeSourceState(sourceRegistry('-- system'), [sourceRegistry('-- cart'), null], 0);
	const resource = testResource('res/data/missing.yaml', 0, 'data');
	sources.cartridgeSlots[0]!.package.data[resource.source.resid] = { objects: [{ type: 'rock', x: 13, y: 17 }] };
	await assert.rejects(
		async () => createResourceEditorResolver(sources).resolveEditorInput(resource),
		/Source for 'res\/data\/missing\.yaml' is unavailable/,
	);
	assert.equal(editorTextModelService.get(resource), undefined);
	assert.ok(server.requests.some(request => request.method === 'GET' && request.path === 'offline-cart/res/data/missing.yaml'));
});

test('new Lua files belong to their explicit project and are published only after exclusive creation', async t => {
	const storage = new MockStorage();
	const { clock, server } = installWorkspaceServer(t, storage);
	await openWorkspaceRecords(workspaceFiles);
	const system = sourceRegistry('-- BIOS', 'machine/bios');
	const first = sourceRegistry('-- cart A', 'carts/first');
	const second = sourceRegistry('-- cart B', 'carts/second');
	const sources = createTestRuntimeSourceState(system, [first, second], -1);
	const request = { domain: 1 as const, relativePath: 'experiments/actor.lua', contents: 'return {}' };
	const path = 'carts/second/experiments/actor.lua';
	server.files.set(path, { contents: '-- existing unregistered file', updatedAt: 10 });
	const revision = second.revision;
	await assert.rejects(createTextResource(clock, sources, request), /File already exists/);
	assert.equal(second.revision, revision);
	assert.equal(readLocalWorkspaceRecord(storage, second.projectRootPath, path), null);
	assert.equal(server.files.get(path)!.contents, '-- existing unregistered file');
	server.files.delete(path);
	const resource = await createTextResource(clock, sources, request);
	assert.equal(resource.domain, 1, 'BIOS execution does not select the new file owner');
	assert.equal(resource.path, 'experiments/actor.lua');
	assert.equal(second.module2lua['experiments/actor'].normalized_source_path, path);
	assert.equal(second.module2lua['experiments/actor'].src, 'return {}');
	assert.equal(first.records.length, 1);
	assert.equal(system.records.length, 1);
	assert.deepEqual(server.requests.map(request => request.method), ['PUT', 'PUT'], 'exclusive create does not race a separate existence probe');
	await assert.rejects(createTextResource(clock, sources, request), /Lua module already exists/);
	const suite = await createTextResource(clock, sources, { domain: 1,
		relativePath: 'experiments/simple_assert.lua', contents: "return { kind = 'unit', tests = { sample = function() end } }" });
	assert.equal(second.path2lua[suite.path].program_module, false);
	assert.equal(suite.source.resid, '__bmsx_scenario_test__/experiments/simple_assert.lua');
	const other = await createTextResource(clock, sources, { ...request, relativePath: 'other/actor.lua' });
	assert.notEqual(other.source.resid, resource.source.resid, 'different module paths have distinct ROM asset identities');
	for (const relativePath of ['../outside.lua', '/absolute.lua', 'actor.txt', 'bmsx/assets.lua', 'test/ignored.lua']) {
		await assert.rejects(createTextResource(clock, sources, { ...request, relativePath }));
	}
});

test('text resource preparation throws synchronously while creation rejects malformed paths without publishing anything', async t => {
	const storage = new MockStorage();
	const { clock, server } = installWorkspaceServer(t, storage);
	await openWorkspaceRecords(workspaceFiles);
	const registry = sourceRegistry('-- cart', 'carts/project');
	const sources = createTestRuntimeSourceState(sourceRegistry('-- BIOS', 'machine/bios'), [registry, null], 0);
	const revision = registry.revision, resources = sources.resourceByIdentity.size, cachedSources = workspaceCanonicalSourceCache.size;
	for (const [relativePath, message] of [
		['../outside.lua', /inside the project folder/],
		['sub/../../outside.lua', /inside the project folder/],
		['/absolute.lua', /relative to the project folder/],
		['C:\\absolute.lua', /relative to the project folder/],
		['actor?.lua', /Invalid file name/],
		['', /Enter a file name/],
		['folder/', /Enter a file name/],
	] as const) {
		const request = { domain: 0 as const, relativePath, contents: 'return {}' };
		assert.throws(() => prepareTextResourceCreation(request), message, 'review preparation remains synchronous');
		const creation = createTextResource(clock, sources, request);
		assert.ok(creation instanceof Promise, 'the public IO boundary reports failure through its declared Promise');
		await assert.rejects(creation, message);
	}
	assert.equal(server.requests.length, 0, 'invalid paths never reach the canonical file provider');
	assert.equal(server.files.size, 0);
	assert.equal(registry.revision, revision);
	assert.equal(registry.records.length, 1);
	assert.equal(sources.resourceByIdentity.size, resources, 'failed creation never publishes a resource identity');
	assert.equal(workspaceCanonicalSourceCache.size, cachedSources, 'failed creation never publishes cached source');
});


test('workspace opening discovers saved Lua files without depending on open-tab metadata or ROM membership', async t => {
	const storage = new MockStorage();
	const { server } = installWorkspaceServer(t, storage);
	await openWorkspaceRecords(workspaceFiles);
	server.files.set('carts/project/experiments/actor.lua', { contents: 'return { enabled = true }', updatedAt: 20 });
	server.files.set('carts/project/.bmsx/dirty/old.lua', { contents: '-- not a source', updatedAt: 20 });
	server.files.set('carts/project/test/fixture.lua', { contents: '-- excluded by source rules', updatedAt: 20 });
	const registry = sourceRegistry('-- cart', 'carts/project');
	const sources = createTestRuntimeSourceState(sourceRegistry('-- BIOS', 'machine/bios'), [registry, null], 0);
	const observed = await discoverWorkspaceSources(sources);
	await applyAllWorkspaceSourceOverrides(sources, new Map(), observed);
	assert.equal(server.requests.filter(request => request.method === 'GET' && request.path === 'carts/project/experiments/actor.lua').length, 1,
		'workspace opening reuses discovery reads rather than refetching newly admitted source');
	const resource = resolveRuntimeResource(sources, { domain: 0, path: 'experiments/actor.lua' })!;
	assert.equal(resource.source.type, 'lua');
	assert.equal(registry.module2lua['experiments/actor'].src, 'return { enabled = true }');
	assert.equal(registry.module2lua['experiments/actor'].sourceKind, 'project');
	assert.equal(registry.module2lua['experiments/actor'].program_module, false);
	assert.equal(registry.records.length, 2);
	assert.equal(sources.cartridgeBlua32MediaDirty[0], true);
	const revision = registry.revision;
	await discoverWorkspaceSources(sources);
	assert.equal(registry.revision, revision, 'existing packaged and admitted files are not re-registered');
});
