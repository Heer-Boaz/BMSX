import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorTextModel } from '../../ide/editor/model/text_model';
import { CompositeTextEditorInput } from '../../ide/workbench/common/composite_text_editor_input';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';
import { WorkspaceSourceCatalog } from '../../ide/workspace/source_catalog';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';

class SourceInput extends CompositeTextEditorInput<'fixture', 'fixture'> {
	public constructor(public readonly workingCopy: EditorTextModel) { super('fixture', 'fixture', 'SOURCES', true); }
	public present(...models: EditorTextModel[]): void { this.setWorkingCopies(new Set(models)); }
}

test('composite source membership, dirty notifications and write access follow real working copies', async t => {
	const service = new EditorTextModelService();
	const catalog = new WorkspaceSourceCatalog(), saves = new TextFileSaveService(service, new VirtualHeadlessClock(), catalog);
	const [a, b, c] = ['a', 'b', 'c'].map(path => service.retain({ contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace' as const, path }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, source: { type: 'lua', resid: path } }, 'lua', path));
	const input = new SourceInput(a);
	t.after(async () => { await saves.shutdown(); input.dispose(); service.clear(); catalog.dispose(); });
	input.present(a, b, b);
	assert.deepEqual(input.getWorkingCopies(), [a, b]);
	const states: boolean[] = [];
	input.onDidChangeDirty(() => states.push(input.isDirty()));
	for (const model of [a, b, c]) model.pushEditOperations([{ offset: 1, deleteLength: 0, text: ' edited' }]);
	assert.deepEqual(states, [true]);
	a.completeSave(a.createSnapshot());
	assert.equal(input.isDirty(), true);
	b.completeSave(b.createSnapshot());
	assert.deepEqual(states, [true, false]);
	input.present(a, c);
	assert.deepEqual(states, [true, false, true], 'an already dirty source participates immediately');
	assert.equal(input.canSave(saves), true);
	c.refreshResource({ ...c.resource, source: { ...c.resource.source, generated: true } });
	assert.equal(input.canSave(saves), false, 'clean writable plus dirty read-only sources do not enable a no-op Save');
	assert.equal(input.readOnly, false);
	input.present(c);
	assert.equal(input.readOnly, true);
	input.present(a);
	assert.equal(input.isDirty(), false);
	c.refreshResource({ ...c.resource, source: { ...c.resource.source, generated: false } });
	c.undo(); b.undo();
	assert.deepEqual(states, [true, false, true, false], 'departed documents no longer publish this input dirty state');
	input.dispose();
	a.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- closed\n' }]);
	assert.deepEqual(states, [true, false, true, false]);
	assert.equal(a.canUndo, true, 'closing a view does not discard document history');
});

test('pending draft admission uses an owned writable member even when the primary source is read-only', async t => {
	const service = new EditorTextModelService(), catalog = new WorkspaceSourceCatalog();
	const saves = new TextFileSaveService(service, new VirtualHeadlessClock(), catalog);
	const [primary, imported] = ['primary.lua', 'imported.lua'].map(path => service.retain({
		contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace' as const, path },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, source: { type: 'lua', resid: path },
	}, 'lua', 'return true'));
	primary.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	primary.refreshResource({ ...primary.resource, source: { ...primary.resource.source, generated: true } });
	const input = new SourceInput(primary);
	t.after(async () => { await saves.shutdown(); input.dispose(); service.clear(); catalog.dispose(); });
	input.present(primary, imported);
	assert.equal(input.isDirty(), true);
	assert.equal(primary.readOnly, true);
	assert.equal(imported.dirty, false);
	assert.equal(input.canSave(saves), false);
	assert.equal(input.canSave(saves, true), true);
	imported.refreshResource({ ...imported.resource, source: { ...imported.resource.source, generated: true } });
	assert.equal(input.canSave(saves, true), false);
	imported.refreshResource({ ...imported.resource, source: { ...imported.resource.source, generated: false } });
	assert.equal(input.canSave(saves, true), true);
	await saves.shutdown();
	assert.equal(input.canSave(saves), false);
	assert.equal(input.canSave(saves, true), false);
});

for (const membership of ['retired', 'foreign'] as const) test(`${membership} dirty sources cannot lend Save authority to a clean owned member`, async t => {
	const service = new EditorTextModelService(), other = new EditorTextModelService(), catalog = new WorkspaceSourceCatalog();
	const saves = new TextFileSaveService(service, new VirtualHeadlessClock(), catalog);
	const resource = { contextLabel: 'Fixture project', sourceFilePath: 'source.lua', location: { kind: 'workspace' as const, path: 'source.lua' },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'source.lua', source: { type: 'lua' as const, resid: 'source' } };
	const source = (membership === 'retired' ? service : other).retain(resource, 'lua', 'return true');
	source.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	if (membership === 'retired') service.clear();
	const current = service.retain(resource, 'lua', 'return true');
	const input = new SourceInput(source);
	t.after(async () => { await saves.shutdown(); input.dispose(); service.clear(); other.clear(); catalog.dispose(); });
	assert.notEqual(current, source);
	assert.deepEqual(current.identity, source.identity);
	input.present(source);
	assert.equal(input.isDirty(), true);
	assert.equal(input.canSave(saves), false);
	assert.equal(input.canSave(saves, true), false);
	input.present(source, current);
	assert.equal(input.isDirty(), true);
	assert.equal(current.dirty, false);
	assert.equal(input.canSave(saves), false);
	assert.equal(input.canSave(saves, true), true);
	current.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- current\n' }]);
	assert.equal(input.canSave(saves), true);
	await saves.shutdown();
	assert.equal(input.canSave(saves), false);
	assert.equal(input.canSave(saves, true), false);
});
