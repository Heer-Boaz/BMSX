import { PointerButton } from '../../ide/input/pointer/buttons';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { api } from '../../ide/runtime/overlay_api';
import { drawWorkbenchPropertyTree } from '../../ide/workbench/render/property_tree';
import { createWorkbenchPropertyTree, layoutWorkbenchPropertyTree, type WorkbenchPropertyElement } from '../../ide/workbench/ui/property_tree';
import { WorkbenchPropertyTreePointer, WorkbenchPropertyPointerResult as PointerResult } from '../../ide/workbench/ui/property_tree_pointer';
import { appendWorkbenchTreeNode, navigateWorkbenchTree, rebuildWorkbenchTreeRows, WorkbenchTreeNavigationResult as NavigationResult } from '../../ide/workbench/ui/tree_view';
import { scrollWorkbenchList, workbenchListRowIndexAtPosition } from '../../ide/workbench/ui/list_view';
import { createHostOverlayFixture } from '../helpers/host_overlay';

function fixture(count = 40) {
	const font = new Font({ variant: 'tiny' });
	let measurements = 0;
	const measure = (text: string, start: number, end: number) => { measurements += 1; return font.measure(text.slice(start, end)); };
	const state = createWorkbenchPropertyTree<WorkbenchPropertyElement>();
	const group = appendWorkbenchTreeNode(state, null, { kind: 'group', label: 'GROUP', value: '', description: 'A GROUP, NOT A PROPERTY.', warning: false, displayLabel: '', displayValue: '' });
	for (let index = 0; index < count; index += 1) appendWorkbenchTreeNode(state, group, {
		kind: 'property', label: `A LONG PROPERTY LABEL ${index}`, value: 'a_very_long_source_expression() * cadence() + another_long_source_call()',
		description: 'AUTHORED SOURCE. '.repeat(40), warning: index === 2, displayLabel: '', displayValue: '',
	});
	rebuildWorkbenchTreeRows(state, group);
	const layout = (right = 384) => layoutWorkbenchPropertyTree(state, font, measure, 4, 20, right - 4, 268);
	layout();
	return { state, font, group, layout, measurements: () => measurements };
}

test('property columns, footer and every hittable row share measured tiny-font geometry', () => {
	const { state, font, group, layout } = fixture();
	const bounds = state.layout;
	assert.equal(bounds.font, font);
	assert.equal(bounds.contentBottom, bounds.contentTop + bounds.visibleRowCount * bounds.rowHeight);
	assert.equal(workbenchListRowIndexAtPosition(state, 20, bounds.contentBottom), -1, 'footer never exposes an unpainted partial row');
	const property = group.children[0];
	assert.ok(font.measure(property.element.displayLabel) <= bounds.valueLeft - bounds.contentLeft - bounds.indentWidth - bounds.twistieWidth - 6);
	assert.ok(font.measure(property.element.displayValue) <= bounds.contentRight - bounds.valueLeft - 8);
	assert.ok(property.element.displayValue.endsWith('...'));
	assert.equal(navigateWorkbenchTree(state, 'right'), NavigationResult.Selection);
	layout();
	assert.equal(state.descriptionLines.length, 3);
	assert.ok(state.descriptionLines[2].endsWith('...'));
	for (const line of state.descriptionLines) assert.ok(font.measure(line) <= bounds.contentRight - bounds.contentLeft - 8);
	const previous = property.element.displayValue;
	layout(240);
	assert.ok(property.element.displayValue.length < previous.length);
});

test('property idle, scrolling, hover and fold reuse topology and text without font measurements', () => {
	const f = fixture();
	const rows = f.state.rows;
	const description = f.state.descriptionLines;
	const child = f.group.children[0];
	const measurements = f.measurements();
	for (let index = 0; index < 100; index += 1) {
		scrollWorkbenchList(f.state, index % 2 === 0 ? 1 : -1);
		f.state.hoverIndex = index % 3;
		f.layout();
	}
	assert.equal(navigateWorkbenchTree(f.state, 'left'), NavigationResult.Collapse);
	f.layout();
	assert.equal(navigateWorkbenchTree(f.state, 'right'), NavigationResult.Collapse);
	f.layout();
	assert.equal(f.measurements(), measurements, 'collapsing does not reconstruct or remeasure property rows');
	assert.equal(f.state.rows, rows);
	assert.equal(f.state.descriptionLines, description);
	assert.equal(f.group.children[0], child);
	navigateWorkbenchTree(f.state, 'end');
	assert.equal(f.state.scroll, f.state.rows.length - f.state.layout.visibleRowCount);
	f.layout();
	const afterSelection = f.measurements();
	assert.ok(afterSelection > measurements, 'only the new description is formatted');
	f.layout();
	assert.equal(f.measurements(), afterSelection);
});

test('property pointer isolates Source activation from folds, held presses, detach and source generations', () => {
	const f = fixture(2);
	const pointer = new WorkbenchPropertyTreePointer();
	const bounds = f.state.layout;
	const point = { valid: true, insideViewport: true, pressedButtons: PointerButton.Primary, justPressedButtons: 0, justReleasedButtons: 0, viewportX: bounds.valueLeft + 8, viewportY: bounds.contentTop + bounds.rowHeight + 3 };
	assert.equal(pointer.handle(f.state, point, true, 10), PointerResult.Selection);
	assert.equal(pointer.handle(f.state, point, false, 20), PointerResult.Handled);
	assert.equal(pointer.handle(f.state, point, true, 30), PointerResult.Activate);
	assert.equal(pointer.handle(f.state, point, true, 40), PointerResult.Selection, 'third click starts a new sequence');
	pointer.cancel();
	assert.equal(pointer.handle(f.state, point, true, 50), PointerResult.Selection, 'reattachment is not a second click');
	const replacement = fixture(2);
	assert.equal(pointer.handle(replacement.state, point, true, 60), PointerResult.Selection, 'equal labels in a new generation cannot inherit a gesture');
	point.viewportY = bounds.contentTop + 3;
	assert.equal(pointer.handle(f.state, point, true, 70), PointerResult.Selection);
	assert.equal(pointer.handle(f.state, point, true, 80), PointerResult.Collapse, 'group double-click folds, never navigates to invented source');
	assert.equal(f.state.rows.length, 1);
	point.viewportX = bounds.contentLeft + 3;
	assert.equal(pointer.handle(f.state, point, true, 90), PointerResult.Collapse, 'a twistie toggles on its own press');
	assert.equal(f.state.rows.length, 3);
	point.viewportY = bounds.contentBottom + 4;
	assert.equal(pointer.handle(f.state, point, true, 100), PointerResult.Handled);
	assert.equal(f.state.hoverIndex, -1);
	point.viewportX = bounds.contentRight;
	assert.equal(pointer.handle(f.state, point, true, 110), PointerResult.Outside);
	point.viewportX = bounds.valueLeft + 8;
	point.viewportY = bounds.contentTop + bounds.rowHeight + 3;
	assert.equal(pointer.handle(f.state, point, true, 120), PointerResult.Selection);
	point.viewportY = bounds.contentBottom + 4;
	pointer.handle(f.state, point, true, 130);
	point.viewportY = bounds.contentTop + bounds.rowHeight + 3;
	assert.equal(pointer.handle(f.state, point, true, 140), PointerResult.Selection, 'an intervening blank click breaks the sequence');
	point.valid = false;
	pointer.handle(f.state, point, false, 150);
	point.valid = true;
	assert.equal(pointer.handle(f.state, point, true, 160), PointerResult.Selection, 'losing the pointer breaks the sequence');
});

test('property renderer clips list and footer separately and retains actual overlay/quad storage', () => {
	const f = fixture();
	navigateWorkbenchTree(f.state, 'right'); f.layout();
	const { presenter, renderer, queue } = createHostOverlayFixture(384, 288);
	const stream = new HostOverlayQuadStream();
	const draw = () => {
		renderer.beginFrame(presenter); api.beginFrame(renderer);
		drawWorkbenchPropertyTree(f.state); renderer.endFrame();
		const frame = queue.consumeOverlayFrame(); stream.reset(384, 288);
		for (let index = 0; index < frame.commandCount; index += 1) stream.appendEntry(frame.commandKinds[index], frame.commandRefs[index]);
		return frame;
	};
	const first = draw();
	const clips = first.commandRefs.slice(0, first.commandCount).filter((_entry, index) => first.commandKinds[index] === Host2DKind.Clip);
	assert.equal(clips.length, 4, 'list clip, reset, description clip, reset');
	assert.deepEqual(clips[0], { left: 4, top: 20, right: 380, bottom: f.state.layout.contentBottom });
	assert.deepEqual(clips[2], { left: 4, top: f.state.layout.contentBottom + 1, right: 380, bottom: 268 });
	const quads = stream.floatData;
	const measurements = f.measurements();
	for (let index = 0; index < 100; index += 1) draw();
	assert.equal(stream.floatData, quads);
	assert.equal(f.measurements(), measurements);
});
