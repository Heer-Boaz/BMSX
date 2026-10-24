import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { EditorCommandId } from '../../ide/common/commands';
import { HEADER_BUTTON_PADDING_X } from '../../ide/common/constants';
import { editorFeedbackState, showEditorMessage, updateEditorMessage } from '../../ide/common/feedback_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { api } from '../../ide/runtime/overlay_api';
import { getWorkbenchEditorBounds, getStatusMessageLines, topMargin, refreshWorkbenchLayout, updateFullWidthWorkbenchLayout, type FullWidthWorkbenchLayout } from '../../ide/workbench/common/layout';
import { renderTopBar } from '../../ide/workbench/render/top_bar';
import { editorChromeState } from '../../ide/workbench/ui/chrome_state';
import { layoutTopBar } from '../../ide/workbench/ui/top_bar/layout';
import { TOP_BAR_MENU_ENTRIES, type MenuId } from '../../ide/workbench/ui/top_bar/menu';
import { resolveEditorCommandKeybinding } from '../../ide/input/keyboard/command_keybindings';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { drawContextMenu } from '../../ide/workbench/services/context_menu/render';
import { MenubarController } from '../../ide/workbench/ui/top_bar/controller';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { editorSearchState } from '../../ide/workbench/contrib/code_editor/find/widget_state';

function fixture(t: TestContext) {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const overlay = createHostOverlayFixture(384, 288);
	const focus = new InputFocusService(), capture = new PointerCaptureService();
	const origin = focus.createTarget(); origin.bindKeyboard(() => {}); origin.focus();
	const popup = new ContextMenuController(focus, capture);
	let measurements = 0, queries = 0;
	const active = new Set<EditorCommandId>(), disabled = new Set<EditorCommandId>();
	const executed: EditorCommandId[] = [];
	const commands = {
		isActive(command: EditorCommandId) { queries++; return active.has(command); },
		isEnabled(command: EditorCommandId) { queries++; return !disabled.has(command); },
		execute(command: EditorCommandId) { assert.equal(focus.target, origin); executed.push(command); },
	};
	const menubar = new MenubarController(popup, commands);
	const context = {
		get viewportWidth() { return editorViewState.viewportWidth; },
		get headerHeight() { return editorViewState.headerHeight; },
		get tabBarHeight() { return editorViewState.tabBarHeight; },
		get lineHeight() { return editorViewState.lineHeight; },
		measureText(text: string) { measurements++; return editorViewState.font.measure(text); },
		drawText(text: string, x: number, y: number, z: number, color: number) {
			api.blit_text_inline_with_font(text, x, y, z, color, editorViewState.font.renderFont());
		},
	};
	const layout = () => {
		layoutTopBar(context); menubar.update(); popup.update();
		if (popup.visible) popup.model.layout(editorViewState.viewportWidth, editorViewState.viewportHeight, context.lineHeight,
			editorViewState.font.renderFont(), context.measureText);
	};
	const paint = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		renderTopBar(context, menubar); drawContextMenu(popup);
		overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
	};
	const pointer = (id: MenuId, pressed = true) => {
		const bounds = editorChromeState.menuEntryBounds[id];
		menubar.handlePointer({ valid: true, insideViewport: true, viewportX: bounds.left + 2, viewportY: bounds.top + 2,
			pressedButtons: 0, justPressedButtons: pressed ? PointerButton.Primary : 0, justReleasedButtons: 0 });
		layout();
	};
	t.after(() => { popup.dispose(); editorFeedbackState.message.visible = false; });
	layout();
	return { layout, paint, context, popup, menubar, focus, origin, active, disabled, executed, pointer,
		measured: () => measurements, queried: () => queries };
}

test('menubar uses the popup focus and layout; painting consumes dynamic command presentation', t => {
	const f = fixture(t);
	f.active.add('pause'); f.disabled.add('stepFrame');
	f.pointer('run');
	assert.equal(f.focus.target, f.popup.focusTarget);
	assert.equal(f.popup.focusTarget.commandContext, f.origin);
	const pause = f.popup.model.rows.find(row => row.command === 'pause')!;
	const step = f.popup.model.rows.find(row => row.command === 'stepFrame')!;
	assert.equal(pause.active, true); assert.equal(step.enabled, false);
	assert.ok(f.popup.model.rows.some(row => row.keybinding !== undefined && row.keybindingWidth > 0));
	const geometry = f.popup.model.rows.map(row => ({ label: row.label, top: row.top, bottom: row.bottom }));
	const measured = f.measured(), queried = f.queried();
	f.paint(); f.paint();
	assert.equal(f.measured(), measured); assert.equal(f.queried(), queried);
	assert.deepEqual(f.popup.model.rows.map(row => ({ label: row.label, top: row.top, bottom: row.bottom })), geometry);
	f.active.clear(); f.disabled.clear(); f.layout();
	assert.equal(pause.active, false); assert.equal(step.enabled, true);
	f.pointer('file', false);
	const files = f.popup.model.rows.find(row => row.command === 'resources')!;
	const label = files.label;
	f.active.add('resources'); f.layout();
	assert.notEqual(files.label, label);
});

test('menu switching retains source context; Escape, outside click and command execution return focus', t => {
	const f = fixture(t);
	f.pointer('file'); f.pointer('edit', false);
	assert.equal(f.menubar.activeMenu, 'edit'); assert.equal(f.focus.target, f.popup.focusTarget);
	assert.equal(f.popup.focusTarget.commandContext, f.origin);
	f.focus.handleKeyboard(new KeyInputEvent('ArrowRight', KeyModifier.none)); f.layout();
	assert.equal(f.menubar.activeMenu, 'run'); assert.ok(f.popup.model.selectedIndex >= 0);
	f.focus.handleKeyboard(new KeyInputEvent('ArrowLeft', KeyModifier.none)); f.layout();
	assert.equal(f.menubar.activeMenu, 'edit');
	f.focus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none));
	assert.equal(f.menubar.activeMenu, undefined); assert.equal(f.focus.target, f.origin);
	f.pointer('file'); f.pointer('file');
	assert.equal(f.popup.visible, false); assert.equal(f.focus.target, f.origin);
	f.pointer('file');
	f.popup.handlePointer({ valid: true, insideViewport: true, viewportX: 380, viewportY: 280,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 });
	assert.equal(f.popup.visible, false); assert.equal(f.focus.target, f.origin);
	f.pointer('edit'); f.popup.model.selectNext(1); const command = f.popup.model.rows[f.popup.model.selectedIndex].command!;
	f.popup.accept(); assert.deepEqual(f.executed, [command]); assert.equal(f.menubar.activeMenu, undefined);
});

test('F10 uses the active workbench command binding to open, traverse and cancel without pointer input', t => {
	const f = fixture(t);
	const binding = resolveEditorCommandKeybinding('F10', KeyModifier.none, { isEnabled: command => command === 'menubar.focus' })!;
	assert.equal(binding.command, 'menubar.focus');
	assert.equal(resolveEditorCommandKeybinding('F10', KeyModifier.none, { isEnabled: () => false }), null);
	f.menubar.toggleFocus(); f.layout();
	assert.equal(f.menubar.activeMenu, 'file'); assert.equal(f.focus.target, f.popup.focusTarget);
	assert.ok(f.popup.model.selectedIndex >= 0);
	f.focus.handleKeyboard(new KeyInputEvent('ArrowRight', KeyModifier.none)); f.layout();
	assert.equal(f.menubar.activeMenu, 'edit');
	f.focus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none));
	assert.equal(f.popup.visible, false); assert.equal(f.focus.target, f.origin);
	f.menubar.toggleFocus(); f.menubar.toggleFocus();
	assert.equal(f.popup.visible, false); assert.equal(f.focus.target, f.origin);
});

test('a non-menubar popup retains outside-click ownership over blank chrome and secondary header clicks', t => {
	const f = fixture(t);
	f.popup.show(100, 80, [{ type: 'command', command: 'save' }], { isEnabled: () => true, execute() {} }); f.layout();
	const snapshot = { valid: true, insideViewport: true, viewportX: editorChromeState.menuEntryBounds.file.left + 2,
		viewportY: 2, pressedButtons: PointerButton.Secondary, justPressedButtons: PointerButton.Secondary, justReleasedButtons: 0 };
	assert.equal(f.menubar.handlePointer(snapshot), false);
	f.popup.handlePointer(snapshot);
	assert.equal(f.popup.visible, false); assert.equal(f.focus.target, f.origin);
	f.popup.show(100, 80, [{ type: 'command', command: 'save' }], { isEnabled: () => true, execute() {} }); f.layout();
	snapshot.viewportX = 380; snapshot.pressedButtons = PointerButton.Primary; snapshot.justPressedButtons = PointerButton.Primary;
	assert.equal(f.menubar.handlePointer(snapshot), false);
	f.popup.handlePointer(snapshot);
	assert.equal(f.popup.visible, false); assert.equal(f.focus.target, f.origin);
});

test('menu geometry clamps to viewport; retained labels do not remeasure on unchanged frames', t => {
	const f = fixture(t); f.pointer('view');
	const width = f.popup.model.bounds.right - f.popup.model.bounds.left;
	const measured = f.measured();
	for (let index = 0; index < 100; index++) { f.layout(); f.paint(); }
	assert.equal(f.measured(), measured);
	editorViewState.viewportWidth = 256; f.layout();
	assert.equal(f.measured(), measured);
	assert.ok(f.popup.model.bounds.right <= 256);
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null); f.layout();
	assert.ok(f.measured() > measured);
	assert.ok(f.popup.model.bounds.right - f.popup.model.bounds.left > width);
	for (const entry of TOP_BAR_MENU_ENTRIES) {
		const bounds = editorChromeState.menuEntryBounds[entry.id];
		if (bounds.right !== 0) assert.equal(bounds.right - bounds.left, editorViewState.font.measure(entry.label) + HEADER_BUTTON_PADDING_X * 2);
	}
	editorViewState.viewportWidth = 12; f.layout();
	assert.equal(f.popup.visible, false); assert.equal(f.focus.target, f.origin);
});

test('feedback expiry and font wrapping publish parent bounds before full-width child layout', t => {
	fixture(t);
	const child: FullWidthWorkbenchLayout = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
	};
	editorViewState.viewportWidth = 128;
	showEditorMessage('This authored status message must wrap differently when the font changes', 'info', 1);
	refreshWorkbenchLayout();
	assert.equal(updateFullWidthWorkbenchLayout(child, getWorkbenchEditorBounds()), true);
	const tinyLines = [...getStatusMessageLines()];
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null);
	refreshWorkbenchLayout();
	assert.equal(updateFullWidthWorkbenchLayout(child, getWorkbenchEditorBounds()), true);
	const msxLines = [...getStatusMessageLines()];
	assert.ok(msxLines.length > tinyLines.length, 'same text and viewport do not imply same wrapping');
	assert.equal(child.bottom, 288 - editorViewState.baseBottomMargin - msxLines.length * editorViewState.lineHeight - 4);
	updateEditorMessage(1);
	refreshWorkbenchLayout();
	assert.equal(updateFullWidthWorkbenchLayout(child, getWorkbenchEditorBounds()), true);
	assert.equal(child.bottom, 288 - editorViewState.baseBottomMargin);
	assert.deepEqual(getStatusMessageLines(), []);
	assert.equal(updateFullWidthWorkbenchLayout(child, getWorkbenchEditorBounds()), false, 'unchanged parent layout has no child rebuild');
});


test('pane-root geometry includes inline editor widgets while the text viewport starts below them', t => {
	fixture(t);
	const wasVisible = editorSearchState.visible;
	t.after(() => { editorSearchState.visible = wasVisible; refreshWorkbenchLayout(); });
	editorSearchState.visible = false;
	refreshWorkbenchLayout();
	const bounds = getWorkbenchEditorBounds();
	const top = bounds.top;
	editorSearchState.visible = true;
	refreshWorkbenchLayout();
	assert.equal(getWorkbenchEditorBounds(), bounds, 'the surface references the actual retained layout rectangle');
	assert.equal(bounds.top, top);
	assert.equal(bounds.top, topMargin());
	assert.ok(editorViewState.codeAreaTop > bounds.top, 'the inline search bar stays inside the pane paint and input clip');
	assert.equal(refreshWorkbenchLayout(), false, 'unchanged geometry does not invalidate routed hover each frame');
});
