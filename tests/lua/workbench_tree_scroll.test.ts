import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { ScrollableWorkbenchTree } from '../../ide/workbench/ui/scrollable_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, setWorkbenchTreeCollapsed, workbenchTreeTwistieContainsPosition } from '../../ide/workbench/ui/tree_view';
import { workbenchListRowIndexAtPosition } from '../../ide/workbench/ui/list_view';

test('tree overflow resolves both axes together and returns both gutters when contents fit', () => {
	const tree = new ScrollableWorkbenchTree<number>(), metrics = {};
	for (let i = 0; i < 5; i++) appendWorkbenchTreeNode(tree, null, 121);
	rebuildWorkbenchTreeRows(tree, null);
	tree.measureContentWidth(row => row.element, metrics);
	// Five ten-pixel rows fit until horizontal overflow consumes the bottom gutter.
	tree.updateLayout(0, 0, 120, 50, 10, 10);
	assert.equal(tree.horizontalScrollbar.isVisible(), true); assert.equal(tree.scrollbar.isVisible(), true);
	assert.equal(tree.layout.visibleRowCount, 4);
	assert.ok(tree.layout.contentRight < 120);
	tree.horizontalScrollbar.setScroll(100); tree.scroll = 100;
	tree.updateLayout(0, 0, 200, 100, 10, 10);
	assert.equal(tree.horizontalScrollbar.isVisible(), false); assert.equal(tree.scrollbar.isVisible(), false);
	assert.equal(tree.scrollLeft, 0); assert.equal(tree.scroll, 0);
	assert.equal(tree.layout.contentRight, 200); assert.equal(tree.layout.contentBottom, 100);
});

test('tree width measurement is retained across resizing and scrolling, invalidated by rows and font metrics', () => {
	const tree = new ScrollableWorkbenchTree<number>(), metrics = {};
	const parent = appendWorkbenchTreeNode(tree, null, 10);
	appendWorkbenchTreeNode(tree, parent, 240);
	rebuildWorkbenchTreeRows(tree, null);
	let measures = 0;
	const measure = (row: typeof parent) => { measures++; return row.element; };
	tree.measureContentWidth(measure, metrics);
	for (let i = 0; i < 100; i++) {
		tree.measureContentWidth(measure, metrics);
		tree.updateLayout(0, 0, 100 + i, 100, 10, 10);
		tree.horizontalScrollbar.setScroll(i);
	}
	assert.equal(measures, 2, 'camera, hover, scroll and resize need no row census');
	tree.measureContentWidth(measure, {}); assert.equal(measures, 4);
	setWorkbenchTreeCollapsed(tree, 0, true);
	tree.measureContentWidth(measure, metrics);
	tree.updateLayout(0, 0, 100, 100, 10, 10);
	assert.equal(measures, 5); assert.equal(tree.horizontalScrollbar.isVisible(), false); assert.equal(tree.scrollLeft, 0);
	setWorkbenchTreeCollapsed(tree, 0, false);
	tree.measureContentWidth(measure, metrics);
	tree.updateLayout(0, 0, 100, 100, 10, 10);
	assert.equal(tree.horizontalScrollbar.isVisible(), true);
});

test('horizontal wheel and scrolled disclosure use the same content origin without changing selection', () => {
	const tree = new ScrollableWorkbenchTree<number>();
	let branch = appendWorkbenchTreeNode(tree, null, 250);
	for (let depth = 0; depth < 5; depth++) branch = appendWorkbenchTreeNode(tree, branch, 250);
	appendWorkbenchTreeNode(tree, branch, 250);
	rebuildWorkbenchTreeRows(tree, branch);
	tree.measureContentWidth(row => row.element, {});
	tree.updateLayout(0, 0, 100, 100, 10, 10);
	const event = { valid: true, insideViewport: true, viewportX: 20, viewportY: 20, modifiers: KeyModifier.shift, deltaX: 0, deltaY: 1 };
	assert.equal(tree.handleWheel(event), true); assert.equal(tree.scrollLeft, 30); assert.equal(tree.scroll, 0);
	assert.equal(tree.selectionIndex, 5);
	const twistieX = tree.rowLeft + branch.depth * tree.layout.indentWidth + 1;
	assert.equal(workbenchTreeTwistieContainsPosition(tree, 5, twistieX, tree.scrollLeft), true);
	assert.equal(workbenchTreeTwistieContainsPosition(tree, 5, twistieX + 10, tree.scrollLeft), false);
	assert.equal(workbenchListRowIndexAtPosition(tree, twistieX, 51), 5);
	assert.equal(workbenchListRowIndexAtPosition(tree, -1, 51), -1, 'offscreen content is never a row hit');
	tree.handleWheel({ ...event, modifiers: KeyModifier.none, deltaX: 1, deltaY: 0 });
	assert.equal(tree.scrollLeft, 60); assert.equal(tree.scroll, 0);
});
