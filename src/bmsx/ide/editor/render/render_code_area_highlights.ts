import type { OverlayApi as Api } from '../ui/view/overlay_api';
import type { CachedHighlight } from '../../common/types';
import type { Font } from '../../../render/shared/bmsx_font';
import * as constants from '../../common/constants';
import { api } from '../ui/view/overlay_api';
import { editorViewState } from '../ui/editor_view_state';
import { editorFeatureState } from '../common/editor_feature_state';
import { editorSearchState } from '../contrib/find/find_widget_state';

export function drawHighlightSlice(
	renderFont: Font,
	renderText: string,
	colors: readonly number[],
	advancePrefix: readonly number[],
	startDisplay: number,
	endDisplay: number,
	originX: number,
	originY: number,
	z: number
): void {
	if (endDisplay <= startDisplay) {
		return;
	}
	let cursorX = originX;
	let index = startDisplay;
	while (index < endDisplay) {
		const color = colors[index];
		let end = index + 1;
		while (end < endDisplay && colors[end] === color) {
			end += 1;
		}
		api.blit_text_inline_span_with_font(renderText, index, end, cursorX, originY, z, color, renderFont);
		cursorX += advancePrefix[end] - advancePrefix[index];
		index = end;
	}
}

export function drawReferenceHighlightsForRow(api: Api, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
	const matches = editorFeatureState.referenceState.getMatches();
	if (matches.length === 0) {
		return;
	}
	const activeIndex = editorFeatureState.referenceState.getActiveIndex();
	const highlight = entry.hi;
	const advancePrefix = entry.advancePrefix;
	for (let i = 0; i < matches.length; i += 1) {
		const match = matches[i];
		if (match.row !== rowIndex) {
			continue;
		}
		const startDisplay = editorViewState.layout.columnToDisplay(highlight, match.start);
		const endDisplay = editorViewState.layout.columnToDisplay(highlight, match.end);
		const visibleStart = Math.max(sliceStartDisplay, startDisplay);
		const visibleEnd = Math.min(sliceEndDisplay, endDisplay);
		if (visibleEnd <= visibleStart) {
			continue;
		}
		const startX = originX + advancePrefix[visibleStart] - advancePrefix[sliceStartDisplay];
		const endX = originX + advancePrefix[visibleEnd] - advancePrefix[sliceStartDisplay];
		const overlay = i === activeIndex ? constants.REFERENCES_MATCH_ACTIVE_OVERLAY : constants.REFERENCES_MATCH_OVERLAY;
		api.fill_rect_color(startX, originY, endX, originY + editorViewState.lineHeight, undefined, overlay);
	}
}

export function drawSearchHighlightsForRow(api: Api, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
	if (editorSearchState.scope !== 'local' || editorSearchState.matches.length === 0 || editorSearchState.query.length === 0) {
		return;
	}
	const highlight = entry.hi;
	const advancePrefix = entry.advancePrefix;
	for (let i = 0; i < editorSearchState.matches.length; i += 1) {
		const match = editorSearchState.matches[i];
		if (match.row !== rowIndex) {
			continue;
		}
		const startDisplay = editorViewState.layout.columnToDisplay(highlight, match.start);
		const endDisplay = editorViewState.layout.columnToDisplay(highlight, match.end);
		const visibleStart = Math.max(sliceStartDisplay, startDisplay);
		const visibleEnd = Math.min(sliceEndDisplay, endDisplay);
		if (visibleEnd <= visibleStart) {
			continue;
		}
		const startX = originX + advancePrefix[visibleStart] - advancePrefix[sliceStartDisplay];
		const endX = originX + advancePrefix[visibleEnd] - advancePrefix[sliceStartDisplay];
		const overlay = i === editorSearchState.currentIndex ? constants.SEARCH_MATCH_ACTIVE_OVERLAY : constants.SEARCH_MATCH_OVERLAY;
		api.fill_rect_color(startX, originY, endX, originY + editorViewState.lineHeight, undefined, overlay);
	}
}
