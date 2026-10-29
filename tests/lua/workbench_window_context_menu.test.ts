import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
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
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';

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

for (const kind of ['document', 'utility'] as const) for (const side of ['left', 'right'] as const)
test(`${kind} title menu restores its ${side}-snapped owner without changing another window or entering content`, t => {
	const f = createActualSourcePanes(t), u = kind === 'utility' ? utility(t, f) : undefined;
	const window = u === undefined ? f.firstPart.window! : u.window;
	const other = f.secondPart.window!, otherPlacement = other.model.placement;
	const input = f.firstGroup.model.activeTab;
	rightClickTitle(f, window); choose(f, side === 'left' ? 'window.snapLeft' : 'window.snapRight');
	assert.equal(window.model.placement, side);
	rightClickTitle(f, window); choose(f, 'window.restore');
	assert.equal(window.model.placement, 'normal'); assert.equal(other.model.placement, otherPlacement);
	assert.ok(inputFocus.admittedTarget === window.focusTarget);
	assert.ok(f.firstGroup.model.activeTab === input);
	if (u !== undefined) assert.equal(u.contentFocus(), 0);
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

test('Alt+Space addresses the document system menu while ordinary ContextMenu retains the actual Source subject', t => {
	const f = createActualSourcePanes(t), window = f.firstPart.window!, menu = f.editor.contextMenu;
	f.first.focus();
	const model = f.firstInput.workingCopy, version = model.version, source = model.buffer.getText();
	f.editor.dispatchKey(new KeyInputEvent('AltLeft', KeyModifier.alt));
	f.key('Space', KeyModifier.alt);
	f.editor.dispatchKey(new KeyInputEvent('AltLeft', KeyModifier.none, false, false));
	assert.equal(menu.visible, true); assert.ok(menu.invocationOrigin === window.focusTarget);
	assert.ok(menu.focusTarget.commandContext === window.focusTarget);
	assert.ok(menu.model.rows.some(row => row.command === 'window.move' && row.enabled));
	assert.ok(menu.model.rows.some(row => row.command === 'window.resize' && row.enabled));
	f.key('Escape'); assert.ok(inputFocus.admittedTarget === window.focusTarget);
	f.first.focus(); f.key('ContextMenu');
	assert.equal(menu.visible, true); assert.ok(menu.invocationOrigin === f.first.commandTarget);
	assert.equal(menu.model.rows.some(row => row.command === 'window.move' || row.command === 'window.resize'), false);
	f.key('Escape');
	assert.ok(inputFocus.admittedTarget === f.first.commandTarget);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.first.code.model === model);
	assert.equal(model.version, version); assert.equal(model.buffer.getText(), source);
});

for (const route of ['system-menu command', 'Alt+Space', 'Source Undo'] as const)
test(`native stacking publication preserves newer focus during ${route}`, t => {
	const f = createActualSourcePanes(t), window = f.firstPart.window!, model = f.firstInput.workingCopy;
	f.first.focus();
	if (route === 'Source Undo') model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained local draft\n' }]);
	const source = model.buffer.getText(), version = model.version, undo = model.canUndo;
	// A newer native sibling makes opening the old window menu publish a real raise.
	f.editor.surfaces.attach({ role: 'window', presentationParent: null, captureScope: Symbol('newer native sibling'),
		isVisible: () => true, getBounds: () => window.model.bounds, getClip: () => window.model.bounds, draw() {} });
	let redirected = 0;
	const unbind = inputFocus.onDidChangeTarget(() => {
		const windows = f.editor.surfaces.windowSurfaces;
		if (windows[windows.length - 1] !== window.surface) return;
		unbind(); redirected++; f.second.focus();
		assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	});
	t.after(unbind);
	if (route === 'system-menu command') f.editor.commands.execute('window.systemMenu', f.first.commandTarget);
	else if (route === 'Alt+Space') f.key('Space', KeyModifier.alt);
	else f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(redirected, 1); assert.equal(f.editor.contextMenu.visible, false);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	assert.ok(f.editor.editorParts.activePart === f.secondPart);
	assert.equal(window.interactionActive, false);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.canUndo, undo);
});

test('Alt+Space from a floated Main Activity uses its native shell rather than Main semantics or a background Source window', t => {
	const f = createActualSourcePanes(t), main = f.editor.mainWorkspace, menu = f.editor.contextMenu;
	main.openActivity('problems'); main.setActivityPlacement('floatingWindow'); f.update();
	const body = f.editor.problems.focusTarget, window = main.activityWindow;
	assert.ok(main.scope.contains(body.scope)); assert.ok(inputFocus.admittedTarget === body);
	const source = f.firstGroup.model.activeTab, documents = [...f.editor.editorParts.documents];
	const placement = f.firstPart.window!.model.placement, requested = { ...f.firstPart.window!.model.requestedBounds };
	f.key('Space', KeyModifier.alt);
	assert.equal(menu.visible, true); assert.ok(menu.invocationOrigin === window.focusTarget);
	choose(f, 'window.maximize');
	assert.equal(window.model.placement, 'maximized'); assert.equal(f.firstPart.window!.model.placement, placement);
	assert.deepEqual(f.firstPart.window!.model.requestedBounds, requested);
	assert.ok(f.firstGroup.model.activeTab === source && main.activity === f.editor.problems);
	assert.deepEqual(f.editor.editorParts.documents, documents);
	main.setActivityVisible(false); f.second.focus();
	assert.equal(f.editor.commands.isEnabled('window.systemMenu', body), false);
	f.editor.commands.execute('window.systemMenu', body);
	assert.equal(menu.visible, false); assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
});

for (const operation of ['move', 'resize'] as const)
	test(`system-menu ${operation} runs the exact utility owner without changing its document or entering content`, t => {
		const f = createActualSourcePanes(t), u = utility(t, f), window = u.window;
		const input = f.firstGroup.model.activeTab, source = f.firstInput.workingCopy.buffer.getText();
		const documentPlacement = f.firstPart.window!.model.placement, requested = { ...u.model.requestedBounds };
		let publications = 0;
		const unbind = u.model.onDidChangePlacement(() => publications++); t.after(unbind);
		window.clientFocusTarget.focus(); f.key('Space', KeyModifier.alt);
		assert.equal(f.editor.contextMenu.visible, true); assert.ok(f.editor.contextMenu.invocationOrigin === window.focusTarget);
		choose(f, `window.${operation}`);
		assert.equal(f.editor.contextMenu.visible, false); assert.ok(inputFocus.admittedTarget === window.focusTarget);
		f.key('ArrowRight');
		assert.deepEqual(u.model.requestedBounds, requested); assert.equal(publications, 0);
		f.key('Enter');
		assert.notDeepEqual(u.model.requestedBounds, requested); assert.equal(publications, 1);
		assert.ok(inputFocus.admittedTarget === window.focusTarget); assert.equal(u.contentFocus(), 0);
		assert.ok(f.firstGroup.model.activeTab === input); assert.equal(f.firstInput.workingCopy.buffer.getText(), source);
		assert.equal(f.firstPart.window!.model.placement, documentPlacement);
	});

for (const operation of ['move', 'resize'] as const)
	test(`accepted ${operation} cannot overwrite newer focus from system-menu dismissal or leave a latent draft`, t => {
		const f = createActualSourcePanes(t), u = utility(t, f), requested = { ...u.model.requestedBounds };
		rightClickTitle(f, u.window);
		const popup = f.editor.surfaces.findByScope(f.editor.contextMenu.pointerScope)!;
		let retired = 0;
		f.editor.surfaces.attach({ role: 'feedback', lifetimeOwner: popup, presentationParent: popup,
			captureScope: Symbol('keyboard operation dismissal'), isVisible: () => false,
			getBounds: popup.getBounds, getClip: popup.getClip, draw() {}, onRetire() { retired++; f.second.focus(); } });
		choose(f, `window.${operation}`);
		assert.equal(retired, 1); assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
		assert.deepEqual(u.model.requestedBounds, requested); assert.equal(u.contentFocus(), 0);
		u.window.focusTarget.focus(); f.key('Enter');
		assert.deepEqual(u.model.requestedBounds, requested);
		assert.ok(f.editor.editorParts.activePart === f.firstPart);
	});

for (const operation of ['move', 'resize'] as const) for (const origin of ['neutral', 'outside'] as const)
	test(`${origin} focus withdraws native keyboard ${operation} rather than offering an action that cannot begin`, t => {
		const f = createActualSourcePanes(t), window = f.firstPart.window!, command = `window.${operation}` as const;
		f.first.focus();
		const requested = { ...window.model.requestedBounds }, source = f.firstInput.workingCopy.buffer.getText();
		if (origin === 'neutral') inputFocus.setTarget(null);
		else f.second.focus();
		const target = origin === 'neutral' ? null : window.focusTarget;
		assert.equal(window.focusTarget.getCommand(command)!.isEnabled(), false);
		assert.equal(f.editor.commands.isEnabled(command, target), false);
		f.editor.commands.execute(command, target);
		assert.ok(inputFocus.admittedTarget === (origin === 'neutral' ? null : f.second.commandTarget));
		assert.deepEqual(window.model.requestedBounds, requested);
		if (origin === 'neutral') {
			f.key('F10');
			while (f.editor.menubar.activeMenu !== 'window') f.key('ArrowRight');
			assert.equal(f.editor.contextMenu.model.rows.find(row => row.command === command)!.enabled, false);
			f.key('Escape'); assert.equal(inputFocus.admittedTarget, null);
		}
		window.focusTarget.focus();
		const arrow = new KeyInputEvent('ArrowRight', KeyModifier.none); f.editor.dispatchKey(arrow);
		assert.equal(arrow.consumed, false, 'withdrawn admission cannot leave a keyboard geometry interaction armed');
		f.editor.dispatchKey(new KeyInputEvent('ArrowRight', KeyModifier.none, false, false));
		assert.deepEqual(window.model.requestedBounds, requested);
		assert.equal(f.firstInput.workingCopy.buffer.getText(), source);
	});

for (const operation of ['move', 'resize'] as const) for (const route of ['menubar', 'palette'] as const)
	test(`${route} keeps keyboard ${operation} admitted through its real native invocation and focus handoff`, t => {
		const f = createActualSourcePanes(t), u = utility(t, f), window = u.window, command = `window.${operation}` as const;
		const requested = { ...u.model.requestedBounds }, documentRequested = { ...f.firstPart.window!.model.requestedBounds };
		const model = f.firstInput.workingCopy, source = model.buffer.getText(), version = model.version;
		window.clientFocusTarget.focus();
		assert.equal(f.editor.commands.isEnabled(command, window.clientFocusTarget), true);
		if (route === 'menubar') {
			f.key('F10');
			while (f.editor.menubar.activeMenu !== 'window') f.key('ArrowRight');
			assert.equal(f.editor.contextMenu.model.rows.find(row => row.command === command)!.enabled, true);
			choose(f, command);
		} else {
			f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
			const picker = f.editor.quickInput;
			assert.equal(picker.visible, true);
			const item = (picker.model.items as readonly (CommandQuickPickItem & { readonly target: unknown })[])
				.find(item => item.command === command)!;
			assert.ok(item !== undefined && item.target === window.clientFocusTarget,
				'the Palette captures the actual native invoker, not its semantic document');
			assert.equal(f.editor.textTarget!.replaceText(0, 0, command), true); f.update();
			f.key('Enter'); assert.equal(picker.visible, false);
		}
		assert.ok(inputFocus.admittedTarget === window.focusTarget);
		f.key('ArrowRight');
		assert.deepEqual(u.model.requestedBounds, requested);
		f.key('Enter');
		assert.notDeepEqual(u.model.requestedBounds, requested);
		assert.ok(inputFocus.admittedTarget === window.focusTarget); assert.equal(u.contentFocus(), 0);
		assert.deepEqual(f.firstPart.window!.model.requestedBounds, documentRequested);
		assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.canUndo, false);
	});
