import assert from 'node:assert/strict';
import test from 'node:test';
import { AssistantTranscriptProjection } from '../../ide/workbench/contrib/assistant/projection';
import type { AssistantEntry } from '../../ide/workbench/services/assistant/transcript';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { TextStyle } from '../../ide/common/markdown/model';

const measure = (_text: string, start: number, end: number) => end - start;

test('large history measures only exposed messages and retains the reading anchor on prepend and resize', () => {
	const entries: AssistantEntry[] = Array.from({ length: 5000 }, (_, index) => ({ kind: 'assistant', index, resetRevision: 0,
		text: new PieceTreeBuffer('A **complete** paragraph with ordinary words.\n\n'.repeat(12)) }));
	const reads = new Set<number>();
	for (const entry of entries) {
		const read = entry.text.getTextRange.bind(entry.text);
		entry.text.getTextRange = (from, to) => { reads.add(entry.index); return read(from, to); };
	}
	const view = new AssistantTranscriptProjection(), font = {};
	view.update(entries, 80, measure, font); let top = view.layout(0, 30, true);
	assert.ok(reads.size < 10); assert.ok(view.rows.length <= 91);
	top = view.layout(view.entryTop(2500), 30);
	const anchor = entries[view.rowAt(Math.trunc(top))!.entry];
	const before = reads.size;
	view.update(entries, 40, measure, font); top = view.layout(top, 30);
	assert.equal(entries[view.rowAt(Math.trunc(top))!.entry], anchor); assert.ok(reads.size - before < 10);
	entries.unshift({ kind: 'user', index: 0, resetRevision: 0, text: new PieceTreeBuffer('Earlier page') });
	entries.forEach((entry, index) => { entry.index = index; });
	view.update(entries, 40, measure, font); top = view.layout(top, 30);
	assert.equal(entries[view.rowAt(Math.trunc(top))!.entry], anchor);
	for (const requested of [0, view.entryTop(1200), view.entryTop(3000), view.rowCount - 30, 0]) {
		top = view.layout(requested, 30);
		for (let row = Math.trunc(top); row < Math.min(top + 30, view.rowCount); row++) assert.ok(view.rowAt(row));
	}
	assert.equal(view.rowAt(0)!.entry, 0);
	assert.equal(entries.length, 5001, 'virtualization does not discard authored history');
});

test('user and assistant messages share Markdown layout without changing source; status stays literal', () => {
	const source = '**strong** *emphasis* &amp; `value`\n\n```lua\n  return value\n```';
	const entries: AssistantEntry[] = (['user', 'status', 'assistant'] as const).map((kind, index) =>
		({ kind, index, resetRevision: 0, text: new PieceTreeBuffer(source) }));
	const view = new AssistantTranscriptProjection(); view.update(entries, 80, measure, {}); view.layout(0, 60);
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
		buffer.insert(buffer.length, 'word '); view.invalidate(0); view.update([entry], 40, metrics, font); view.layout(view.rowCount, 30, true);
	}
	assert.ok(read < 450000, `only a row tail per delta, read=${read}`);
	const rows = view.rows.slice(), before = { read, measured };
	for (let index = 0; index < 1000; index++) assert.equal(view.update([entry], 40, metrics, font), false);
	assert.deepEqual({ read, measured }, before); assert.ok(view.rows.every((row, index) => row === rows[index]));
	buffer.insert(buffer.length, '\n🐉 next'); view.invalidate(0); view.update([entry], 40, metrics, font); view.layout(view.rowCount, 30, true);
	assert.equal(view.rows.at(-1)!.text, '🐉 next');
});

test('projection retains whitespace, reflows replacements and old message updates without duplicating later entries', () => {
	const entries: AssistantEntry[] = [' a\n\n🐉b', 'last'].map((text, index) => ({ kind: 'assistant', text: new PieceTreeBuffer(text), index, resetRevision: 0 }));
	const view = new AssistantTranscriptProjection(), font = {};
	view.update(entries, 3, measure, font); view.layout(0, 30);
	assert.deepEqual(view.rows.filter(row => !row.heading).map(row => row.text), [' a', '', '🐉b', 'las', 't']);
	entries[0].text.replace(0, entries[0].text.length, 'new'); entries[0].resetRevision++;
	view.invalidate(0); view.update(entries, 3, measure, font); view.layout(0, 30);
	assert.deepEqual(view.rows.filter(row => !row.heading).map(row => row.text), ['new', 'las', 't']);
	view.update(entries, 12, measure, font); view.layout(0, 30);
	assert.deepEqual(view.rows.filter(row => !row.heading).map(row => row.text), ['new', 'last']);
	view.reset(); view.update([], 12, measure, font); view.layout(0, 30); assert.equal(view.rows.length, 0);
});
