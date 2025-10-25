import { BmsxConsoleApi } from '../api';
import * as constants from './constants';

export interface InlineBarsHost {
	viewportWidth: number;
	headerHeight: number;
	tabBarHeight: number;
	lineHeight: number;
	spaceAdvance: number;
	measureText: (text: string) => number;
	drawText: (api: BmsxConsoleApi, text: string, x: number, y: number, color: number) => void;
	inlineFieldMetrics: () => { spaceAdvance: number };
	createResourceActive: boolean;
	createResourceVisible: boolean;
	createResourceField: unknown;
	createResourceWorking: boolean;
	createResourceError: string | null;
	drawCreateResourceErrorDialog: (api: BmsxConsoleApi, errorText: string) => void;
	getCreateResourceBarHeight: () => number;
	drawInlineCaret: (
		api: BmsxConsoleApi,
		field: unknown,
		left: number,
		top: number,
		right: number,
		bottom: number,
		baseX: number,
		active: boolean,
		caretColor: { r: number; g: number; b: number; a: number },
		textColor: number,
	) => void;
	inlineFieldSelectionRange: (field: unknown) => { start: number; end: number } | null;
	inlineFieldMeasureRange: (field: unknown, metrics: { spaceAdvance: number }, start: number, end: number) => number;
	inlineFieldCaretX: (field: unknown, originX: number, measureText: (text: string) => number) => number;
}

export function renderCreateResourceBar(api: BmsxConsoleApi, host: InlineBarsHost): void {
	const height = host.getCreateResourceBarHeight();
	if (height <= 0) return;
	const barTop = host.headerHeight + host.tabBarHeight;
	const barBottom = barTop + height;
	api.rectfill(0, barTop, host.viewportWidth, barBottom, constants.COLOR_CREATE_RESOURCE_BACKGROUND);
	api.rectfill(0, barTop, host.viewportWidth, barTop + 1, constants.COLOR_CREATE_RESOURCE_OUTLINE);
	api.rectfill(0, barBottom - 1, host.viewportWidth, barBottom, constants.COLOR_CREATE_RESOURCE_OUTLINE);

	const label = 'NEW FILE:';
	const labelX = 4;
	const labelY = barTop + constants.CREATE_RESOURCE_BAR_MARGIN_Y;
	host.drawText(api, label, labelX, labelY, constants.COLOR_CREATE_RESOURCE_TEXT);

	const field = host.createResourceField as { text: string };
	const pathX = labelX + host.measureText(label + ' ');
	let displayPath = field.text;
	let pathColor = constants.COLOR_CREATE_RESOURCE_TEXT;
	if (displayPath.length === 0 && !host.createResourceActive) {
		displayPath = 'ENTER LUA PATH';
		pathColor = constants.COLOR_CREATE_RESOURCE_PLACEHOLDER;
	}

	const selection = host.inlineFieldSelectionRange(field);
	if (selection && field.text.length > 0) {
		const selectionLeft = pathX + host.inlineFieldMeasureRange(field, host.inlineFieldMetrics(), 0, selection.start);
		const selectionWidth = host.inlineFieldMeasureRange(field, host.inlineFieldMetrics(), selection.start, selection.end);
		if (selectionWidth > 0) {
			api.rectfillColor(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + host.lineHeight, constants.SELECTION_OVERLAY);
		}
	}

	host.drawText(api, displayPath, pathX, labelY, pathColor);

	const caretBaseX = host.inlineFieldCaretX(field, pathX, host.measureText);
	const caretLeft = Math.floor(caretBaseX);
	const caretRight = Math.max(caretLeft + 1, Math.floor(caretBaseX + host.spaceAdvance));
	const caretTop = Math.floor(labelY);
	const caretBottom = caretTop + host.lineHeight;
	host.drawInlineCaret(api, field, caretLeft, caretTop, caretRight, caretBottom, caretBaseX, host.createResourceActive, constants.INLINE_CARET_COLOR, pathColor);

	// Status or error overlay on the right
	if (host.createResourceWorking) {
		const status = 'CREATING...';
		const statusWidth = host.measureText(status);
		const statusX = Math.max(pathX + host.measureText(displayPath) + host.spaceAdvance, host.viewportWidth - statusWidth - 4);
		host.drawText(api, status, statusX, labelY, constants.COLOR_CREATE_RESOURCE_TEXT);
	} else if (host.createResourceError && host.createResourceError.length > 0) {
		host.drawCreateResourceErrorDialog(api, host.createResourceError);
	}
}
