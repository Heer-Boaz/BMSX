import type { CursorScreenInfo } from '../core/types';
import { drawHoverTooltip } from '../ui/hover_tooltip';
import { computeMaximumScrollColumn } from '../ui/editor_view';
import { renderRuntimeErrorOverlay, type RuntimeErrorOverlayRenderResult } from './render_error_overlay';
import { renderEditorContextMenu, type CodeAreaViewportBounds } from './render_context_menu';
import * as constants from '../core/constants';
import { ide_state } from '../core/ide_state';
import { api } from '../ui/view/overlay_api';
import { drawCompletionPopup, drawParameterHintOverlay, type CompletionRenderBounds } from './render_completion';
import { drawCursor } from './render_caret';
import type { RectBounds } from '../../rompack/rompack';
import { editorCaretState } from '../ui/caret_state';
import { editorViewState } from '../ui/editor_view_state';

const verticalTrackScratch: RectBounds = {
	left: 0,
	top: 0,
	right: 0,
	bottom: 0,
};

const horizontalTrackScratch: RectBounds = {
	left: 0,
	top: 0,
	right: 0,
	bottom: 0,
};

function drawRuntimeErrorOverlayIndicator(
	direction: 'above' | 'below',
	codeTop: number,
	codeRight: number,
	textLeft: number,
	contentBottom: number,
): void {
	const indicatorWidth = 16;
	const indicatorHeight = 5;
	const margin = 4;
	const scrollbarOffset = editorViewState.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0;
	const rightEdge = codeRight - scrollbarOffset - constants.CODE_AREA_RIGHT_MARGIN;
	const left = Math.max(textLeft, rightEdge - indicatorWidth);
	const top = direction === 'above'
		? codeTop + margin
		: contentBottom - indicatorHeight - margin;
	const bottom = top + indicatorHeight;
	const accentHeight = 2;
	const accentTop = direction === 'above' ? top : bottom - accentHeight;
	api.fill_rect_color(left, top, left + indicatorWidth, bottom, undefined, constants.ERROR_OVERLAY_BACKGROUND);
	api.fill_rect_color(left, accentTop, left + indicatorWidth, accentTop + accentHeight, undefined, constants.ERROR_OVERLAY_LINE_HOVER);
	const notchWidth = 6;
	const notchLeft = left + Math.max(2, (indicatorWidth - notchWidth) / 2);
	const notchTop = direction === 'above' ? top - 1 : bottom;
	api.fill_rect_color(notchLeft, notchTop, notchLeft + notchWidth, notchTop + 1, undefined, constants.ERROR_OVERLAY_TEXT_COLOR);
	api.blit_rect(left, top, left + indicatorWidth, bottom, undefined, constants.ERROR_OVERLAY_TEXT_COLOR);
}

export function finalizeCodeAreaRender(
	bounds: CompletionRenderBounds & CodeAreaViewportBounds,
	contentBottom: number,
	trackRight: number,
	visualCount: number,
	rowCapacity: number,
	columnCapacity: number,
	wrapEnabled: boolean,
	cursorInfo: CursorScreenInfo,
): void {
	const verticalTrackLeft = bounds.codeRight - constants.SCROLLBAR_WIDTH;
	verticalTrackScratch.left = verticalTrackLeft;
	verticalTrackScratch.top = bounds.codeTop;
	verticalTrackScratch.right = verticalTrackLeft + constants.SCROLLBAR_WIDTH;
	verticalTrackScratch.bottom = contentBottom;

	editorViewState.scrollbars.codeVertical.layout(verticalTrackScratch, visualCount, rowCapacity, editorViewState.scrollRow);
	editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.scrollbars.codeVertical.getScroll(), visualCount, rowCapacity);
	editorViewState.codeVerticalScrollbarVisible = editorViewState.scrollbars.codeVertical.isVisible();

	if (!wrapEnabled) {
		horizontalTrackScratch.left = bounds.codeLeft;
		horizontalTrackScratch.top = contentBottom;
		horizontalTrackScratch.right = trackRight;
		horizontalTrackScratch.bottom = contentBottom + constants.SCROLLBAR_WIDTH;
		const maxColumns = columnCapacity + computeMaximumScrollColumn();
		editorViewState.scrollbars.codeHorizontal.layout(horizontalTrackScratch, maxColumns, columnCapacity, editorViewState.scrollColumn);
		editorViewState.scrollColumn = editorViewState.layout.clampHorizontalScroll(editorViewState.scrollbars.codeHorizontal.getScroll(), computeMaximumScrollColumn());
		editorViewState.codeHorizontalScrollbarVisible = editorViewState.scrollbars.codeHorizontal.isVisible();
	} else {
		editorViewState.scrollColumn = 0;
		editorViewState.codeHorizontalScrollbarVisible = false;
	}

	const runtimeOverlayState: RuntimeErrorOverlayRenderResult = renderRuntimeErrorOverlay(bounds.codeTop, bounds.codeRight, bounds.textLeft);
	if (runtimeOverlayState === 'above' || runtimeOverlayState === 'below') {
		drawRuntimeErrorOverlayIndicator(runtimeOverlayState, bounds.codeTop, bounds.codeRight, bounds.textLeft, contentBottom);
	}
	drawHoverTooltip(bounds.codeTop, contentBottom, bounds.textLeft);

	if (editorCaretState.cursorVisible && cursorInfo) {
		drawCursor(cursorInfo, bounds.textLeft);
	}
	ide_state.completion.popupBounds = drawCompletionPopup(ide_state.completion.session, cursorInfo, editorViewState.lineHeight, bounds);
	drawParameterHintOverlay(ide_state.completion.hint, cursorInfo, editorViewState.lineHeight, bounds);
	if (editorViewState.codeVerticalScrollbarVisible) {
		editorViewState.scrollbars.codeVertical.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	if (editorViewState.codeHorizontalScrollbarVisible) {
		editorViewState.scrollbars.codeHorizontal.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	renderEditorContextMenu(bounds);
}
