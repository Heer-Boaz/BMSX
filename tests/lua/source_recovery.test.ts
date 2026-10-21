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
	const options = () => ({ identity: 'agent-session', projectRootPath: project, models: new EditorTextModelService(),
		sources: createScenarioTestSourceState([createScenarioTestSourceRecord(path, 0, source)]),
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
	assert.equal(recovered.dirty, true);
	await restored.discard(); second.models.clear();
	const third = options(), empty = new WorkspaceSourceRecovery(third);
	assert.equal((await empty.initialize()).size, 0);
	await empty.shutdown(); third.models.clear();
	assert.equal(await readFile(humanPath, 'utf8'), 'human tabs and drafts');
});

for (const externalChange of ['changed', 'removed'] as const) test(`recovered draft retains its acknowledged baseline when the file was ${externalChange}`, async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-recovery-conflict-'));
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); await rm(root, { recursive: true, force: true }); });
	const project = 'carts/nemesis_s', path = `${project}/tests/save.lua`, original = 'return true', draft = '-- unsaved\n' + original;
	await mkdir(join(root, project, 'tests'), { recursive: true });
	await writeFile(join(root, path), original);
	await openWorkspaceRecords(new DiskWorkspaceRecordProvider(root));
	const options = () => ({ identity: 'agent-session', projectRootPath: project, models: new EditorTextModelService(),
		sources: createScenarioTestSourceState([createScenarioTestSourceRecord(path, 0, original)]),
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
