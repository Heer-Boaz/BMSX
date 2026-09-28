import { MultilineFieldControl } from '../../ide/editor/ui/inline/multiline_control';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { PointerButton } from '../../ide/input/pointer/buttons';
import { inputFocus } from '../../ide/input/focus';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MultilineFieldViewport } from '../../ide/editor/ui/inline/multiline_viewport';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { setCursorFromOffset, setFieldText } from '../../ide/editor/ui/inline/text_field';
import { MarkdownSource } from '../../ide/common/markdown/source';
import { TextStyle } from '../../ide/common/markdown/model';

const measure = (_text: string, start: number, end: number) => end - start;

test('styled source measures each codepoint once and shares advances with wrapping, pointer and caret', () => {
	const field = new TextField(), view = new MultilineFieldViewport(true), source = new MarkdownSource(), font = {};
	const text = '🐉 **bold** *wide italic* `code`\n\treturn';
	setFieldText(field, text, false); source.update(text);
	let measurements = 0;
	const measure = (_text: string, _from: number, _to: number, style: TextStyle) => { measurements++; return style & TextStyle.Italic ? 2 : 1; };
	view.update(field, 14, 8, measure, font, source.styles);
	assert.equal(measurements, [...text].filter(char => char !== '\n').length);
	for (let rowIndex = 0; rowIndex < view.rows.length; rowIndex++) {
		const row = view.rows[rowIndex];
		assert.equal(row.text, text.slice(row.offset, row.offset + row.text.length));
		assert.equal(row.styles!.map(span => row.text.slice(span.from, span.to)).join(''), row.text);
		for (let index = 0; index < row.text.length;) {
			assert.equal(view.offsetAt(rowIndex, row.advances[index]), row.offset + index);
			index += row.text.codePointAt(index)! > 0xffff ? 2 : 1;
		}
	}
	const rows = view.rows.slice(), measured = measurements;
	setCursorFromOffset(field, text.indexOf('italic')); view.update(field, 14, 8, measure, font, source.styles);
	assert.equal(measurements, measured); assert.ok(view.rows.every((row, index) => row === rows[index]));
	assert.ok(view.rows[view.cursorRow].offset <= text.indexOf('italic'));
});

test('multiline geometry measures whole codepoints once and keeps UTF-16 source offsets', () => {
	const field = new TextField(), view = new MultilineFieldViewport(true);
	setFieldText(field, 'a🐉b', true);
	view.update(field, 20, 6, (text, start, end) => [...text.slice(start, end)].length, {});
	assert.deepEqual(view.rows[0].advances, [0, 1, 1, 2, 3]);
	assert.equal(view.offsetAt(0, 1.4), 1); assert.equal(view.offsetAt(0, 1.6), 3);
});

test('multiline fields preserve soft wrapping, empty lines and whole-codepoint pointer hits', () => {
	const field = new TextField(), view = new MultilineFieldViewport(), font = {};
	setFieldText(field, 'abcde\n\n🐉z', true); view.update(field, 3, 2, measure, font);
	assert.deepEqual(view.rows.map(row => [row.text, row.offset]), [['abc', 0], ['de', 3], ['', 6], ['🐉z', 7]]);
	assert.equal(view.firstRow, 2); assert.equal(view.offsetAt(3, 1.1), 9);
	setCursorFromOffset(field, 0); view.update(field, 3, 2, measure, font); assert.equal(view.firstRow, 0);
	const rows = view.rows.slice(); view.update(field, 3, 2, measure, font); assert.ok(view.rows.every((row, index) => row === rows[index]));
});


test('multiline pointer selection retires on focus transfer and pane detachment', () => {
	const field = new TextField(), view = new MultilineFieldViewport(), control = new MultilineFieldControl();
	setFieldText(field, 'first\nsecond', false); view.update(field, 20, 2, measure, {});
	control.rowHeight = 10; control.setInput(field, view, { left: 0, top: 0, right: 30, bottom: 25 });
	const pointer = { valid: true, insideViewport: true, viewportX: 4, viewportY: 3,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	assert.equal(control.handlePointer(pointer), true); assert.equal(pointerCapture.active, true);
	const next = inputFocus.createTarget(); next.focus();
	assert.equal(pointerCapture.active, false); assert.equal(field.pointerSelecting, false);
	control.handlePointer(pointer); assert.equal(pointerCapture.active, true);
	control.clearInput(); assert.equal(pointerCapture.active, false);
	inputFocus.setTarget(null);
});

test('chat composer reuses word wrapping without losing source spaces or caret offsets', () => {
	const field = new TextField(), view = new MultilineFieldViewport(true), font = {};
	setFieldText(field, 'alpha beta gamma\n🐉 last', true); view.update(field, 11, 8, measure, font);
	assert.deepEqual(view.rows.map(row => [row.text, row.offset]), [['alpha beta ', 0], ['gamma', 11], ['🐉 last', 17]]);
	assert.equal(view.rows.slice(0, 2).map(row => row.text).join(''), field.lines[0]);
	assert.equal(view.offsetAt(2, 1.1), 19);
	setCursorFromOffset(field, 11); view.update(field, 11, 8, measure, font);
	assert.equal(view.cursorRow, 1);
});
