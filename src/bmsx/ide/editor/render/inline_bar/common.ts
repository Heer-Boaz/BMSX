import * as constants from '../../../common/constants';
import type { TextField } from '../../../common/models';
import { measureInlineFieldDecoration } from '../../ui/inline/field_view';
import { api } from '../../../runtime/overlay_api';
import { drawEditorText } from '../text_renderer';
import { drawInlineCaret } from '../caret';
import { measureText } from '../../common/text/layout';
import { editorViewState } from '../../ui/view/state';

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
	drawEditorText(editorViewState.font, label, labelX, labelY, undefined, textColor);

	const fieldText = field.text;
	const displayText = fieldText.length === 0 && !placeholderActive
		? placeholderText
		: fieldText;
	const displayColor = fieldText.length === 0 && !placeholderActive
		? placeholderColor
		: textColor;
	const textX = labelX + measureText(label) + editorViewState.spaceAdvance;
	const decoration = measureInlineFieldDecoration(field, editorViewState.inlineFieldMetricsRef, textX);
	if (fieldText.length > 0 && decoration.hasSelection && decoration.selectionWidth > 0) {
		api.fill_rect(decoration.selectionLeft, labelY, decoration.selectionLeft + decoration.selectionWidth, labelY + editorViewState.lineHeight, undefined, constants.SELECTION_OVERLAY);
	}

	drawEditorText(editorViewState.font, displayText, textX, labelY, undefined, displayColor);

	const caretLeft = decoration.caretBaseX;
	const caretRight = Math.max(caretLeft + 1, decoration.caretBaseX + caretAdvance);
	drawInlineCaret(api, field, caretLeft, labelY, caretRight, labelY + editorViewState.lineHeight, decoration.caretBaseX, caretActive, constants.INLINE_CARET_COLOR);

	out.fieldText = fieldText;
	out.displayText = displayText;
	out.textX = textX;
	out.displayWidth = measureText(displayText);
	return out;
}
