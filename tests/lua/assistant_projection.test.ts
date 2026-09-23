import assert from 'node:assert/strict';
import test from 'node:test';
import { AssistantTranscriptProjection } from '../../ide/workbench/contrib/assistant/projection';
import type { AssistantEntry } from '../../ide/workbench/services/assistant/conversation';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';

const measure = (_text: string, start: number, end: number) => end - start;

test('streaming projection reads a bounded tail; unchanged frames neither read nor measure history', () => {
	const buffer = new PieceTreeBuffer(''), entry: AssistantEntry = { kind: 'assistant', text: buffer, index: 0, resetRevision: 0 };
	const view = new AssistantTranscriptProjection(), font = {};
	let read = 0, measured = 0;
	const getRange = buffer.getTextRange.bind(buffer);
	buffer.getTextRange = (start, end) => { read += end - start; return getRange(start, end); };
	const metrics = (_text: string, start: number, end: number) => { measured++; return end - start; };
	for (let index = 0; index < 10000; index++) {
		buffer.insert(buffer.length, 'word '); view.invalidate(0); view.update([entry], 40, metrics, font);
	}
	assert.ok(read < 450000, `only a row tail per delta, read=${read}`);
	const rows = view.rows.slice(), before = { read, measured };
	for (let index = 0; index < 1000; index++) assert.equal(view.update([entry], 40, metrics, font), false);
	assert.deepEqual({ read, measured }, before); assert.ok(view.rows.every((row, index) => row === rows[index]));
	buffer.insert(buffer.length, '\n🐉 next'); view.invalidate(0); view.update([entry], 40, metrics, font);
	assert.equal(view.rows[1], rows[1]); assert.equal(view.rows.at(-1)!.text, '🐉 next');
});

test('projection retains whitespace, reflows replacements and old message updates without duplicating later entries', () => {
	const entries: AssistantEntry[] = [' a\n\n🐉b', 'last'].map((text, index) => ({ kind: 'assistant', text: new PieceTreeBuffer(text), index, resetRevision: 0 }));
	const view = new AssistantTranscriptProjection(), font = {};
	view.update(entries, 3, measure, font);
	assert.deepEqual(view.rows.filter(row => !row.heading).map(row => row.text), [' a', '', '🐉b', 'las', 't']);
	entries[0].text.replace(0, entries[0].text.length, 'new'); entries[0].resetRevision++;
	view.invalidate(0); view.update(entries, 3, measure, font);
	assert.deepEqual(view.rows.filter(row => !row.heading).map(row => row.text), ['new', 'las', 't']);
	view.update(entries, 12, measure, font);
	assert.deepEqual(view.rows.filter(row => !row.heading).map(row => row.text), ['new', 'last']);
	view.invalidate(0); assert.equal(view.update([], 12, measure, font), true); assert.equal(view.rows.length, 0);
});
