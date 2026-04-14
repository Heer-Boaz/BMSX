import type { PointerSnapshot } from '../../../common/types';
import {
	closeActionPrompt,
	drawActionPromptOverlay,
	handleActionPromptInput,
	handleActionPromptPointer,
	hasActionPrompt,
} from './action_prompt';

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

export function handleBlockingWorkbenchModalInput(): void {
	if (hasActionPrompt()) {
		handleActionPromptInput();
	}
}

export function handleBlockingWorkbenchModalPointer(snapshot: PointerSnapshot): boolean {
	if (!hasActionPrompt()) {
		return false;
	}
	handleActionPromptPointer(snapshot);
	return true;
}

export function drawBlockingWorkbenchModal(): void {
	if (hasActionPrompt()) {
		drawActionPromptOverlay();
	}
}
