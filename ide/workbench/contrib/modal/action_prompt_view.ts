import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import * as constants from '../../../common/constants';
import { writeWrappedMeasuredText } from '../../../common/text';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { writeCenteredDialogBounds } from '../../../editor/render/dialog_layout';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import { drawWorkbenchSurfaceShadow } from '../../render/surface';

export type ActionPromptChoice = 'primary' | 'secondary' | 'cancel';
export type ActionPromptRequest = {
	readonly title: string;
	readonly message: string;
	readonly primary: string;
	readonly secondary: string;
	readonly primaryEnabled: boolean;
	readonly defaultChoice: ActionPromptChoice;
};

const PADDING = 12;

/** Retained geometry; neither the save batch nor command execution belongs to the dialog. */
export class ActionPromptView {
	public readonly bounds = create_rect_bounds();
	public readonly buttons = (['primary', 'secondary', 'cancel'] as const).map(choice => ({
		choice, label: '', enabled: true, lines: [] as string[], bounds: create_rect_bounds(),
	}));
	private readonly titleLines: string[] = [];
	private readonly messageLines: string[] = [];
	private request: ActionPromptRequest | undefined;
	private font: BFont | undefined;
	private width = -1;
	private height = -1;
	private lineHeight = -1;
	private left = 0;
	private top = 0;
	public constructor(private readonly area: Readonly<RectBounds>) {}

	public update(request: ActionPromptRequest): void {
		const { font, lineHeight } = editorViewState;
		const viewportWidth = this.area.right - this.area.left, viewportHeight = this.area.bottom - this.area.top;
		const renderFont = font.renderFont();
		if (request === this.request && viewportWidth === this.width && viewportHeight === this.height
			&& renderFont === this.font && lineHeight === this.lineHeight) {
			const dx = this.area.left - this.left, dy = this.area.top - this.top;
			if (dx !== 0 || dy !== 0) {
				const bounds = this.bounds;
				write_rect_bounds(bounds, bounds.left + dx, bounds.top + dy, bounds.right + dx, bounds.bottom + dy);
				for (const button of this.buttons) {
					const bounds = button.bounds;
					write_rect_bounds(bounds, bounds.left + dx, bounds.top + dy, bounds.right + dx, bounds.bottom + dy);
				}
				this.left = this.area.left; this.top = this.area.top;
			}
			return;
		}
		this.request = request; this.width = viewportWidth; this.height = viewportHeight; this.font = renderFont; this.lineHeight = lineHeight;
		this.left = this.area.left; this.top = this.area.top;
		this.buttons[0].label = request.primary; this.buttons[0].enabled = request.primaryEnabled;
		this.buttons[1].label = request.secondary; this.buttons[2].label = 'CANCEL';
		const spacing = constants.HEADER_BUTTON_SPACING;
		const availableWidth = Math.max(0, viewportWidth - 8 - PADDING * 2);
		let rowWidth = spacing * (this.buttons.length - 1), widestButton = 0;
		for (const button of this.buttons) {
			const width = measureText(button.label) + constants.HEADER_BUTTON_PADDING_X * 2;
			rowWidth += width;
			widestButton = Math.max(widestButton, width);
			write_rect_bounds(button.bounds, 0, 0, width, 0);
		}
		const stacked = rowWidth > availableWidth;
		const contentWidth = Math.min(availableWidth,
			Math.max(measureText(request.title), measureText(request.message), stacked ? widestButton : rowWidth));
		let buttonsHeight = 0;
		for (const button of this.buttons) {
			const width = stacked ? contentWidth : button.bounds.right;
			const textWidth = Math.max(0, width - constants.HEADER_BUTTON_PADDING_X * 2);
			writeWrappedMeasuredText(button.lines, button.label, textWidth, textWidth, button.label.length + 1, measureTextRange);
			const height = lineHeight * button.lines.length + constants.HEADER_BUTTON_PADDING_Y * 2;
			write_rect_bounds(button.bounds, 0, 0, width, height);
			buttonsHeight = stacked ? buttonsHeight + height : Math.max(buttonsHeight, height);
		}
		if (stacked) buttonsHeight += spacing * (this.buttons.length - 1);
		// Reserve the decision controls before fitting the title and detail into the viewport.
		const textRows = Math.max(2, ((viewportHeight - 8 - PADDING * 2 - 6 - buttonsHeight) / (lineHeight + 2)) | 0);
		writeWrappedMeasuredText(this.titleLines, request.title, contentWidth, contentWidth, textRows - 1, measureTextRange);
		writeWrappedMeasuredText(this.messageLines, request.message, contentWidth, contentWidth,
			textRows - this.titleLines.length, measureTextRange);
		const textHeight = (lineHeight + 2) * (this.titleLines.length + this.messageLines.length);
		const height = PADDING * 2 + textHeight + 6 + buttonsHeight;
		writeCenteredDialogBounds(this.bounds, this.area, contentWidth + PADDING * 2, height, 4);
		let x = this.bounds.left + PADDING, y = this.bounds.top + PADDING + textHeight + 6;
		for (const button of this.buttons) {
			const width = button.bounds.right, buttonHeight = stacked ? button.bounds.bottom : buttonsHeight;
			write_rect_bounds(button.bounds, x, y, x + width, y + buttonHeight);
			if (stacked) y += buttonHeight + spacing; else x += width + spacing;
		}
	}

	public draw(focused: number, pressed: number, hovered: number): void {
		const { font, lineHeight } = editorViewState;
		const bounds = this.bounds;
		api.fill_rect(this.area.left, this.area.top, this.area.right, this.area.bottom, 0, constants.ACTION_OVERLAY_COLOR);
		drawWorkbenchSurfaceShadow(bounds);
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.ACTION_DIALOG_BACKGROUND_COLOR);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.ACTION_DIALOG_BORDER_COLOR);
		let y = bounds.top + PADDING;
		for (const line of this.titleLines) {
			drawEditorText(font, line, bounds.left + PADDING, y, 0, constants.ACTION_DIALOG_TEXT_COLOR);
			y += lineHeight + 2;
		}
		for (const line of this.messageLines) {
			drawEditorText(font, line, bounds.left + PADDING, y, 0, constants.ACTION_DIALOG_TEXT_COLOR);
			y += lineHeight + 2;
		}
		for (let index = 0; index < this.buttons.length; index++) {
			const { lines, enabled, bounds: button } = this.buttons[index];
			const background = !enabled ? constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND : index === pressed ? constants.COLOR_HEADER_BUTTON_PRESSED_BACKGROUND
				: index === hovered ? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND : constants.ACTION_BUTTON_BACKGROUND;
			const color = !enabled ? constants.COLOR_HEADER_BUTTON_TEXT_DISABLED : index === pressed ? constants.COLOR_HEADER_BUTTON_PRESSED_TEXT
				: index === hovered ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.ACTION_BUTTON_TEXT;
			api.fill_rect(button.left, button.top, button.right, button.bottom, 0, background);
			api.blit_rect(button.left, button.top, button.right, button.bottom, 0,
				index === focused ? constants.COLOR_FOCUS_BORDER : constants.ACTION_DIALOG_BORDER_COLOR);
			let y = button.top + constants.HEADER_BUTTON_PADDING_Y;
			for (const line of lines) {
				drawEditorText(font, line, button.left + constants.HEADER_BUTTON_PADDING_X, y, 0, color);
				y += lineHeight;
			}
		}
	}
}
