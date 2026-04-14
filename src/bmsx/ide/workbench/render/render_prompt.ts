import type { RectBounds } from '../../../rompack/rompack';
import { api } from '../../editor/ui/view/overlay_api';
import * as constants from '../../common/constants';
import { drawEditorText } from '../../editor/render/text_renderer';
import { measureText } from '../../editor/common/text_layout';
import type { ActionPromptAction, ActionPromptLayout } from '../../common/types';
import { centerDialogBounds } from '../../editor/render/dialog_layout';
import { actionPromptState } from '../../editor/input/overlays/action_prompt_state';
import { editorViewState } from '../../editor/ui/editor_view_state';

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

type ActionPromptText = {
	messageLines: readonly string[];
	primaryLabel: string;
	secondaryLabel: string;
};

function getActionPromptText(action: ActionPromptAction): ActionPromptText {
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

function measureActionPromptLayout(messageLines: readonly string[], primaryLabel: string, secondaryLabel: string): ActionPromptLayout {
	let maxMessageWidth = 0;
	for (let i = 0; i < messageLines.length; i++) {
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
	const paddingX = 12;
	const paddingY = 12;
	const buttonHeight = editorViewState.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	const messageSpacing = editorViewState.lineHeight + 2;
	const dialogWidth = Math.max(maxMessageWidth + paddingX * 2, buttonRowWidth + paddingX * 2);
	const dialogHeight = paddingY * 2 + messageLines.length * messageSpacing + 6 + buttonHeight;
	const bounds = centerDialogBounds(dialogWidth, dialogHeight, 4);
	const left = bounds.left;
	const bottom = bounds.bottom;

	const buttonY = bottom - paddingY - buttonHeight;
	let buttonX = left + paddingX;
	const saveBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + primaryWidth, bottom: buttonY + buttonHeight };
	buttonX = saveBounds.right + buttonSpacing;
	const continueBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + secondaryWidth, bottom: buttonY + buttonHeight };
	buttonX = continueBounds.right + buttonSpacing;
	const cancelBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + cancelWidth, bottom: buttonY + buttonHeight };
	return {
		bounds,
		saveAndContinue: saveBounds,
		continue: continueBounds,
		cancel: cancelBounds,
	};
}

export function drawActionPromptOverlay(): void {
	const prompt = actionPromptState.prompt;
	if (!prompt) {
		return;
	}
	api.fill_rect_color(0, 0, editorViewState.viewportWidth, editorViewState.viewportHeight, undefined, constants.ACTION_OVERLAY_COLOR);
	const promptText = getActionPromptText(prompt.action);
	const { messageLines, primaryLabel, secondaryLabel } = promptText;
	const layout = measureActionPromptLayout(messageLines, primaryLabel, secondaryLabel);
	prompt.layout = layout;

	api.fill_rect(layout.bounds.left, layout.bounds.top, layout.bounds.right, layout.bounds.bottom, undefined, constants.ACTION_DIALOG_BACKGROUND_COLOR);
	api.blit_rect(layout.bounds.left, layout.bounds.top, layout.bounds.right, layout.bounds.bottom, undefined, constants.ACTION_DIALOG_BORDER_COLOR);

	const paddingX = 12;
	const paddingY = 12;
	const buttonY = layout.bounds.bottom - paddingY - (editorViewState.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2);
	let textY = layout.bounds.top + paddingY;
	const textX = layout.bounds.left + paddingX;
	for (let i = 0; i < messageLines.length; i++) {
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
