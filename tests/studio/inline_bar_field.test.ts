import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { setFieldText, setCursorFromOffset, applyInlineFieldEditing } from '../../ide/editor/ui/inline/text_field';
import { getCodeAreaBounds } from '../../ide/editor/ui/view/view';
import { InlineBarFieldLayout } from '../../ide/workbench/contrib/code_editor/inline_bar/field';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { editorCaretState } from '../../ide/editor/ui/view/caret/state';
import { inputFocus } from '../../ide/input/focus';
import { createTestCodeDocuments } from '../helpers/code_documents';
import { createTestCodeControl } from '../helpers/code_control';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { EditorSearchController } from '../../ide/workbench/contrib/code_editor/find/search';
import { CodeEditorLineJump } from '../../ide/workbench/contrib/code_editor/find/line_jump';
import { RenameController } from '../../ide/workbench/contrib/code_editor/rename/controller';
import { CrossFileRenameManager } from '../../ide/workbench/contrib/code_editor/rename/operations';
import { SourceInlineBars } from '../../ide/workbench/contrib/code_editor/inline_bar/source_inline_bars';
import type { RuntimeSourceState } from '../../ide/runtime/sources';

function fixture(t: TestContext, variant: 'tiny' | 'msx') {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'inline.lua', location: { kind: 'workspace', path: 'inline.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'inline.lua',
		source: { type: 'lua', resid: 'inline' } }, 'lua', '-- source');
	const code = createTestCodeControl(t, model, documents, clock, undefined, new EditorFont(variant));
	t.after(() => inputFocus.setTarget(null));
	return code;
}


for (const variant of ['tiny', 'msx'] as const) {
	for (const axis of ['width', 'height'] as const) test(`${variant} empty inner ${axis} revokes an inline field without retiring its draft`, t => {
		const code = fixture(t, variant);
		const field = new TextField(null, { singleLine: true, allowSpace: true }), layout = new InlineBarFieldLayout(code, field);
		field.focusTarget.canFocus = () => layout.visible;
		t.after(() => { layout.hide(); inputFocus.setTarget(null); });
		const bar = { left: 0, top: 0, right: 180, bottom: 40 };
		layout.layout(bar, '', '', 2);
		// The producer's empty-field native origin supplies the current text insets.
		// These input budgets remove the inner client, not merely all outer chrome.
		const textInset = field.nativeCaret.x - bar.left, textTop = field.nativeCaret.y - bar.top;
		field.replaceText(0, 0, 'retained_draft'); layout.layout(bar, '', '', 2); field.focusTarget.focus();
		assert.ok(inputFocus.admittedTarget === field.focusTarget);
		const revision = field.revision;
		layout.layout({ ...bar, ...(axis === 'width' ? { right: textInset * 2 } : { bottom: textTop }) }, '', '', 2);
		assert.equal(layout.visible, false); assert.ok(inputFocus.admittedTarget !== field.focusTarget);
		assert.equal(field.nativeCaret.width, 0); assert.equal(field.nativeCaret.height, 0);
		assert.equal(field.text, 'retained_draft'); assert.equal(field.revision, revision); assert.equal(field.canUndo, true);
		layout.layout(bar, '', '', 2);
		assert.ok(inputFocus.admittedTarget !== field.focusTarget, 'layout recovery cannot silently reclaim native input');
		field.focusTarget.focus(); assert.ok(inputFocus.admittedTarget === field.focusTarget);
		field.undo(); assert.equal(field.text, ''); assert.equal(field.canRedo, true);
	});

	test(`${variant} accepted field keys restart the visible caret without changing unrelated key phases`, t => {
		const code = fixture(t, variant);
		const field = new TextField(null, { singleLine: true, allowSpace: true });
		code.caret.cursorVisible = false; code.caret.blinkTimer = 0.25;
		const visible = editorCaretState.cursorVisible, timer = editorCaretState.blinkTimer;
		t.after(() => { editorCaretState.cursorVisible = visible; editorCaretState.blinkTimer = timer; });
		for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'KeyA']) {
			setFieldText(field, 'query', true); setCursorFromOffset(field, 2);
			editorCaretState.cursorVisible = false; editorCaretState.blinkTimer = 0.49;
			applyInlineFieldEditing(new KeyInputEvent(key, key === 'KeyA' ? KeyModifier.ctrl : KeyModifier.none), field);
			assert.equal(editorCaretState.cursorVisible, true, `${key} must show its admitted text caret`);
			assert.equal(editorCaretState.blinkTimer, 0);
			assert.equal(code.caret.cursorVisible, false); assert.equal(code.caret.blinkTimer, 0.25);
		}
		editorCaretState.cursorVisible = false; editorCaretState.blinkTimer = 0.49;
		applyInlineFieldEditing(new KeyInputEvent('F5', KeyModifier.none), field);
		assert.equal(editorCaretState.cursorVisible, false); assert.equal(editorCaretState.blinkTimer, 0.49);
	});

	test(`${variant} source viewport consumes only its own Find field space`, t => {
		const code = fixture(t, variant), model = code.model;
		const sources = {} as RuntimeSourceState;
		const find = new EditorSearchController(code), lineJump = new CodeEditorLineJump(code);
		const rename = new RenameController(code, sources.catalog, new CrossFileRenameManager(sources.catalog));
		const bars = new SourceInlineBars(code, find, rename, lineJump);
		t.after(() => { find.dispose(); rename.dispose(); lineJump.dispose(); });
		const client = { left: 0, top: 10, right: 384, bottom: 270 };
		find.state.visible = true;
		setFieldText(find.state.field, 'query_before_paint', true);
		bars.layout(client);
		assert.ok(code.geometry.clientBounds.top > client.top);
		assert.equal(getCodeAreaBounds(code).codeTop, bars.searchBounds!.bottom);
		assert.equal(getCodeAreaBounds(code).codeBottom, client.bottom);
		const fieldLayout = find.fieldLayout, field = find.state.field;
		assert.equal(field.nativeCaret.y, fieldLayout.bounds.top + 2);
		assert.equal(field.nativeCaret.x, fieldLayout.bounds.left + 3
			+ fieldLayout.viewport.advances[field.text.length] - fieldLayout.viewport.offset);
		assert.equal(model.buffer.getText(), '-- source');
	});

	test(`${variant} inline field gives its bounded viewport priority over optional label and metadata`, t => {
		const code = fixture(t, variant);
		const field = new TextField(null, { singleLine: true, allowSpace: true });
		const layout = new InlineBarFieldLayout(code, field);
		setFieldText(field, 'long_query_with_a_visible_caret', true);
		const width = variant === 'tiny' ? 78 : 118;
		layout.layout({ left: 73, top: 20, right: 73 + width, bottom: 40 }, 'Find all', '123/456', 2);
		assert.equal(layout.bounds.left >= 73, true);
		assert.equal(layout.bounds.right <= 73 + width, true);
		assert.ok(layout.bounds.right - layout.bounds.left - 6 >= 10 * code.charAdvance, 'query retains its measured minimum before optional metadata');
		assert.ok(layout.viewport.start > 0);
		assert.equal(layout.viewport.end, field.text.length);
		assert.ok(field.nativeCaret.x >= layout.bounds.left + 3);
		assert.ok(field.nativeCaret.x + field.nativeCaret.width <= layout.bounds.right - 3);
		assert.equal(field.nativeCaret.y, 22);
		assert.equal(field.nativeCaret.height, layout.viewport.lineHeight);
		assert.equal(field.text, 'long_query_with_a_visible_caret');
		setCursorFromOffset(field, 0);
		layout.layout({ left: 73, top: 20, right: 73 + width, bottom: 40 }, 'Find all', '123/456', 2);
		assert.equal(layout.viewport.start, 0);
		assert.equal(field.nativeCaret.x, layout.bounds.left + 3);
		layout.layout({ left: 73, top: 20, right: 500, bottom: 40 }, 'Find all', '123/456', 2);
		assert.equal(layout.label, 'Find all'); assert.equal(layout.detail, '123/456');
		assert.ok(layout.detailX >= layout.bounds.right);
	});

	test(`${variant} unchanged field layout reuses its measured labels and glyph viewport`, t => {
		const code = fixture(t, variant);
		const field = new TextField(null, { singleLine: true, allowSpace: true });
		setFieldText(field, 'unchanged_query', true);
		const layout = new InlineBarFieldLayout(code, field), bar = { left: 73, top: 20, right: 500, bottom: 40 };
		let measurements = 0;
		const measure = code.font.measure.bind(code.font);
		t.mock.method(code.font, 'measure', (text: string) => { measurements++; return measure(text); });
		layout.layout(bar, 'Find', '1/1', 2);
		const measured = measurements, advances = layout.viewport.advances, bounds = layout.bounds;
		for (let frame = 0; frame < 1000; frame++) layout.layout(bar, 'Find', '1/1', 2);
		assert.equal(measurements, measured);
		assert.equal(layout.viewport.advances, advances); assert.equal(layout.bounds, bounds);
	});

	test(`${variant} removing a field rectangle revokes input once without discarding its draft`, t => {
		const code = fixture(t, variant);
		const field = new TextField(null, { singleLine: true, allowSpace: true }), layout = new InlineBarFieldLayout(code, field);
		setFieldText(field, 'retained_query', true);
		let cancellations = 0;
		field.focusTarget.onDidCancelInput(() => cancellations++);
		layout.layout({ left: 0, top: 20, right: 180, bottom: 40 }, 'FIND', '', 2);
		layout.hide(); layout.hide();
		assert.equal(cancellations, 1);
		assert.equal(field.text, 'retained_query'); assert.equal(field.nativeCaret.width, 0); assert.equal(field.nativeCaret.height, 0);
		layout.layout({ left: 0, top: 20, right: 180, bottom: 40 }, 'FIND', '', 2);
		assert.ok(field.nativeCaret.width > 0); assert.equal(field.nativeCaret.height, layout.viewport.lineHeight);
		layout.hide(); assert.equal(cancellations, 2);
	});
}
