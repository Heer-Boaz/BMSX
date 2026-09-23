import { MultilineFieldControl } from '../../ide/editor/ui/inline/multiline_control';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { PointerButton } from '../../ide/input/pointer/buttons';
import { inputFocus } from '../../ide/input/focus';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MultilineFieldViewport } from '../../ide/editor/ui/inline/multiline_viewport';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { setCursorFromOffset, setFieldText } from '../../ide/editor/ui/inline/text_field';

const measure = (_text: string, start: number, end: number) => end - start;

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
