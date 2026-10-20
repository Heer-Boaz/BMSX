import type { PlayerInput } from '../../../hosts/common/input/player';

import { PointerButton, type PointerButtons } from '../../../hosts/common/input/pointer_event';

const BUTTONS = [
	{ code: 'pointer_primary', bit: PointerButton.Primary },
	{ code: 'pointer_secondary', bit: PointerButton.Secondary },
	{ code: 'pointer_aux', bit: PointerButton.Auxiliary },
] as const;

/** Project each producer-owned level/edge once; navigation never changes physical input. */
export function readEditorPointerButtons(playerInput: PlayerInput, target: PointerButtons): void {
	let pressed = 0;
	let justPressed = 0;
	let justReleased = 0;
	for (const button of BUTTONS) {
		const state = playerInput.getRawButtonState(button.code, 'pointer');
		if (state.consumed) continue;
		if (state.pressed) pressed |= button.bit;
		if (state.justpressed) justPressed |= button.bit;
		if (state.justreleased) justReleased |= button.bit;
	}
	target.pressedButtons = pressed;
	target.justPressedButtons = justPressed;
	target.justReleasedButtons = justReleased;
}
