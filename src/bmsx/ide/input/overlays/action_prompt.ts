import { ide_state } from '../../core/ide_state';
import type { ActionPromptAction, PointerSnapshot } from '../../core/types';
import { save } from '../../ui/editor_tabs';
import { performEditorAction } from '../commands/editor_actions';
import { consumeIdeKey, isKeyJustPressed } from '../keyboard/key_input';
import { point_in_rect } from '../../../utils/rect_operations';
import { actionPromptState } from './action_prompt_state';

export async function handleActionPromptSelection(choice: 'save-continue' | 'continue' | 'cancel'): Promise<void> {
	const prompt = actionPromptState.prompt;
	if (!prompt) {
		return;
	}
	if (choice === 'cancel') {
		resetActionPromptState();
		return;
	}
	if (choice === 'save-continue') {
		const saved = await attemptPromptSave(prompt.action);
		if (!saved) {
			return;
		}
	}
	if (performEditorAction(prompt.action)) {
		resetActionPromptState();
	}
}

export async function attemptPromptSave(action: ActionPromptAction): Promise<boolean> {
	if (action === 'close') {
		await save();
		return ide_state.dirty === false;
	}
	await save();
	return ide_state.dirty === false;
}

export function handleActionPromptInput(): void {
	if (!actionPromptState.prompt) {
		return;
	}
	if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		void handleActionPromptSelection('save-continue');
	}
}

export function handleActionPromptPointer(snapshot: PointerSnapshot): void {
	const prompt = actionPromptState.prompt;
	if (!prompt) {
		return;
	}
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	if (point_in_rect(x, y, prompt.layout.saveAndContinue)) {
		void handleActionPromptSelection('save-continue');
		return;
	}
	if (point_in_rect(x, y, prompt.layout.continue)) {
		void handleActionPromptSelection('continue');
		return;
	}
	if (point_in_rect(x, y, prompt.layout.cancel)) {
		void handleActionPromptSelection('cancel');
	}
}

export function resetActionPromptState(): void {
	actionPromptState.prompt = null;
}
