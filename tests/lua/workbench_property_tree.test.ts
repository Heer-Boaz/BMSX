import { PointerHoverService } from '../../ide/input/pointer/hover';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { InputFocusService } from '../../ide/input/focus';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { WORKBENCH_ICON_SIZE } from '../../ide/workbench/ui/icon';
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

function fixture(count = 40, groupDescription = 'A GROUP, NOT A PROPERTY.', property: Partial<WorkbenchPropertyElement> = {}) {
	const font = new Font({ variant: 'tiny' });
	let measurements = 0;
	const measure = (text: string, start: number, end: number) => { measurements += 1; return font.measure(text.slice(start, end)); };
	const state = createWorkbenchPropertyTree<WorkbenchPropertyElement>();
	const group = appendWorkbenchTreeNode(state, null, { kind: 'group', label: 'GROUP', value: '', description: groupDescription, warning: false, displayLabel: '', displayValue: '', displayValueLeft: 0 });
	for (let index = 0; index < count; index += 1) appendWorkbenchTreeNode(state, group, {
		kind: 'property', label: `A LONG PROPERTY LABEL ${index}`, value: 'a_very_long_source_expression() * cadence() + another_long_source_call()',
		description: 'AUTHORED SOURCE. '.repeat(40), warning: index === 2, displayLabel: '', displayValue: '', displayValueLeft: 0, ...property,
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
	assert.ok(property.element.displayValue.endsWith('…'));
	assert.equal(navigateWorkbenchTree(state, 'right'), NavigationResult.Selection);
	layout();
	assert.equal(state.descriptionLines.length, 3);
	assert.ok(state.descriptionLines[2].endsWith('…'));
	for (const line of state.descriptionLines) assert.ok(font.measure(line) <= bounds.contentRight - bounds.contentLeft - 8);
	const previous = property.element.displayValue;
	layout(240);
	assert.ok(property.element.displayValue.length < previous.length);
});

test('unlabelled property values use the full indented row without a blank name column', () => {
	const f = fixture(0), { state, group, layout, font } = f;
	const value = "'a.requirement.with.a.long.and.meaningful.authored.name'";
	const child = appendWorkbenchTreeNode(state, group, { kind: 'property', label: '', value, description: 'A VALUE, NOT A NUMBERED PROPERTY NAME.',
		warning: false, displayLabel: '', displayValue: '', displayValueLeft: 0 });
	rebuildWorkbenchTreeRows(state, child); state.textDirty = true; layout();
	assert.equal(child.element.displayValueLeft, state.layout.contentLeft + state.layout.indentWidth + state.layout.twistieWidth + 2);
	assert.equal(child.element.displayValue, value);
	assert.ok(font.measure(value) > state.layout.contentRight - state.layout.valueLeft - 8, 'the previous fixed value column would truncate it');
	const measured = f.measurements(); layout(); assert.equal(f.measurements(), measured);
	layout(240); assert.ok(font.measure(child.element.displayValue) <= state.layout.contentRight - child.element.displayValueLeft - 4);
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
	const pointer = new WorkbenchPropertyTreePointer(new PointerHoverService());
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


test('property tree hover is routed, releases replaced generations and ends at detach', () => {
	const hover = new PointerHoverService(), pointer = new WorkbenchPropertyTreePointer(hover);
	const first = fixture(2), second = fixture(2), bounds = first.state.layout;
	const point = { valid: true, insideViewport: true, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0,
		viewportX: bounds.valueLeft + 8, viewportY: bounds.contentTop + bounds.rowHeight + 3 };
	hover.beginDispatch(); pointer.handle(first.state, point, false, 0); hover.endDispatch();
	assert.equal(first.state.hoverIndex, 1);
	hover.beginDispatch(); pointer.handle(second.state, point, false, 20); hover.endDispatch();
	assert.equal(first.state.hoverIndex, -1); assert.equal(second.state.hoverIndex, 1);
	const selection = second.state.selectionIndex;
	hover.beginDispatch(); hover.endDispatch();
	assert.equal(second.state.hoverIndex, -1); assert.equal(second.state.selectionIndex, selection);
	hover.beginDispatch(); pointer.handle(second.state, point, false, 40); hover.endDispatch();
	pointer.clear(); hover.clear();
	assert.equal(second.state.hoverIndex, -1);
});

test('lazy tree owners advertise expansion before reading children, with separate label/value columns', () => {
	const { state, group, font, layout } = fixture(0);
	group.expandable = true; group.collapsed = true;
	const ownerValue = { ...group.element, label: 'A VERY LONG FAILURE LOCATION WITH A VALUE', value: 'AVAILABLE' };
	const node = appendWorkbenchTreeNode(state, null, ownerValue, true);
	node.expandable = true;
	rebuildWorkbenchTreeRows(state, node); state.textDirty = true; layout(240);
	assert.ok(font.measure(node.element.displayLabel) <= node.element.displayValueLeft - state.layout.contentLeft - state.layout.twistieWidth - 10);
	assert.equal(navigateWorkbenchTree(state, 'right'), NavigationResult.Collapse);
	assert.equal(node.collapsed, false); assert.equal(node.children.length, 0, 'tree control never invokes a data loader');
	appendWorkbenchTreeNode(state, node, { ...group.element, kind: 'property', label: 'loaded by owner' });
	rebuildWorkbenchTreeRows(state, node);
	assert.equal(navigateWorkbenchTree(state, 'right'), NavigationResult.Selection);
	assert.equal(state.rows[state.selectionIndex].parent, node);
});


test('deep property names and values partition the remaining row in both real fonts at narrow widths', () => {
	for (const variant of ['tiny', 'msx'] as const) {
		const state = createWorkbenchPropertyTree<WorkbenchPropertyElement>(), font = new Font({ variant });
		let parent = null;
		for (let depth = 0; depth < 8; depth++) {
			parent = appendWorkbenchTreeNode(state, parent, { kind: 'property', label: 'audio_id', value: 'music_story', description: '', warning: false,
				displayLabel: '', displayValue: '', displayValueLeft: 0 });
		}
		rebuildWorkbenchTreeRows(state, parent);
		layoutWorkbenchPropertyTree(state, font, (s, a, b) => font.measure(s.slice(a, b)), 4, 20, 196, 268);
		assert.ok(state.layout.twistieWidth >= WORKBENCH_ICON_SIZE + 4);
		assert.ok(state.layout.rowHeight >= WORKBENCH_ICON_SIZE + 4);
		for (const node of state.rows) {
			const labelLeft = state.layout.contentLeft + node.depth * state.layout.indentWidth + state.layout.twistieWidth + 2;
			assert.ok(node.element.displayLabel.length > 1, `${variant} depth ${node.depth} keeps an actual name, not an empty column`);
			assert.ok(node.element.displayValue.length > 1);
			assert.ok(font.measure(node.element.displayLabel) <= node.element.displayValueLeft - labelLeft - 8);
			assert.ok(font.measure(node.element.displayValue) <= state.layout.contentRight - node.element.displayValueLeft - 4);
		}
		assert.ok(state.layout.bottom - state.layout.contentBottom < state.layout.rowHeight, 'empty descriptions do not reserve three blank footer lines');
	}
});

test('description footer reservation stays stable when a collapsed group contains the only descriptions', () => {
	const f = fixture(1, '');
	const child = f.group.children[0]; child.collapsed = false;
	f.group.collapsed = true; rebuildWorkbenchTreeRows(f.state, f.group); f.state.textDirty = true; f.layout();
	const bottom = f.state.layout.contentBottom;
	navigateWorkbenchTree(f.state, 'right'); navigateWorkbenchTree(f.state, 'right'); f.layout();
	assert.equal(f.state.layout.contentBottom, bottom); assert.equal(f.state.descriptionLines.length, 3);
	assert.equal(f.state.descriptionClipped, true);
});

function feedbackFixture(t: TestContext, property: Partial<WorkbenchPropertyElement> = {}) {
	const f = fixture(40, undefined, { label: 'music_transition', value: 'music_story', description: 'res/data/events.aem.yaml:6', ...property }), surfaces = new WorkbenchSurfaceService(), focus = new InputFocusService();
	const parent = focus.createTarget(), target = focus.createTarget(parent);
	parent.bindKeyboard(() => {}); target.bindKeyboard(() => {}); parent.focus();
	const hover = new PointerHoverService(), pointer = new WorkbenchPropertyTreePointer(hover);
	const area = { left: 0, top: 0, right: 384, bottom: 288 };
	const owner = surfaces.attach({ role: 'content', captureScope: Symbol('property tree'), isVisible: () => true,
		getBounds: () => area, getClip: () => area, draw: () => drawWorkbenchPropertyTree(f.state) });
	pointer.attachFeedback(surfaces, owner, area, target);
	const child = f.group.children[0];
	f.state.textDirty = true; f.layout(200); pointer.updateFeedback(f.state);
	const texts: string[] = []; t.mock.method(api, 'blit_text_inline_with_font', text => texts.push(text));
	const overlay = createHostOverlayFixture(384, 288);
	const paint = () => { texts.length = 0; overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); surfaces.draw(api); overlay.renderer.endFrame(); };
	const point = { valid: true, insideViewport: true, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0,
		viewportX: f.state.layout.contentLeft + 20, viewportY: f.state.layout.contentTop + f.state.layout.rowHeight + 3 };
	const move = (delta = 0) => { point.viewportX += delta; hover.beginDispatch(); pointer.handle(f.state, point, false, 0); hover.endDispatch(); };
	t.after(() => { pointer.dispose(); surfaces.dispose(); });
	return { ...f, surfaces, owner, area, parent, target, pointer, child, texts, paint, point, move };
}

test('clipped property names and values expose full cached passive hover and keyboard feedback', t => {
	const f = feedbackFixture(t);
	assert.notEqual(f.child.element.displayLabel, f.child.element.label);
	f.paint(); assert.equal(f.texts.includes(f.child.element.label), false);
	f.move(); f.paint();
	assert.ok(f.texts.includes(f.child.element.label)); assert.ok(f.texts.includes(f.child.element.value)); assert.ok(f.texts.includes(f.child.element.description));
	assert.equal(f.surfaces.hitTest(f.point.viewportX, f.point.viewportY), f.owner, 'passive feedback never intercepts source/edit gestures');
	const measurements = f.measurements();
	for (let n = 0; n < 1000; n++) { f.layout(200); f.pointer.updateFeedback(f.state); }
	assert.equal(f.measurements(), measurements, 'full-text feedback retains strings and measured wrapping across clean frames');
	f.state.selectionIndex = 1; f.target.focus(); f.pointer.keyboardSelection(f.state); f.paint();
	assert.ok(f.texts.includes(f.child.element.label));
	f.parent.focus(); f.paint(); assert.equal(f.texts.includes(f.child.element.label), false);
	f.target.focus(); f.paint(); assert.ok(f.texts.includes(f.child.element.label));
	f.pointer.hideFeedback(); f.paint(); assert.equal(f.texts.includes(f.child.element.label), false, 'opening source edit or context UI retires feedback');
});

test('description-only clipping exposes complete retained annotation without changing list/source activation', t => {
	const description = 'z'.repeat(150), f = feedbackFixture(t, { label: 'ID', value: '7', description });
	f.state.selectionIndex = 1; f.layout(200);
	assert.equal(f.child.element.displayLabel, 'ID'); assert.equal(f.child.element.displayValue, '7'); assert.equal(f.state.descriptionClipped, true);
	f.target.focus(); f.pointer.keyboardSelection(f.state); f.paint();
	assert.ok(f.texts.join('').includes(description), 'the description is reachable even though its name/value need no truncation');
	assert.equal(f.pointer.handle(f.state, f.point, true, 100), PointerResult.Selection);
	assert.equal(f.pointer.handle(f.state, f.point, true, 110), PointerResult.Activate, 'feedback does not replace double-click edit/source activation');
});

test('property full-text feedback retires on scroll, projection replacement, clear, modal and surface lifetime', t => {
	const f = feedbackFixture(t);
	f.move(); f.paint(); assert.ok(f.texts.includes(f.child.element.label));
	scrollWorkbenchList(f.state, 1); f.pointer.updateFeedback(f.state); f.paint(); assert.equal(f.texts.includes(f.child.element.label), false);
	scrollWorkbenchList(f.state, -1); f.pointer.updateFeedback(f.state); f.move(); f.paint(); assert.equal(f.texts.includes(f.child.element.label), false, 'stationary pointer cannot rebind after scroll');
	f.move(1); f.paint(); assert.ok(f.texts.includes(f.child.element.label));
	const old = f.child, replacement = { ...old, element: { ...old.element, label: 'other_music_transition' } };
	f.group.children[0] = replacement; rebuildWorkbenchTreeRows(f.state, f.group); f.state.textDirty = true; f.layout(200); f.pointer.updateFeedback(f.state); f.paint();
	assert.equal(f.texts.includes(old.element.label), false); assert.equal(f.texts.includes(replacement.element.label), false, 'new source projection cannot inherit an existing hover');
	f.move(1); f.paint(); assert.ok(f.texts.includes(replacement.element.label));
	const modal = f.surfaces.attach({ role: 'modal', blockedScope: null, captureScope: Symbol('modal'), getBounds: () => f.area, getClip: () => f.area, isVisible: () => true, draw() {} });
	f.paint(); assert.equal(f.texts.includes(replacement.element.label), false); modal.dispose();
	f.pointer.clear(); f.paint(); assert.equal(f.texts.includes(replacement.element.label), false);
	const retained = f.pointer as unknown as { feedbackNode: unknown; tree: unknown; feedbackText: string };
	assert.equal(retained.feedbackNode, undefined); assert.equal(retained.tree, undefined); assert.equal(retained.feedbackText, '', 'input retirement does not retain authored AST/source element bindings');
	f.move(1); f.paint(); assert.ok(f.texts.includes(replacement.element.label));
	f.owner.dispose(); f.paint(); assert.equal(f.texts.includes(replacement.element.label), false);
});
