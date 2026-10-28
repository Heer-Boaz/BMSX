import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { measureCodeEditorWidth } from '../../ide/editor/ui/view/view';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { measureSourceEditor } from '../../ide/workbench/contrib/code_editor/constraints';
import type { EditorPaneConstraints } from '../../ide/workbench/services/editor/editor_pane';
import { createTestCodeControl } from '../helpers/code_control';
import { createTestCodeDocuments } from '../helpers/code_documents';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';

for (const variant of ['tiny', 'msx'] as const) test(`${variant} Source retains a usable hard editing floor independently of companion reading intent`, t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], contextLabel: 'Fixture project', path: 'source.lua',
		sourceFilePath: 'source.lua', location: { kind: 'workspace', path: 'source.lua' }, source: { resid: 'source', type: 'lua' } }, 'lua', 'return 42');
	const input = new CodeEditorInput(model); t.after(() => input.dispose());
	const font = new EditorFont(variant), code = createTestCodeControl(t, model, documents, clock, input.context.view, font);
	const target: EditorPaneConstraints = { minimumWidth: 0, minimumHeight: 0, companionWidth: undefined };
	const version = model.version, source = model.buffer.getText();
	measureSourceEditor(input, font, false, target);
	// This focused width-policy contract reserves 16 editable columns and the caret, not incidental UI coordinates.
	const hard = measureCodeEditorWidth(model, font, 17);
	assert.equal(target.minimumWidth, hard); assert.equal(code.minimumWidth, hard);
	assert.equal(target.minimumHeight, code.minimumHeight); assert.equal(target.companionWidth, undefined);
	measureSourceEditor(input, font, true, target);
	assert.equal(target.minimumWidth, hard); assert.equal(target.companionWidth, measureCodeEditorWidth(model, font, 49));
	assert.ok(target.companionWidth > hard, 'comfortable reading remains a separate optional allocation budget');
	const advance = t.mock.method(font, 'advance');
	for (let frame = 0; frame < 1000; frame++) {
		measureSourceEditor(input, font, (frame & 1) === 0, target);
		assert.equal(code.minimumWidth, hard); assert.equal(target.minimumWidth, hard);
	}
	assert.equal(advance.mock.callCount(), 0, 'warm constraints reuse the same model/font gutter and column metrics');
	assert.equal(model.version, version); assert.equal(model.buffer.getText(), source);
});
