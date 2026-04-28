import type { PointerSnapshot } from '../../../common/models';
import type { Runtime } from '../../../../machine/runtime/runtime';
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

export function handleBlockingWorkbenchModalInput(runtime: Runtime): void {
	if (hasActionPrompt()) {
		handleActionPromptInput(runtime);
	}
}

export function handleBlockingWorkbenchModalPointer(runtime: Runtime, snapshot: PointerSnapshot): boolean {
	if (!hasActionPrompt()) {
		return false;
	}
	handleActionPromptPointer(runtime, snapshot);
	return true;
}

export function drawBlockingWorkbenchModal(): void {
	if (hasActionPrompt()) {
		drawActionPromptOverlay();
	}
}
