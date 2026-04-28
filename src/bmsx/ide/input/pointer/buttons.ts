import { engineCore } from '../../../core/engine';
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
	const secondaryPressed = secondaryState.pressed && !secondaryState.consumed;
	const secondaryJustPressed = secondaryState.justpressed && !secondaryState.consumed
		|| (secondaryPressed && !editorPointerState.pointerSecondaryWasPressed);
	const auxState = playerInput.getRawButtonState('pointer_aux', 'pointer');
	const auxPressed = auxState.pressed && !auxState.consumed;
	const auxJustPressed = auxState.justpressed && !auxState.consumed
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
