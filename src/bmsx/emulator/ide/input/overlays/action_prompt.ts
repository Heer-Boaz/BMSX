import { ide_state } from '../../core/ide_state';
import type { PendingActionPrompt, PointerSnapshot } from '../../core/types';
import { save } from '../../browser/editor_tabs';
import { performEditorAction } from '../commands/editor_actions';
import { consumeIdeKey, isKeyJustPressed } from '../keyboard/key_input';
import { point_in_rect } from '../../../../utils/rect_operations';

export async function handleActionPromptSelection(choice: 'save-continue' | 'continue' | 'cancel'): Promise<void> {
	if (!ide_state.pendingActionPrompt) {
		return;
	}
	if (choice === 'cancel') {
		resetActionPromptState();
		return;
	}
	if (choice === 'save-continue') {
		const saved = await attemptPromptSave(ide_state.pendingActionPrompt.action);
		if (!saved) {
			return;
		}
	}
	if (performEditorAction(ide_state.pendingActionPrompt.action)) {
		resetActionPromptState();
	}
}

export async function attemptPromptSave(action: PendingActionPrompt['action']): Promise<boolean> {
	if (action === 'close') {
		await save();
		return ide_state.dirty === false;
	}
	await save();
	return ide_state.dirty === false;
}

export function handleActionPromptInput(): void {
	if (!ide_state.pendingActionPrompt) {
		return;
	}
	if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		void handleActionPromptSelection('save-continue');
	}
}

export function handleActionPromptPointer(snapshot: PointerSnapshot): void {
	if (!ide_state.pendingActionPrompt) {
		return;
	}
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	const saveBounds = ide_state.actionPromptButtons.saveAndContinue;
	if (saveBounds && point_in_rect(x, y, saveBounds)) {
		void handleActionPromptSelection('save-continue');
		return;
	}
	if (point_in_rect(x, y, ide_state.actionPromptButtons.continue)) {
		void handleActionPromptSelection('continue');
		return;
	}
	if (point_in_rect(x, y, ide_state.actionPromptButtons.cancel)) {
		void handleActionPromptSelection('cancel');
	}
}

export function resetActionPromptState(): void {
	ide_state.pendingActionPrompt = null;
	ide_state.actionPromptButtons.saveAndContinue = null;
	ide_state.actionPromptButtons.continue = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.actionPromptButtons.cancel = { left: 0, top: 0, right: 0, bottom: 0 };
}
