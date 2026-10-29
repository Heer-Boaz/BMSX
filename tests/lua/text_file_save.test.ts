import { finalizePackedRomAssets } from '../../toolchain/ts/rompack/assets';
import { installRuntimeRomLayers } from '../../ide/runtime/sources';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorTextModel } from '../../ide/editor/model/text_model';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';
import { MemoryStorage } from '../../ide/workspace/memory_storage';
import type { WorkspaceRecord, WorkspaceRecordProvider } from '../../ide/workspace/record_provider';
import { closeWorkspaceRecords, openWorkspaceRecords, readLocalWorkspaceRecord, writeLocalWorkspaceRecord, workspaceRecords } from '../../ide/workspace/records';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { saveTextFileFromCommand } from '../../ide/commands/source_save';
import type { CartEditor } from '../../ide/cart_editor';
import { editorFeedbackState } from '../../ide/common/feedback_state';
import { getTextFileRuntimeSourceStatus } from '../../ide/workbench/services/working_copy/runtime_source_status';
import { resolveWorkspacePath } from '../../ide/workspace/path';

class SaveStorage extends MemoryStorage {
	public failure: Error | undefined;
	public override setItem(key: string, value: string): void {
		if (this.failure) throw this.failure;
		super.setItem(key, value);
	}
}

class SaveFiles implements WorkspaceRecordProvider {
	public readonly persistence = 'workspace';
	public readonly records = new Map<string, WorkspaceRecord>();
	public readonly writes: { path: string; record: WorkspaceRecord; complete(): void }[] = [];
	public delayed = false;
	public failure: Error | undefined;
	public async read(path: string): Promise<WorkspaceRecord | null> { return this.records.get(path) ?? null; }
	public async readDirectory() { return []; }
	public async delete(path: string): Promise<void> { this.records.delete(path); }
	public async write(path: string, record: WorkspaceRecord): Promise<void> {
		if (this.failure) throw this.failure;
		if (this.delayed) await new Promise<void>(resolve => this.writes.push({ path, record, complete: resolve }));
		this.records.set(path, record);
	}
}

async function fixture(t: TestContext) {
	const storage = new SaveStorage();
	const files = new SaveFiles();
	const clock = new VirtualHeadlessClock();
	const root = 'carts/nemesis_s';
	const lua = createScenarioTestSourceRecord(`${root}/tests/save.lua`, 1, 'return true', `${root}/tests/save.lua`);
	const sources = createScenarioTestSourceState([lua]);
	const models = new EditorTextModelService();
	const saves = new TextFileSaveService(models, clock, sources.catalog);
	await openWorkspaceRecords(files);
	t.after(async () => {
		await saves.shutdown();
		models.clear();
		await closeWorkspaceRecords();
		clearWorkspaceSourceCaches();
	});
	const yaml = (path = 'res/data/save.yaml') => models.retain({ contextLabel: 'Fixture project', sourceFilePath: resolveWorkspacePath(path, root), location: { kind: 'project', projectRootPath: root, path }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path,
		source: { resid: path, type: 'data' } }, 'yaml', '# untouched\nvalue: 1\n');
	return { saves, models, storage, files, clock, root, yaml, sources, lua };
}

function setSource(model: EditorTextModel, source: string): void {
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
}

test('Save admission belongs to the writable model independently of clean or dirty source', async t => {
	const f = await fixture(t), model = f.yaml();
	assert.equal(model.dirty, false);
	assert.equal(f.saves.canSave(model), true);
	const clean = await f.saves.save(model).completion;
	assert.equal(clean.status, 'saved');
	assert.equal(f.files.records.get(model.resource.sourceFilePath!)!.contents, model.buffer.getText());
	setSource(model, 'value: dirty\n');
	assert.equal(model.dirty, true);
	assert.equal(f.saves.canSave(model), true);
	assert.equal((await f.saves.save(model).completion).status, 'saved');
	assert.equal(model.dirty, false);
	assert.equal(f.saves.canSave(model), true);
});

for (const mode of ['yaml', 'aem'] as const) test(`${mode} Save writes its admitted file address rather than the cartridge root`, async t => {
	const f = await fixture(t), sourceFilePath = `shared/authoring/save.${mode}`;
	const model = f.models.retain({ contextLabel: 'Fixture project', contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/save.yaml', sourceFilePath,
		location: { kind: 'workspace', path: sourceFilePath }, source: { type: mode === 'aem' ? 'aem' : 'data', resid: 'save' } },
		mode, 'value: original\n');
	setSource(model, 'value: saved\n');
	const result = await f.saves.save(model).completion;
	assert.equal(result.status, 'saved');
	assert.equal(f.files.records.get(sourceFilePath)!.contents, 'value: saved\n');
	assert.equal(f.files.records.has(`${f.root}/res/save.yaml`), false);
	assert.equal(model.dirty, false);
});

test('local storage failure keeps source dirty; recovery cannot masquerade as a saved file or replay on read', async t => {
	const f = await fixture(t), model = f.yaml();
	assert.equal(f.files.records.size, 0, 'opening local storage performs no probe writes');
	setSource(model, 'value: 2\n');
	f.files.failure = new Error('local store write refused');
	const failed = await f.saves.save(model).completion;
	assert.equal(failed.status, 'failed');
	assert.equal(model.dirty, true);
	const path = `${f.root}/${model.resource.path}`;
	assert.equal(readLocalWorkspaceRecord(f.storage, f.root, path), null);
	writeLocalWorkspaceRecord(f.storage, f.root, path, { contents: 'newer recovery, not canonical source', updatedAt: 99999 });
	assert.equal(await workspaceRecords.read(path), null);
	assert.equal(f.files.records.size, 0);
	f.files.failure = undefined;
	assert.equal((await f.saves.save(model).completion).status, 'saved');
	assert.equal(f.files.records.get(path)!.contents, 'value: 2\n');
	assert.equal(model.dirty, false);
});

test('Save captures and coalesces one revision, while newer edits remain dirty', async t => {
	const f = await fixture(t);
	const model = f.yaml();
	setSource(model, '# untouched\nvalue: 2\n');
	f.files.delayed = true;
	const first = f.saves.save(model);
	assert.equal(f.saves.canSave(model), true);
	assert.equal(f.saves.save(model), first);
	setSource(model, '# untouched\nvalue: 3\n');
	await setImmediate();
	assert.equal(f.files.writes.length, 1);
	f.files.writes[0].complete();
	const result = await first.completion;
	assert.equal(result.status, 'saved');
	if (result.status !== 'saved') assert.fail('expected a saved source');
	assert.deepEqual(result.persistence, { status: 'workspace' });
	assert.equal(result.snapshot.source, '# untouched\nvalue: 2\n');
	assert.equal(model.lastSavedSource, result.snapshot.source);
	assert.equal(model.dirty, true);
	assert.equal(model.buffer.getText(), '# untouched\nvalue: 3\n');
	model.undo();
	assert.equal(model.dirty, false, 'saved identity still participates in ordinary Undo');
});

test('Save serializes each resource, captures queued text at admission and lets other files proceed', async t => {
	const f = await fixture(t);
	const model = f.yaml(), other = f.yaml('res/data/other.yaml');
	f.files.delayed = true;
	setSource(model, 'value: 2');
	const first = f.saves.save(model);
	setSource(model, 'value: 3');
	const second = f.saves.save(model);
	assert.equal(f.saves.save(model), second);
	setSource(model, 'value: 4');
	setSource(other, 'other: 2');
	const independent = f.saves.save(other);
	await setImmediate();
	assert.equal(f.files.writes.length, 2, 'only the first source write waits; the other resource is independent');
	f.files.writes[1].complete();
	await independent.completion;
	assert.equal(other.dirty, false);
	f.files.writes[0].complete();
	await first.completion;
	await setImmediate();
	assert.equal(f.files.writes[2].record.contents, 'value: 3');
	f.files.writes[2].complete();
	assert.equal((await second.completion).snapshot.source, 'value: 3');
	assert.equal(model.lastSavedSource, 'value: 3');
	assert.equal(model.buffer.getText(), 'value: 4');
	assert.equal(model.dirty, true);
});

test('shutdown joins every accepted source save before its callers may tear down the workspace', async t => {
	const f = await fixture(t);
	const model = f.yaml();
	f.files.delayed = true;
	setSource(model, 'value: 2');
	const first = f.saves.save(model);
	setSource(model, 'value: 3');
	const second = f.saves.save(model);
	assert.equal(f.saves.canSave(model), true);
	assert.equal(f.saves.save(model), second);
	let stopped = false;
	const closing = f.saves.shutdown().then(() => { stopped = true; });
	assert.equal(f.saves.acceptingSaves, false);
	assert.equal(f.saves.canSave(model), false);
	assert.throws(() => f.saves.save(model), /shutdown/);
	await setImmediate();
	assert.equal(stopped, false);
	f.files.writes[0].complete();
	await first.completion;
	await setImmediate();
	assert.equal(stopped, false);
	f.files.writes[1].complete();
	await second.completion;
	await closing;
	assert.equal(stopped, true);
	assert.equal(model.dirty, false);
	assert.equal(f.files.records.get(model.resource.sourceFilePath!)!.contents, 'value: 3');
	assert.equal(f.saves.canSave(model), false);
});

test('queued Saves retain their admitted file address across retained resource metadata refresh', async t => {
	const f = await fixture(t), model = f.yaml(), sourceFilePath = model.resource.sourceFilePath!;
	f.files.delayed = true;
	setSource(model, 'value: first\n');
	const first = f.saves.save(model);
	setSource(model, 'value: second\n');
	const second = f.saves.save(model);
	model.refreshResource({ ...model.resource, sourceFilePath: 'shared/new-authority.yaml',
		location: { kind: 'workspace', path: 'shared/new-authority.yaml' } });
	await setImmediate();
	f.files.writes[0].complete();
	await first.completion;
	await setImmediate();
	assert.equal(f.files.writes[1].path, sourceFilePath);
	f.files.writes[1].complete();
	assert.equal((await second.completion).status, 'saved');
	assert.equal(f.files.records.get(sourceFilePath)!.contents, 'value: second\n');
	assert.equal(f.files.records.has('shared/new-authority.yaml'), false);
});

test('source persistence failure is an explicit outcome, does not complete the snapshot and allows a later save', async t => {
	const f = await fixture(t);
	const model = f.yaml();
	setSource(model, 'value: 2');
	const error = new Error('filesystem unavailable');
	f.files.failure = error;
	const result = await f.saves.save(model).completion;
	assert.equal(result.status, 'failed');
	if (result.status !== 'failed') assert.fail('expected failed source persistence');
	assert.equal(result.error, error);
	assert.equal(model.dirty, true);
	assert.equal(model.lastSavedSource, '# untouched\nvalue: 1\n');
	f.files.failure = undefined;
	assert.equal((await f.saves.save(model).completion).status, 'saved');
	assert.equal(model.dirty, false);
});

test('a failed write keeps source dirty and cannot be replayed by reading; only a new Save commits it', async t => {
	const f = await fixture(t), model = f.yaml(), path = `${f.root}/${model.resource.path}`;
	const error = new Error('project filesystem unavailable');
	const saved: EditorTextModel[] = [];
	f.models.onDidSaveModel(model => saved.push(model));
	setSource(model, 'value: 2'); f.files.failure = error;
	const result = await f.saves.save(model).completion;
	if (result.status !== 'failed') assert.fail('expected a failed canonical write');
	assert.equal(result.error, error); assert.equal(model.dirty, true);
	assert.equal(model.lastSavedSource, '# untouched\nvalue: 1\n');
	setSource(model, 'value: 3'); f.files.failure = undefined;
	assert.equal(await workspaceRecords.read(path), null);
	assert.equal(f.files.records.has(path), false); assert.deepEqual(saved, []);
	const retried = await f.saves.save(model).completion;
	if (retried.status !== 'saved') assert.fail('expected a workspace save');
	assert.equal(retried.persistence.status, 'workspace');
	assert.equal(f.files.records.get(path)!.contents, 'value: 3'); assert.equal(model.dirty, false);
	assert.equal(result.status, 'failed', 'the original acknowledgement never changes');
});

test('failed Lua save cannot promote the source catalog or its saved baseline', async t => {
	const f = await fixture(t), model = f.models.retain(f.sources.catalog.luaResources[0], 'lua', f.lua.src);
	setSource(model, 'return false'); f.files.failure = new Error('write denied');
	assert.equal((await f.saves.save(model).completion).status, 'failed');
	assert.equal(f.lua.src, 'return true'); assert.equal(f.lua.base_src, 'return true'); assert.equal(model.dirty, true);
	f.files.failure = undefined;
	assert.equal((await f.saves.save(model).completion).status, 'saved'); assert.equal(f.lua.src, 'return false');
});

test('a rejected file operation does not change an independent in-flight Save', async t => {
	const f = await fixture(t), model = f.yaml();
	setSource(model, 'value: 2'); f.files.delayed = true;
	const pending = f.saves.save(model); await setImmediate();
	f.files.failure = new Error('another resource failed');
	await assert.rejects(workspaceRecords.write('other.lua', { contents: '', updatedAt: 1 }), /another resource/);
	f.files.writes[0].complete();
	const result = await pending.completion;
	if (result.status !== 'saved') assert.fail('expected saved source');
	assert.deepEqual(result.persistence, { status: 'workspace' }); assert.equal(model.dirty, false);
});

test('Save command reports a write failure as an error, with the unsaved source retained', async t => {
	const f = await fixture(t), model = f.yaml(); setSource(model, 'value: 2');
	f.files.failure = new Error('project filesystem unavailable');
	const result = await saveTextFileFromCommand(f.saves, model, {} as CartEditor, f.sources);
	assert.equal(result.status, 'failed'); assert.equal(model.dirty, true);
	assert.equal(editorFeedbackState.message.kind, 'error');
});

test('YAML Save feedback distinguishes installed equality, a pending asset build and unavailable source provenance', async t => {
	const f = await fixture(t), model = f.yaml();
	const original = model.buffer.getText(), media = f.sources.currentBlua32Media;
	const installed = [{ ...model.resource.source, sourcemeta: { text: original } }]; finalizePackedRomAssets(installed);
	f.sources.cartridgeSlots[0]!.rom.index.entries.push(...installed);
	assert.equal((await saveTextFileFromCommand(f.saves, model, {} as CartEditor, f.sources)).status, 'saved');
	assert.equal(editorFeedbackState.message.kind, 'success');
	setSource(model, 'value: 2\n');
	await saveTextFileFromCommand(f.saves, model, {} as CartEditor, f.sources);
	assert.equal(editorFeedbackState.message.kind, 'warning');
	assert.equal(model.dirty, false);
	assert.equal(getTextFileRuntimeSourceStatus(f.sources, model), 'pending');
	assert.equal(installed[0].sourcemeta.text, original);
	assert.equal(f.sources.currentBlua32Media, media, 'Save and its presentation cannot install data');
	const assets = [{ type: 'data' as const, resid: model.resource.source.resid }]; finalizePackedRomAssets(assets);
	const layer = f.sources.cartridgeSlots[0]!.rom;
	installRuntimeRomLayers(f.sources, null, [{ id: 'cart', bytes: new Uint8Array(layer.bytes),
		index: { ...layer.index, entries: assets } }, null]);
	await saveTextFileFromCommand(f.saves, model, {} as CartEditor, f.sources);
	assert.equal(editorFeedbackState.message.kind, 'warning');
	assert.equal(getTextFileRuntimeSourceStatus(f.sources, model), 'untracked');
});

test('YAML Save retains the captured write and current source status when typing overtakes it', async t => {
	const f = await fixture(t), model = f.yaml(), original = model.buffer.getText();
	const installed = [{ ...model.resource.source, sourcemeta: { text: original } }]; finalizePackedRomAssets(installed);
	f.sources.cartridgeSlots[0]!.rom.index.entries.push(...installed);
	setSource(model, 'value: 2\n'); f.files.delayed = true;
	const saving = saveTextFileFromCommand(f.saves, model, {} as CartEditor, f.sources);
	await setImmediate();
	model.undo();
	f.files.writes[0].complete();
	const result = await saving;
	assert.equal(result.snapshot.source, 'value: 2\n');
	assert.equal(model.buffer.getText(), original); assert.equal(model.dirty, true);
	assert.equal(getTextFileRuntimeSourceStatus(f.sources, model), 'applied');
	assert.equal(editorFeedbackState.message.kind, 'success');
	assert.equal(f.files.records.get(`${f.root}/${model.resource.path}`)!.contents, 'value: 2\n');
});

test('recovery storage cannot turn an acknowledged canonical write into a failed Save', async t => {
	const f = await fixture(t), model = f.yaml(); setSource(model, 'value: 2');
	f.storage.failure = new Error('recovery quota exhausted');
	assert.equal((await f.saves.save(model).completion).status, 'saved');
	assert.equal(f.files.records.get(`${f.root}/${model.resource.path}`)!.contents, 'value: 2');
	assert.equal(model.dirty, false);
});

test('AEM Save persists malformed authored text without entering an installation operation', async t => {
	const f = await fixture(t);
	const cartridge = f.sources.cartridgeSlots[0]!;
	cartridge.installedBlua32Sources = new Map([['cartlib/aem', 'return {}']]);
	const installedEventMap = {};
	cartridge.package.audioevents.cue = installedEventMap;
	const media = f.sources.currentBlua32Media;
	const model = f.models.retain({ contextLabel: 'Fixture project', sourceFilePath: resolveWorkspacePath('res/cue.aem.yaml', f.root), location: { kind: 'project', projectRootPath: f.root, path: 'res/cue.aem.yaml' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/cue.aem.yaml', source: { resid: 'cue', type: 'aem' } }, 'aem', '{}');
	setSource(model, '[');
	const result = await f.saves.save(model).completion;
	if (result.status !== 'saved') assert.fail('expected source Save acknowledgement');
	assert.equal(result.application.status, 'not-requested');
	assert.deepEqual(result.persistence, { status: 'workspace' });
	assert.equal(f.files.records.get(`${f.root}/${model.resource.path}`)!.contents, '[');
	assert.equal(model.lastSavedSource, '[');
	assert.equal(model.dirty, false);
	assert.equal(f.sources.currentBlua32Media, media);
	assert.equal(cartridge.package.audioevents.cue, installedEventMap);
	assert.equal(f.sources.aemSourceApplications.size, 0);
});

for (const reason of ['module-not-installed', 'asset-not-installed'] as const) {
	test(`AEM Save preserves malformed source without building when ${reason}`, async t => {
		const f = await fixture(t);
		const cartridge = f.sources.cartridgeSlots[0]!;
		if (reason === 'module-not-installed') {
			cartridge.package.audioevents.cue = {};
		} else {
			cartridge.installedBlua32Sources = new Map([['cartlib/aem', 'return {}']]);
		}
		const model = f.models.retain({ contextLabel: 'Fixture project', sourceFilePath: resolveWorkspacePath('res/cue.aem.yaml', f.root), location: { kind: 'project', projectRootPath: f.root, path: 'res/cue.aem.yaml' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/cue.aem.yaml', source: { resid: 'cue', type: 'aem' } }, 'aem', '{}');
		setSource(model, '[');
		const media = f.sources.currentBlua32Media;
		const installedEventMap = cartridge.package.audioevents.cue;
		const result = await f.saves.save(model).completion;
		if (result.status !== 'saved') assert.fail('expected saved source');
		assert.deepEqual(result.application, { status: 'not-requested' });
		assert.deepEqual(result.persistence, { status: 'workspace' });
		assert.equal(f.files.records.get(`${f.root}/${model.resource.path}`)!.contents, '[');
		assert.equal(model.lastSavedSource, '[');
		assert.equal(model.dirty, false);
		assert.equal(f.sources.currentBlua32Media, media);
		assert.equal(cartridge.package.audioevents.cue, installedEventMap);
		assert.equal(f.sources.aemSourceApplications.size, 0);
	});
}

test('inactive AEM saves source without attempting another domain\'s build or guest reload', async t => {
	const f = await fixture(t);
	f.sources.activeCartridgeSlot = -1;
	const model = f.models.retain({ contextLabel: 'Fixture project', sourceFilePath: resolveWorkspacePath('res/cue.aem.yaml', f.root), location: { kind: 'project', projectRootPath: f.root, path: 'res/cue.aem.yaml' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/cue.aem.yaml', source: { resid: 'cue', type: 'aem' } }, 'aem', '{}');
	setSource(model, '[');
	const media = f.sources.currentBlua32Media;
	const result = await f.saves.save(model).completion;
	assert.equal(result.status, 'saved');
	if (result.status !== 'saved') assert.fail();
	assert.deepEqual(result.application, { status: 'not-requested' });
	assert.equal(f.files.records.get(`${f.root}/${model.resource.path}`)!.contents, '[');
	assert.equal(model.dirty, false);
	assert.equal(f.sources.currentBlua32Media, media);
	assert.equal(f.sources.aemSourceApplications.size, 0);
});


test('source-only Lua uses its catalog owner and publishes one model-service save event', async t => {
	const f = await fixture(t);
	const model = f.models.retain(f.sources.catalog.luaResources[0], 'lua', f.lua.src);
	setSource(model, 'return false');
	const saved: EditorTextModel[] = [];
	const dispose = f.models.onDidSaveModel(model => saved.push(model));
	const result = await f.saves.save(model).completion;
	assert.equal(result.status, 'saved');
	assert.deepEqual(saved, [model]);
	assert.equal(f.lua.src, 'return false');
	assert.equal(f.files.records.get(f.lua.normalized_source_path)!.contents, 'return false');
	dispose();
	model.completeSave(model.createSnapshot());
	assert.deepEqual(saved, [model]);
});

test('read-only resources are rejected at save admission, before writes or snapshot completion', async t => {
	const f = await fixture(t);
	const model = f.yaml();
	assert.equal(f.saves.canSave(model), true);
	model.refreshResource({ ...model.resource, source: { ...model.resource.source, generated: true } });
	assert.equal(model.readOnly, true);
	assert.equal(f.saves.canSave(model), false);
	assert.throws(() => f.saves.save(model), /read-only/);
	assert.equal(f.files.writes.length, 0);
	assert.equal(f.files.records.size, 0);
	model.refreshResource({ ...model.resource, source: { ...model.resource.source, generated: false } });
	assert.equal(f.saves.canSave(model), true);
	assert.equal((await f.saves.save(model).completion).status, 'saved');
});

test('Save cannot reacquire a retired model through a reopened path and matching version', async t => {
	const f = await fixture(t);
	const retired = f.yaml();
	setSource(retired, 'value: old-session');
	assert.equal(f.saves.canSave(retired), true);
	f.models.clear();
	assert.equal(f.saves.canSave(retired), false);
	const current = f.yaml();
	setSource(current, 'value: current-session');
	assert.deepEqual(current.identity, retired.identity);
	assert.equal(current.version, retired.version);
	assert.equal(f.saves.canSave(retired), false);
	assert.equal(f.saves.canSave(current), true);
	const capture = t.mock.method(retired, 'createSnapshot');
	assert.throws(() => f.saves.save(retired), /no longer belongs to this workspace/);
	assert.equal(capture.mock.callCount(), 0, 'retired admission cannot even break the model undo sequence');
	assert.equal(f.files.records.has(`${f.root}/${retired.resource.path}`), false);
	assert.equal(readLocalWorkspaceRecord(f.storage, f.root, `${f.root}/${retired.resource.path}`), null);
	assert.equal(current.dirty, true);
	assert.equal((await f.saves.save(current).completion).status, 'saved');
	assert.equal(f.files.records.get(`${f.root}/${current.resource.path}`)!.contents, 'value: current-session');
});

test('Save admits only the session owner model, not a foreign copy of the same resource', async t => {
	const f = await fixture(t);
	const current = f.yaml();
	const other = new EditorTextModelService();
	t.after(() => other.clear());
	const foreign = other.retain(current.resource, current.mode, 'value: foreign');
	assert.equal(current.version, foreign.version);
	assert.equal(f.saves.canSave(current), true);
	assert.equal(f.saves.canSave(foreign), false);
	const capture = t.mock.method(foreign, 'createSnapshot');
	assert.throws(() => f.saves.save(foreign), /no longer belongs to this workspace/);
	assert.equal(capture.mock.callCount(), 0);
	assert.equal(f.files.records.has(`${f.root}/${current.resource.path}`), false);
	assert.equal(readLocalWorkspaceRecord(f.storage, f.root, `${f.root}/${current.resource.path}`), null);
	assert.equal(current.dirty, false);
});
