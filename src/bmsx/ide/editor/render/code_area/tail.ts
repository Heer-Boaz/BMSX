import type { CursorScreenInfo } from '../../../common/models';
import { drawHoverTooltip } from '../../ui/hover_tooltip';
import { renderRuntimeErrorOverlay, type RuntimeErrorOverlayRenderResult } from '../error_overlay';
import { renderEditorContextMenu } from '../../../workbench/render/context_menu';
import type { CodeAreaViewportBounds } from '../../../workbench/contrib/context_menu/widget';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { drawCompletionPopup, drawParameterHintOverlay, type CompletionRenderBounds } from '../completion';
import { drawCursor } from '../caret';
import type { RectBounds } from '../../../../rompack/format';
import { editorCaretState } from '../../ui/view/caret/state';
import { editorViewState } from '../../ui/view/state';
import { completionController } from '../../contrib/suggest/completion_controller';
import type { CodeAreaViewport } from '../../ui/code/area_viewport';

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
	viewport: CodeAreaViewport & CompletionRenderBounds & CodeAreaViewportBounds,
	cursorInfo: CursorScreenInfo,
): void {
	const verticalTrackLeft = viewport.codeRight - constants.SCROLLBAR_WIDTH;
	verticalTrackScratch.left = verticalTrackLeft;
	verticalTrackScratch.top = viewport.codeTop;
	verticalTrackScratch.right = verticalTrackLeft + constants.SCROLLBAR_WIDTH;
	verticalTrackScratch.bottom = viewport.contentBottom;

	editorViewState.scrollbars.codeVertical.layout(verticalTrackScratch, viewport.visualCount, viewport.rows, editorViewState.scrollRow);
	editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.scrollbars.codeVertical.getScroll(), viewport.visualCount, viewport.rows);
	editorViewState.codeVerticalScrollbarVisible = editorViewState.scrollbars.codeVertical.isVisible();

	if (!viewport.wrapEnabled) {
		horizontalTrackScratch.left = viewport.codeLeft;
		horizontalTrackScratch.top = viewport.contentBottom;
		horizontalTrackScratch.right = viewport.trackRight;
		horizontalTrackScratch.bottom = viewport.contentBottom + constants.SCROLLBAR_WIDTH;
		const maxColumns = viewport.columns + viewport.maxScrollColumn;
		editorViewState.scrollbars.codeHorizontal.layout(horizontalTrackScratch, maxColumns, viewport.columns, editorViewState.scrollColumn);
		editorViewState.scrollColumn = editorViewState.layout.clampHorizontalScroll(editorViewState.scrollbars.codeHorizontal.getScroll(), viewport.maxScrollColumn);
		editorViewState.codeHorizontalScrollbarVisible = editorViewState.scrollbars.codeHorizontal.isVisible();
	} else {
		editorViewState.scrollColumn = 0;
		editorViewState.codeHorizontalScrollbarVisible = false;
	}

	const runtimeOverlayState: RuntimeErrorOverlayRenderResult = renderRuntimeErrorOverlay(viewport.codeTop, viewport.codeRight, viewport.textLeft);
	if (runtimeOverlayState === 'above' || runtimeOverlayState === 'below') {
		drawRuntimeErrorOverlayIndicator(runtimeOverlayState, viewport.codeTop, viewport.codeRight, viewport.textLeft, viewport.contentBottom);
	}
	drawHoverTooltip(viewport.codeTop, viewport.contentBottom, viewport.textLeft);

	if (editorCaretState.cursorVisible && cursorInfo) {
		drawCursor(cursorInfo, viewport.textLeft);
	}
	completionController.popupBounds = drawCompletionPopup(completionController.session, cursorInfo, editorViewState.lineHeight, viewport, completionController.popupBoundsScratch);
	drawParameterHintOverlay(completionController.hint, cursorInfo, editorViewState.lineHeight, viewport);
	if (editorViewState.codeVerticalScrollbarVisible) {
		editorViewState.scrollbars.codeVertical.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	if (editorViewState.codeHorizontalScrollbarVisible) {
		editorViewState.scrollbars.codeHorizontal.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	renderEditorContextMenu(viewport);
}
