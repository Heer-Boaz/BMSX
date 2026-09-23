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
