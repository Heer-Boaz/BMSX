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
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';

export type ActionPromptChoice = 'primary' | 'secondary' | 'cancel';
export type ActionPromptRequest = {
	readonly title: string;
	readonly message: string;
	readonly primary: string;
	readonly secondary: string;
	readonly primaryEnabled: boolean;
	readonly defaultChoice: ActionPromptChoice;
};

const PADDING = 12, MARGIN = 4, BODY_GAP = 6;

/** Retained message and response geometry; save batches and command execution are not dialog state. */
export class ActionPromptView {
	public readonly bounds = create_rect_bounds();
	public readonly body = new WorkbenchScrollViewport();
	public readonly footer = new WorkbenchScrollViewport();
	public readonly buttons = (['primary', 'secondary', 'cancel'] as const).map(choice => ({
		choice, label: '', enabled: true, lines: [] as string[], bounds: create_rect_bounds(), contentBounds: create_rect_bounds(),
	}));
	public revision = 0;
	private readonly titleLines: string[] = [];
	private readonly messageLines: string[] = [];
	private request: ActionPromptRequest | undefined;
	private font: BFont | undefined;
	private width = -1;
	private height = -1;
	private lineHeight = -1;
	private left = 0;
	private top = 0;
	private contentWidth = 0;
	private paddingX = PADDING;
	private textHeight = 0;
	private buttonsHeight = 0;
	private minimumButtonHeight = 0;

	public constructor(private readonly area: Readonly<RectBounds>) {
		this.footer.scrollbar.onDidScroll(() => this.projectButtons());
	}

	public update(request: ActionPromptRequest): void {
		const { font, lineHeight } = editorViewState;
		const viewportWidth = this.area.right - this.area.left, viewportHeight = this.area.bottom - this.area.top;
		const renderFont = font.renderFont();
		const contentChanged = request !== this.request || viewportWidth !== this.width || renderFont !== this.font || lineHeight !== this.lineHeight;
		if (!contentChanged && viewportHeight === this.height && this.area.left === this.left && this.area.top === this.top) return;
		this.revision++;
		if (contentChanged) {
			const previousRequest = this.request;
			this.request = request; this.width = viewportWidth; this.font = renderFont; this.lineHeight = lineHeight;
			this.measure(request);
			if (request !== previousRequest) { this.body.scrollbar.setScroll(0); this.footer.scrollbar.setScroll(0); }
		}
		this.height = viewportHeight; this.left = this.area.left; this.top = this.area.top;
		const maximumHeight = Math.max(0, viewportHeight - MARGIN * 2), lineStep = lineHeight + 2;
		const minimumBody = Math.min(this.textHeight, lineStep);
		// Decorations yield before either the message or a complete response row. The footer itself
		// scrolls only when vertically stacked responses cannot all fit beside one message line.
		const border = Math.min(1, maximumHeight / 2);
		const decoration = Math.max(0, maximumHeight - border * 2 - this.textHeight - this.buttonsHeight);
		const gap = Math.min(BODY_GAP, decoration);
		const padding = border + Math.min(PADDING - border, (decoration - gap) / 2);
		const contentHeight = Math.max(0, maximumHeight - padding * 2 - gap);
		const footerHeight = Math.min(this.buttonsHeight, Math.max(Math.min(this.minimumButtonHeight, contentHeight), contentHeight - minimumBody));
		const bodyHeight = Math.min(this.textHeight, Math.max(0, contentHeight - footerHeight));
		const height = padding * 2 + bodyHeight + gap + footerHeight;
		writeCenteredDialogBounds(this.bounds, this.area, this.contentWidth + this.paddingX * 2, height, MARGIN);
		const left = this.bounds.left + this.paddingX, right = this.bounds.right - this.paddingX, top = this.bounds.top + padding;
		this.body.layout(left, top, right, top + bodyHeight, this.textHeight);
		this.footer.layout(left, top + bodyHeight + gap, right, top + bodyHeight + gap + footerHeight, this.buttonsHeight);
		this.projectButtons();
	}

	private measure(request: ActionPromptRequest): void {
		const { lineHeight } = editorViewState;
		this.buttons[0].label = request.primary; this.buttons[0].enabled = request.primaryEnabled;
		this.buttons[1].label = request.secondary; this.buttons[2].label = 'CANCEL';
		const spacing = constants.HEADER_BUTTON_SPACING;
		const maximumWidth = Math.max(0, this.width - MARGIN * 2);
		this.paddingX = Math.min(PADDING, Math.max(0, (maximumWidth - constants.SCROLLBAR_WIDTH) / 2));
		const availableWidth = Math.max(0, maximumWidth - this.paddingX * 2 - constants.SCROLLBAR_WIDTH);
		let rowWidth = spacing * (this.buttons.length - 1), widestButton = 0;
		for (const button of this.buttons) {
			const width = measureText(button.label) + constants.HEADER_BUTTON_PADDING_X * 2;
			rowWidth += width; widestButton = Math.max(widestButton, width);
			write_rect_bounds(button.contentBounds, 0, 0, width, 0);
		}
		const stacked = rowWidth > availableWidth;
		const textWidth = Math.min(availableWidth, Math.max(measureText(request.title), measureText(request.message), stacked ? widestButton : rowWidth));
		this.contentWidth = Math.min(maximumWidth, textWidth + constants.SCROLLBAR_WIDTH);
		this.buttonsHeight = 0; this.minimumButtonHeight = 0;
		for (const button of this.buttons) {
			const width = stacked ? textWidth : button.contentBounds.right;
			const labelWidth = Math.max(0, width - constants.HEADER_BUTTON_PADDING_X * 2);
			writeWrappedMeasuredText(button.lines, button.label, labelWidth, labelWidth, button.label.length + 1, measureTextRange);
			const height = lineHeight * button.lines.length + constants.HEADER_BUTTON_PADDING_Y * 2;
			write_rect_bounds(button.contentBounds, 0, 0, width, height);
			this.buttonsHeight = stacked ? this.buttonsHeight + height : Math.max(this.buttonsHeight, height);
			this.minimumButtonHeight = Math.max(this.minimumButtonHeight, height);
		}
		if (stacked) this.buttonsHeight += spacing * (this.buttons.length - 1);
		let x = 0, y = 0;
		for (const button of this.buttons) {
			const width = button.contentBounds.right, height = stacked ? button.contentBounds.bottom : this.buttonsHeight;
			write_rect_bounds(button.contentBounds, x, y, x + width, y + height);
			if (stacked) y += height + spacing; else x += width + spacing;
		}
		writeWrappedMeasuredText(this.titleLines, request.title, textWidth, textWidth, request.title.length + 1, measureTextRange);
		writeWrappedMeasuredText(this.messageLines, request.message, textWidth, textWidth, request.message.length + 1, measureTextRange);
		this.textHeight = (lineHeight + 2) * (this.titleLines.length + this.messageLines.length);
	}

	private projectButtons(): void {
		for (const button of this.buttons) this.footer.project(button.contentBounds, button.bounds);
	}

	public revealButton(index: number): void {
		const bounds = this.buttons[index].contentBounds;
		this.footer.scrollbar.reveal(bounds.top, bounds.bottom);
	}

	public draw(focused: number, pressed: number, hovered: number): void {
		const { font, lineHeight } = editorViewState, bounds = this.bounds;
		api.fill_rect(this.area.left, this.area.top, this.area.right, this.area.bottom, 0, constants.ACTION_OVERLAY_COLOR);
		drawWorkbenchSurfaceShadow(bounds);
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.ACTION_DIALOG_BACKGROUND_COLOR);
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.ACTION_DIALOG_BORDER_COLOR);
		const body = this.body, lineStep = lineHeight + 2, count = this.titleLines.length + this.messageLines.length;
		api.pushClipRect(body.bounds.left, body.bounds.top, body.bounds.right, body.bounds.bottom);
		for (let index = Math.max(0, Math.trunc(body.scrollTop / lineStep)); index < count; index++) {
			const y = body.offsetTop + index * lineStep;
			if (y >= body.bounds.bottom) break;
			const line = index < this.titleLines.length ? this.titleLines[index] : this.messageLines[index - this.titleLines.length];
			drawEditorText(font, line, body.bounds.left, y, 0, constants.ACTION_DIALOG_TEXT_COLOR);
		}
		api.popClipRect();
		body.scrollbar.draw(constants.ACTION_DIALOG_BACKGROUND_COLOR, constants.COLOR_DESCRIPTION_TEXT);
		const footer = this.footer;
		api.pushClipRect(footer.bounds.left, footer.bounds.top, footer.bounds.right, footer.bounds.bottom);
		for (let index = 0; index < this.buttons.length; index++) {
			const { lines, enabled, bounds: button } = this.buttons[index];
			if (button.bottom <= footer.bounds.top || button.top >= footer.bounds.bottom) continue;
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
		api.popClipRect();
		footer.scrollbar.draw(constants.ACTION_DIALOG_BACKGROUND_COLOR, constants.COLOR_DESCRIPTION_TEXT);
	}
}
