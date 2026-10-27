import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { FrameBitmap } from '../../hosts/common/frame_bitmap';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import type { EditorCommandId, EditorCommandRunner } from '../../ide/common/commands';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { insertValue, setFieldText } from '../../ide/editor/ui/inline/text_field';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../../ide/input/focus';
import { handleEditorCommandBindings } from '../../ide/input/keyboard/global_bindings';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { applyViewportSize, configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { getWorkbenchEditorBounds, refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchActionBarControl } from '../../ide/workbench/ui/action_bar_control';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import { captureInstalledLuaSources, registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { parseLuaChunk } from './cpu_test_harness';
import { createHostFrameFixture } from '../helpers/host_frame';
import { GameInputControl } from '../../ide/workbench/contrib/game_view/game_input';
import { editorChromeState } from '../../ide/workbench/ui/chrome_state';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';

/** Native key dispatch and real menu/popup owners in a source-backed workbench. */
function menuFixture(t: TestContext) {
	const source = 'local value = 42\nreturn value';
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, 'menu-source.lua'), [],
		{ entrySource: source, programDomain: 'system', optLevel: 0 }));
	const host = createHostFrameFixture(createTestRuntime(image.romBytes)); host.runtime.boot();
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'menu-source.lua',
		projectRootPath: '', can_boot_from_source: true, revision: 0 };
	registerLuaSourceRecord(registry, { resid: 'menu-source', type: 'lua', src: source, base_src: source,
		source_path: 'menu-source.lua', normalized_source_path: 'menu-source.lua', module_path: 'menu-source',
		update_timestamp: 0, base_update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports,
		captureInstalledLuaSources(registry, image.symbols!.metadata.compiledModulePaths), TEST_SYSTEM_CONTEXT_ID), cartridgeSlots: [null, null] };
	const unused = (): never => { throw new Error('Menu navigation does not request domain work.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 384, height: 288 }, sources, new Map(), unused, unused, unused);
	const editor = ide.editor;
	editor.editorGroup.openEditor(resolveLuaCodeEditorInput(sources.catalog, sources.catalog.resolveResource({ contextId: TEST_SYSTEM_CONTEXT_ID, path: registry.entrySourcePath })!));
	editorRuntimeState.active = true; host.input.setPointerAdmissionMode('routed'); editor.update(0);
	const pane = editor.editorGroup.panes.getPane('code_editor') as CodeEditorPane;
	const origin = inputFocus.target!, model = pane.code.model!, view = pane.code.view!;
	view.cursorRow = 1; view.cursorColumn = 6;
	const key = (code: string, modifiers = KeyModifier.none, down = true, repeat = false) => {
		const event = new KeyInputEvent(code, modifiers, repeat, down); editor.dispatchKey(event); editor.update(0); return event;
	};
	t.after(async () => { inputFocus.setTarget(null); await editor.shutdown(); host.audio.dispose(); host.input.dispose(); });
	return { editor, host, origin, model, view, source, key };
}

test('Files focus is idempotent and retains its selection and source working copy while Ctrl+B still toggles visibility', t => {
	const { editor, host, origin, model, view, source, key } = menuFixture(t);
	const panel = editor.resourcePanel, input = editor.editorGroup.panes.activePane!.input;
	const version = model.version, cycles = host.runtime.machine.scheduler.nowCycles;
	assert.equal(panel.visible, false);
	assert.equal(key('KeyE', KeyModifier.ctrl | KeyModifier.shift).consumed, true);
	assert.equal(panel.isVisible(), true); assert.equal(panel.isFocused(), true);
	assert.equal(panel.getMode(), 'resources');
	key('Home'); const root = panel.files.selectedNode!;
	assert.equal(root.element.kind, 'root');
	key('ArrowRight'); key('ArrowRight');
	const selected = panel.files.selectedNode!;
	assert.ok(selected.element.kind === 'file' && selected.element.resource === model.resource);
	assert.equal(root.collapsed, false);

	assert.equal(key('KeyE', KeyModifier.ctrl | KeyModifier.shift).consumed, true);
	assert.equal(panel.isVisible(), true); assert.equal(panel.isFocused(), true);
	assert.ok(panel.files.selectedNode === selected);
	key('Tab'); assert.equal(panel.isVisible(), true); assert.ok(inputFocus.target === origin);
	assert.equal(key('KeyE', KeyModifier.meta | KeyModifier.shift).consumed, true);
	assert.equal(panel.isVisible(), true); assert.equal(panel.isFocused(), true);
	assert.ok(panel.files.selectedNode === selected);

	key('KeyB', KeyModifier.ctrl);
	assert.equal(panel.visible, false); assert.ok(inputFocus.target === origin);
	key('KeyB', KeyModifier.ctrl);
	assert.equal(panel.isVisible(), true); assert.equal(panel.isFocused(), true);
	assert.ok(panel.files.selectedNode === selected); assert.equal(root.collapsed, false);
	key('KeyB', KeyModifier.ctrl);
	assert.equal(panel.visible, false); assert.ok(inputFocus.target === origin);
	assert.equal(key('KeyE', KeyModifier.ctrl | KeyModifier.shift).consumed, true);
	assert.equal(panel.isVisible(), true); assert.equal(panel.isFocused(), true);
	assert.ok(panel.files.selectedNode === selected); assert.equal(root.collapsed, false);

	assert.ok(editor.editorGroup.panes.activePane!.input === input);
	assert.ok((editor.editorGroup.panes.getPane('code_editor') as CodeEditorPane).code.model === model
		&& (editor.editorGroup.panes.getPane('code_editor') as CodeEditorPane).code.view === view);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.canUndo, false);
	assert.equal(view.cursorRow, 1); assert.equal(view.cursorColumn, 6); assert.equal(view.selectionAnchor, null);
	assert.equal(host.runtime.machine.scheduler.nowCycles, cycles);
});

test('clean AltLeft release and F10 use the real menu session and return the source caret without editing it', t => {
	const { editor, origin, model, view, source, key } = menuFixture(t);
	const version = model.version;
	key('AltLeft', KeyModifier.alt);
	assert.equal(editor.contextMenu.visible, false, 'Alt down alone does not move source focus');
	assert.ok(inputFocus.target === origin);
	const release = key('AltLeft', KeyModifier.none, false);
	assert.equal(release.consumed, true); assert.equal(editor.contextMenu.visible, true);
	assert.ok(inputFocus.target === editor.contextMenu.focusTarget); assert.ok(editor.contextMenu.model.selectedIndex >= 0);
	key('ArrowRight'); assert.equal(editor.contextMenu.visible, true);
	key('Escape'); assert.equal(editor.contextMenu.visible, false); assert.ok(inputFocus.target === origin);
	const f10 = key('F10'); assert.equal(f10.consumed, true); assert.equal(editor.contextMenu.visible, true);
	key('F10', KeyModifier.none, false); assert.equal(editor.contextMenu.visible, true);
	key('F10'); assert.equal(editor.contextMenu.visible, false); assert.ok(inputFocus.target === origin);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.canUndo, false);
	assert.ok((editor.editorGroup.panes.getPane('code_editor') as CodeEditorPane).code.view === view); assert.equal(view.cursorRow, 1); assert.equal(view.cursorColumn, 6);
});

test('F10 preserves the concrete step-over binding while closed and dismisses only an admitted menu', t => {
	const { editor, origin, key } = menuFixture(t);
	let enabled = true, steps = 0;
	assert.equal(origin.getCommand('debugStepOver'), undefined);
	// This is the actual source focus owner. The contract is action admission,
	// not CPU stepping, so its concrete capability records whether it was run.
	origin.registerCommand('debugStepOver', { isEnabled: () => enabled, run: () => { steps++; } });
	t.after(() => origin.unregisterCommand('debugStepOver'));
	assert.equal(key('F10').consumed, true);
	assert.equal(steps, 1); assert.equal(editor.contextMenu.visible, false); assert.equal(editor.menubar.expanded, false);
	assert.ok(inputFocus.target === origin);
	enabled = false;
	assert.equal(key('F10').consumed, true);
	assert.equal(steps, 1); assert.equal(editor.contextMenu.visible, false, 'a disabled concrete binding is not permission to borrow Main Menu');
	key('AltLeft', KeyModifier.alt); key('AltLeft', KeyModifier.none, false);
	assert.equal(editor.contextMenu.visible, true);
	assert.equal(key('F10').consumed, true);
	assert.equal(steps, 1); assert.equal(editor.contextMenu.visible, false); assert.ok(inputFocus.target === origin);
});

test('the real menubar popup owns its F10 binding only for its admitted menu lifetime', t => {
	const { editor, origin, key } = menuFixture(t);
	let steps = 0;
	origin.registerCommand('debugStepOver', { isEnabled: () => true, run: () => { steps++; } });
	t.after(() => origin.unregisterCommand('debugStepOver'));
	key('AltLeft', KeyModifier.alt); key('AltLeft', KeyModifier.none, false);
	const popup = editor.contextMenu.focusTarget;
	const first = new KeyInputEvent('F10', KeyModifier.none);
	// Deliberately enter the ordinary binding owner, not Menubar.handleKeyboard.
	assert.equal(handleEditorCommandBindings(first, inputFocus.commandRunner, inputFocus.admittedTarget), true,
		'the admitted popup publishes its own menu action to the normal keybinding resolver');
	assert.equal(first.consumed, true); assert.equal(editor.contextMenu.visible, false); assert.ok(inputFocus.target === origin);
	assert.equal(popup.getCommand('menubar.focus'), undefined); assert.equal(steps, 0);
	key('AltLeft', KeyModifier.alt); key('AltLeft', KeyModifier.none, false);
	assert.ok(popup.getCommand('menubar.focus')?.isEnabled());
	key('ArrowRight'); assert.ok(popup.getCommand('menubar.focus')?.isEnabled(), 'category replacement retains the admitted menu capability');
	const switched = new KeyInputEvent('F10', KeyModifier.none);
	assert.equal(handleEditorCommandBindings(switched, inputFocus.commandRunner, inputFocus.admittedTarget), true);
	assert.equal(editor.contextMenu.visible, false); assert.equal(popup.getCommand('menubar.focus'), undefined);
	key('AltLeft', KeyModifier.alt); key('AltLeft', KeyModifier.none, false); key('Escape');
	assert.equal(popup.getCommand('menubar.focus'), undefined);
	key('AltLeft', KeyModifier.alt); key('AltLeft', KeyModifier.none, false);
	editor.contextMenu.show(80, 40, [{ type: 'command', command: 'save' }], editor.commands);
	assert.equal(editor.menubar.expanded, false); assert.equal(popup.getCommand('menubar.focus'), undefined);
	assert.ok(popup.commandContext === origin); assert.ok(origin.getCommand('debugStepOver')?.isEnabled());
	const ordinary = new KeyInputEvent('F10', KeyModifier.none);
	assert.equal(handleEditorCommandBindings(ordinary, inputFocus.commandRunner, inputFocus.admittedTarget), false);
	assert.equal(ordinary.consumed, false); assert.equal(editor.contextMenu.visible, true); assert.equal(steps, 0);
});

test('menubar focus admission publishes and retires its normal F10 capability synchronously', t => {
	const { editor, origin } = menuFixture(t), popup = editor.contextMenu.focusTarget;
	let focused = 0;
	const unbind = popup.onDidFocus(() => {
		focused++;
		assert.ok(popup.getCommand('menubar.focus')?.isEnabled(), 'the popup capability exists before focus is published');
		const event = new KeyInputEvent('F10', KeyModifier.none);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner, inputFocus.admittedTarget), true);
		assert.equal(event.consumed, true);
	});
	t.after(unbind);
	editor.commands.execute('menubar.focus', origin);
	assert.equal(focused, 1); assert.equal(editor.contextMenu.visible, false); assert.equal(editor.menubar.expanded, false);
	assert.equal(popup.getCommand('menubar.focus'), undefined); assert.ok(inputFocus.target === origin);
});

test('AltRight, modifier chords, repeats and cancelled AltLeft candidates never activate the real menu', t => {
	const { editor, host, origin, key } = menuFixture(t);
	for (const code of ['AltRight', 'AltLeft'] as const) {
		key(code, KeyModifier.ctrl | KeyModifier.alt); key(code, KeyModifier.ctrl, false);
		assert.equal(editor.contextMenu.visible, false); assert.ok(inputFocus.target === origin);
	}
	key('AltRight', KeyModifier.alt); key('AltRight', KeyModifier.none, false);
	assert.equal(editor.contextMenu.visible, false);
	key('AltLeft', KeyModifier.alt, true, true); key('AltLeft', KeyModifier.none, false);
	assert.equal(editor.contextMenu.visible, false, 'a repeat without a fresh down cannot start a menu gesture');
	key('AltLeft', KeyModifier.alt); key('KeyQ', KeyModifier.alt); key('AltLeft', KeyModifier.none, false);
	assert.equal(editor.contextMenu.visible, false, 'an ordinary Alt chord is not a clean release');
	const consumed = new KeyInputEvent('AltLeft', KeyModifier.alt); consumed.consumed = true; editor.dispatchKey(consumed);
	key('AltLeft', KeyModifier.none, false); assert.equal(editor.contextMenu.visible, false);
	key('AltLeft', KeyModifier.alt);
	const bounds = getWorkbenchEditorBounds(), x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
	editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.alt, spaceDown: false, timestamp: 0 });
	editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.alt, spaceDown: false, timestamp: 0 });
	key('AltLeft', KeyModifier.none, false); assert.equal(editor.contextMenu.visible, false, 'a pointer gesture disqualifies the pending Alt release');
	key('AltLeft', KeyModifier.alt); editor.cancelInput(); key('AltLeft', KeyModifier.none, false);
	assert.equal(editor.contextMenu.visible, false, 'native input cancellation retires the candidate');
	key('AltLeft', KeyModifier.alt); host.input.resetInput('keyboard:0'); key('AltLeft', KeyModifier.none, false);
	assert.equal(editor.contextMenu.visible, false, 'physical keyboard retirement retires the same candidate');
	key('AltLeft', KeyModifier.alt); key('AltLeft', KeyModifier.none, false);
	assert.equal(editor.contextMenu.visible, true, 'a fresh clean press remains available after cancellation');
	editor.cancelInput(); assert.equal(editor.contextMenu.visible, true, 'internal text-owner blur cancels input, not the admitted menu session');
	key('Escape'); assert.ok(inputFocus.target === origin);
});

test('physical menu gestures remain guest input while a real scanout client has focus', t => {
	const { editor, host, origin, key } = menuFixture(t);
	const game = new GameInputControl(origin, host.input, { kind: 'direct', presenter: host.presenter });
	game.setInput({ left: 80, top: 32, right: 320, bottom: 240 }); game.focusTarget.focus();
	t.after(() => game.dispose());
	const binding = game.focusTarget.guestInput!;
	for (const event of [key('F10'), key('AltLeft', KeyModifier.alt), key('AltLeft', KeyModifier.none, false),
		key('AltRight', KeyModifier.alt), key('AltRight', KeyModifier.none, false)]) {
		assert.equal(event.consumed, false); assert.equal(editor.contextMenu.visible, false);
		assert.ok(inputFocus.target === game.focusTarget); assert.ok(game.focusTarget.guestInput === binding);
	}
	game.clearInput(); key('AltLeft', KeyModifier.none, false);
	assert.equal(editor.contextMenu.visible, false, 'a guest Alt down never arms a later Studio release');
	key('AltLeft', KeyModifier.alt); game.setInput(binding.bounds); game.focusTarget.focus();
	key('AltLeft', KeyModifier.none, false); game.clearInput(); key('AltLeft', KeyModifier.none, false);
	assert.equal(editor.contextMenu.visible, false, 'changing focus into a guest retires a Studio-only candidate');
});

test('empty-group Studio retirement and blocked admission cannot carry an Alt candidate into a later session', t => {
	const { editor, origin, key } = menuFixture(t);
	key('AltLeft', KeyModifier.alt);
	const extent = { left: 0, top: 0, right: 384, bottom: 288 };
	const blocker = editor.surfaces.attach({ role: 'modal', blockedScope: null, captureScope: Symbol('blocking menu admission'),
		isVisible: () => true, getBounds: () => extent, getClip: () => extent, draw() {} });
	assert.ok(inputFocus.target === origin); assert.equal(inputFocus.admittedTarget, null);
	key('ShiftLeft', KeyModifier.alt | KeyModifier.shift);
	blocker.dispose(); key('AltLeft', KeyModifier.none, false);
	assert.equal(editor.contextMenu.visible, false, 'a temporarily blocked owner does not retain an armed gesture');
	for (const tab of [...editor.editorGroup.model.tabs]) editor.editorGroup.close(tab.id);
	assert.equal(inputFocus.target, null);
	key('AltLeft', KeyModifier.alt); editor.deactivate(); editor.activate(); key('AltLeft', KeyModifier.none, false);
	assert.equal(editor.contextMenu.visible, false, 'empty-group retirement cancels Alt even without a focused control to blur');
	key('AltLeft', KeyModifier.alt); key('AltLeft', KeyModifier.none, false);
	assert.equal(editor.contextMenu.visible, true, 'the next clean empty-group gesture is admitted normally');
});

test('the real Menu icon remains pointer-accessible with ordinary, overflowing and empty editor groups', t => {
	const { editor, origin, key } = menuFixture(t);
	const sourceTab = editor.editorGroup.model.tabs[0];
	for (const group of ['ordinary', 'overflow', 'empty'] as const) {
		if (group === 'overflow') {
			editor.editorGroup.openEditor(new GameViewInput()); editor.editorGroup.activate(sourceTab.id);
			editor.updateViewport({ width: 96, height: 288 });
		} else if (group === 'empty') for (const tab of [...editor.editorGroup.model.tabs]) editor.editorGroup.close(tab.id);
		for (const variant of ['tiny', 'msx'] as const) {
			editor.setFontVariant(variant); editor.update(0);
			if (group === 'overflow') assert.equal(editor.editorGroup.tabStrip.scrollbar.isVisible(), true);
			const bounds = editorChromeState.menuButtonBounds;
			assert.ok(bounds.right > bounds.left && bounds.bottom > bounds.top, 'Menu retains an actual pointer target without an editor');
			const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
			editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
				releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 });
			editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary,
				cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 }); editor.update(0);
			assert.equal(editor.contextMenu.visible, true);
			key('Escape'); assert.equal(editor.contextMenu.visible, false);
			if (group !== 'empty') assert.ok(inputFocus.target === origin);
			else assert.equal(editor.editorGroup.panes.activePane, null);
		}
	}
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} game chrome and Timeline menus retain visibility intent without stealing guest secondary input`, t => {
	const f = menuFixture(t), game = new GameViewInput();
	f.editor.editorGroup.openEditor(game); f.editor.setFontVariant(variant); f.editor.update(0);
	const content = inputFocus.target!, version = f.model.version, cycles = f.host.runtime.machine.scheduler.nowCycles;
	const x = game.layout.left + 1, y = game.layout.top + 1;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Secondary, pressedButtons: PointerButton.Secondary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 });
	f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Secondary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 }); f.editor.update(0);
	const menu = f.editor.contextMenu, timeline = f.editor.runtimeTimeline;
	assert.equal(menu.visible, true); assert.ok(menu.invocationOrigin === content && menu.returnFocus === content);
	assert.equal(menu.model.rows[0].command, 'runtime.toggleTimeline'); assert.equal(menu.model.rows[0].enabled, true);
	f.key('Escape'); f.key('Escape', KeyModifier.none, false); assert.ok(inputFocus.target === content);
	f.key('ContextMenu'); f.key('ContextMenu', KeyModifier.none, false);
	assert.equal(menu.visible, true); assert.ok(menu.invocationOrigin === content);
	f.key('Home'); f.key('Home', KeyModifier.none, false); f.key('Enter'); f.key('Enter', KeyModifier.none, false);
	assert.equal(timeline.requested, true); assert.equal(timeline.visible, true);
	const timelineFocus = inputFocus.target!;
	f.key('ContextMenu'); f.key('ContextMenu', KeyModifier.none, false);
	assert.equal(menu.visible, true); assert.ok(menu.invocationOrigin === timelineFocus && menu.returnFocus === timelineFocus);
	assert.equal(menu.model.rows[0].active, true);
	f.key('Escape'); f.key('Escape', KeyModifier.none, false); assert.ok(inputFocus.target === timelineFocus);
	f.key('ContextMenu'); f.key('ContextMenu', KeyModifier.none, false);
	f.key('Home'); f.key('Home', KeyModifier.none, false); f.key('Enter'); f.key('Enter', KeyModifier.none, false);
	assert.equal(timeline.requested, false); assert.equal(timeline.visible, false); assert.ok(inputFocus.target === content);
	const frameX = (game.frameBounds.left + game.frameBounds.right) / 2, frameY = (game.frameBounds.top + game.frameBounds.bottom) / 2;
	f.editor.dispatchPointer({ x: frameX, y: frameY, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 });
	f.editor.dispatchPointer({ x: frameX, y: frameY, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 });
	const guest = inputFocus.target!, binding = guest.guestInput;
	assert.ok(binding !== undefined);
	f.editor.dispatchPointer({ x: frameX, y: frameY, buttons: PointerButton.Secondary, pressedButtons: PointerButton.Secondary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 });
	assert.equal(menu.visible, false); assert.ok(pointerCapture.guestBinding === binding && inputFocus.target === guest);
	f.editor.dispatchPointer({ x: frameX, y: frameY, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Secondary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 });
	assert.equal(menu.visible, false); assert.ok(inputFocus.target === guest);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.version, version); assert.equal(f.model.canUndo, false);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('a requested primary GamePanel supplies Timeline beside Source without coupling its transport to admitted preview geometry', t => {
	const f = menuFixture(t), timeline = f.editor.runtimeTimeline, version = f.model.version;
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	f.editor.updateViewport({ width: 700, height: 288 });
	f.editor.commands.execute('gameView.togglePanel'); f.editor.update(0);
	assert.equal(f.editor.gamePanel.visible, true); assert.equal(f.editor.gamePanel.enabled, true);
	assert.ok(f.editor.gamePanel.runtimeTransport === f.editor.commands.transport);
	assert.ok(f.editor.gamePanel.runtimeTransport!.navigation === f.editor.commands.transport.navigation);
	assert.equal(timeline.available, true); assert.equal(timeline.requested, false); assert.equal(timeline.visible, false);
	const bounds = getWorkbenchEditorBounds(), x = bounds.right + 6, y = bounds.top + 1;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Secondary, pressedButtons: PointerButton.Secondary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 });
	f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Secondary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 }); f.editor.update(0);
	assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.editor.contextMenu.model.rows[0].command, 'runtime.toggleTimeline');
	assert.equal(f.editor.contextMenu.model.rows[0].enabled, true);
	f.key('Home'); f.key('Home', KeyModifier.none, false); f.key('Enter'); f.key('Enter', KeyModifier.none, false);
	assert.equal(timeline.requested, true); assert.equal(timeline.visible, true);
	// The offered height withholds the preview; it must not alternate the logical
	// target and Timeline inset on subsequent composition passes.
	f.editor.updateViewport({ width: 700, height: 100 });
	for (let frame = 0; frame < 20; frame++) {
		f.editor.update(0);
		assert.equal(f.editor.gamePanel.visible, false); assert.equal(f.editor.gamePanel.enabled, true);
		assert.equal(timeline.available, true); assert.equal(timeline.visible, true);
		assert.equal(editorChromeState.runtimeTimelineHeight, timeline.height);
		assert.ok(f.editor.gamePanel.runtimeTransport === f.editor.commands.transport);
	}
	f.editor.commands.execute('runtime.toggleTimeline'); f.editor.update(0);
	assert.equal(timeline.requested, false); assert.equal(timeline.visible, false);
	f.editor.updateViewport({ width: 700, height: 288 }); f.editor.update(0);
	assert.equal(f.editor.gamePanel.visible, true); assert.equal(timeline.visible, false);
	const game = new GameViewInput(); f.editor.editorGroup.openEditor(game); f.editor.update(0);
	assert.equal(f.editor.gamePanel.enabled, true); assert.equal(f.editor.gamePanel.visible, false);
	assert.equal(f.editor.gamePanel.runtimeControlContext, undefined); assert.equal(f.editor.gamePanel.runtimeTransport, undefined);
	assert.ok(f.editor.editorGroup.panes.activePane!.runtimeTransport === f.editor.commands.transport);
	assert.equal(timeline.available, true, 'the selected Game view owns its own target rather than borrowing a hidden companion');
	const source = f.editor.editorGroup.model.tabs.find(tab => tab.kind === 'code_editor')!;
	f.editor.editorGroup.activate(source.id); f.editor.update(0);
	f.editor.commands.execute('gameView.closePanel'); f.editor.update(0);
	assert.equal(timeline.available, false); assert.equal(timeline.requested, false);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.version, version); assert.equal(f.model.canUndo, false);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

function fixture(t: TestContext, scope = new InputFocusScope(Symbol('control')), focusReturn: InputFocusTarget | null = null) {
	const parent = inputFocus.createTarget(focusReturn, scope);
	parent.bindKeyboard(() => {});
	const accepted: string[] = [], executed: EditorCommandId[] = [], checked: EditorCommandId[] = [];
	const control = new ValueInput(parent, {
		options: { allowSpace: true, singleLine: true }, invalidBlurMessage: 'Draft rejected',
		format: (value: string) => value, parse: text => ({ value: text }),
	}, value => accepted.push(value));
	control.setValue('123456'); control.field.focusTarget.focus();
	const commands: EditorCommandRunner = {
		isEnabled(command) { checked.push(command); return command !== 'scenarioLab.run'; },
		execute(command) { executed.push(command); },
	};
	inputFocus.workbenchScope.commands = commands;
	t.after(() => { control.cancel(); inputFocus.setTarget(null); control.dispose(); inputFocus.workbenchScope.commands = undefined; });
	return { parent, control, commands, scope, accepted, executed, checked };
}

for (const primary of [KeyModifier.ctrl, KeyModifier.meta]) test(`a focused control routes ${primary === KeyModifier.ctrl ? 'Ctrl' : 'Cmd'} Undo and both Redo bindings to its actual draft history`, t => {
	const f = fixture(t), target = f.control.field.focusTarget;
	insertValue(f.control.field, '1234567');
	for (const [code, modifiers, expected, repeat] of [
		['KeyZ', primary, '123456', false],
		['KeyZ', primary | KeyModifier.shift, '1234567', false],
		['KeyZ', primary, '123456', true],
		['KeyY', primary, '1234567', false],
	] as const) {
		const event = new KeyInputEvent(code, modifiers, repeat);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner, target), true);
		assert.equal(event.consumed, true); assert.equal(f.control.field.text, expected);
	}
	assert.deepEqual(f.accepted, [], 'local Undo/Redo never accepts the property or writes its source');
	assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('empty or read-only local history consumes its binding without borrowing underlying document Undo', t => {
	const f = fixture(t, inputFocus.workbenchScope), target = f.control.field.focusTarget;
	assert.equal(inputFocus.commandRunner, f.commands);
	let documentUndos = 0;
	f.parent.registerCommand('undo', { isEnabled: () => true, run: () => { documentUndos++; } });
	target.commandContext = f.parent;
	const empty = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(empty, inputFocus.commandRunner, target), true);
	assert.equal(empty.consumed, true); assert.equal(f.control.field.text, '123456');
	insertValue(f.control.field, '1234567'); f.control.field.readOnly = true;
	const readOnly = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(readOnly, inputFocus.commandRunner, target), true);
	assert.equal(readOnly.consumed, true); assert.equal(f.control.field.text, '1234567');
	assert.equal(documentUndos, 0); assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('an actual control owns its history even when its commandContext alias has no Undo command', t => {
	const f = fixture(t), target = f.control.field.focusTarget;
	target.commandContext = f.parent;
	assert.equal(f.parent.getCommand('undo'), undefined);
	insertValue(f.control.field, '1234567');
	const event = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner, target), true);
	assert.equal(event.consumed, true); assert.equal(f.control.field.text, '123456');
	assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('a menu commandContext alias cannot admit the underlying field history as its own keyboard command', t => {
	const f = fixture(t), source = new TextField();
	setFieldText(source, 'source before', true); insertValue(source, ' changed');
	const menu = inputFocus.createTarget(null, new InputFocusScope(Symbol('menu'))); menu.commandContext = source.focusTarget; menu.focus();
	assert.equal(source.canUndo, true); assert.equal(menu.getCommand('undo'), undefined);
	const event = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner, menu), false);
	assert.equal(event.consumed, false); assert.equal(source.text, 'source before changed');
	assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('an available application runner does not make an aliased field command applicable to the focused toolbar', t => {
	const f = fixture(t, inputFocus.workbenchScope), source = new TextField(f.parent);
	setFieldText(source, 'source before', true); insertValue(source, ' changed');
	let contextMenus = 0;
	source.focusTarget.registerCommand('contextMenu', { isEnabled: () => true, run: () => { contextMenus++; } });
	const toolbar = inputFocus.createTarget(f.parent);
	toolbar.commandContext = source.focusTarget; toolbar.focus();
	assert.equal(inputFocus.commandRunner, f.commands);
	assert.equal(source.canUndo, true);
	assert.equal(toolbar.getCommand('undo'), undefined); assert.equal(toolbar.getCommand('contextMenu'), undefined);
	for (const [code, modifiers] of [['KeyZ', KeyModifier.ctrl], ['ContextMenu', KeyModifier.none]] as const) {
		const event = new KeyInputEvent(code, modifiers);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner), false);
		assert.equal(event.consumed, false);
	}
	assert.equal(source.text, 'source before changed'); assert.equal(contextMenus, 0);
	assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('isolated controls cannot route workbench Save, runtime or palette commands', t => {
	const f = fixture(t), target = f.control.field.focusTarget;
	assert.equal(inputFocus.workbenchScope.commands, f.commands, 'a real application runner exists outside this control scope');
	assert.equal(inputFocus.commandRunner, undefined, 'the isolated focus ancestry has no route to that application');
	insertValue(f.control.field, '1234567');
	for (const [code, modifiers] of [
		['KeyS', KeyModifier.ctrl], ['F5', KeyModifier.none], ['KeyP', KeyModifier.ctrl | KeyModifier.shift],
	] as const) {
		const event = new KeyInputEvent(code, modifiers);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner, target), false);
		assert.equal(event.consumed, false);
		target.handleKeyboard(event);
		assert.equal(f.control.field.text, '1234567');
	}
	assert.deepEqual(f.accepted, []); assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('a property popup inherits its actual isolated command owner, not its focus-return target or command alias', t => {
	const isolatedOwner = new InputFocusScope(Symbol('modal owner'));
	const popupScope = new InputFocusScope(Symbol('property popup'), isolatedOwner);
	const workbenchReturn = inputFocus.createTarget();
	const f = fixture(t, popupScope, workbenchReturn);
	f.control.field.focusTarget.commandContext = workbenchReturn;
	assert.equal(f.control.field.focusTarget.scope, popupScope);
	assert.equal(f.parent.parent, workbenchReturn);
	assert.equal(inputFocus.workbenchScope.commands, f.commands);
	assert.equal(inputFocus.commandRunner, undefined);
	insertValue(f.control.field, '1234567');
	const undo = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(undo, inputFocus.commandRunner), true);
	assert.equal(f.control.field.text, '123456');
	const palette = new KeyInputEvent('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(handleEditorCommandBindings(palette, inputFocus.commandRunner), false);
	assert.equal(palette.consumed, false); assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('an owned property popup resolves live workbench bindings and retires them when their actual owner unbinds', t => {
	const ownerScope = new InputFocusScope(Symbol('pane'), inputFocus.workbenchScope);
	const popupScope = new InputFocusScope(Symbol('property popup'), ownerScope);
	const f = fixture(t, popupScope);
	inputFocus.workbenchScope.commands = undefined;
	assert.equal(inputFocus.commandRunner, undefined);
	const beforeBinding = new KeyInputEvent('KeyS', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(beforeBinding, inputFocus.commandRunner), false);
	inputFocus.workbenchScope.commands = f.commands;
	assert.equal(inputFocus.commandRunner, f.commands);
	const save = new KeyInputEvent('KeyS', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(save, inputFocus.commandRunner), true);
	assert.deepEqual(f.executed, ['save']);
	const nearerCalls: EditorCommandId[] = [];
	const nearer: EditorCommandRunner = { isEnabled: () => true, execute: command => { nearerCalls.push(command); } };
	ownerScope.commands = nearer;
	assert.equal(inputFocus.commandRunner, nearer);
	const palette = new KeyInputEvent('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(handleEditorCommandBindings(palette, inputFocus.commandRunner), true);
	assert.deepEqual(nearerCalls, ['commandPalette']); assert.deepEqual(f.executed, ['save']);
	inputFocus.workbenchScope.commands = undefined;
	assert.equal(inputFocus.commandRunner, nearer, 'an unrelated root teardown cannot remove the nearer owner');
	ownerScope.commands = undefined;
	assert.equal(inputFocus.commandRunner, undefined);
	const afterTeardown = new KeyInputEvent('KeyS', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(afterTeardown, inputFocus.commandRunner), false);
	insertValue(f.control.field, '1234567');
	const undo = new KeyInputEvent('KeyZ', KeyModifier.ctrl);
	assert.equal(handleEditorCommandBindings(undo, inputFocus.commandRunner), true);
	assert.equal(f.control.field.text, '123456', 'unbinding application commands cannot disable the control-owned draft history');
});

test('the ordinary workbench route still resolves and executes global bindings through its actual scope runner', t => {
	const f = fixture(t, inputFocus.workbenchScope);
	assert.equal(inputFocus.commandRunner, f.commands);
	for (const [code, modifiers, command] of [
		['KeyS', KeyModifier.ctrl, 'save'], ['F5', KeyModifier.none, 'debugContinue'],
		['KeyP', KeyModifier.ctrl | KeyModifier.shift, 'commandPalette'],
	] as const) {
		const event = new KeyInputEvent(code, modifiers);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner), true);
		assert.equal(event.consumed, true); assert.equal(f.executed.at(-1), command);
	}
	assert.deepEqual(f.executed, ['save', 'debugContinue', 'commandPalette']);
	assert.ok(f.checked.includes('save')); assert.ok(f.checked.includes('debugContinue'));
	assert.ok(f.checked.includes('commandPalette'));
});

test('key releases and consumed events do not repeat a control command', t => {
	const f = fixture(t), target = f.control.field.focusTarget;
	insertValue(f.control.field, '1234567');
	const release = new KeyInputEvent('KeyZ', KeyModifier.ctrl, false, false);
	assert.equal(handleEditorCommandBindings(release, inputFocus.commandRunner, target), false);
	const consumed = new KeyInputEvent('KeyZ', KeyModifier.ctrl); consumed.consumed = true;
	assert.equal(handleEditorCommandBindings(consumed, inputFocus.commandRunner, target), false);
	assert.equal(f.control.field.text, '1234567'); assert.deepEqual(f.executed, []);
});

for (const primary of [KeyModifier.ctrl, KeyModifier.meta]) {
	test(`${primary === KeyModifier.ctrl ? 'Ctrl' : 'Cmd'} F invokes only the actual focused list Find capability`, t => {
		const f = fixture(t, inputFocus.workbenchScope), target = inputFocus.createTarget(f.parent);
		let finds = 0, checks = 0;
		const command = { isEnabled: () => { checks++; return true; }, run: () => { assert.equal(inputFocus.target, target); finds++; } };
		target.registerCommand('list.find', command);
		target.commandContext = f.control.field.focusTarget;
		target.focus();
		assert.equal(inputFocus.commandRunner, f.commands);
		assert.equal(target.getCommand('list.find'), command);
		assert.equal(target.commandContext.getCommand('list.find'), undefined);
		const event = new KeyInputEvent('KeyF', primary);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner), true);
		assert.equal(event.consumed, true); assert.equal(finds, 1); assert.equal(checks, 1);
		for (const ignored of [new KeyInputEvent('KeyF', primary, true), new KeyInputEvent('KeyF', primary, false, false)]) {
			assert.equal(handleEditorCommandBindings(ignored, inputFocus.commandRunner), false);
			assert.equal(ignored.consumed, false);
		}
		const consumed = new KeyInputEvent('KeyF', primary); consumed.consumed = true;
		assert.equal(handleEditorCommandBindings(consumed, inputFocus.commandRunner), false);
		assert.equal(finds, 1); assert.equal(checks, 1);
		assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
	});

	test(`disabled own list Find consumes ${primary === KeyModifier.ctrl ? 'Ctrl' : 'Cmd'} F without borrowing its alias or application`, t => {
		const f = fixture(t, inputFocus.workbenchScope), target = inputFocus.createTarget(f.parent);
		let aliasFinds = 0, checks = 0;
		f.parent.registerCommand('list.find', { isEnabled: () => true, run: () => { aliasFinds++; } });
		target.registerCommand('list.find', { isEnabled: () => { checks++; return false; }, run: () => assert.fail('disabled Find ran') });
		target.commandContext = f.parent; target.focus();
		const event = new KeyInputEvent('KeyF', primary);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner), true);
		assert.equal(event.consumed, true); assert.equal(aliasFinds, 0); assert.equal(checks, 1);
		assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
	});
}

test('a parent or commandContext cannot lend list Find to a field, menu or toolbar, even with an application runner', t => {
	const f = fixture(t, inputFocus.workbenchScope);
	configureFontVariant('tiny');
	applyViewportSize({ width: 384, height: 288 }); refreshWorkbenchLayout();
	let finds = 0;
	f.parent.registerCommand('list.find', { isEnabled: () => true, run: () => { finds++; } });
	const child = inputFocus.createTarget(f.parent), alias = inputFocus.createTarget(); alias.commandContext = f.parent;
	const menu = new ContextMenuController(inputFocus, pointerCapture);
	const toolbar = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, f.commands, f.parent, () => f.parent.focus());
	toolbar.setInput(createWorkbenchActionBar('events.title'), f.parent);
	t.after(() => { toolbar.dispose(); menu.dispose(); });
	f.control.field.focusTarget.commandContext = f.parent;
	for (const target of [child, alias, f.control.field.focusTarget, toolbar.focusTarget]) {
		target.focus();
		assert.equal(target.getCommand('list.find'), undefined);
		assert.equal(inputFocus.commandRunner, f.commands);
		f.checked.length = 0;
		for (const primary of [KeyModifier.ctrl, KeyModifier.meta]) {
			const event = new KeyInputEvent('KeyF', primary);
			assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner), false);
			assert.equal(event.consumed, false);
		}
		assert.deepEqual(f.checked, []);
	}
	f.parent.focus(); menu.show(8, 24, [{ type: 'command', command: 'list.find' }], f.commands, { selectFirst: true });
	assert.equal(inputFocus.target, menu.focusTarget); assert.equal(menu.focusTarget.commandContext, f.parent);
	assert.equal(menu.focusTarget.getCommand('list.find'), undefined);
	f.checked.length = 0;
	for (const primary of [KeyModifier.ctrl, KeyModifier.meta]) {
		const event = new KeyInputEvent('KeyF', primary);
		// Explicit runner availability must still not turn the popup's semantic
		// action alias into ownership of a physical keyboard binding.
		assert.equal(handleEditorCommandBindings(event, f.commands), false);
		assert.equal(event.consumed, false);
	}
	assert.equal(finds, 0); assert.equal(f.control.field.text, '123456');
	assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('a real QuickInput query cannot borrow its invoking list Find while retaining its local text input', t => {
	const f = fixture(t, inputFocus.workbenchScope);
	configureFontVariant('tiny');
	applyViewportSize({ width: 384, height: 288 }); refreshWorkbenchLayout();
	let finds = 0;
	f.parent.registerCommand('list.find', { isEnabled: () => true, run: () => { finds++; } });
	const menu = new ContextMenuController(inputFocus, pointerCapture), picker = new QuickInputController(menu);
	t.after(() => { picker.dispose(); menu.dispose(); });
	f.parent.focus();
	picker.input('Filter events', 'Query', 'probe', async text => text, () => assert.fail('Ctrl/Cmd F submitted the query'));
	const target = picker.field.focusTarget; target.commandContext = f.parent;
	assert.equal(inputFocus.target, target); assert.equal(target.getCommand('list.find'), undefined);
	f.checked.length = 0;
	for (const primary of [KeyModifier.ctrl, KeyModifier.meta]) {
		const event = new KeyInputEvent('KeyF', primary);
		assert.equal(handleEditorCommandBindings(event, f.commands), false);
		assert.equal(event.consumed, false); target.handleKeyboard(event);
		assert.equal(picker.field.text, 'probe'); assert.equal(picker.visible, true);
	}
	assert.equal(finds, 0); assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('a genuine guest input target does not acquire list Find from an application or underlying list', t => {
	const f = fixture(t, inputFocus.workbenchScope), clock = new VirtualHeadlessClock();
	const input = new Input(clock, new HeadlessInputHub(), -1), frames = new FrameBitmap();
	frames.publish(new Uint8Array(4), 1, 1, { presentationSequence: 0, cycles: 0, videoTick: 0 });
	let finds = 0;
	f.parent.registerCommand('list.find', { isEnabled: () => true, run: () => { finds++; } });
	const guest = inputFocus.createTarget(f.parent); guest.commandContext = f.parent;
	guest.guestInput = { bounds: { left: 80, top: 24, right: 384, bottom: 274 }, recipient: input,
		presentation: { kind: 'offscreen', frames } };
	guest.focus(); t.after(() => { frames.dispose(); input.dispose(); });
	assert.equal(inputFocus.commandRunner, f.commands); assert.equal(guest.getCommand('list.find'), undefined);
	for (const primary of [KeyModifier.ctrl, KeyModifier.meta]) {
		const event = new KeyInputEvent('KeyF', primary);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner), false);
		assert.equal(event.consumed, false);
	}
	assert.equal(finds, 0); assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});

test('list Find does not claim Shift/Alt variants or change Actor Lab routing', t => {
	const f = fixture(t, inputFocus.workbenchScope);
	let finds = 0, actorFinds = 0;
	f.parent.registerCommand('list.find', { isEnabled: () => true, run: () => { finds++; } });
	f.parent.focus();
	for (const modifiers of [KeyModifier.none, KeyModifier.alt, KeyModifier.ctrl | KeyModifier.shift,
		KeyModifier.meta | KeyModifier.shift, KeyModifier.ctrl | KeyModifier.alt, KeyModifier.meta | KeyModifier.alt]) {
		const event = new KeyInputEvent('KeyF', modifiers);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner), false);
		assert.equal(event.consumed, false);
	}
	const actor = inputFocus.createTarget(f.parent); actor.commandContext = f.parent;
	actor.registerCommand('actorLab.find', { isEnabled: () => true, run: () => { actorFinds++; } }); actor.focus();
	for (const primary of [KeyModifier.ctrl, KeyModifier.meta]) {
		const event = new KeyInputEvent('KeyF', primary);
		assert.equal(handleEditorCommandBindings(event, inputFocus.commandRunner), true);
		assert.equal(event.consumed, true);
	}
	assert.equal(actorFinds, 2); assert.equal(finds, 0);

	assert.equal(finds, 0); assert.deepEqual(f.executed, []); assert.deepEqual(f.checked, []);
});
