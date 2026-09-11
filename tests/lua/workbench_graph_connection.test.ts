import { PointerHoverService } from '../../ide/input/pointer/hover';
import { PointerButton } from '../../ide/input/pointer/buttons';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import type { PointerSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult as Result } from '../../ide/workbench/ui/graph/control';
import { WorkbenchGraphConnectionPreview, hitWorkbenchGraphConnectionHandle } from '../../ide/workbench/ui/graph/connection';
import { createWorkbenchGraphEdge } from '../../ide/workbench/ui/graph/model';
import { writeWorkbenchGraphArrow } from '../../ide/workbench/ui/graph/geometry';
import { graphConnectionFixture } from '../helpers/graph_connection_fixture';

const font = new Font({ variant: 'tiny' });
function fixture() {
	const f = graphConnectionFixture(font);
	const focus = new InputFocusService();
	const capture = new PointerCaptureService();
	const control = new WorkbenchGraphControl(focus, capture, new PointerHoverService());
	f.view.selection = f.edge;
	control.setInput(f.view, f.interaction);
	const pointer = (x: number, y: number, pressed = true): PointerSnapshot => ({ valid: true, insideViewport: true, pressedButtons: pressed ? PointerButton.Primary : 0, justPressedButtons: 0, justReleasedButtons: 0,
		viewportX: f.view.graphToViewportX(x), viewportY: f.view.graphToViewportY(y) });
	const press = (end: 'source' | 'target', now = 0) => {
		const i = end === 'source' ? 0 : f.edge.points.length - 2;
		return control.handlePointer({ ...pointer(f.edge.points[i], f.edge.points[i + 1]), justPressedButtons: PointerButton.Primary }, now);
	};
	return { ...f, focus, capture, control, pointer, press };
}

test('selected endpoint grips win over node headers and coincident parallel routes; press identity is latched', () => {
	for (const end of ['source', 'target'] as const) {
		const f = fixture();
		assert.equal(f.press(end), Result.Selection);
		assert.equal(f.view.selection, f.edge);
		assert.equal(f.interaction.starts.length, 0);
		f.capture.dispatch(f.pointer(248, 146), false, 20);
		assert.deepEqual(f.interaction.starts, [{ kind: 'connection', edge: f.edge, end }]);
		assert.equal(f.interaction.feedback!.target, f.target);
		assert.equal(f.interaction.drops.length, 0);
		f.control.dispose();
	}
});

test('scaled connection grips keep screen-pixel hit size and retarget to the inverse-transformed card', () => {
	for (const zoom of [0.5, 1.2, 2]) {
		const f = fixture();
		f.view.setZoom(zoom);
		f.view.reveal(f.oldTarget);
		const x = f.edge.points[f.edge.points.length - 2], y = f.edge.points[f.edge.points.length - 1];
		assert.equal(hitWorkbenchGraphConnectionHandle({ edge: f.edge, ends: 'both' }, x + 4.9 / zoom, y, zoom), 'target');
		assert.equal(hitWorkbenchGraphConnectionHandle({ edge: f.edge, ends: 'both' }, x + 5.1 / zoom, y, zoom), undefined);
		assert.equal(f.press('target'), Result.Selection);
		f.view.reveal(f.target);
		f.capture.dispatch(f.pointer(248, 146), false, 20);
		assert.equal(f.interaction.feedback!.target, f.target);
		f.capture.dispatch({ ...f.pointer(248, 146, false), justReleasedButtons: PointerButton.Primary }, false, 40);
		assert.equal(f.interaction.drops.length, 1);
		assert.equal(f.interaction.drops[0].target, f.target);
		f.control.dispose();
	}
});

test('endpoint clicks never activate Source; ordinary label double-clicks still do', () => {
	const f = fixture();
	for (let click = 0; click < 3; click += 1) {
		assert.equal(f.press('target', click * 40), Result.Selection);
		f.capture.dispatch({ ...f.pointer(242, 55, false), justReleasedButtons: PointerButton.Primary }, false, click * 40 + 20);
	}
	assert.equal(f.interaction.starts.length, 0);
	const position = f.pointer(126, 54);
	assert.equal(f.control.handlePointer({ ...position, justPressedButtons: PointerButton.Primary }, 150), Result.Selection);
	f.capture.dispatch({ ...position, pressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 170);
	assert.equal(f.control.handlePointer({ ...position, justPressedButtons: PointerButton.Primary }, 190), Result.Activate);
	assert.equal(f.interaction.starts.length, 0);
	f.control.dispose();
});

test('handle capability changes invalidate stationary hits and revoke pending and active gestures', () => {
	for (const active of [false, true]) {
		for (const change of ['none', 'other-end', 'current'] as const) {
			const f = fixture();
			f.press('target');
			if (active) f.capture.dispatch(f.pointer(248, 146), false, 20);
			if (change === 'none') f.interaction.ends = undefined;
			else if (change === 'other-end') f.interaction.ends = 'source';
			else f.interaction.current = false;
			f.control.update();
			assert.equal(f.control.dragFeedback, undefined);
			assert.equal(f.capture.dispatch({ ...f.pointer(248, 146, false), justReleasedButtons: PointerButton.Primary }, false, 40), false);
			assert.equal(f.interaction.drops.length, 0);
			f.interaction.current = true; f.interaction.ends = 'both'; f.control.update();
			assert.equal(f.capture.dispatch(f.pointer(248, 146), false, 60), false, 'restoring capability cannot restore capture');
			f.control.dispose();
		}
	}
	const f = fixture();
	const position = f.pointer(242, 55);
	f.control.handlePointer({ ...position, justPressedButtons: 0 }, 0);
	assert.equal(f.control.hover, f.edge);
	f.interaction.ends = 'source';
	f.control.handlePointer({ ...position, justPressedButtons: 0 }, 20);
	assert.equal(f.control.hover, f.oldTarget, 'disabled endpoint is once again a normal node hit');
	f.interaction.ends = 'target';
	f.control.handlePointer({ ...position, justPressedButtons: 0 }, 40);
	assert.equal(f.control.hover, f.edge);
	f.control.dispose();
});

test('source, selection, layout, focus, pane and input interruptions cancel without adopting a new target', () => {
	for (const active of [false, true]) {
		for (const reason of ['model', 'selection', 'blur', 'detach', 'blocked', 'viewport', 'lost-release'] as const) {
			const f = fixture();
			f.press('target');
			if (active) f.capture.dispatch(f.pointer(248, 146), false, 20);
			const position = f.pointer(248, 146);
			switch (reason) {
				case 'model': f.view.setModel({ ...f.model }, f.edge); break;
				case 'selection': f.view.selection = f.parallel; break;
				case 'blur': f.focus.setTarget(null); break;
				case 'detach': f.control.clearInput(); f.control.setInput(f.view, f.interaction); break;
				case 'blocked': f.capture.dispatch(position, true, 40); break;
				case 'viewport': f.capture.dispatch({ ...position, insideViewport: false }, false, 40); break;
				case 'lost-release': f.capture.dispatch({ ...position, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 }, false, 40); break;
			}
			f.control.update();
			assert.equal(f.control.dragFeedback, undefined);
			assert.equal(f.capture.dispatch({ ...position, pressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 60), false);
			assert.equal(f.interaction.drops.length, 0);
			assert.equal(f.interaction.starts.length, active ? 1 : 0);
			f.control.dispose();
		}
	}
});

test('valid node snaps, invalid node/space stays free; preview buffers and immutable geometry survive stationary polling', () => {
	const f = fixture();
	const geometry = JSON.stringify(f.model);
	f.press('target');
	f.capture.dispatch(f.pointer(248, 146), false, 20);
	const feedback = f.interaction.feedback!;
	const points = feedback.points; const arrow = feedback.arrow; const handles = f.control.connectionHandles;
	assert.equal(feedback.accepted, true);
	assert.equal(feedback.points[0], f.edge.points[0]);
	assert.equal(feedback.points[1], f.edge.points[1]);
	assert.equal(feedback.points[3], f.target.bounds.top, 'snap clips to the header boundary, not its text center');
	for (let index = 0; index < 100; index += 1) f.capture.dispatch(f.pointer(248, 146), false, 40 + index * 20);
	assert.equal(f.interaction.overs, 1);
	assert.equal(f.control.connectionHandles, handles);
	f.capture.dispatch(f.pointer(146, 100), false, 2060);
	assert.equal(feedback.accepted, false);
	assert.deepEqual(points.slice(2), [146, 100]);
	f.capture.dispatch(f.pointer(380, 116), false, 2080);
	assert.equal(feedback.target, undefined);
	assert.deepEqual(points.slice(2), [380, 116], 'outside the graph tracks the pointer, never an old snap');
	assert.equal(f.interaction.overs, 2, 'outside the graph performs no contribution hit work');
	assert.equal(feedback.points, points); assert.equal(feedback.arrow, arrow);
	assert.equal(JSON.stringify(f.model), geometry);
	f.control.dispose();
});

test('physical release recomputes the target, detaches first and commits exactly once, including coalesced motion', () => {
	for (const coalesced of [false, true]) {
		const f = fixture();
		f.press('source');
		if (!coalesced) f.capture.dispatch(f.pointer(248, 52), false, 20);
		f.interaction.onDrop = () => {
			assert.equal(f.control.dragFeedback, undefined);
			assert.equal(f.capture.dispatch(f.pointer(200, 100), false, 60), false);
			f.view.setModel({ ...f.model }, null);
		};
		f.capture.dispatch({ ...f.pointer(248, 146, false), justReleasedButtons: PointerButton.Primary }, false, 40);
		assert.equal(f.interaction.drops.length, 1);
		assert.equal(f.interaction.drops[0].target, f.target);
		assert.equal(f.interaction.drops[0].start.end, 'source');
		f.capture.dispatch({ ...f.pointer(248, 146, false), justReleasedButtons: PointerButton.Primary }, false, 60);
		assert.equal(f.interaction.drops.length, 1);
		f.control.dispose();
	}
});

test('releasing over an invalid node, blank canvas or outside graph cannot commit a prior admitted node', () => {
	for (const [x, y] of [[146, 100], [180, 190], [380, 116]]) {
		const f = fixture();
		f.press('target');
		f.capture.dispatch(f.pointer(248, 146), false, 20);
		assert.equal(f.interaction.feedback!.accepted, true);
		f.capture.dispatch({ ...f.pointer(x, y, false), justReleasedButtons: PointerButton.Primary }, false, 40);
		assert.equal(f.interaction.drops.length, 0);
		assert.equal(f.control.dragFeedback, undefined);
		f.control.dispose();
	}
});

test('wheel and host-time edge scrolling refresh canvas position without changing the fixed endpoint or start', () => {
	const f = fixture();
	f.press('source');
	const position = f.pointer(180, 160);
	f.capture.dispatch(position, false, 20);
	const feedback = f.interaction.feedback!;
	f.control.handleWheel(position, 14, 6);
	assert.deepEqual(feedback.points, [194, 166, 242, 55]);
	assert.equal(f.interaction.starts.length, 1);
	assert.equal(f.interaction.overs, 2);
	f.control.dispose();
	for (const fps of [50, 60, 120]) {
		const f = fixture();
		f.press('target');
		const margin = { ...f.pointer(0, 160), viewportX: f.view.bounds.right - 1 };
		f.capture.dispatch(margin, false, 20);
		for (let frame = 1; frame <= fps; frame += 1) f.capture.dispatch(margin, false, 20 + frame * 1000 / fps);
		assert.ok(Math.abs(f.view.scrollX - 110) < 1e-9);
		assert.equal(f.interaction.starts.length, 1);
		assert.deepEqual(f.interaction.feedback!.points.slice(0, 2), f.edge.points.slice(0, 2));
		f.control.dispose();
	}
});

test('shared arrow writer preserves route direction and handles degenerate/repeated terminals without losing directedness', () => {
	const arrow: number[] = [];
	assert.equal(writeWorkbenchGraphArrow([10, 10, 30, 10, 30, 10], arrow), true);
	assert.deepEqual(arrow, [26, 6, 30, 10, 26, 14]);
	assert.equal(writeWorkbenchGraphArrow([10, 10, 10, 10], arrow), false);
	assert.equal(arrow.length, 6, 'directionless motion must not shrink and regrow the buffer');
	const edge = createWorkbenchGraphEdge([10, 10, 10, 10], [], true);
	assert.equal(edge.directed, true); assert.deepEqual(edge.arrow, []);
	const preview = new WorkbenchGraphConnectionPreview(edge, 'target');
	const retained = preview.arrow;
	assert.equal(preview.hasArrow, false);
	preview.moveTo(30, 10);
	assert.equal(preview.hasArrow, true);
	assert.deepEqual(preview.arrow, [26, 6, 30, 10, 26, 14]);
	preview.moveTo(10, 10); assert.equal(preview.hasArrow, false);
	preview.moveTo(10, 30); assert.deepEqual(preview.arrow, [14, 26, 10, 30, 6, 26]);
	assert.equal(preview.arrow, retained); assert.equal(preview.arrow.length, 6);
	const undirected = new WorkbenchGraphConnectionPreview(createWorkbenchGraphEdge([10, 10, 10, 10]), 'source');
	undirected.moveTo(30, 10); assert.equal(undirected.hasArrow, false);
	assert.equal(hitWorkbenchGraphConnectionHandle({ edge, ends: 'both' }, 10, 10, 1), 'target');
	assert.equal(hitWorkbenchGraphConnectionHandle({ edge, ends: 'source' }, 10, 10, 1), 'source');
});

test('header snapping is constant-time in all directions and center-coincident/self connections are not forbidden', () => {
	const { target } = graphConnectionFixture(font);
	const centerX = (target.bounds.left + target.bounds.right) / 2;
	const centerY = target.bounds.top + target.headerHeight / 2;
	for (const [dx, dy] of [[-100, 0], [100, 0], [0, -100], [0, 100], [0, 0]]) {
		for (const end of ['source', 'target'] as const) {
			const edge = createWorkbenchGraphEdge([centerX + dx, centerY + dy, centerX + dx, centerY + dy], [], true);
			const preview = new WorkbenchGraphConnectionPreview(edge, end);
			preview.target = target; preview.moveTo(0, 0);
			const moving = end === 'source' ? 0 : 2;
			assert.deepEqual(preview.points.slice(moving, moving + 2), [centerX + Math.sign(dx) * (target.bounds.right - centerX),
				centerY + Math.sign(dy) * target.headerHeight / 2]);
			assert.equal(preview.accepted, true);
		}
	}
	const fractionalTarget = { ...target, bounds: { left: 140.25, top: 50.75, right: 181.75, bottom: 100 }, headerHeight: 13.5 };
	const fractional = new WorkbenchGraphConnectionPreview(createWorkbenchGraphEdge([161, 57.5, 200, 80], [], true), 'target');
	fractional.target = fractionalTarget; fractional.moveTo(140, 60);
	assert.deepEqual(fractional.points, [161, 57.5, 161, 57.5]);
	assert.equal(fractional.hasArrow, false, 'fractional center coincidence is not an invented half-pixel arrow');
	fractional.target = undefined; fractional.moveTo(170.25, 63.75);
	assert.deepEqual(fractional.points, [161, 57.5, 170.25, 63.75]);
});
