import type { PointerSnapshot } from '../../../common/models';
import {
	closeActionPrompt,
	drawActionPromptOverlay,
	handleActionPromptInput,
	handleActionPromptPointer,
	hasActionPrompt,
} from './action_prompt';
import type { CartEditor } from '../../../cart_editor';
import type { PlayerInput } from '../../../../hosts/common/input/player';

export function hasBlockingWorkbenchModal(): boolean {
	return hasActionPrompt();
}

export function closeBlockingWorkbenchModal(): boolean {
	if (hasActionPrompt()) {
		closeActionPrompt();
		return true;
	}
	return false;
}

export function handleBlockingWorkbenchModalInput(
	playerInput: PlayerInput,
	editor: CartEditor,
): void {
	if (hasActionPrompt()) {
		handleActionPromptInput(
			playerInput,
			editor,
		);
	}
}

export function handleBlockingWorkbenchModalPointer(
	editor: CartEditor,
	snapshot: PointerSnapshot,
): boolean {
	if (!hasActionPrompt()) {
		return false;
	}
	handleActionPromptPointer(
		editor,
		snapshot,
	);
	return true;
}

export function drawBlockingWorkbenchModal(): void {
	if (hasActionPrompt()) {
		drawActionPromptOverlay();
	}
}
