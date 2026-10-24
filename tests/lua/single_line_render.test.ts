import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import * as colors from '../../ide/common/constants';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { drawValueInput } from '../../ide/editor/ui/inline/value_input_render';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { inputFocus } from '../../ide/input/focus';
import { api } from '../../ide/runtime/overlay_api';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { SingleLineFieldViewport } from '../../ide/editor/ui/inline/single_line_viewport';
import { drawSingleLineField } from '../../ide/editor/ui/inline/single_line_render';
import { setFieldText, setCursorFromOffset } from '../../ide/editor/ui/inline/text_field';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorCaretState } from '../../ide/editor/ui/view/caret/state';

for (const variant of ['tiny', 'msx'] as const) test(`${variant} line edits paint active selection only for their actual focused field`, t => {
	configureFontVariant(new VirtualHeadlessClock(), variant, null);
	const parent = inputFocus.createTarget(); parent.bindKeyboard(() => {});
	const first = new ValueInput(parent, INTEGER_INPUT_FORMAT, () => {}), second = new ValueInput(parent, INTEGER_INPUT_FORMAT, () => {});
	t.after(() => { inputFocus.setTarget(null); first.dispose(); second.dispose(); });
	first.setValue(17); second.setValue(29);
	first.field.focusTarget.focus(); second.field.focusTarget.focus();
	assert.notEqual(first.field.selectionAnchor, null); assert.notEqual(second.field.selectionAnchor, null);
	const fills: Parameters<typeof api.fill_rect>[] = [], spans: Parameters<typeof api.blit_text_inline_span_with_font>[] = [];
	t.mock.method(api, 'fill_rect', (...args: Parameters<typeof api.fill_rect>) => { fills.push(args); });
	t.mock.method(api, 'blit_rect', () => {});
	t.mock.method(api, 'fill_rect_color', () => {});
	t.mock.method(api, 'blit_text_inline_with_font', () => {});
	t.mock.method(api, 'blit_text_inline_span_with_font', (...args: Parameters<typeof api.blit_text_inline_span_with_font>) => { spans.push(args); });
	const bounds = { left: 4, top: 30, right: 100, bottom: 46 };
	first.layout(96); drawValueInput(first, bounds);
	assert.equal(fills.some(fill => fill[5] === colors.SELECTION_OVERLAY), false);
	assert.equal(spans.some(span => span[6] === colors.COLOR_SELECTION_TEXT), false);
	fills.length = 0; spans.length = 0;
	second.layout(96); drawValueInput(second, bounds);
	assert.equal(fills.some(fill => fill[5] === colors.SELECTION_OVERLAY), true);
	assert.equal(spans.some(span => span[6] === colors.COLOR_SELECTION_TEXT), true);
	assert.deepEqual([first.field.text, second.field.text], ['17', '29']);
	assert.notEqual(first.field.selectionAnchor, null, 'presentation does not mutate the retained draft/selection history');
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} a line-edit caret redraws its actual case-preserved glyph`, t => {
	configureFontVariant(new VirtualHeadlessClock(), variant, null);
	const uppercase = editorRuntimeState.uppercaseDisplay, visible = editorCaretState.cursorVisible;
	t.after(() => { inputFocus.setTarget(null); editorRuntimeState.uppercaseDisplay = uppercase; editorCaretState.cursorVisible = visible; });
	editorRuntimeState.uppercaseDisplay = true;
	const field = new TextField(null, { singleLine: true, allowSpace: true });
	setFieldText(field, 'needle', true); setCursorFromOffset(field, 0); field.focusTarget.focus();
	const view = new SingleLineFieldViewport();
	view.update(field, 100, editorViewState.inlineFieldMetricsRef, editorViewState.font.renderFont());
	const glyphs: string[] = [];
	t.mock.method(api, 'fill_rect', () => {}); t.mock.method(api, 'fill_rect_color', () => {});
	t.mock.method(api, 'blit_text_inline_span_with_font', () => {});
	t.mock.method(api, 'blit_text_inline_with_font', (text: string) => { glyphs.push(text); });
	for (const phase of [false, true]) {
		editorCaretState.cursorVisible = phase;
		drawSingleLineField(field, view, { left: 0, top: 0, right: 106, bottom: 20 }, colors.COLOR_SEARCH_TEXT);
	}
	assert.deepEqual(glyphs, ['n'], 'blinking must not alternate lowercase field ink with an uppercase caret glyph');
	assert.equal(field.text, 'needle');
});
