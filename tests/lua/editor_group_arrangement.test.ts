import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorGroupArrangement, type EditorGroupLayout } from '../../ide/workbench/services/editor/group_arrangement';
import { WORKBENCH_SPLIT_SIZE } from '../../ide/workbench/ui/split_view';

// Coordinates here are the subject of the split/constraint/viewport algorithm,
// not a snapshot of incidental editor chrome or a UI workflow's pixel placement.

test('group splitting retains actual leaves and normalizes removed branches without replacing surviving groups', () => {
	const first = {}, second = {}, third = {}, arrangement = new EditorGroupArrangement(first);
	const groups = arrangement.groups, leaves = arrangement.leaves, splits = arrangement.splits, original = leaves[0];
	arrangement.split(first, second, 'right');
	const side = arrangement.root;
	assert.ok(side.kind === 'split'); assert.equal(side.split.orientation, 'horizontal');
	assert.equal(side.first, original);
	const secondLeaf = arrangement.leaves[1];
	arrangement.split(second, third, 'up');
	assert.deepEqual(arrangement.groups, [first, third, second]);
	assert.equal(arrangement.leaves[2], secondLeaf);
	assert.equal(arrangement.root, side);
	assert.ok(side.second.kind === 'split'); assert.equal(side.second.split.orientation, 'vertical');
	arrangement.remove(third);
	assert.equal(side.second, secondLeaf); assert.deepEqual(arrangement.groups, [first, second]);
	arrangement.remove(first);
	assert.equal(arrangement.root, secondLeaf); assert.deepEqual(arrangement.groups, [second]);
	assert.equal(arrangement.splits.length, 0);
	assert.equal(arrangement.groups, groups); assert.equal(arrangement.leaves, leaves); assert.equal(arrangement.splits, splits);
});

test('left and downward splits choose actual neighbor order independently of editor kind', () => {
	const first = {}, second = {}, third = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'left'); arrangement.split(first, third, 'down');
	assert.deepEqual(arrangement.groups, [second, first, third]);
	const root = arrangement.root;
	assert.ok(root.kind === 'split' && root.second.kind === 'split');
	assert.equal(root.split.orientation, 'horizontal'); assert.equal(root.second.split.orientation, 'vertical');
	assert.equal(root.first, arrangement.leaves[0]); assert.equal(root.second.first, arrangement.leaves[1]);
});

test('nested hard minima aggregate along each split axis and overflow the viewport without invalid sash intervals', () => {
	const first = {}, second = {}, third = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right'); arrangement.split(second, third, 'down');
	arrangement.setMinimum(first, 80, 40); arrangement.setMinimum(second, 70, 60); arrangement.setMinimum(third, 30, 50);
	arrangement.layout({ left: 10, top: 20, right: 110, bottom: 100 });
	const horizontal = arrangement.root;
	assert.ok(horizontal.kind === 'split' && horizontal.second.kind === 'split');
	assert.equal(horizontal.minimumWidth, 80 + WORKBENCH_SPLIT_SIZE + 70);
	assert.equal(horizontal.minimumHeight, 60 + WORKBENCH_SPLIT_SIZE + 50);
	assert.equal(arrangement.contentWidth, horizontal.minimumWidth); assert.equal(arrangement.contentHeight, horizontal.minimumHeight);
	for (const branch of arrangement.splits) {
		assert.equal(branch.split.end - branch.split.start, branch.split.minimumFirstSize + branch.split.minimumSecondSize);
		assert.equal(branch.resizable, false);
	}
	const [a, b, c] = arrangement.leaves;
	assert.equal(a.bounds.right - a.bounds.left, 80);
	assert.equal(b.bounds.right - b.bounds.left, 70); assert.equal(b.bounds.bottom - b.bounds.top, 60);
	assert.equal(c.bounds.right - c.bounds.left, 70); assert.equal(c.bounds.bottom - c.bounds.top, 50);
	assert.equal(a.visible, true); assert.equal(b.visible, true); assert.equal(c.visible, true);
	assert.ok(c.clip.bottom <= arrangement.bounds.bottom && c.clip.top <= c.clip.bottom);
	assert.equal(arrangement.reveal(third), true);
	assert.equal(arrangement.scrollX, arrangement.maxScrollX); assert.equal(arrangement.scrollY, arrangement.maxScrollY);
	assert.deepEqual(c.clip, c.bounds, 'activation exposes the entire leaf when it fits in the viewport');
	assert.equal(arrangement.groups.length, 3, 'overflow changes presentation, not retained topology');
});

test('a fully offscreen leaf publishes an empty clip and reveal exposes it without reconstructing any leaf', () => {
	const first = {}, second = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right');
	arrangement.setMinimum(first, 90, 60); arrangement.setMinimum(second, 90, 60);
	arrangement.layout({ left: 0, top: 0, right: 80, bottom: 50 });
	const a = arrangement.leaves[0], b = arrangement.leaves[1], root = arrangement.root;
	assert.equal(a.visible, true); assert.equal(b.visible, false);
	assert.equal(b.clip.left, b.clip.right); assert.equal(b.clip.top, 0); assert.equal(b.clip.bottom, 50);
	assert.equal(arrangement.reveal(second), true);
	assert.equal(arrangement.root, root); assert.equal(arrangement.leaves[1], b);
	assert.equal(b.bounds.left, 0, 'an oversized leaf is revealed at its leading edge');
	assert.equal(b.clip.left, 0); assert.equal(b.clip.right, 80); assert.equal(b.visible, true);
	assert.equal(arrangement.reveal(second), false);
});

test('requested split intent survives constrained minima, scroll and enlargement', () => {
	const first = {}, second = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right');
	const root = arrangement.root; assert.ok(root.kind === 'split');
	root.split.ratio = 0.75;
	arrangement.setMinimum(first, 500, 30); arrangement.setMinimum(second, 20, 30);
	arrangement.layout({ left: 0, top: 0, right: 400, bottom: 100 });
	assert.equal(root.split.ratio, 0.75); assert.equal(arrangement.leaves[0].bounds.right, 500);
	arrangement.reveal(second); assert.ok(arrangement.scrollX > 0);
	arrangement.layout({ left: 0, top: 0, right: 800, bottom: 100 });
	assert.equal(root.split.ratio, 0.75); assert.equal(arrangement.scrollX, 0);
	assert.equal(root.split.position, 600);
	assert.equal(arrangement.leaves[0].bounds.right, 600 - WORKBENCH_SPLIT_SIZE / 2);
	assert.equal(root.resizable, true);
	arrangement.setMinimum(first, 700, 30); arrangement.layout(arrangement.bounds);
	assert.equal(root.split.ratio, 0.75); assert.equal(arrangement.leaves[0].bounds.right, 700);
	arrangement.setMinimum(first, 500, 30); arrangement.layout(arrangement.bounds);
	assert.equal(root.split.position, 600);
});

test('scrolling is bounded by arrangement extent and shifts the same leaf and sash rectangles', () => {
	const first = {}, second = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right'); arrangement.setMinimum(first, 100, 100); arrangement.setMinimum(second, 100, 100);
	arrangement.layout({ left: 10, top: 20, right: 110, bottom: 100 });
	const leaf = arrangement.leaves[0], root = arrangement.root; assert.ok(root.kind === 'split');
	const bounds = leaf.bounds, sash = root.sashBounds, left = bounds.left, sashLeft = sash.left;
	assert.equal(arrangement.setScroll(30, 10), true); arrangement.layout(arrangement.bounds);
	assert.equal(leaf.bounds, bounds); assert.equal(root.sashBounds, sash);
	assert.equal(bounds.left, left - 30); assert.equal(sash.left, sashLeft - 30);
	assert.equal(arrangement.setScroll(1000, 1000), true); arrangement.layout(arrangement.bounds);
	assert.equal(arrangement.scrollX, arrangement.maxScrollX); assert.equal(arrangement.scrollY, arrangement.maxScrollY);
	assert.equal(arrangement.setScroll(1000, 1000), false);
	assert.equal(arrangement.setScroll(-10, -10), true); arrangement.layout(arrangement.bounds);
	assert.equal(arrangement.scrollX, 0); assert.equal(arrangement.scrollY, 0);
});

test('group maximize is temporary presentation and explicit hidden-sibling reveal restores its original arrangement', () => {
	const first = {}, second = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right'); arrangement.setMinimum(first, 50, 40); arrangement.setMinimum(second, 50, 40);
	const viewport = { left: 10, top: 20, right: 410, bottom: 220 };
	arrangement.layout(viewport);
	const root = arrangement.root, [a, b] = arrangement.leaves, normalA = { ...a.bounds }, normalB = { ...b.bounds };
	arrangement.toggleMaximize(first); arrangement.layout(viewport);
	assert.equal(arrangement.maximized, first); assert.deepEqual(a.bounds, viewport); assert.equal(a.visible, true);
	assert.equal(b.visible, false); assert.equal(b.bounds.left, b.bounds.right);
	assert.ok(arrangement.splits.every(split => !split.visible && !split.resizable));
	assert.equal(arrangement.reveal(first), false); assert.equal(arrangement.maximized, first);
	assert.equal(arrangement.reveal(second), true);
	assert.equal(arrangement.maximized, undefined); assert.equal(arrangement.root, root);
	assert.deepEqual(a.bounds, normalA); assert.deepEqual(b.bounds, normalB); assert.equal(b.visible, true);
	arrangement.toggleMaximize(second); arrangement.layout(viewport); arrangement.toggleMaximize(second); arrangement.layout(viewport);
	assert.equal(arrangement.maximized, undefined); assert.deepEqual(b.bounds, normalB);
});

test('removing a maximized leaf retires its presentation while promoting the surviving actual subtree', () => {
	const first = {}, second = {}, third = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right'); arrangement.split(second, third, 'down');
	const side = arrangement.root; assert.ok(side.kind === 'split');
	const surviving = side.second;
	arrangement.toggleMaximize(first); arrangement.remove(first);
	assert.equal(arrangement.maximized, undefined); assert.equal(arrangement.root, surviving);
	assert.deepEqual(arrangement.groups, [second, third]);
});

test('temporary maximization retains the normal overflow position separately from the presented leaf viewport', () => {
	const first = {}, second = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right'); arrangement.setMinimum(first, 150, 150); arrangement.setMinimum(second, 150, 150);
	arrangement.layout({ left: 0, top: 0, right: 100, bottom: 100 });
	arrangement.setScroll(180, 40); arrangement.layout(arrangement.bounds);
	arrangement.toggleMaximize(second); arrangement.layout(arrangement.bounds);
	assert.equal(arrangement.normalScrollX, 180); assert.equal(arrangement.normalScrollY, 40);
	assert.equal(arrangement.scrollX, 0); assert.equal(arrangement.scrollY, 0);
	arrangement.setScroll(30, 20); arrangement.layout(arrangement.bounds);
	assert.equal(arrangement.normalScrollX, 180); assert.equal(arrangement.scrollX, 30);
	arrangement.toggleMaximize(second); arrangement.layout(arrangement.bounds);
	assert.equal(arrangement.scrollX, 180); assert.equal(arrangement.scrollY, 40);
	arrangement.toggleMaximize(first); arrangement.layout(arrangement.bounds);
	arrangement.reveal(second);
	assert.equal(arrangement.maximized, undefined);
	assert.equal(arrangement.normalScrollX, arrangement.scrollX); assert.equal(arrangement.normalScrollY, arrangement.scrollY);
});

test('restoration consumes actual group references and reconstructs only arrangement-owned geometry', () => {
	const initial = {}, first = {}, second = {}, third = {}, arrangement = new EditorGroupArrangement(initial);
	const groups = arrangement.groups, leaves = arrangement.leaves;
	const state: EditorGroupLayout<object> = { kind: 'split', orientation: 'horizontal', ratio: 0.3,
		first: { kind: 'group', group: first }, second: { kind: 'split', orientation: 'vertical', ratio: 0.7,
			first: { kind: 'group', group: second }, second: { kind: 'group', group: third } } };
	arrangement.setRoot(state);
	assert.equal(arrangement.groups, groups); assert.equal(arrangement.leaves, leaves);
	assert.deepEqual(arrangement.groups, [first, second, third]);
	const root = arrangement.root; assert.ok(root.kind === 'split' && root.second.kind === 'split');
	assert.equal(root.split.ratio, 0.3); assert.equal(root.second.split.ratio, 0.7);
	arrangement.layout({ left: 0, top: 0, right: 1000, bottom: 500 });
	assert.equal(root.split.position, 300); assert.equal(root.second.split.position, 350);
	assert.equal(arrangement.leaves.some(leaf => leaf.group === initial), false);
});

test('warmed unchanged arrangement layout does not recompute geometry or replace retained projections', t => {
	const first = {}, second = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right'); arrangement.setMinimum(first, 40, 30); arrangement.setMinimum(second, 40, 30);
	const viewport = { left: 0, top: 0, right: 400, bottom: 200 };
	arrangement.layout(viewport);
	const root = arrangement.root; assert.ok(root.kind === 'split');
	const position = t.mock.getter(root.split, 'position');
	const groups = arrangement.groups, leaves = arrangement.leaves, splits = arrangement.splits;
	const bounds = leaves.map(leaf => leaf.bounds), clips = leaves.map(leaf => leaf.clip), revision = arrangement.revision;
	for (let frame = 0; frame < 1000; frame++) {
		arrangement.setMinimum(first, 40, 30); assert.equal(arrangement.layout(viewport), false);
	}
	assert.equal(position.mock.callCount(), 0); assert.equal(arrangement.revision, revision);
	assert.equal(arrangement.groups, groups); assert.equal(arrangement.leaves, leaves); assert.equal(arrangement.splits, splits);
	for (let index = 0; index < leaves.length; index++) { assert.equal(leaves[index].bounds, bounds[index]); assert.equal(leaves[index].clip, clips[index]); }
	root.split.ratio = 0.6;
	assert.equal(arrangement.layout(viewport), true); assert.equal(position.mock.callCount(), 1);
	assert.equal(arrangement.layout(viewport), false); assert.equal(position.mock.callCount(), 1);
});
