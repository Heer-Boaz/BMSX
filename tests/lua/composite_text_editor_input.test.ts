import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorTextModel } from '../../ide/editor/model/text_model';
import { CompositeTextEditorInput } from '../../ide/workbench/common/composite_text_editor_input';

class SourceInput extends CompositeTextEditorInput<'fixture', 'fixture'> {
	public constructor(public readonly workingCopy: EditorTextModel) { super('fixture', 'fixture', 'SOURCES', true); }
	public present(...models: EditorTextModel[]): void { this.setWorkingCopies(new Set(models)); }
}

test('composite source membership, dirty notifications and write access follow real working copies', t => {
	const service = new EditorTextModelService();
	const [a, b, c] = ['a', 'b', 'c'].map(path => service.retain({ domain: 0, path, source: { type: 'lua', resid: path } }, 'lua', path));
	const input = new SourceInput(a);
	t.after(() => { input.dispose(); service.clear(); });
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
	assert.equal(input.canSave(), true);
	c.refreshResource({ ...c.resource, source: { ...c.resource.source, generated: true } });
	assert.equal(input.canSave(), false, 'clean writable plus dirty read-only sources do not enable a no-op Save');
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
