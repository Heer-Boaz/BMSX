import type { CodeEditorControl } from '../../ui/code_editor_control';
import type { CursorScreenInfo } from '../../../common/models';
import { drawHoverTooltip } from '../../ui/hover_tooltip';
import { renderRuntimeErrorOverlay, type RuntimeErrorOverlayRenderResult } from '../error_overlay';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { drawCompletionPopup, drawParameterHintOverlay, type CompletionPresentation, type CompletionRenderBounds } from '../completion';
import type { CodeAreaViewport } from '../../ui/code/area_viewport';

function drawRuntimeErrorOverlayIndicator(code: CodeEditorControl,
	direction: 'above' | 'below',
	codeTop: number,
	codeRight: number,
	textLeft: number,
	contentBottom: number,
): void {
	const indicatorWidth = 16;
	const indicatorHeight = 5;
	const margin = 4;
	const scrollbarOffset = code.geometry.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0;
	const rightEdge = codeRight - scrollbarOffset - constants.CODE_AREA_RIGHT_MARGIN;
	const left = Math.max(textLeft, rightEdge - indicatorWidth);
	const top = direction === 'above'
		? codeTop + margin
		: contentBottom - indicatorHeight - margin;
	const bottom = top + indicatorHeight;
	const accentHeight = 2;
	const accentTop = direction === 'above' ? top : bottom - accentHeight;
	api.fill_rect(left, top, left + indicatorWidth, bottom, 0, constants.ERROR_OVERLAY_BACKGROUND);
	api.fill_rect(left, accentTop, left + indicatorWidth, accentTop + accentHeight, 0, constants.ERROR_OVERLAY_LINE_HOVER);
	const notchWidth = 6;
	const notchLeft = left + Math.max(2, (indicatorWidth - notchWidth) / 2);
	const notchTop = direction === 'above' ? top - 1 : bottom;
	api.fill_rect(notchLeft, notchTop, notchLeft + notchWidth, notchTop + 1, 0, constants.ERROR_OVERLAY_TEXT_COLOR);
	api.blit_rect(left, top, left + indicatorWidth, bottom, 0, constants.ERROR_OVERLAY_TEXT_COLOR);
}

export function finalizeCodeAreaRender(code: CodeEditorControl,
	viewport: CodeAreaViewport & CompletionRenderBounds,
	cursorInfo: CursorScreenInfo,
	completion: CompletionPresentation,
): void {
	const verticalTrackLeft = viewport.codeRight - constants.SCROLLBAR_WIDTH;
	code.scratch.verticalTrack.left = verticalTrackLeft;
	code.scratch.verticalTrack.top = viewport.codeTop;
	code.scratch.verticalTrack.right = verticalTrackLeft + constants.SCROLLBAR_WIDTH;
	code.scratch.verticalTrack.bottom = viewport.contentBottom;

	code.scrollbars.codeVertical.layout(code.scratch.verticalTrack, viewport.visualCount, viewport.rows, code.view.scrollRow);
	code.setScrollPosition(code.layout.clampVisualScroll(code.scrollbars.codeVertical.getScroll(), viewport.visualCount, viewport.rows), code.view.scrollLeft);
	code.geometry.codeVerticalScrollbarVisible = code.scrollbars.codeVertical.isVisible();

	if (!viewport.wrapEnabled) {
		code.scratch.horizontalTrack.left = viewport.codeLeft;
		code.scratch.horizontalTrack.top = viewport.contentBottom;
		code.scratch.horizontalTrack.right = viewport.trackRight;
		code.scratch.horizontalTrack.bottom = viewport.contentBottom + constants.SCROLLBAR_WIDTH;
		code.scrollbars.codeHorizontal.layout(code.scratch.horizontalTrack, viewport.contentWidth + viewport.maxScrollLeft, viewport.contentWidth, code.view.scrollLeft);
		code.setScrollPosition(code.view.scrollRow, code.layout.clampHorizontalScroll(code.scrollbars.codeHorizontal.getScroll(), viewport.maxScrollLeft));
		code.geometry.codeHorizontalScrollbarVisible = code.scrollbars.codeHorizontal.isVisible();
	} else {
		code.setScrollPosition(code.view.scrollRow, 0);
		code.geometry.codeHorizontalScrollbarVisible = false;
	}

	const runtimeOverlayState: RuntimeErrorOverlayRenderResult = renderRuntimeErrorOverlay(code, viewport.codeTop, viewport.codeRight, viewport.textLeft, viewport.contentBottom);
	if (runtimeOverlayState === 'above' || runtimeOverlayState === 'below') {
		drawRuntimeErrorOverlayIndicator(code, runtimeOverlayState, viewport.codeTop, viewport.codeRight, viewport.textLeft, viewport.contentBottom);
	}
	drawHoverTooltip(code, viewport.codeTop, viewport.contentBottom, viewport.textLeft);

	completion.popupBounds = drawCompletionPopup(code, completion.session, cursorInfo, code.lineHeight, viewport, completion.popupBoundsScratch);
	drawParameterHintOverlay(code, completion.hint, cursorInfo, code.lineHeight, viewport, completion.popupBounds);
	if (code.geometry.codeVerticalScrollbarVisible) {
		code.scrollbars.codeVertical.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	if (code.geometry.codeHorizontalScrollbarVisible) {
		code.scrollbars.codeHorizontal.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
}
