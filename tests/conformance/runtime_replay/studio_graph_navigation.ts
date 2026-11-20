import { check, type StudioFixture } from './studio_fixture';
import { testStudioGraphZoom } from './studio_graph_zoom';
import { inputFocus } from '../../../ide/input/focus';
import { pointerCapture } from '../../../ide/input/pointer/capture';
import { editorFeedbackState } from '../../../ide/common/feedback_state';
import type { WorkbenchGraphEdge } from '../../../ide/workbench/ui/graph/model';
import type { WorkbenchGraphViewport } from '../../../ide/workbench/ui/graph/viewport';

/** Select a hit on the published route, not an offset from an assumed arrow direction. */
export function graphEdgePoint(view: WorkbenchGraphViewport, edge: WorkbenchGraphEdge) {
	const points = edge.points;
	for (let i = 0; i + 3 < points.length; i += 2) {
		for (const fraction of [0.5, 0.25, 0.75]) {
			const x = Math.round(view.graphToViewportX(points[i] + (points[i + 2] - points[i]) * fraction));
			const y = Math.round(view.graphToViewportY(points[i + 1] + (points[i + 3] - points[i + 1]) * fraction));
			if (view.hitTest(x, y) === edge) return { left: x, top: y, right: x + 1, bottom: y + 1 };
		}
	}
	throw new Error('The visible graph has no pointer target on the selected connection');
}

/** Same physical navigation on BT and FSM, in the actual Studio host/focus/input composition. */
export async function testStudioGraphNavigation(test: StudioFixture): Promise<void> {
	await test.until(() => !editorFeedbackState.message.visible, 'graph navigation: finish layout changes from prior feedback');
	const lens = test.ide.editor.editorParts.activeGroup.model.activeTab;
	if (lens.kind !== 'behavior_lens' || (lens.view.presentation.kind !== 'graph' && lens.view.presentation.kind !== 'state-graph')) throw new Error('navigation probe requires a real behavior diagram');
	const view = lens.view.presentation.viewport;
	const sourceSelection = lens.view.selectionState.selected;
	const selected = view.selection;
	if (selected?.kind !== 'node') throw new Error('navigation probe starts on a visible selected card');
	const model = view.model;
	const version = lens.workingCopy.version;
	const dirty = lens.workingCopy.dirty;
	const undo = lens.workingCopy.canUndo;
	const redo = lens.workingCopy.canRedo;
	const x = view.scrollX;
	const y = view.scrollY;
	const { movePointer, setPointerButton, setKey, frame, press } = test;
	const point = (x: number, y: number) => ({ left: x, right: x, top: y, bottom: y });
	const startX = view.graphToViewportX((selected.bounds.left + selected.bounds.right) / 2);
	const startY = view.graphToViewportY(selected.bounds.top + selected.headerHeight / 2);
	for (const button of ['pointer_aux', 'pointer_primary'] as const) {
		const start = movePointer(point(startX, startY)); await frame();
		check(view.hitTest(start.viewportX, start.viewportY) === selected, 'graph navigation: pan starts on the actual selected card');
		if (button === 'pointer_primary') setKey('Space', true);
		setPointerButton(button, true); await frame();
		check(pointerCapture.active, 'graph navigation: middle/Space-primary owns the captured gesture');
		const first = movePointer(point(startX + 17, startY + 13)); await frame();
		check(view.scrollX === x - (first.viewportX - start.viewportX) && view.scrollY === y - (first.viewportY - start.viewportY),
			'graph navigation: middle/Space-primary drag pans over a card');
		if (button === 'pointer_aux') {
			setPointerButton('pointer_primary', true); await frame();
			setPointerButton('pointer_primary', false); await frame();
		} else setKey('Space', false);
		const last = movePointer(point(startX + 21, startY + 15)); await frame();
		const endX = x - (last.viewportX - start.viewportX), endY = y - (last.viewportY - start.viewportY);
		check(view.scrollX === endX && view.scrollY === endY, 'graph navigation: other release or modifier change cannot end/reinterpret the latched pan');
		setPointerButton(button, false); await frame();
		movePointer(point(startX + 31, startY + 25)); await frame();
		check(view.scrollX === endX && view.scrollY === endY, 'graph navigation: initiating release ends capture');
		view.scrollX = x; view.scrollY = y;
	}
	// Blur to palette cancels capture, but typing Space belongs to its actual field.
	movePointer(point(startX, startY)); await frame();
	setPointerButton('pointer_aux', true); await frame();
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	await press('Space');
	check(test.ide.editor.quickInput.field.text === ' ', 'graph navigation: palette owns Space');
	await press('Escape');
	movePointer(point(startX + 20, startY + 20)); await frame();
	check(view.scrollX === x && view.scrollY === y, 'graph navigation: palette blur cancels middle capture');
	setPointerButton('pointer_aux', false); await frame();
	await press('Tab');
	const scrollbarFocus = inputFocus.target;
	for (const bar of [view.horizontalScrollbar, view.verticalScrollbar]) {
		const thumb = bar.getThumb()!;
		const track = bar.getTrack();
		movePointer(thumb); await frame();
		setPointerButton('pointer_primary', true); await frame();
		movePointer(bar.orientation === 'horizontal' ? point(track.right - 1, track.top + 1) : point(track.left + 1, track.bottom - 1)); await frame();
		setPointerButton('pointer_primary', false); await frame();
		check(bar.getScroll() > 0 && (bar.orientation === 'horizontal' ? view.scrollX !== x : view.scrollY !== y), 'graph navigation: physical scrollbar drag moves its axis');
		check(inputFocus.target === scrollbarFocus, 'graph navigation: scrollbar preserves action-bar keyboard focus');
		view.scrollX = x; view.scrollY = y;
	}
	await press('ShiftLeft', 'Tab');
	movePointer(point(startX, startY)); await frame();
	setKey('ShiftLeft', true);
	test.remote.apply([{ type: 'wheel', deltaY: 3 }]); await frame();
	setKey('ShiftLeft', false); await frame();
	check(view.scrollX !== x && view.scrollY === y, 'graph navigation: Shift-wheel pans horizontally');
	view.scrollX = x; view.scrollY = y;
	check(view.selection === selected && lens.view.selectionState.selected === sourceSelection, 'graph navigation: all pan routes preserve exact source selection');
	check(view.model === model && lens.workingCopy.version === version && lens.workingCopy.dirty === dirty
		&& lens.workingCopy.canUndo === undo && lens.workingCopy.canRedo === redo, 'graph navigation: no geometry rebuild, dirtying or source history');
	await frame();
	console.info(`STUDIO: ${lens.view.presentation.kind} scrollbar/pan navigation passed`);
	await testStudioGraphZoom(test);
}
