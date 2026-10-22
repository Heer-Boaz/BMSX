import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { SYSTEM_RESOURCE_DOMAIN } from '../../ide/common/resource';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { InputFocusScope, inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { GameInputControl } from '../../ide/workbench/contrib/game_view/game_input';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { createInputControllerSnapshot, InputControllerSampleContext } from '../../machine/ts/machine/devices/input/contracts';
import { encodeSignedFix16 } from '../../machine/ts/machine/common/numeric';
import { InputChannel } from '../../hosts/common/input/channel';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import { createHostFrameFixture } from '../helpers/host_frame';
import { ImagePreviewCache } from '../../ide/workbench/ui/image_preview';
import { ImagePreviewOverlay } from '../../ide/workbench/ui/image_preview_overlay';
import { createTestRuntimeSourceState, createTestSystemImageRuntimeSourceState, createTestRuntime } from '../helpers/runtime_sources';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { captureInstalledLuaSources, registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32, type TestBlua32Image } from '../helpers/blua32';
import { parseLuaChunk } from './cpu_test_harness';
import { RemoteInput } from '../../hosts/common/input/remote';
import { HostUiInput } from '../../hosts/common/input/ui';
import { WorkbenchFloatingWindow } from '../../ide/workbench/ui/window/control';
import { WorkbenchWindowModel } from '../../ide/workbench/ui/window/model';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchPropertyInspector } from '../../ide/workbench/ui/property_inspector/control';
import { measureText, measureTextRange } from '../../ide/editor/common/text/layout';

function fixture(t: TestContext, authored?: { image: TestBlua32Image; registry: LuaSourceRegistry }) {
	const host = createHostFrameFixture(authored === undefined ? undefined : createTestRuntime(authored.image.romBytes));
	if (authored !== undefined) host.runtime.boot();
	const sources = authored === undefined ? createTestRuntimeSourceState({ records: [], path2lua: {}, module2lua: {}, entrySourcePath: '',
		projectRootPath: '', can_boot_from_source: false, revision: 0 }, [null, null], SYSTEM_RESOURCE_DOMAIN)
		: createTestSystemImageRuntimeSourceState(authored.image.romBytes, authored.registry);
	if (authored !== undefined) sources.currentBlua32Media = {
		system: createBlua32SystemSourceImage(authored.image.image, authored.image.symbols, authored.image.biosImports, captureInstalledLuaSources(authored.registry)),
		cartridgeSlots: [null, null],
	};
	const unused = (): never => { throw new Error('Surface routing does not request domain work.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 384, height: 288 }, sources, new Map(), unused, unused, unused);
	const editor = ide.editor;
	editorRuntimeState.active = true;
	host.input.setPointerAdmissionMode('routed');
	let buttons = 0;
	function pointer(x: number, y: number, nextButtons = buttons) {
		editor.dispatchPointer({ x, y, buttons: nextButtons, pressedButtons: nextButtons & ~buttons,
			releasedButtons: buttons & ~nextButtons, cancelledButtons: 0, modifiers: KeyModifier.none,
			spaceDown: false, timestamp: host.clock.now() });
		buttons = nextButtons;
	}
	t.after(async () => {
		pointer(0, 0, 0);
		inputFocus.setTarget(null);
		await editor.shutdown(); host.audio.dispose(); host.input.dispose();
	});
	const extent = { left: 0, top: 0, right: 384, bottom: 288 };
	return { editor, host, pointer, extent };
}

test('production dispatcher retains the first surface through all physical buttons; wheel uses its own current hit', t => {
	const { editor, pointer, extent } = fixture(t);
	const calls: string[] = [];
	const boundsA = { left: 30, top: 40, right: 160, bottom: 180 };
	const boundsB = { left: 90, top: 40, right: 240, bottom: 180 };
	const a = editor.surfaces.attach({
		role: 'window', captureScope: Symbol('a'), isVisible: () => true,
		getBounds: () => boundsA, getClip: () => extent, draw() {},
		handlePointer: () => { calls.push('a'); }, handleWheel: () => { calls.push('wheel a'); return true; },
	});
	editor.surfaces.attach({
		role: 'window', captureScope: Symbol('b'), isVisible: () => true,
		getBounds: () => boundsB, getClip: () => extent, draw() {},
		handlePointer: () => { calls.push('b'); },
	});
	pointer(100, 70, PointerButton.Primary);
	pointer(50, 70, PointerButton.Primary | PointerButton.Secondary);
	pointer(50, 70, PointerButton.Secondary);
	assert.equal(editor.dispatchWheel({ x: 50, y: 70, deltaX: 0, deltaY: 1, attachmentDeltaY: 1,
		modifiers: KeyModifier.none, timestamp: 0 }), true);
	pointer(50, 70, 0);
	pointer(50, 70, PointerButton.Primary);
	assert.deepEqual(calls, ['b', 'b', 'b', 'wheel a', 'b', 'a']);
	assert.equal(pointerCapture.routeScope, a.captureScope);
});

test('surface capture continues outside canvas; hiding its route drains the hold without retargeting', t => {
	const { editor, pointer, extent } = fixture(t);
	const calls: string[] = [];
	let visible = true;
	const capture = {
		handleCapturedPointer() { calls.push('move'); },
		releaseCapturedPointer() { calls.push('up'); },
		cancelPointer() { calls.push('cancel'); },
	};
	const scope = Symbol('drag window');
	editor.surfaces.attach({
		role: 'window', captureScope: scope, isVisible: () => visible,
		getBounds: () => extent, getClip: () => extent, draw() {},
		handlePointer: () => { calls.push('down'); pointerCapture.capture(capture); },
	});
	pointer(100, 70, PointerButton.Primary);
	pointer(-100, 70);
	pointer(-100, 70, 0);
	assert.deepEqual(calls, ['down', 'move', 'up']);
	pointer(100, 70, PointerButton.Primary);
	visible = false;
	editor.surfaces.changed();
	assert.equal(pointerCapture.draining, true);
	assert.equal(pointerCapture.routeScope, undefined);
	pointer(100, 70);
	pointer(100, 70, 0);
	assert.deepEqual(calls, ['down', 'move', 'up', 'down', 'cancel']);
	assert.equal(pointerCapture.draining, false);
});

test('real popup and modal sources publish visibility before focus admission and revoke covered hover immediately', async t => {
	const { editor, pointer } = fixture(t);
	const origin = inputFocus.createTarget(); origin.bindKeyboard(() => {}); origin.focus();
	let leaves = 0;
	const hover = { onPointerLeave() { leaves += 1; } };
	pointerHover.visit(hover);
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	assert.equal(editor.contextMenu.focusTarget.hasFocus, true);
	assert.equal(leaves, 1, 'opening a surface revokes lower hover without a pointer movement');
	assert.equal(editor.surfaces.topBlockingSurface?.captureScope, editor.contextMenu.pointerScope);
	pointer(10, 200, PointerButton.Primary);
	assert.equal(editor.contextMenu.visible, false);
	assert.equal(pointerCapture.draining, true, 'the outside dismiss press cannot reach newly exposed content');
	pointer(10, 200, 0);
	assert.equal(pointerCapture.draining, false);

	editor.quickInput.pick('Choose', '', () => new TextQuickPickProvider([{ label: 'one', description: '', detail: '' }]), () => {});
	assert.equal(editor.quickInput.field.focusTarget.hasFocus, true);
	assert.equal(editor.surfaces.isAdmitted(editor.paneSurface), false);
	assert.equal(editor.surfaces.topBlockingSurface?.captureScope, editor.quickInput.pointerScope);
	editor.quickInput.hide();
	assert.equal(inputFocus.target, origin);
	const decision = editor.actionPrompt.show('close');
	assert.equal(editor.actionPrompt.focusTarget.hasFocus, true);
	assert.equal(editor.surfaces.topBlockingSurface?.captureScope, editor.actionPrompt.pointerScope);
	assert.equal(editor.dispatchWheel({ x: 10, y: 200, deltaX: 0, deltaY: 1, attachmentDeltaY: 1,
		modifiers: KeyModifier.none, timestamp: 0 }), true);
	editor.actionPrompt.close();
	assert.equal(await decision, 'cancel');
	assert.equal(editor.surfaces.isAdmitted(editor.paneSurface), true);
	assert.equal(inputFocus.target, origin);
});


test('menu presentation follows its invoking window session and retires on owner hide or close', t => {
	const { editor, extent } = fixture(t);
	const tree = inputFocus.createTarget(); tree.bindKeyboard(() => {});
	let visible = true;
	const scope = Symbol('details window');
	const window = editor.surfaces.attach({
		role: 'window', captureScope: scope, isVisible: () => visible, getBounds: () => extent, getClip: () => extent, draw() {},
	});
	const subject = inputFocus.createTarget(tree, new InputFocusScope(scope));
	subject.canFocus = () => window.visible;
	subject.bindKeyboard(() => {});
	subject.focus();
	const lifetime = editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const popup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(editor.contextMenu.invocationOrigin, subject);
	assert.equal(popup.lifetimeOwner, window);
	assert.equal(popup.presentationParent, undefined, 'ordinary window popup promotes past its client clip');
	assert.equal(editor.contextMenu.focusTarget.hasFocus, true, 'session attachment exists before requesting popup focus');
	visible = false;
	editor.surfaces.changed();
	assert.equal(editor.contextMenu.visible, false);
	assert.equal(popup.retired, true);
	assert.equal(lifetime.isDisposed, true);
	assert.equal(editor.surfaces.findByScope(editor.contextMenu.pointerScope), undefined);
	assert.equal(inputFocus.target, tree);

	visible = true;
	editor.surfaces.changed(); subject.focus();
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const next = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.notEqual(next, popup, 'replacement is a new attachment, not a stale singleton surface');
	window.dispose();
	assert.equal(next.retired, true);
	assert.equal(editor.contextMenu.visible, false);
	assert.equal(inputFocus.target, tree);
});

test('retiring a real window with its property menu focused returns to an admitted owner', t => {
	const { editor, extent } = fixture(t);
	const tree = inputFocus.createTarget(); tree.bindKeyboard(() => {});
	const window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, editor.surfaces, editor.commands, {
		model: new WorkbenchWindowModel({ left: 20, top: 30, right: 250, bottom: 240 }, 100, 80),
		actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: editor.paneSurface,
		focusReturn: tree, getWorkArea: () => extent, content: { draw() {} }, layoutContent() {},
		retireContentInput: () => inspector.hide(),
		restoreContentInput: () => inspector.show({ title: 'DETAILS', items: [{ label: 'A', value: 'B', description: '', warning: false }],
			focusReturn: tree, canOpenSource: () => false, openSource() {} }, false),
		focusContent: () => inspector.focusTarget.focus(),
	});
	const inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, window.clientFocusTarget, 'client');
	t.after(() => { window.dispose(); inspector.dispose(); });
	for (const retirement of ['surface', 'detach', 'hide'] as const) {
		window.show(true);
		editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
		const popup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
		assert.equal(popup.lifetimeOwner, window.clientSurface);
		assert.equal(inputFocus.target, editor.contextMenu.focusTarget);
		if (retirement === 'surface') window.surface!.dispose();
		else if (retirement === 'detach') window.detach();
		else window.hide();
		assert.equal(window.surface, undefined);
		assert.equal(window.clientSurface, undefined);
		assert.equal(inspector.visible, false);
		assert.equal(editor.contextMenu.visible, false);
		assert.equal(popup.retired, true);
		assert.equal(inputFocus.target, tree, `${retirement} returns focus before its popup ownership is removed`);
		assert.equal(inputFocus.admittedTarget, tree, 'the returned target is eligible under the real root admission policy');
	}
});

test('session popup promotes to its actual root or owner-local modal context, never above the admission boundary', t => {
	const { editor, extent } = fixture(t);
	const tree = inputFocus.createTarget(); tree.bindKeyboard(() => {}); tree.focus();
	const rootScope = Symbol('root modal');
	const root = editor.surfaces.attach({
		role: 'modal', blockedScope: null, captureScope: rootScope,
		isVisible: () => true, getBounds: () => extent, getClip: () => extent, draw() {},
	});
	const rootTarget = inputFocus.createTarget(tree, new InputFocusScope(rootScope));
	rootTarget.canFocus = () => root.visible;
	rootTarget.bindKeyboard(() => {}); rootTarget.focus();
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const rootPopup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(rootPopup.lifetimeOwner, root);
	assert.equal(rootPopup.presentationParent, root);
	assert.equal(editor.surfaces.isAdmitted(rootPopup), true);
	assert.equal(editor.surfaces.hitTest(10, 200), rootPopup);
	editor.contextMenu.hide();
	assert.equal(inputFocus.target, rootTarget);
	root.dispose(); tree.focus();

	const localScope = Symbol('owner-local modal');
	const local = editor.surfaces.attach({
		role: 'modal', blockedScope: editor.paneSurface, lifetimeOwner: editor.paneSurface, captureScope: localScope,
		isVisible: () => true, getBounds: editor.paneSurface.getBounds, getClip: editor.paneSurface.getClip, draw() {},
	});
	const localTarget = inputFocus.createTarget(tree, new InputFocusScope(localScope));
	localTarget.canFocus = () => local.visible;
	localTarget.bindKeyboard(() => {}); localTarget.focus();
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const localPopup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(localPopup.lifetimeOwner, local);
	assert.equal(localPopup.presentationParent, local);
	assert.equal(editor.surfaces.isAdmitted(localPopup), true);
	assert.equal(editor.surfaces.isAdmitted(editor.paneSurface), false);
	assert.equal(editor.surfaces.hitTest(100, 200), localPopup);
	assert.notEqual(editor.surfaces.hitTest(2, 2), localPopup, 'an owner-local popup does not block root chrome');
	local.dispose();
	assert.equal(localPopup.retired, true);
	assert.equal(editor.contextMenu.visible, false);
});

test('menu invocation without focused content has an explicit root-chrome lifetime owner', t => {
	const { editor } = fixture(t);
	inputFocus.setTarget(null);
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const popup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(editor.contextMenu.invocationOrigin, null);
	assert.equal(popup.lifetimeOwner?.captureScope, editor.tabBar.focusTarget.scope.surfaceScope);
	assert.equal(popup.presentationParent, undefined);
	assert.equal(editor.contextMenu.focusTarget.hasFocus, true);
});


test('actual Quick Input and action prompt retain their modal lifetime while their session-owned menu has focus', async t => {
	const { editor } = fixture(t);
	const origin = inputFocus.createTarget(); origin.bindKeyboard(() => {}); origin.focus();
	editor.quickInput.pick('Choose', '', () => new TextQuickPickProvider([{ label: 'one', description: '', detail: '' }]), () => {});
	const picker = editor.surfaces.findByScope(editor.quickInput.pointerScope)!;
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const pickerMenu = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(editor.quickInput.visible, true);
	assert.equal(editor.contextMenu.focusTarget.hasFocus, true);
	assert.equal(pickerMenu.lifetimeOwner, picker);
	assert.equal(pickerMenu.presentationParent, picker);
	assert.equal(editor.surfaces.isAdmitted(pickerMenu), true);
	editor.contextMenu.hide();
	assert.equal(editor.quickInput.field.focusTarget.hasFocus, true);
	assert.equal(editor.quickInput.visible, true);
	editor.quickInput.hide();

	const decision = editor.actionPrompt.show('close');
	const prompt = editor.surfaces.findByScope(editor.actionPrompt.pointerScope)!;
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const promptMenu = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(editor.actionPrompt.visible, true);
	assert.equal(editor.contextMenu.focusTarget.hasFocus, true);
	assert.equal(promptMenu.presentationParent, prompt);
	assert.equal(promptMenu.lifetimeOwner, prompt);
	assert.equal(editor.surfaces.isAdmitted(promptMenu), true);
	editor.contextMenu.hide();
	assert.equal(editor.actionPrompt.focusTarget.hasFocus, true);
	assert.equal(editor.actionPrompt.visible, true);
	editor.actionPrompt.close();
	assert.equal(await decision, 'cancel');
	assert.equal(inputFocus.target, origin);
});

test('the actual lightbox keeps its property popup inside the pane admission context and retires it on close', t => {
	const { editor } = fixture(t);
	const cache = new ImagePreviewCache(async () => ({ width: 1, height: 1, pixels: new Uint8Array([1, 2, 3, 255]) }));
	const preview = new ImagePreviewOverlay(cache, editor.surfaces, editor.paneSurface);
	preview.layout(editor.paneSurface.getBounds(), editorViewState.lineHeight);
	t.after(() => { preview.dispose(); cache.dispose(); });
	preview.open('fixture:image');
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const popup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(preview.visible, true);
	assert.equal(editor.contextMenu.focusTarget.hasFocus, true);
	assert.equal(popup.lifetimeOwner, preview.surface);
	assert.equal(popup.presentationParent, preview.surface);
	assert.equal(editor.surfaces.isInContext(popup.captureScope, preview.surface.captureScope), true);
	assert.equal(editor.surfaces.isAdmitted(editor.paneSurface), false);
	preview.close();
	assert.equal(editor.contextMenu.visible, false);
	assert.equal(popup.retired, true);
	assert.equal(editor.surfaces.findByScope(editor.contextMenu.pointerScope), undefined);
});


test('a newly shown menu accepts the next native row click before any workbench update', t => {
	const { editor, pointer } = fixture(t);
	const origin = inputFocus.createTarget(); origin.bindKeyboard(() => {}); origin.focus();
	let actions = 0;
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], {
		isEnabled: () => true, execute: () => { actions += 1; },
	});
	const model = editor.contextMenu.model;
	assert.ok(model.bounds.right > model.bounds.left);
	assert.ok(model.rows[0].bottom > model.rows[0].top);
	const x = model.viewport.bounds.left + 8;
	const y = model.viewport.offsetTop + model.rows[0].top + 2;
	pointer(x, y, PointerButton.Primary);
	pointer(x, y, 0);
	assert.equal(actions, 1);
	assert.equal(editor.contextMenu.visible, false);
	assert.equal(inputFocus.target, origin);
});

test('editor input retirement cancels its actual prompt and picker sessions without restoring the detached guest', async t => {
	const { editor, host } = fixture(t);
	const remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
	t.after(() => remote.release());
	for (const kind of ['prompt', 'picker']) {
		const game = new GameViewInput();
		editor.editorPanes.openEditor(game);
		const bounds = game.frameBounds;
		remote.apply([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
			{ type: 'button', button: 'primary', down: true }, { type: 'button', button: 'primary', down: false }]);
		const origin = inputFocus.target!;
		assert.ok(origin.guestInput, 'the actual game view input control invoked the session');
		const decision = kind === 'prompt' ? editor.actionPrompt.show('reboot') : undefined;
		if (kind === 'picker') editor.quickInput.pick('Choose', '', () => new TextQuickPickProvider([
			{ label: 'one', description: '', detail: '' },
		]), () => {});
		editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
		assert.equal(editor.contextMenu.focusTarget.hasFocus, true);
		editor.editorPanes.openEditor(new HostErrorInput('replacement'));
		assert.equal(editor.actionPrompt.visible, false);
		assert.equal(editor.quickInput.visible, false);
		assert.equal(editor.contextMenu.visible, false, 'retirement also removes the source-owned popup');
		assert.equal(inputFocus.target?.guestInput, undefined);
		assert.notEqual(inputFocus.target, origin);
		if (decision !== undefined) assert.equal(await decision, 'cancel');
	}
});

test('clearing an editor preserves root-origin and other live-owner modal sessions', async t => {
	const { editor, extent } = fixture(t);
	const windowScope = new InputFocusScope(Symbol('other owner'));
	const window = editor.surfaces.attach({ role: 'window', captureScope: windowScope.surfaceScope, isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {} });
	const other = inputFocus.createTarget(null, windowScope); other.bindKeyboard(() => {});
	for (const owner of [null, editor.tabBar.focusTarget, other]) {
		for (const kind of ['prompt', 'picker']) {
			editor.editorPanes.openEditor(new HostErrorInput('existing'));
			inputFocus.setTarget(owner);
			const decision = kind === 'prompt' ? editor.actionPrompt.show('reboot') : undefined;
			if (kind === 'picker') editor.quickInput.pick('Choose', '', () => new TextQuickPickProvider([
				{ label: 'one', description: '', detail: '' },
			]), () => {});
			const sessionFocus = inputFocus.target;
			editor.editorPanes.clearEditor();
			assert.equal(editor.actionPrompt.visible, kind === 'prompt');
			assert.equal(editor.quickInput.visible, kind === 'picker');
			assert.equal(inputFocus.target, sessionFocus, 'pane retirement does not steal an independent surface focus');
			if (decision !== undefined) { editor.actionPrompt.close(); assert.equal(await decision, 'cancel'); }
			else editor.quickInput.hide();
			assert.equal(inputFocus.target, owner);
		}
	}
	window.dispose();
});

test('a blocked retained focus or a root modal without focus cannot dispatch root keyboard commands', t => {
	const { editor, extent } = fixture(t);
	const origin = inputFocus.createTarget(); origin.bindKeyboard(() => {}); origin.focus();
	const modal = editor.surfaces.attach({ role: 'modal', blockedScope: null, captureScope: Symbol('focusless modal'),
		isVisible: () => true, getBounds: () => extent, getClip: () => extent, draw() {} });
	assert.equal(inputFocus.target, origin);
	assert.equal(inputFocus.admittedTarget, null);
	for (const focus of [origin, null]) {
		if (focus === null) inputFocus.setTarget(null);
		const key = new KeyInputEvent('F10', KeyModifier.none);
		assert.equal(editor.dispatchKey(key), true);
		assert.equal(key.consumed, true);
		assert.equal(editor.contextMenu.visible, false);
	}
	modal.dispose();
});

test('native remote paste reaches the admitted Quick Input field before modal keyboard delegation', async t => {
	const { editor, host } = fixture(t);
	const origin = inputFocus.createTarget(); origin.bindKeyboard(() => {}); origin.focus();
	editor.quickInput.pick('Find actor', '', () => new TextQuickPickProvider([
		{ label: 'player', description: '', detail: '' }, { label: 'enemy', description: '', detail: '' },
	]), () => {});
	assert.equal(editor.quickInput.model.list.rows.length, 2);
	await editor.clipboard.writeText('enemy');
	const remote = new RemoteInput(host.input, host.clock, host.input.dispatchEditingKey.bind(host.input));
	remote.apply([{ type: 'key', code: 'ControlLeft', down: true }, { type: 'key', code: 'KeyV', down: true },
		{ type: 'key', code: 'KeyV', down: false }, { type: 'key', code: 'ControlLeft', down: false }]);
	await Promise.resolve();
	assert.equal(editor.quickInput.field.text, 'enemy');
	assert.equal(editor.quickInput.model.list.rows.length, 1);
	assert.equal(editor.quickInput.model.list.rows[0].itemIndex, 1);
	assert.equal(editor.quickInput.field.focusTarget.hasFocus, true);
	remote.release();
});

test('a toolbar menu uses its explicit tree invocation for lifetime and commands while restoring inspector focus', t => {
	const { editor, extent } = fixture(t);
	const tree = inputFocus.createTarget(); tree.bindKeyboard(() => {});
	const windowScope = new InputFocusScope(Symbol('inspector'));
	const window = editor.surfaces.attach({ role: 'window', captureScope: windowScope.surfaceScope, isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {} });
	const inspector = inputFocus.createTarget(tree, windowScope); inspector.bindKeyboard(() => {});
	let invocations = 0;
	tree.registerCommand('actorLab.find', { isEnabled: () => true, run: () => { invocations += 1; } });
	inspector.registerCommand('actorLab.find', { isEnabled: () => false, run: () => { throw new Error('wrong command owner'); } });
	inspector.focus();
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'actorLab.find' }], editor.commands,
		{ selectFirst: true, invocationOrigin: tree });
	const popup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(editor.contextMenu.invocationOrigin, tree);
	assert.equal(popup.lifetimeOwner, editor.paneSurface);
	assert.equal(editor.contextMenu.focusTarget.commandContext, tree);
	assert.equal(editor.contextMenu.model.rows[0].enabled, true);
	editor.contextMenu.accept();
	assert.equal(invocations, 1, 'command execution retains the explicit origin after restoring a different focus');
	assert.equal(inputFocus.target, inspector);
	window.dispose();
});

test('routed guest gesture survives UI overlap, focus changes, extra buttons and motion outside canvas', t => {
	const { editor, host, pointer, extent } = fixture(t);
	const scope = new InputFocusScope(Symbol('preview'));
	const owner = inputFocus.createTarget(null, scope); owner.bindKeyboard(() => {});
	const game = new GameInputControl(owner, host.input, { kind: 'direct', presenter: host.presenter });
	const bounds = { left: 100, top: 60, right: 300, bottom: 240 };
	game.setInput(bounds);
	let paneOccurrences = 0, windowOccurrences = 0;
	editor.surfaces.attach({
		role: 'content', captureScope: scope.surfaceScope, isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {},
		handlePointer: snapshot => { paneOccurrences += 1; game.handlePointer(snapshot); },
	});
	const windowBounds = { left: 180, top: 80, right: 260, bottom: 180 };
	editor.surfaces.attach({
		role: 'window', captureScope: Symbol('window'), isVisible: () => true,
		getBounds: () => windowBounds, getClip: () => extent, draw() {},
		handlePointer: () => { windowOccurrences += 1; },
	});
	const snapshot = createInputControllerSnapshot();
	const sample = () => host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	pointer(150, 150, PointerButton.Primary);
	assert.equal(game.focusTarget.hasFocus, true);
	sample(); assert.equal(snapshot.pointerButtons, 1);
	assert.equal(snapshot.pointerXQ16, encodeSignedFix16(64));
	pointer(200, 150, PointerButton.Primary | PointerButton.Secondary);
	owner.focus(); // keyboard and pointer ownership intentionally diverge
	sample(); assert.equal(snapshot.pointerButtons, 5);
	pointer(-100, 400, PointerButton.Secondary);
	sample(); assert.equal(snapshot.pointerButtons, 4);
	assert.equal(snapshot.pointerXQ16, 0);
	assert.equal(snapshot.pointerYQ16, encodeSignedFix16(211));
	pointer(200, 150, 0);
	sample(); assert.equal(snapshot.pointerButtons, 0);
	assert.equal(windowOccurrences, 0, 'the covered window gets neither an orphan release nor another button');
	assert.equal(paneOccurrences, 1, 'captured guest motion does not run tree or preview picking');
	pointer(200, 150, PointerButton.Primary);
	assert.equal(windowOccurrences, 1, 'after all-up the topmost surface wins again');
	game.dispose();
});

test('UI gesture cannot migrate into a guest and explicit viewport retirement drains a guest hold', t => {
	const { editor, host, pointer, extent } = fixture(t);
	const scope = new InputFocusScope(Symbol('preview'));
	const owner = inputFocus.createTarget(null, scope); owner.bindKeyboard(() => {});
	const game = new GameInputControl(owner, host.input, { kind: 'direct', presenter: host.presenter });
	const bounds = { left: 100, top: 60, right: 300, bottom: 240 };
	game.setInput(bounds); game.focusTarget.focus();
	let uiOccurrences = 0;
	editor.surfaces.attach({ role: 'content', captureScope: scope.surfaceScope, isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {}, handlePointer: snapshot => { game.handlePointer(snapshot); } });
	editor.surfaces.attach({ role: 'window', captureScope: Symbol('window'), isVisible: () => true,
		getBounds: () => ({ left: 180, top: 80, right: 260, bottom: 180 }), getClip: () => extent, draw() {},
		handlePointer: () => { uiOccurrences += 1; } });
	const snapshot = createInputControllerSnapshot();
	const sample = () => host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	pointer(200, 150, PointerButton.Primary);
	pointer(150, 150);
	pointer(150, 150, 0);
	sample(); assert.equal(snapshot.pointerButtons, 0);
	assert.equal(uiOccurrences, 3);
	pointer(150, 150, PointerButton.Primary);
	sample(); assert.equal(snapshot.pointerButtons, 1);
	game.clearInput();
	sample(); assert.equal(snapshot.pointerButtons, 0);
	assert.equal(pointerCapture.draining, true);
	game.setInput(bounds); game.focusTarget.focus();
	pointer(150, 150, PointerButton.Primary | PointerButton.Auxiliary);
	sample(); assert.equal(snapshot.pointerButtons, 0, 'new buttons during the interrupted hold are drained too');
	pointer(150, 150, 0);
	pointer(150, 150, PointerButton.Primary);
	sample(); assert.equal(snapshot.pointerButtons, 1);
	game.dispose();
});

test('wheel routes the current exposed preview independently of a captured pointer recipient', t => {
	const { editor, host, pointer, extent } = fixture(t);
	const first = new InputChannel(host.input), second = new InputChannel(host.input);
	t.after(() => { first.dispose(); second.dispose(); });
	const scope = new InputFocusScope(Symbol('previews'));
	const owner = inputFocus.createTarget(null, scope); owner.bindKeyboard(() => {});
	const firstGame = new GameInputControl(owner, first, { kind: 'direct', presenter: host.presenter });
	const secondGame = new GameInputControl(owner, second, { kind: 'direct', presenter: host.presenter });
	firstGame.setInput({ left: 20, top: 60, right: 170, bottom: 240 });
	secondGame.setInput({ left: 200, top: 60, right: 350, bottom: 240 });
	editor.surfaces.attach({ role: 'content', captureScope: scope.surfaceScope, isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {},
		handlePointer: snapshot => { firstGame.handlePointer(snapshot); secondGame.handlePointer(snapshot); }, handleWheel: () => false });
	let covered = false;
	editor.surfaces.attach({ role: 'window', captureScope: Symbol('cover'), isVisible: () => covered,
		getBounds: () => extent, getClip: () => extent, draw() {} });
	pointer(95, 150, PointerButton.Primary);
	secondGame.focusTarget.focus();
	assert.equal(editor.dispatchWheel({ x: 275, y: 150, deltaX: 0, deltaY: 3, attachmentDeltaY: 1,
		modifiers: KeyModifier.none, timestamp: 0 }), true);
	covered = true; editor.surfaces.changed();
	editor.dispatchWheel({ x: 275, y: 150, deltaX: 0, deltaY: 6, attachmentDeltaY: 2,
		modifiers: KeyModifier.none, timestamp: 0 });
	host.input.pollInput();
	const snapshot = createInputControllerSnapshot();
	first.sampleInputControllerSnapshot(snapshot);
	assert.equal(snapshot.pointerButtons, 1);
	assert.equal(snapshot.pointerWheelQ16, 0);
	second.sampleInputControllerSnapshot(snapshot);
	assert.equal(snapshot.pointerButtons, 0);
	assert.equal(snapshot.pointerWheelQ16, encodeSignedFix16(1));
	assert.equal(snapshot.pointerXQ16, encodeSignedFix16(128));
	pointer(400, 300, 0);
	firstGame.dispose(); secondGame.dispose();
});


test('actual activation drains the producer hold established in player mode, including additional buttons before all-up', t => {
	const source = 'return 42';
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, 'activation.lua'), [],
		{ entrySource: source, programDomain: 'system', optLevel: 0 }));
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'activation.lua',
		projectRootPath: '', can_boot_from_source: true, revision: 0 };
	registerLuaSourceRecord(registry, { resid: 'activation', type: 'lua', src: source, base_src: source,
		source_path: 'activation.lua', normalized_source_path: 'activation.lua', module_path: 'activation',
		update_timestamp: 0, base_update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	const { editor, host, extent } = fixture(t, { image, registry });
	const calls: number[] = [];
	editor.surfaces.attach({ role: 'window', captureScope: Symbol('new input owner'), isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {}, handlePointer: snapshot => { calls.push(snapshot.justPressedButtons); } });
	editorRuntimeState.active = false;
	host.input.setPointerAdmissionMode('physical');
	const remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
	remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true }]);
	assert.equal(host.input.pointerButtonsDown, true, 'the hold is known before any host poll');
	assert.equal(pointerCapture.routeScope, undefined);
	editor.activate();
	assert.equal(editor.isActive, true);
	assert.equal(pointerCapture.draining, true);
	remote.apply([{ type: 'button', button: 'secondary', down: true }, { type: 'button', button: 'primary', down: false },
		{ type: 'button', button: 'primary', down: true }]);
	assert.deepEqual(calls, []);
	remote.apply([{ type: 'button', button: 'primary', down: false }, { type: 'button', button: 'secondary', down: false },
		{ type: 'button', button: 'primary', down: true }]);
	assert.deepEqual(calls, [PointerButton.Primary]);
	editor.activate();
	assert.equal(pointerCapture.draining, false, 'reactivating an already active editor does not cancel its own gesture');
	remote.release();
});

test('host-exclusive reentry drains unseen source holds, while actual source loss admits the first fresh gesture', t => {
	const { editor, host, extent } = fixture(t);
	const ui = new HostUiInput(host.input, host.presenter);
	const calls: number[] = [];
	editor.surfaces.attach({ role: 'window', captureScope: Symbol('window'), isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {}, handlePointer: snapshot => { calls.push(snapshot.justPressedButtons); } });
	let remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
	host.input.setForegroundInput(ui, true);
	remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true }]);
	host.input.setForegroundInput(ui, false);
	assert.equal(pointerCapture.draining, true);
	remote.apply([{ type: 'button', button: 'aux', down: true }]);
	assert.deepEqual(calls, []);
	remote.release();
	assert.equal(pointerCapture.draining, false, 'explicit producer cancellation ends the cancelled hold without a synthetic release');

	for (const device of ['pointer:0', undefined]) {
		remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
		remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true }]);
		calls.length = 0;
		host.input.resetInput(device);
		assert.equal(host.input.pointerButtonsDown, false);
		assert.equal(pointerCapture.routeScope, undefined);
		assert.equal(pointerCapture.draining, false, 'the source has already reset when the route is interrupted');
		remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
		remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true }]);
		assert.equal(calls[calls.length - 1], PointerButton.Primary, 'the first fresh press after native blur/reset is not swallowed');
		remote.release();
	}
});

test('native producer cancellation ends a routed guest hold without a successful release or blocking the next fresh press', t => {
	const { editor, host, extent } = fixture(t);
	const scope = new InputFocusScope(Symbol('guest'));
	const owner = inputFocus.createTarget(null, scope); owner.bindKeyboard(() => {});
	const game = new GameInputControl(owner, host.input, { kind: 'direct', presenter: host.presenter });
	game.setInput({ left: 20, top: 60, right: 350, bottom: 240 });
	editor.surfaces.attach({ role: 'content', captureScope: scope.surfaceScope, isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {}, handlePointer: snapshot => { game.handlePointer(snapshot); } });
	const snapshot = createInputControllerSnapshot();
	let remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
	remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true },
		{ type: 'button', button: 'secondary', down: true }]);
	host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 5);
	remote.release();
	host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 0);
	assert.equal(pointerCapture.routeScope, undefined);
	assert.equal(pointerCapture.guestBinding, undefined);
	assert.equal(pointerCapture.draining, false);
	remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
	remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true }]);
	host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 1);
	remote.release(); game.dispose();
});

test('resetting one registered pointer producer retains another producer hold in the canonical admission drain', t => {
	const { host } = fixture(t);
	host.input.connectInputDevice({ id: 'pointer:1', kind: 'pointer' });
	host.input.inputButton('pointer:0', 'pointer_primary', true, 1, 0, 1);
	host.input.inputButton('pointer:1', 'pointer_secondary', true, 1, 0, 2);
	host.input.resetInput('pointer:0');
	assert.equal(host.input.pointerButtonsDown, true);
	assert.equal(pointerCapture.draining, true);
	host.input.resetInput('pointer:1');
	assert.equal(host.input.pointerButtonsDown, false);
	assert.equal(pointerCapture.draining, false);
});


test('real window hide and root-modal admission cancel true producer guest holds and drain all remaining buttons', async t => {
	const { editor, host, extent } = fixture(t);
	const tree = inputFocus.createTarget(); tree.bindKeyboard(() => {});
	const model = new WorkbenchWindowModel({ left: 30, top: 40, right: 350, bottom: 260 }, 100, 80);
	const window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, editor.surfaces, editor.commands, {
		model, actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: editor.paneSurface,
		focusReturn: tree, getWorkArea: () => extent,
		content: { draw() {}, handlePointer: snapshot => { game.handlePointer(snapshot); } },
		layoutContent: bounds => game.setInput(bounds), retireContentInput: () => game.clearInput(),
		restoreContentInput: () => game.setInput(model.client), focusContent: () => game.focusTarget.focus(),
	});
	const game = new GameInputControl(window.clientFocusTarget, host.input, { kind: 'direct', presenter: host.presenter });
	const show = () => { window.show(false); window.layout(editorViewState.font.renderFont(), measureTextRange, measureText); game.focusTarget.focus(); };
	t.after(() => { game.dispose(); window.dispose(); });
	show();
	const snapshot = createInputControllerSnapshot();
	const sample = () => { host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal); return snapshot.pointerButtons; };
	for (const action of ['hide', 'modal']) {
		const remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
		remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true }]);
		assert.equal(sample(), 1);
		if (action === 'hide') { window.hide(); show(); }
		else { const decision = editor.actionPrompt.show('close'); editor.actionPrompt.close(); await decision; }
		assert.equal(sample(), 0);
		assert.equal(pointerCapture.draining, true);
		remote.apply([{ type: 'button', button: 'secondary', down: true }]);
		assert.equal(sample(), 0, 'a new button in the interrupted producer hold cannot acquire another route');
		remote.apply([{ type: 'button', button: 'primary', down: false }, { type: 'button', button: 'secondary', down: false },
			{ type: 'button', button: 'primary', down: true }]);
		assert.equal(sample(), 1);
		remote.release();
	}
});

test('retiring the press owner cannot admit that occurrence to a replacement viewport, even for a complete short click', t => {
	const { editor, host, pointer, extent } = fixture(t);
	const scope = new InputFocusScope(Symbol('replaced preview'));
	const owner = inputFocus.createTarget(null, scope); owner.bindKeyboard(() => {});
	const game = new GameInputControl(owner, host.input, { kind: 'direct', presenter: host.presenter });
	game.setInput(extent);
	const snapshot = createInputControllerSnapshot();
	for (const shortClick of [false, true]) {
		let replacement: ReturnType<typeof editor.surfaces.attach>;
		const original = editor.surfaces.attach({ role: 'content', captureScope: scope.surfaceScope,
			isVisible: () => true, getBounds: () => extent, getClip: () => extent, draw() {},
			onRetire: () => pointerCapture.cancelScope(scope.surfaceScope),
			handlePointer: () => {
				original.dispose();
				replacement = editor.surfaces.attach({ role: 'content', captureScope: scope.surfaceScope,
					isVisible: () => true, getBounds: () => extent, getClip: () => extent, draw() {},
					handlePointer: event => { game.handlePointer(event); },
					onRetire: () => pointerCapture.cancelScope(scope.surfaceScope) });
				game.focusTarget.focus();
			},
		});
		if (shortClick) editor.dispatchPointer({ x: 100, y: 100, buttons: 0, pressedButtons: PointerButton.Primary,
			releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 });
		else pointer(100, 100, PointerButton.Primary);
		host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
		assert.equal(snapshot.pointerButtons, 0, 'the retired owner consumes its press rather than creating a replacement gesture');
		pointer(100, 100, 0);
		pointer(100, 100, PointerButton.Primary);
		host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
		assert.equal(snapshot.pointerButtons, 1, 'the replacement admits only a genuinely new press');
		pointer(100, 100, 0);
		replacement!.dispose(); game.focusTarget.release();
	}
	game.dispose();
});
