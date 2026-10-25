import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant, measureGutterWidth, updateGutterWidth } from '../../ide/editor/ui/view/view';

for (const variant of ['tiny', 'msx'] as const) test(`${variant} intrinsic gutter measurement is current, cached and separate from publication`, t => {
	const clock = new VirtualHeadlessClock();
	const model = new EditorTextModel({ location: { kind: 'workspace' as const, path: 'gutter.lua' }, domain: 0, path: 'gutter.lua', source: { resid: 'gutter', type: 'lua' } }, 'lua', '\n'.repeat(98));
	activeCodeEditor.attach(model, createCodeEditorViewState());
	configureFontVariant(clock, variant, 'lua');
	t.after(() => { activeCodeEditor.detach(); model.dispose(); });
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
	configureFontVariant(clock, variant === 'tiny' ? 'msx' : 'tiny', 'lua');
	assert.notEqual(measureGutterWidth(), wider, 'intrinsic constraints immediately follow current font metrics');
});
