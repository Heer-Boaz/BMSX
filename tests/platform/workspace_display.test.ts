import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceDisplay } from '../../hosts/common/workspace_display';
import { workbenchPixelsPerUnit } from '../../ide/workbench/common/display_scale';

test('host workspace publishes available area, not game dimensions or UI policy, and retires its recipient', () => {
	let layouts = 0;
	const display = new WorkspaceDisplay(0, 0, 1, () => layouts++), sizes: number[][] = [];
	display.layout(1920, 1080, 1);
	assert.equal(display.active, false);
	display.open(({ width, height, pixelWidth, pixelHeight }) => sizes.push([width, height, pixelWidth, pixelHeight]));
	assert.deepEqual(sizes, [[1920, 1080, 1920, 1080]], 'the workbench receives actual host allocation');
	display.layout(1920, 1080, 1);
	assert.equal(sizes.length, 1, 'unchanged host area does not publish another resize');
	display.layout(1920, 1080, 1.25);
	assert.deepEqual(sizes.at(-1), [1920, 1080, 2400, 1350], 'monitor density alone reallocates pixels, not UI space');
	display.layout(2560, 1440, 1);
	assert.deepEqual(sizes.at(-1), [2560, 1440, 2560, 1440]);
	display.close();
	const retiredCount = sizes.length;
	display.layout(390, 844, 3); display.refresh();
	assert.equal(sizes.length, retiredCount, 'the closed editor cannot receive host layout');
	const compact: number[][] = [];
	display.open(({ width, height, pixelWidth, pixelHeight }) => compact.push([width, height, pixelWidth, pixelHeight]));
	assert.deepEqual(compact, [[390, 844, 1170, 2532]]);
	assert.ok(layouts > 0);
});

test('Studio scale preserves compact width and grows desktop space without deriving font density from window height', () => {
	// Exact sizes are the allocation algorithm contract, not UI snapshot assertions.
	assert.equal(workbenchPixelsPerUnit(1920), 3);
	assert.equal(1920 / workbenchPixelsPerUnit(1920), 640);
	assert.equal(390 / workbenchPixelsPerUnit(390), 384);
	// The height is deliberately not an input: a keyboard/short window removes
	// rows instead of shrinking every font and hit target.
	const scale = workbenchPixelsPerUnit(390);
	assert.ok(844 / scale > 288);
	assert.ok(200 / scale < 288);
});
