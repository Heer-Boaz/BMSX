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
		const resource: RuntimeResource = { domain: 0, path: 'res/stage.yaml',
			source: { type, resid: 'stage', sourcemeta: { text: original } } };
		const [first, second] = await Promise.all([
			resolveTextFileModel(models, sources, resource), resolveTextFileModel(models, sources, resource),
		]);
		assert.equal(first, second);
		assert.equal(first.buffer.getText(), original);
		assert.equal(first.dirty, false);
		if (type === 'aem') assert.equal(getTextFileRuntimeSourceStatus(sources, first), 'applied');
		assert.equal(files.records.size, 0, 'opening a bundled source is not an implicit file write');
		first.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# unsaved\r\n' }]);
		assert.equal(await resolveTextFileModel(models, sources, resource), first);
		if (type === 'aem') assert.equal(getTextFileRuntimeSourceStatus(sources, first), 'pending');
		first.undo(); assert.equal(first.buffer.getText(), original);
		if (type === 'aem') assert.equal(getTextFileRuntimeSourceStatus(sources, first), 'applied');
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
