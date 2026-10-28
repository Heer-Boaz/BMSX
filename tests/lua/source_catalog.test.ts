import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { resourceIdentityKey } from '../../ide/common/resource';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { EditorLuaSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/project';
import { DiskWorkspaceRecordProvider } from '../../ide/node/workspace_records';
import { createLuaSourceRegistry, registerLuaSourceRecord, type LuaSourceRecord } from '../../ide/runtime/source_registry';
import { createLoadedProjectSourceCatalog, createRuntimeSourceState, forkRuntimeSourceState } from '../../ide/runtime/sources';
import { WorkspaceSourceRecovery } from '../../ide/workbench/services/working_copy/source_recovery';
import { resolveTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { readWorkspaceLuaSourceText } from '../../ide/workspace/files';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { WorkspaceSourceCatalog } from '../../ide/workspace/source_catalog';
import { applyAllWorkspaceSourceOverrides, applyLuaTextModelSources, discoverWorkspaceSources } from '../../ide/workspace/workspace';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { createTestToolingPackage } from '../helpers/runtime_sources';
import { buildScenarioMediaFixture } from '../helpers/scenario_media';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';

function sourceRecord(path: string, modulePath: string, canonicalPath: string, source: string): LuaSourceRecord {
	return { resid: modulePath, type: 'lua', src: source, base_src: source, base_update_timestamp: 0,
		source_path: path, normalized_source_path: canonicalPath, module_path: modulePath,
		update_timestamp: 0, generated: false, sourceKind: 'project', program_module: false };
}

function admitSourceFixture(catalog: WorkspaceSourceCatalog, id: string, root: string, records: readonly LuaSourceRecord[], dependencies: readonly string[] = [], assets: readonly RomAsset[] = []) {
	const registry = createLuaSourceRegistry(root, 'entry.lua');
	for (const record of records) registerLuaSourceRecord(registry, record);
	return catalog.admitContext({ admission: { id, projectRoot: root }, programDomain: 'cart', systemContextId: null,
		luaSources: registry, sourceRoots: [{ path: root, resourcePathPrefix: '', modulePathPrefix: '', structured: true, sourceKind: 'project' }],
		dependencyContextIds: dependencies, previewPackage: createTestToolingPackage(root), previewRom: null, assetSources: assets });
}

test('file admission consumes source provenance independently of asset type and keeps canonical Lua authority', t => {
	const catalog = new WorkspaceSourceCatalog(); t.after(() => catalog.dispose());
	const source = sourceRecord('shared.lua', 'shared', 'cartlib/shared.lua', 'return 1');
	const assets: RomAsset[] = [
		{ type: 'bin', resid: 'raw', source_path: 'res/raw.bin' },
		{ type: 'audio', resid: 'sound', source_path: 'res/sound.wav' },
		{ type: 'model', resid: 'model', source_path: 'res/model.glb' },
		{ type: 'image', resid: 'image', source_path: 'res/image.png' },
		{ type: 'romlabel', resid: 'label', source_path: 'res/label.png' },
		{ type: 'code', resid: 'assembled', source_path: 'res/program.asm' },
		{ type: 'code', resid: 'generated-program' },
		{ type: 'lua', resid: 'packed-shared', source_path: source.source_path },
	];
	admitSourceFixture(catalog, 'source-project', 'carts/project', [source], [], assets);
	assert.equal(catalog.resources.length, 7);
	for (const asset of assets.slice(0, 6)) {
		const resource = catalog.resolveResource({ contextId: 'source-project', path: asset.source_path! })!;
		assert.ok(resource.source === asset);
		assert.equal(resource.sourceFilePath, `carts/project/${asset.source_path}`);
		assert.equal(resource.location.kind, 'project');
	}
	const lua = catalog.resolveResource({ contextId: 'source-project', path: source.source_path })!;
	assert.ok(lua.source === source && catalog.luaResources[0] === lua);
	assert.equal(lua.sourceFilePath, 'cartlib/shared.lua'); assert.equal(lua.location.kind, 'workspace');
	const retained = [...catalog.resources]; catalog.rebuildResources();
	assert.ok(retained.every(resource => catalog.resolveResource(resource) === resource));
	const fork = catalog.fork(); t.after(() => fork.dispose());
	assert.equal(fork.resources.length, retained.length);
	assert.equal(fork.resolveResource(lua)!.sourceFilePath, lua.sourceFilePath);
});

test('working copies share admitted identity, never canonical file provenance or configuration values', t => {
	const catalog = new WorkspaceSourceCatalog(), models = new EditorTextModelService();
	t.after(() => { models.clear(); catalog.dispose(); });
	for (const id of ['first-admission', 'second-admission']) {
		admitSourceFixture(catalog, id, 'carts/same', [sourceRecord('shared.lua', 'shared', 'cartlib/shared.lua', 'return 1')]);
	}
	const first = catalog.resolveResource({ contextId: 'first-admission', path: 'shared.lua' })!;
	const second = catalog.resolveResource({ contextId: 'second-admission', path: 'shared.lua' })!;
	assert.equal(first.sourceFilePath, second.sourceFilePath);
	assert.equal(first.contextLabel, second.contextLabel);
	assert.notEqual(resourceIdentityKey(first), resourceIdentityKey(second));
	const firstModel = models.retain(first, 'lua', 'return 1'), secondModel = models.retain(second, 'lua', 'return 1');
	assert.equal(models.retain(first, 'lua', 'return 1'), firstModel);
	assert.notEqual(firstModel, secondModel);
	firstModel.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- first only\n' }]);
	assert.equal(secondModel.buffer.getText(), 'return 1');
	assert.equal(secondModel.dirty, false);
});

test('admitted dependencies own module and asset shadowing and invalidate membership bindings', t => {
	const catalog = new WorkspaceSourceCatalog(), models = new EditorTextModelService();
	const dependency = admitSourceFixture(catalog, 'dependency', 'library', [sourceRecord('shared.lua', 'shared', 'library/shared.lua', 'return 1')]);
	const primary = admitSourceFixture(catalog, 'primary', 'project', [sourceRecord('entry.lua', 'entry', 'project/entry.lua', "return require('shared')")], ['dependency']);
	dependency.previewPackage.data.value = { origin: 'dependency' };
	primary.previewPackage.data.value = { origin: 'primary' };
	assert.deepEqual(catalog.resolveModule(primary.id, 'shared'), catalog.resolveResource({ contextId: dependency.id, path: 'shared.lua' }));
	assert.equal(catalog.resolveAsset(primary.id, 'data', 'value')!.contextId, primary.id);
	const before = catalog.getModuleBindings(primary.id);
	assert.equal(catalog.getModuleBindings(primary.id), before);
	registerLuaSourceRecord(primary.luaSources, sourceRecord('shared.lua', 'shared', 'project/shared.lua', 'return 2'));
	assert.notEqual(catalog.getModuleBindings(primary.id), before);
	assert.equal(catalog.resolveModule(primary.id, 'shared')!.contextId, primary.id);
	assert.equal(catalog.resolveModule(dependency.id, 'shared')!.contextId, dependency.id);
	const project = new EditorLuaSemanticProject(primary.id, models);
	t.after(() => { project.dispose(); models.clear(); catalog.dispose(); });
	project.synchronizeSources(catalog);
	assert.equal(project.getModuleCatalog({ contextId: dependency.id, path: 'shared.lua' }).get('shared'), resourceIdentityKey({ contextId: dependency.id, path: 'shared.lua' }));
	assert.equal(project.getModuleCatalog({ contextId: primary.id, path: 'shared.lua' }).get('shared'), resourceIdentityKey({ contextId: primary.id, path: 'shared.lua' }));
});

test('one retained context has independent installed generations in both sockets and survives detachment', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-source-catalog-images-'));
	t.after(async () => { clearWorkspaceSourceCaches(); await rm(root, { recursive: true, force: true }); });
	const firstDirectory = join(root, 'first'), secondDirectory = join(root, 'second');
	await mkdir(firstDirectory); await mkdir(secondDirectory);
	const systemSource = 'module<entry>\nreturn true';
	const firstSource = 'module<entry>\nreturn 11', secondSource = 'module<entry>\nreturn 22', authored = 'module<entry>\nreturn 33';
	const first = await buildScenarioMediaFixture(firstDirectory, [], { systemSource, systemModules: [], cartSource: firstSource });
	const second = await buildScenarioMediaFixture(secondDirectory, [], { systemSource, systemModules: [], cartSource: secondSource });
	const firstMedia = await loadRomToolingMedia(first.systemRom, [first.cartRom, null]);
	const secondMedia = await loadRomToolingMedia(second.systemRom, [second.cartRom, null]);
	const systemAdmission = { id: 'retained-system', projectRoot: firstMedia.system.index.projectRootPath };
	const cartridgeAdmission = { id: 'retained-project', projectRoot: firstMedia.cartridgeSlots[0]!.index.projectRootPath };
	const catalog = createLoadedProjectSourceCatalog({ admission: systemAdmission, layer: firstMedia.system },
		[{ admission: cartridgeAdmission, layer: firstMedia.cartridgeSlots[0]! }]);
	t.after(() => catalog.dispose());
	const identity = { contextId: cartridgeAdmission.id, path: 'entry.lua' };
	applyLuaTextModelSources(catalog, [{ ...identity, source: authored }]);
	const resource = catalog.resolveResource(identity)!;
	const attached = createRuntimeSourceState(firstMedia.system, [firstMedia.cartridgeSlots[0], secondMedia.cartridgeSlots[0]],
		{ catalog, systemContextId: systemAdmission.id, cartridgeContextIds: [cartridgeAdmission.id, cartridgeAdmission.id] });
	assert.equal(catalog.contexts.size, 2);
	assert.equal(attached.currentBlua32Media.cartridgeSlots[0]!.sourceContextId, cartridgeAdmission.id);
	assert.equal(attached.currentBlua32Media.cartridgeSlots[1]!.sourceContextId, cartridgeAdmission.id);
	assert.equal(attached.currentBlua32Media.cartridgeSlots[0]!.sources.get('entry')!.content.kind, 'text');
	assert.equal(attached.cartridgeSlots[0]!.installedBlua32Sources.get('entry'), firstSource);
	assert.equal(attached.cartridgeSlots[1]!.installedBlua32Sources.get('entry'), secondSource);
	assert.equal(readWorkspaceLuaSourceText(catalog.getContext(cartridgeAdmission.id).luaSources, catalog.resolveLuaSource(identity)!.record), authored);
	assert.equal(attached.cartridgeSlots[0]!.installedSourceRevision, -1);
	assert.equal(attached.cartridgeSlots[1]!.installedSourceRevision, -1);
	const fork = forkRuntimeSourceState(attached);
	t.after(() => fork.catalog.dispose());
	assert.equal(fork.catalog.contexts.size, 2);
	assert.notEqual(fork.catalog.getContext(cartridgeAdmission.id).luaSources, catalog.getContext(cartridgeAdmission.id).luaSources);
	assert.equal(fork.cartridgeSlots[0]!.contextId, fork.cartridgeSlots[1]!.contextId);
	applyLuaTextModelSources(fork.catalog, [{ ...identity, source: 'module<entry>\nreturn 44' }]);
	assert.equal(readWorkspaceLuaSourceText(catalog.getContext(cartridgeAdmission.id).luaSources, catalog.resolveLuaSource(identity)!.record), authored);
	attached.cartridgeSlots[0] = null; attached.cartridgeSlots[1] = null;
	assert.equal(catalog.resolveResource(identity), resource);
});

test('a source-only admission discovers, analyzes, recovers and saves through the ordinary working-copy owners', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-source-only-catalog-'));
	const projectRoot = 'projects/source-only', contextId = 'persisted-source-only-admission';
	const original = 'local value = 1\nreturn value\n', draft = '-- recovered draft\n' + original;
	await mkdir(join(root, projectRoot), { recursive: true });
	await writeFile(join(root, projectRoot, 'entry.lua'), original);
	await openWorkspaceRecords(new DiskWorkspaceRecordProvider(root));
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); await rm(root, { recursive: true, force: true }); });
	const create = () => {
		const catalog = new WorkspaceSourceCatalog(), models = new EditorTextModelService(), clock = new VirtualHeadlessClock();
		admitSourceFixture(catalog, contextId, projectRoot, []);
		const recovery = new WorkspaceSourceRecovery({ identity: 'source-only-session', sourceContextId: contextId, projectRootPath: projectRoot,
			catalog, models, clock, logOutput: { log() {} } });
		return { catalog, models, clock, recovery };
	};
	const identity = { contextId, path: 'entry.lua' }, first = create();
	await first.recovery.initialize();
	await discoverWorkspaceSources(first.catalog);
	first.recovery.start();
	const resource = first.catalog.resolveResource(identity)!;
	assert.equal(first.catalog.getContext(contextId).previewRom, null);
	const model = await resolveTextFileModel(first.models, first.catalog, resource);
	const semantic = new EditorLuaSemanticProject(contextId, first.models);
	semantic.synchronizeSources(first.catalog);
	assert.equal(semantic.getFileData(identity)!.source, original);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- recovered draft\n' }]);
	assert.equal(semantic.getFileData(identity)!.source, draft);
	const key = resourceIdentityKey(model.identity);
	await first.recovery.shutdown(); semantic.dispose(); first.models.clear(); first.catalog.dispose(); clearWorkspaceSourceCaches();
	assert.equal(await readFile(join(root, projectRoot, 'entry.lua'), 'utf8'), original);
	const second = create();
	const recovered = await second.recovery.initialize();
	const observed = await discoverWorkspaceSources(second.catalog);
	await applyAllWorkspaceSourceOverrides(second.catalog, recovered, observed);
	await second.recovery.restoreModels(); second.recovery.start();
	const restored = second.models.get(identity)!;
	assert.equal(resourceIdentityKey(restored.identity), key);
	assert.equal(restored.buffer.getText(), draft);
	assert.equal(restored.dirty, true);
	const saves = new TextFileSaveService(second.models, second.clock, second.catalog);
	assert.equal((await saves.save(restored).completion).status, 'saved');
	assert.equal(await readFile(join(root, projectRoot, 'entry.lua'), 'utf8'), draft);
	assert.equal(restored.dirty, false);
	const savedRevision = second.catalog.getContext(contextId).programRevision;
	assert.equal((await saves.save(restored).completion).status, 'saved');
	assert.equal(second.catalog.getContext(contextId).programRevision, savedRevision, 'an equal-source Save does not request another compilation');
	await saves.shutdown(); await second.recovery.discard(); second.models.clear(); second.catalog.dispose();
});
