import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { insertValue } from '../../ide/editor/ui/inline/text_field';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { inputFocus } from '../../ide/input/focus';
import { handleEditorCommandBindings } from '../../ide/input/keyboard/global_bindings';
import { pointerCapture, WORKBENCH_POINTER_SCOPE } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { WorkbenchTextViewControl } from '../../ide/workbench/ui/text_view/control';
import { WorkbenchTextViewModel } from '../../ide/workbench/ui/text_view/model';

const P = PointerButton.Primary;
function fixture(t: TestContext, variant: 'tiny' | 'msx') {
	configureFontVariant(variant);
	const parent = inputFocus.createTarget(), actions = inputFocus.createTarget(parent);
	parent.bindKeyboard(() => {}); actions.bindKeyboard(() => {});
	const control = new WorkbenchTextViewControl(parent), model = new WorkbenchTextViewModel(new PieceTreeBuffer('first probe\r\nsecond probe\n'));
	control.focusTarget.next = control.focusTarget.previous = actions;
	actions.next = actions.previous = control.focusTarget;
	const bounds = { left: 20, top: 30, right: 320, bottom: 210 };
	const update = () => control.update(bounds, editorViewState.font, editorViewState.lineHeight);
	control.setInput(model); update(); control.focusTarget.focus();
	const press = (code: string, modifiers = KeyModifier.none) => {
		for (const down of [true, false]) {
			const event = new KeyInputEvent(code, modifiers, false, down);
			if (!handleEditorCommandBindings(event, undefined)) inputFocus.handleKeyboard(event);
		} update();
	};
	let time = 0;
	const pointer = (x: number, y: number, held = 0, down = 0, up = 0) => {
		const event: PointerInputSnapshot = { viewportX: x, viewportY: y, valid: true, insideViewport: true,
			modifiers: KeyModifier.none, spaceDown: false, pressedButtons: held, justPressedButtons: down, justReleasedButtons: up };
		pointerHover.beginDispatch();
		if (!pointerCapture.dispatch(event, false, ++time)) {
			pointerCapture.beginRoute(WORKBENCH_POINTER_SCOPE, event); control.handlePointer(event);
		}
		pointerCapture.endRoute(event); pointerHover.endDispatch(); update();
	};
	t.after(() => { control.dispose(); pointerCapture.interrupt(false); pointerHover.clear(); inputFocus.setTarget(null); });
	return { control, model, actions, bounds, update, press, pointer };
}

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} local Find splices into and out of a callback focus boundary without replacing the view owner`, t => {
		const f = fixture(t, variant);
		let returns = 0;
		const returnToContent = () => { returns++; f.actions.focus(); };
		f.control.focusTarget.next = returnToContent;
		f.press('KeyF', KeyModifier.ctrl);
		assert.equal(f.control.findField.focusTarget.next, returnToContent);
		assert.equal(inputFocus.moveFocus(false), true); assert.equal(returns, 1);
		assert.equal(inputFocus.target, f.actions);
		f.control.closeFind();
		assert.equal(f.control.focusTarget.next, returnToContent);
		assert.equal(f.control.findField.focusTarget.next, null);
		assert.equal(inputFocus.moveFocus(false), true); assert.equal(returns, 2);
		assert.equal(inputFocus.target, f.actions);
	});

	test(`${variant} real local Find bindings select distinct raw occurrences and Escape returns exact document clipboard ownership`, t => {
		const f = fixture(t, variant), clipboard = new HeadlessClipboard();
		f.press('KeyF', KeyModifier.ctrl); assert.equal(f.control.findVisible, true);
		assert.equal(inputFocus.target, f.control.findField.focusTarget);
		insertValue(f.control.findField, 'probe'); f.update(); assert.equal(f.model.matchCount, 2);
		f.press('Enter'); assert.equal(f.model.selectionStart, 6); assert.equal(f.model.matchIndex, 0);
		f.press('F3'); assert.equal(f.model.selectionStart, 20); assert.equal(f.model.matchIndex, 1);
		f.press('F3', KeyModifier.shift); assert.equal(f.model.selectionStart, 6);
		f.press('Escape'); assert.equal(inputFocus.target, f.control.focusTarget);
		clipboard.execute('copy', inputFocus.target!.clipboard!); assert.equal(clipboard.text, 'probe');
		f.press('KeyA', KeyModifier.ctrl); clipboard.execute('copy', inputFocus.target!.clipboard!);
		assert.equal(clipboard.text, 'first probe\r\nsecond probe\n');
		assert.equal(f.model.buffer.version, 0); assert.equal(inputFocus.target!.clipboard!.readOnly, true);
	});

	test(`${variant} real source publication cancels the owned selection before mutation and drains only the old physical hold`, t => {
		const f = fixture(t, variant), x = f.bounds.left + 5, y = f.bounds.top + 5;
		f.pointer(x, y, P, P); assert.equal(pointerCapture.active, true);
		f.model.setBuffer(new PieceTreeBuffer('prefix first probe\r\nsecond probe\n'));
		assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
		const selection = [f.model.selectionAnchor, f.model.cursorOffset];
		f.pointer(x + 30, y, P); assert.deepEqual([f.model.selectionAnchor, f.model.cursorOffset], selection);
		f.pointer(x + 30, y, 0, 0, P); assert.equal(pointerCapture.draining, false);
		f.pointer(x, y, P, P); assert.equal(pointerCapture.active, true);
		f.pointer(x + 30, y, 0, 0, P); assert.equal(pointerCapture.active, false);
		assert.ok(f.model.selectionEnd > f.model.selectionStart, 'only a fresh down may begin a new source selection');
	});

	test(`${variant} Find joins the supplied Tab ring only while arranged and its X requires an accepted paired release`, t => {
		const f = fixture(t, variant); f.press('KeyF', KeyModifier.ctrl);
		assert.equal(f.control.focusTarget.next, f.control.findField.focusTarget);
		assert.equal(f.control.findField.focusTarget.next, f.actions);
		f.bounds.right = f.bounds.left + 18; f.update();
		assert.equal(f.control.findVisible, true); assert.equal(f.control.findField.focusTarget.canFocus!(), false);
		assert.equal(f.control.focusTarget.next, f.actions); assert.equal(f.actions.previous, f.control.focusTarget);
		f.bounds.right = 320; f.update(); assert.equal(f.control.focusTarget.next, f.control.findField.focusTarget);
		const close = f.control.findCloseBounds, x = (close.left + close.right) / 2, y = (close.top + close.bottom) / 2;
		f.pointer(x, y, P, P); f.pointer(f.bounds.left - 5, y, 0, 0, P);
		assert.equal(f.control.findVisible, true, 'release outside the button is not Close');
		f.pointer(x, y, P, P); pointerCapture.cancel();
		f.pointer(x, y, 0, 0, P); assert.equal(f.control.findVisible, true, 'cancellation is not an implicit click');
		f.pointer(x, y, 0, P, P); assert.equal(f.control.findVisible, false, 'a complete short physical click is accepted');
		assert.equal(inputFocus.target, f.control.focusTarget);
		assert.equal(f.control.focusTarget.next, f.actions); assert.equal(f.actions.previous, f.control.focusTarget);
	});
}
