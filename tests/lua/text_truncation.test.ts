import assert from 'node:assert/strict';
import test from 'node:test';
import { appendMeasuredTruncationMarker, ELLIPSIS, truncateMeasuredText, writeWrappedMeasuredText } from '../../ide/common/text';

const measure = (text: string, start: number, end: number) => Array.from(text.slice(start, end)).length;

test('shared labels and wrapped previews use one measured ellipsis glyph', () => {
	assert.equal(ELLIPSIS.length, 1);
	assert.equal(truncateMeasuredText('abcdef', 4, measure), 'abc…');
	assert.equal(truncateMeasuredText('abcdef', 1, measure), '…');
	assert.equal(appendMeasuredTruncationMarker('abcdef', 4, measure), 'abc…');
	const lines: string[] = [];
	writeWrappedMeasuredText(lines, 'one two three', 4, 4, 1, measure);
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
