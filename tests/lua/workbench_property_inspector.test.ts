import { KeyInputEvent } from '../../hosts/common/input/text';
import type { PointerSnapshot } from '../../ide/common/models';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { WorkbenchPropertyInspector } from '../../ide/workbench/ui/property_inspector/control';
import { WorkbenchPropertyInspectorModel, compactPropertyRowHeight, INSPECTOR_PADDING, type InspectedProperty } from '../../ide/workbench/ui/property_inspector/model';
import { drawWorkbenchPropertyInspector } from '../../ide/workbench/render/property_inspector';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import * as colors from '../../ide/common/constants';

function fixture(t: TestContext) {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const parent = focus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	const inspector = new WorkbenchPropertyInspector<InspectedProperty>(focus, capture, hover, parent);
	const font = new Font({ variant: 'tiny' });
	let measured = 0, opened = -1, disposed = 0;
	const measure = (s: string, a: number, b: number) => { measured += 1; return font.measure(s.slice(a, b)); };
	const bounds = { left: 0, top: 24, right: 384, bottom: 240 };
	const items = [
		{ label: 'HANDLER', value: Array.from({ length: 70 }, (_, n) => `line_${n}(owner)`).join('\n'), description: 'source.lua:7:2\nA COMPLETE CALLBACK', warning: false },
		{ label: 'TIMING', value: 'base_cadence * frame_count * cooldown_multiplier + extra_gameplay_delay', description: 'AUTHORED EXPRESSION; NOT EVALUATED.', warning: false },
		{ label: 'UNRESOLVED', value: '', description: 'NO AUTHORED TARGET IS PROVEN.', warning: true },
	];
	const show = () => inspector.show({ title: 'SOURCE DETAILS', items, canOpenSource: item => item !== items[2], openSource(item) {
		assert.equal(inspector.visible, false); assert.equal(focus.target, parent); opened = items.indexOf(item);
	} }).add({ dispose() { disposed += 1; } });
	const layout = () => inspector.layout(font, measure, text => font.measure(text), bounds);
	const clock = new VirtualHeadlessClock(), input = new Input(clock, new HeadlessInputHub(), -1);
	input.connectInputDevice({ id: 'gamepad:0', kind: 'gamepad', gamepadIndex: 0, label: 'INSPECTOR PAD',
		vibrationInitialization: null, supportsVibration: false, setVibration() {} });
	let pressId = 0;
	const key = (code: string, down: boolean) => {
		input.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now(), ++pressId);
		clock.advance(20); input.pollInput(); focus.handleKeyboard(new KeyInputEvent(code, input.getPlayerInput(1).modifiers, false, down));
	};
	const press = (code: string) => { key(code, true); key(code, false); };
	const pad = (code: string, down: boolean) => {
		input.inputButton('gamepad:0', code, down, down ? 1 : 0, clock.now() + 1, ++pressId);
		clock.advance(20); input.pollInput(); focus.handleGamepad(input.getPlayerInput(1));
	};
	show(); layout();
	t.after(() => inspector.dispose());
	return { inspector, focus, parent, capture, hover, items, font, bounds, show, layout, key, press, pad,
		measured: () => measured, opened: () => opened, disposed: () => disposed };
}

test('property descriptions use neutral UI ink in paragraph, inline and expanded rows without changing value semantics', t => {
	const previousTheme = colors.getActiveIdeThemeVariant(), f = fixture(t);
	t.after(() => colors.setIdeThemeVariant(previousTheme));
	const overlay = createHostOverlayFixture(384, 288), glyphs = new Map<string, number>();
	t.mock.method(api, 'blit_text_inline_with_font', (text, _x, _y, _z, color) => { glyphs.set(text, color); });
	for (const theme of ['dark', 'light']) for (const variant of ['tiny', 'msx'] as const) {
		colors.setIdeThemeVariant(theme);
		const font = new Font({ variant });
		const measure = (text: string, start: number, end: number) => font.measure(text.slice(start, end));
		const measureText = (text: string) => font.measure(text);
		for (const mode of ['paragraph', 'inline', 'expanded'] as const) for (const selected of [false, true])
			for (const severity of ['normal', 'warning', 'changed'] as const) {
				const item: InspectedProperty = { label: 'Label', value: 'Value', description: 'Explanation', warning: severity === 'warning',
					valueChanged: severity === 'changed', compact: mode !== 'paragraph', descriptionDisplay: mode === 'expanded' ? 'disclosure' : 'inline' };
				f.inspector.show({ title: 'Properties', items: [item], dismissible: false, canOpenSource: () => false, openSource() {} }, false);
				f.inspector.layout(font, measure, measureText, f.bounds);
				if (mode === 'expanded') {
					assert.equal(f.inspector.model.setValueExpanded(0, true), true);
					f.inspector.layout(font, measure, measureText, f.bounds);
					assert.equal(f.inspector.model.rows[0].textExpanded, true);
				}
				f.inspector.model.selectionIndex = selected ? 0 : -1;
				glyphs.clear();
				overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
				drawWorkbenchPropertyInspector(f.inspector); overlay.renderer.endFrame();
				const selectionCoversText = selected && mode !== 'paragraph';
				const context = `${theme}/${variant}/${mode}/${selected ? 'selected' : 'unselected'}/${severity}`;
				assert.equal(glyphs.get(item.description), selectionCoversText ? colors.COLOR_SELECTION_TEXT : colors.COLOR_DESCRIPTION_TEXT, context);
				assert.equal(glyphs.get(item.value), selectionCoversText ? colors.COLOR_SELECTION_TEXT
					: severity === 'warning' ? colors.COLOR_STATUS_WARNING : severity === 'changed' ? colors.COLOR_INSPECTOR_VALUE_CHANGED
						: colors.COLOR_RESOURCE_VIEWER_TEXT, `${context}: existing value color`);
			}
	}
});

test('a popup cannot restore inspector or toolbar focus after their inspection ends', t => {
	const f = fixture(t);
	const popup = f.focus.createTarget();
	for (const toolbar of [false, true]) {
		f.show(); f.layout();
		if (toolbar) assert.equal(f.focus.moveFocus(false), true);
		const origin = f.focus.target;
		popup.focus();
		f.inspector.hide();
		assert.equal(f.focus.target, popup, 'retiring the inspection does not steal the popup focus');
		f.focus.setTarget(origin);
		assert.equal(f.focus.target, f.parent, 'both the inspector and its toolbar return to the containing scope');
		f.press('ArrowDown');
		assert.equal(f.inspector.visible, false);
	}
});

test('inspector retains complete multiline text and exact pixel-row hit/reveal at tiny resolution with Problems', t => {
	const f = fixture(t), model = f.inspector.model, view = model.viewport;
	assert.deepEqual(model.rows[0].value, f.items[0].value.split('\n'));
	assert.ok(model.rows[0].bottom - model.rows[0].top > view.height);
	f.press('PageDown'); assert.ok(view.scrollTop > 0); assert.equal(model.selectionIndex, 0);
	assert.equal(model.rowAt(view.bounds.top + 2), 0, 'long property remains selectable inside its body');
	f.press('ArrowDown'); assert.equal(model.selectionIndex, 1);
	assert.equal(model.rowAt(view.offsetTop + model.rows[1].top + 2), 1);
	assert.ok(view.offsetTop + model.rows[1].top >= view.bounds.top
		&& view.offsetTop + model.rows[1].bottom <= view.bounds.bottom, 'selection reveals the complete property value, not only its label');
	f.press('ArrowUp');
	assert.equal(view.scrollTop, 0, 'an oversized property starts at its first line instead of revealing its tail');
	f.press('ArrowDown');
	const measured = f.measured();
	for (let n = 0; n < 100; n += 1) { f.inspector.update(); f.layout(); }
	assert.equal(f.measured(), measured, 'unchanged frames and scrolling do not wrap/measure source again');
	f.bounds.right = 160; f.layout(); assert.ok(f.measured() > measured);
	assert.ok(model.rows[1].value.length > 1, 'narrow space wraps instead of silently truncating');
});

test('live property updates retain focus, selection and scroll anchor and measure only changed text', t => {
	const f = fixture(t), model = f.inspector.model;
	f.press('ArrowDown');
	const focus = f.focus.target, scroll = model.viewport.scrollTop, measured = f.measured();
	const items = f.items.map(item => ({ ...item }));
	f.inspector.updateItems(items, (left, right) => left.label === right.label);
	f.layout();
	assert.equal(f.focus.target, focus);
	assert.equal(f.disposed(), 0);
	assert.equal(model.rows[model.selectionIndex].element, items[1]);
	assert.equal(model.viewport.scrollTop, scroll);
	assert.equal(f.measured(), measured);

	items[0] = { ...items[0], value: `${items[0].value}\nnew_line()` };
	f.inspector.updateItems(items, (left, right) => left.label === right.label);
	f.layout();
	assert.equal(model.rows[model.selectionIndex].element, items[1]);
	assert.equal(model.viewport.scrollTop, scroll, 'the first visible property retains its within-property offset');
	assert.ok(f.measured() > measured);
	const after = f.measured();
	f.inspector.updateItems(items, (left, right) => left.label === right.label); f.layout();
	assert.equal(f.measured(), after);
	const inserted = [{ ...items[2], label: 'NEW PROPERTY' }, ...items];
	f.inspector.updateItems(inserted, (left, right) => left.label === right.label); f.layout();
	assert.equal(model.rows[model.selectionIndex].element, items[1]);
	assert.equal(model.viewport.scrollTop - scroll, model.rows[0].bottom);
});

test('focused inspector copies the complete selected value, including live updates and empty values', t => {
	const f = fixture(t);
	const clipboard = f.focus.target!.clipboard!;
	assert.equal(clipboard.readOnly, true);
	assert.equal(clipboard.copy!(), f.items[0].value);
	f.press('ArrowDown');
	assert.equal(clipboard.copy!(), f.items[1].value);
	const items = f.items.map(item => ({ ...item, value: `${item.value}\nupdated` }));
	f.inspector.updateItems(items, (left, right) => left.label === right.label); f.layout();
	assert.equal(clipboard.copy!(), items[1].value);
	f.show(); f.layout(); f.press('End');
	assert.equal(clipboard.copy!(), '');
	f.inspector.updateItems([], (left, right) => left.label === right.label); f.layout();
	assert.equal(clipboard.copy!(), null, 'no selection must not replace the system clipboard');
	f.inspector.hide();
	assert.equal(f.focus.target, f.parent);
	assert.equal(f.focus.target!.clipboard, undefined, 'copy does not leak into the enclosing editor');
});

test('property document compares owner identities rather than labels or mutable row positions', () => {
	type Property = InspectedProperty & { identity: { kind: 'field' | 'slot'; index: number } };
	const model = new WorkbenchPropertyInspectorModel<Property>();
	const field: Property = { label: 'same label', value: 'field value', description: '', warning: false, identity: { kind: 'field', index: 7 } };
	const slot: Property = { label: 'same label', value: 'slot value', description: '', warning: false, identity: { kind: 'slot', index: 7 } };
	model.setItems([field, slot]);
	const equals = (left: Property, right: Property) => left.identity.kind === right.identity.kind && left.identity.index === right.identity.index;
	model.updateItems([slot, { ...field, label: 'renamed field' }], equals);
	assert.equal(model.selectionIndex, 1, 'overwriting the first row does not overwrite the captured selected element');
	assert.equal(model.rows[model.selectionIndex].element.label, 'renamed field', 'owner identity survives a presentation rename');
});

test('property context actions share selected-row focus for secondary pointer and keyboard anchors', t => {
	const f = fixture(t), model = f.inspector.model, view = model.viewport;
	const context = f.inspector.focusTarget.getCommand('contextMenu')!;
	assert.equal(context.isEnabled(), false, 'ordinary inspectors do not offer contribution actions');
	const anchors: { x: number; y: number; keyboard: boolean; selection: number }[] = [];
	f.inspector.onContextMenu = (x, y, keyboard) => {
		assert.equal(f.focus.target, f.inspector.focusTarget);
		anchors.push({ x, y, keyboard, selection: model.selectionIndex });
	};
	model.select(1);
	const row = model.rows[1], x = view.bounds.left + 4, y = view.offsetTop + row.top + 3;
	model.selectionIndex = 0;
	f.parent.focus();
	assert.equal(f.inspector.handlePointer({ valid: true, insideViewport: true, viewportX: x, viewportY: y,
		pressedButtons: PointerButton.Secondary, justPressedButtons: PointerButton.Secondary, justReleasedButtons: 0 }), true);
	assert.deepEqual(anchors[0], { x, y, keyboard: false, selection: 1 });
	assert.equal(f.opened(), -1, 'context opening never activates Source');
	assert.equal(context.isEnabled(), true);
	view.scrollbar.setScroll(0);
	f.focus.executeCommand('contextMenu');
	assert.equal(anchors[1].keyboard, true);
	assert.equal(anchors[1].selection, 1);
	assert.ok(anchors[1].y >= view.bounds.top && anchors[1].y <= view.bounds.bottom, 'keyboard reveals an offscreen property before anchoring its menu');
	f.inspector.hide();
	assert.equal(context.isEnabled(), false, 'detaching the inspector retires its contextual commands');
});

test('inspector controller selection, page scrolling, release Source and Back use its focused control', t => {
	const f = fixture(t), model = f.inspector.model;
	f.pad('rb', true); f.pad('rb', false); assert.ok(model.viewport.scrollTop > 0); assert.equal(model.selectionIndex, 0);
	f.pad('lb', true); f.pad('lb', false); assert.equal(model.viewport.scrollTop, 0);
	f.pad('down', true); f.pad('down', false); assert.equal(model.selectionIndex, 1);
	f.pad('a', true); assert.equal(f.opened(), -1); assert.equal(f.inspector.visible, true);
	f.pad('a', false); assert.equal(f.opened(), 1); assert.equal(f.inspector.visible, false);
	f.show(); f.layout(); f.pad('b', true); f.pad('b', false);
	assert.equal(f.inspector.visible, false); assert.equal(f.focus.target, f.parent);
});

test('inspector keyboard Source activates on release and local lifetime returns focus without a document edit', t => {
	const f = fixture(t);
	f.press('ArrowDown'); f.key('Enter', true);
	assert.equal(f.inspector.visible, true); assert.equal(f.opened(), -1);
	f.key('Enter', false); assert.equal(f.opened(), 1); assert.equal(f.disposed(), 1);
	f.show(); f.layout(); f.press('End');
	assert.equal(f.inspector.isEnabled('propertyInspector.source'), false, 'unproven facts cannot invent a source target');
	f.press('Enter'); assert.equal(f.inspector.visible, true);
	f.press('Escape'); assert.equal(f.inspector.visible, false); assert.equal(f.focus.target, f.parent);
	f.show(); const elsewhere = f.focus.createTarget(); elsewhere.bindKeyboard(() => {}); elsewhere.focus();
	f.inspector.hide(); assert.equal(f.focus.target, elsewhere, 'detach never steals focus from another editor');
});

test('inspector source invalidation, pointer selection and scrollbar capture stay separate', t => {
	const f = fixture(t), view = f.inspector.model.viewport;
	f.inspector.model.select(1);
	const row = f.inspector.model.rows[1];
	f.inspector.handlePointer({ valid: true, insideViewport: true, viewportX: 20, viewportY: view.offsetTop + row.top + 3,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 });
	assert.equal(f.opened(), -1, 'a property selection is not Source or an edit');
	const track = view.scrollbar.getTrack();
	f.inspector.handlePointer({ valid: true, insideViewport: true, viewportX: track.left + 1, viewportY: track.top + 5,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 });
	assert.equal(f.capture.active, true);
	f.inspector.hide(); assert.equal(f.capture.active, false); assert.equal(f.inspector.model.rows.length, 0);
});

test('full inspector paints only visible content using retained property text and theme commands', t => {
	const f = fixture(t), overlay = createHostOverlayFixture(384, 288);
	const rows = f.inspector.model.rows, lines = rows[0].value;
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		drawWorkbenchPropertyInspector(f.inspector); overlay.renderer.endFrame();
		return overlay.queue.consumeOverlayFrame().commandCount;
	};
	const commands = draw(); assert.ok(commands > 0 && commands < 120, 'offscreen source lines do not emit glyph commands');
	assert.equal(draw(), commands); assert.equal(f.inspector.model.rows, rows); assert.equal(rows[0].value, lines);
});

test('inspector rows and its header actions receive independent leave without clearing keyboard selection', t => {
	const f = fixture(t), view = f.inspector.model.viewport;
	const snapshot = { valid: true, insideViewport: true, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0,
		viewportX: view.bounds.left + 2, viewportY: view.bounds.top + 2 };
	f.hover.beginDispatch(); f.inspector.handlePointer(snapshot); f.hover.endDispatch();
	assert.ok(f.inspector.model.hoverIndex >= 0);
	const selection = f.inspector.model.selectionIndex;
	const action = f.inspector.actionBar.items[0];
	snapshot.viewportX = action.bounds.left + 2; snapshot.viewportY = action.bounds.top + 2;
	f.hover.beginDispatch(); f.inspector.handlePointer(snapshot); f.hover.endDispatch();
	assert.equal(f.inspector.model.hoverIndex, -1);
	assert.equal(f.inspector.actionBar.hoveredCommand, action.command);
	assert.equal(f.inspector.model.selectionIndex, selection);
	f.inspector.hide(); f.hover.clear();
	assert.equal(f.inspector.actionBar.hoveredCommand, null);
});

test('read-only evidence without source destinations hides the unused Source action', t => {
	const f = fixture(t);
	f.inspector.show({ title: 'Compiled source', items: [{ label: 'Code', value: 'return 42', description: 'Read-only compiled source', warning: false }],
		canOpenSource: () => false, openSource: () => assert.fail('No source navigation offered') });
	assert.equal(f.inspector.actionBar.items[0].visible, false);
	assert.equal(f.inspector.actionBar.items[1].visible, true);
	f.layout();
	f.inspector.hide();
	f.show(); assert.equal(f.inspector.actionBar.items[0].visible, true);
});

test('embedded inspector joins pane focus order and distinguishes dismissal from detaching', t => {
	const f = fixture(t);
	f.inspector.hide(); f.parent.focus();
	let closed = 0;
	const document = { title: 'Details', items: f.items, canOpenSource: () => false, openSource() {}, onDidClose() { closed++; } };
	const departingEditor = f.focus.createTarget();
	departingEditor.focus();
	f.inspector.show(document, false);
	assert.equal(f.focus.target, departingEditor, 'restoring a visible document must not steal focus');
	const before = f.focus.createTarget(f.parent), after = f.focus.createTarget(f.parent);
	f.inspector.setFocusOrder(before, after);
	before.focus(); f.focus.moveFocus(false);
	assert.equal(f.focus.target, f.inspector.focusTarget);
	f.focus.moveFocus(false); f.focus.moveFocus(false);
	assert.equal(f.focus.target, after);
	f.focus.moveFocus(true); f.focus.moveFocus(true);
	assert.equal(f.focus.target, f.inspector.focusTarget);
	f.inspector.hide();
	assert.equal(f.focus.target, f.parent, 'an embedded document returns to its pane, not the departed editor');
	assert.equal(closed, 0, 'switching editors does not dismiss the retained Details pane');
	f.inspector.show(document);
	f.press('Escape');
	assert.equal(closed, 1);
	assert.equal(f.inspector.visible, false);
});

test('persistent details return focus without dismissal and skip an empty action bar', t => {
	const f = fixture(t), before = f.focus.createTarget(f.parent), after = f.focus.createTarget(f.parent);
	f.inspector.setFocusOrder(before, after);
	let opened = 0;
	const document = { title: 'Details', items: f.items, dismissible: false,
		canOpenSource: () => false, openSource() { opened++; } };
	f.inspector.show(document, false); f.layout();
	before.focus(); f.focus.moveFocus(false);
	assert.equal(f.focus.target, f.inspector.focusTarget);
	f.focus.moveFocus(false); assert.equal(f.focus.target, after);
	f.focus.moveFocus(true); assert.equal(f.focus.target, f.inspector.focusTarget);
	f.press('Escape');
	assert.equal(f.focus.target, f.parent);
	assert.equal(f.inspector.visible, true);
	f.inspector.focusTarget.focus(); f.pad('b', true); f.pad('b', false);
	assert.equal(f.focus.target, f.parent);
	assert.equal(f.inspector.visible, true);
	f.inspector.show({ ...document, canOpenSource: () => true }, false); f.layout();
	f.inspector.execute('propertyInspector.source');
	assert.equal(opened, 1);
	assert.equal(f.inspector.visible, true);
});

test('client inspector leaves chrome to its window, preserves sibling capture and returns focus to explicit owner', () => {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const tree = focus.createTarget(); tree.bindKeyboard(() => {}); tree.focus();
	const client = focus.createTarget(tree); client.bindKeyboard(() => {});
	const inspector = new WorkbenchPropertyInspector<InspectedProperty>(focus, capture, hover, client, 'client');
	let cancelled = 0;
	const sibling = { handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { cancelled += 1; } };
	capture.capture(sibling);
	inspector.show({ title: 'NO SECOND HEADER', items: [{ label: 'Value', value: '42', description: '', warning: false }],
		dismissible: false, focusReturn: tree, canOpenSource: () => true, openSource() {} });
	assert.equal(capture.active, true); assert.equal(cancelled, 0);
	const font = new Font({ variant: 'tiny' });
	const bounds = { left: 20, top: 40, right: 220, bottom: 220 };
	inspector.layout(font, (s, a, b) => font.measure(s.slice(a, b)), s => font.measure(s), bounds);
	assert.equal(inspector.model.viewport.bounds.top, bounds.top);
	assert.equal(inspector.actionBar.items.some(item => item.visible), false);
	const escape = new KeyInputEvent('Escape', 0, false, true);
	focus.handleKeyboard(escape);
	assert.equal(escape.consumed, true); assert.equal(focus.target, tree);
	assert.equal(inspector.visible, true);
	inspector.dispose(); capture.cancel();
});

test('compact runtime fields use measured columns and expose complete clipped text without another value read', t => {
	const f = fixture(t), inspector = f.inspector;
	const value = 'a_complete_long_value_that_does_not_fit_the_small_value_column';
	const item: InspectedProperty = { label: 'A long field label', value, description: '', warning: false, compact: true };
	inspector.show({ title: 'Runtime', items: [item], dismissible: false, canOpenSource: () => false, openSource() {} });
	f.bounds.right = 180; f.layout();
	const row = inspector.model.rows[0];
	assert.equal(row.label.length, 1); assert.equal(row.value.length, 1);
	assert.equal(row.bottom - row.top, compactPropertyRowHeight(f.font));
	assert.equal(row.textExpandable, true); assert.notEqual(row.value[0], value);
	assert.ok(row.valueLeft > row.labelLeft);
	assert.equal(inspector.focusTarget.clipboard!.copy!(), value);
	f.press('ArrowRight'); f.layout();
	assert.equal(row.textExpanded, true); assert.equal(row.value.join(''), value);
	assert.equal(row.label.join(''), item.label);
	assert.ok(row.bottom - row.top > compactPropertyRowHeight(f.font));
	f.press('ArrowLeft'); f.layout();
	assert.equal(row.textExpanded, false); assert.equal(row.value.length, 1);
	const measured = f.measured();
	for (let n = 0; n < 1000; n++) f.layout();
	assert.equal(f.measured(), measured, 'clean compact cells do not remeasure or reformat');
});

test('runtime disclosure keyboard, pointer and activation call the owner while source activation remains separate', t => {
	const f = fixture(t), inspector = f.inspector;
	let requests = 0;
	const expansion = { expanded: false, setExpanded(expanded: boolean) { this.expanded = expanded; requests++; } };
	const item: InspectedProperty = { label: 'Data', value: 'Table #7', description: '', warning: false, compact: true, expansion };
	inspector.show({ title: 'Runtime', items: [item], dismissible: false, canOpenSource: () => false, openSource() {} }); f.layout();
	f.press('ArrowRight'); assert.equal(expansion.expanded, true);
	f.press('ArrowLeft'); assert.equal(expansion.expanded, false);
	f.press('Enter'); assert.equal(expansion.expanded, true);
	const row = inspector.model.rows[0], view = inspector.model.viewport;
	inspector.handlePointer({ valid: true, insideViewport: true, viewportX: view.bounds.left + row.disclosureLeft + 2,
		viewportY: view.offsetTop + row.top + 5, pressedButtons: PointerButton.Primary,
		justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 });
	assert.equal(expansion.expanded, false); assert.equal(requests, 4);
	f.pad('right', true); f.pad('right', false); assert.equal(expansion.expanded, true);
	f.pad('left', true); f.pad('left', false); assert.equal(expansion.expanded, false); assert.equal(requests, 6);
});

test('both Studio fonts fit the nine standard actor fields in compact default client height and keep raw section headings whole', () => {
	for (const variant of ['tiny', 'msx'] as const) {
		const font = new Font({ variant }), model = new WorkbenchPropertyInspectorModel<InspectedProperty>();
		const labels = ['ID', 'Definition', 'Active', 'X', 'Y', 'Z', 'Tags', 'Data', 'Events'];
		model.setItems(labels.map((label, index) => ({ label, value: index < 2 ? 'nemesis_s.intro' : '0', compact: true, description: '', warning: false })));
		const bounds = { left: 0, top: 0, right: 186, bottom: compactPropertyRowHeight(font) * 9 };
		const measure = (text: string, start: number, end: number) => font.measure(text.slice(start, end));
		model.layout(font, measure, bounds);
		assert.deepEqual(model.rows.map(row => row.label[0]), labels);
		assert.equal(model.rows[0].value[0], 'nemesis_s.intro'); assert.equal(model.rows[1].value[0], 'nemesis_s.intro');
		assert.equal(model.rows[8].bottom, bounds.bottom);
		assert.equal(model.viewport.contentHeight, bounds.bottom, 'scalar rows do not force scrolling by oversized paragraph padding');
		model.setItems([{ label: 'Stored fields', value: 'Table #12', compact: true, group: true, description: '', warning: false }]);
		model.layout(font, measure, bounds);
		assert.equal(model.rows[0].label[0], 'Stored fields'); assert.equal(model.rows[0].value[0], '');
	}
});

test('compact multiline scalar previews stay on one row and disclose their exact retained text', t => {
	const f = fixture(t), item: InspectedProperty = { label: 'Text', value: 'first\nsecond', description: '', warning: false, compact: true };
	f.inspector.show({ title: 'Runtime', items: [item], dismissible: false, canOpenSource: () => false, openSource() {} }); f.layout();
	const row = f.inspector.model.rows[0];
	assert.equal(row.value[0], 'first…'); assert.equal(row.bottom - row.top, compactPropertyRowHeight(f.font));
	assert.equal(f.inspector.focusTarget.clipboard!.copy!(), item.value);
	f.press('ArrowRight'); f.layout(); assert.deepEqual(row.value, ['first', 'second']);
});

function feedbackFixture(t: TestContext, property: Partial<InspectedProperty> = {}) {
	const f = fixture(t), surfaces = new WorkbenchSurfaceService();
	f.bounds.right = 180; f.bounds.bottom = 130;
	const area = { left: 0, top: 0, right: 384, bottom: 288 };
	const owner = surfaces.attach({ role: 'content', captureScope: Symbol('inspector owner'), isVisible: () => true,
		getBounds: () => f.bounds, getClip: () => area, draw: () => drawWorkbenchPropertyInspector(f.inspector) });
	t.after(() => surfaces.dispose());
	let childRequests = 0;
	const expansion = { expanded: false, setExpanded(expanded: boolean) { this.expanded = expanded; childRequests++; } };
	const item: InspectedProperty = { label: '_active_objects_by_definition', value: 'Table #7', description: '', warning: false,
		compact: true, depth: 2, expansion, ...property };
	const items: InspectedProperty[] = [item, ...Array.from({ length: 8 }, (_, index) => ({ label: `Scalar ${index}`, value: '0',
		compact: true, depth: 0, description: '', warning: false }))];
	f.inspector.show({ title: 'Runtime', items, dismissible: false, canOpenSource: () => false, openSource() {} }, false);
	f.inspector.attachFeedback(surfaces, owner, () => area);
	let font = new Font({ variant: 'msx' }), measurements = 0;
	const measure = (text: string, start: number, end: number) => { measurements++; return font.measure(text.slice(start, end)); };
	const measureText = (text: string) => { measurements++; return font.measure(text); };
	const layout = () => f.inspector.layout(font, measure, measureText, f.bounds);
	layout();
	const labels: string[] = [];
	t.mock.method(api, 'blit_text_inline_with_font', text => { labels.push(text); });
	const overlay = createHostOverlayFixture(384, 288);
	const paint = () => {
		labels.length = 0;
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); surfaces.draw(api); overlay.renderer.endFrame();
	};
	const pointer = (offset = 0) => {
		const view = f.inspector.model.viewport;
		f.inspector.handlePointer({ valid: true, insideViewport: true, viewportX: view.bounds.left + 50 + offset,
			viewportY: view.bounds.top + 5, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 });
	};
	return { ...f, surfaces, owner, area, item, items, labels, paint, layout, pointer,
		measurements: () => measurements, childRequests: () => childRequests,
		setFont: (variant: 'tiny' | 'msx') => { font = new Font({ variant }); layout(); } };
}

test('clipped table names expose full cached passive hover and keyboard focus feedback without inspecting children', t => {
	const f = feedbackFixture(t), view = f.inspector.model.viewport;
	assert.notEqual(f.inspector.model.rows[0].label[0], f.item.label);
	f.paint(); assert.equal(f.labels.includes(f.item.label), false, 'unfocused unhovered cells do not create persistent popups');
	f.pointer(); f.layout(); f.paint();
	assert.equal(f.labels.includes(f.item.label), true); assert.equal(f.labels.includes(f.item.value), true);
	assert.equal(f.childRequests(), 0, 'reading the full table name is not child expansion or guest execution');
	assert.equal(f.surfaces.hitTest(view.bounds.left + 10, view.bounds.top + f.inspector.model.rows[0].headerHeight + 3), f.owner,
		'feedback does not intercept the underlying content');
	const measured = f.measurements();
	for (let n = 0; n < 1000; n++) { f.inspector.update(); f.layout(); }
	assert.equal(f.measurements(), measured); assert.equal(f.childRequests(), 0);
	f.inspector.focusTarget.focus(); f.layout(); f.paint(); assert.equal(f.labels.includes(f.item.label), true);
	f.parent.focus(); f.paint(); assert.equal(f.labels.includes(f.item.label), false, 'blur retires the full-name feedback immediately');
	f.inspector.focusTarget.focus(); f.layout(); f.paint(); assert.equal(f.labels.includes(f.item.label), true);
	f.setFont('tiny'); f.paint(); assert.equal(f.labels.includes(f.item.label), true, 'font changes reflow the same retained full text');
	f.press('ArrowDown'); f.layout(); f.paint();
	assert.equal(f.labels.includes(f.item.label), false, 'ordinary unclipped scalar selection never opens a hint');
});

test('property feedback retires on scroll, logical row replacement and containing surface lifetime', t => {
	const f = feedbackFixture(t), view = f.inspector.model.viewport;
	f.pointer(); f.layout(); f.paint(); assert.equal(f.labels.includes(f.item.label), true);
	f.inspector.handleWheel({ valid: true, insideViewport: true, viewportX: view.bounds.left + 50, viewportY: view.bounds.top + 5 }, 30);
	f.layout(); f.paint(); assert.equal(f.labels.includes(f.item.label), false);
	f.inspector.model.viewport.scrollbar.setScroll(0); f.pointer(); f.layout(); f.paint();
	assert.equal(f.labels.includes(f.item.label), false, 'stationary pointer feedback cannot follow an unrelated row after scrolling');
	f.pointer(1); f.layout(); f.paint(); assert.equal(f.labels.includes(f.item.label), true);
	const replacement = { ...f.item, label: '_other_full_stored_member_name', value: 'Table #8' };
	f.inspector.updateItems([replacement, ...f.items.slice(1)], (left, right) => left.label === right.label);
	f.layout(); f.paint();
	assert.equal(f.labels.includes(f.item.label), false); assert.equal(f.labels.includes(replacement.label), false);
	f.pointer(2); f.layout(); f.paint(); assert.equal(f.labels.includes(replacement.label), true);
	f.owner.dispose(); f.paint(); assert.equal(f.labels.includes(replacement.label), false, 'feedback is retired with its actual content surface');
});

test('full property feedback respects the shared modal admission contract and inspector hide lifetime', t => {
	const f = feedbackFixture(t);
	f.pointer(); f.layout(); f.paint(); assert.equal(f.labels.includes(f.item.label), true);
	const modal = f.surfaces.attach({ role: 'modal', blockedScope: null, lifetimeOwner: f.owner, captureScope: Symbol('modal'),
		getBounds: () => f.area, getClip: () => f.area, isVisible: () => true, draw() {} });
	f.paint(); assert.equal(f.labels.includes(f.item.label), false, 'feedback cannot paint over a modal that blocks its owner');
	modal.dispose(); f.inspector.hide(); f.paint();
	assert.equal(f.labels.includes(f.item.label), false);
});

test('disclosure navigation cancels held keyboard and controller activation before selecting another source or table', t => {
	const f = fixture(t);
	for (const trigger of ['keyboard', 'gamepad'] as const) for (const direction of ['ArrowRight', 'ArrowLeft'] as const)
		for (const target of ['source', 'table'] as const) {
			let opened = 0, parentChanges = 0, childChanges = 0;
			const parentExpansion = { expanded: true, setExpanded(expanded: boolean) { this.expanded = expanded; parentChanges++; } };
			const childExpansion = { expanded: false, setExpanded(expanded: boolean) { this.expanded = expanded; childChanges++; } };
			const parent: InspectedProperty = { label: 'Parent', value: 'Table #1', description: '', warning: false, compact: true, depth: 0, expansion: parentExpansion };
			const child: InspectedProperty = { label: 'Child', value: target === 'source' ? 'source.lua:3' : 'Table #2', description: '', warning: false,
				compact: true, depth: 1, expansion: target === 'table' ? childExpansion : undefined };
			f.inspector.show({ title: 'Runtime', items: [parent, child], dismissible: false,
				canOpenSource: item => target === 'source' && item === child, openSource() { opened++; } }); f.layout();
			f.inspector.model.select(direction === 'ArrowRight' ? 0 : 1);
			if (trigger === 'keyboard') f.key('Enter', true); else f.pad('a', true);
			f.press(direction);
			assert.equal(f.inspector.model.selectionIndex, direction === 'ArrowRight' ? 1 : 0);
			if (trigger === 'keyboard') f.key('Enter', false); else f.pad('a', false);
			assert.equal(opened, 0, 'a release without a press on the new selection cannot open Source');
			assert.equal(parentChanges, 0); assert.equal(childChanges, 0, 'a release cannot expand or collapse a newly selected table');
			f.press('Enter');
			if (direction === 'ArrowLeft') assert.equal(parentChanges, 1);
			else if (target === 'source') assert.equal(opened, 1, 'fresh Source activation still works');
			else assert.equal(childChanges, 1, 'fresh table activation still works');
		}
});

test('on-demand compact explanations disclose explicitly without obscuring the initial field grid', t => {
	const f = fixture(t), description = 'Retained register interpretation. '.repeat(12);
	const item: InspectedProperty = { label: 'D[0]', value: '12345678h', description, warning: false, compact: true, descriptionDisplay: 'disclosure' };
	f.inspector.show({ title: 'Hardware', items: [item], dismissible: false, canOpenSource: () => false, openSource() {} }); f.layout();
	const row = f.inspector.model.rows[0];
	assert.equal(row.bottom - row.top, compactPropertyRowHeight(f.font));
	assert.equal(row.textExpandable, true, 'a fitting field still advertises its actual annotation'); assert.deepEqual(row.description, []);
	assert.equal(f.inspector.focusTarget.clipboard!.copy!(), item.value);
	const measured = f.measured();
	for (let n = 0; n < 1000; n++) { f.inspector.update(); f.layout(); }
	assert.equal(f.measured(), measured);
	f.press('ArrowRight'); f.layout(); assert.equal(row.textExpanded, true); assert.ok(row.description.join(' ').startsWith('Retained register interpretation.'));
	assert.ok(row.bottom - row.top > compactPropertyRowHeight(f.font));
	f.press('ArrowLeft'); f.layout(); assert.equal(row.textExpanded, false); assert.deepEqual(row.description, []);
	f.press('Enter'); f.layout(); assert.equal(row.textExpanded, true, 'non-source field activation also discloses its explanation');
});

test('source-capable compact fields retain Enter Source while Right discloses their complete annotation', t => {
	const f = fixture(t), item: InspectedProperty = { label: 'Source', value: 'file.lua:3', description: 'Captured installed program, not the current editor buffer.',
		warning: true, compact: true, descriptionDisplay: 'disclosure' };
	let opened = 0;
	f.inspector.show({ title: 'Source', items: [item], dismissible: false, canOpenSource: () => true, openSource() { opened++; } }); f.layout();
	f.press('ArrowRight'); f.layout(); assert.equal(f.inspector.model.rows[0].textExpanded, true); assert.equal(opened, 0);
	f.press('ArrowLeft'); f.layout(); f.press('Enter'); assert.equal(opened, 1);
});


test('explanation-only hover is opt-in pointer feedback; initial focus leaves the compact hardware grid exposed', t => {
	const description = 'Retained raw word, not an MMIO alias read.';
	const f = feedbackFixture(t, { label: 'D[0]', value: '12345678h', depth: 0, expansion: undefined, description, descriptionDisplay: 'disclosure' });
	f.inspector.focusTarget.focus(); f.layout(); f.paint();
	assert.equal(f.labels.includes(description), false, 'initial keyboard selection cannot obscure the compact grid with an explanation popup');
	f.press('ArrowRight'); f.layout(); assert.equal(f.inspector.model.rows[0].textExpanded, true); f.paint();
	assert.ok(f.labels.join(' ').includes('Retained raw word,'));
	f.press('ArrowLeft'); f.layout(); f.pointer(); f.layout(); f.paint(); assert.ok(f.labels.includes(description));
	const measured = f.measurements();
	for (let n = 0; n < 1000; n++) { f.inspector.update(); f.layout(); }
	assert.equal(f.measurements(), measured); assert.equal(f.childRequests(), 0);
	f.parent.focus(); f.paint(); assert.equal(f.labels.includes(description), false);
});

test('explicit bottom-row Right and pointer disclosure reveal the new row extent after reflow', t => {
	const f = fixture(t); f.bounds.bottom = 150;
	const items: InspectedProperty[] = Array.from({ length: 16 }, (_, index) => ({ label: `D[${index}]`, value: '12345678h',
		description: 'Retained raw register word, before and after this command, not an MMIO alias read.', warning: false,
		compact: true, descriptionDisplay: 'disclosure' }));
	const open = () => { f.inspector.show({ title: 'Hardware', items, dismissible: false, canOpenSource: () => false, openSource() {} }); f.layout(); f.press('End'); f.layout(); };
	for (const method of ['keyboard', 'pointer'] as const) {
		open();
		const model = f.inspector.model, view = model.viewport, row = model.rows.at(-1)!;
		const oldTop = view.offsetTop + row.top;
		assert.ok(oldTop > view.bounds.top + view.height / 2, 'the collapsed final field really begins near the viewport bottom');
		if (method === 'keyboard') f.press('ArrowRight');
		else f.inspector.handlePointer({ valid: true, insideViewport: true, viewportX: view.bounds.left + row.disclosureLeft + 3,
			viewportY: oldTop + row.headerHeight / 2, pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 });
		f.layout();
		assert.equal(row.textExpanded, true);
		assert.ok(view.offsetTop + row.top >= view.bounds.top && view.offsetTop + row.bottom <= view.bounds.bottom,
			`${method}: the disclosed explanation is visible without another navigation/scroll action`);
		const scroll = view.scrollTop; for (let frame = 0; frame < 1000; frame++) f.layout();
		assert.equal(view.scrollTop, scroll, 'ordinary idle layout does not continuously re-reveal or reset scroll');
	}
});

test('oversized explicit text disclosure leads with its field while replacement and hide retire the reveal target', t => {
	const f = fixture(t); f.bounds.bottom = 110;
	const item: InspectedProperty = { label: 'D[31]', value: '12345678h', description: 'A complete retained register explanation. '.repeat(100),
		compact: true, warning: false, descriptionDisplay: 'disclosure' };
	const items = [...f.items, item];
	f.inspector.show({ title: 'Hardware', items, dismissible: false, canOpenSource: () => false, openSource() {} }); f.layout();
	f.press('End'); f.layout(); f.press('ArrowRight'); f.layout();
	const view = f.inspector.model.viewport, row = f.inspector.model.rows.at(-1)!;
	assert.ok(row.bottom - row.top > view.height);
	assert.equal(view.offsetTop + row.top, view.bounds.top + INSPECTOR_PADDING, 'oversized text starts with the actual label rather than its final paragraph');
	f.press('ArrowLeft'); f.layout(); f.press('ArrowRight');
	const replacement = { ...item, label: 'Replacement', description: 'Different retained subject.' };
	f.inspector.updateItems([...items.slice(0, -1), replacement], (left, right) => left === right); f.layout();
	assert.equal(f.inspector.model.rows.at(-1)!.textExpanded, false, 'a pending reveal never expands a replacement at the same index');
	f.inspector.hide(); f.show(); f.layout();
	assert.equal(f.inspector.model.selectionIndex, 0); assert.equal(f.inspector.model.viewport.scrollTop, 0);
});


test('queued navigation supersedes an earlier explicit expansion reveal before the next layout', () => {
	const font = new Font({ variant: 'tiny' }), model = new WorkbenchPropertyInspectorModel<InspectedProperty>();
	const items: InspectedProperty[] = Array.from({ length: 10 }, (_, index) => ({ label: `D[${index}]`, value: '12345678h',
		description: 'A retained register explanation. '.repeat(5), warning: false, compact: true, descriptionDisplay: 'disclosure' }));
	const bounds = { left: 0, top: 0, right: 180, bottom: 48 }, measure = (s: string, a: number, b: number) => font.measure(s.slice(a, b));
	model.setItems(items); model.layout(font, measure, bounds); model.select(6); model.setValueExpanded(6, true); model.select(7);
	model.layout(font, measure, bounds);
	const selected = model.rows[model.selectionIndex], view = model.viewport;
	assert.equal(model.selectionIndex, 7);
	assert.ok(view.offsetTop + selected.top >= bounds.top && view.offsetTop + selected.bottom <= bounds.bottom,
		'the latest actual navigation owns reveal after reflow, not the earlier expanded row');
});

test('a different inspected observation retires held keyboard and gamepad activation without changing control focus', t => {
	const f = fixture(t);
	for (const trigger of ['Enter', 'NumpadEnter', 'gamepad'] as const) {
		const old: InspectedProperty = { label: 'Old observation', value: '12345678h', description: 'Captured word.',
			warning: false, compact: true, descriptionDisplay: 'disclosure' };
		const next = { ...old, label: 'New observation', value: '87654321h' };
		f.inspector.show({ title: 'Hardware', items: [old], dismissible: false, canOpenSource: () => false, openSource() {} }); f.layout();
		if (trigger === 'gamepad') f.pad('a', true); else f.key(trigger, true);
		const row = f.inspector.model.rows[0], focused = f.focus.target;
		f.inspector.replaceItems([next]); f.layout();
		if (trigger === 'gamepad') f.pad('a', false); else f.key(trigger, false);
		f.layout();
		assert.equal(f.focus.target, focused, 'a new document does not hide/show the inspector or restore focus');
		assert.equal(f.inspector.model.rows[0], row, 'presentation storage can be retained independently of observation identity');
		assert.equal(row.element, next); assert.equal(row.textExpanded, false, 'an old release must not activate the next observation');
		f.press('Enter'); f.layout(); assert.equal(row.textExpanded, true, 'a fresh press/release still activates the new document');
	}
});

test('a different inspected observation retires its scroll capture and resets only document-local view state', t => {
	const f = fixture(t), rows: InspectedProperty[] = Array.from({ length: 30 }, (_, index) => ({ label: `Word[${index}]`,
		value: '12345678h', description: 'Captured word.', warning: false, compact: true, descriptionDisplay: 'disclosure' }));
	f.bounds.bottom = 150;
	f.inspector.show({ title: 'Hardware', items: rows, dismissible: false, canOpenSource: () => false, openSource() {} }); f.layout();
	const view = f.inspector.model.viewport, thumb = view.scrollbar.getThumb()!;
	const snapshot: PointerSnapshot = { valid: true, insideViewport: true, viewportX: thumb.left + 1, viewportY: thumb.top + 1,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	f.inspector.handlePointer(snapshot); assert.equal(f.capture.active, true);
	const replacement = rows.map(row => ({ ...row, value: '87654321h' }));
	f.inspector.replaceItems(replacement); f.layout();
	assert.equal(f.capture.active, false);
	assert.equal(f.inspector.model.selectionIndex, 0); assert.equal(view.scrollTop, 0);
	snapshot.viewportY += 50; snapshot.justPressedButtons = 0;
	f.inspector.handlePointer(snapshot); f.layout(); assert.equal(view.scrollTop, 0, 'the remainder of an old hold does not drag a new document');
});

test('detached inspector mementos anchor rows across provenance and font reflow without dragging an offscreen selection into view', () => {
	const tiny = new Font({ variant: 'tiny' }), msx = new Font({ variant: 'msx' });
	const bounds = { left: 0, top: 20, right: 280, bottom: 110 };
	const fields: InspectedProperty[] = Array.from({ length: 30 }, (_, index) => ({ compact: true, descriptionDisplay: 'disclosure',
		label: `Word[${index}]`, value: '00000000h', description: 'Captured raw word.', warning: false }));
	const original = new WorkbenchPropertyInspectorModel<InspectedProperty>();
	original.setItems(fields); original.layout(tiny, (text, a, b) => tiny.measure(text.slice(a, b)), bounds);
	original.select(0); original.viewport.scrollbar.setScroll(200);
	const state = { selectionIndex: 0, selectionVisible: false, anchorIndex: 0, anchorOffset: 0 };
	original.saveViewState(state); assert.equal(state.selectionVisible, false);
	const restored = new WorkbenchPropertyInspectorModel<InspectedProperty>();
	const changed = fields.slice();
	changed[1] = { ...fields[1], descriptionDisplay: 'inline', description: 'Source changed.\nNavigation is disabled.\nThe captured register words remain unchanged.' };
	restored.setItems(changed); restored.restoreViewState(state);
	restored.layout(msx, (text, a, b) => msx.measure(text.slice(a, b)), bounds);
	assert.equal(restored.selectionIndex, 0);
	assert.equal(restored.rowAt(bounds.top), state.anchorIndex);
	assert.equal(restored.viewport.scrollTop - restored.rows[state.anchorIndex].top, state.anchorOffset);
	assert.ok(restored.viewport.offsetTop + restored.rows[0].bottom < bounds.top, 'a deliberately offscreen selection stays offscreen');
});

test('restoring within an oversized selected property preserves the reading offset instead of revealing its beginning', () => {
	const font = new Font({ variant: 'tiny' }), bounds = { left: 0, top: 20, right: 280, bottom: 110 };
	const fields = [{ label: 'Callback', value: Array.from({ length: 80 }, (_, index) => `line_${index}()`).join('\n'), description: '', warning: false }];
	const model = new WorkbenchPropertyInspectorModel<InspectedProperty>();
	model.setItems(fields); model.layout(font, (text, a, b) => font.measure(text.slice(a, b)), bounds);
	model.viewport.scrollbar.setScroll(200);
	const state = { selectionIndex: 0, selectionVisible: false, anchorIndex: 0, anchorOffset: 0 };
	model.saveViewState(state); assert.equal(state.selectionVisible, true);
	model.setItems(fields); model.restoreViewState(state);
	model.layout(font, (text, a, b) => font.measure(text.slice(a, b)), bounds);
	assert.equal(model.viewport.scrollTop, 200);
});

test('document input cancellation retires keyboard and controller attempts without detaching or blurring the inspector', t => {
	const f = fixture(t), target = f.inspector.focusTarget;
	f.key('Enter', true); target.cancelInput(); f.key('Enter', false);
	assert.equal(f.opened(), -1); assert.equal(f.inspector.visible, true); assert.equal(f.focus.target, target);
	f.pad('a', true); target.cancelInput(); f.pad('a', false);
	assert.equal(f.opened(), -1); assert.equal(f.inspector.visible, true); assert.equal(f.focus.target, target);
	f.pad('a', true); f.pad('a', false); assert.equal(f.opened(), 0);
});


test('source admission may retire the held activation synchronously before the release commits', t => {
	const f = fixture(t);
	let retire = false, opened = 0;
	f.inspector.show({ title: 'Captured source', items: f.items, dismissible: false,
		canOpenSource: () => { if (retire) f.inspector.focusTarget.cancelInput(); return true; }, openSource() { opened++; } });
	f.layout();
	f.key('Enter', true); retire = true; f.key('Enter', false); assert.equal(opened, 0);
	retire = false; f.pad('a', true); retire = true; f.pad('a', false); assert.equal(opened, 0);
	retire = false; f.press('Enter'); assert.equal(opened, 1);
	f.pad('a', true); f.pad('a', false); assert.equal(opened, 2);
});
