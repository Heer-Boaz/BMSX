import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { DiskWorkspaceRecordProvider } from '../../ide/node/workspace_records';
import { resolveRuntimeResource } from '../../ide/runtime/sources';
import { WorkspaceSourceRecovery } from '../../ide/workbench/services/working_copy/source_recovery';
import { resolveTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { joinWorkspacePaths } from '../../ide/workspace/path';
import { workspaceRecoveryRecordPath, type PersistedDirtyEntry } from '../../ide/workspace/source_recovery_store';
import { applyAllWorkspaceSourceOverrides } from '../../ide/workspace/workspace';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

test('viewless recovery shares working-copy semantics without touching the human editor session', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-source-recovery-'));
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); await rm(root, { recursive: true, force: true }); });
	const project = 'carts/nemesis_s', path = `${project}/tests/save.lua`, source = 'return true';
	await mkdir(join(root, project, 'tests'), { recursive: true });
	await mkdir(join(root, project, '.bmsx'), { recursive: true });
	await writeFile(join(root, path), source);
	const humanPath = join(root, project, '.bmsx/session.json');
	await writeFile(humanPath, 'human tabs and drafts');
	await openWorkspaceRecords(new DiskWorkspaceRecordProvider(root));
	const options = () => ({ identity: 'agent-session', sourceContextId: 'nemesis-source-context', projectRootPath: project, models: new EditorTextModelService(),
		sources: createScenarioTestSourceState([createScenarioTestSourceRecord(path, 0, source, path)]),
		clock: new VirtualHeadlessClock(), logOutput: { log() {} } });
	const first = options(), recovery = new WorkspaceSourceRecovery(first);
	await applyAllWorkspaceSourceOverrides(first.sources, await recovery.initialize());
	await recovery.restoreModels(); recovery.start();
	const model = await resolveTextFileModel(first.models, first.sources, resolveRuntimeResource(first.sources, { domain: 0, path })!);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved\n' }]);
	await recovery.shutdown(); first.models.clear();
	assert.equal(await readFile(join(root, path), 'utf8'), source);
	assert.equal(await readFile(humanPath, 'utf8'), 'human tabs and drafts');
	const second = options(), restored = new WorkspaceSourceRecovery(second);
	await applyAllWorkspaceSourceOverrides(second.sources, await restored.initialize());
	await restored.restoreModels(); restored.start();
	const recovered = second.models.get({ domain: 0, path })!;
	assert.equal(recovered.buffer.getText(), '-- unsaved\n' + source);
	assert.equal(recovered.lastSavedSource, source);
	assert.equal(recovered.persistedBaseline, source);
	assert.equal(recovered.dirty, true);
	await restored.discard(); second.models.clear();
	const third = options(), empty = new WorkspaceSourceRecovery(third);
	assert.equal((await empty.initialize()).size, 0);
	await empty.shutdown(); third.models.clear();
	assert.equal(await readFile(humanPath, 'utf8'), 'human tabs and drafts');
});

test('source contexts isolate recovery manifests and drafts for the same project and session', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-source-context-recovery-'));
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); await rm(root, { recursive: true, force: true }); });
	const project = 'carts/nemesis_s', path = `${project}/tests/save.lua`, source = 'return true';
	await mkdir(join(root, project, 'tests'), { recursive: true });
	await writeFile(join(root, path), source);
	await openWorkspaceRecords(new DiskWorkspaceRecordProvider(root));
	const options = (sourceContextId: string) => ({ identity: 'agent-session', sourceContextId, projectRootPath: project,
		models: new EditorTextModelService(), sources: createScenarioTestSourceState([createScenarioTestSourceRecord(path, 0, source, path)]),
		clock: new VirtualHeadlessClock(), logOutput: { log() {} } });
	const first = options('first-source-context'), firstRecovery = new WorkspaceSourceRecovery(first);
	await applyAllWorkspaceSourceOverrides(first.sources, await firstRecovery.initialize());
	firstRecovery.start();
	const firstModel = await resolveTextFileModel(first.models, first.sources, resolveRuntimeResource(first.sources, { domain: 0, path })!);
	firstModel.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- first context\n' }]);
	await firstRecovery.shutdown(); first.models.clear();
	const firstState: { dirtyFiles: PersistedDirtyEntry[] } = JSON.parse(await readFile(join(root, project,
		'.bmsx/studio/first-source-context/agent-session/sources.json'), 'utf8'));
	assert.equal(await readFile(join(root, workspaceRecoveryRecordPath(first.sources, firstState.dirtyFiles[0],
		joinWorkspacePaths(first.sourceContextId, first.identity))), 'utf8'), '-- first context\n' + source);
	const second = options('second-source-context'), secondRecovery = new WorkspaceSourceRecovery(second);
	const secondRecords = await secondRecovery.initialize();
	assert.equal(secondRecords.size, 0);
	await applyAllWorkspaceSourceOverrides(second.sources, secondRecords);
	secondRecovery.start();
	const secondModel = await resolveTextFileModel(second.models, second.sources, resolveRuntimeResource(second.sources, { domain: 0, path })!);
	assert.equal(secondModel.buffer.getText(), source);
	secondModel.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- second context\n' }]);
	await secondRecovery.shutdown(); second.models.clear();
	const secondState: { dirtyFiles: PersistedDirtyEntry[] } = JSON.parse(await readFile(join(root, project,
		'.bmsx/studio/second-source-context/agent-session/sources.json'), 'utf8'));
	assert.equal(await readFile(join(root, workspaceRecoveryRecordPath(second.sources, secondState.dirtyFiles[0],
		joinWorkspacePaths(second.sourceContextId, second.identity))), 'utf8'), '-- second context\n' + source);
	const firstAgain = options('first-source-context'), firstRestored = new WorkspaceSourceRecovery(firstAgain);
	await applyAllWorkspaceSourceOverrides(firstAgain.sources, await firstRestored.initialize());
	await firstRestored.restoreModels();
	assert.equal(firstAgain.models.get({ domain: 0, path })!.buffer.getText(), '-- first context\n' + source);
	await firstRestored.discard(); firstAgain.models.clear();
	const secondAgain = options('second-source-context'), secondRestored = new WorkspaceSourceRecovery(secondAgain);
	await applyAllWorkspaceSourceOverrides(secondAgain.sources, await secondRestored.initialize());
	await secondRestored.restoreModels(); secondRestored.start();
	const recovered = secondAgain.models.get({ domain: 0, path })!, saved = '-- second context\n' + source;
	assert.equal(recovered.buffer.getText(), saved);
	assert.equal(recovered.persistedBaseline, source);
	assert.equal(recovered.lastSavedSource, source);
	const saves = new TextFileSaveService(secondAgain.models, secondAgain.clock, secondAgain.sources, null, null, null);
	assert.equal((await saves.save(recovered).completion).status, 'saved');
	assert.equal(recovered.dirty, false);
	assert.equal(await readFile(join(root, path), 'utf8'), saved);
	recovered.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- after save\n' }]);
	await saves.shutdown(); await secondRestored.shutdown(); secondAgain.models.clear();
	const afterSave = options('second-source-context'), afterSaveRecovery = new WorkspaceSourceRecovery(afterSave);
	await applyAllWorkspaceSourceOverrides(afterSave.sources, await afterSaveRecovery.initialize());
	await afterSaveRecovery.restoreModels();
	const recoveredAfterSave = afterSave.models.get({ domain: 0, path })!;
	assert.equal(recoveredAfterSave.buffer.getText(), '-- after save\n' + saved);
	assert.equal(recoveredAfterSave.lastSavedSource, saved);
	assert.equal(recoveredAfterSave.persistedBaseline, saved);
	assert.equal(recoveredAfterSave.dirty, true);
	await afterSaveRecovery.discard(); afterSave.models.clear();
});

for (const externalChange of ['changed', 'removed'] as const) test(`recovered draft retains its acknowledged baseline when the file was ${externalChange}`, async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-recovery-conflict-'));
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); await rm(root, { recursive: true, force: true }); });
	const project = 'carts/nemesis_s', path = `${project}/tests/save.lua`, original = 'return true', draft = '-- unsaved\n' + original;
	await mkdir(join(root, project, 'tests'), { recursive: true });
	await writeFile(join(root, path), original);
	await openWorkspaceRecords(new DiskWorkspaceRecordProvider(root));
	const options = () => ({ identity: 'agent-session', sourceContextId: 'nemesis-source-context', projectRootPath: project, models: new EditorTextModelService(),
		sources: createScenarioTestSourceState([createScenarioTestSourceRecord(path, 0, original, path)]),
		clock: new VirtualHeadlessClock(), logOutput: { log() {} } });
	const first = options(), recovery = new WorkspaceSourceRecovery(first);
	await applyAllWorkspaceSourceOverrides(first.sources, await recovery.initialize());
	recovery.start();
	const model = await resolveTextFileModel(first.models, first.sources, resolveRuntimeResource(first.sources, { domain: 0, path })!);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved\n' }]);
	await recovery.shutdown(); first.models.clear();
	if (externalChange === 'changed') {
		await writeFile(join(root, path), 'return false');
		const future = Date.now() / 1000 + 60;
		await utimes(join(root, path), future, future);
	} else await rm(join(root, path));
	const second = options(), restored = new WorkspaceSourceRecovery(second);
	const rejected = await applyAllWorkspaceSourceOverrides(second.sources, await restored.initialize());
	if (externalChange === 'changed') assert.equal(rejected.size, 1);
	await restored.restoreModels(); restored.start();
	const recovered = second.models.get({ domain: 0, path })!;
	assert.equal(recovered.buffer.getText(), draft);
	assert.equal(recovered.persistedBaseline, original);
	assert.equal(recovered.lastSavedSource, original);
	const saves = new TextFileSaveService(second.models, second.clock, second.sources, null, null, null);
	const result = await saves.save(recovered).completion;
	assert.equal(result.status, 'failed');
	assert.equal(recovered.dirty, true);
	assert.equal(recovered.buffer.getText(), draft);
	if (externalChange === 'changed') assert.equal(await readFile(join(root, path), 'utf8'), 'return false');
	else await assert.rejects(readFile(join(root, path)), { code: 'ENOENT' });
	await saves.shutdown(); await restored.discard(); second.models.clear();
});
