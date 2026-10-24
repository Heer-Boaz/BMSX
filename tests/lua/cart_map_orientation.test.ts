import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import * as colors from '../../ide/common/constants';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { api } from '../../ide/runtime/overlay_api';
import { CartMapGrid } from '../../ide/workbench/contrib/cart_maps/grid';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { RectRenderKind, type RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';

function fixture(t: TestContext, theme: string, variant: 'tiny' | 'msx') {
	const previousTheme = colors.getActiveIdeThemeVariant(), previousFont = editorViewState.font, previousHeight = editorViewState.lineHeight;
	colors.setIdeThemeVariant(theme);
	const font = new EditorFont(variant), grid = new CartMapGrid(), overlay = createHostOverlayFixture(384, 288);
	editorViewState.font = font; editorViewState.lineHeight = font.lineHeight;
	grid.content = { width: 12, rows: Array.from({ length: 6 }, () => Array.from({ length: 12 }, () => ' ')),
		markers: [{ x: -3, y: -2, glyph: 'a' }, { x: 40, y: 30, glyph: 'b' }] };
	grid.layout(4, 20, variant === 'tiny' ? 78 : 118, 180);
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		grid.draw(false); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), rects: RectRenderSubmission[] = [];
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Rect)
			rects.push(frame.commandRefs[index] as RectRenderSubmission);
		return rects;
	};
	t.after(() => { colors.setIdeThemeVariant(previousTheme); editorViewState.font = previousFont; editorViewState.lineHeight = previousHeight; });
	return { grid, draw };
}

for (const theme of ['light', 'dark']) for (const variant of ['tiny', 'msx'] as const) {
	test(`${theme}/${variant} empty authored cells retain a world-anchored minor and major grid without a ruler gutter`, t => {
		const { grid, draw } = fixture(t, theme, variant), bounds = { ...grid.bounds }, minimum = grid.minimumWidth;
		grid.restoreView({ x: 5.5, y: 2.25 }); grid.layout(4, 20, variant === 'tiny' ? 78 : 118, 180);
		const rects = draw(), majorX = bounds.left + (8 - 5.5) * grid.cellSize, minorX = bounds.left + (6 - 5.5) * grid.cellSize;
		assert.ok(rects.some(rect => rect.kind === RectRenderKind.Fill && rect.color === resolveThemeTokenColor(colors.COLOR_CANVAS_GRID_MAJOR)
			&& rect.area.left === majorX && rect.area.right === majorX + 1), 'the existing grid surface must paint the world column 8 major line');
		assert.ok(rects.some(rect => rect.kind === RectRenderKind.Fill && rect.color === resolveThemeTokenColor(colors.COLOR_CANVAS_GRID_MINOR)
			&& rect.area.left === minorX && rect.area.right === minorX + 1), 'empty space cells must remain visibly spatial');
		assert.deepEqual(grid.bounds, bounds); assert.equal(grid.minimumWidth, minimum);
		assert.ok(grid.bounds.right - grid.bounds.left >= grid.cellSize * 8, 'orientation must not consume the eight-cell minimum');
		assert.deepEqual(grid.visibleRange, variant === 'tiny' ? { left: 5, top: 2, right: 15, bottom: 22 }
			: { left: 5, top: 2, right: 17, bottom: 18 });
	});

	test(`${theme}/${variant} the actual sheet boundary is independent of negative and out-of-sheet markers`, t => {
		const { grid, draw } = fixture(t, theme, variant);
		grid.restoreView({ x: -2, y: -1 }); grid.layout(4, 20, variant === 'tiny' ? 78 : 118, 180);
		const outlines: number[][] = [], original = api.blit_rect;
		t.mock.method(api, 'blit_rect', (...args) => { outlines.push(args); original.call(api, ...args); });
		draw();
		assert.ok(outlines.some(([left, top, right, bottom, , color]) => color === colors.COLOR_CANVAS_BOUNDARY
			&& left === grid.bounds.left + 2 * grid.cellSize && top === grid.bounds.top + grid.cellSize
			&& right === left + 12 * grid.cellSize && bottom === top + 6 * grid.cellSize),
			'the authored 12×6 sheet must not become the marker-expanded -3,-2..41,31 world');
		assert.deepEqual(grid.captureView(), { x: -2, y: -1 });
		assert.equal(grid.visibleRange.left, -2); assert.equal(grid.visibleRange.top, -1);
	});
}

test('visible world-cell ranges are retained and refresh from actual scrollbar movement without memento allocations', t => {
	const { grid } = fixture(t, 'light', 'tiny');
	const range = grid.visibleRange, capture = t.mock.method(grid, 'captureView');
	const measure = t.mock.method(editorViewState.font, 'advance');
	for (let frame = 0; frame < 1000; frame++) assert.equal(grid.visibleRange, range);
	assert.equal(capture.mock.callCount(), 0); assert.equal(measure.mock.callCount(), 0);
	grid.horizontal.setScroll(7.25 * grid.cellSize);
	assert.equal(grid.visibleRange, range); assert.equal(range.left, 7);
	grid.layout(0, 0, 0, 0);
	assert.deepEqual(grid.visibleRange, { left: 0, top: 0, right: 0, bottom: 0 });
});
