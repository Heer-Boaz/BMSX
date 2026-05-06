import { create_rect_bounds, point_in_rect, write_rect_bounds } from '../../../../common/rect';
import * as constants from '../../../common/constants';
import { measureText } from '../../../editor/common/text/layout';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { performEditorAction } from '../../../commands/actions';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { writeCenteredDialogBounds } from '../../../editor/render/dialog_layout';
import { api } from '../../../runtime/overlay_api';
import { editorViewState } from '../../../editor/ui/view/state';
import type { ActionPromptAction, ActionPromptLayout, ActionPromptState, PointerSnapshot } from '../../../common/models';
import type { Runtime } from '../../../../machine/runtime/runtime';
import { save } from '../../ui/code_tab/io';
import { editorDocumentState } from '../../../editor/editing/document_state';
import type { FontVariant } from '../../../../render/shared/bmsx_font';

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

const CANCEL_LABEL = 'CANCEL';

const HOT_RESUME_PROMPT_TEXT: ActionPromptText = {
	messageLines: HOT_RESUME_MESSAGE_LINES,
	primaryLabel: 'SAVE & RESUME',
	secondaryLabel: 'RESUME WITHOUT SAVING',
};

const REBOOT_PROMPT_TEXT: ActionPromptText = {
	messageLines: REBOOT_MESSAGE_LINES,
	primaryLabel: 'SAVE & REBOOT',
	secondaryLabel: 'REBOOT WITHOUT SAVING',
};

const CLOSE_PROMPT_TEXT: ActionPromptText = {
	messageLines: CLOSE_MESSAGE_LINES,
	primaryLabel: 'SAVE & HIDE',
	secondaryLabel: 'HIDE WITHOUT SAVING',
};

export const ACTION_PROMPT_PADDING_X = 12;
export const ACTION_PROMPT_PADDING_Y = 12;

export const actionPromptState: ActionPromptUiState = {
	prompt: null,
};

let actionPromptLayoutAction: ActionPromptAction = null;
let actionPromptLayoutViewportWidth = -1;
let actionPromptLayoutViewportHeight = -1;
let actionPromptLayoutLineHeight = -1;
let actionPromptLayoutFontVariant: FontVariant = null;

function isActionPromptLayoutCurrent(action: ActionPromptAction): boolean {
	return actionPromptLayoutAction === action
		&& actionPromptLayoutViewportWidth === editorViewState.viewportWidth
		&& actionPromptLayoutViewportHeight === editorViewState.viewportHeight
		&& actionPromptLayoutLineHeight === editorViewState.lineHeight
		&& actionPromptLayoutFontVariant === editorViewState.fontVariant;
}

function markActionPromptLayoutCurrent(action: ActionPromptAction): void {
	actionPromptLayoutAction = action;
	actionPromptLayoutViewportWidth = editorViewState.viewportWidth;
	actionPromptLayoutViewportHeight = editorViewState.viewportHeight;
	actionPromptLayoutLineHeight = editorViewState.lineHeight;
	actionPromptLayoutFontVariant = editorViewState.fontVariant;
}

function createActionPromptLayout(): ActionPromptLayout {
	return {
		bounds: create_rect_bounds(),
		saveAndContinue: create_rect_bounds(),
		continue: create_rect_bounds(),
		cancel: create_rect_bounds(),
	};
}

const actionPromptLayout = createActionPromptLayout();
const actionPrompt: ActionPromptState = {
	action: 'close',
	layout: actionPromptLayout,
};

export function hasActionPrompt(): boolean {
	return actionPromptState.prompt !== null;
}

export function showActionPrompt(action: ActionPromptAction): void {
	actionPrompt.action = action;
	actionPromptState.prompt = actionPrompt;
	actionPromptLayoutAction = null;
	updateActionPromptLayout();
}

export function closeActionPrompt(): void {
	actionPromptState.prompt = null;
	actionPromptLayoutAction = null;
}

export function getActionPromptText(action: ActionPromptAction): ActionPromptText {
	switch (action) {
		case 'hot-resume':
			return HOT_RESUME_PROMPT_TEXT;
		case 'reboot':
			return REBOOT_PROMPT_TEXT;
		case 'theme-toggle':
		case 'close':
			return CLOSE_PROMPT_TEXT;
	}
}

export function updateActionPromptLayout(): void {
	const prompt = actionPromptState.prompt;
	if (!prompt) {
		return;
	}
	if (isActionPromptLayoutCurrent(prompt.action)) {
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
	const primaryWidth = measureText(primaryLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
	const secondaryWidth = measureText(secondaryLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
	const cancelWidth = measureText(CANCEL_LABEL) + constants.HEADER_BUTTON_PADDING_X * 2;
	const buttonSpacing = constants.HEADER_BUTTON_SPACING;
	const buttonRowWidth = primaryWidth + secondaryWidth + cancelWidth + buttonSpacing * 2;
	const buttonHeight = editorViewState.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	const messageSpacing = editorViewState.lineHeight + 2;
	const messageDialogWidth = maxMessageWidth + ACTION_PROMPT_PADDING_X * 2;
	const buttonDialogWidth = buttonRowWidth + ACTION_PROMPT_PADDING_X * 2;
	const dialogWidth = messageDialogWidth > buttonDialogWidth ? messageDialogWidth : buttonDialogWidth;
	const dialogHeight = ACTION_PROMPT_PADDING_Y * 2 + messageLines.length * messageSpacing + 6 + buttonHeight;
	writeCenteredDialogBounds(layout.bounds, dialogWidth, dialogHeight, 4);

	const buttonY = layout.bounds.bottom - ACTION_PROMPT_PADDING_Y - buttonHeight;
	let buttonX = layout.bounds.left + ACTION_PROMPT_PADDING_X;
	write_rect_bounds(layout.saveAndContinue, buttonX, buttonY, buttonX + primaryWidth, buttonY + buttonHeight);
	buttonX = layout.saveAndContinue.right + buttonSpacing;
	write_rect_bounds(layout.continue, buttonX, buttonY, buttonX + secondaryWidth, buttonY + buttonHeight);
	buttonX = layout.continue.right + buttonSpacing;
	write_rect_bounds(layout.cancel, buttonX, buttonY, buttonX + cancelWidth, buttonY + buttonHeight);
	markActionPromptLayoutCurrent(prompt.action);
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

async function attemptPromptSave(runtime: Runtime): Promise<boolean> {
	await save(runtime);
	return editorDocumentState.dirty === false;
}

async function handleActionPromptSelection(runtime: Runtime, choice: ActionPromptChoice): Promise<void> {
	const prompt = actionPromptState.prompt;
	if (!prompt) {
		return;
	}
	if (choice === 'cancel') {
		closeActionPrompt();
		return;
	}
	if (choice === 'save-continue') {
		const saved = await attemptPromptSave(runtime);
		if (!saved) {
			return;
		}
	}
	if (performEditorAction(runtime, prompt.action)) {
		closeActionPrompt();
	}
}

export function handleActionPromptInput(runtime: Runtime): void {
	if (!hasActionPrompt()) {
		return;
	}
	if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		void handleActionPromptSelection(runtime, 'save-continue');
	}
}

export function handleActionPromptPointer(runtime: Runtime, snapshot: PointerSnapshot): void {
	const choice = findActionPromptChoiceAt(snapshot.viewportX, snapshot.viewportY);
	if (choice) {
		void handleActionPromptSelection(runtime, choice);
	}
}

export function drawActionPromptOverlay(): void {
	const prompt = actionPromptState.prompt;
	if (!prompt) {
		return;
	}
	api.fill_rect(0, 0, editorViewState.viewportWidth, editorViewState.viewportHeight, undefined, constants.ACTION_OVERLAY_COLOR);
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
	drawEditorText(editorViewState.font, CANCEL_LABEL, layout.cancel.left + constants.HEADER_BUTTON_PADDING_X, buttonY + constants.HEADER_BUTTON_PADDING_Y, undefined, constants.COLOR_HEADER_BUTTON_TEXT);
}
