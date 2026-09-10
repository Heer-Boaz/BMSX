import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerButton } from '../../ide/input/pointer/buttons';
import type { PointerSnapshot } from '../../ide/common/models';
import { createWorkbenchGraphEdge, createWorkbenchGraphLabel, createWorkbenchGraphModel, createWorkbenchGraphNode } from '../../ide/workbench/ui/graph/model';
import { WorkbenchGraphViewport } from '../../ide/workbench/ui/graph/viewport';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult } from '../../ide/workbench/ui/graph/control';

const font = new Font({ variant: 'tiny' });
function fixture() {
	const node = createWorkbenchGraphNode(font, 'VISIBLE', 40, 40);
	const other = createWorkbenchGraphNode(font, 'DISTANT', 1100, 900);
	const label = createWorkbenchGraphLabel(font, 'NEGATIVE ROUTE');
	label.bounds.left = -300; label.bounds.right = -210;
	label.bounds.top = -180; label.bounds.bottom = -170;
	const edge = createWorkbenchGraphEdge([60, 64, 80, 64, 80, 80], [label]);
	const model = createWorkbenchGraphModel(font, [node, other], [edge]);
	const view = new WorkbenchGraphViewport(model);
	view.layout(10, 20, 210, 180);
	view.selection = node;
	const focus = new InputFocusService();
	const capture = new PointerCaptureService();
	const control = new WorkbenchGraphControl(focus, capture);
	control.setInput(view, { connectionEnds: () => 'both', begin: () => assert.fail('viewport navigation cannot begin a source edit') });
	const pointer: PointerSnapshot = { valid: true, insideViewport: true, viewportX: 55, viewportY: 64,
		pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 };
	return { node, other, edge, model, view, focus, capture, control, pointer };
}

test('publication bounds include origin, negative labels, routes and nodes; all viewport movement is bounded and synchronized', () => {
	const { model, view, other, control } = fixture();
	assert.deepEqual(model.bounds, { left: -300, top: -180, right: other.bounds.right, bottom: other.bounds.bottom });
	assert.deepEqual(view.bounds, { left: 10, top: 20, right: 207, bottom: 177 });
	assert.deepEqual(view.scrollBounds, { left: -497, top: -337, right: other.bounds.right, bottom: other.bounds.bottom });
	view.pan(-10000, -10000);
	assert.equal(view.scrollX, view.scrollBounds.left);
	assert.equal(view.scrollY, view.scrollBounds.top);
	assert.equal(view.horizontalScrollbar.getScroll(), view.scrollBounds.left);
	view.pan(100000, 100000);
	assert.equal(view.scrollX, view.scrollBounds.right);
	assert.equal(view.scrollY, view.scrollBounds.bottom);
	view.reveal(other);
	assert.ok(view.intersects(other.bounds, 0));
	assert.equal(view.scrollX, view.horizontalScrollbar.getScroll());
	const thumb = view.horizontalScrollbar.getThumb();
	const geometry = JSON.stringify(model);
	for (let index = 0; index < 100; index += 1) {
		view.layout(10, 20, 210, 180);
		view.pan(-1, -1);
	}
	assert.equal(view.horizontalScrollbar.getThumb(), thumb);
	assert.equal(view.model, model);
	assert.equal(JSON.stringify(model), geometry);
	view.layout(0, 0, 80, 70);
	assert.equal(view.scrollBounds.left, model.bounds.left - 77);
	assert.equal(view.horizontalScrollbar.getTrack().right, view.verticalScrollbar.getTrack().left);
	control.dispose();
});

test('middle and Space-primary pan over cards and connection handles, preserving selection and source capability', () => {
	for (const button of [PointerButton.Primary, PointerButton.Auxiliary]) {
		for (const subject of ['node', 'edge'] as const) {
			const f = fixture();
			const selected = subject === 'node' ? f.node : f.edge;
			f.view.selection = selected;
			if (subject === 'edge') { f.pointer.viewportX = 70; f.pointer.viewportY = 84; }
			f.pointer.pressedButtons = f.pointer.justPressedButtons = button;
			assert.equal(f.control.handlePointer(f.pointer, 0, button === PointerButton.Primary), WorkbenchGraphPointerResult.Handled);
			assert.equal(f.focus.target, f.control.focusTarget);
			f.pointer.justPressedButtons = 0;
			f.pointer.viewportX += 28; f.pointer.viewportY += 19;
			f.capture.dispatch(f.pointer, false, 20);
			assert.deepEqual([f.view.scrollX, f.view.scrollY], [-28, -19]);
			assert.equal(f.view.selection, selected);
			assert.equal(f.control.dragFeedback, undefined);
			f.pointer.pressedButtons = 0; f.pointer.justReleasedButtons = button;
			f.capture.dispatch(f.pointer, false, 40);
			f.pointer.viewportX += 20;
			assert.equal(f.capture.dispatch(f.pointer, false, 60), false);
			assert.equal(f.view.scrollX, -28);
			f.control.dispose();
		}
	}
});

test('secondary input cannot pan; middle capture ignores primary release and does not survive focus or geometry replacement', () => {
	for (const interrupt of ['blur', 'model', 'modal', 'lost'] as const) {
		const f = fixture();
		f.pointer.pressedButtons = f.pointer.justPressedButtons = PointerButton.Secondary;
		f.control.handlePointer(f.pointer, 0);
		assert.equal(f.capture.dispatch(f.pointer, false, 1), false);
		assert.equal(f.view.selection, f.node);
		f.pointer.pressedButtons = f.pointer.justPressedButtons = PointerButton.Auxiliary;
		f.control.handlePointer(f.pointer, 2);
		f.pointer.viewportX += 10;
		f.pointer.justPressedButtons = 0; f.pointer.justReleasedButtons = PointerButton.Primary;
		f.capture.dispatch(f.pointer, false, 3);
		assert.equal(f.view.scrollX, -10);
		if (interrupt === 'blur') f.focus.setTarget(null);
		if (interrupt === 'model') f.view.setModel({ ...f.model }, f.node);
		if (interrupt === 'lost') f.pointer.pressedButtons = 0;
		f.pointer.viewportX += 20;
		f.capture.dispatch(f.pointer, interrupt === 'modal', 4);
		assert.equal(f.view.scrollX, -10);
		f.pointer.pressedButtons = 0; f.pointer.justReleasedButtons = PointerButton.Auxiliary;
		assert.equal(f.capture.dispatch(f.pointer, false, 5), false);
		f.control.dispose();
	}
});

test('both scrollbars capture independently of node hits, reach both ends and release outside the graph', () => {
	for (const axis of ['horizontal', 'vertical'] as const) {
		const f = fixture();
		const bar = axis === 'horizontal' ? f.view.horizontalScrollbar : f.view.verticalScrollbar;
		const track = bar.getTrack();
		const thumb = bar.getThumb()!;
		f.pointer.viewportX = (thumb.left + thumb.right) / 2;
		f.pointer.viewportY = (thumb.top + thumb.bottom) / 2;
		f.pointer.pressedButtons = f.pointer.justPressedButtons = PointerButton.Primary;
		assert.equal(f.view.hitTest(f.pointer.viewportX, f.pointer.viewportY), null, 'gutter is outside the graph clip/hit rectangle');
		f.control.handlePointer(f.pointer, 0);
		assert.equal(f.view.selection, f.node);
		f.pointer.justPressedButtons = 0;
		if (axis === 'horizontal') f.pointer.viewportX = track.right + 20;
		else f.pointer.viewportY = track.bottom + 20;
		f.capture.dispatch(f.pointer, false, 20);
		assert.equal(axis === 'horizontal' ? f.view.scrollX : f.view.scrollY,
			axis === 'horizontal' ? f.view.scrollBounds.right : f.view.scrollBounds.bottom);
		if (axis === 'horizontal') f.pointer.viewportX = track.left - 20;
		else f.pointer.viewportY = track.top - 20;
		f.pointer.pressedButtons = 0; f.pointer.justReleasedButtons = PointerButton.Primary;
		f.capture.dispatch(f.pointer, false, 40);
		assert.equal(bar.getScroll(), axis === 'horizontal' ? f.view.scrollBounds.left : f.view.scrollBounds.top,
			'release coordinates finish the thumb drag in actual graph coordinates, without a source drop');
		assert.equal(f.view.selection, f.node);
		f.control.dispose();
	}
});

test('scrollbar track clicks and wheel use the same position; resize removing thumb cancels capture', () => {
	const f = fixture();
	const track = f.view.horizontalScrollbar.getTrack();
	f.pointer.viewportX = track.right - 1; f.pointer.viewportY = track.top + 1;
	f.pointer.pressedButtons = f.pointer.justPressedButtons = PointerButton.Primary;
	f.control.handlePointer(f.pointer, 0);
	assert.ok(f.view.scrollX > 0);
	f.control.handleWheel(f.pointer, -40, 20);
	assert.equal(f.view.scrollX, f.view.horizontalScrollbar.getScroll());
	assert.equal(f.capture.dispatch(f.pointer, false, 20), false, 'wheel ends a thumb gesture');
	f.control.handlePointer(f.pointer, 40);
	f.view.layout(0, 0, 5, 5);
	f.capture.dispatch(f.pointer, false, 60);
	assert.equal(f.capture.dispatch(f.pointer, false, 80), false, 'ungrabbable track cannot retain capture');
	f.control.dispose();
});
