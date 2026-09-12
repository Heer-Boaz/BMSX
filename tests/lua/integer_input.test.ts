import assert from 'node:assert/strict';
import test from 'node:test';
import { INTEGER_INPUT_FORMAT, parseIntegerInput } from '../../ide/editor/ui/inline/integer_input';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { insertValue, selectAll } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { HeadlessClipboard } from '../../ide/testing/clipboard';
import { editorFeedbackState } from '../../ide/common/feedback_state';

test('integer control admits decimal signed words at the human-input boundary, not expressions', () => {
	for (const [text, value] of [['0', 0], ['+17', 17], ['-0', -0], ['00017', 17],
		['2147483647', 0x7fffffff], ['-2147483648', -0x80000000]] as const) {
		assert.deepEqual(parseIntegerInput(text), { value });
	}
	for (const text of ['', '-', '+', '1.5', '1e3', '0x11', '1+2', ' 17', '17 ', '17\n', '17\r\n', '\n17',
		'2147483648', '-2147483649', '999999999999999999999999999999999999999999']) {
		assert.deepEqual(parseIntegerInput(text), { error: 'Enter a signed 32-bit integer' }, text);
	}
});

test('integer draft history is local; accepting or valid blur publishes exactly one value change', (t) => {
	const parent = inputFocus.createTarget();
	const accepted: number[] = [];
	const input = new ValueInput(parent, new HeadlessClipboard(), INTEGER_INPUT_FORMAT, value => accepted.push(value));
	t.after(() => { inputFocus.setTarget(null); input.dispose(); });
	input.setValue(5);
	input.field.focusTarget.focus();
	insertValue(input.field, '1');
	insertValue(input.field, '7');
	assert.equal(input.pending, true);
	inputFocus.executeCommand('undo');
	assert.equal(input.field.text, '1');
	inputFocus.executeCommand('redo');
	assert.equal(input.field.text, '17');
	assert.deepEqual(accepted, []);
	assert.equal(input.commit(), true);
	assert.equal(input.pending, false);
	assert.equal(input.field.canUndo, false);
	input.field.focusTarget.release();
	assert.deepEqual(accepted, [17], 'subsequent blur does not accept the same value twice');
	input.field.focusTarget.focus();
	insertValue(input.field, '-23');
	parent.focus();
	assert.deepEqual(accepted, [17, -23]);
	assert.equal(input.field.text, '-23');
});

test('invalid submission retains focused draft; leaving visibly cancels, never publishes invalid source', (t) => {
	const parent = inputFocus.createTarget();
	const input = new ValueInput(parent, new HeadlessClipboard(), INTEGER_INPUT_FORMAT, () => assert.fail('invalid value accepted'));
	t.after(() => { inputFocus.setTarget(null); input.dispose(); });
	input.setValue(17);
	input.field.focusTarget.focus();
	insertValue(input.field, '-');
	assert.equal(input.commit(), false);
	assert.equal(input.field.focusTarget.hasFocus, true);
	assert.equal(input.field.text, '-');
	assert.equal(input.pending, true);
	assert.equal(input.error, 'Enter a signed 32-bit integer');
	selectAll(input.field);
	insertValue(input.field, '2147483648');
	assert.equal(input.error, '', 'new user input clears the obsolete error');
	assert.equal(input.commit(), false);
	parent.focus();
	assert.equal(input.field.text, '17');
	assert.equal(input.pending, false);
	assert.equal(input.field.canUndo, false);
	assert.equal(editorFeedbackState.message.text, 'Invalid integer edit cancelled; source unchanged.');
});
