import * as constants from '../core/constants';
import type { TextField } from '../core/types';
import { ide_state } from '../core/ide_state';
import { measureInlineFieldDecoration } from '../ui/inline_field_view';
import { api } from '../ui/view/overlay_api';
import { drawEditorText } from './text_renderer';
import { drawInlineCaret } from './render_caret';
import { measureText } from '../core/text_utils';
import { textFromLines } from '../text/source_text';

export type InlineBarFieldRenderState = {
	fieldText: string;
	displayText: string;
	textX: number;
	displayWidth: number;
};

const scratchInlineBarFieldRenderState: InlineBarFieldRenderState = {
	fieldText: '',
	displayText: '',
	textX: 0,
	displayWidth: 0,
};

export function renderInlineBarFrame(
	left: number,
	top: number,
	right: number,
	bottom: number,
	backgroundColor: number,
	outlineColor: number,
): void {
	api.fill_rect(left, top, right, bottom, undefined, backgroundColor);
	api.fill_rect(left, top, right, top + 1, undefined, outlineColor);
	api.fill_rect(left, bottom - 1, right, bottom, undefined, outlineColor);
}

export function renderInlineBarField(
	field: TextField,
	label: string,
	labelX: number,
	labelY: number,
	caretActive: boolean,
	placeholderActive: boolean,
	textColor: number,
	placeholderText: string,
	placeholderColor: number,
	caretAdvance: number,
	out: InlineBarFieldRenderState = scratchInlineBarFieldRenderState,
): InlineBarFieldRenderState {
	drawEditorText(ide_state.font, label, labelX, labelY, undefined, textColor);

	const fieldText = textFromLines(field.lines);
	const displayText = fieldText.length === 0 && !placeholderActive
		? placeholderText
		: fieldText;
	const displayColor = fieldText.length === 0 && !placeholderActive
		? placeholderColor
		: textColor;
	const textX = labelX + measureText(label) + ide_state.spaceAdvance;
	const decoration = measureInlineFieldDecoration(field, ide_state.inlineFieldMetricsRef, textX);
	if (fieldText.length > 0 && decoration.hasSelection && decoration.selectionWidth > 0) {
		api.fill_rect_color(decoration.selectionLeft, labelY, decoration.selectionLeft + decoration.selectionWidth, labelY + ide_state.lineHeight, undefined, constants.SELECTION_OVERLAY);
	}

	drawEditorText(ide_state.font, displayText, textX, labelY, undefined, displayColor);

	const caretLeft = decoration.caretBaseX;
	const caretRight = Math.max(caretLeft + 1, decoration.caretBaseX + caretAdvance);
	drawInlineCaret(api, field, caretLeft, labelY, caretRight, labelY + ide_state.lineHeight, decoration.caretBaseX, caretActive, constants.INLINE_CARET_COLOR, displayColor);

	out.fieldText = fieldText;
	out.displayText = displayText;
	out.textX = textX;
	out.displayWidth = measureText(displayText);
	return out;
}
