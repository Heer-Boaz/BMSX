import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeResource } from '../../ide/common/resource';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { resolveTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { getTextFileRuntimeSourceStatus } from '../../ide/workbench/services/working_copy/runtime_source_status';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

for (const type of ['data', 'aem'] as const) {
	test(`${type} working copies use packaged authored text, workspace overlays and the same model owner`, async t => {
		const files = new MemoryWorkspaceFiles(), models = new EditorTextModelService();
		await openWorkspaceRecords(files);
		t.after(async () => { models.clear(); clearWorkspaceSourceCaches(); await closeWorkspaceRecords(); });
		const sources = createScenarioTestSourceState([]);
		const original = '# Keep this formatting\r\nvalue: "01"\r\n';
		const resource: RuntimeResource = { location: { kind: 'workspace' as const, path: 'res/stage.yaml' }, domain: 0, path: 'res/stage.yaml',
			source: { type, resid: 'stage', sourcemeta: { text: original } } };
		const [first, second] = await Promise.all([
			resolveTextFileModel(models, sources, resource), resolveTextFileModel(models, sources, resource),
		]);
		assert.equal(first, second);
		assert.equal(first.buffer.getText(), original);
		assert.equal(first.dirty, false);
		assert.equal(getTextFileRuntimeSourceStatus(sources, first), 'applied');
		assert.equal(files.records.size, 0, 'opening a bundled source is not an implicit file write');
		first.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# unsaved\r\n' }]);
		assert.equal(await resolveTextFileModel(models, sources, resource), first);
		assert.equal(getTextFileRuntimeSourceStatus(sources, first), 'pending');
		first.undo(); assert.equal(first.buffer.getText(), original);
		assert.equal(getTextFileRuntimeSourceStatus(sources, first), 'applied');
		models.clear();
		// Empty is an authored source too, not a reason to replace it with the packaged base.
		files.records.set('carts/nemesis_s/res/stage.yaml', { contents: '', updatedAt: 1 });
		assert.equal((await resolveTextFileModel(models, sources, resource)).buffer.getText(), '');
		models.clear(); clearWorkspaceSourceCaches(); files.records.clear();
		resource.source.sourcemeta = { text: '' };
		assert.equal((await resolveTextFileModel(models, sources, resource)).buffer.getText(), '');
		models.clear();
		const failure = new Error('workspace read rejected');
		t.mock.method(files, 'read', async () => { throw failure; });
		await assert.rejects(async () => resolveTextFileModel(models, sources, resource), error => error === failure);
		assert.equal(models.get(resource), undefined);
	});
}

test('YAML installed-source equality is independent of saved identity and cached until text or installed metadata changes', t => {
	const sources = createScenarioTestSourceState([]), models = new EditorTextModelService();
	t.after(() => models.clear());
	const source = '# exact authored bytes\r\nvalue: "01"\r\n';
	const resource: RuntimeResource = { location: { kind: 'workspace' as const, path: 'res/stage.yaml' }, domain: 0, path: 'res/stage.yaml',
		source: { type: 'data', resid: 'stage', sourcemeta: { text: source } } };
	const model = models.retain(resource, 'yaml', source);
	const reads = t.mock.method(model.buffer, 'getText');
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
	for (let frame = 0; frame < 100; frame++) assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
	assert.equal(reads.mock.callCount(), 1, 'stationary status consumes the retained source equality');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# new comment\r\n' }]);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending', 'source identity is not cooked-value equivalence');
	model.completeSave(model.createSnapshot());
	assert.equal(model.dirty, false);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending', 'Save does not replace the installed asset');
	model.undo();
	assert.equal(model.dirty, true);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied', 'Undo can restore installed source while differing from saved source');
	model.redo();
	assert.equal(model.dirty, false);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending');
	resource.source = { ...resource.source, sourcemeta: { text: model.buffer.getText() } };
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied', 'rebinding installed metadata invalidates status without a document edit');
	resource.source = { type: 'data', resid: 'stage' };
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'untracked', 'media without authored input proves no source equality');
});

test('YAML source provenance stays resource-domain specific and an empty packaged source is known', t => {
	const sources = createScenarioTestSourceState([]), models = new EditorTextModelService();
	t.after(() => models.clear());
	const domains = [-1, 0, 1] as const;
	for (const domain of domains) {
		const source = domain === -1 ? '' : `value: ${domain}\n`;
		const model = models.retain({ location: { kind: 'workspace' as const, path: 'res/stage.yaml' }, domain, path: 'res/stage.yaml',
			source: { type: 'data', resid: 'stage', sourcemeta: { text: source } } }, 'yaml', source);
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
	}
	const cart = models.get({ domain: 0, path: 'res/stage.yaml' })!;
	cart.pushEditOperations([{ offset: 0, deleteLength: cart.buffer.length, text: 'value: 1\n' }]);
	assert.equal(getTextFileRuntimeSourceStatus(sources, cart), 'pending', 'matching another domain is not installed equality');
	assert.equal(getTextFileRuntimeSourceStatus(sources, models.get({ domain: 1, path: 'res/stage.yaml' })!), 'applied');
});
