import { create_rect_bounds, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import type { EditorActionRequest } from '../../../commands/action_request';
import * as constants from '../../../common/constants';
import { measureText } from '../../../editor/common/text/layout';
import { writeCenteredDialogBounds } from '../../../editor/render/dialog_layout';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';

export type ActionPromptAction = Exclude<EditorActionRequest['action'], 'theme-toggle'>;
export type ActionPromptChoice = 'save-continue' | 'continue' | 'cancel';

const PROMPTS = {
	'hot-resume': ['SAVE CHANGES BEFORE HOT-RESUME?', 'SAVE & RESUME', 'RESUME WITHOUT SAVING'],
	reboot: ['SAVE CHANGES BEFORE REBOOT?', 'SAVE & REBOOT', 'REBOOT WITHOUT SAVING'],
	run: ['SAVE CHANGES BEFORE RUNNING?', 'SAVE & RUN', 'RUN WITHOUT SAVING'],
	close: ['SAVE BEFORE HIDING THE EDITOR?', 'SAVE & HIDE', 'HIDE WITHOUT SAVING'],
} as const;
const PADDING = 12;

/** Retained geometry; neither the save batch nor command execution belongs to the dialog. */
export class ActionPromptView {
	public readonly bounds = create_rect_bounds();
	public readonly buttons = (['save-continue', 'continue', 'cancel'] as const).map(choice => ({
		choice, label: '', bounds: create_rect_bounds(),
	}));
	private action: ActionPromptAction | undefined;
	private font: BFont | undefined;
	private width = -1;
	private height = -1;

	public update(action: ActionPromptAction): void {
		const { viewportWidth, viewportHeight, font, lineHeight } = editorViewState;
		const renderFont = font.renderFont();
		if (action === this.action && viewportWidth === this.width && viewportHeight === this.height && renderFont === this.font) return;
		this.action = action; this.width = viewportWidth; this.height = viewportHeight; this.font = renderFont;
		const [message, primary, secondary] = PROMPTS[action];
		this.buttons[0].label = primary; this.buttons[1].label = secondary; this.buttons[2].label = 'CANCEL';
		const spacing = constants.HEADER_BUTTON_SPACING;
		const buttonHeight = lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
		let rowWidth = spacing * (this.buttons.length - 1), widestButton = 0;
		for (const button of this.buttons) {
			const width = measureText(button.label) + constants.HEADER_BUTTON_PADDING_X * 2;
			rowWidth += width;
			widestButton = Math.max(widestButton, width);
			write_rect_bounds(button.bounds, 0, 0, width, buttonHeight);
		}
		const stacked = rowWidth + PADDING * 2 > viewportWidth - 8;
		const contentWidth = Math.max(measureText('UNSAVED CHANGES DETECTED.'), measureText(message), stacked ? widestButton : rowWidth);
		const height = PADDING * 2 + (lineHeight + 2) * 2 + 6
			+ (stacked ? buttonHeight * this.buttons.length + spacing * (this.buttons.length - 1) : buttonHeight);
		writeCenteredDialogBounds(this.bounds, contentWidth + PADDING * 2, height, 4);
		let x = this.bounds.left + PADDING, y = this.bounds.top + PADDING + (lineHeight + 2) * 2 + 6;
		for (const button of this.buttons) {
			const width = stacked ? contentWidth : button.bounds.right;
			write_rect_bounds(button.bounds, x, y, x + width, y + buttonHeight);
			if (stacked) y += buttonHeight + spacing; else x += width + spacing;
		}
	}

	public draw(focused: number, pressed: number, hovered: number): void {
		const { font, lineHeight, viewportWidth, viewportHeight } = editorViewState;
		const bounds = this.bounds;
		api.fill_rect(0, 0, viewportWidth, viewportHeight, 0, constants.ACTION_OVERLAY_COLOR);
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.ACTION_DIALOG_BACKGROUND_COLOR);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.ACTION_DIALOG_BORDER_COLOR);
		drawEditorText(font, 'UNSAVED CHANGES DETECTED.', bounds.left + PADDING, bounds.top + PADDING, 0, constants.ACTION_DIALOG_TEXT_COLOR);
		drawEditorText(font, PROMPTS[this.action!][0], bounds.left + PADDING, bounds.top + PADDING + lineHeight + 2, 0, constants.ACTION_DIALOG_TEXT_COLOR);
		for (let index = 0; index < this.buttons.length; index++) {
			const { label, bounds: button } = this.buttons[index];
			const background = index === pressed ? constants.COLOR_HEADER_BUTTON_PRESSED_BACKGROUND
				: index === hovered ? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND : constants.ACTION_BUTTON_BACKGROUND;
			const color = index === pressed ? constants.COLOR_HEADER_BUTTON_PRESSED_TEXT
				: index === hovered ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.ACTION_BUTTON_TEXT;
			api.fill_rect(button.left, button.top, button.right, button.bottom, 0, background);
			api.blit_rect(button.left, button.top, button.right, button.bottom, 0,
				index === focused ? constants.COLOR_FOCUS_BORDER : constants.ACTION_DIALOG_BORDER_COLOR);
			drawEditorText(font, label, button.left + constants.HEADER_BUTTON_PADDING_X, button.top + constants.HEADER_BUTTON_PADDING_Y, 0, color);
		}
	}
}
