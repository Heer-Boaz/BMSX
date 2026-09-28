import assert from 'node:assert/strict';
import test from 'node:test';
import { AssistantTranscriptProjection } from '../../ide/workbench/contrib/assistant/projection';
import type { AssistantEntry } from '../../ide/workbench/services/assistant/conversation';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { TextStyle } from '../../ide/common/markdown/model';

const measure = (_text: string, start: number, end: number) => end - start;

test('user and assistant messages share Markdown layout without changing source; status stays literal', () => {
	const source = '**strong** *emphasis* &amp; `value`\n\n```lua\n  return value\n```';
	const entries: AssistantEntry[] = (['user', 'status', 'assistant'] as const).map((kind, index) =>
		({ kind, index, resetRevision: 0, text: new PieceTreeBuffer(source) }));
	const view = new AssistantTranscriptProjection(); view.update(entries, 80, measure, {});
	const user = view.rows.filter(row => row.entry === 0 && !row.heading);
	const status = view.rows.filter(row => row.entry === 1 && !row.heading);
	const assistant = view.rows.filter(row => row.entry === 2 && !row.heading);
	assert.deepEqual(user.map(row => row.runs), assistant.map(row => row.runs));
	for (const style of [TextStyle.Bold, TextStyle.Italic, TextStyle.Code]) assert.ok(user.some(row => row.runs.some(run => (run.style & style) !== 0)));
	assert.ok(user.some(row => row.code));
	assert.equal(status.map(row => row.text).join('\n'), source);
	assert.ok(status.every(row => row.runs.every(run => run.style === TextStyle.Plain)));
	assert.ok(entries.every(entry => entry.text.getText() === source));
});

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
