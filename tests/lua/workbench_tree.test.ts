import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutWorkbenchList, workbenchListRowIndexAtPosition } from '../../ide/workbench/ui/list_view';
import {
	appendWorkbenchTreeNode, navigateWorkbenchTree, rebuildWorkbenchTreeRows, setWorkbenchTreeCollapsed,
	workbenchTreeTwistieContainsPosition, WorkbenchTreeNavigationResult, type WorkbenchTreeState,
} from '../../ide/workbench/ui/tree_view';

function tree(): WorkbenchTreeState<string> {
	return {
		roots: [], rows: [], selectionIndex: -1, hoverIndex: -1, scroll: 0,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0, indentWidth: 8, twistieWidth: 8 },
	};
}

test('tree topology retains actual parents, nested depth and childless roots', () => {
	const state = tree();
	const empty = appendWorkbenchTreeNode(state, null, 'empty');
	const root = appendWorkbenchTreeNode(state, null, 'root');
	const branch = appendWorkbenchTreeNode(state, root, 'branch');
	const leaf = appendWorkbenchTreeNode(state, branch, 'leaf');
	const rows = state.rows;
	rebuildWorkbenchTreeRows(state, leaf);
	assert.equal(state.rows, rows);
	assert.deepEqual(state.rows, [empty, root, branch, leaf]);
	assert.deepEqual(state.rows.map(node => node.depth), [0, 0, 1, 2]);
	assert.equal(leaf.parent, branch);
	assert.equal(branch.parent, root);
	assert.equal(state.selectionIndex, 3);
	assert.equal(setWorkbenchTreeCollapsed(state, 0, true), false);
	assert.equal(empty.collapsed, false);
});

test('tree collapse retains nodes and nested expansion but never an invisible edit target', () => {
	const state = tree();
	const root = appendWorkbenchTreeNode(state, null, 'root');
	const branch = appendWorkbenchTreeNode(state, root, 'branch', true);
	const child = appendWorkbenchTreeNode(state, branch, 'child');
	const sibling = appendWorkbenchTreeNode(state, root, 'sibling');
	const tail = appendWorkbenchTreeNode(state, null, 'tail');
	rebuildWorkbenchTreeRows(state, sibling);
	assert.deepEqual(state.rows, [root, branch, sibling, tail]);
	assert.equal(setWorkbenchTreeCollapsed(state, 0, true), true);
	assert.deepEqual(state.rows, [root, tail]);
	assert.equal(state.selectionIndex, 0);
	setWorkbenchTreeCollapsed(state, 0, false);
	assert.deepEqual(state.rows, [root, branch, sibling, tail]);
	assert.equal(branch.children[0], child);
	assert.equal(branch.collapsed, true);
	state.selectionIndex = 3;
	setWorkbenchTreeCollapsed(state, 0, true);
	assert.equal(state.rows[state.selectionIndex], tail, 'unrelated selection follows its retained node, not the old list index');
	state.selectionIndex = -1;
	setWorkbenchTreeCollapsed(state, 0, false);
	assert.equal(state.selectionIndex, -1, 'expansion never invents a target');
});

test('tree Left/Right follow expand/child and collapse/parent, not adjacent roots', () => {
	const state = tree();
	const root = appendWorkbenchTreeNode(state, null, 'root', true);
	const branch = appendWorkbenchTreeNode(state, root, 'branch');
	const leaf = appendWorkbenchTreeNode(state, branch, 'leaf');
	const tail = appendWorkbenchTreeNode(state, null, 'tail');
	rebuildWorkbenchTreeRows(state, root);
	assert.equal(navigateWorkbenchTree(state, 'right'), WorkbenchTreeNavigationResult.Collapse);
	assert.equal(root.collapsed, false);
	assert.equal(state.selectionIndex, 0, 'first Right expands, not selects a child');
	assert.equal(navigateWorkbenchTree(state, 'right'), WorkbenchTreeNavigationResult.Selection);
	assert.equal(state.rows[state.selectionIndex], branch);
	navigateWorkbenchTree(state, 'right');
	assert.equal(state.rows[state.selectionIndex], leaf);
	assert.equal(navigateWorkbenchTree(state, 'right'), WorkbenchTreeNavigationResult.None);
	navigateWorkbenchTree(state, 'left');
	assert.equal(state.rows[state.selectionIndex], branch);
	navigateWorkbenchTree(state, 'left');
	assert.equal(branch.collapsed, true);
	assert.equal(state.rows[state.selectionIndex], branch);
	navigateWorkbenchTree(state, 'left');
	assert.equal(state.rows[state.selectionIndex], root);
	navigateWorkbenchTree(state, 'left');
	assert.deepEqual(state.rows, [root, tail]);
	assert.equal(navigateWorkbenchTree(state, 'left'), WorkbenchTreeNavigationResult.None);
});

test('tree navigation from no selection selects exactly one explicit visible target', () => {
	const state = tree();
	assert.equal(navigateWorkbenchTree(state, 'down'), WorkbenchTreeNavigationResult.None);
	const root = appendWorkbenchTreeNode(state, null, 'root');
	const tail = appendWorkbenchTreeNode(state, null, 'tail');
	rebuildWorkbenchTreeRows(state, null);
	navigateWorkbenchTree(state, 'down');
	assert.equal(state.rows[state.selectionIndex], root);
	state.selectionIndex = -1;
	navigateWorkbenchTree(state, 'end');
	assert.equal(state.rows[state.selectionIndex], tail);
	state.roots.splice(1, 1);
	rebuildWorkbenchTreeRows(state, tail);
	assert.equal(state.selectionIndex, -1, 'removed nodes do not transfer selection to neighbours');
});

test('tree page/home/end navigation and collapse use the shared viewport invariants', () => {
	const state = tree();
	layoutWorkbenchList(state.layout, 0, 0, 200, 30, 10);
	const root = appendWorkbenchTreeNode(state, null, 'root');
	for (let index = 0; index < 10; index += 1) appendWorkbenchTreeNode(state, root, `child${index}`);
	rebuildWorkbenchTreeRows(state, root);
	navigateWorkbenchTree(state, 'page-down');
	assert.equal(state.selectionIndex, 3);
	assert.equal(state.scroll, 1);
	navigateWorkbenchTree(state, 'end');
	assert.equal(state.selectionIndex, 10);
	assert.equal(state.scroll, 8);
	navigateWorkbenchTree(state, 'page-up');
	assert.equal(state.selectionIndex, 7);
	assert.equal(state.scroll, 7);
	navigateWorkbenchTree(state, 'home');
	assert.equal(state.scroll, 0);
	navigateWorkbenchTree(state, 'end');
	setWorkbenchTreeCollapsed(state, 0, true);
	assert.equal(state.scroll, 0);
	assert.equal(state.selectionIndex, 0);
});

test('tree selection and collapse distinguish equal labels by node identity', () => {
	const state = tree();
	const first = appendWorkbenchTreeNode(state, null, 'same');
	appendWorkbenchTreeNode(state, first, 'same');
	const second = appendWorkbenchTreeNode(state, null, 'same');
	const child = appendWorkbenchTreeNode(state, second, 'same');
	rebuildWorkbenchTreeRows(state, child);
	setWorkbenchTreeCollapsed(state, 0, true);
	assert.equal(state.rows[state.selectionIndex], child);
	assert.equal(second.collapsed, false);
	navigateWorkbenchTree(state, 'left');
	assert.equal(state.rows[state.selectionIndex], second);
	setWorkbenchTreeCollapsed(state, state.selectionIndex, true);
	assert.equal(state.rows[state.selectionIndex], second);
});

test('tree twisties use retained depth geometry and never claim leaf or label clicks', () => {
	const state = tree();
	layoutWorkbenchList(state.layout, 4, 20, 200, 60, 10);
	const root = appendWorkbenchTreeNode(state, null, 'root');
	const branch = appendWorkbenchTreeNode(state, root, 'branch');
	appendWorkbenchTreeNode(state, branch, 'leaf');
	rebuildWorkbenchTreeRows(state, null);
	assert.equal(workbenchListRowIndexAtPosition(state, 14, 31), 1);
	assert.equal(workbenchTreeTwistieContainsPosition(state, 1, 12), true);
	assert.equal(workbenchTreeTwistieContainsPosition(state, 1, 11), false);
	assert.equal(workbenchTreeTwistieContainsPosition(state, 1, 20), false);
	assert.equal(workbenchTreeTwistieContainsPosition(state, 2, 20), false);
	assert.equal(workbenchListRowIndexAtPosition(state, 14, 51), -1);
});
