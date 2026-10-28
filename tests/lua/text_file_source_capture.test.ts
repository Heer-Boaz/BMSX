import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeResource } from '../../ide/common/resource';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { captureTextFileSource, resolveTextFileModel, textFileMode } from '../../ide/workbench/services/working_copy/text_file_model';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

test('read-only Lua capture observes its canonical dirty owner without admitting another model', async t => {
	const record = createScenarioTestSourceRecord('source.lua', 1, 'return 1');
	const sources = createScenarioTestSourceState([record]), models = new EditorTextModelService();
	t.after(() => { models.clear(); sources.catalog.dispose(); });
	const resource = sources.catalog.luaResources[0];
	const unopened = await captureTextFileSource(models, sources.catalog, resource);
	assert.equal(unopened.source, record.src); assert.equal([...models.models].length, 0);
	assert.deepEqual(unopened.resource, { contextId: resource.contextId, path: resource.path });
	const model = await resolveTextFileModel(models, sources.catalog, resource);
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'return "dirty"' }]);
	const snapshot = await captureTextFileSource(models, sources.catalog, resource);
	assert.equal(snapshot.source, model.buffer.getText());
	assert.ok(snapshot.resource === model.identity);
	assert.equal([...models.models].length, 1); assert.equal(model.dirty, true); assert.equal(record.src, 'return 1');
});

for (const type of ['data', 'aem'] as const) test(`${type} capture shares authored source precedence without materializing working copies`, async t => {
	const files = new MemoryWorkspaceFiles(), models = new EditorTextModelService(), sources = createScenarioTestSourceState([]);
	await openWorkspaceRecords(files);
	t.after(async () => { models.clear(); sources.catalog.dispose(); clearWorkspaceSourceCaches(); await closeWorkspaceRecords(); });
	const resource: RuntimeResource = { contextLabel: 'Fixture', contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: `res/source.${type === 'data' ? 'yaml' : 'aem'}`,
		sourceFilePath: 'fixtures/authored-source', location: { kind: 'workspace', path: 'fixtures/authored-source' },
		source: { type, resid: 'source', sourcemeta: { text: '# retained formatting\r\nvalue: "01"\r\n' } } };
	const packaged = await captureTextFileSource(models, sources.catalog, resource);
	assert.equal(packaged.source, resource.source.sourcemeta!.text);
	assert.equal([...models.models].length, 0); assert.equal(files.records.size, 0);
	files.records.set(resource.sourceFilePath!, { contents: '', updatedAt: 1 });
	const empty = await captureTextFileSource(models, sources.catalog, resource);
	assert.equal(empty.source, '');
	assert.equal([...models.models].length, 0);
	const model = await resolveTextFileModel(models, sources.catalog, resource);
	assert.equal(model.buffer.getText(), empty.source); assert.equal(model.dirty, false);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: 'unsaved authored text' }]);
	assert.equal((await captureTextFileSource(models, sources.catalog, resource)).source, model.buffer.getText());
	assert.equal([...models.models].length, 1);
});

test('canonical admission and edits during asynchronous file reading win at the shared source boundary', async t => {
	const files = new MemoryWorkspaceFiles(), models = new EditorTextModelService(), sources = createScenarioTestSourceState([]);
	await openWorkspaceRecords(files);
	t.after(async () => { models.clear(); sources.catalog.dispose(); clearWorkspaceSourceCaches(); await closeWorkspaceRecords(); });
	const resource: RuntimeResource = { contextLabel: 'Fixture', contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'source.yaml',
		sourceFilePath: 'fixtures/source.yaml', location: { kind: 'workspace', path: 'fixtures/source.yaml' }, source: { type: 'data', resid: 'source' } };
	const read = Promise.withResolvers<{ contents: string; updatedAt: number } | null>();
	t.mock.method(files, 'read', () => read.promise);
	const pending = captureTextFileSource(models, sources.catalog, resource);
	const model = models.retain(resource, 'yaml', 'canonical');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'new canonical draft' }]);
	read.resolve({ contents: 'older file result', updatedAt: 1 });
	const snapshot = await pending;
	assert.equal(snapshot.source, model.buffer.getText());
	assert.ok(snapshot.resource === model.identity);
	assert.equal(model.dirty, true); assert.equal([...models.models].length, 1);
});

test('source read failures propagate without admitting models or substituting packaged content', async t => {
	const files = new MemoryWorkspaceFiles(), models = new EditorTextModelService(), sources = createScenarioTestSourceState([]);
	await openWorkspaceRecords(files);
	t.after(async () => { models.clear(); sources.catalog.dispose(); clearWorkspaceSourceCaches(); await closeWorkspaceRecords(); });
	const resource: RuntimeResource = { contextLabel: 'Fixture', contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'source.yaml',
		sourceFilePath: 'fixtures/failure.yaml', location: { kind: 'workspace', path: 'fixtures/failure.yaml' },
		source: { type: 'data', resid: 'source', sourcemeta: { text: 'packaged' } } };
	const failure = new Error('authored source read failed');
	t.mock.method(files, 'read', async () => { throw failure; });
	await assert.rejects(captureTextFileSource(models, sources.catalog, resource), error => error === failure);
	assert.equal([...models.models].length, 0);
});

test('authored text admission remains the central format capability instead of a search-local Lua whitelist', () => {
	const resource = (type: RuntimeResource['source']['type'], path: string): RuntimeResource => ({ contextLabel: 'Fixture',
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, sourceFilePath: path, location: { kind: 'workspace', path }, source: { type, resid: path } });
	assert.equal(textFileMode(resource('lua', 'source.lua')), 'lua');
	assert.equal(textFileMode(resource('data', 'source.yml')), 'yaml');
	assert.equal(textFileMode(resource('aem', 'source.aem')), 'aem');
	assert.equal(textFileMode(resource('image', 'image.png')), undefined);
});
