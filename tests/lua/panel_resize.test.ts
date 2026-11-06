import { SceneSourceDocuments } from '../../ide/workbench/contrib/scene_editor/source_documents';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { create_rect_bounds, point_in_rect, write_rect_bounds } from '../../machine/ts/common/rect';
import type { CartEditor } from '../../ide/cart_editor';
import { RESOURCE_PANEL_DIVIDER_DRAG_MARGIN } from '../../ide/common/constants';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { ResourcePanelController } from '../../ide/workbench/contrib/resources/panel/controller';
import { ProjectContentIndex } from '../../ide/workbench/contrib/resources/content_index';
import { BehaviorRegistrationIndex } from '../../ide/workbench/contrib/behavior_lens/registration_index';
import { createResourcePanelLayout, writeResourcePanelBounds, writeResourcePanelLayout } from '../../ide/workbench/contrib/resources/panel/layout';
import { WorkbenchSplitControl } from '../../ide/workbench/ui/split_control';
import { WorkbenchFixedEdgeSplitView, WorkbenchSplitView } from '../../ide/workbench/ui/split_view';
import { pointerHover } from '../../ide/input/pointer/hover';
import { Scrollbar } from '../../ide/workbench/ui/scrollbar';
import { createTestEditorParts } from '../helpers/editor_panes';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';

const pointer = (x: number, y: number): PointerInputSnapshot => ({
	viewportX: x, viewportY: y, valid: true, insideViewport: true,
	pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0,
	modifiers: KeyModifier.none, spaceDown: false,
});

function fixture(t: TestContext) {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288; refreshWorkbenchLayout();
	const parts = createTestEditorParts(t), editor = { editorParts: parts, isActive: true } as CartEditor;
	const sources = createScenarioTestSourceState([]);
	const content = new ProjectContentIndex(editorTextModelService, sources.catalog, new BehaviorRegistrationIndex(editorTextModelService, sources.catalog), new SceneSourceDocuments(editorTextModelService, sources.catalog));
	const panel = new ResourcePanelController(editor, sources.catalog,
		{ resourceVertical: new Scrollbar('vertical'), resourceHorizontal: new Scrollbar('horizontal') }, content, new VirtualHeadlessClock());
	t.after(() => { panel.dispose(); content.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); pointerHover.clear(); });
	panel.setFontMetrics(editorViewState.font); panel.show();
	return { panel, parts };
}

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

// Fixed side-region extent is this layout's contract; editor area absorbs desktop growth.
test('Files default and minimum widths stay compact across desktop growth; manual width survives resizing', () => {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288; refreshWorkbenchLayout();
	const bounds = create_rect_bounds(), split = new WorkbenchFixedEdgeSplitView('start');
	writeResourcePanelBounds(bounds, split);
	assert.ok(bounds.right <= 384 / 4);
	editorViewState.viewportWidth = 768; refreshWorkbenchLayout();
	writeResourcePanelBounds(bounds, split);
	const preferred = bounds.right, minimum = split.minimumFirstSize;
	editorViewState.viewportWidth = 1536; refreshWorkbenchLayout();
	writeResourcePanelBounds(bounds, split);
	assert.equal(bounds.right, preferred); assert.equal(split.minimumFirstSize, minimum);
	split.moveTo(preferred + 40);
	const requested = split.requestedSize, revision = split.revision;
	for (const width of [768, 128, 1536]) {
		editorViewState.viewportWidth = width; refreshWorkbenchLayout(); writeResourcePanelBounds(bounds, split);
		assert.equal(split.requestedSize, requested); assert.equal(split.revision, revision);
		assert.ok(bounds.right >= split.minimumFirstSize && bounds.right <= width - split.minimumSecondSize);
	}
	assert.equal(bounds.right, preferred + 40);
	split.moveTo(-100);
	writeResourcePanelBounds(bounds, split);
	assert.equal(bounds.right, split.minimumFirstSize);
	split.moveTo(2000);
	writeResourcePanelBounds(bounds, split);
	assert.equal(bounds.right, 1536 - split.minimumSecondSize);
	split.reset(); writeResourcePanelBounds(bounds, split);
	assert.equal(bounds.right, preferred); assert.equal(split.requestedSize, undefined);
});

test('Files resize retains its extent while hiding retires only its own captured gesture and strip', t => {
	const { panel, parts } = fixture(t);
	const sibling = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, parts.main.focusTarget);
	const split = new WorkbenchSplitView(0.5, 'vertical');
	split.layout(0, 40, 384, 240); sibling.setInput(split);
	t.after(() => sibling.dispose());
	const strip = panel.resizeBounds, right = panel.getBounds().right;
	panel.sash.handlePointer(pointer(right, strip.top));
	assert.equal(pointerCapture.active, true);
	pointerCapture.dispatch({ ...pointer(right + 20, strip.top), justPressedButtons: 0 }, false, 1);
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

test('Files pointer resizing preserves the active control and its unsubmitted draft', t => {
	const { panel, parts } = fixture(t);
	const field = inputFocus.createTarget(parts.main.focusTarget, parts.main.scope);
	let commits = 0, blurs = 0;
	const draft = { pending: true, commit: () => { commits++; return false; }, cancel() { this.pending = false; } };
	field.edit = draft;
	t.after(field.onDidBlur(() => { blurs++; }));
	field.focus();
	const original = panel.split.position, strip = panel.resizeBounds;
	const press = pointer(panel.split.position + 2, strip.top);
	assert.equal(panel.sash.handlePointer(press), true);
	assert.ok(inputFocus.target === field); assert.equal(pointerCapture.active, true);
	pointerCapture.dispatch({ ...press, viewportX: press.viewportX + 24, justPressedButtons: 0 }, false, 1);
	assert.ok(panel.split.position > original); assert.ok(inputFocus.target === field);
	pointerCapture.dispatch({ ...press, viewportX: press.viewportX + 32, pressedButtons: 0,
		justPressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 2);
	assert.equal(pointerCapture.active, false); assert.ok(inputFocus.target === field);
	assert.equal(field.edit.pending, true); assert.equal(commits, 0); assert.equal(blurs, 0);
});

test('Files resize attachment drains its retired hold and rebinds on the next visible layout', t => {
	const { panel } = fixture(t), scope = panel.sash.focusTarget.scope.surfaceScope;
	const press = pointer(panel.split.position, panel.resizeBounds.top);
	pointerCapture.beginRoute(scope, press); panel.sash.handlePointer(press);
	const width = panel.split.position;
	panel.retireResize();
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	assert.equal(panel.sash.focusTarget.canFocus(), false);
	panel.prepareLayout();
	// Reattachment restores the pointer model, not a retired keyboard session's focus lease.
	assert.ok(panel.sash.input === panel.split);
	pointerCapture.dispatch({ ...press, viewportX: press.viewportX + 32, justPressedButtons: 0 }, false, 1, scope);
	assert.equal(panel.split.position, width);
	pointerCapture.dispatch({ ...press, pressedButtons: 0, justPressedButtons: 0,
		justReleasedButtons: PointerButton.Primary }, false, 2, scope);
	assert.equal(pointerCapture.draining, false);
	pointerCapture.beginRoute(scope, press); assert.equal(panel.sash.handlePointer(press), true);
	assert.equal(pointerCapture.active, true);
	pointerCapture.dispatch({ ...press, viewportX: press.viewportX + 32, pressedButtons: 0,
		justPressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 3, scope);
	assert.ok(panel.split.position > width); assert.equal(pointerCapture.active, false);
});

test('Files direct resize and reset use the retained split without activating Files', t => {
	const { panel, parts } = fixture(t);
	parts.main.focusTarget.focus();
	const original = panel.split.position, target = inputFocus.target;
	panel.split.moveTo(panel.split.position + 24);
	assert.ok(panel.split.position > original); assert.ok(inputFocus.target === target);
	panel.split.reset();
	assert.equal(panel.split.position, original); assert.ok(inputFocus.target === target);
});
