import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { WorkbenchCheckboxControl, type WorkbenchCheckboxInput } from '../../ide/workbench/ui/checkbox_control';

function fixture(t: TestContext) {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), parent = focus.createTarget();
	parent.bindKeyboard(() => {});
	const calls: { input: WorkbenchCheckboxInput; checked: boolean }[] = [];
	const control = new WorkbenchCheckboxControl(focus, capture, parent, (input, checked) => calls.push({ input, checked }));
	const input = { checked: false, enabled: true, label: 'VISIBLE' };
	const font = new EditorFont('tiny'), bounds = { left: 10, top: 20, right: 210, bottom: 40 };
	control.setInput(input); control.layout(bounds, bounds, font);
	const key = (code: string, down = true, repeat = false, modifiers = KeyModifier.none) => {
		const event = new KeyInputEvent(code, modifiers, repeat, down); focus.handleKeyboard(event); return event;
	};
	const pointer = (pressedButtons: number, justPressedButtons = 0, justReleasedButtons = 0, outside = false) => {
		const snapshot: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true,
			viewportX: outside ? bounds.right + 20 : control.labelX + 1, viewportY: 30,
			pressedButtons, justPressedButtons, justReleasedButtons };
		return capture.dispatch(snapshot, false, 0) || control.handlePointer(snapshot);
	};
	t.after(() => control.dispose());
	return { focus, capture, parent, control, input, calls, key, pointer, font, bounds };
}

test('checkbox label click publishes one controlled intent on primary release, not an optimistic value', t => {
	const f = fixture(t);
	f.pointer(PointerButton.Primary, PointerButton.Primary);
	assert.ok(f.focus.target === f.control.focusTarget); assert.equal(f.capture.active, true);
	assert.equal(f.calls.length, 0); assert.equal(f.control.input!.checked, false);
	f.pointer(0, 0, PointerButton.Primary);
	assert.equal(f.capture.active, false); assert.equal(f.calls.length, 1);
	assert.ok(f.calls[0].input === f.input); assert.equal(f.calls[0].checked, true);
	assert.equal(f.control.input!.checked, false, 'only the producer publishes the new value');
	f.control.setInput({ ...f.input, checked: true });
	f.pointer(PointerButton.Primary, PointerButton.Primary); f.pointer(0, 0, PointerButton.Primary);
	assert.equal(f.calls.length, 2); assert.equal(f.calls[1].checked, false);
});

test('a coalesced primary press and release accepts exactly once and leaves no capture', t => {
	const f = fixture(t);
	f.pointer(0, PointerButton.Primary, PointerButton.Primary);
	assert.equal(f.calls.length, 1); assert.equal(f.calls[0].checked, true);
	assert.equal(f.capture.active, false); assert.equal(f.control.pressed, false);
});

test('capture takeover cannot arm a checkbox input retired by the previous capture cancellation', t => {
	const f = fixture(t);
	f.capture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() {},
		cancelPointer() { f.control.setInput({ ...f.input }); } });
	f.control.handlePointer({ modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true,
		viewportX: f.control.labelX + 1, viewportY: 30, pressedButtons: PointerButton.Primary,
		justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 });
	assert.equal(f.capture.active, false); assert.equal(f.control.pressed, false);
	f.pointer(0, 0, PointerButton.Primary); assert.equal(f.calls.length, 0);
});

for (const code of ['Space', 'Enter', 'NumpadEnter']) test(`${code} checkbox activation needs its own release and ignores repeats`, t => {
	const f = fixture(t); assert.equal(f.control.focusTarget.focus(), true);
	assert.equal(f.key(code).consumed, true); assert.equal(f.control.pressed, true);
	f.key(code, true, true); f.key(code === 'Space' ? 'Enter' : 'Space', false);
	assert.equal(f.calls.length, 0); assert.equal(f.control.pressed, true);
	f.key(code, false); f.key(code, false);
	assert.equal(f.calls.length, 1); assert.equal(f.calls[0].checked, true); assert.equal(f.control.pressed, false);
});

test('modified keyboard input, secondary clicks and primary releases outside cannot accept a checkbox', t => {
	const f = fixture(t); f.control.focusTarget.focus();
	assert.equal(f.key('Space', true, false, KeyModifier.ctrl).consumed, false);
	f.key('Space', false); assert.equal(f.control.pressed, false);
	assert.equal(f.pointer(PointerButton.Secondary, PointerButton.Secondary), false, 'the containing context menu retains right-click admission');
	f.pointer(PointerButton.Primary, PointerButton.Primary); f.pointer(0, 0, PointerButton.Primary, true);
	assert.equal(f.calls.length, 0); assert.equal(f.capture.active, false);
});

for (const gesture of ['keyboard', 'pointer'] as const)
	for (const retirement of ['input', 'disabled', 'clear', 'blur', 'scope', 'layout', 'cancel', 'escape'] as const)
		test(`${retirement} retires an armed checkbox ${gesture} without publishing an intent`, t => {
			const f = fixture(t);
			if (gesture === 'pointer') f.pointer(PointerButton.Primary, PointerButton.Primary);
			else { f.control.focusTarget.focus(); f.key('Space'); }
			assert.equal(f.control.pressed, true);
			switch (retirement) {
				case 'input': f.control.setInput({ ...f.input }); break;
				case 'disabled': f.control.setInput({ ...f.input, enabled: false }); break;
				case 'clear': f.control.clearInput(); break;
				case 'blur': f.parent.focus(); break;
				case 'scope': f.parent.scope.retireContext(); break;
				case 'layout': f.control.layout({ ...f.bounds, right: 180 }, f.bounds, f.font); break;
				case 'cancel': f.focus.cancelInput(); break;
				case 'escape': f.key('Escape'); break;
			}
			assert.equal(f.control.pressed, false); assert.equal(f.capture.active, false);
			if (gesture === 'pointer') f.pointer(0, 0, PointerButton.Primary);
			else f.key('Space', false);
			assert.equal(f.calls.length, 0);
		});

for (const change of ['input', 'focus', 'scope'] as const) test(`checkbox pointer admission cannot outlive a ${change} change from its focus callback`, t => {
	const f = fixture(t);
	const unbind = f.control.focusTarget.onDidFocus(() => {
		unbind();
		if (change === 'input') f.control.setInput({ ...f.input });
		else if (change === 'focus') f.parent.focus();
		else f.parent.scope.retireContext();
	});
	t.after(unbind);
	f.pointer(PointerButton.Primary, PointerButton.Primary); f.pointer(0, 0, PointerButton.Primary);
	assert.equal(f.capture.active, false); assert.equal(f.calls.length, 0);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} checkbox discloses its entire clipped label without making disabled values editable`, t => {
	const f = fixture(t), font = new EditorFont(variant), input = { ...f.input, label: 'A LONG AUTHORED PROPERTY NAME' };
	const narrow = { ...f.bounds, right: 72 };
	f.control.setInput(input); f.control.layout(narrow, narrow, font);
	assert.equal(f.control.tooltipItem, undefined);
	f.control.focusTarget.focus();
	assert.equal(f.control.tooltipItem!.tooltip, input.label, 'full label disclosure is a content-integrity contract');
	const disclosure = f.control.tooltipItem;
	assert.ok(f.control.tooltipItem === disclosure, 'feedback consumes retained state');
	f.control.setInput({ ...input, enabled: false });
	assert.ok(f.focus.target === f.parent);
	f.pointer(0); assert.equal(f.control.tooltipItem!.tooltip, input.label);
	f.pointer(PointerButton.Primary, PointerButton.Primary); f.pointer(0, 0, PointerButton.Primary);
	assert.equal(f.calls.length, 0); assert.equal(f.capture.active, false);
	f.control.onPointerLeave(); assert.equal(f.control.tooltipItem, undefined);
});
