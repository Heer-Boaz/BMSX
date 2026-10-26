import assert from 'node:assert/strict';
import test from 'node:test';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant, measureGutterWidth, updateGutterWidth } from '../../ide/editor/ui/view/view';
import { createTestCodeDocuments } from '../helpers/code_documents';

for (const variant of ['tiny', 'msx'] as const) test(`${variant} intrinsic gutter measurement is current, cached and separate from publication`, t => {
	const { models, documents } = createTestCodeDocuments(t);
	const model = models.retain({ location: { kind: 'workspace' as const, path: 'gutter.lua' }, domain: 0, path: 'gutter.lua', source: { resid: 'gutter', type: 'lua' } }, 'lua', '\n'.repeat(98));
	activeCodeEditor.attach(model, createCodeEditorViewState());
	configureFontVariant(variant, documents.get(model));
	t.after(() => { activeCodeEditor.detach(); editorViewState.layout.dispose(); });
	const published = updateGutterWidth(), advance = t.mock.method(editorViewState.font, 'advance');
	for (let frame = 0; frame < 1000; frame++) {
		assert.equal(measureGutterWidth(), published); assert.equal(updateGutterWidth(), published);
	}
	assert.equal(advance.mock.callCount(), 0, 'the intrinsic consumer and viewport producer share one measured gutter');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '\n' }]);
	const wider = measureGutterWidth();
	assert.ok(wider > published, 'crossing a decimal line-count boundary reserves its real new digit');
	assert.equal(editorViewState.gutterWidth, published, 'asking for a constraint does not publish an arrangement');
	assert.equal(updateGutterWidth(), wider);
	configureFontVariant(variant === 'tiny' ? 'msx' : 'tiny', documents.get(model));
	assert.notEqual(measureGutterWidth(), wider, 'intrinsic constraints immediately follow current font metrics');
});
