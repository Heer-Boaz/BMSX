import type { CursorScreenInfo } from '../../common/types';
import { getBreakpointLaneWidth, getCodeAreaBounds, maximumLineLength } from '../ui/editor_view';
import * as constants from '../../common/constants';
import { editorFeedbackState } from '../../workbench/common/feedback_state';
import { getBreakpointsForChunk } from '../../workbench/contrib/debugger/ide_debugger';
import { intellisenseUiState } from '../contrib/intellisense/intellisense_ui_state';
import { getActiveCodeTabContext } from '../../workbench/ui/tabs';
import { ensureVisualLines, getVisualLineCount } from '../common/text_layout';
import { drawCodeAreaBackground } from './render_code_area_gutter';
import { finalizeCodeAreaRender } from './render_code_area_tail';
import { drawCodeAreaRows } from './render_code_area_rows';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorViewState } from '../ui/editor_view_state';
import { editorFeatureState } from '../common/editor_feature_state';
import { editorRuntimeState } from '../common/editor_runtime_state';

export function renderCodeArea(): void {
	ensureVisualLines();
	const bounds = getCodeAreaBounds();
	const gutterOffset = bounds.textLeft - bounds.codeLeft;
	const advance = editorFeedbackState.warnNonMonospace ? editorViewState.spaceAdvance : editorViewState.charAdvance;
	const wrapEnabled = editorViewState.wordWrapEnabled;

	let horizontalVisible = !wrapEnabled && editorViewState.codeHorizontalScrollbarVisible;
	let verticalVisible = editorViewState.codeVerticalScrollbarVisible;
	let rowCapacity = 1;
	let columnCapacity = 1;
	const visualCount = getVisualLineCount();

	for (let i = 0; i < 3; i += 1) {
		const availableHeight = Math.max(0, (bounds.codeBottom - bounds.codeTop) - (horizontalVisible ? constants.SCROLLBAR_WIDTH : 0));
		rowCapacity = Math.max(1, Math.floor(availableHeight / editorViewState.lineHeight));
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

	editorViewState.codeVerticalScrollbarVisible = verticalVisible;
	editorViewState.codeHorizontalScrollbarVisible = !wrapEnabled && horizontalVisible;
	editorViewState.cachedVisibleRowCount = rowCapacity;
	editorViewState.cachedVisibleColumnCount = columnCapacity;

	const contentRight = Math.max(
		bounds.textLeft,
		bounds.codeRight
		- (editorViewState.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0)
		- constants.CODE_AREA_RIGHT_MARGIN
	);
	const contentBottom = bounds.codeBottom - (editorViewState.codeHorizontalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0);
	const trackRight = bounds.codeRight - (editorViewState.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0);

	drawCodeAreaBackground(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, bounds.gutterLeft, bounds.gutterRight, contentBottom);

	const activeGotoHighlight = intellisenseUiState.gotoHoverHighlight;
	const gotoVisualIndex = activeGotoHighlight
		? editorViewState.layout.positionToVisualIndex(editorDocumentState.buffer, activeGotoHighlight.row, activeGotoHighlight.startColumn)
		: null;
	const activePath = getActiveCodeTabContext().descriptor.path;
	const breakpointsForChunk = getBreakpointsForChunk(activePath);
	const cursorVisualIndex = editorViewState.layout.positionToVisualIndex(editorDocumentState.buffer, editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	const inlineCompletionPreview = editorFeatureState.completion.getInlineCompletionPreview();
	const shouldRenderInlinePreview = inlineCompletionPreview !== null
		&& inlineCompletionPreview.row === editorDocumentState.cursorRow
		&& inlineCompletionPreview.column === editorDocumentState.cursorColumn;
	const useUppercase = editorRuntimeState.caseInsensitive;
	const renderFont = editorViewState.font.renderFont();
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
