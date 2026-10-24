import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { CartMapGrid, type MapGridContent } from '../../ide/workbench/contrib/cart_maps/grid';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';

function fixture(t: TestContext) {
	const oldFont = editorViewState.font, oldHeight = editorViewState.lineHeight;
	const grid = new CartMapGrid();
	const font = (variant: 'tiny' | 'msx') => {
		editorViewState.font = new EditorFont(variant); editorViewState.lineHeight = editorViewState.font.lineHeight;
	};
	font('tiny');
	const content: MapGridContent = { width: 100, rows: Array.from({ length: 100 }, () => []), markers: [] };
	grid.content = content;
	t.after(() => { editorViewState.font = oldFont; editorViewState.lineHeight = oldHeight; });
	return { grid, font, content };
}

test('grid font changes preserve the first world cell and its fraction in both directions', t => {
	const { grid, font } = fixture(t); grid.layout(0, 0, 80, 80);
	grid.restoreView({ x: 17.5, y: 23.25 }); grid.layout(0, 0, 80, 80);
	for (const variant of ['msx', 'tiny', 'msx', 'tiny'] as const) {
		font(variant); grid.layout(0, 0, 80, 80);
		assert.deepEqual(grid.captureView(), { x: 17.5, y: 23.25 });
		assert.equal(grid.horizontal.getScroll(), grid.cellSize * 17.5);
		assert.equal(grid.vertical.getScroll(), grid.cellSize * 23.25);
	}
});

test('hidden arrangements retire physical tracks without consuming a pending logical bookmark', t => {
	const { grid, font } = fixture(t); grid.restoreView({ x: 19.75, y: 31.5 });
	grid.layout(0, 0, 0, 0); font('msx'); grid.layout(20, 30, 20, 30);
	assert.equal(grid.cellSize, 0, 'unmeasured hidden geometry does not measure an irrelevant font');
	assert.equal(grid.horizontal.isVisible(), false); assert.equal(grid.vertical.isVisible(), false);
	assert.deepEqual(grid.captureView(), { x: 19.75, y: 31.5 });
	grid.layout(20, 30, 138, 150);
	assert.deepEqual(grid.captureView(), { x: 19.75, y: 31.5 });
	assert.equal(grid.horizontal.getTrack().top, grid.bounds.bottom);
	assert.equal(grid.vertical.getTrack().left, grid.bounds.right);
});

test('hidden previously arranged grids retain logical coordinates through repeated zero layouts and font changes', t => {
	const { grid, font } = fixture(t); grid.layout(0, 0, 78, 120); grid.scrollBy(12.5, 9.25);
	grid.layout(0, 0, 0, 0); font('msx');
	for (let frame = 0; frame < 1000; frame++) grid.layout(0, 0, 0, 0);
	assert.deepEqual(grid.captureView(), { x: 12.5, y: 9.25 });
	grid.layout(0, 0, 118, 120); assert.deepEqual(grid.captureView(), { x: 12.5, y: 9.25 });
});

test('visible resize accepts the actual scrollbar clamp rather than resurrecting an old offscreen wish', t => {
	const { grid } = fixture(t); grid.layout(0, 0, 78, 120); grid.scrollBy(90, 80);
	grid.layout(0, 0, 2000, 2000); assert.deepEqual(grid.captureView(), { x: 0, y: 0 });
	grid.layout(0, 0, 78, 120); assert.deepEqual(grid.captureView(), { x: 0, y: 0 });
});

test('negative content origins and extent replacement preserve actual world cells, not offsets from the new minimum', t => {
	const { grid, font, content } = fixture(t);
	grid.content = { ...content, markers: [{ x: -40, y: -30, glyph: 'a' }] };
	grid.restoreView({ x: -17.5, y: -12.25 }); grid.layout(0, 0, 78, 120);
	assert.equal(grid.columnAt(grid.bounds.left), -18); assert.equal(grid.rowAt(grid.bounds.top), -13);
	font('msx'); grid.content = { ...content, markers: [{ x: -60, y: -50, glyph: 'b' }] };
	grid.layout(0, 0, 118, 120); assert.deepEqual(grid.captureView(), { x: -17.5, y: -12.25 });
	grid.content = content; grid.layout(0, 0, 118, 120); assert.deepEqual(grid.captureView(), { x: 0, y: 0 });
});

test('only the first visible layout consumes restored cell coordinates and later direct scrollbar motion becomes current view', t => {
	const { grid } = fixture(t); grid.restoreView({ x: 10.5, y: 20.5 }); grid.layout(0, 0, 78, 120);
	grid.horizontal.setScroll(3.25 * grid.cellSize); grid.vertical.setScroll(4.5 * grid.cellSize);
	grid.layout(0, 0, 78, 120); assert.deepEqual(grid.captureView(), { x: 3.25, y: 4.5 });
});

test('hidden marker reveals are deferred until visible and latest actual reveal wins', t => {
	const { grid } = fixture(t); grid.layout(0, 0, 0, 0);
	grid.reveal({ x: 80, y: 80 }); grid.reveal({ x: 20, y: 30 });
	assert.deepEqual(grid.captureView(), { x: 0, y: 0, reveal: { x: 20, y: 30 } }); grid.layout(0, 0, 78, 120);
	const x = grid.horizontal.getScroll(), y = grid.vertical.getScroll();
	assert.ok(x <= 20 * grid.cellSize && x + grid.bounds.right - grid.bounds.left >= 21 * grid.cellSize);
	assert.ok(y <= 30 * grid.cellSize && y + grid.bounds.bottom - grid.bounds.top >= 31 * grid.cellSize);
	assert.ok(x < 40 * grid.cellSize && y < 40 * grid.cellSize);
});

test('content replacement retires a deferred old-subject reveal', t => {
	const { grid, content } = fixture(t); grid.restoreView({ x: 5.5, y: 6.25 }); grid.reveal({ x: 80, y: 80 });
	grid.content = { ...content }; grid.layout(0, 0, 78, 120);
	assert.deepEqual(grid.captureView(), { x: 5.5, y: 6.25 });
});

test('warm geometry does not remeasure fonts, recreate tracks or discard fractional scroll', t => {
	const { grid } = fixture(t); grid.layout(4, 8, 122, 180); grid.restoreView({ x: 10.125, y: 20.375 }); grid.layout(4, 8, 122, 180);
	const measure = t.mock.method(editorViewState.font, 'advance'), xTrack = grid.horizontal.getTrack(), yTrack = grid.vertical.getTrack();
	const horizontalRevision = grid.horizontal.revision, verticalRevision = grid.vertical.revision;
	for (let frame = 0; frame < 1000; frame++) grid.layout(4, 8, 122, 180);
	assert.equal(measure.mock.callCount(), 0); assert.equal(grid.horizontal.getTrack(), xTrack); assert.equal(grid.vertical.getTrack(), yTrack);
	assert.equal(grid.horizontal.revision, horizontalRevision); assert.equal(grid.vertical.revision, verticalRevision);
	assert.deepEqual(grid.captureView(), { x: 10.125, y: 20.375 });
	assert.equal(grid.bounds.right, 122 - SCROLLBAR_WIDTH); assert.equal(grid.bounds.bottom, 180 - SCROLLBAR_WIDTH);
});


test('minimum width measures the new font without reinterpreting the old projected pixel origin', t => {
	const { grid, font } = fixture(t);
	const firstMinimum = grid.minimumWidth;
	assert.equal(grid.cellSize, 0, 'a measurement is not a visible arrangement');
	grid.restoreView({ x: 17.5, y: 23.25 }); grid.layout(0, 0, 78, 120);
	const oldSize = grid.cellSize, oldScroll = grid.horizontal.getScroll();
	font('msx'); const nextMinimum = grid.minimumWidth;
	assert.notEqual(nextMinimum, firstMinimum); assert.equal(grid.cellSize, oldSize); assert.equal(grid.horizontal.getScroll(), oldScroll);
	grid.layout(0, 0, 118, 120);
	assert.deepEqual(grid.captureView(), { x: 17.5, y: 23.25 });
	assert.equal(nextMinimum, grid.cellSize * 8 + SCROLLBAR_WIDTH);
	const advance = t.mock.method(editorViewState.font, 'advance');
	for (let frame = 0; frame < 1000; frame++) assert.equal(grid.minimumWidth, nextMinimum);
	assert.equal(advance.mock.callCount(), 0);
});


test('a hidden deferred reveal survives memento capture and restoration before first visible layout', t => {
	const { grid, content } = fixture(t); grid.restoreView({ x: 5.5, y: 6.25 }); grid.layout(0, 0, 0, 0);
	const selected = { x: 30, y: 40 }; grid.reveal(selected);
	const snapshot = grid.captureView();
	assert.deepEqual(snapshot, { x: 5.5, y: 6.25, reveal: { x: 30, y: 40 } });
	assert.notEqual(snapshot.reveal, selected, 'memento owns the pending world coordinates, not a source-generation object');
	const other = new CartMapGrid(); other.content = content; other.restoreView(snapshot); other.layout(0, 0, 0, 0);
	assert.deepEqual(other.captureView(), snapshot);
	grid.layout(0, 0, 78, 120); other.layout(0, 0, 78, 120);
	assert.deepEqual(other.captureView(), grid.captureView());
	assert.equal('reveal' in other.captureView(), false, 'the admitted reveal is consumed exactly once');
});

test('a newer explicit pan retires a deferred reveal instead of replaying it after restore', t => {
	const { grid } = fixture(t); grid.restoreView({ x: 5.5, y: 6.25 }); grid.layout(0, 0, 0, 0);
	grid.reveal({ x: 80, y: 80 }); grid.scrollBy(2.25, -1.5);
	const snapshot = grid.captureView(); assert.deepEqual(snapshot, { x: 7.75, y: 4.75 });
	grid.layout(0, 0, 78, 120); assert.deepEqual(grid.captureView(), snapshot);
});
