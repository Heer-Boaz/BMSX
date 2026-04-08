import { $ } from '../../../../core/engine_core';
import { ide_state } from '../../ide_state';

export const POINTER_PRIMARY_JUST_PRESSED = 1;
export const POINTER_PRIMARY_JUST_RELEASED = 2;
export const POINTER_SECONDARY_JUST_PRESSED = 4;
export const POINTER_AUX_JUST_PRESSED = 8;

export function computeEditorPointerButtonMask(
	playerInput: ReturnType<typeof $.input.getPlayerInput>,
	primaryPressed: boolean
): number {
	const secondaryAction = playerInput.getActionState('pointer_secondary');
	const secondaryPressed = secondaryAction.pressed === true && secondaryAction.consumed !== true;
	const secondaryJustPressed = secondaryAction.justpressed === true && secondaryAction.consumed !== true
		|| (secondaryPressed && !ide_state.pointerSecondaryWasPressed);
	const auxAction = playerInput.getActionState('pointer_aux');
	const auxPressed = auxAction.pressed === true && auxAction.consumed !== true;
	const auxJustPressed = auxAction.justpressed === true && auxAction.consumed !== true
		|| (auxPressed && !ide_state.pointerAuxWasPressed);
	ide_state.pointerSecondaryWasPressed = secondaryPressed;
	ide_state.pointerAuxWasPressed = auxPressed;
	const primaryWasPressed = ide_state.pointerPrimaryWasPressed;
	const primaryJustPressed = primaryPressed && !primaryWasPressed;
	const primaryJustReleased = !primaryPressed && primaryWasPressed;
	if (primaryJustReleased || (!primaryPressed && ide_state.pointerSelecting)) {
		ide_state.pointerSelecting = false;
	}
	return (primaryJustPressed ? POINTER_PRIMARY_JUST_PRESSED : 0)
		| (primaryJustReleased ? POINTER_PRIMARY_JUST_RELEASED : 0)
		| (secondaryJustPressed ? POINTER_SECONDARY_JUST_PRESSED : 0)
		| (auxJustPressed ? POINTER_AUX_JUST_PRESSED : 0);
}
