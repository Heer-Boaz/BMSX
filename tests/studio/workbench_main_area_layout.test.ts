import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkbenchMainAreaLayout, WORKBENCH_MAIN_AREA_GAP } from '../../ide/workbench/common/main_area_layout';
import { WorkbenchSplitView } from '../../ide/workbench/ui/split_view';

// Rectangles and equality thresholds are this parent-allocation algorithm's contract,
// not incidental placement assertions in an editor workflow.

test('Main companion exact width and height fit includes one gap at the already reserved origin', () => {
	const layout = new WorkbenchMainAreaLayout(), available = { left: 37, top: 19, right: 389, bottom: 139 };
	layout.enabled = true; layout.prepare(available, 168, 120);
	assert.equal(layout.layout(180), true); assert.equal(layout.visible, true);
	assert.equal(WORKBENCH_MAIN_AREA_GAP, 4);
	assert.deepEqual(layout.primaryBounds, { left: 37, top: 19, right: 217, bottom: 139 });
	assert.deepEqual(layout.companionBounds, { left: 221, top: 19, right: 389, bottom: 139 });
	assert.equal(layout.split.minimumFirstSize, 182); assert.equal(layout.split.minimumSecondSize, 170);
	assert.equal(layout.split.resizable, false); assert.equal(layout.split.ratio, 0.58);
	assert.equal(layout.layout(180), false);
});

for (const reason of ['closed', 'optout', 'width', 'height'] as const) test(`Main ${reason} withholds only companion presentation and restores the same requested preference`, () => {
	const layout = new WorkbenchMainAreaLayout(), available = { left: 37, top: 19, right: 737, bottom: 219 };
	layout.enabled = true; layout.prepare(available, 168, 120); layout.split.ratio = 0.75; layout.layout(180);
	const preferred = { ...layout.primaryBounds }, splitBounds = { ...layout.split.bounds }, revision = layout.split.revision;
	if (reason === 'closed') layout.enabled = false;
	if (reason === 'width') available.right = available.left + 180 + 4 + 168 - 1;
	if (reason === 'height') available.bottom = available.top + 120 - 1;
	layout.prepare(available, 168, 120);
	assert.equal(layout.layout(reason === 'optout' ? undefined : 180), true); assert.equal(layout.visible, false);
	assert.deepEqual(layout.primaryBounds, available);
	assert.deepEqual(layout.companionBounds, { left: 0, top: 0, right: 0, bottom: 0 });
	assert.equal(layout.enabled, reason !== 'closed'); assert.equal(layout.split.ratio, 0.75); assert.equal(layout.split.revision, revision);
	assert.deepEqual(layout.split.bounds, splitBounds, 'withholding an unbound sash does not rewrite its retained placement');
	assert.equal(layout.layout(reason === 'optout' ? undefined : 180), false);
	layout.enabled = true; available.right = 737; available.bottom = 219; layout.prepare(available, 168, 120);
	assert.equal(layout.layout(180), true); assert.equal(layout.visible, true); assert.deepEqual(layout.primaryBounds, preferred);
});

for (const [ratio, primaryWidth] of [[-3, 180], [0, 180], [0.5, 348], [0.58, 404], [3, 528]])
	test(`Main retained ratio ${ratio} clamps its physical children without normalizing intent`, () => {
		const layout = new WorkbenchMainAreaLayout(); layout.enabled = true;
		layout.prepare({ left: 91, top: 17, right: 791, bottom: 217 }, 168, 120); layout.split.ratio = ratio;
		const revision = layout.split.revision; layout.layout(180);
		assert.equal(layout.primaryBounds.right - layout.primaryBounds.left, primaryWidth);
		assert.equal(layout.companionBounds.left - layout.primaryBounds.right, 4);
		assert.ok(layout.companionBounds.right - layout.companionBounds.left >= 168);
		assert.equal(layout.split.ratio, ratio); assert.equal(layout.split.revision, revision);
	});

test('Main changed primary requirements can withhold and restore the companion without changing saved geometry intent', () => {
	const layout = new WorkbenchMainAreaLayout(); layout.enabled = true;
	layout.prepare({ left: 23, top: 17, right: 723, bottom: 217 }, 168, 120); layout.split.ratio = 0.75;
	layout.layout(180); const preferred = { ...layout.primaryBounds };
	assert.equal(layout.layout(600), true); assert.equal(layout.visible, false); assert.equal(layout.enabled, true);
	assert.equal(layout.layout(180), true); assert.equal(layout.visible, true); assert.deepEqual(layout.primaryBounds, preferred);
	layout.prepare({ left: 23, top: 17, right: 1023, bottom: 217 }, 168, 120); layout.layout(180);
	assert.equal(layout.primaryBounds.right, 771); assert.equal(layout.split.ratio, 0.75);
});

test('Main explicit parent layout bounds replace the prepared area and own subsequent pure projections', () => {
	const layout = new WorkbenchMainAreaLayout(); layout.enabled = true;
	layout.prepare({ left: 0, top: 0, right: 700, bottom: 200 }, 168, 120); layout.layout(180);
	const available = layout.availableBounds, supplied = { left: 37, top: 19, right: 389, bottom: 139 };
	assert.equal(layout.layout(180, supplied), true); assert.ok(layout.availableBounds === available);
	assert.deepEqual(available, supplied); assert.equal(layout.visible, true);
	assert.deepEqual(layout.primaryBounds, { left: 37, top: 19, right: 217, bottom: 139 });
	assert.deepEqual(layout.companionBounds, { left: 221, top: 19, right: 389, bottom: 139 });
	const target = { left: 0, top: 0, right: 0, bottom: 0 };
	assert.equal(layout.writePrimaryBounds(181, target), false); assert.deepEqual(target, supplied);
	assert.equal(layout.writePrimaryBounds(180, target), true); assert.deepEqual(target, layout.primaryBounds);
	assert.equal(layout.layout(180, supplied), false);
});

test('Main pure projection reuses the allocator without publishing candidate visibility, minima or rectangles', () => {
	const layout = new WorkbenchMainAreaLayout(); layout.enabled = true;
	layout.prepare({ left: 23, top: 17, right: 723, bottom: 217 }, 168, 120); layout.layout(180);
	const primary = layout.primaryBounds, companion = layout.companionBounds, available = layout.availableBounds, split = layout.split;
	const before = { primary: { ...primary }, companion: { ...companion }, available: { ...available }, splitBounds: { ...split.bounds },
		first: split.minimumFirstSize, second: split.minimumSecondSize, ratio: split.ratio, revision: split.revision, visible: layout.visible, enabled: layout.enabled };
	const target = { left: 0, top: 0, right: 0, bottom: 0 };
	for (let frame = 0; frame < 1000; frame++) {
		assert.equal(layout.writePrimaryBounds(500, target), true);
		assert.deepEqual(target, { left: 23, top: 17, right: 523, bottom: 217 });
		assert.equal(layout.writePrimaryBounds(600, target), false); assert.deepEqual(target, available);
		assert.equal(layout.writePrimaryBounds(undefined, target), false); assert.deepEqual(target, available);
	}
	assert.ok(layout.primaryBounds === primary && layout.companionBounds === companion && layout.availableBounds === available && layout.split === split);
	assert.deepEqual({ primary, companion, available, splitBounds: split.bounds, first: split.minimumFirstSize, second: split.minimumSecondSize,
		ratio: split.ratio, revision: split.revision, visible: layout.visible, enabled: layout.enabled }, before);
	assert.equal(layout.layout(180), false);
	assert.equal(layout.layout(500), true); assert.deepEqual(layout.primaryBounds, { left: 23, top: 17, right: 523, bottom: 217 });
	assert.equal(layout.layout(501), true); assert.equal(layout.layout(181), true); assert.equal(layout.layout(180), false);
});

for (const orientation of ['horizontal', 'vertical'] as const) test(`${orientation} split positionFor projects another interval without changing the actual split`, () => {
	const split = new WorkbenchSplitView(0.58, orientation); split.layout(19, 23, 719, 523);
	split.minimumFirstSize = 80; split.minimumSecondSize = 90; split.ratio = 0.75;
	const bounds = { ...split.bounds }, revision = split.revision, actual = split.position;
	assert.equal(split.positionFor(37, 389, 182, 170), 219);
	assert.deepEqual(split.bounds, bounds); assert.equal(split.revision, revision); assert.equal(split.position, actual);
	assert.equal(split.minimumFirstSize, 80); assert.equal(split.minimumSecondSize, 90); assert.equal(split.ratio, 0.75);
});
