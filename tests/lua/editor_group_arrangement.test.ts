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

test('group resizing changes the requested leaf extent from either side without replacing topology', () => {
	for (const axis of ['width', 'height'] as const) {
		const first = {}, second = {}, arrangement = new EditorGroupArrangement(first);
		arrangement.split(first, second, axis === 'width' ? 'right' : 'down');
		arrangement.setMinimum(first, 40, 40); arrangement.setMinimum(second, 40, 40);
		arrangement.layout({ left: 10, top: 20, right: 410, bottom: 420 });
		const root = arrangement.root, leaves = [...arrangement.leaves], topology = arrangement.topologyRevision;
		const size = (index: number) => axis === 'width' ? leaves[index].bounds.right - leaves[index].bounds.left
			: leaves[index].bounds.bottom - leaves[index].bounds.top;
		const firstSize = size(0), secondSize = size(1);
		assert.equal(arrangement.canResizeGroup(first, axis, 40), true);
		assert.equal(arrangement.resizeGroup(first, axis, 40), true);
		assert.equal(size(0), firstSize + 40); assert.equal(size(1), secondSize - 40);
		assert.equal(arrangement.canResizeGroup(second, axis, 20), true);
		assert.equal(arrangement.resizeGroup(second, axis, 20), true);
		assert.equal(size(0), firstSize + 20); assert.equal(size(1), secondSize - 20);
		assert.equal(arrangement.root, root); assert.equal(arrangement.topologyRevision, topology);
		assert.deepEqual(arrangement.leaves, leaves);
	}
});

test('group resizing skips orthogonal parents while the nearest matching split owns the shared extent', () => {
	const first = {}, second = {}, third = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right'); arrangement.split(second, third, 'down');
	for (const group of [first, second, third]) arrangement.setMinimum(group, 40, 40);
	arrangement.layout({ left: 0, top: 0, right: 600, bottom: 400 });
	const root = arrangement.root; assert.ok(root.kind === 'split' && root.second.kind === 'split');
	const vertical = root.second, originalHorizontal = root.split.position, originalVertical = vertical.split.position;
	assert.equal(arrangement.resizeBoundary(third, 'width'), root);
	assert.equal(arrangement.resizeBoundary(second, 'width'), root);
	assert.equal(arrangement.resizeBoundary(third, 'height'), vertical);
	assert.equal(arrangement.resizeBoundary(second, 'height'), vertical);
	assert.equal(arrangement.resizeBoundary(first, 'height'), undefined);
	const [a, b, c] = arrangement.leaves, width = c.bounds.right - c.bounds.left, height = c.bounds.bottom - c.bounds.top;
	assert.equal(arrangement.resizeGroup(third, 'width', 30), true);
	assert.equal(root.split.position, originalHorizontal - 30); assert.equal(vertical.split.position, originalVertical);
	assert.equal(c.bounds.right - c.bounds.left, width + 30);
	assert.equal(b.bounds.right - b.bounds.left, width + 30, 'orthogonal siblings share their containing width');
	const horizontal = root.split.position, firstBounds = { ...a.bounds };
	assert.equal(arrangement.resizeGroup(third, 'height', 30), true);
	assert.equal(root.split.position, horizontal); assert.equal(vertical.split.position, originalVertical - 30);
	assert.equal(c.bounds.bottom - c.bounds.top, height + 30); assert.deepEqual(a.bounds, firstBounds);
	assert.equal(arrangement.canResizeGroup(first, 'height', 30), false);
	assert.equal(arrangement.resizeGroup(first, 'height', 30), false);
});

test('saturated group resizing preserves requested intent and uses the native feasible interval in either direction', () => {
	const first = {}, second = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right'); arrangement.setMinimum(first, 50, 30); arrangement.setMinimum(second, 80, 30);
	const root = arrangement.root; assert.ok(root.kind === 'split');
	root.split.ratio = 0.9;
	arrangement.layout({ left: 0, top: 0, right: 300, bottom: 100 });
	const revision = arrangement.revision;
	assert.equal(arrangement.canResizeGroup(first, 'width', 30), false);
	assert.equal(arrangement.resizeGroup(first, 'width', 30), false);
	assert.equal(root.split.ratio, 0.9); assert.equal(arrangement.revision, revision);
	assert.equal(arrangement.resizeGroup(first, 'width', -1000), true);
	assert.equal(arrangement.leaves[0].bounds.right - arrangement.leaves[0].bounds.left, 50);
	assert.equal(arrangement.canResizeGroup(first, 'width', -30), false);
	assert.equal(arrangement.resizeGroup(first, 'width', -30), false);
	assert.equal(arrangement.canResizeGroup(second, 'width', 30), false);
	assert.equal(arrangement.resizeGroup(second, 'width', -1000), true);
	assert.equal(arrangement.leaves[1].bounds.right - arrangement.leaves[1].bounds.left, 80);
	assert.equal(arrangement.canResizeGroup(first, 'width', 0), false);
	assert.equal(arrangement.resizeGroup(first, 'width', 0), false);
});

test('a saturated local group boundary does not resize a farther same-axis branch', () => {
	const first = {}, second = {}, third = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right'); arrangement.split(first, third, 'right');
	for (const group of [first, second, third]) arrangement.setMinimum(group, 60, 30);
	arrangement.layout({ left: 0, top: 0, right: 600, bottom: 100 });
	const root = arrangement.root; assert.ok(root.kind === 'split' && root.first.kind === 'split');
	assert.equal(arrangement.resizeBoundary(first, 'width'), root.first);
	assert.equal(arrangement.resizeBoundary(third, 'width'), root.first);
	assert.equal(arrangement.resizeBoundary(second, 'width'), root);
	const rootRatio = root.split.ratio;
	assert.equal(arrangement.resizeGroup(first, 'width', 1000), true);
	const localRatio = root.first.split.ratio, revision = arrangement.revision;
	assert.equal(arrangement.canResizeGroup(first, 'width', 30), false);
	assert.equal(arrangement.resizeGroup(first, 'width', 30), false);
	assert.equal(root.split.ratio, rootRatio); assert.equal(root.first.split.ratio, localRatio);
	assert.equal(arrangement.revision, revision);
	assert.equal(arrangement.resizeBoundary(first, 'width'), root.first, 'a saturated nearest owner is not replaced by a farther movable split');
	assert.ok(arrangement.leaves[2].bounds.right - arrangement.leaves[2].bounds.left > 60, 'unrelated outer sibling still has spare extent');
});

test('single, maximized and minimum-overflow arrangements do not admit directional resizing', () => {
	const first = {}, second = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.layout({ left: 0, top: 0, right: 400, bottom: 200 });
	assert.equal(arrangement.resizeBoundary(first, 'width'), undefined);
	assert.equal(arrangement.resizeBoundary(first, 'height'), undefined);
	assert.equal(arrangement.canResizeGroup(first, 'width', 30), false);
	assert.equal(arrangement.resizeGroup(first, 'height', 30), false);
	arrangement.split(first, second, 'right'); arrangement.setMinimum(first, 60, 40); arrangement.setMinimum(second, 60, 40);
	arrangement.layout(arrangement.bounds);
	const root = arrangement.root; assert.ok(root.kind === 'split');
	const ratio = root.split.ratio;
	arrangement.toggleMaximize(first); arrangement.layout(arrangement.bounds);
	assert.equal(arrangement.resizeBoundary(first, 'width'), undefined);
	assert.equal(arrangement.resizeBoundary(second, 'width'), undefined);
	assert.equal(arrangement.canResizeGroup(first, 'width', -30), false);
	assert.equal(arrangement.resizeGroup(second, 'width', 30), false);
	assert.equal(arrangement.maximized, first); assert.equal(root.split.ratio, ratio);
	arrangement.toggleMaximize(first); arrangement.layout({ left: 0, top: 0, right: 100, bottom: 100 });
	assert.equal(arrangement.resizeBoundary(first, 'width'), root, 'minimum-filled geometry retains its real reset owner');
	assert.equal(arrangement.canResizeGroup(first, 'width', 30), false);
	assert.equal(arrangement.resizeGroup(second, 'width', -30), false);
	assert.equal(root.split.ratio, ratio);
});

test('resetting a constrained group boundary restores requested default and publishes native sizing once without replacing topology', () => {
	const first = {}, second = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right'); arrangement.setMinimum(first, 300, 40); arrangement.setMinimum(second, 100, 40);
	const root = arrangement.root; assert.ok(root.kind === 'split');
	root.split.ratio = 0.8; arrangement.layout({ left: 0, top: 0, right: 500, bottom: 100 });
	const topology = arrangement.topologyRevision, leaves = [...arrangement.leaves];
	const boundary = arrangement.resizeBoundary(second, 'width')!;
	let publications = 0; boundary.split.onDidResize(() => publications++);
	assert.equal(boundary.split.canReset, true); boundary.split.reset(); arrangement.layout(arrangement.bounds);
	assert.equal(boundary.split.ratio, 0.5); assert.equal(publications, 1); assert.equal(boundary.split.canReset, false);
	assert.equal(boundary.split.position, 304, 'current child minima still constrain the restored default presentation');
	boundary.split.reset(); assert.equal(publications, 1);
	arrangement.layout({ left: 0, top: 0, right: 1000, bottom: 100 });
	assert.equal(boundary.split.position, 500, 'future layout consumes default ratio intent rather than the earlier minimum clamp');
	assert.equal(arrangement.root, root); assert.equal(arrangement.topologyRevision, topology); assert.deepEqual(arrangement.leaves, leaves);
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

for (const direction of ['left', 'right', 'up', 'down'] as const) for (const removeSource of [false, true]) for (const overflow of [false, true])
	test(`split preview consumes the committed ${direction} topology, minima and overflow viewport (${removeSource ? 'retired' : 'retained'} source, ${overflow ? 'overflow' : 'fitted'})`, () => {
		const source = {}, reference = {}, incoming = {}, arrangement = new EditorGroupArrangement(source);
		const area = { left: 30, top: 20, right: overflow ? 170 : 830, bottom: overflow ? 100 : 620 };
		arrangement.split(source, reference, 'right');
		arrangement.setMinimum(source, 100, 50); arrangement.setMinimum(reference, 90, 70);
		arrangement.layoutClient(area, 8); arrangement.setScroll(20, 10); arrangement.layoutClient(area, 8);
		const root = arrangement.root, revision = arrangement.revision, layoutRevision = arrangement.layoutRevision;
		const projected = arrangement.projectSplit(reference, direction, 120, 80, removeSource ? source : undefined);
		projected.layout(area, 8, false);
		const preview = { ...projected.target.clip };
		assert.ok(arrangement.root === root); assert.equal(arrangement.revision, revision); assert.equal(arrangement.layoutRevision, layoutRevision);
		assert.equal(arrangement.groups.length, 2, 'projection never publishes or constructs a live group');
		assert.equal(arrangement.projectSplit(reference, direction, 120, 80, removeSource ? source : undefined), projected);
		arrangement.split(reference, incoming, direction); arrangement.setMinimum(incoming, 120, 80);
		if (removeSource) arrangement.remove(source);
		arrangement.layoutClient(area, 8); arrangement.reveal(incoming);
		assert.deepEqual(preview, arrangement.leaves.find(leaf => leaf.group === incoming)!.clip);
	});

test('split projection invalidates on live minima and client changes rather than retaining a stale half-rectangle', () => {
	const reference = {}, incoming = {}, arrangement = new EditorGroupArrangement(reference);
	const area = { left: 0, top: 0, right: 500, bottom: 300 };
	arrangement.setMinimum(reference, 20, 20); arrangement.layoutClient(area, 8);
	const first = arrangement.projectSplit(reference, 'right', 80, 20, undefined);
	first.layout(area, 8, false);
	const previous = { ...first.target.clip };
	arrangement.setMinimum(reference, 400, 20); area.bottom = 150; arrangement.layoutClient(area, 8);
	const projected = arrangement.projectSplit(reference, 'right', 80, 20, undefined);
	projected.layout(area, 8, false);
	assert.notEqual(projected, first); assert.notDeepEqual(projected.target.clip, previous);
	arrangement.split(reference, incoming, 'right'); arrangement.setMinimum(incoming, 80, 20);
	arrangement.layoutClient(area, 8); arrangement.reveal(incoming);
	assert.deepEqual(projected.target.clip, arrangement.leaves.find(leaf => leaf.group === incoming)!.clip);
});

test('moving a group retains its actual leaf and normalizes only the departing branch', () => {
	const source = {}, first = {}, reference = {}, last = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, last, 'right'); arrangement.split(last, reference, 'down'); arrangement.split(first, source, 'down');
	arrangement.setMinimum(source, 137, 83); arrangement.layoutClient({ left: 0, top: 0, right: 800, bottom: 500 }, 8);
	const root = arrangement.root; assert.ok(root.kind === 'split');
	const retiredBranch = root.first, retainedBranch = root.second;
	assert.ok(retiredBranch.kind === 'split');
	const leaf = arrangement.leaves.find(leaf => leaf.group === source)!, bounds = leaf.bounds, clip = leaf.clip;
	const groups = arrangement.groups, leaves = arrangement.leaves, splits = arrangement.splits;
	assert.equal(arrangement.move(source, reference, 'right'), true);
	assert.ok(arrangement.root === root && root.second === retainedBranch);
	assert.equal(arrangement.splits.includes(retiredBranch), false);
	assert.ok(arrangement.groups[0] === first && arrangement.groups[1] === last && arrangement.groups[2] === reference && arrangement.groups[3] === source);
	assert.ok(arrangement.leaves.find(candidate => candidate.group === source) === leaf);
	assert.ok(leaf.bounds === bounds && leaf.clip === clip); assert.equal(leaf.minimumWidth, 137); assert.equal(leaf.minimumHeight, 83);
	assert.ok(arrangement.groups === groups && arrangement.leaves === leaves && arrangement.splits === splits);
});

for (const orientation of ['horizontal', 'vertical'] as const) test(`moving sibling groups preserves their ${orientation} requested extents and existing sash`, () => {
	const source = {}, reference = {}, arrangement = new EditorGroupArrangement(source);
	arrangement.split(source, reference, orientation === 'horizontal' ? 'right' : 'down');
	const root = arrangement.root; assert.ok(root.kind === 'split'); root.split.ratio = 0.3;
	const area = { left: 10, top: 20, right: 810, bottom: 620 };
	arrangement.layoutClient(area, 8);
	const sourceLeaf = arrangement.leaves[0], referenceLeaf = arrangement.leaves[1];
	const width = sourceLeaf.bounds.right - sourceLeaf.bounds.left, height = sourceLeaf.bounds.bottom - sourceLeaf.bounds.top;
	const revision = arrangement.revision, layoutRevision = arrangement.layoutRevision;
	assert.equal(arrangement.move(source, reference, orientation === 'horizontal' ? 'left' : 'up'), false);
	assert.equal(arrangement.revision, revision); assert.equal(arrangement.layoutRevision, layoutRevision);
	assert.equal(arrangement.move(source, reference, orientation === 'horizontal' ? 'right' : 'down'), true);
	arrangement.layoutClient(area, 8);
	assert.ok(arrangement.root === root && root.first === referenceLeaf && root.second === sourceLeaf);
	assert.equal(root.split.ratio, 0.7);
	assert.equal(sourceLeaf.bounds.right - sourceLeaf.bounds.left, width); assert.equal(sourceLeaf.bounds.bottom - sourceLeaf.bounds.top, height);
});

test('a group cannot move into itself or replace its sole retained leaf', () => {
	const group = {}, arrangement = new EditorGroupArrangement(group), root = arrangement.root;
	arrangement.layoutClient({ left: 0, top: 0, right: 400, bottom: 200 }, 8);
	const revision = arrangement.revision;
	assert.equal(arrangement.move(group, group, 'right'), false);
	assert.equal(arrangement.projectMove(group, group, 'right', 80, 40), undefined);
	assert.ok(arrangement.root === root); assert.equal(arrangement.revision, revision);
	assert.equal(arrangement.groups.length, 1);
});

test('an explicit group move exits temporary maximization using the retained normal scroll', () => {
	const source = {}, reference = {}, arrangement = new EditorGroupArrangement(source);
	const area = { left: 0, top: 0, right: 100, bottom: 100 };
	arrangement.split(source, reference, 'right'); arrangement.setMinimum(source, 150, 150); arrangement.setMinimum(reference, 150, 150);
	arrangement.layoutClient(area, 8); arrangement.setScroll(180, 40); arrangement.layoutClient(area, 8);
	arrangement.toggleMaximize(source); arrangement.layoutClient(area, 8);
	const leaf = arrangement.leaves.find(leaf => leaf.group === source)!;
	assert.equal(arrangement.move(source, reference, 'down'), true);
	assert.equal(arrangement.maximized, undefined); assert.equal(arrangement.scrollX, 180); assert.equal(arrangement.scrollY, 40);
	arrangement.layoutClient(area, 8); arrangement.reveal(source);
	assert.ok(arrangement.leaves.find(candidate => candidate.group === source) === leaf && leaf.visible);
	assert.ok(arrangement.groups[0] === reference && arrangement.groups[1] === source);
});

for (const direction of ['left', 'right', 'up', 'down'] as const) for (const overflow of [false, true]) for (const maximized of ['none', 'source', 'reference'] as const)
	test(`group move preview matches retained ${direction} topology and reveal (${overflow ? 'overflow' : 'fitted'}, ${maximized} maximized)`, () => {
		const source = {}, reference = {}, third = {}, arrangement = new EditorGroupArrangement(source);
		const area = { left: 30, top: 20, right: overflow ? 170 : 830, bottom: overflow ? 100 : 620 };
		arrangement.split(source, reference, 'right'); arrangement.split(source, third, 'down');
		arrangement.setMinimum(source, 120, 80); arrangement.setMinimum(reference, 90, 70); arrangement.setMinimum(third, 110, 60);
		arrangement.layoutClient(area, 8); arrangement.setScroll(20, 10); arrangement.layoutClient(area, 8);
		if (maximized !== 'none') { arrangement.toggleMaximize(maximized === 'source' ? source : reference); arrangement.layoutClient(area, 8); }
		const root = arrangement.root, revision = arrangement.revision, layoutRevision = arrangement.layoutRevision;
		const leaf = arrangement.leaves.find(leaf => leaf.group === source)!, previous = { ...leaf.bounds };
		const projected = arrangement.projectMove(source, reference, direction, 120, 80)!;
		projected.layout(area, 8, false);
		assert.ok(arrangement.root === root); assert.equal(arrangement.revision, revision); assert.equal(arrangement.layoutRevision, layoutRevision);
		assert.deepEqual(leaf.bounds, previous); assert.equal(arrangement.groups.length, 3);
		arrangement.move(source, reference, direction); arrangement.layoutClient(area, 8); arrangement.reveal(source);
		assert.deepEqual(projected.target.clip, leaf.clip);
	});

for (const direction of ['left', 'right', 'up', 'down'] as const) test(`incoming group ${direction} preview uses the same admitted split constraints without a local source`, () => {
	const reference = {}, incoming = {}, arrangement = new EditorGroupArrangement(reference);
	const area = { left: 20, top: 30, right: 180, bottom: 120 };
	arrangement.setMinimum(reference, 130, 90); arrangement.layoutClient(area, 8);
	const projected = arrangement.projectMove(undefined, reference, direction, 120, 80)!;
	projected.layout(area, 8, false);
	assert.equal(arrangement.groups.length, 1);
	arrangement.split(reference, incoming, direction); arrangement.setMinimum(incoming, 120, 80);
	arrangement.layoutClient(area, 8); arrangement.reveal(incoming);
	assert.deepEqual(projected.target.clip, arrangement.leaves.find(leaf => leaf.group === incoming)!.clip);
});

test('warmed group-move previews reuse their projection until real topology, minima or viewport publication changes', t => {
	const source = {}, reference = {}, third = {}, arrangement = new EditorGroupArrangement(source);
	const area = { left: 0, top: 0, right: 500, bottom: 300 };
	arrangement.split(source, reference, 'right'); arrangement.setMinimum(source, 80, 40); arrangement.layoutClient(area, 8);
	const first = arrangement.projectMove(source, reference, 'down', 80, 40)!;
	first.layout(area, 8, false);
	const move = t.mock.method(EditorGroupArrangement.prototype, 'move'), previous = { ...first.target.clip };
	for (let frame = 0; frame < 100; frame++) assert.equal(arrangement.projectMove(source, reference, 'down', 80, 40), first);
	assert.equal(move.mock.callCount(), 0); assert.deepEqual(first.target.clip, previous);
	arrangement.split(reference, third, 'up'); arrangement.setMinimum(third, 100, 60); area.right = 200; arrangement.layoutClient(area, 8);
	const next = arrangement.projectMove(source, reference, 'down', 80, 40)!;
	next.layout(area, 8, false);
	assert.equal(move.mock.callCount(), 1); assert.notEqual(next, first); assert.notDeepEqual(next.target.clip, previous);
});

test('hard and reading constraints share retained nested topology and maximize the same presented root', () => {
	const first = {}, second = {}, third = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right'); arrangement.split(second, third, 'down');
	arrangement.setMinimum(first, 40, 30, 120); arrangement.setMinimum(second, 50, 40, 150); arrangement.setMinimum(third, 30, 60, 180);
	const root = arrangement.root, topology = arrangement.topologyRevision;
	assert.equal(arrangement.hardMinimumWidth, 98); assert.equal(arrangement.minimumWidth, 98);
	assert.equal(arrangement.readingMinimumWidth, 308); assert.equal(arrangement.minimumHeight, 108);
	const revision = arrangement.revision, layout = arrangement.layoutRevision;
	assert.equal(arrangement.readingMinimumClientWidth(108, 8), 308);
	assert.equal(arrangement.readingMinimumClientWidth(107, 8), 316);
	assert.equal(arrangement.revision, revision); assert.equal(arrangement.layoutRevision, layout);
	assert.equal(arrangement.useReadingWidths, false);
	arrangement.useReadingWidths = true;
	assert.equal(arrangement.minimumWidth, 308); assert.equal(arrangement.hardMinimumWidth, 98);
	arrangement.toggleMaximize(second);
	assert.equal(arrangement.minimumWidth, 150); assert.equal(arrangement.hardMinimumWidth, 50); assert.equal(arrangement.minimumHeight, 40);
	assert.equal(arrangement.readingMinimumClientWidth(39, 8), 158);
	arrangement.toggleMaximize(second);
	assert.equal(arrangement.minimumWidth, 308); assert.equal(arrangement.root, root); assert.equal(arrangement.topologyRevision, topology);
});

test('reading clamps every horizontal child while preserving hard heights and requested sash intent', () => {
	const first = {}, second = {}, third = {}, arrangement = new EditorGroupArrangement(first);
	arrangement.split(first, second, 'right'); arrangement.split(second, third, 'down');
	arrangement.setMinimum(first, 40, 30, 120); arrangement.setMinimum(second, 50, 40, 150); arrangement.setMinimum(third, 30, 60, 180);
	const root = arrangement.root; assert.ok(root.kind === 'split' && root.second.kind === 'split');
	root.split.ratio = 0.05; root.second.split.ratio = 0.7;
	const area = { left: 0, top: 0, right: 400, bottom: 200 };
	arrangement.layoutClient(area, 8);
	const [a, b, c] = arrangement.leaves, topology = arrangement.topologyRevision, hardA = a.bounds.right;
	arrangement.useReadingWidths = true; arrangement.layoutClient(area, 8);
	assert.equal(a.bounds.right - a.bounds.left, 120);
	assert.ok(b.bounds.right - b.bounds.left >= 150); assert.ok(c.bounds.right - c.bounds.left >= 180);
	assert.ok(b.bounds.bottom - b.bounds.top >= 40); assert.ok(c.bounds.bottom - c.bounds.top >= 60);
	assert.equal(arrangement.minimumHeight, 108); assert.equal(root.split.ratio, 0.05); assert.equal(root.second.split.ratio, 0.7);
	arrangement.useReadingWidths = false; arrangement.layoutClient(area, 8);
	assert.equal(a.bounds.right, hardA); assert.equal(arrangement.root, root); assert.equal(arrangement.topologyRevision, topology);
});

test('the reading client-width query includes precisely the vertical scrollbar lane without inducing horizontal overflow', () => {
	const group = {}, arrangement = new EditorGroupArrangement(group);
	arrangement.setMinimum(group, 40, 120, 180); arrangement.useReadingWidths = true;
	for (const height of [120, 119]) {
		const width = arrangement.readingMinimumClientWidth(height, 8);
		arrangement.layoutClient({ left: 0, top: 0, right: width, bottom: height }, 8);
		assert.equal(arrangement.bounds.right, 180); assert.equal(arrangement.bounds.bottom, height);
		assert.equal(arrangement.maxScrollX, 0); assert.equal(arrangement.maxScrollY > 0, height < 120);
	}
});

test('reading-only producer changes invalidate measurements and projections without changing hard minima or topology', () => {
	const source = {}, reference = {}, arrangement = new EditorGroupArrangement(source);
	arrangement.split(source, reference, 'right'); arrangement.setMinimum(source, 40, 30, 120); arrangement.setMinimum(reference, 50, 40, 150);
	const first = arrangement.projectMove(source, reference, 'down', 40, 30, 120)!;
	const topology = arrangement.topologyRevision, hard = arrangement.hardMinimumWidth, revision = arrangement.revision;
	arrangement.setMinimum(source, 40, 30, 180);
	assert.equal(arrangement.hardMinimumWidth, hard); assert.equal(arrangement.readingMinimumWidth, 338);
	assert.equal(arrangement.topologyRevision, topology); assert.ok(arrangement.revision > revision);
	assert.notEqual(arrangement.projectMove(source, reference, 'down', 40, 30, 180), first);
	const second = arrangement.projectMove(source, reference, 'down', 40, 30, 180)!;
	assert.notEqual(arrangement.projectMove(source, reference, 'down', 40, 30, 190), second, 'incoming reading constraints participate in the projection key');
});

test('a prepared projection exposes its constraints before accepting a different parent-allocated primary rectangle', () => {
	const source = {}, reference = {}, incoming = {}, arrangement = new EditorGroupArrangement(source);
	const previousArea = { left: 10, top: 20, right: 330, bottom: 180 }, expandedArea = { ...previousArea, right: 730 };
	arrangement.split(source, reference, 'right'); arrangement.setMinimum(source, 40, 50, 120); arrangement.setMinimum(reference, 50, 70, 150);
	arrangement.useReadingWidths = true; arrangement.layoutClient(previousArea, 8);
	const root = arrangement.root, bounds = arrangement.leaves.map(leaf => ({ ...leaf.bounds })), revision = arrangement.revision;
	const projected = arrangement.projectSplit(reference, 'right', 60, 80, undefined, 220);
	assert.equal(projected.arrangement.readingMinimumWidth, 506); assert.equal(projected.arrangement.hardMinimumWidth, 166);
	assert.equal(projected.target.readingWidth, 220); assert.equal(projected.target.bounds.left, projected.target.bounds.right);
	projected.layout(expandedArea, 8, false);
	assert.equal(arrangement.root, root); assert.equal(arrangement.revision, revision); assert.equal(arrangement.useReadingWidths, true);
	assert.deepEqual(arrangement.leaves.map(leaf => leaf.bounds), bounds);
	arrangement.split(reference, incoming, 'right'); arrangement.setMinimum(incoming, 60, 80, 220); arrangement.useReadingWidths = false;
	arrangement.layoutClient(expandedArea, 8); arrangement.reveal(incoming);
	assert.deepEqual(projected.target.clip, arrangement.leaves.find(leaf => leaf.group === incoming)!.clip);
});

test('projection caching observes new ratio intent before live layout without publishing live geometry', () => {
	const source = {}, reference = {}, arrangement = new EditorGroupArrangement(source);
	arrangement.split(source, reference, 'right'); arrangement.setMinimum(source, 40, 30, 120); arrangement.setMinimum(reference, 50, 40, 150);
	const area = { left: 0, top: 0, right: 800, bottom: 200 };
	arrangement.layoutClient(area, 8);
	const first = arrangement.projectSplit(reference, 'down', 60, 30, undefined, 180);
	const root = arrangement.root; assert.ok(root.kind === 'split');
	const previous = { ...arrangement.leaves[0].bounds }, layout = arrangement.layoutRevision;
	root.split.ratio = 0.7;
	const next = arrangement.projectSplit(reference, 'down', 60, 30, undefined, 180);
	assert.notEqual(next, first); assert.ok(next.arrangement.root.kind === 'split'); assert.equal(next.arrangement.root.split.ratio, 0.7);
	assert.deepEqual(arrangement.leaves[0].bounds, previous); assert.equal(arrangement.layoutRevision, layout);
	assert.equal(arrangement.layoutClient(area, 8), true, 'the live ratio publication still invalidates its own geometry');
});

test('warm reading queries and unchanged mode reuse retained measurement and projection storage', t => {
	const source = {}, reference = {}, arrangement = new EditorGroupArrangement(source);
	arrangement.split(source, reference, 'right'); arrangement.setMinimum(source, 40, 30, 120); arrangement.setMinimum(reference, 50, 40, 150);
	arrangement.useReadingWidths = true;
	const area = { left: 0, top: 0, right: 800, bottom: 200 };
	arrangement.layoutClient(area, 8);
	const projected = arrangement.projectMove(source, reference, 'down', 40, 30, 120)!, root = arrangement.root;
	assert.ok(root.kind === 'split');
	const position = t.mock.getter(root.split, 'position'), move = t.mock.method(EditorGroupArrangement.prototype, 'move');
	const revision = arrangement.revision;
	for (let frame = 0; frame < 1000; frame++) {
		arrangement.setMinimum(source, 40, 30, 120); arrangement.useReadingWidths = true;
		assert.equal(arrangement.readingMinimumClientWidth(200, 8), 278);
		assert.equal(arrangement.layoutClient(area, 8), false);
		assert.equal(arrangement.projectMove(source, reference, 'down', 40, 30, 120), projected);
	}
	assert.equal(position.mock.callCount(), 0); assert.equal(move.mock.callCount(), 0); assert.equal(arrangement.revision, revision);
});

test('cached projected allocation and tier transitions derive reveal from canonical normal scroll rather than earlier hover', t => {
	const source = {}, reference = {}, last = {};
	const initialArea = { left: 10, top: 20, right: 310, bottom: 140 }, enlargedArea = { ...initialArea, right: 440, bottom: 200 };
	const create = () => {
		const arrangement = new EditorGroupArrangement(source);
		arrangement.split(source, reference, 'right'); arrangement.split(reference, last, 'right');
		arrangement.setMinimum(source, 220, 160, 330); arrangement.setMinimum(reference, 220, 140, 330); arrangement.setMinimum(last, 400, 120, 600);
		arrangement.layoutClient(initialArea, 8); arrangement.setScroll(40, 20); arrangement.layoutClient(initialArea, 8);
		return arrangement;
	};
	const arrangement = create(), projected = arrangement.projectMove(source, reference, 'right', 220, 160, 330)!;
	const bounds = arrangement.leaves.map(leaf => ({ ...leaf.bounds })), revision = arrangement.revision;
	for (const [area, reading, bar] of [
		[initialArea, false, 8], [enlargedArea, false, 12], [initialArea, false, 8],
		[initialArea, true, 8], [enlargedArea, true, 12], [initialArea, false, 8],
	] as const) {
		assert.equal(arrangement.projectMove(source, reference, 'right', 220, 160, 330), projected);
		const actual = create(); actual.move(source, reference, 'right'); actual.useReadingWidths = reading;
		actual.layoutClient(area, bar); actual.reveal(source);
		assert.deepEqual(projected.layout(area, bar, reading), actual.leaves.find(leaf => leaf.group === source)!.clip);
		assert.equal(projected.arrangement.scrollX, actual.scrollX); assert.equal(projected.arrangement.scrollY, actual.scrollY);
	}
	assert.equal(arrangement.revision, revision); assert.equal(arrangement.normalScrollX, 40); assert.equal(arrangement.normalScrollY, 20);
	assert.deepEqual(arrangement.leaves.map(leaf => leaf.bounds), bounds);
	const layout = t.mock.method(projected.arrangement, 'layoutClient'), reveal = t.mock.method(projected.arrangement, 'reveal');
	const target = projected.target, clip = target.clip, layoutRevision = projected.arrangement.layoutRevision;
	for (let frame = 0; frame < 1000; frame++) assert.equal(projected.layout(initialArea, 8, false), clip);
	assert.equal(layout.mock.callCount(), 0); assert.equal(reveal.mock.callCount(), 0);
	assert.equal(projected.target, target); assert.equal(projected.arrangement.layoutRevision, layoutRevision);
});

test('geometry-only resizing reuses the projected topology while changed canonical scroll replaces its reveal origin', () => {
	const source = {}, reference = {}, arrangement = new EditorGroupArrangement(source);
	arrangement.split(source, reference, 'right'); arrangement.setMinimum(source, 220, 160); arrangement.setMinimum(reference, 220, 160);
	const small = { left: 10, top: 20, right: 310, bottom: 140 }, large = { ...small, right: 410, bottom: 200 };
	arrangement.layoutClient(small, 8);
	const projected = arrangement.projectMove(source, reference, 'down', 220, 160)!;
	arrangement.layoutClient(large, 8);
	assert.ok(arrangement.projectMove(source, reference, 'down', 220, 160) === projected,
		'a different allocation is not a different projected group tree');
	arrangement.setScroll(20, 0);
	assert.ok(arrangement.projectMove(source, reference, 'down', 220, 160) !== projected,
		'a new canonical scroll intent changes the prospective reveal origin');
});
