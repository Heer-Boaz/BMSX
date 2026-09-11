import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, type StudioFixture } from './studio_fixture';
import { testStudioGraphZoom } from './studio_graph_zoom';

/** Same physical navigation on BT and FSM, in the actual Studio host/focus/input composition. */
export async function testStudioGraphNavigation(test: StudioFixture): Promise<void> {
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || (lens.view.presentation.kind !== 'graph' && lens.view.presentation.kind !== 'state-graph')) throw new Error('navigation probe requires a real behavior diagram');
	const view = lens.view.presentation.viewport;
	const sourceSelection = lens.view.selection;
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
	const startX = selected.bounds.left + view.bounds.left - x + 8;
	const startY = selected.bounds.top + view.bounds.top - y + 6;
	for (const button of ['pointer_aux', 'pointer_primary'] as const) {
		movePointer(point(startX, startY)); await frame();
		if (button === 'pointer_primary') setKey('Space', true);
		setPointerButton(button, true); await frame();
		movePointer(point(startX + 17, startY + 13)); await frame();
		check(view.scrollX === x - 17 && view.scrollY === y - 13, 'graph navigation: middle/Space-primary drag pans over a card');
		if (button === 'pointer_aux') {
			setPointerButton('pointer_primary', true); await frame();
			setPointerButton('pointer_primary', false); await frame();
		} else setKey('Space', false);
		movePointer(point(startX + 21, startY + 15)); await frame();
		check(view.scrollX === x - 21 && view.scrollY === y - 15, 'graph navigation: other release or modifier change cannot end/reinterpret the latched pan');
		setPointerButton(button, false); await frame();
		movePointer(point(startX + 31, startY + 25)); await frame();
		check(view.scrollX === x - 21 && view.scrollY === y - 15, 'graph navigation: initiating release ends capture');
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
	for (const bar of [view.horizontalScrollbar, view.verticalScrollbar]) {
		const thumb = bar.getThumb()!;
		const track = bar.getTrack();
		movePointer(thumb); await frame();
		setPointerButton('pointer_primary', true); await frame();
		movePointer(bar.orientation === 'horizontal' ? point(track.right - 1, track.top + 1) : point(track.left + 1, track.bottom - 1)); await frame();
		setPointerButton('pointer_primary', false); await frame();
		check(bar.getScroll() > 0 && (bar.orientation === 'horizontal' ? view.scrollX !== x : view.scrollY !== y), 'graph navigation: physical scrollbar drag moves its axis');
		view.scrollX = x; view.scrollY = y;
	}
	movePointer(point(startX, startY)); await frame();
	setKey('ShiftLeft', true);
	test.input.inputAxis1('pointer:0', 'pointer_wheel', 120, test.clock.now()); await frame();
	setKey('ShiftLeft', false); await frame();
	check(view.scrollX !== x && view.scrollY === y, 'graph navigation: Shift-wheel pans horizontally');
	view.scrollX = x; view.scrollY = y;
	check(view.selection === selected && lens.view.selection === sourceSelection, 'graph navigation: all pan routes preserve exact source selection');
	check(view.model === model && lens.workingCopy.version === version && lens.workingCopy.dirty === dirty
		&& lens.workingCopy.canUndo === undo && lens.workingCopy.canRedo === redo, 'graph navigation: no geometry rebuild, dirtying or source history');
	await frame();
	console.info(`STUDIO: ${lens.view.presentation.kind} scrollbar/pan navigation passed`);
	await testStudioGraphZoom(test);
}
