import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { dragScrollSpeed } from '../../ide/workbench/ui/drag_scroll';
import { layoutWorkbenchList } from '../../ide/workbench/ui/list_view';
import { WorkbenchTreeDrag, type WorkbenchTreeDropPlacement } from '../../ide/workbench/ui/tree_drag';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode, type WorkbenchTreeState } from '../../ide/workbench/ui/tree_view';

function pointer(x: number, y: number, pressedButtons: number = PointerButton.Primary, justReleasedButtons = 0): PointerInputSnapshot {
	return { valid: true, insideViewport: true, viewportX: x, viewportY: y, pressedButtons,
		justPressedButtons: 0, justReleasedButtons, modifiers: KeyModifier.none, spaceDown: false };
}

function fixture(t: TestContext, count = 3) {
	configureFontVariant('tiny');
	const capture = new PointerCaptureService(), surfaces = new WorkbenchSurfaceService(), scope = Symbol('tree gesture');
	const area = { left: 0, top: 0, right: 180, bottom: 140 };
	const clip = { ...area };
	const owner = surfaces.attach({ role: 'content', captureScope: scope, isVisible: () => true,
		getBounds: () => area, getClip: () => clip, draw() {} });
	const tree: WorkbenchTreeState<number> = { roots: [], rows: [], selectionIndex: -1, hoverIndex: -1, scroll: 0,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0, indentWidth: 12, twistieWidth: 12 } };
	const root = appendWorkbenchTreeNode(tree, null, -1), nodes: WorkbenchTreeNode<number>[] = [];
	for (let index = 0; index < count; index++) nodes.push(appendWorkbenchTreeNode(tree, root, index));
	rebuildWorkbenchTreeRows(tree, nodes[0]);
	layoutWorkbenchList(tree.layout, 0, 0, 160, 100, 20);
	let current = true, accepted = true, starts = 0, queries = 0, readings = 0;
	let dropped: { node: WorkbenchTreeNode<number>; placement: WorkbenchTreeDropPlacement } | undefined;
	let onCurrent: (() => void) | undefined, onQuery: (() => void) | undefined;
	const drag = new WorkbenchTreeDrag<number>(capture, scope, surfaces, owner, area, () => {
		starts++;
		return { label: 'source', labelWidth: editorViewState.font.measure('source'), font: editorViewState.font.renderFont(),
			isCurrent: () => { onCurrent?.(); return current; },
			canDrop: () => { queries++; onQuery?.(); return accepted; },
			drop: (node, placement) => { dropped = { node, placement }; } };
	}, () => { readings++; });
	const press = (node = nodes[0]) => {
		const index = tree.rows.indexOf(node), snapshot = pointer(45, tree.layout.contentTop + (index + 0.5) * tree.layout.rowHeight);
		snapshot.justPressedButtons = PointerButton.Primary;
		capture.beginRoute(scope, snapshot); drag.begin(tree, node, snapshot, 0);
	};
	const move = (x: number, y: number, now = 100) => capture.dispatch(pointer(x, y), false, now, scope);
	const release = (x: number, y: number, now = 100) => {
		const snapshot = pointer(x, y, 0, PointerButton.Primary);
		capture.dispatch(snapshot, false, now, scope); capture.endRoute(snapshot);
	};
	t.after(() => { drag.dispose(); surfaces.dispose(); });
	return { capture, surfaces, owner, area, clip, scope, tree, root, nodes, drag, press, move, release,
		setCurrent: (value: boolean) => { current = value; }, setAccepted: (value: boolean) => { accepted = value; },
		onCurrent: (callback: () => void) => { onCurrent = callback; }, onQuery: (callback: () => void) => { onQuery = callback; },
		counts: () => ({ starts, queries, readings }), dropped: () => dropped };
}

test('tree press/click does not create a source drag or publish a drop', t => {
	const f = fixture(t); f.press(); f.move(46, 31); f.release(46, 31);
	assert.deepEqual(f.counts(), { starts: 0, queries: 0, readings: 0 }); assert.equal(f.dropped(), undefined);
	assert.equal(f.capture.active, false); assert.equal(f.drag.pending, false); assert.equal(f.drag.feedback, undefined);
});

test('a captured tree drop uses the release sector, not the last accepted hover', t => {
	const f = fixture(t); f.press(); f.move(60, 78);
	assert.ok(f.drag.feedback?.target === f.nodes[2]);
	assert.equal(f.drag.feedback?.placement, 'after'); assert.equal(f.drag.feedback?.accepted, true); assert.equal(f.dropped(), undefined);
	f.release(60, 42);
	assert.ok(f.dropped()?.node === f.nodes[1]); assert.equal(f.dropped()?.placement, 'before');
	assert.deepEqual(f.counts(), { starts: 1, queries: 2, readings: 0 }); assert.equal(f.drag.feedback, undefined);
});

test('coalesced threshold crossing on physical release can complete one tree drop', t => {
	const f = fixture(t); f.press(); f.release(70, 50);
	assert.ok(f.dropped()?.node === f.nodes[1]); assert.equal(f.dropped()?.placement, 'inside');
	assert.equal(f.counts().starts, 1); assert.equal(f.capture.active, false);
});

test('rejected or out-of-tree release cannot reuse a previous accepted tree target', t => {
	const f = fixture(t); f.press(); f.move(70, 50); f.release(170, 50);
	assert.equal(f.dropped(), undefined);
	f.setAccepted(false); f.press(); f.move(70, 50);
	assert.equal(f.drag.feedback?.accepted, false); f.release(70, 50); assert.equal(f.dropped(), undefined);
});

test('source retirement cancels and drains a tree hold, without committing on its release', t => {
	const f = fixture(t); f.press(); f.move(70, 50); f.setCurrent(false); f.drag.advance(110);
	assert.equal(f.drag.feedback, undefined); assert.equal(f.capture.active, false); assert.equal(f.capture.draining, true);
	f.release(70, 50); assert.equal(f.dropped(), undefined); assert.equal(f.capture.draining, false);
});

test('retiring the real feedback owner cancels the tree gesture but not a sibling capture', t => {
	const f = fixture(t); f.press(); f.move(70, 50); f.owner.dispose();
	assert.equal(f.drag.feedback, undefined); assert.equal(f.capture.active, false); f.release(70, 50);
	let releases = 0;
	f.capture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() { releases++; }, cancelPointer() {} }, PointerButton.Primary, f.scope);
	f.drag.cancel(); assert.equal(f.capture.active, true);
	f.release(70, 50); assert.equal(releases, 1);
});

for (const admission of ['current', 'target'] as const) test(`tree ${admission} publication may retire its gesture reentrantly`, t => {
	const f = fixture(t);
	if (admission === 'target') f.onQuery(() => f.drag.cancel());
	f.press(); f.move(70, 50);
	if (admission === 'current') { f.onCurrent(() => f.drag.cancel()); f.drag.advance(110); }
	assert.equal(f.capture.active, false); assert.equal(f.drag.feedback, undefined); assert.equal(f.dropped(), undefined);
	f.release(70, 50); assert.equal(f.dropped(), undefined);
});

test('stable tree dragging retains feedback and does not repeat source target admission', t => {
	const f = fixture(t); f.press(); f.move(70, 50);
	const feedback = f.drag.feedback, marker = feedback!.marker;
	for (let frame = 0; frame < 100; frame++) f.drag.advance(100 + frame * 16);
	assert.ok(f.drag.feedback === feedback && feedback!.marker === marker);
	assert.deepEqual(f.counts(), { starts: 1, queries: 1, readings: 0 }); assert.equal(f.dropped(), undefined);
});

test('hover expansion uses host time and never submits an edit before drop', t => {
	const f = fixture(t), target = f.nodes[1], child = appendWorkbenchTreeNode(f.tree, target, 20);
	target.collapsed = true; rebuildWorkbenchTreeRows(f.tree, f.nodes[0]);
	f.press(); f.move(70, 50, 100); f.drag.advance(599);
	assert.equal(target.collapsed, true); f.drag.advance(600);
	assert.equal(target.collapsed, false); assert.equal(f.tree.rows.includes(child), true);
	assert.ok(f.tree.rows[f.tree.selectionIndex] === f.nodes[0]); assert.equal(f.dropped(), undefined); assert.equal(f.counts().readings, 1);
});

test('captured tree edge scrolling advances while stationary, but release does not add scrolling time', t => {
	const f = fixture(t, 30); f.press(); f.move(70, 99, 100);
	f.drag.advance(300); const scroll = f.tree.scroll;
	assert.ok(scroll > 0); assert.ok(f.counts().readings > 0);
	const target = f.drag.feedback!.target;
	f.release(70, 99, 800);
	assert.equal(f.tree.scroll, scroll); assert.ok(f.dropped()?.node === target);
});

test('a long pending hold does not count as edge-scroll time when dragging starts', t => {
	const f = fixture(t, 30); f.press(); f.move(70, 99, 10000); f.drag.advance(10000);
	assert.equal(f.tree.scroll, 0); f.drag.advance(10100); assert.ok(f.tree.scroll > 0);
});

test('after-sector geometry describes the whole expanded subtree, not insertion before its children', t => {
	const f = fixture(t), target = f.nodes[1]; appendWorkbenchTreeNode(f.tree, target, 20);
	rebuildWorkbenchTreeRows(f.tree, f.nodes[0]); f.press(); f.move(5, 58);
	// Geometry is the subject of this tree insertion-layout contract.
	assert.equal(f.drag.feedback?.placement, 'after');
	assert.equal(f.drag.feedback!.marker.top + 1, f.tree.layout.contentTop + f.tree.rows.indexOf(f.nodes[2]) * f.tree.layout.rowHeight);
	assert.equal(f.drag.feedback!.marker.left, f.tree.layout.contentLeft + target.depth * f.tree.layout.indentWidth);
});

test('promoted drag feedback and hit admission share the actual native ancestor clip', t => {
	const f = fixture(t);
	const ancestorClip = { left: 0, top: 45, right: 180, bottom: 70 };
	const ancestor = f.surfaces.attach({ role: 'content', captureScope: Symbol('ancestor'), isVisible: () => true,
		getBounds: () => f.area, getClip: () => ancestorClip, draw() {} });
	f.surfaces.reparent(f.owner, ancestor);
	f.press(); f.move(70, 50);
	assert.equal(f.drag.feedback?.accepted, true);
	// Exact intersections are the subject of this native clipping contract.
	assert.deepEqual(f.drag.feedback!.clip, { left: 0, top: 45, right: 160, bottom: 70 });
	f.move(70, 78); assert.equal(f.drag.feedback?.accepted, false); assert.equal(f.drag.feedback?.target, undefined);
	f.release(70, 78); assert.equal(f.dropped(), undefined);
	f.press(); f.move(70, 50); ancestorClip.bottom = 45;
	f.release(70, 50); assert.equal(f.dropped(), undefined);
});

test('captured tree scroll uses the exposed clip edge rather than a hidden content edge', t => {
	const f = fixture(t, 30); f.clip.bottom = 70;
	f.press(); f.move(70, 69, 100); f.drag.advance(300);
	assert.ok(f.tree.scroll > 0);
});

test('one-row trees retain both scroll directions without overlapping edge zones', t => {
	const f = fixture(t, 30); layoutWorkbenchList(f.tree.layout, 0, 0, 160, 20, 20);
	f.tree.scroll = 10; f.press(f.root); f.move(70, 19, 100); f.drag.advance(300);
	assert.ok(f.tree.scroll > 10);
	f.move(70, 1, 300); const previous = f.tree.scroll; f.drag.advance(500);
	assert.ok(f.tree.scroll < previous);
	assert.equal(dragScrollSpeed(10, 0, 20), 0);
	assert.equal(dragScrollSpeed(50, 0, 100), 0);
});

test('unchanged after-targets do not repeatedly traverse the expanded subtree', t => {
	const f = fixture(t), target = f.nodes[1], child = appendWorkbenchTreeNode(f.tree, target, 20);
	rebuildWorkbenchTreeRows(f.tree, f.nodes[0]);
	let visits = 0; const depth = child.depth;
	Object.defineProperty(child, 'depth', { get: () => { visits++; return depth; } });
	f.press(); f.move(5, 58, 100); assert.ok(visits > 0); visits = 0;
	for (let frame = 0; frame < 100; frame++) f.drag.advance(100 + frame * 16);
	assert.equal(visits, 0); assert.equal(f.drag.feedback?.placement, 'after');
});

test('a native window covering the captured tree blocks drops, scrolling and hover expansion', t => {
	const f = fixture(t, 30), target = f.nodes[1];
	appendWorkbenchTreeNode(f.tree, target, 20); target.collapsed = true; rebuildWorkbenchTreeRows(f.tree, f.nodes[0]);
	f.press(); f.move(70, 50, 100); assert.equal(f.drag.feedback?.accepted, true);
	const cover = f.surfaces.attach({ role: 'window', captureScope: Symbol('cover'), isVisible: () => true,
		getBounds: () => f.area, getClip: () => f.area, draw() {} });
	f.drag.advance(700);
	assert.equal(f.drag.feedback?.accepted, false); assert.equal(target.collapsed, true);
	f.move(70, 99, 700); f.drag.advance(900);
	assert.equal(f.tree.scroll, 0); f.release(70, 50); assert.equal(f.dropped(), undefined);
	cover.dispose();
});
