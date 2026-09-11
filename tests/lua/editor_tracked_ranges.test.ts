import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import type { TrackedTextRange } from '../../ide/editor/text/text_change';

test('tracked model ranges are final before content observers, including earlier service listeners', () => {
	const models = new EditorTextModelService();
	const model = models.retain({ domain: 0, path: 'text.lua', source: { type: 'lua', resid: 'text' } }, 'lua', 'abc');
	const span = { start: 1, end: 3 };
	let observed = 0;
	models.onDidChangeContent(() => { observed += 1; assert.deepEqual(span, { start: 3, end: 5 }); });
	const release = model.trackRanges(new Map([['source', span]]));
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '😀' }]);
	assert.equal(observed, 1);
	release();
	models.clear();
});

test('tracked ranges follow edit, Undo and Redo once and keep complete replacement collapsed', () => {
	const model = new EditorTextModel({ domain: 0, path: 'text.lua', source: { type: 'lua', resid: 'text' } }, 'lua', 'abc');
	const span = { start: 1, end: 3 };
	const release = model.trackRanges(new Map([['source', span]]));
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '\r\n' }]);
	assert.deepEqual(span, { start: 3, end: 5 });
	model.undo(); assert.deepEqual(span, { start: 1, end: 3 });
	model.redo(); assert.deepEqual(span, { start: 3, end: 5 });
	model.revert(); assert.deepEqual(span, { start: 0, end: 0 });
	release(); model.dispose();
});

test('tracking uses application-order changes for multi-edit operations', () => {
	const model = new EditorTextModel({ domain: 0, path: 'text.lua', source: { type: 'lua', resid: 'text' } }, 'lua', 'abcd');
	const span = { start: 1, end: 3 };
	const release = model.trackRanges(new Map([['source', span]]));
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: 'L' }, { offset: 4, deleteLength: 0, text: 'R' }]);
	assert.equal(model.buffer.getTextRange(span.start, span.end), 'bc');
	model.undo(); assert.deepEqual(span, { start: 1, end: 3 });
	release(); model.dispose();
});

test('identical paths in different models never share range mapping', () => {
	const left = new EditorTextModel({ domain: 0, path: 'same.lua', source: { type: 'lua', resid: 'left' } }, 'lua', 'abc');
	const right = new EditorTextModel({ domain: 1, path: 'same.lua', source: { type: 'lua', resid: 'right' } }, 'lua', 'abc');
	const a = { start: 1, end: 3 }, b = { start: 1, end: 3 };
	const releaseLeft = left.trackRanges(new Map([[0, a]]));
	const releaseRight = right.trackRanges(new Map([[0, b]]));
	left.pushEditOperations([{ offset: 0, deleteLength: 0, text: 'left' }]);
	assert.deepEqual(a, { start: 5, end: 7 });
	assert.deepEqual(b, { start: 1, end: 3 });
	releaseLeft(); releaseRight(); left.dispose(); right.dispose();
});

test('released collections stop tracking without clearing or rewriting their retained values', () => {
	const model = new EditorTextModel({ domain: 0, path: 'text.lua', source: { type: 'lua', resid: 'text' } }, 'lua', 'abc');
	const spans = new Map<string, TrackedTextRange>([['a', { start: 0, end: 1 }]]);
	const release = model.trackRanges(spans);
	spans.set('bc', { start: 1, end: 3 });
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: 'x' }]);
	assert.deepEqual(spans.get('bc'), { start: 2, end: 4 });
	release();
	model.undo();
	assert.deepEqual(spans.get('bc'), { start: 2, end: 4 });
	model.dispose();
});
