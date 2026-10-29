import { SceneSourceDocuments } from '../../ide/workbench/contrib/scene_editor/source_documents';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { create_rect_bounds, point_in_rect, write_rect_bounds } from '../../machine/ts/common/rect';
import type { CartEditor } from '../../ide/cart_editor';
import { RESOURCE_PANEL_DIVIDER_DRAG_MARGIN } from '../../ide/common/constants';
import type { PointerSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { ResourcePanelController } from '../../ide/workbench/contrib/resources/panel/controller';
import { ProjectContentIndex } from '../../ide/workbench/contrib/resources/panel/content_index';
import { BehaviorRegistrationIndex } from '../../ide/workbench/contrib/behavior_lens/registration_index';
import { createResourcePanelLayout, writeResourcePanelLayout } from '../../ide/workbench/contrib/resources/panel/layout';
import { WorkbenchSplitControl } from '../../ide/workbench/ui/split_control';
import { WorkbenchSplitView } from '../../ide/workbench/ui/split_view';
import { pointerHover } from '../../ide/input/pointer/hover';
import { Scrollbar } from '../../ide/workbench/ui/scrollbar';
import { createTestEditorParts } from '../helpers/editor_panes';
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

test('Resource resize retains its extent while hiding retires only its own captured gesture and strip', t => {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288; refreshWorkbenchLayout();
	const parts = createTestEditorParts(t), editor = { editorParts: parts, isActive: true } as CartEditor;
	const sources = createScenarioTestSourceState([]);
	const panel = new ResourcePanelController(editor, sources.catalog,
		{ resourceVertical: new Scrollbar('vertical'), resourceHorizontal: new Scrollbar('horizontal') }, 0.35,
		new ProjectContentIndex(editorTextModelService, sources.catalog, new BehaviorRegistrationIndex(editorTextModelService, sources.catalog), new SceneSourceDocuments(editorTextModelService, sources.catalog)));
	const sibling = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, parts.main.focusTarget);
	const split = new WorkbenchSplitView(0.5, 'vertical');
	split.layout(0, 40, 384, 240); sibling.setInput(split);
	t.after(() => { panel.dispose(); sibling.dispose(); inputFocus.setTarget(null); pointerCapture.cancel(); });
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
	parts.main.focusTarget.focus(); sibling.handlePointer(pointer(100, split.position));
	panel.hide();
	assert.equal(pointerCapture.active, true, 'another controller retains its own resize gesture');
	sibling.clearInput();
	assert.equal(pointerCapture.active, false);
});
