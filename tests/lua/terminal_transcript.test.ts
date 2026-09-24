import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminalTranscript } from '../../ide/workbench/services/terminal/transcript';
import { TerminalProjection } from '../../ide/workbench/contrib/terminal/projection';

test('terminal scrollback evicts by sequence and clear never reuses entry identities', () => {
	const transcript = new TerminalTranscript(3);
	for (let index = 0; index < 7; index++) transcript.append('output', `${index}`);
	assert.equal(transcript.start, 4);
	assert.equal(transcript.next, 7);
	assert.deepEqual([4, 5, 6].map(id => transcript.entry(id).text), ['4', '5', '6']);
	transcript.clear();
	assert.equal(transcript.start, 7);
	transcript.append('input', 'return 42');
	assert.deepEqual(transcript.entry(7), { id: 7, kind: 'input', text: 'return 42' });
});

test('terminal projection measures only appends, reflows on layout change and drops cleared rows', () => {
	const transcript = new TerminalTranscript(3), projection = new TerminalProjection(), font = {};
	let measured = 0;
	const measure = (_text: string, start: number, end: number) => { measured++; return end - start; };
	transcript.append('input', 'value = 21\nreturn value * 2');
	projection.update(transcript, 80, font, measure);
	assert.deepEqual(projection.rows.map(row => row.text), ['> value = 21', '. return value * 2']);
	const before = measured;
	projection.update(transcript, 80, font, measure);
	assert.equal(measured, before, 'unchanged output has no measurement work');
	transcript.append('result', '42');
	projection.update(transcript, 80, font, measure);
	const resultMeasures = measured - before;
	transcript.append('output', '42');
	projection.update(transcript, 80, font, measure);
	assert.equal(measured - before, resultMeasures * 2, 'earlier input is not remeasured');
	transcript.append('error', 'bad input');
	projection.update(transcript, 80, font, measure);
	assert.deepEqual(projection.rows.map(row => row.entry), [1, 2, 3]);
	transcript.clear();
	projection.update(transcript, 80, font, measure);
	assert.equal(projection.rows.length, 0);
	transcript.append('output', 'abcdefgh');
	projection.update(transcript, 4, font, measure);
	assert.deepEqual(projection.rows.map(row => row.text), ['abcd', 'efgh']);
});
