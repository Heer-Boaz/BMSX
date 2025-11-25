import type { RectBounds } from '../../../rompack/rompack';
import { api } from '../../runtime';
import * as constants from '../constants';
import { ide_state } from '../ide_state';
import { drawEditorText } from '../text_renderer';
import { measureText } from '../text_utils';


export function drawActionPromptOverlay(): void {
	const prompt = ide_state.pendingActionPrompt;
	if (!prompt) {
		return;
	}
	api.rectfill_color(0, 0, ide_state.viewportWidth, ide_state.viewportHeight, undefined, constants.ACTION_OVERLAY_COLOR);

	let messageLines: string[];
	let primaryLabel: string;
	let secondaryLabel: string;
	switch (prompt.action) {
		case 'resume':
			messageLines = [
				'UNSAVED CHANGES DETECTED.',
				'SAVE BEFORE RESUME TO APPLY CODE UPDATES?',
			];
			primaryLabel = 'SAVE & RESUME';
			secondaryLabel = 'RESUME WITHOUT SAVING';
			break;
		case 'reboot':
			messageLines = [
				'UNSAVED CHANGES DETECTED.',
				'SAVE BEFORE REBOOT TO APPLY CODE UPDATES?',
			];
			primaryLabel = 'SAVE & REBOOT';
			secondaryLabel = 'REBOOT WITHOUT SAVING';
			break;
		case 'close':
		default:
			messageLines = [
				'UNSAVED CHANGES DETECTED.',
				'SAVE BEFORE HIDING THE EDITOR?',
			];
			primaryLabel = 'SAVE & HIDE';
			secondaryLabel = 'HIDE WITHOUT SAVING';
			break;
	}
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
	const buttonHeight = ide_state.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	const messageSpacing = ide_state.lineHeight + 2;
	const dialogWidth = Math.max(maxMessageWidth + paddingX * 2, buttonRowWidth + paddingX * 2);
	const dialogHeight = paddingY * 2 + messageLines.length * messageSpacing + 6 + buttonHeight;
	const left = Math.max(4, Math.floor((ide_state.viewportWidth - dialogWidth) / 2));
	const top = Math.max(4, Math.floor((ide_state.viewportHeight - dialogHeight) / 2));
	const right = left + dialogWidth;
	const bottom = top + dialogHeight;

	api.rectfill(left, top, right, bottom, undefined, constants.ACTION_DIALOG_BACKGROUND_COLOR);
	api.rect(left, top, right, bottom, undefined, constants.ACTION_DIALOG_BORDER_COLOR);

	let textY = top + paddingY;
	const textX = left + paddingX;
	for (let i = 0; i < messageLines.length; i++) {
		drawEditorText(api, ide_state.font, messageLines[i], textX, textY, undefined, constants.ACTION_DIALOG_TEXT_COLOR);
		textY += messageSpacing;
	}

	const buttonY = bottom - paddingY - buttonHeight;
	let buttonX = left + paddingX;
	const saveBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + primaryWidth, bottom: buttonY + buttonHeight };
	api.rectfill(saveBounds.left, saveBounds.top, saveBounds.right, saveBounds.bottom, undefined, constants.ACTION_BUTTON_BACKGROUND);
	api.rect(saveBounds.left, saveBounds.top, saveBounds.right, saveBounds.bottom, undefined, constants.ACTION_DIALOG_BORDER_COLOR);
	drawEditorText(api, ide_state.font, primaryLabel, saveBounds.left + constants.HEADER_BUTTON_PADDING_X, saveBounds.top + constants.HEADER_BUTTON_PADDING_Y, undefined, constants.ACTION_BUTTON_TEXT);
	ide_state.actionPromptButtons.saveAndContinue = saveBounds;
	buttonX = saveBounds.right + buttonSpacing;

	const continueBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + secondaryWidth, bottom: buttonY + buttonHeight };
	api.rectfill(continueBounds.left, continueBounds.top, continueBounds.right, continueBounds.bottom, undefined, constants.ACTION_BUTTON_BACKGROUND);
	api.rect(continueBounds.left, continueBounds.top, continueBounds.right, continueBounds.bottom, undefined, constants.ACTION_DIALOG_BORDER_COLOR);
	drawEditorText(api, ide_state.font, secondaryLabel, continueBounds.left + constants.HEADER_BUTTON_PADDING_X, continueBounds.top + constants.HEADER_BUTTON_PADDING_Y, undefined, constants.ACTION_BUTTON_TEXT);
	ide_state.actionPromptButtons.continue = continueBounds;
	buttonX = continueBounds.right + buttonSpacing;

	const cancelBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + cancelWidth, bottom: buttonY + buttonHeight };
	api.rectfill(cancelBounds.left, cancelBounds.top, cancelBounds.right, cancelBounds.bottom, undefined, constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND);
	api.rect(cancelBounds.left, cancelBounds.top, cancelBounds.right, cancelBounds.bottom, undefined, constants.ACTION_DIALOG_BORDER_COLOR);
	drawEditorText(api, ide_state.font, cancelLabel, cancelBounds.left + constants.HEADER_BUTTON_PADDING_X, cancelBounds.top + constants.HEADER_BUTTON_PADDING_Y, undefined, constants.COLOR_HEADER_BUTTON_TEXT);
	ide_state.actionPromptButtons.cancel = cancelBounds;
}
