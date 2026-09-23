import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorTextModel } from '../../ide/editor/model/text_model';
import type { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';
import { MemoryStorage } from '../../ide/workspace/memory_storage';
import type { WorkspaceRecord, WorkspaceRecordProvider } from '../../ide/workspace/record_provider';
import { closeWorkspaceRecords, disconnectWorkspaceRecords, openWorkspaceRecords, readLocalWorkspaceRecord,
	reconnectWorkspaceRecords, workspaceRecordState } from '../../ide/workspace/records';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { saveTextFileFromCommand } from '../../ide/commands/source_save';
import type { CartEditor } from '../../ide/cart_editor';
import { editorFeedbackState } from '../../ide/common/feedback_state';
import { COLOR_STATUS_WARNING } from '../../ide/common/constants';

class SaveStorage extends MemoryStorage {
	public failure: Error | undefined;
	public override setItem(key: string, value: string): void {
		if (this.failure) throw this.failure;
		super.setItem(key, value);
	}
}

class SaveFiles implements WorkspaceRecordProvider {
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
	const lua = createScenarioTestSourceRecord(`${root}/tests/save.lua`, 1, 'return true');
	const sources = createScenarioTestSourceState([lua]);
	const models = new EditorTextModelService();
	let readbackFailure: Error | undefined;
	const tasks = new RuntimeTaskQueue({ muteRuntimeTask() {} } as unknown as HostAudioOutput,
		{ backend: { async finishGxGpuReadbacks() { if (readbackFailure) throw readbackFailure; } } } as VideoPresenter);
	// These tests reject AEM input before compilation. Any use of machine/tooling
	// in a source-only save is an unwanted dependency and fails immediately.
	const saves = new TextFileSaveService(storage, clock, sources, {} as RuntimeLuaTooling, {} as Runtime, tasks);
	await openWorkspaceRecords(storage, clock, root, files);
	t.after(async () => {
		await saves.shutdown();
		models.clear();
		closeWorkspaceRecords();
		clearWorkspaceSourceCaches();
	});
	const yaml = (path = 'res/data/save.yaml') => models.retain({ domain: 0, path,
		source: { resid: path, type: 'data' } }, 'yaml', '# untouched\nvalue: 1\n');
	return { saves, models, storage, files, clock, root, yaml, sources, lua, tasks,
		failReadback(error: Error) { readbackFailure = error; } };
}

function setSource(model: EditorTextModel, source: string): void {
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
}

test('Save captures and coalesces one revision, while newer edits remain dirty', async t => {
	const f = await fixture(t);
	const model = f.yaml();
	setSource(model, '# untouched\nvalue: 2\n');
	f.files.delayed = true;
	const first = f.saves.save(model);
	assert.equal(f.saves.save(model), first);
	setSource(model, '# untouched\nvalue: 3\n');
	await setImmediate();
	assert.equal(f.files.writes.length, 1);
	f.files.writes[0].complete();
	const result = await first;
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
	await independent;
	assert.equal(other.dirty, false);
	f.files.writes[0].complete();
	await first;
	await setImmediate();
	assert.equal(f.files.writes[2].record.contents, 'value: 3');
	f.files.writes[2].complete();
	assert.equal((await second).snapshot.source, 'value: 3');
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
	let stopped = false;
	const closing = f.saves.shutdown().then(() => { stopped = true; });
	assert.equal(f.saves.acceptingSaves, false);
	assert.throws(() => f.saves.save(model), /shutdown/);
	await setImmediate();
	assert.equal(stopped, false);
	f.files.writes[0].complete();
	await first;
	await setImmediate();
	assert.equal(stopped, false);
	f.files.writes[1].complete();
	await second;
	await closing;
	assert.equal(stopped, true);
	assert.equal(model.dirty, false);
});

test('source persistence failure is an explicit outcome, does not complete the snapshot and allows a later save', async t => {
	const f = await fixture(t);
	const model = f.yaml();
	setSource(model, 'value: 2');
	const error = new Error('local storage unavailable');
	f.storage.failure = error;
	const result = await f.saves.save(model);
	assert.equal(result.status, 'failed');
	if (result.status !== 'failed') assert.fail('expected failed source persistence');
	assert.equal(result.error, error);
	assert.equal(model.dirty, true);
	assert.equal(model.lastSavedSource, '# untouched\nvalue: 1\n');
	f.storage.failure = undefined;
	assert.equal((await f.saves.save(model)).status, 'saved');
	assert.equal(model.dirty, false);
});

test('a failed project write acknowledges local storage and reconnect persists that exact source without saving later edits', async t => {
	const f = await fixture(t);
	const model = f.yaml();
	const path = `${f.root}/${model.resource.path}`;
	const error = new Error('project filesystem unavailable');
	const saved: EditorTextModel[] = [];
	f.models.onDidSaveModel(model => saved.push(model));
	setSource(model, 'value: 2');
	f.files.failure = error;
	const result = await f.saves.save(model);
	if (result.status !== 'saved') assert.fail('expected locally saved source');
	assert.deepEqual(result.persistence, { status: 'local-only', reason: 'write-failed', error });
	assert.equal(result.application.status, 'not-requested');
	assert.equal(readLocalWorkspaceRecord(f.storage, f.root, path)!.contents, 'value: 2');
	assert.equal(f.files.records.has(path), false);
	assert.equal(model.dirty, false, 'dirty identity is relative to the actual local save');
	setSource(model, 'value: 3');
	f.files.failure = undefined;
	await reconnectWorkspaceRecords(f.clock, f.root);
	assert.equal(f.files.records.get(path)!.contents, 'value: 2');
	assert.equal(model.lastSavedSource, 'value: 2');
	assert.equal(model.dirty, true);
	assert.deepEqual(saved, [model], 'remote synchronization cannot acknowledge newer document content');
	assert.equal(result.persistence.status, 'local-only', 'the receipt describes the original save, not later connectivity');
	const retried = await f.saves.save(model);
	if (retried.status !== 'saved') assert.fail('expected workspace save');
	assert.equal(retried.persistence.status, 'workspace');
	assert.equal(f.files.records.get(path)!.contents, 'value: 3');
	assert.equal(model.dirty, false);
});

test('disconnected Lua save carries the local-only acknowledgement through its source catalog', async t => {
	const f = await fixture(t);
	const model = f.models.retain({ domain: 0, path: f.lua.source_path, source: f.lua }, 'lua', f.lua.src);
	closeWorkspaceRecords();
	setSource(model, 'return false');
	const result = await f.saves.save(model);
	if (result.status !== 'saved') assert.fail('expected locally saved Lua');
	assert.deepEqual(result.persistence, { status: 'local-only', reason: 'disconnected' });
	assert.equal(f.lua.src, result.snapshot.source);
	assert.equal(model.dirty, false);
	await reconnectWorkspaceRecords(f.clock, f.root);
	assert.equal(f.files.records.get(f.lua.normalized_source_path)!.contents, result.snapshot.source);
});

test('an acknowledged write stays a workspace save even when another operation disconnected the provider', async t => {
	const f = await fixture(t);
	const model = f.yaml();
	setSource(model, 'value: 2');
	f.files.delayed = true;
	const pending = f.saves.save(model);
	await setImmediate();
	disconnectWorkspaceRecords(new Error('another resource failed'));
	f.files.writes[0].complete();
	const result = await pending;
	if (result.status !== 'saved') assert.fail('expected saved source');
	assert.equal(workspaceRecordState.connected, false);
	assert.deepEqual(result.persistence, { status: 'workspace' });
});

test('Save command distinguishes local-only persistence from an AEM application failure and a successful retry', async t => {
	const f = await fixture(t);
	const model = f.models.retain({ domain: 0, path: 'res/cue.aem.yaml', source: { resid: 'cue', type: 'aem' } }, 'aem', '{}');
	closeWorkspaceRecords();
	setSource(model, '[');
	const result = await saveTextFileFromCommand(f.saves, model, {} as CartEditor, f.sources);
	if (result.status !== 'saved' || result.application.status !== 'failed') assert.fail('expected saved local source and failed AEM');
	assert.equal(result.persistence.status, 'local-only');
	assert.equal(result.application.phase, 'build');
	assert.match(editorFeedbackState.message.text, /saved locally only; runtime apply failed/);
	assert.equal(editorFeedbackState.message.color, COLOR_STATUS_WARNING);
	assert.equal(f.tasks.ready, true);
	await reconnectWorkspaceRecords(f.clock, f.root);
	const yaml = f.yaml();
	setSource(yaml, 'value: 2');
	const retry = await saveTextFileFromCommand(f.saves, yaml, {} as CartEditor, f.sources);
	if (retry.status !== 'saved') assert.fail('expected saved project file');
	assert.equal(retry.persistence.status, 'workspace');
	assert.doesNotMatch(editorFeedbackState.message.text, /locally only|apply failed/);
	assert.match(editorFeedbackState.message.text, /saved \(asset rebuild required\)/);
});

test('Save command presents a local-only write failure without claiming the project file was saved', async t => {
	const f = await fixture(t);
	const model = f.yaml();
	setSource(model, 'value: 2');
	f.files.failure = new Error('project filesystem unavailable');
	await saveTextFileFromCommand(f.saves, model, {} as CartEditor, f.sources);
	assert.match(editorFeedbackState.message.text, /saved locally only: project filesystem unavailable/);
	assert.equal(editorFeedbackState.message.color, COLOR_STATUS_WARNING);
	f.files.failure = undefined;
	await reconnectWorkspaceRecords(f.clock, f.root);
});

test('AEM build rejection reports saved source separately and does not poison the runtime queue', async t => {
	const f = await fixture(t);
	const model = f.models.retain({ domain: 0, path: 'res/cue.aem.yaml', source: { resid: 'cue', type: 'aem' } }, 'aem', '{}');
	setSource(model, '[');
	const result = await f.saves.save(model);
	if (result.status !== 'saved' || result.application.status !== 'failed') assert.fail('expected saved source and rejected AEM');
	assert.equal(result.application.phase, 'build');
	assert.equal(model.lastSavedSource, '[');
	assert.equal(model.dirty, false);
	assert.equal(f.tasks.ready, true);
	assert.equal(f.sources.aemSourceApplications.get('0\0res/cue.aem.yaml')!.failed, true);
});

test('runtime synchronization failure cannot be reported as a failed source write or an applied asset', async t => {
	const f = await fixture(t);
	const model = f.models.retain({ domain: 0, path: 'res/cue.aem.yaml', source: { resid: 'cue', type: 'aem' } }, 'aem', '{}');
	setSource(model, 'events: {}');
	const error = new Error('readback failed');
	f.failReadback(error);
	const result = await f.saves.save(model);
	if (result.status !== 'saved' || result.application.status !== 'failed') assert.fail('expected runtime failure after source save');
	assert.equal(result.application.phase, 'runtime');
	assert.equal(result.application.error, error);
	assert.equal(model.dirty, false);
	assert.equal(f.tasks.ready, false);
});

test('source-only Lua uses its catalog owner and publishes one model-service save event', async t => {
	const f = await fixture(t);
	const model = f.models.retain({ domain: 0, path: f.lua.source_path, source: f.lua }, 'lua', f.lua.src);
	setSource(model, 'return false');
	const saved: EditorTextModel[] = [];
	const dispose = f.models.onDidSaveModel(model => saved.push(model));
	const result = await f.saves.save(model);
	assert.equal(result.status, 'saved');
	assert.deepEqual(saved, [model]);
	assert.equal(f.lua.src, 'return false');
	assert.equal(readLocalWorkspaceRecord(f.storage, f.root, f.lua.normalized_source_path)!.contents, 'return false');
	dispose();
	model.completeSave(model.createSnapshot());
	assert.deepEqual(saved, [model]);
});

test('read-only resources are rejected at save admission, before writes or snapshot completion', async t => {
	const f = await fixture(t);
	const model = f.yaml();
	model.refreshResource({ ...model.resource, source: { ...model.resource.source, generated: true } });
	assert.throws(() => f.saves.save(model), /read-only/);
	assert.equal(f.files.writes.length, 0);
});

test('the source save owner cannot depend on editor views, feedback or workspace-session composition', () => {
	const source = readFileSync('ide/workbench/services/working_copy/text_file_save.ts', 'utf8');
	assert.doesNotMatch(source, /from ['"][^'"]*(?:cart_editor|feedback_state|runtime_error|workspace\/storage|commands\/|contrib\/)/);
});
