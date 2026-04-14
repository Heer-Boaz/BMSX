import type { CursorScreenInfo } from '../core/types';
import { getBreakpointLaneWidth, getCodeAreaBounds, maximumLineLength } from '../ui/editor_view';
import * as constants from '../core/constants';
import { ide_state } from '../core/ide_state';
import { getBreakpointsForChunk } from '../contrib/debugger/ide_debugger';
import { intellisenseUiState } from '../contrib/intellisense/intellisense_ui_state';
import { getActiveCodeTabContext } from '../ui/editor_tabs';
import { ensureVisualLines, getVisualLineCount } from '../core/text_utils';
import { drawCodeAreaBackground } from './render_code_area_gutter';
import { finalizeCodeAreaRender } from './render_code_area_tail';
import { drawCodeAreaRows } from './render_code_area_rows';

export function renderCodeArea(): void {
	ensureVisualLines();
	const bounds = getCodeAreaBounds();
	const gutterOffset = bounds.textLeft - bounds.codeLeft;
	const advance = ide_state.warnNonMonospace ? ide_state.spaceAdvance : ide_state.charAdvance;
	const wrapEnabled = ide_state.wordWrapEnabled;

	let horizontalVisible = !wrapEnabled && ide_state.codeHorizontalScrollbarVisible;
	let verticalVisible = ide_state.codeVerticalScrollbarVisible;
	let rowCapacity = 1;
	let columnCapacity = 1;
	const visualCount = getVisualLineCount();

	for (let i = 0; i < 3; i += 1) {
		const availableHeight = Math.max(0, (bounds.codeBottom - bounds.codeTop) - (horizontalVisible ? constants.SCROLLBAR_WIDTH : 0));
		rowCapacity = Math.max(1, Math.floor(availableHeight / ide_state.lineHeight));
		verticalVisible = visualCount > rowCapacity;
		const availableWidth = Math.max(
			0,
			(bounds.codeRight - bounds.codeLeft)
			- (verticalVisible ? constants.SCROLLBAR_WIDTH : 0)
			- gutterOffset
			- constants.CODE_AREA_RIGHT_MARGIN
		);
		columnCapacity = Math.max(1, Math.floor(availableWidth / advance));
		if (wrapEnabled) {
			horizontalVisible = false;
		} else {
			horizontalVisible = maximumLineLength() > columnCapacity;
		}
	}

	ide_state.codeVerticalScrollbarVisible = verticalVisible;
	ide_state.codeHorizontalScrollbarVisible = !wrapEnabled && horizontalVisible;
	ide_state.cachedVisibleRowCount = rowCapacity;
	ide_state.cachedVisibleColumnCount = columnCapacity;

	const contentRight = Math.max(
		bounds.textLeft,
		bounds.codeRight
		- (ide_state.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0)
		- constants.CODE_AREA_RIGHT_MARGIN
	);
	const contentBottom = bounds.codeBottom - (ide_state.codeHorizontalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0);
	const trackRight = bounds.codeRight - (ide_state.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0);

	drawCodeAreaBackground(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, bounds.gutterLeft, bounds.gutterRight, contentBottom);

	const activeGotoHighlight = intellisenseUiState.gotoHoverHighlight;
	const gotoVisualIndex = activeGotoHighlight
		? ide_state.layout.positionToVisualIndex(ide_state.buffer, activeGotoHighlight.row, activeGotoHighlight.startColumn)
		: null;
	const activePath = getActiveCodeTabContext().descriptor.path;
	const breakpointsForChunk = getBreakpointsForChunk(activePath);
	const cursorVisualIndex = ide_state.layout.positionToVisualIndex(ide_state.buffer, ide_state.cursorRow, ide_state.cursorColumn);
	const inlineCompletionPreview = ide_state.completion.getInlineCompletionPreview();
	const shouldRenderInlinePreview = inlineCompletionPreview !== null
		&& inlineCompletionPreview.row === ide_state.cursorRow
		&& inlineCompletionPreview.column === ide_state.cursorColumn;
	const useUppercase = ide_state.caseInsensitive;
	const renderFont = ide_state.font.renderFont();
	const breakpointLaneWidth = getBreakpointLaneWidth();
	const sliceWidth = columnCapacity + 2;
	const cursorInfo: CursorScreenInfo = drawCodeAreaRows(
		bounds.codeTop,
		contentBottom,
		bounds.gutterLeft,
		bounds.gutterRight,
		bounds.textLeft,
		contentRight,
		visualCount,
		rowCapacity,
		sliceWidth,
		breakpointsForChunk,
		activeGotoHighlight,
		gotoVisualIndex,
		cursorVisualIndex,
		inlineCompletionPreview,
		shouldRenderInlinePreview,
		useUppercase,
		renderFont,
		breakpointLaneWidth,
	);

	finalizeCodeAreaRender(bounds, contentBottom, trackRight, visualCount, rowCapacity, columnCapacity, wrapEnabled, cursorInfo);
}
