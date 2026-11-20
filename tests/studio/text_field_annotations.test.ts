import assert from 'node:assert/strict';
import test from 'node:test';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { insertAnnotatedValue, insertValue, deleteSelection, setFieldText, setCursorFromOffset, setSelectionAnchorFromOffset } from '../../ide/editor/ui/inline/text_field';

test('inline references track exact edits and participate atomically in Undo/Redo', () => {
	const field = new TextField<{ path: string }>(), resource = { path: 'cart.lua' };
	setFieldText(field, '🐉 @ca', true); setSelectionAnchorFromOffset(field, 3);
	let notifications = 0;
	field.onDidChangeText(() => { notifications++; });
	insertAnnotatedValue(field, '@cart.lua', resource, ' ');
	assert.equal(notifications, 1);
	assert.deepEqual(field.annotations, [{ from: 3, to: 12, data: resource }]);
	field.undo(); assert.equal(field.text, '🐉 @ca'); assert.deepEqual(field.annotations, []);
	field.redo(); assert.equal(field.text, '🐉 @cart.lua ');
	setCursorFromOffset(field, 0); insertValue(field, 'prefix ');
	assert.deepEqual(field.annotations, [{ from: 10, to: 19, data: resource }]);
	setCursorFromOffset(field, 15); insertValue(field, 'X');
	assert.deepEqual(field.annotations, [], 'editing the referenced token removes its attachment');
	field.undo(); assert.equal(field.annotations[0].data, resource);
	setFieldText(field, '', true); assert.deepEqual(field.annotations, []); assert.equal(field.canUndo, false);
});

test('identical token replacements use producer edit ranges, not an ambiguous text diff', () => {
	const field = new TextField<string>();
	insertAnnotatedValue(field, '@same', 'first', ' ');
	insertAnnotatedValue(field, '@same', 'second', ' ');
	setSelectionAnchorFromOffset(field, 0); setCursorFromOffset(field, 6); deleteSelection(field);
	assert.deepEqual(field.annotations, [{ from: 0, to: 5, data: 'second' }]);
	field.undo(); assert.deepEqual(field.annotations.map(span => span.data), ['first', 'second']);
	setSelectionAnchorFromOffset(field, 0); setCursorFromOffset(field, 5);
	insertAnnotatedValue(field, '@same', 'third');
	assert.deepEqual(field.annotations.map(span => span.data), ['third', 'second']);
	field.undo(); assert.deepEqual(field.annotations.map(span => span.data), ['first', 'second']);
});
