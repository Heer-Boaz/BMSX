import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { create_rect_bounds, point_in_rect, write_rect_bounds } from '../../machine/ts/common/rect';
import type { CartEditor } from '../../ide/cart_editor';
import { PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN, RESOURCE_PANEL_DIVIDER_DRAG_MARGIN } from '../../ide/common/constants';
import type { PointerSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { ProblemsPanelController } from '../../ide/workbench/contrib/problems/panel/controller';
import { createProblemsPanelLayout, writeProblemsPanelLayout } from '../../ide/workbench/contrib/problems/panel/layout';
import { ResourcePanelController } from '../../ide/workbench/contrib/resources/panel/controller';
import { createResourcePanelLayout, writeResourcePanelLayout } from '../../ide/workbench/contrib/resources/panel/layout';
import { Scrollbar } from '../../ide/workbench/ui/scrollbar';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';

const pointer = (x: number, y: number): PointerSnapshot => ({
	viewportX: x, viewportY: y, valid: true, insideViewport: true,
	pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0,
});

// Exact bounds and half-open edges are this layout-owned resize-hit contract.
test('Resource layout publishes one retained divider strip, updates it with its bounds and empties it without presentation', () => {
	const bounds = create_rect_bounds(), layout = createResourcePanelLayout(bounds), strip = layout.resizeBounds;
	write_rect_bounds(bounds, 10, 20, 150, 220);
	writeResourcePanelLayout(layout, 20, 200, 8);
	assert.deepEqual(strip, { left: 150 - RESOURCE_PANEL_DIVIDER_DRAG_MARGIN, top: 20,
		right: 150 + RESOURCE_PANEL_DIVIDER_DRAG_MARGIN, bottom: 220 });
	assert.equal(point_in_rect(strip.left, strip.top, strip), true);
	assert.equal(point_in_rect(strip.right, strip.top, strip), false);
	assert.equal(point_in_rect(strip.left, strip.bottom, strip), false);
	write_rect_bounds(bounds, 10, 30, 180, 230);
	writeResourcePanelLayout(layout, 20, 200, 8);
	assert.ok(layout.resizeBounds === strip);
	assert.equal(strip.left, 180 - RESOURCE_PANEL_DIVIDER_DRAG_MARGIN);
	write_rect_bounds(bounds, 0, 0, 0, 0);
	writeResourcePanelLayout(layout, 20, 200, 8);
	assert.equal(strip.left, strip.right); assert.equal(strip.top, strip.bottom);
});

test('Problems layout publishes a retained top divider strip with exclusive right and bottom edges', () => {
	configureFontVariant('tiny');
	const layout = createProblemsPanelLayout(), strip = layout.resizeBounds;
	writeProblemsPanelLayout({ left: 12, top: 180, right: 380, bottom: 274 }, layout);
	assert.deepEqual(strip, { left: 12, top: 180 - PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN,
		right: 380, bottom: 180 + PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN });
	assert.equal(point_in_rect(strip.left, strip.top, strip), true);
	assert.equal(point_in_rect(strip.right, strip.top, strip), false);
	assert.equal(point_in_rect(strip.left, strip.bottom, strip), false);
	writeProblemsPanelLayout({ left: 12, top: 150, right: 380, bottom: 274 }, layout);
	assert.ok(layout.resizeBounds === strip);
	assert.equal(strip.top, 150 - PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN);
	writeProblemsPanelLayout({ left: 12, top: 150, right: 12, bottom: 274 }, layout);
	assert.equal(strip.left, strip.right); assert.equal(strip.top, strip.bottom);
});

test('Resource resize retains its extent while hiding retires only its own captured gesture and strip', t => {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288; refreshWorkbenchLayout();
	const group = createTestEditorGroup(), editor = { editorGroup: group, isActive: true } as CartEditor;
	const panel = new ResourcePanelController(editor, createScenarioTestSourceState([]).catalog,
		{ resourceVertical: new Scrollbar('vertical'), resourceHorizontal: new Scrollbar('horizontal') }, 0.35);
	const sibling = new ProblemsPanelController();
	t.after(() => { panel.hide(); sibling.hide(); group.dispose(); inputFocus.setTarget(null); pointerCapture.cancel(); });
	panel.show();
	const strip = panel.resizeBounds, right = panel.getBounds().right;
	panel.beginResize(pointer(right, strip.top));
	assert.equal(pointerCapture.active, true);
	panel.handleCapturedPointer(pointer(right + 20, strip.top));
	const resized = panel.getBounds().right;
	assert.ok(resized > right);
	panel.hide();
	assert.equal(pointerCapture.active, false);
	assert.equal(strip.left, strip.right);
	panel.show();
	assert.ok(panel.resizeBounds === strip);
	assert.equal(panel.getBounds().right, resized);
	sibling.show(); sibling.prepareLayout({ left: 0, top: 140, right: 384, bottom: 274 });
	sibling.beginResize(pointer(100, 140));
	panel.hide();
	assert.equal(pointerCapture.active, true, 'another controller retains its own resize gesture');
	sibling.hide();
	assert.equal(pointerCapture.active, false);
});

test('Problems resize consumes its actual published height and preserves requested extent across hide/show', t => {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288; refreshWorkbenchLayout();
	const panel = new ProblemsPanelController(), sibling = new ProblemsPanelController();
	t.after(() => { panel.hide(); sibling.hide(); pointerCapture.cancel(); inputFocus.setTarget(null); });
	panel.show(); panel.prepareLayout({ left: 0, top: 140, right: 384, bottom: 274 });
	const strip = panel.resizeBounds;
	panel.beginResize(pointer(100, 140));
	panel.handleCapturedPointer(pointer(100, 130));
	assert.equal(panel.visibleHeight, 144, '134 presented pixels plus a 10-pixel upward drag');
	panel.hide();
	assert.equal(pointerCapture.active, false);
	assert.equal(strip.top, strip.bottom);
	panel.show(); panel.prepareLayout({ left: 0, top: 130, right: 384, bottom: 274 });
	assert.ok(panel.resizeBounds === strip);
	assert.equal(panel.visibleHeight, 144);
	sibling.show(); sibling.prepareLayout({ left: 0, top: 140, right: 384, bottom: 274 });
	sibling.beginResize(pointer(100, 140));
	panel.hide();
	assert.equal(pointerCapture.active, true, 'hiding another panel cannot cancel this gesture');
	sibling.hide();
	assert.equal(pointerCapture.active, false);
});
