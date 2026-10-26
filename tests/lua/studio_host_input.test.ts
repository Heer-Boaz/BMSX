import assert from 'node:assert/strict';
import test from 'node:test';
import { HostMenuInput, HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import { HostKeyboardInteraction } from '../../hosts/common/input/host_keyboard_interaction';
import { OnScreenKeyboard } from '../../hosts/common/input/on_screen_keyboard';
import { NATIVE_KEYBOARD_PAGES, ON_SCREEN_KEY_INDEX_BY_CODE } from '../../hosts/common/input/on_screen_keyboard_keys';
import { RemoteInput } from '../../hosts/common/input/remote';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import type { ClipboardContents } from '../../hosts/common/clipboard';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { SYSTEM_RESOURCE_DOMAIN } from '../../ide/common/resource';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { applyInlineFieldEditing, setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { executeClipboardAction } from '../../ide/input/clipboard';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { editorPointerState } from '../../ide/input/pointer/state';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';

test('host exclusive pages suspend every Studio editing channel and retire native targets without losing control focus', async t => {
	const host = createHostFrameFixture();
	const keyboard = new OnScreenKeyboard(host.input, NATIVE_KEYBOARD_PAGES);
	const interaction = new HostKeyboardInteraction(host.input, keyboard, host.presenter, undefined);
	const menu = new HostOverlayMenu(host.presenter, host.runtime, host.input, host.rewind, host.execution, interaction);
	const sources = createTestRuntimeSourceState({ records: [], path2lua: {}, module2lua: {}, entrySourcePath: '',
		projectRootPath: '', can_boot_from_source: false, revision: 0 }, [null, null], SYSTEM_RESOURCE_DOMAIN);
	let projections = 0;
	const display = { measureDisplay() { projections++; return { left: 0, top: 0, width: 256, height: 212 }; } };
	const unused = (): never => { throw new Error('Input admission must not start unrelated domain work.'); };
	const clipboard = new HeadlessClipboard();
	// The complete production owner composition, without a loaded source document or a guest execution request.
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused, display, host.input,
		host.audio, host.tasks, host.execution, host.rewind, host.clock, clipboard, new IdeMicrotaskQueue(),
		{ log() {} }, 0.3, { width: 256, height: 212 }, sources, new Map(), unused, unused, unused);
	const editor = ide.editor;
	const field = new TextField(null, { allowSpace: true }, editor.editorGroup.focusScope);
	let keyboardCancellations = 0, gamepadActions = 0, pointerCancellations = 0;
	field.focusTarget.bindKeyboard(event => applyInlineFieldEditing(event, field), () => keyboardCancellations++);
	field.focusTarget.bindGamepad(() => gamepadActions++);
	setFieldText(field, 'abc', true);
	editorRuntimeState.active = true;
	field.focusTarget.focus();
	const targets: Array<typeof editor.textTarget> = [];
	const unbindTarget = editor.onDidChangeTarget(() => targets.push(editor.textTarget));
	const remote = new RemoteInput(host.input, host.clock, host.input.dispatchEditingKey.bind(host.input),
		event => editor.dispatchPointer(event), event => editor.dispatchWheel(event));
	const pointer = { x: 100, y: 100, buttons: 0, pressedButtons: 0, releasedButtons: 0, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 };
	const wheel = { x: 100, y: 100, deltaX: 0, deltaY: 1, attachmentDeltaY: 1, modifiers: KeyModifier.none, timestamp: 0 };
	const tick = () => { host.input.pollInput(); return menu.tickInput(); };
	t.after(async () => {
		unbindTarget(); menu.dismiss(); inputFocus.setTarget(null);
		await editor.shutdown(); host.audio.dispose(); host.input.dispose();
	});
	assert.equal(editor.textTarget, field);
	assert.equal(editor.clipboardTarget, field);
	const read = Promise.withResolvers<ClipboardContents>();
	clipboard.read = () => read.promise;
	const pendingPaste = executeClipboardAction(clipboard, 'paste', field.focusTarget);
	pointerCapture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() { assert.fail('host takeover is not UP'); },
		cancelPointer() { pointerCancellations++; } });
	menu.requestToggleMenu();
	assert.equal(tick(), HostMenuInput.Active);
	assert.equal(menu.exclusiveInput, true);
	assert.equal(editor.acceptsInput, false);
	assert.equal(inputFocus.target, field.focusTarget, 'exclusive host input preserves the editor return focus');
	assert.equal(pointerCancellations, 1);
	assert.equal(keyboardCancellations, 1);
	assert.deepEqual(targets, [undefined], 'native context retirement is synchronous with the actual host transition');
	assert.equal(editor.textTarget, undefined);
	assert.equal(editor.clipboardTarget, undefined);
	read.resolve({ text: 'revoked clipboard request', images: [] });
	await pendingPaste;
	assert.equal(field.text, 'abc', 'a read admitted before takeover cannot complete an edit during exclusive input');
	assert.equal(editor.dispatchKey(new KeyInputEvent('ArrowLeft', KeyModifier.none)), true);
	editor.dispatchPointer(pointer); editor.dispatchWheel(wheel); editor.tickInput();
	remote.apply([{ type: 'key', code: 'KeyX', down: true }, { type: 'key', code: 'KeyX', down: false },
		{ type: 'pointer', x: 110, y: 110 }, { type: 'wheel', deltaY: 1 }]);
	host.input.setVirtualKeyboardKey('KeyY', true); host.input.setVirtualKeyboardKey('KeyY', false);
	assert.equal(field.text, 'abc');
	assert.equal(field.cursorColumn, 3);
	assert.equal(projections, 0, 'pointer and wheel cannot enter lower geometry or controls');
	assert.equal(gamepadActions, 0);
	assert.equal(editorPointerState.lastPointerSnapshot, null);
	menu.dismiss();
	assert.equal(menu.exclusiveInput, false);
	assert.equal(editor.acceptsInput, true);
	assert.equal(targets[targets.length - 1], field);
	assert.equal(editor.clipboardTarget, field);
	assert.equal(editor.dispatchKey(new KeyInputEvent('ArrowLeft', KeyModifier.none)), true);
	assert.equal(field.cursorColumn, 2);
	editor.dispatchPointer(pointer); editor.dispatchWheel(wheel); editor.tickInput();
	assert.equal(projections, 2);
	assert.equal(gamepadActions, 1);
	remote.apply([{ type: 'key', code: 'KeyX', down: true }, { type: 'key', code: 'KeyX', down: false }]);
	assert.equal(field.text, 'abxc');
	const beforeKeyboard = targets.length;
	menu.requestToggleKeyboard();
	assert.equal(tick(), HostMenuInput.Inactive);
	assert.equal(menu.exclusiveInput, false);
	assert.equal(targets.length, beforeKeyboard, 'the nonexclusive keyboard does not retire the native context');
	const contact = keyboard.allocateSource();
	keyboard.pressKey(contact, ON_SCREEN_KEY_INDEX_BY_CODE.get('KeyB'));
	keyboard.releaseSource(contact);
	assert.equal(field.text, 'abxbc');
	menu.requestToggleMenu(); tick();
	menu.requestToggleMenu(); tick();
	assert.equal(editor.textTarget, undefined, 'options opened after keyboard dismissal close native editing admission');
	menu.requestToggleKeyboard(); tick();
	assert.equal(editor.textTarget, field, 'options-to-keyboard restores the same actual text owner');
	menu.dismiss();
	// Real rewind availability and transitions use the same host-owned eligibility.
	host.rewind.service(true); await host.tasks.join();
	assert.equal(host.rewind.available, true);
	menu.requestOpenRewind(); tick();
	assert.equal(menu.exclusiveInput, true);
	assert.equal(editor.textTarget, undefined);
	menu.dismiss();
	assert.equal(editor.textTarget, field);
	setFieldText(field, 'abc', true);
	menu.requestToggleMenu(); tick();
	remote.apply([{ type: 'key', code: 'ArrowLeft', down: true }]); tick();
	menu.dismiss();
	assert.equal(host.input.getPlayerInput(1).inputHandlers.keyboard!.getKeyState('ArrowLeft').consumed, true,
		'the host sampled owner retains the menu key across exit');
	const repeat = new KeyInputEvent('ArrowLeft', KeyModifier.none, true);
	assert.equal(editor.dispatchKey(repeat), true);
	assert.equal(repeat.consumed, true, 'native default editing must also be suppressed');
	assert.equal(field.cursorColumn, 3, 'an exit-captured physical hold cannot become an editor repeat');
	host.input.setVirtualKeyboardKey('ArrowLeft', true); host.input.setVirtualKeyboardKey('ArrowLeft', false);
	assert.equal(field.cursorColumn, 2, 'a fresh virtual occurrence is not the captured physical key of the same code');
	remote.apply([{ type: 'key', code: 'ArrowLeft', down: false },
		{ type: 'key', code: 'ArrowLeft', down: true }, { type: 'key', code: 'ArrowLeft', down: false }]);
	assert.equal(field.cursorColumn, 1, 'actual UP ends the shared capture before a new ordered press, without waiting for a poll');
	for (const device of ['keyboard:0', undefined]) {
		setFieldText(field, 'abc', true);
		menu.requestToggleMenu(); tick();
		host.input.inputButton('keyboard:0', 'ArrowLeft', true, 1, 0, 100);
		tick(); menu.dismiss();
		assert.equal(editor.dispatchKey(new KeyInputEvent('ArrowLeft', KeyModifier.none, true)), true);
		assert.equal(field.cursorColumn, 3, 'the original physical hold still belongs to the menu');
		host.input.resetInput(device);
		// Browser dispatches ordered editing before publishing the new sampled key.
		assert.equal(editor.dispatchKey(new KeyInputEvent('ArrowLeft', KeyModifier.none)), true);
		assert.equal(field.cursorColumn, 2, 'source cancellation cannot capture a fresh physical press before the next poll');
		host.input.inputButton('keyboard:0', 'ArrowLeft', true, 1, 0, 101);
		editor.dispatchKey(new KeyInputEvent('ArrowLeft', KeyModifier.none, false, false));
		host.input.inputButton('keyboard:0', 'ArrowLeft', false, 0, 0, 101);
	}
	for (const cancel of [() => editor.cancelInput(), () => host.input.resetInput('keyboard:0')]) {
		const read = Promise.withResolvers<ClipboardContents>();
		clipboard.read = () => read.promise;
		const pending = executeClipboardAction(clipboard, 'paste', field.focusTarget);
		cancel();
		assert.equal(inputFocus.target, field.focusTarget);
		read.resolve({ text: 'late input read', images: [] });
		await pending;
		assert.equal(field.text, 'abc', 'window/keyboard-source cancellation revokes asynchronous edits without semantic blur');
	}
});
