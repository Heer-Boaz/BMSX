import type { OverlayApi as Api } from '../ui/view/overlay_api';
import type { CachedHighlight } from '../core/types';
import type { Font } from '../../render/shared/bmsx_font';
import * as constants from '../core/constants';
import { ide_state } from '../core/ide_state';
import { api } from '../ui/view/overlay_api';

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
	const matches = ide_state.referenceState.getMatches();
	if (matches.length === 0) {
		return;
	}
	const activeIndex = ide_state.referenceState.getActiveIndex();
	const highlight = entry.hi;
	const advancePrefix = entry.advancePrefix;
	for (let i = 0; i < matches.length; i += 1) {
		const match = matches[i];
		if (match.row !== rowIndex) {
			continue;
		}
		const startDisplay = ide_state.layout.columnToDisplay(highlight, match.start);
		const endDisplay = ide_state.layout.columnToDisplay(highlight, match.end);
		const visibleStart = Math.max(sliceStartDisplay, startDisplay);
		const visibleEnd = Math.min(sliceEndDisplay, endDisplay);
		if (visibleEnd <= visibleStart) {
			continue;
		}
		const startX = originX + advancePrefix[visibleStart] - advancePrefix[sliceStartDisplay];
		const endX = originX + advancePrefix[visibleEnd] - advancePrefix[sliceStartDisplay];
		const overlay = i === activeIndex ? constants.REFERENCES_MATCH_ACTIVE_OVERLAY : constants.REFERENCES_MATCH_OVERLAY;
		api.fill_rect_color(startX, originY, endX, originY + ide_state.lineHeight, undefined, overlay);
	}
}

export function drawSearchHighlightsForRow(api: Api, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
	if (ide_state.search.scope !== 'local' || ide_state.search.matches.length === 0 || ide_state.search.query.length === 0) {
		return;
	}
	const highlight = entry.hi;
	const advancePrefix = entry.advancePrefix;
	for (let i = 0; i < ide_state.search.matches.length; i += 1) {
		const match = ide_state.search.matches[i];
		if (match.row !== rowIndex) {
			continue;
		}
		const startDisplay = ide_state.layout.columnToDisplay(highlight, match.start);
		const endDisplay = ide_state.layout.columnToDisplay(highlight, match.end);
		const visibleStart = Math.max(sliceStartDisplay, startDisplay);
		const visibleEnd = Math.min(sliceEndDisplay, endDisplay);
		if (visibleEnd <= visibleStart) {
			continue;
		}
		const startX = originX + advancePrefix[visibleStart] - advancePrefix[sliceStartDisplay];
		const endX = originX + advancePrefix[visibleEnd] - advancePrefix[sliceStartDisplay];
		const overlay = i === ide_state.search.currentIndex ? constants.SEARCH_MATCH_ACTIVE_OVERLAY : constants.SEARCH_MATCH_OVERLAY;
		api.fill_rect_color(startX, originY, endX, originY + ide_state.lineHeight, undefined, overlay);
	}
}
