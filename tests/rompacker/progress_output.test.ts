import assert from 'node:assert/strict';
import { test } from 'node:test';

import stringWidth from 'string-width';

import { renderTaskProgressLine } from '../../scripts/rompacker/progress';

test('task progress line stays inside the terminal line width', () => {
	const line = renderTaskProgressLine({
		completed: 3,
		total: 8,
		label: 'Texture atlases bouwen (indien nodig)',
		detail: 'Generate texture atlases',
		lineWidth: 79,
		failed: false,
	});

	assert.equal(stringWidth(line), 79);
	assert.match(line, /…/);
});

test('task progress line uses the full bar when there is no status room', () => {
	const line = renderTaskProgressLine({
		completed: 8,
		total: 8,
		label: 'Gereed',
		detail: '',
		lineWidth: 32,
		failed: false,
	});

	assert.ok(stringWidth(line) <= 32);
	assert.match(line, /8\/8/);
	assert.match(line, /100%/);
});
