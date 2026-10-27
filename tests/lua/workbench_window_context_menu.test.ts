import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId } from '../../ide/common/commands';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { measureText, measureTextRange } from '../../ide/editor/common/text/layout';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchFloatingWindow } from '../../ide/workbench/ui/window/control';
import { WorkbenchWindowModel } from '../../ide/workbench/ui/window/model';
import { createActualSourcePanes } from '../helpers/source_panes';

type Fixture = ReturnType<typeof createActualSourcePanes>;

function rightClickTitle(f: Fixture, window: WorkbenchFloatingWindow): void {
	const header = window.model.header, x = header.left + 16, y = (header.top + header.bottom) / 2;
	f.host.clock.advance(1);
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Secondary, pressedButtons: PointerButton.Secondary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Secondary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
}

function choose(f: Fixture, command: EditorCommandId): void {
	const menu = f.editor.contextMenu;
	assert.ok(menu.model.rows.some(row => row.command === command && row.enabled));
	f.key('Home');
	while (menu.model.rows[menu.model.selectedIndex].command !== command) f.key('ArrowDown');
	f.key('Enter');
}

function utility(t: TestContext, f: Fixture) {
	const model = new WorkbenchWindowModel({ left: 50, top: 80, right: 310, bottom: 250 }, 120, 80);
	let contentFocus = 0;
	const window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, f.editor.surfaces, f.editor.commands, f.editor.contextMenu, {
		model, actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: f.firstGroup.paneSurface,
		presentationParent: f.editor.surfaces.windowContext(f.firstGroup.paneSurface),
		focusScope: f.firstPart.scope, focusReturn: f.first.commandTarget, workArea: f.firstGroup.workArea,
		content: { draw() {} }, layoutContent() {}, retireContentInput() {}, restoreContentInput() {},
		focusContent: () => { contentFocus++; window.clientFocusTarget.focus(); },
	});
	window.show(false); window.layout(editorViewState.font.renderFont(), measureTextRange, measureText); window.update();
	t.after(() => window.dispose());
	return { window, model, contentFocus: () => contentFocus };
}

test('document title right-click and Escape retain chrome focus instead of reacquiring the active Game viewport', t => {
	const f = createActualSourcePanes(t), window = f.firstPart.window!;
	f.ide.boots.didReplaceMachine(); f.editor.interaction.setActive(true);
	const game = new GameViewInput(); f.firstGroup.openEditor(game); f.update(); f.firstPart.focus(); f.key('Tab');
	assert.ok(inputFocus.target?.guestInput?.recipient === f.host.input);
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	rightClickTitle(f, window);
	const menu = f.editor.contextMenu;
	assert.equal(menu.visible, true); assert.ok(menu.invocationOrigin === window.focusTarget);
	assert.ok(menu.focusTarget.commandContext === window.focusTarget);
	assert.ok(menu.model.rows.some(row => row.command === 'window.minimize'));
	assert.equal(f.editor.guestInputRecipient, null); assert.equal(pointerCapture.active, false);
	f.key('Escape');
	assert.equal(menu.visible, false); assert.ok(inputFocus.target === window.focusTarget);
	assert.equal(f.editor.guestInputRecipient, null); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

for (const key of ['ContextMenu', 'Shift+F10'] as const) test(`window chrome ${key} uses the existing local capability without entering content`, t => {
	const f = createActualSourcePanes(t), u = utility(t, f), menu = f.editor.contextMenu;
	u.window.focusTarget.focus();
	if (key === 'ContextMenu') f.key('ContextMenu'); else f.key('F10', KeyModifier.shift);
	assert.equal(menu.visible, true); assert.ok(menu.invocationOrigin === u.window.focusTarget);
	assert.ok(menu.model.selectedIndex >= 0 && menu.model.rows[menu.model.selectedIndex].enabled);
	assert.equal(menu.model.rows.some(row => row.command === 'window.minimize'), false);
	f.key('Escape');
	assert.ok(inputFocus.target === u.window.focusTarget); assert.equal(u.contentFocus(), 0);
});

test('utility window menu invokes its exact owner and accepts maximize/restore and snap without touching the editor host', t => {
	const f = createActualSourcePanes(t), u = utility(t, f);
	const source = f.firstGroup.model.activeTab, partPlacement = f.firstPart.window!.model.placement;
	rightClickTitle(f, u.window); choose(f, 'window.maximize'); assert.equal(u.model.placement, 'maximized');
	rightClickTitle(f, u.window);
	assert.equal(f.editor.contextMenu.model.rows.find(row => row.command === 'window.maximize')!.active, true);
	choose(f, 'window.maximize'); assert.equal(u.model.placement, 'normal');
	rightClickTitle(f, u.window); choose(f, 'window.snapLeft'); assert.equal(u.model.placement, 'left');
	rightClickTitle(f, u.window); choose(f, 'window.hide');
	assert.equal(u.model.open, false); assert.equal(f.firstPart.retired, false);
	assert.ok(f.firstGroup.model.activeTab === source); assert.equal(f.firstPart.window!.model.placement, partPlacement);
	assert.equal(u.contentFocus(), 0);
});

for (const retirement of ['hide', 'minimize', 'retire'] as const) test(`title menu presentation retires with its concrete window on ${retirement}`, t => {
	const f = createActualSourcePanes(t), window = f.firstPart.window!;
	rightClickTitle(f, window);
	const popup = f.editor.surfaces.findByScope(f.editor.contextMenu.pointerScope)!;
	assert.ok(popup.lifetimeOwner === window.surface);
	if (retirement === 'hide') window.hide();
	else if (retirement === 'minimize') f.editor.editorParts.minimize(f.firstPart);
	else window.detach();
	assert.equal(f.editor.contextMenu.visible, false); assert.equal(popup.retired, true);
	assert.equal(f.editor.surfaces.findByScope(popup.captureScope), undefined);
});

test('accepted window action survives popup disposal callbacks without overwriting their newer focus', t => {
	const f = createActualSourcePanes(t), u = utility(t, f);
	rightClickTitle(f, u.window);
	const popup = f.editor.surfaces.findByScope(f.editor.contextMenu.pointerScope)!;
	let retired = 0;
	f.editor.surfaces.attach({ role: 'feedback', lifetimeOwner: popup, presentationParent: popup,
		captureScope: Symbol('menu retirement observer'), isVisible: () => false,
		getBounds: popup.getBounds, getClip: popup.getClip, draw() {}, onRetire: () => { retired++; f.second.focus(); } });
	choose(f, 'window.snapRight');
	assert.equal(retired, 1); assert.equal(u.model.placement, 'right');
	assert.ok(inputFocus.target === f.second.commandTarget);
	assert.ok(f.editor.editorParts.activePart === f.secondPart && f.editor.editorParts.activeGroup === f.secondGroup,
		'the accepted old-window command must not replay activation over the newer actual control');
	assert.equal(u.contentFocus(), 0);
});

test('window menu Close uses the real local dirty-source decision rather than retiring its document immediately', async t => {
	const f = createActualSourcePanes(t), window = f.firstPart.window!, model = f.firstInput.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- local window close decision\n' }]);
	const source = model.buffer.getText(), version = model.version;
	rightClickTitle(f, window); choose(f, 'window.hide');
	assert.equal(f.firstPart.actionPrompt.visible, true); assert.equal(f.firstPart.retired, false);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	f.firstPart.actionPrompt.close('cancel'); await setImmediate();
	assert.equal(f.firstPart.retired, false); assert.equal(f.firstPart.actionPrompt.visible, false);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
	assert.ok(inputFocus.target === window.focusTarget);
});
