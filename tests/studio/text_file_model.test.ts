import { finalizePackedRomAssets } from '../../toolchain/ts/rompack/assets';
import { installRuntimeRomLayers } from '../../ide/runtime/sources';
import { createLuaSourceRegistry } from '../../ide/runtime/source_registry';
import { createTestRuntimeSourceState, TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
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
		const resource: RuntimeResource = { contextLabel: 'Fixture project', sourceFilePath: 'carts/nemesis_s/res/stage.yaml',
			location: { kind: 'project', projectRootPath: 'carts/nemesis_s', path: 'res/stage.yaml' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/stage.yaml',
			source: { type, resid: 'stage', sourcemeta: { text: original } } };
		const installed = [{ ...resource.source }]; finalizePackedRomAssets(installed);
		sources.cartridgeSlots[0]!.rom.index.entries.push(...installed);
		const [first, second] = await Promise.all([
			resolveTextFileModel(models, sources.catalog, resource), resolveTextFileModel(models, sources.catalog, resource),
		]);
		assert.equal(first, second);
		assert.equal(first.buffer.getText(), original);
		assert.equal(first.dirty, false);
		assert.equal(getTextFileRuntimeSourceStatus(sources, first), 'applied');
		assert.equal(files.records.size, 0, 'opening a bundled source is not an implicit file write');
		first.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# unsaved\r\n' }]);
		assert.equal(await resolveTextFileModel(models, sources.catalog, resource), first);
		assert.equal(getTextFileRuntimeSourceStatus(sources, first), 'pending');
		first.undo(); assert.equal(first.buffer.getText(), original);
		assert.equal(getTextFileRuntimeSourceStatus(sources, first), 'applied');
		models.clear();
		// Empty is an authored source too, not a reason to replace it with the packaged base.
		files.records.set('carts/nemesis_s/res/stage.yaml', { contents: '', updatedAt: 1 });
		assert.equal((await resolveTextFileModel(models, sources.catalog, resource)).buffer.getText(), '');
		models.clear(); clearWorkspaceSourceCaches(); files.records.clear();
		resource.source.sourcemeta = { text: '' };
		assert.equal((await resolveTextFileModel(models, sources.catalog, resource)).buffer.getText(), '');
		models.clear();
		const failure = new Error('workspace read rejected');
		t.mock.method(files, 'read', async () => { throw failure; });
		await assert.rejects(async () => resolveTextFileModel(models, sources.catalog, resource), error => error === failure);
		assert.equal(models.get(resource), undefined);
	});
}

test('YAML installed-source equality is independent of saved identity and cached until text or installed metadata changes', t => {
	const sources = createScenarioTestSourceState([]), models = new EditorTextModelService();
	t.after(() => models.clear());
	const source = '# exact authored bytes\r\nvalue: "01"\r\n';
	const resource: RuntimeResource = { contextLabel: 'Fixture project', sourceFilePath: 'res/stage.yaml', location: { kind: 'workspace' as const, path: 'res/stage.yaml' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/stage.yaml',
		source: { type: 'data', resid: 'stage', sourcemeta: { text: source } } };
	const installed = [{ ...resource.source }]; finalizePackedRomAssets(installed);
	sources.cartridgeSlots[0]!.rom.index.entries.push(...installed);
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
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending', 'authored metadata cannot replace installed evidence');
	const rebuilt = [{ ...resource.source }]; finalizePackedRomAssets(rebuilt);
	const layer = sources.cartridgeSlots[0]!.rom;
	installRuntimeRomLayers(sources, null, [{ id: 'cart', bytes: new Uint8Array(layer.bytes),
		index: { ...layer.index, entries: rebuilt } }, null]);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied', 'an installed asset generation invalidates status without a document edit or code image');
	const unknown = [{ type: 'data' as const, resid: 'stage' }]; finalizePackedRomAssets(unknown);
	installRuntimeRomLayers(sources, null, [{ id: 'cart', bytes: new Uint8Array(layer.bytes),
		index: { ...layer.index, entries: unknown } }, null]);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'untracked', 'media without authored input proves no source equality');
});

test('YAML source provenance stays context-specific and an empty installed source is known', t => {
	const sources = createTestRuntimeSourceState(createLuaSourceRegistry('system', ''),
		[createLuaSourceRegistry('first', ''), createLuaSourceRegistry('second', '')], 0);
	const models = new EditorTextModelService();
	t.after(() => { models.clear(); sources.catalog.dispose(); });
	const installations = [
		{ contextId: TEST_SYSTEM_CONTEXT_ID, layer: sources.systemRom, source: '' },
		{ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], layer: sources.cartridgeSlots[0]!.rom, source: 'value: first\n' },
		{ contextId: TEST_CARTRIDGE_CONTEXT_IDS[1], layer: sources.cartridgeSlots[1]!.rom, source: 'value: second\n' },
	];
	for (const { contextId, layer, source } of installations) {
		const asset = { type: 'data' as const, resid: 'stage', sourcemeta: { text: source } };
		const entries = [asset]; finalizePackedRomAssets(entries); layer.index.entries.push(...entries);
		const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'res/stage.yaml',
			location: { kind: 'workspace', path: 'res/stage.yaml' }, contextId, path: 'res/stage.yaml', source: { ...asset } }, 'yaml', source);
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
	}
	const cart = models.get({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/stage.yaml' })!;
	cart.pushEditOperations([{ offset: 0, deleteLength: cart.buffer.length, text: 'value: second\n' }]);
	assert.equal(getTextFileRuntimeSourceStatus(sources, cart), 'pending', 'matching another context is not installed equality');
	assert.equal(getTextFileRuntimeSourceStatus(sources, models.get({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[1], path: 'res/stage.yaml' })!), 'applied');
});

for (const type of ['data', 'aem'] as const) test(`${type} model resolution reads its admitted file address, not its execution domain's root`, async t => {
	const files = new MemoryWorkspaceFiles(), models = new EditorTextModelService();
	await openWorkspaceRecords(files);
	t.after(async () => { models.clear(); clearWorkspaceSourceCaches(); await closeWorkspaceRecords(); });
	const sources = createScenarioTestSourceState([]);
	const sourceFilePath = 'shared/authoring/stage.yaml';
	const resource: RuntimeResource = { contextLabel: 'Fixture project', contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/stage.yaml', sourceFilePath,
		location: { kind: 'workspace', path: sourceFilePath },
		source: { type, resid: 'stage', sourcemeta: { text: 'value: packaged\n' } } };
	files.records.set(sourceFilePath, { contents: 'value: admitted\n', updatedAt: 1 });
	files.records.set('carts/nemesis_s/res/stage.yaml', { contents: 'value: unrelated\n', updatedAt: 2 });
	const model = await resolveTextFileModel(models, sources.catalog, resource);
	assert.equal(model.buffer.getText(), 'value: admitted\n');
	assert.equal(model.persistedBaseline, 'value: admitted\n');
	assert.equal(model.dirty, false);
});
