import type { PlayerInput } from '../../../hosts/common/input/player';

export const POINTER_PRIMARY_JUST_PRESSED = 1;
export const POINTER_PRIMARY_JUST_RELEASED = 2;
export const POINTER_SECONDARY_JUST_PRESSED = 4;
export const POINTER_AUX_JUST_PRESSED = 8;

/** Project producer-owned event edges; navigation never changes physical input. */
export function computeEditorPointerButtonMask(playerInput: PlayerInput): number {
	const primaryState = playerInput.getRawButtonState('pointer_primary', 'pointer');
	const secondaryState = playerInput.getRawButtonState('pointer_secondary', 'pointer');
	const auxState = playerInput.getRawButtonState('pointer_aux', 'pointer');
	return (!primaryState.consumed && primaryState.justpressed ? POINTER_PRIMARY_JUST_PRESSED : 0)
		| (!primaryState.consumed && primaryState.justreleased ? POINTER_PRIMARY_JUST_RELEASED : 0)
		| (!secondaryState.consumed && secondaryState.justpressed ? POINTER_SECONDARY_JUST_PRESSED : 0)
		| (!auxState.consumed && auxState.justpressed ? POINTER_AUX_JUST_PRESSED : 0);
}
