import { point_in_rect } from '../../../../utils/rect_operations';
import * as constants from '../../../common/constants';
import { measureText } from '../../../editor/common/text_layout';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { performEditorAction } from '../../../editor/input/commands/editor_actions';
import { consumeIdeKey, isKeyJustPressed } from '../../../editor/input/keyboard/key_input';
import { centerDialogBounds } from '../../../editor/render/dialog_layout';
import { api } from '../../../editor/ui/view/overlay_api';
import { editorViewState } from '../../../editor/ui/editor_view_state';
import type { ActionPromptAction, ActionPromptLayout, ActionPromptState, PointerSnapshot } from '../../../common/types';
import { save } from '../../ui/code_tabs';
import { editorDocumentState } from '../../../editor/editing/editor_document_state';

type ActionPromptUiState = {
	prompt: ActionPromptState | null;
};

type ActionPromptText = {
	messageLines: readonly string[];
	primaryLabel: string;
	secondaryLabel: string;
};

export type ActionPromptChoice = 'save-continue' | 'continue' | 'cancel';

const HOT_RESUME_MESSAGE_LINES = [
	'UNSAVED CHANGES DETECTED.',
	'SAVE BEFORE HOT-RESUME TO APPLY CODE UPDATES?',
] as const;

const REBOOT_MESSAGE_LINES = [
	'UNSAVED CHANGES DETECTED.',
	'SAVE BEFORE REBOOT TO APPLY CODE UPDATES?',
] as const;

const CLOSE_MESSAGE_LINES = [
	'UNSAVED CHANGES DETECTED.',
	'SAVE BEFORE HIDING THE EDITOR?',
] as const;

export const ACTION_PROMPT_PADDING_X = 12;
export const ACTION_PROMPT_PADDING_Y = 12;

export const actionPromptState: ActionPromptUiState = {
	prompt: null,
};

function createRectBounds() {
	return { left: 0, top: 0, right: 0, bottom: 0 };
}

function setRect(bounds: { left: number; top: number; right: number; bottom: number }, left: number, top: number, right: number, bottom: number): void {
	bounds.left = left;
	bounds.top = top;
	bounds.right = right;
	bounds.bottom = bottom;
}

function createActionPromptLayout(): ActionPromptLayout {
	return {
		bounds: createRectBounds(),
		saveAndContinue: createRectBounds(),
		continue: createRectBounds(),
		cancel: createRectBounds(),
	};
}

export function hasActionPrompt(): boolean {
	return actionPromptState.prompt !== null;
}

export function showActionPrompt(action: ActionPromptAction): void {
	actionPromptState.prompt = {
		action,
		layout: createActionPromptLayout(),
	};
	updateActionPromptLayout();
}

export function closeActionPrompt(): void {
	actionPromptState.prompt = null;
}

export function getActionPromptText(action: ActionPromptAction): ActionPromptText {
	switch (action) {
		case 'hot-resume':
			return {
				messageLines: HOT_RESUME_MESSAGE_LINES,
				primaryLabel: 'SAVE & RESUME',
				secondaryLabel: 'RESUME WITHOUT SAVING',
			};
		case 'reboot':
			return {
				messageLines: REBOOT_MESSAGE_LINES,
				primaryLabel: 'SAVE & REBOOT',
				secondaryLabel: 'REBOOT WITHOUT SAVING',
			};
		case 'theme-toggle':
		case 'close':
			return {
				messageLines: CLOSE_MESSAGE_LINES,
				primaryLabel: 'SAVE & HIDE',
				secondaryLabel: 'HIDE WITHOUT SAVING',
			};
	}
}

export function updateActionPromptLayout(): void {
	const prompt = actionPromptState.prompt;
	if (!prompt) {
		return;
	}
	const layout = prompt.layout!;
	const { messageLines, primaryLabel, secondaryLabel } = getActionPromptText(prompt.action);
	let maxMessageWidth = 0;
	for (let i = 0; i < messageLines.length; i += 1) {
		const width = measureText(messageLines[i]);
		if (width > maxMessageWidth) {
			maxMessageWidth = width;
		}
	}
	const cancelLabel = 'CANCEL';
	const primaryWidth = measureText(primaryLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
	const secondaryWidth = measureText(secondaryLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
	const cancelWidth = measureText(cancelLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
	const buttonSpacing = constants.HEADER_BUTTON_SPACING;
	const buttonRowWidth = primaryWidth + secondaryWidth + cancelWidth + buttonSpacing * 2;
	const buttonHeight = editorViewState.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	const messageSpacing = editorViewState.lineHeight + 2;
	const dialogWidth = Math.max(maxMessageWidth + ACTION_PROMPT_PADDING_X * 2, buttonRowWidth + ACTION_PROMPT_PADDING_X * 2);
	const dialogHeight = ACTION_PROMPT_PADDING_Y * 2 + messageLines.length * messageSpacing + 6 + buttonHeight;
	const dialogBounds = centerDialogBounds(dialogWidth, dialogHeight, 4);
	setRect(layout.bounds, dialogBounds.left, dialogBounds.top, dialogBounds.right, dialogBounds.bottom);

	const buttonY = dialogBounds.bottom - ACTION_PROMPT_PADDING_Y - buttonHeight;
	let buttonX = dialogBounds.left + ACTION_PROMPT_PADDING_X;
	setRect(layout.saveAndContinue, buttonX, buttonY, buttonX + primaryWidth, buttonY + buttonHeight);
	buttonX = layout.saveAndContinue.right + buttonSpacing;
	setRect(layout.continue, buttonX, buttonY, buttonX + secondaryWidth, buttonY + buttonHeight);
	buttonX = layout.continue.right + buttonSpacing;
	setRect(layout.cancel, buttonX, buttonY, buttonX + cancelWidth, buttonY + buttonHeight);
}

export function findActionPromptChoiceAt(x: number, y: number): ActionPromptChoice | null {
	const prompt = actionPromptState.prompt;
	if (!prompt) {
		return null;
	}
	const layout = prompt.layout!;
	if (point_in_rect(x, y, layout.saveAndContinue)) {
		return 'save-continue';
	}
	if (point_in_rect(x, y, layout.continue)) {
		return 'continue';
	}
	if (point_in_rect(x, y, layout.cancel)) {
		return 'cancel';
	}
	return null;
}

async function attemptPromptSave(): Promise<boolean> {
	await save();
	return editorDocumentState.dirty === false;
}

async function handleActionPromptSelection(choice: ActionPromptChoice): Promise<void> {
	const prompt = actionPromptState.prompt;
	if (!prompt) {
		return;
	}
	if (choice === 'cancel') {
		closeActionPrompt();
		return;
	}
	if (choice === 'save-continue') {
		const saved = await attemptPromptSave();
		if (!saved) {
			return;
		}
	}
	if (performEditorAction(prompt.action)) {
		closeActionPrompt();
	}
}

export function handleActionPromptInput(): void {
	if (!hasActionPrompt()) {
		return;
	}
	if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		void handleActionPromptSelection('save-continue');
	}
}

export function handleActionPromptPointer(snapshot: PointerSnapshot): void {
	const choice = findActionPromptChoiceAt(snapshot.viewportX, snapshot.viewportY);
	if (choice) {
		void handleActionPromptSelection(choice);
	}
}

export function drawActionPromptOverlay(): void {
	const prompt = actionPromptState.prompt;
	if (!prompt) {
		return;
	}
	api.fill_rect_color(0, 0, editorViewState.viewportWidth, editorViewState.viewportHeight, undefined, constants.ACTION_OVERLAY_COLOR);
	const { messageLines, primaryLabel, secondaryLabel } = getActionPromptText(prompt.action);
	updateActionPromptLayout();
	const layout = prompt.layout!;

	api.fill_rect(layout.bounds.left, layout.bounds.top, layout.bounds.right, layout.bounds.bottom, undefined, constants.ACTION_DIALOG_BACKGROUND_COLOR);
	api.blit_rect(layout.bounds.left, layout.bounds.top, layout.bounds.right, layout.bounds.bottom, undefined, constants.ACTION_DIALOG_BORDER_COLOR);

	const buttonY = layout.bounds.bottom - ACTION_PROMPT_PADDING_Y - (editorViewState.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2);
	let textY = layout.bounds.top + ACTION_PROMPT_PADDING_Y;
	const textX = layout.bounds.left + ACTION_PROMPT_PADDING_X;
	for (let i = 0; i < messageLines.length; i += 1) {
		drawEditorText(editorViewState.font, messageLines[i], textX, textY, undefined, constants.ACTION_DIALOG_TEXT_COLOR);
		textY += editorViewState.lineHeight + 2;
	}

	api.fill_rect(layout.saveAndContinue.left, layout.saveAndContinue.top, layout.saveAndContinue.right, layout.saveAndContinue.bottom, undefined, constants.ACTION_BUTTON_BACKGROUND);
	api.blit_rect(layout.saveAndContinue.left, layout.saveAndContinue.top, layout.saveAndContinue.right, layout.saveAndContinue.bottom, undefined, constants.ACTION_DIALOG_BORDER_COLOR);
	drawEditorText(editorViewState.font, primaryLabel, layout.saveAndContinue.left + constants.HEADER_BUTTON_PADDING_X, buttonY + constants.HEADER_BUTTON_PADDING_Y, undefined, constants.ACTION_BUTTON_TEXT);

	api.fill_rect(layout.continue.left, layout.continue.top, layout.continue.right, layout.continue.bottom, undefined, constants.ACTION_BUTTON_BACKGROUND);
	api.blit_rect(layout.continue.left, layout.continue.top, layout.continue.right, layout.continue.bottom, undefined, constants.ACTION_DIALOG_BORDER_COLOR);
	drawEditorText(editorViewState.font, secondaryLabel, layout.continue.left + constants.HEADER_BUTTON_PADDING_X, buttonY + constants.HEADER_BUTTON_PADDING_Y, undefined, constants.ACTION_BUTTON_TEXT);

	api.fill_rect(layout.cancel.left, layout.cancel.top, layout.cancel.right, layout.cancel.bottom, undefined, constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND);
	api.blit_rect(layout.cancel.left, layout.cancel.top, layout.cancel.right, layout.cancel.bottom, undefined, constants.ACTION_DIALOG_BORDER_COLOR);
	drawEditorText(editorViewState.font, 'CANCEL', layout.cancel.left + constants.HEADER_BUTTON_PADDING_X, buttonY + constants.HEADER_BUTTON_PADDING_Y, undefined, constants.COLOR_HEADER_BUTTON_TEXT);
}
