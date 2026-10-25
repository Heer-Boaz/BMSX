import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { setFieldText, setCursorFromOffset, applyInlineFieldEditing } from '../../ide/editor/ui/inline/text_field';
import { configureFontVariant, getCodeAreaBounds } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { editorSearchState } from '../../ide/workbench/contrib/code_editor/find/widget_state';
import { refreshWorkbenchLayout, getWorkbenchEditorBounds } from '../../ide/workbench/common/layout';
import { InlineBarFieldLayout } from '../../ide/workbench/contrib/code_editor/inline_bar/field';
import { layoutInlineWidgets } from '../../ide/quick_input/inline_widget';
import { getSearchFieldLayout } from '../../ide/workbench/contrib/code_editor/inline_bar/layout';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { editorCaretState } from '../../ide/editor/ui/view/caret/state';

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} accepted field keys restart the visible caret without changing unrelated key phases`, t => {
		configureFontVariant(new VirtualHeadlessClock(), variant, null);
		const field = new TextField(null, { singleLine: true, allowSpace: true });
		const visible = editorCaretState.cursorVisible, timer = editorCaretState.blinkTimer;
		t.after(() => { editorCaretState.cursorVisible = visible; editorCaretState.blinkTimer = timer; });
		for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'KeyA']) {
			setFieldText(field, 'query', true); setCursorFromOffset(field, 2);
			editorCaretState.cursorVisible = false; editorCaretState.blinkTimer = 0.49;
			applyInlineFieldEditing(new KeyInputEvent(key, key === 'KeyA' ? KeyModifier.ctrl : KeyModifier.none), field);
			assert.equal(editorCaretState.cursorVisible, true, `${key} must show its admitted text caret`);
			assert.equal(editorCaretState.blinkTimer, 0);
		}
		editorCaretState.cursorVisible = false; editorCaretState.blinkTimer = 0.49;
		applyInlineFieldEditing(new KeyInputEvent('F5', KeyModifier.none), field);
		assert.equal(editorCaretState.cursorVisible, false); assert.equal(editorCaretState.blinkTimer, 0.49);
	});

	test(`${variant} source viewport consumes the space reserved for the Find field`, t => {
		configureFontVariant(new VirtualHeadlessClock(), variant, null);
		const model = new EditorTextModel({ location: { kind: 'workspace' as const, path: 'inline.lua' }, domain: 0, path: 'inline.lua', source: { type: 'lua', resid: 'inline' } }, 'lua', '-- source');
		activeCodeEditor.attach(model, createCodeEditorViewState());
		t.after(() => { editorSearchState.visible = false; activeCodeEditor.detach(); model.dispose(); });
		editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
		editorSearchState.visible = true; refreshWorkbenchLayout();
		assert.ok(editorViewState.codeAreaTop > getWorkbenchEditorBounds().top);
		assert.equal(getCodeAreaBounds().codeTop, editorViewState.codeAreaTop);
		assert.equal(getCodeAreaBounds().codeBottom, getWorkbenchEditorBounds().bottom);
		setFieldText(editorSearchState.field, 'query_before_paint', true);
		layoutInlineWidgets();
		const fieldLayout = getSearchFieldLayout();
		assert.equal(editorSearchState.field.nativeCaret.y, fieldLayout.bounds.top + 2);
		assert.equal(editorSearchState.field.nativeCaret.x, fieldLayout.bounds.left + 3
			+ fieldLayout.viewport.advances[editorSearchState.field.text.length] - fieldLayout.viewport.offset);
		assert.equal(model.buffer.getText(), '-- source');
	});

	test(`${variant} inline field gives its bounded viewport priority over optional label and metadata`, () => {
		configureFontVariant(new VirtualHeadlessClock(), variant, null);
		const field = new TextField(null, { singleLine: true, allowSpace: true });
		const layout = new InlineBarFieldLayout(field);
		setFieldText(field, 'long_query_with_a_visible_caret', true);
		const width = variant === 'tiny' ? 78 : 118;
		layout.layout({ left: 73, top: 20, right: 73 + width, bottom: 40 }, 'Find all', '123/456', 2);
		assert.equal(layout.bounds.left >= 73, true);
		assert.equal(layout.bounds.right <= 73 + width, true);
		assert.ok(layout.bounds.right - layout.bounds.left - 6 >= 10 * editorViewState.charAdvance, 'query retains its measured minimum before optional metadata');
		assert.ok(layout.viewport.start > 0);
		assert.equal(layout.viewport.end, field.text.length);
		assert.ok(field.nativeCaret.x >= layout.bounds.left + 3);
		assert.ok(field.nativeCaret.x + field.nativeCaret.width <= layout.bounds.right - 3);
		assert.equal(field.nativeCaret.y, 22);
		assert.equal(field.nativeCaret.height, editorViewState.lineHeight);
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
		configureFontVariant(new VirtualHeadlessClock(), variant, null);
		const field = new TextField(null, { singleLine: true, allowSpace: true });
		setFieldText(field, 'unchanged_query', true);
		const layout = new InlineBarFieldLayout(field), bar = { left: 73, top: 20, right: 500, bottom: 40 };
		let measurements = 0;
		const measure = editorViewState.font.measure.bind(editorViewState.font);
		t.mock.method(editorViewState.font, 'measure', (text: string) => { measurements++; return measure(text); });
		layout.layout(bar, 'Find', '1/1', 2);
		const measured = measurements, advances = layout.viewport.advances, bounds = layout.bounds;
		for (let frame = 0; frame < 1000; frame++) layout.layout(bar, 'Find', '1/1', 2);
		assert.equal(measurements, measured);
		assert.equal(layout.viewport.advances, advances); assert.equal(layout.bounds, bounds);
	});

	test(`${variant} removing a field rectangle revokes input once without discarding its draft`, () => {
		configureFontVariant(new VirtualHeadlessClock(), variant, null);
		const field = new TextField(null, { singleLine: true, allowSpace: true }), layout = new InlineBarFieldLayout(field);
		setFieldText(field, 'retained_query', true);
		let cancellations = 0;
		field.focusTarget.onDidCancelInput(() => cancellations++);
		layout.layout({ left: 0, top: 20, right: 180, bottom: 40 }, 'FIND', '', 2);
		layout.hide(); layout.hide();
		assert.equal(cancellations, 1);
		assert.equal(field.text, 'retained_query'); assert.equal(field.nativeCaret.width, 0); assert.equal(field.nativeCaret.height, 0);
		layout.layout({ left: 0, top: 20, right: 180, bottom: 40 }, 'FIND', '', 2);
		assert.ok(field.nativeCaret.width > 0); assert.equal(field.nativeCaret.height, editorViewState.lineHeight);
		layout.hide(); assert.equal(cancellations, 2);
	});
}
