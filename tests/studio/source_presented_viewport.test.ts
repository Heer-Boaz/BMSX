import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createTestCodeDocuments } from '../helpers/code_documents';
import { createTestCodeControl } from '../helpers/code_control';
import { createActualSourcePanes } from '../helpers/source_panes';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { resolveCodeAreaViewport } from '../../ide/editor/ui/code/area_viewport';
import { clearBackgroundTasks } from '../../ide/common/background_tasks';
import { inputFocus } from '../../ide/input/focus';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { InlineBarFieldLayout } from '../../ide/workbench/contrib/code_editor/inline_bar/field';

function fixture(t: TestContext, variant: 'tiny' | 'msx') {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const source = '-- ' + 'x'.repeat(200), path = 'presented.lua';
	const resource = { contextLabel: 'Fixture', sourceFilePath: path, location: { kind: 'workspace' as const, path },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, source: { type: 'lua' as const, resid: path } };
	const model = models.retain(resource, 'lua', source), input = new CodeEditorInput(model);
	const code = createTestCodeControl(t, model, documents, clock, input.context.view, new EditorFont(variant));
	t.after(() => { input.dispose(); inputFocus.setTarget(null); clearBackgroundTasks(); });
	return { code, model, input, source };
}

// Presented clipping and glyph intersection are these geometry-owner contracts;
// these assertions do not freeze any incidental workbench position or wording.
for (const variant of ['tiny', 'msx'] as const) test(`${variant} source caret consumes presented clipping without reflowing the logical document`, t => {
	const { code, model, source } = fixture(t, variant);
	const logical = { left: -100, top: 40, right: 500, bottom: 240 }, clip = { left: 0, top: 40, right: 200, bottom: 240 };
	code.setBounds(logical, clip); code.nativeText.setSelection(0, 0);
	let caret = code.nativeText.caretRect();
	assert.equal(caret.width, 0); assert.equal(caret.height, 0, 'a logical caret outside the exposed leaf has no native anchor');
	const viewport = resolveCodeAreaViewport(code), position = Math.trunc((clip.left - viewport.textLeft) / code.charAdvance) + 3;
	code.nativeText.setSelection(position, position);
	caret = code.nativeText.caretRect();
	assert.ok(caret.width > 0 && caret.height > 0);
	assert.ok(caret.x >= clip.left && caret.x + caret.width <= clip.right);
	assert.ok(caret.y >= clip.top && caret.y + caret.height <= clip.bottom);
	const visible = { ...caret }, projected = { left: caret.x + 1, top: caret.y + 1, right: caret.x + caret.width, bottom: caret.y + caret.height };
	const layout = code.layout, lines = layout.getVisualLines(), dirty = t.mock.method(layout, 'markVisualLinesDirty');
	code.setBounds(logical, projected);
	assert.deepEqual(code.nativeText.caretRect(), { x: projected.left, y: projected.top, width: visible.width - 1, height: visible.height - 1 });
	assert.equal(code.layout, layout); assert.equal(code.layout.getVisualLines(), lines); assert.equal(dirty.mock.callCount(), 0);
	assert.deepEqual(code.geometry.clientBounds, logical); assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
	code.setBounds(logical, { left: 600, top: 40, right: 700, bottom: 240 });
	assert.equal(code.focusTarget.canFocus!(), false);
	assert.equal(code.nativeText.caretRect().width, 0); assert.equal(code.nativeText.caretRect().height, 0);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} source minimum geometry admits one real text cell and scrollbars rather than a reading-column policy`, t => {
	const { code } = fixture(t, variant);
	for (const wrap of [true, false]) {
		code.view.wordWrapEnabled = wrap; code.layout.markVisualLinesDirty();
		code.setBounds({ left: 0, top: 0, right: code.minimumWidth, bottom: code.minimumHeight });
		const viewport = resolveCodeAreaViewport(code);
		assert.ok(viewport.contentWidth >= code.charAdvance); assert.ok(viewport.rows >= 1);
		code.nativeText.setSelection(0, 0);
		const caret = code.nativeText.caretRect(); assert.ok(caret.width > 0 && caret.height > 0);
		assert.ok(caret.x + caret.width <= code.geometry.presentedBounds.right);
		assert.ok(caret.y + caret.height <= code.geometry.presentedBounds.bottom);
	}
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} source inline fields retain drafts while their actual presented clip controls native placement and focus`, t => {
	const { code } = fixture(t, variant), field = new TextField(null, { singleLine: true, allowSpace: true });
	const layout = new InlineBarFieldLayout(code, field), logical = { left: -100, top: 20, right: 500, bottom: 80 };
	const clip = { left: 0, top: 20, right: 100, bottom: 80 };
	field.focusTarget.canFocus = () => layout.visible;
	t.after(() => layout.hide());
	setFieldText(field, 'x'.repeat(100), false); layout.layout(logical, '', '', 2, clip);
	assert.equal(layout.visible, true); assert.equal(field.caretRect().width, 0);
	const position = Math.trunc((clip.left - layout.viewport.textLeft) / code.charAdvance) + 3;
	field.setSelection(position, position);
	const caret = field.caretRect(); assert.ok(caret.width > 0 && caret.height > 0);
	assert.ok(caret.x >= clip.left && caret.x + caret.width <= clip.right);
	field.focusTarget.focus(); const text = field.text, revision = field.revision;
	layout.layout(logical, '', '', 2, { left: 600, top: 20, right: 700, bottom: 80 });
	assert.equal(layout.visible, false); assert.notEqual(inputFocus.admittedTarget, field.focusTarget);
	assert.equal(field.caretRect().width, 0); assert.equal(field.caretRect().height, 0);
	assert.equal(field.text, text); assert.equal(field.revision, revision);
	layout.layout(logical, '', '', 2, clip);
	assert.equal(layout.visible, true); assert.notEqual(inputFocus.admittedTarget, field.focusTarget, 'regaining space cannot reclaim text input');
	field.focusTarget.focus(); assert.equal(inputFocus.admittedTarget, field.focusTarget);
});

test('a real Source pane receives the group presentation clip for code and its inline fields', t => {
	const f = createActualSourcePanes(t, false, [['wide.lua', '-- ' + 'x'.repeat(200)]]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'wide.lua' })!;
	f.firstGroup.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, resource));
	const bounds = { left: -100, top: 40, right: 500, bottom: 240 }, clip = { left: 0, top: 40, right: 200, bottom: 240 };
	f.firstGroup.layout(bounds, clip, true);
	f.first.code.nativeText.setSelection(0, 0);
	assert.equal(f.first.code.nativeText.caretRect().width, 0);
	f.first.code.nativeText.setSelection(30, 30);
	const caret = f.first.code.nativeText.caretRect(); assert.ok(caret.width > 0 && caret.x >= clip.left);
	f.first.find.openSearch(false);
	setFieldText(f.first.find.state.field, 'query', false); f.first.layoutInlineWidgets();
	assert.equal(f.first.find.state.field.caretRect().width, 0, 'Find consumes the same actual parent clip, not its full logical bar');
	const model = f.first.code.model!, source = model.buffer.getText();
	f.firstGroup.layout(bounds, { left: 600, top: 40, right: 700, bottom: 240 }, false);
	assert.equal(f.first.code.focusTarget.canFocus!(), false); assert.equal(f.first.find.fieldLayout.visible, false);
	assert.equal(f.first.find.state.field.text, 'query'); assert.equal(model.buffer.getText(), source);
});
