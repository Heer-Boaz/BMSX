import { engineCore } from '../../../../core/engine';
import { editorPointerState } from './state';

export const POINTER_PRIMARY_JUST_PRESSED = 1;
export const POINTER_PRIMARY_JUST_RELEASED = 2;
export const POINTER_SECONDARY_JUST_PRESSED = 4;
export const POINTER_AUX_JUST_PRESSED = 8;

export function computeEditorPointerButtonMask(
	playerInput: ReturnType<typeof engineCore.input.getPlayerInput>,
	primaryPressed: boolean
): number {
	const secondaryState = playerInput.getRawButtonState('pointer_secondary', 'pointer');
	const secondaryPressed = secondaryState.pressed === true && secondaryState.consumed !== true;
	const secondaryJustPressed = secondaryState.justpressed === true && secondaryState.consumed !== true
		|| (secondaryPressed && !editorPointerState.pointerSecondaryWasPressed);
	const auxState = playerInput.getRawButtonState('pointer_aux', 'pointer');
	const auxPressed = auxState.pressed === true && auxState.consumed !== true;
	const auxJustPressed = auxState.justpressed === true && auxState.consumed !== true
		|| (auxPressed && !editorPointerState.pointerAuxWasPressed);
	editorPointerState.pointerSecondaryWasPressed = secondaryPressed;
	editorPointerState.pointerAuxWasPressed = auxPressed;
	const primaryWasPressed = editorPointerState.pointerPrimaryWasPressed;
	const primaryJustPressed = primaryPressed && !primaryWasPressed;
	const primaryJustReleased = !primaryPressed && primaryWasPressed;
	if (primaryJustReleased || (!primaryPressed && editorPointerState.pointerSelecting)) {
		editorPointerState.pointerSelecting = false;
	}
	return (primaryJustPressed ? POINTER_PRIMARY_JUST_PRESSED : 0)
		| (primaryJustReleased ? POINTER_PRIMARY_JUST_RELEASED : 0)
		| (secondaryJustPressed ? POINTER_SECONDARY_JUST_PRESSED : 0)
		| (auxJustPressed ? POINTER_AUX_JUST_PRESSED : 0);
}
