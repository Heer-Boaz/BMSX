import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';

configureFontVariant('tiny');

function snapshot(buttons: number, released = 0): PointerInputSnapshot {
	return { valid: true, insideViewport: true, viewportX: 1000, viewportY: 0,
		pressedButtons: buttons, justPressedButtons: 0, justReleasedButtons: released,
		modifiers: KeyModifier.none, spaceDown: false };
}

test('value input captures a selection on the initial focus press and ends it on release', t => {
	const parent = inputFocus.createTarget(), field = new ValueInput(parent, INTEGER_INPUT_FORMAT, () => assert.fail('selection wrote a value'));
	t.after(() => { inputFocus.setTarget(null); pointerCapture.interrupt(false); field.dispose(); });
	field.setValue(123456789);
	field.handlePointer(0, 0, true, true);
	assert.equal(field.field.focusTarget.hasFocus, true); assert.equal(pointerCapture.active, true);
	const start = field.field.readText();
	pointerCapture.dispatch(snapshot(PointerButton.Primary), false, 0);
	assert.notDeepEqual(field.field.readText(), start);
	pointerCapture.dispatch(snapshot(0, PointerButton.Primary), false, 0);
	assert.equal(field.field.pointerSelecting, false); assert.equal(pointerCapture.active, false);
	assert.equal(field.field.focusTarget.hasFocus, true); assert.equal(field.pending, false);
});

for (const ending of ['lost button', 'focus transfer', 'rebind', 'dispose'] as const) {
	test(`value input retires pointer selection on ${ending}`, t => {
		const parent = inputFocus.createTarget(), field = new ValueInput(parent, INTEGER_INPUT_FORMAT, () => assert.fail('selection wrote a value'));
		t.after(() => { inputFocus.setTarget(null); pointerCapture.interrupt(false); field.dispose(); });
		field.setValue(123); field.handlePointer(0, 0, true, true);
		assert.equal(pointerCapture.active, true); assert.equal(field.field.pointerSelecting, true);
		if (ending === 'lost button') pointerCapture.dispatch(snapshot(0), false, 0);
		else if (ending === 'focus transfer') parent.focus();
		else if (ending === 'rebind') field.setValue(456);
		else field.dispose();
		assert.equal(pointerCapture.active, false); assert.equal(field.field.pointerSelecting, false);
	});
}

for (const ending of ['rebind', 'dispose'] as const) {
	test(`focus handoff cannot start a selection after reentrant ${ending}`, t => {
		const parent = inputFocus.createTarget(), previous = inputFocus.createTarget(), field = new ValueInput(parent, INTEGER_INPUT_FORMAT, () => {});
		t.after(() => { inputFocus.setTarget(null); pointerCapture.interrupt(false); field.dispose(); });
		field.setValue(123); previous.focus();
		previous.onDidBlur(() => { if (ending === 'rebind') field.setValue(456); else field.dispose(); });
		field.handlePointer(0, 0, true, true);
		assert.equal(pointerCapture.active, false); assert.equal(field.field.pointerSelecting, false);
	});
}
