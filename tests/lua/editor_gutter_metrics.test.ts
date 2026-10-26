import { createTestCodeControl } from '../helpers/code_control';
import { EditorFont } from '../../ide/editor/ui/view/font';
import assert from 'node:assert/strict';
import test from 'node:test';
import { measureGutterWidth } from '../../ide/editor/ui/view/view';
import { createTestCodeDocuments } from '../helpers/code_documents';

for (const variant of ['tiny', 'msx'] as const) test(`${variant} intrinsic gutter measurement is current, cached and shared by layout constraints`, t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ sourceFilePath: 'gutter.lua', location: { kind: 'workspace' as const, path: 'gutter.lua' }, domain: 0, path: 'gutter.lua', source: { resid: 'gutter', type: 'lua' } }, 'lua', '\n'.repeat(98));
	const code = createTestCodeControl(t, model, documents, clock, undefined, new EditorFont(variant));
	const measured = measureGutterWidth(code), advance = t.mock.method(code.font, 'advance');
	for (let frame = 0; frame < 1000; frame++) {
		assert.equal(measureGutterWidth(code), measured);
	}
	assert.equal(advance.mock.callCount(), 0, 'the intrinsic consumer and viewport producer share one measured gutter');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '\n' }]);
	const wider = measureGutterWidth(code);
	assert.ok(wider > measured, 'crossing a decimal line-count boundary reserves its real new digit');
	code.setFont(new EditorFont(variant === 'tiny' ? 'msx' : 'tiny'));
	assert.notEqual(measureGutterWidth(code), wider, 'intrinsic constraints immediately follow current font metrics');
});
