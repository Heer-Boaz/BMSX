import assert from 'node:assert/strict';
import test from 'node:test';
import { appendMeasuredTruncationMarker, ELLIPSIS, truncateMeasuredText, writeWrappedMeasuredText } from '../../ide/common/text';

const measure = (text: string, start: number, end: number) => Array.from(text.slice(start, end)).length;

test('cached natural widths preserve measured truncation without repeating a full-text measurement', () => {
	const value = 'namespace.😀.distinguishing_suffix', naturalWidth = measure(value, 0, value.length);
	for (const placement of ['end', 'middle'] as const) for (let width = 0; width <= naturalWidth + 2; width++) {
		let fullMeasurements = 0;
		const measured = (text: string, start: number, end: number) => {
			if (text === value && start === 0 && end === value.length) fullMeasurements++;
			return measure(text, start, end);
		};
		assert.equal(truncateMeasuredText(value, width, measured, ELLIPSIS, placement, naturalWidth),
			truncateMeasuredText(value, width, measure, ELLIPSIS, placement));
		assert.equal(fullMeasurements, 0);
	}
});

test('complete cached previews and empty cell budgets require no text measurement', () => {
	const measured = () => { assert.fail('the retained owner already measured this complete preview'); };
	assert.equal(truncateMeasuredText('Payload', 7, measured, ELLIPSIS, 'end', 7), 'Payload');
	assert.equal(truncateMeasuredText('', 10, measured, ELLIPSIS, 'end', 0), '');
	assert.equal(truncateMeasuredText('Payload', 0, measured, ELLIPSIS, 'end', 7), '');
});

test('shared labels and wrapped previews use one measured ellipsis glyph', () => {
	assert.equal(ELLIPSIS.length, 1);
	assert.equal(truncateMeasuredText('abcdef', 4, measure), 'abc…');
	assert.equal(truncateMeasuredText('abcdef', 1, measure), '…');
	assert.equal(appendMeasuredTruncationMarker('abcdef', 4, measure), 'abc…');
	const lines: string[] = [];
	assert.equal(writeWrappedMeasuredText(lines, 'one two three', 4, 4, 1, measure), true);
	assert.deepEqual(lines, ['one…']);
});

test('middle truncation fits measured width and preserves both identifying ends', () => {
	const value = 'namespace.component.distinguishing_suffix';
	for (let width = 0; width < value.length + 5; width++) {
		const truncated = truncateMeasuredText(value, width, measure, '...', 'middle');
		assert.ok(measure(truncated, 0, truncated.length) <= width);
		if (width >= value.length) assert.equal(truncated, value);
		else if (width >= 5) {
			assert.equal(truncated[0], value[0]);
			assert.equal(truncated.at(-1), value.at(-1));
		}
	}
});

test('middle truncation does not split surrogate pairs at either retained boundary', () => {
	const value = '😀😀😀name😀😀😀';
	for (let width = 3; width < 11; width++) {
		const truncated = truncateMeasuredText(value, width, measure, '...', 'middle');
		assert.equal(truncated.isWellFormed(), true);
		assert.ok(measure(truncated, 0, truncated.length) <= width);
	}
});

test('wrapped text reports clipping from actual consumed ranges, not the last glyph', () => {
	const lines: string[] = [];
	assert.equal(writeWrappedMeasuredText(lines, 'authored…', 20, 20, 1, measure), false);
	assert.deepEqual(lines, ['authored…']);
	assert.equal(writeWrappedMeasuredText(lines, '', 20, 20, 1, measure), false);
	assert.equal(writeWrappedMeasuredText(lines, 'unpainted', 20, 20, 0, measure), true);
	assert.equal(writeWrappedMeasuredText(lines, 'one two', 4, 4, 2, measure), false);
	assert.deepEqual(lines, ['one', 'two']);
});

test('bounded text lays out mandatory line breaks before word wrapping and counts every visual row', () => {
	const lines: string[] = [];
	assert.equal(writeWrappedMeasuredText(lines, 'summary\nsource\n  ^', 20, 20, 3, measure), false);
	assert.deepEqual(lines, ['summary', 'source', '  ^']);
	assert.equal(writeWrappedMeasuredText(lines, 'one two\nthree four\nfive', 4, 6, 3, measure), true);
	assert.deepEqual(lines, ['one', 'two', 'three…']);
	assert.ok(lines.every(line => !line.includes('\n')));
	assert.equal(writeWrappedMeasuredText(lines, '\n\nlast', 20, 20, 3, measure), false);
	assert.deepEqual(lines, ['', '', 'last']);
	assert.equal(writeWrappedMeasuredText(lines, 'last\n', 20, 20, 2, measure), false);
	assert.deepEqual(lines, ['last', '']);
	assert.equal(writeWrappedMeasuredText(lines, 'last\n', 20, 20, 1, measure), true);
	assert.deepEqual(lines, ['last…']);
});

test('hard lines share the same bounded budget without splitting surrogate pairs', () => {
	const lines: string[] = [];
	assert.equal(writeWrappedMeasuredText(lines, '😀😀\n😀😀😀\nlast', 1, 2, 3, measure), true);
	assert.deepEqual(lines, ['😀', '😀', '😀…']);
	assert.ok(lines.every(line => line.isWellFormed()));
	assert.equal(writeWrappedMeasuredText(lines, '\n   \n', 20, 20, 3, measure), false);
	assert.deepEqual(lines, ['', '', '']);
});
