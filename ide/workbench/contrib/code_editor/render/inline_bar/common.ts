import type { InlineBarFieldLayout } from '../../inline_bar/field';
import { drawSingleLineField } from '../../../../../editor/ui/inline/single_line_render';
import { api } from '../../../../../runtime/overlay_api';
import { editorViewState } from '../../../../../editor/ui/view/state';

export function renderInlineBarFrame(
	left: number,
	top: number,
	right: number,
	bottom: number,
	backgroundColor: number,
	outlineColor: number,
): void {
	api.fill_rect(left, top, right, bottom, 0, backgroundColor);
	api.fill_rect(left, top, right, top + 1, 0, outlineColor);
	api.fill_rect(left, bottom - 1, right, bottom, 0, outlineColor);
}

export function renderInlineBarField(layout: InlineBarFieldLayout, textColor: number, placeholder: string, placeholderColor: number): void {
	if (!layout.visible) return;
	const { field, bounds } = layout;
	const y = bounds.top + 2, font = editorViewState.font.renderFont();
	if (layout.label.length > 0) api.blit_text_inline_with_font(layout.label, layout.labelX, y, 0, textColor, font);
	if (layout.detail.length > 0) api.blit_text_inline_with_font(layout.detail, layout.detailX, y, 0, textColor, font);
	api.pushClipRect(bounds.left + 3, bounds.top, bounds.right - 3, bounds.bottom);
	if (layout.label.length === 0 && field.text.length === 0) {
		api.blit_text_inline_with_font(placeholder, bounds.left + 3, y, 0, placeholderColor, font);
	}
	drawSingleLineField(field, layout.viewport, textColor);
	api.popClipRect();
}
