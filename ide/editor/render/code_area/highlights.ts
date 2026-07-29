import type { OverlayApi as Api } from '../../../runtime/overlay_api';
import type { CachedHighlight } from '../../../common/models';
import type { Font } from '../../../../machine/ts/render/shared/bmsx_font';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { editorViewState } from '../../ui/view/state';
import type { SearchMatch } from '../../../common/models';

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

export function drawReferenceHighlightsForRow(
	api: Api,
	rowIndex: number,
	entry: CachedHighlight,
	originX: number,
	originY: number,
	sliceStartDisplay: number,
	sliceEndDisplay: number,
	matches: readonly SearchMatch[],
	activeIndex: number,
): void {
	if (matches.length === 0) {
		return;
	}
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
		api.fill_rect(startX, originY, endX, originY + editorViewState.lineHeight, 0, overlay);
	}
}

export function drawSearchHighlightsForRow(
	api: Api,
	rowIndex: number,
	entry: CachedHighlight,
	originX: number,
	originY: number,
	sliceStartDisplay: number,
	sliceEndDisplay: number,
	matches: readonly SearchMatch[],
	activeIndex: number,
	visible: boolean,
): void {
	if (!visible || matches.length === 0) {
		return;
	}
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
		const overlay = i === activeIndex ? constants.SEARCH_MATCH_ACTIVE_OVERLAY : constants.SEARCH_MATCH_OVERLAY;
		api.fill_rect(startX, originY, endX, originY + editorViewState.lineHeight, 0, overlay);
	}
}
